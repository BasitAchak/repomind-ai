import { parseGitHubRepoUrl, type ParsedGitHubRepo } from '../utils/parseGitHubRepoUrl'
import { getGitHubRequestHeaders, isGitHubRateLimitResponse } from './githubApi'

export type GitHubProjectInfoResult = ParsedGitHubRepo & {
  projectTypes: string[]
  dependencies: string[]
  devDependencies: string[]
  scripts: string[]
  configFiles: string[]
}

type GitHubRepoDetails = {
  default_branch?: string
}

type GitHubContentFile = {
  type?: string
  encoding?: string
  content?: string
  path?: string
}

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

type AppJson = {
  expo?: Record<string, unknown>
}

class GitHubProjectInfoError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'GitHubProjectInfoError'
    this.statusCode = statusCode
  }
}

function encodeGitHubPath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function decodeGitHubContent(content: string) {
  return Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8')
}

async function fetchGitHubJson<T>(url: string, notFoundMessage: string): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      headers: getGitHubRequestHeaders(),
    })
  } catch {
    throw new GitHubProjectInfoError(502, 'Network error while contacting GitHub.')
  }

  const bodyText = await response.text()

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubProjectInfoError(404, notFoundMessage)
    }

    if (isGitHubRateLimitResponse(response.status, bodyText)) {
      throw new GitHubProjectInfoError(429, 'GitHub API rate limit reached. Please try again later.')
    }

    throw new GitHubProjectInfoError(
      502,
      `GitHub API request failed with status ${response.status}.`,
    )
  }

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new GitHubProjectInfoError(502, 'GitHub returned invalid JSON.')
  }
}

async function fetchGitHubContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<GitHubContentFile | null> {
  let response: Response

  try {
    response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(
        ref,
      )}`,
      {
        headers: getGitHubRequestHeaders(),
      },
    )
  } catch {
    throw new GitHubProjectInfoError(502, 'Network error while contacting GitHub.')
  }

  const bodyText = await response.text()

  if (!response.ok) {
    if (response.status === 404) {
      return null
    }

    if (isGitHubRateLimitResponse(response.status, bodyText)) {
      throw new GitHubProjectInfoError(429, 'GitHub API rate limit reached. Please try again later.')
    }

    throw new GitHubProjectInfoError(
      502,
      `GitHub API request failed with status ${response.status}.`,
    )
  }

  try {
    return JSON.parse(bodyText) as GitHubContentFile
  } catch {
    throw new GitHubProjectInfoError(502, 'GitHub returned invalid JSON.')
  }
}

function parsePackageJson(content: string): PackageJson {
  return JSON.parse(content) as PackageJson
}

function parseAppJson(content: string): AppJson {
  return JSON.parse(content) as AppJson
}

function collectNames(entries?: Record<string, string>) {
  return Object.keys(entries ?? {})
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function detectProjectTypes(
  packageJson: PackageJson | null,
  configFiles: string[],
  appJson: AppJson | null,
) {
  const dependencies = packageJson?.dependencies ?? {}
  const devDependencies = packageJson?.devDependencies ?? {}
  const allNames = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)])

  const has = (...names: string[]) => names.some((name) => allNames.has(name))
  const hasConfig = (name: string) => configFiles.includes(name)

  const projectTypes: string[] = []

  if (packageJson) {
    projectTypes.push('Node.js')
  }

  if (has('react', 'react-dom', 'react-native')) {
    projectTypes.push('React')
  }

  if (has('react-native')) {
    projectTypes.push('React Native')
  }

  if (has('expo') || hasConfig('app.json') || appJson?.expo) {
    projectTypes.push('Expo')
  }

  if (has('expo-router')) {
    projectTypes.push('Expo Router')
  }

  if (has('express')) {
    projectTypes.push('Express')
  }

  if (has('typescript')) {
    projectTypes.push('TypeScript')
  }

  if (has('vite') || Object.values(packageJson?.scripts ?? {}).some((script) => script.includes('vite'))) {
    projectTypes.push('Vite')
  }

  if (has('next')) {
    projectTypes.push('Next.js')
  }

  if (has('firebase')) {
    projectTypes.push('Firebase')
  }

  if (has('@supabase/supabase-js', 'supabase')) {
    projectTypes.push('Supabase')
  }

  return unique(projectTypes)
}

export async function fetchGitHubProjectInfo(url: string): Promise<GitHubProjectInfoResult> {
  const parsedRepo = parseGitHubRepoUrl(url)

  if (!parsedRepo) {
    throw new GitHubProjectInfoError(400, 'Please provide a valid GitHub repository URL.')
  }

  const repoDetails = await fetchGitHubJson<GitHubRepoDetails>(
    `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}`,
    'GitHub repository not found.',
  )

  const branchName = repoDetails.default_branch

  if (!branchName) {
    throw new GitHubProjectInfoError(502, 'GitHub repository does not expose a default branch.')
  }

  const [packageFile, appFile] = await Promise.all([
    fetchGitHubContent(parsedRepo.owner, parsedRepo.repo, 'package.json', branchName),
    fetchGitHubContent(parsedRepo.owner, parsedRepo.repo, 'app.json', branchName),
  ])

  const configFiles = unique(
    [packageFile ? 'package.json' : null, appFile ? 'app.json' : null].filter(
      (item): item is string => item !== null,
    ),
  )

  let packageJson: PackageJson | null = null
  let appJson: AppJson | null = null

  try {
    packageJson =
      packageFile?.encoding === 'base64' && typeof packageFile.content === 'string'
        ? parsePackageJson(decodeGitHubContent(packageFile.content))
        : null
  } catch {
    throw new GitHubProjectInfoError(502, 'GitHub package.json contained invalid JSON.')
  }

  try {
    appJson =
      appFile?.encoding === 'base64' && typeof appFile.content === 'string'
        ? parseAppJson(decodeGitHubContent(appFile.content))
        : null
  } catch {
    throw new GitHubProjectInfoError(502, 'GitHub app.json contained invalid JSON.')
  }

  const dependencies = collectNames(packageJson?.dependencies)
  const devDependencies = collectNames(packageJson?.devDependencies)
  const scripts = Object.entries(packageJson?.scripts ?? {}).map(([name, command]) => `${name}: ${command}`)
  const projectTypes = detectProjectTypes(packageJson, configFiles, appJson)

  return {
    owner: parsedRepo.owner,
    repo: parsedRepo.repo,
    projectTypes,
    dependencies,
    devDependencies,
    scripts,
    configFiles,
  }
}

export { GitHubProjectInfoError }
