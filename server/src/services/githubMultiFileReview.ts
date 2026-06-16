import { fetchGitHubProjectInfo } from './githubProjectInfo'
import { fetchGitHubFile, GitHubFileError, type GitHubFileResult } from './githubFile'

export type GitHubMultiFileReviewResult = {
  reviewedFiles: string[]
  skippedFiles: Array<{
    path: string
    reason: string
  }>
  architectureIssues: string[]
  securityRisks: string[]
  stateManagementIssues: string[]
  crossFileConcerns: string[]
  recommendedNextSteps: string[]
}

type MultiFileReviewInput = {
  repoUrl: string
  filePaths: string[]
}

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
}

class GitHubMultiFileReviewError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'GitHubMultiFileReviewError'
    this.statusCode = statusCode
  }
}

const groqModels = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'] as const
const maxFiles = 5
const maxFileSizeBytes = 20 * 1024
const maxCombinedBytes = 60 * 1024

function getGroqApiKey() {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey || apiKey.length === 0 || apiKey === 'your_key_here') {
    return undefined
  }

  return apiKey
}

function extractJsonText(text: string) {
  const trimmed = text.trim()

  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }

  return trimmed
}

function extractFirstJsonObjectText(text: string) {
  const startIndex = text.indexOf('{')
  const endIndex = text.lastIndexOf('}')

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null
  }

  return text.slice(startIndex, endIndex + 1)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeReviewResult(value: unknown): GitHubMultiFileReviewResult | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (
    !isStringArray(candidate.reviewedFiles) ||
    !Array.isArray(candidate.skippedFiles) ||
    !isStringArray(candidate.architectureIssues) ||
    !isStringArray(candidate.securityRisks) ||
    !isStringArray(candidate.stateManagementIssues) ||
    !isStringArray(candidate.crossFileConcerns) ||
    !isStringArray(candidate.recommendedNextSteps)
  ) {
    return null
  }

  const skippedFiles = candidate.skippedFiles
    .map((item) => {
      if (typeof item !== 'object' || item === null) {
        return null
      }

      const skipped = item as Record<string, unknown>

      if (typeof skipped.path !== 'string' || typeof skipped.reason !== 'string') {
        return null
      }

      return {
        path: skipped.path,
        reason: skipped.reason,
      }
    })
    .filter((item): item is { path: string; reason: string } => item !== null)

  return {
    reviewedFiles: toStringArray(candidate.reviewedFiles),
    skippedFiles,
    architectureIssues: toStringArray(candidate.architectureIssues),
    securityRisks: toStringArray(candidate.securityRisks),
    stateManagementIssues: toStringArray(candidate.stateManagementIssues),
    crossFileConcerns: toStringArray(candidate.crossFileConcerns),
    recommendedNextSteps: toStringArray(candidate.recommendedNextSteps),
  }
}

function buildPrompt(
  projectType: string,
  reviewedFiles: GitHubFileResult[],
  skippedFiles: Array<{ path: string; reason: string }>,
) {
  const fileBlocks = reviewedFiles
    .map(
      (file) =>
        [
          `File: ${file.path}`,
          '```ts',
          file.content,
          '```',
        ].join('\n'),
    )
    .join('\n\n')

  return [
    'You are RepoMind AI doing a grounded multi-file repository risk review.',
    'Review only the files and metadata provided.',
    'Do not invent issues.',
    'Focus on duplicated logic across files, auth/security issues, inconsistent error handling, state management problems, file responsibility boundaries, risky coupling, missing validation between UI and service layers, and maintainability.',
    'Every non-empty finding must cite specific file names and code patterns from the provided files.',
    'If a category has no real issues, return an empty array for that category.',
    'Return JSON only with this exact shape:',
    '{"reviewedFiles":[],"skippedFiles":[{"path":"","reason":""}],"architectureIssues":[],"securityRisks":[],"stateManagementIssues":[],"crossFileConcerns":[],"recommendedNextSteps":[]}',
    `Project type: ${projectType}`,
    `Reviewed files: ${reviewedFiles.map((file) => file.path).join(', ') || 'None'}`,
    `Skipped files: ${skippedFiles.map((file) => `${file.path} (${file.reason})`).join(', ') || 'None'}`,
    'Files:',
    fileBlocks,
  ].join('\n')
}

