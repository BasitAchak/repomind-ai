import fs from 'fs'
import path from 'path'

export type ReviewRequest = {
  code: string
  language: string
  filePath?: string
}

export type ReviewResult = {
  bugs: string[]
  securityIssues: string[]
  codeQuality: string[]
  improvements: string[]
}

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
}

const mockReview: ReviewResult = {
  bugs: [],
  securityIssues: [],
  codeQuality: [],
  improvements: [],
}

const groqModels = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'] as const

class ReviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewError'
  }
}

export function getServerEnvPath() {
  const cwd = process.cwd()
  const candidatePaths = [
    path.resolve(cwd, 'server', '.env'),
    path.resolve(cwd, '.env'),
  ]

  return candidatePaths.find((filePath) => fs.existsSync(filePath))
}

function getMockReview() {
  return mockReview
}

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

function isConfigFile(filePath?: string) {
  if (!filePath) {
    return false
  }

  const normalized = filePath.toLowerCase()

  return (
    normalized.endsWith('app.json') ||
    normalized.endsWith('package.json') ||
    normalized.endsWith('tsconfig.json') ||
    normalized.endsWith('eslint.config.js') ||
    normalized.endsWith('.config.js') ||
    normalized.endsWith('.config.ts') ||
    normalized.endsWith('.config.json')
  )
}

