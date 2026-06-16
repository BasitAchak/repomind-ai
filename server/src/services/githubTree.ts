import { parseGitHubRepoUrl, type ParsedGitHubRepo } from '../utils/parseGitHubRepoUrl'
import { getGitHubRequestHeaders, isGitHubRateLimitResponse } from './githubApi'

export type GitHubTreeFile = {
  path: string
  type: 'file'
  size?: number
}

export type GitHubTreeResult = ParsedGitHubRepo & {
  files: GitHubTreeFile[]
}

const allowedExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.json',
  '.css',
  '.html',
])

const ignoredPathSegments = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
])

const ignoredFileNames = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])

type GitHubRepoDetails = {
  default_branch?: string
}

type GitHubBranchDetails = {
  commit?: {
    tree?: {
      sha?: string
    }
  }
}

type GitHubTreeResponse = {
  tree?: Array<{
    path?: string
    type?: string
    size?: number
  }>
}

class GitHubTreeError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'GitHubTreeError'
    this.statusCode = statusCode
  }
}

function hasAllowedExtension(path: string) {
  return allowedExtensions.has(path.slice(path.lastIndexOf('.')).toLowerCase())
}

function shouldIgnorePath(path: string) {
  const fileName = path.split('/').pop()
  if (fileName && ignoredFileNames.has(fileName)) {
    return true
  }

  const segments = path.split('/')
  return segments.some((segment) => ignoredPathSegments.has(segment))
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      headers: getGitHubRequestHeaders(),
    })
  } catch {
    throw new GitHubTreeError(502, 'Network error while contacting GitHub.')
  }

  const bodyText = await response.text()

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubTreeError(404, 'GitHub repository not found.')
    }

    if (isGitHubRateLimitResponse(response.status, bodyText)) {
      throw new GitHubTreeError(429, 'GitHub API rate limit reached. Please try again later.')
    }

    throw new GitHubTreeError(
      502,
      `GitHub API request failed with status ${response.status}.`,
    )
  }

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new GitHubTreeError(502, 'GitHub returned invalid JSON.')
  }
}

function collectUsefulFiles(entries: GitHubTreeResponse['tree']): GitHubTreeFile[] {
  return (entries ?? [])
    .filter((entry) => entry?.type === 'blob' && typeof entry.path === 'string')
    .filter((entry) => !shouldIgnorePath(entry.path!))
    .filter((entry) => hasAllowedExtension(entry.path!))
    .map((entry) => ({
      path: entry.path!,
      type: 'file' as const,
      size: typeof entry.size === 'number' ? entry.size : undefined,
    }))
}

export async function fetchGitHubTree(url: string): Promise<GitHubTreeResult> {
  const parsedRepo = parseGitHubRepoUrl(url)

  if (!parsedRepo) {
    throw new GitHubTreeError(400, 'Please provide a valid GitHub repository URL.')
  }

  const repoDetails = await fetchJson<GitHubRepoDetails>(
    `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}`,
  )

  const branchName = repoDetails.default_branch

  if (!branchName) {
    throw new GitHubTreeError(502, 'GitHub repository does not expose a default branch.')
  }

  const branchDetails = await fetchJson<GitHubBranchDetails>(
    `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/commits/${encodeURIComponent(
      branchName,
    )}`,
  )

  const treeSha = branchDetails.commit?.tree?.sha

  if (!treeSha) {
    throw new GitHubTreeError(502, 'GitHub repository tree could not be resolved.')
  }

  const treeResponse = await fetchJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/trees/${treeSha}?recursive=1`,
  )

  return {
    owner: parsedRepo.owner,
    repo: parsedRepo.repo,
    files: collectUsefulFiles(treeResponse.tree),
  }
}

export { GitHubTreeError }