async function callGroqOnce(prompt: string, model: string): Promise<GitHubMultiFileReviewResult> {
  const apiKey = getGroqApiKey()

  if (!apiKey) {
    throw new GitHubMultiFileReviewError(503, 'Groq is not configured.')
  }

  let response: Response

  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Return only valid JSON with this exact shape: {"reviewedFiles":[],"skippedFiles":[{"path":"","reason":""}],"architectureIssues":[],"securityRisks":[],"stateManagementIssues":[],"crossFileConcerns":[],"recommendedNextSteps":[]}. No markdown. No code fences. No explanation outside JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: {
          type: 'json_object',
        },
        temperature: 0.2,
      }),
    })
  } catch {
    throw new GitHubMultiFileReviewError(502, 'Network error while contacting Groq.')
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new GitHubMultiFileReviewError(
      502,
      `Groq request failed with status ${response.status}: ${errorText}`,
    )
  }

  const data = (await response.json()) as GroqChatResponse
  const rawContent = data.choices?.[0]?.message?.content

  if (!rawContent) {
    throw new GitHubMultiFileReviewError(502, 'Groq returned an empty response.')
  }

  const attempts = new Set<string>()
  const trimmed = rawContent.trim()
  if (trimmed) {
    attempts.add(trimmed)
  }

  const withoutFence = extractJsonText(rawContent)
  if (withoutFence.trim()) {
    attempts.add(withoutFence.trim())
  }

  const firstObject = extractFirstJsonObjectText(rawContent)
  if (firstObject?.trim()) {
    attempts.add(firstObject.trim())
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown
      const normalized = normalizeReviewResult(parsed)
      if (normalized) {
        return normalized
      }
    } catch {
      // Keep trying later candidates.
    }
  }

  throw new GitHubMultiFileReviewError(502, 'Groq returned content that could not be parsed.')
}

async function generateReview(
  projectType: string,
  reviewedFiles: GitHubFileResult[],
  skippedFiles: Array<{ path: string; reason: string }>,
): Promise<GitHubMultiFileReviewResult> {
  if (reviewedFiles.length === 0) {
    return {
      reviewedFiles: [],
      skippedFiles,
      architectureIssues: [],
      securityRisks: [],
      stateManagementIssues: [],
      crossFileConcerns: [],
      recommendedNextSteps: [],
    }
  }

  const prompt = buildPrompt(projectType, reviewedFiles, skippedFiles)

  for (const model of groqModels) {
    try {
      const parsed = await callGroqOnce(prompt, model)

      return {
        ...parsed,
        reviewedFiles: reviewedFiles.map((file) => file.path),
        skippedFiles,
      }
    } catch (error) {
      if (error instanceof GitHubMultiFileReviewError && error.message.startsWith('Groq request failed')) {
        continue
      }

      if (error instanceof GitHubMultiFileReviewError && error.message === 'Groq is not configured.') {
        throw error
      }

      if (error instanceof GitHubMultiFileReviewError) {
        throw error
      }
    }
  }

  throw new GitHubMultiFileReviewError(502, 'Groq multi-file review failed.')
}

export async function reviewGitHubFiles(input: MultiFileReviewInput): Promise<GitHubMultiFileReviewResult> {
  const repoUrl = input.repoUrl?.trim()
  const filePaths = input.filePaths

  if (!repoUrl) {
    throw new GitHubMultiFileReviewError(400, 'repoUrl is required')
  }

  if (!Array.isArray(filePaths)) {
    throw new GitHubMultiFileReviewError(400, 'filePaths is required')
  }

  if (filePaths.length === 0) {
    throw new GitHubMultiFileReviewError(400, 'filePaths must contain at least one file.')
  }

  if (filePaths.length > maxFiles) {
    throw new GitHubMultiFileReviewError(400, 'You can review up to 5 files at a time.')
  }

  if (filePaths.some((filePath) => typeof filePath !== 'string' || filePath.trim().length === 0)) {
    throw new GitHubMultiFileReviewError(400, 'filePaths must contain only non-empty strings.')
  }

  const projectInfo = await fetchGitHubProjectInfo(repoUrl)
  const reviewedFiles: GitHubFileResult[] = []
  const skippedFiles: Array<{ path: string; reason: string }> = []
  let combinedBytes = 0

  for (const filePath of filePaths) {
    try {
      const file = await fetchGitHubFile(repoUrl, filePath)

      if (file.size > maxFileSizeBytes) {
        skippedFiles.push({
          path: filePath,
          reason: 'File is larger than the 20KB multi-file review limit.',
        })
        continue
      }

      const fileBytes = Buffer.byteLength(file.content, 'utf8')
      if (combinedBytes + fileBytes > maxCombinedBytes) {
        skippedFiles.push({
          path: filePath,
          reason: 'Combined selected content would exceed the 60KB review limit.',
        })
        continue
      }

      reviewedFiles.push(file)
      combinedBytes += fileBytes
    } catch (error) {
      if (error instanceof GitHubFileError) {
        skippedFiles.push({
          path: filePath,
          reason: error.message,
        })
        continue
      }

      throw error
    }
  }

  const projectType = projectInfo.projectTypes.length > 0 ? projectInfo.projectTypes.join(' / ') : 'Unknown'

  return generateReview(projectType, reviewedFiles, skippedFiles)
}

export { GitHubMultiFileReviewError }
