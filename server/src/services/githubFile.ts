import { parseGitHubRepoUrl, type ParsedGitHubRepo } from '../utils/parseGitHubRepoUrl'
import { getGitHubRequestHeaders, isGitHubRateLimitResponse } from './githubApi'

export type GitHubFileResult = ParsedGitHubRepo & {
  path: string
  content: string
  size: number
}

const maxReviewFileSizeBytes = 50 * 1024

type GitHubRepoDetails = {
  default_branch?: string
}

type GitHubFileDetails = {
  type?: string
  encoding?: string
  content?: string
  size?: number
  path?: string
}

class GitHubFileError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'GitHubFileError'
    this.statusCode = statusCode
  }
}

function encodeGitHubPath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function isLikelyText(content: string) {
  if (content.includes('\u0000') || content.includes('\uFFFD')) {
    return false
  }

  const sample = content.slice(0, 4096)
  let suspiciousControls = 0

  for (const character of sample) {
    const charCode = character.charCodeAt(0)
    const isAllowedControl =
      charCode === 9 || charCode === 10 || charCode === 13 || charCode >= 32

    if (!isAllowedControl) {
      suspiciousControls += 1
    }
  }

  return suspiciousControls / Math.max(sample.length, 1) < 0.02
}

async function fetchGitHubJson<T>(url: string, notFoundMessage: string): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      headers: getGitHubRequestHeaders(),
    })
  } catch {
    throw new GitHubFileError(502, 'Network error while contacting GitHub.')
  }

  const bodyText = await response.text()

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubFileError(404, notFoundMessage)
    }

    if (isGitHubRateLimitResponse(response.status, bodyText)) {
      throw new GitHubFileError(429, 'GitHub API rate limit reached. Please try again later.')
    }

    throw new GitHubFileError(
      502,
      `GitHub API request failed with status ${response.status}.`,
    )
  }

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new GitHubFileError(502, 'GitHub returned invalid JSON.')
  }
}

function decodeGitHubContent(content: string) {
  return Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8')
}

export async function fetchGitHubFile(url: string, path: string): Promise<GitHubFileResult> {
  const parsedRepo = parseGitHubRepoUrl(url)

  if (!parsedRepo) {
    throw new GitHubFileError(400, 'Please provide a valid GitHub repository URL.')
  }

  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new GitHubFileError(400, 'path is required')
  }

  const repoDetails = await fetchGitHubJson<GitHubRepoDetails>(
    `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}`,
    'GitHub repository not found.',
  )

  const branchName = repoDetails.default_branch

  if (!branchName) {
    throw new GitHubFileError(502, 'GitHub repository does not expose a default branch.')
  }

  const fileDetails = await fetchGitHubJson<GitHubFileDetails>(
    `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/contents/${encodeGitHubPath(
      path,
    )}?ref=${encodeURIComponent(branchName)}`,
    'GitHub file not found.',
  )

  if (fileDetails.type !== 'file') {
    throw new GitHubFileError(404, 'GitHub file not found.')
  }

  if (typeof fileDetails.size !== 'number') {
    throw new GitHubFileError(502, 'GitHub file metadata is incomplete.')
  }

  if (fileDetails.size > maxReviewFileSizeBytes) {
    throw new GitHubFileError(
      413,
      'This file is too large for free-tier review. Please select a file under 50KB.',
    )
  }

  if (fileDetails.encoding !== 'base64' || typeof fileDetails.content !== 'string') {
    throw new GitHubFileError(415, 'This file looks binary or non-text and cannot be reviewed.')
  }

  const content = decodeGitHubContent(fileDetails.content)

  if (!isLikelyText(content)) {
    throw new GitHubFileError(415, 'This file looks binary or non-text and cannot be reviewed.')
  }

  return {
    owner: parsedRepo.owner,
    repo: parsedRepo.repo,
    path: fileDetails.path ?? path,
    content,
    size: fileDetails.size,
  }
}

export { GitHubFileError }