function buildReviewGuidance(reviewRequest: ReviewRequest) {
  const filePath = reviewRequest.filePath?.trim()
  const language = reviewRequest.language.trim()
  const configReview = language.toLowerCase() === 'json' || isConfigFile(filePath)
  const normalizedFilePath = filePath?.toLowerCase() ?? ''
  const isReactOrTsxFile =
    language.toLowerCase().includes('react') ||
    language.toLowerCase().includes('typescript') ||
    normalizedFilePath.endsWith('.tsx') ||
    normalizedFilePath.endsWith('.jsx') ||
    normalizedFilePath.includes('component') ||
    normalizedFilePath.includes('screen') ||
    normalizedFilePath.includes('page')

  const lines = [
    'You are RepoMind AI, a strict but careful senior code reviewer.',
    'Review only what is present in the provided content.',
    'Do not invent issues.',
    'Do not say something is missing if it already exists.',
    'Do not label minor suggestions as bugs.',
    'Use "bugs" only for actual correctness problems.',
    'Use "securityIssues" only for real security risks.',
    'Use "codeQuality" for concrete maintainability, readability, architecture, type-safety, and configuration concerns grounded in the file.',
    'Use "improvements" for optional but useful refactors, UX, and structural enhancements grounded in the file.',
    'When the code is React, React Native, or TypeScript, look for large components, too many responsibilities in one file, repeated state-reset logic, weak error handling, password/auth UX concerns, missing loading states, missing disabled states, unsafe any usage, duplicated UI patterns, extractable hooks/components, stale state, broken conditional logic, and cleanup bugs.',
    'If obvious runtime, logic, or state-flow defects exist, put them in bugs even if the file also has maintainability issues.',
    'Only leave bugs empty when there are truly no correctness problems in the provided code.',
    'If there are no real security risks, securityIssues can be empty.',
    'But do not leave codeQuality or improvements empty unless the file is genuinely very clean and there are no grounded maintainability, readability, architecture, UX, or type-safety observations to make.',
    'Each non-empty finding must cite a specific code pattern from the provided file, such as a function, branch, prop, state flow, repeated block, or component structure.',
    'Keep every issue specific, grounded, and concise.',
    'Return JSON only with this exact shape:',
    '{"bugs":[],"securityIssues":[],"codeQuality":[],"improvements":[]}',
    `Language: ${language}`,
  ]

  if (filePath) {
    lines.push(`File path: ${filePath}`)
  }

  if (configReview) {
    lines.push(
      'Treat this as configuration, not executable code.',
      'For Expo app.json or similar config files, focus on:',
      '- invalid JSON',
      '- missing production metadata',
      '- risky permissions or settings',
      '- platform config completeness',
      '- asset path consistency',
      '- app store readiness',
      'Do not ask for runtime validation logic inside app.json.',
    )
  }

  if (isReactOrTsxFile) {
    lines.push(
      'For React/React Native/TypeScript UI files, prefer grounded feedback about component size, duplicated UI patterns, prop drilling, repeated handlers, state management, missing loading or disabled states, and opportunities to extract reusable hooks or components.',
    )
  }

  lines.push('Code:')
  lines.push(reviewRequest.code)

  return lines.join('\n')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isReviewResult(value: unknown): value is ReviewResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    isStringArray(candidate.bugs) &&
    isStringArray(candidate.securityIssues) &&
    isStringArray(candidate.codeQuality) &&
    isStringArray(candidate.improvements)
  )
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeReviewResult(value: unknown): ReviewResult | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>

  return {
    bugs: toStringArray(candidate.bugs),
    securityIssues: toStringArray(candidate.securityIssues),
    codeQuality: toStringArray(candidate.codeQuality),
    improvements: toStringArray(candidate.improvements),
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function analyzeCodeHeuristics(reviewRequest: ReviewRequest): ReviewResult {
  const bugs: string[] = []
  const securityIssues: string[] = []
  const codeQuality: string[] = []
  const improvements: string[] = []
  const normalizedCode = reviewRequest.code.replace(/\r\n/g, '\n')
  const lines = normalizedCode.split('\n')
  const language = reviewRequest.language.toLowerCase()
  const filePath = reviewRequest.filePath?.toLowerCase() ?? ''
  const isTypeScriptLike =
    language.includes('typescript') ||
    language.includes('javascript') ||
    /\.(ts|tsx|js|jsx)$/i.test(filePath)
  const isReactFile =
    language.includes('react') ||
    filePath.endsWith('.tsx') ||
    filePath.endsWith('.jsx') ||
    /useState\s*\(|useEffect\s*\(|return\s*\(/.test(normalizedCode)

  const addUnique = (bucket: string[], value: string) => {
    if (!bucket.includes(value)) {
      bucket.push(value)
    }
  }

  const functionMatches = normalizedCode.match(/\bfunction\b|\=\>\s*\{/g) ?? []
  const useStateMatches = normalizedCode.match(/\buseState\s*\(/g) ?? []
  const useEffectMatches = normalizedCode.match(/\buseEffect\s*\(/g) ?? []

  if (isTypeScriptLike && /\bany\b/.test(normalizedCode)) {
    addUnique(bugs, 'Unsafe `any` usage can hide type errors and let runtime bugs slip through.')
    addUnique(codeQuality, 'Type safety is weakened by `any`, which makes runtime regressions easier to miss.')
  }

  if (/as\s+any\b/.test(normalizedCode) || /\/\/\s*@ts-ignore/.test(normalizedCode)) {
    addUnique(codeQuality, 'Type assertions or ignores are suppressing the compiler instead of fixing the underlying type issue.')
  }

  if (/catch\s*\(\s*[^)]*\s*\)\s*\{\s*\}/s.test(normalizedCode) || /catch\s*\{\s*\}/s.test(normalizedCode)) {
    addUnique(bugs, 'Empty `catch` blocks swallow failures and can hide broken async or state-update flows.')
    addUnique(codeQuality, 'Empty error handling hides real failures and makes the control flow hard to trust.')
    addUnique(improvements, 'Return or surface the error instead of silently swallowing it.')
  }

  if (/setInterval\s*\(/.test(normalizedCode) && /useEffect\s*\(/.test(normalizedCode) && !/clearInterval\s*\(/.test(normalizedCode)) {
    addUnique(bugs, '`setInterval` is created without cleanup, so the timer can leak when the component unmounts.')
  }

  if (/addEventListener\s*\(/.test(normalizedCode) && /useEffect\s*\(/.test(normalizedCode) && !/removeEventListener\s*\(/.test(normalizedCode)) {
    addUnique(bugs, 'Event listeners are registered without cleanup, which can create duplicate handlers or leaks.')
  }

  if (/fetch\s*\(/.test(normalizedCode) && !/response\.ok/.test(normalizedCode) && !/status/.test(normalizedCode)) {
    addUnique(bugs, '`fetch` calls do not check the HTTP status, so failed requests may be treated as successful responses.')
    addUnique(improvements, 'Check `response.ok` and surface request failures to the user.')
  }

  if (/(^|[^=!])==([^=]|$)/.test(normalizedCode) || /(^|[^=!])!=([^=]|$)/.test(normalizedCode)) {
    addUnique(bugs, 'Loose equality can cause coercion bugs and unexpected branching.')
  }

  if (/eval\s*\(|new Function\s*\(/.test(normalizedCode)) {
    addUnique(securityIssues, 'Dynamic code execution can create security and maintainability risks.')
  }

  if (/innerHTML\s*=|dangerouslySetInnerHTML/.test(normalizedCode)) {
    addUnique(securityIssues, 'Direct HTML injection surfaces can lead to XSS if the content is not strictly trusted.')
  }

  if (/console\.(log|debug|info)\s*\(/.test(normalizedCode)) {
    addUnique(improvements, 'Remove debug logging before shipping to keep runtime noise low.')
  }

  if (/TODO|FIXME/i.test(normalizedCode)) {
    addUnique(improvements, 'Resolve tracked TODO/FIXME notes or turn them into explicit follow-up tasks.')
  }

  if (isReactFile && useStateMatches.length >= 5 && lines.length >= 150) {
    addUnique(codeQuality, 'This React file carries several pieces of state and likely mixes multiple responsibilities in one component.')
    addUnique(improvements, 'Extract reusable hooks or smaller components to reduce the component surface area.')
  }

  if (isReactFile && useEffectMatches.length >= 3) {
    addUnique(codeQuality, 'Multiple effects suggest the component may be coordinating too many side effects in one place.')
  }

  if (lines.length >= 250) {
    addUnique(codeQuality, 'The file is fairly large, which can make maintenance and bug isolation harder.')
    addUnique(improvements, 'Split the file into smaller modules or components to improve readability and testability.')
  }

  if (functionMatches.length >= 10) {
    addUnique(codeQuality, 'The file contains many functions, which suggests several responsibilities are bundled together.')
  }

  if (/window\.localStorage|localStorage/.test(normalizedCode) && /try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch\s*\{\s*\}/s.test(normalizedCode)) {
    addUnique(codeQuality, 'Storage errors are swallowed, which can hide persistence failures in production.')
  }

  if (bugs.length === 0 && securityIssues.length === 0 && codeQuality.length === 0 && improvements.length === 0) {
    addUnique(codeQuality, 'No strong defects were detected automatically, so this file should still be checked manually for logic edge cases.')
  }

  return {
    bugs: uniqueStrings(bugs),
    securityIssues: uniqueStrings(securityIssues),
    codeQuality: uniqueStrings(codeQuality),
    improvements: uniqueStrings(improvements),
  }
}

function mergeReviewResults(primary: ReviewResult, secondary: ReviewResult): ReviewResult {
  return {
    bugs: uniqueStrings([...primary.bugs, ...secondary.bugs]),
    securityIssues: uniqueStrings([...primary.securityIssues, ...secondary.securityIssues]),
    codeQuality: uniqueStrings([...primary.codeQuality, ...secondary.codeQuality]),
    improvements: uniqueStrings([...primary.improvements, ...secondary.improvements]),
  }
}

function buildPrompt(reviewRequest: ReviewRequest) {
  return buildReviewGuidance(reviewRequest)
}

function parseReviewJson(rawContent: string) {
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

  throw new ReviewError('Groq returned content that could not be parsed as review JSON.')
}

async function callGroqOnce(
  reviewRequest: ReviewRequest,
  model: string,
): Promise<ReviewResult> {
  const apiKey = getGroqApiKey()

  if (!apiKey) {
    return analyzeCodeHeuristics(reviewRequest)
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
            'Return only valid JSON with this exact shape: {"bugs":[],"securityIssues":[],"codeQuality":[],"improvements":[]}. No markdown. No code fences. No explanation outside JSON.',
        },
        {
          role: 'user',
          content: buildPrompt(reviewRequest),
        },
      ],
      response_format: {
        type: 'json_object',
      },
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[RepoMind AI] Groq request failed:', {
      model,
      status: response.status,
      errorText,
    })
    throw new ReviewError(`Groq request failed with status ${response.status}: ${errorText}`)
  }

  const data = (await response.json()) as GroqChatResponse
  const rawContent = data.choices?.[0]?.message?.content

  if (!rawContent) {
    console.error('[RepoMind AI] Groq returned an empty message:', { model })
    throw new ReviewError('Groq returned an empty response.')
  }

  try {
    console.error('[RepoMind AI] Groq raw output:', {
      model,
      rawContent,
    })
    return parseReviewJson(rawContent)
  } catch (error) {
    console.error('[RepoMind AI] Groq response parsing failed:', {
      model,
      rawContent,
      error: error instanceof Error ? error.message : error,
    })
    if (error instanceof ReviewError) {
      throw error
    }

    throw new ReviewError('Groq returned content that could not be parsed as review JSON.')
  }
}

async function callGroq(reviewRequest: ReviewRequest): Promise<ReviewResult> {
  const apiKey = getGroqApiKey()

  if (!apiKey) {
    return analyzeCodeHeuristics(reviewRequest)
  }

  let lastError: Error | null = null

  for (const model of groqModels) {
    try {
      return await callGroqOnce(reviewRequest, model)
    } catch (error) {
      if (error instanceof ReviewError && error.message.startsWith('Groq request failed')) {
        lastError = error
        continue
      }

      throw error
    }
  }

  throw lastError ?? new ReviewError('Groq review failed.')
}

export async function reviewCode(reviewRequest: ReviewRequest): Promise<ReviewResult> {
  const review = await callGroq(reviewRequest)
  return mergeReviewResults(review, analyzeCodeHeuristics(reviewRequest))
}
