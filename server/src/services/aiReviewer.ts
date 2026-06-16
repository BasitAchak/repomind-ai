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

type ReviewLanguage = 'python' | 'javascript' | 'typescript' | 'react' | 'json' | 'java' | 'text'

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

function detectLanguageFromExtension(filePath?: string): ReviewLanguage | null {
  const normalized = filePath?.toLowerCase() ?? ''

  if (normalized.endsWith('.py') || normalized.endsWith('.pyw')) {
    return 'python'
  }

  if (normalized.endsWith('.tsx') || normalized.endsWith('.jsx')) {
    return 'react'
  }

  if (normalized.endsWith('.ts')) {
    return 'typescript'
  }

  if (normalized.endsWith('.js')) {
    return 'javascript'
  }

  if (normalized.endsWith('.json') || isConfigFile(filePath)) {
    return 'json'
  }

  if (normalized.endsWith('.java')) {
    return 'java'
  }

  return null
}

function detectLanguageFromCode(code: string): ReviewLanguage | null {
  if (/^\s*(import\s+os|import\s+sqlite3|def\s+\w+\(|from\s+\w+\s+import\s+)/m.test(code)) {
    return 'python'
  }

  if (/^\s*[{[]/.test(code.trim())) {
    try {
      JSON.parse(code)
      return 'json'
    } catch {
      // Continue with non-JSON detection.
    }
  }

  if (/useState\s*\(|useEffect\s*\(|<[A-Z_a-z][^>]*>|from\s+['"]react['"]/.test(code)) {
    return 'react'
  }

  if (/\binterface\s+\w+|\btype\s+\w+\s*=|:\s*(string|number|boolean|unknown|any)\b/.test(code)) {
    return 'typescript'
  }

  if (/\bfunction\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|=>/.test(code)) {
    return 'javascript'
  }

  if (/public\s+class\s+\w+|public\s+static\s+void\s+main/.test(code)) {
    return 'java'
  }

  return null
}

function detectReviewLanguage(reviewRequest: ReviewRequest): ReviewLanguage {
  const requestedLanguage = reviewRequest.language.toLowerCase()
  const extensionLanguage = detectLanguageFromExtension(reviewRequest.filePath)
  const codeLanguage = detectLanguageFromCode(reviewRequest.code)

  if (extensionLanguage) {
    return extensionLanguage
  }

  if (codeLanguage) {
    return codeLanguage
  }

  if (requestedLanguage.includes('python')) {
    return 'python'
  }

  if (requestedLanguage.includes('react')) {
    return 'react'
  }

  if (requestedLanguage.includes('typescript')) {
    return 'typescript'
  }

  if (requestedLanguage.includes('javascript')) {
    return 'javascript'
  }

  if (requestedLanguage.includes('json')) {
    return 'json'
  }

  if (requestedLanguage.includes('java')) {
    return 'java'
  }

  return 'text'
}

function buildReviewGuidance(reviewRequest: ReviewRequest) {
  const filePath = reviewRequest.filePath?.trim()
  const language = reviewRequest.language.trim()
  const detectedLanguage = detectReviewLanguage(reviewRequest)
  const configReview = detectedLanguage === 'json' || isConfigFile(filePath)

  const lines = [
    'You are RepoMind AI, a strict but careful senior code reviewer.',
    'Review only the code in this request. Do not use repository summaries, previous reviews, previous files, or outside context.',
    'Review only what is present in the provided content.',
    'Do not invent issues.',
    'Do not say something is missing if it already exists.',
    'Do not stop after finding one issue.',
    'Find multiple independent issues when they exist.',
    'For intentionally buggy code, report all major problems.',
    'Return empty arrays for categories with no grounded findings.',
    'Do not label minor suggestions as bugs.',
    'Use "bugs" for runtime failures, correctness issues, broken logic, division by zero, null/undefined mistakes, bad control flow, and other behavior that can fail at runtime.',
    'Use "securityIssues" for exploitable or sensitive-data risks, including hardcoded secrets, SQL injection, command injection, path traversal, shell=True risks, unsafe eval/exec, unsafe deserialization, insecure password handling, plaintext password comparison/storage, and weak authentication/authorization logic.',
    'Use "codeQuality" for maintainability, readability, architecture, type-safety, and reliability concerns grounded in the file.',
    'Use "improvements" for concrete fixes and refactors that directly address the findings.',
    'Never mention React, hooks, components, state management, or UX unless React evidence exists in the provided code or file extension.',
    'Never mention TypeScript `any` unless the token `any` exists in the provided code.',
    'Never mention SQL injection unless SQL or query construction exists.',
    'Never mention command injection unless shell, os.system, subprocess, child_process, exec, spawn, or similar command execution exists.',
    'Never mention hardcoded secrets unless secret-like values, keys, passwords, tokens, or credentials exist.',
    'If obvious runtime, logic, or state-flow defects exist, put them in bugs even if the file also has maintainability issues.',
    'Only leave bugs empty when there are truly no correctness problems in the provided code.',
    'If there are no real security risks, securityIssues can be empty.',
    'Each non-empty finding must cite a specific code pattern from the provided file, such as a function, branch, prop, state flow, repeated block, or component structure.',
    'Keep every issue specific, grounded, and concise.',
    'Aim for up to 6 items per category, but return fewer if the evidence supports fewer.',
    'Return JSON only with this exact shape:',
    '{"bugs":[],"securityIssues":[],"codeQuality":[],"improvements":[]}',
    `User selected language: ${language}`,
    `Detected review language: ${detectedLanguage}`,
  ]

  if (filePath) {
    lines.push(`File path: ${filePath}`)
  }

  if (configReview) {
    lines.push(
      'Treat this as configuration, not executable code.',
      'For JSON/config files, focus only on configuration correctness and security settings:',
      '- invalid JSON',
      '- missing production metadata',
      '- risky permissions or settings',
      '- platform config completeness',
      '- asset path consistency',
      '- app store readiness',
      'Do not ask for runtime validation logic inside app.json.',
    )
  }

  if (detectedLanguage === 'python') {
    lines.push(
      'For Python, specifically inspect sqlite query construction, os.system, subprocess with shell=True, hardcoded secrets, missing context managers, exception handling, zero division, missing input validation, and unsafe file/path handling.',
    )
  }

  if (detectedLanguage === 'javascript' || detectedLanguage === 'typescript') {
    lines.push(
      'For JavaScript/TypeScript, inspect type safety, async handling, null/undefined handling, injection risks, and error handling.',
    )
  }

  if (detectedLanguage === 'react') {
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

function limitReviewItems(items: string[], limit = 6) {
  return uniqueStrings(items).slice(0, limit)
}

function hasReactEvidence(code: string, filePath?: string) {
  const normalizedFilePath = filePath?.toLowerCase() ?? ''

  return (
    normalizedFilePath.endsWith('.tsx') ||
    normalizedFilePath.endsWith('.jsx') ||
    /from\s+['"]react['"]|useState\s*\(|useEffect\s*\(|<[A-Z_a-z][^>]*>/.test(code)
  )
}

function hasSqlEvidence(code: string) {
  return /\b(select|insert|update|delete|drop|alter)\b|sqlite3|cursor\.execute|query\s*=/i.test(code)
}

function hasCommandExecutionEvidence(code: string) {
  return /os\.system|subprocess\.|shell\s*=\s*True|child_process|exec\s*\(|spawn\s*\(|system\s*\(/i.test(code)
}

function hasSecretEvidence(code: string) {
  return (
    /(api[_-]?key|secret|token|password|credential)\s*=\s*["'`][^"'`]{6,}["'`]/i.test(code) ||
    /\b(sk|ghp|github_pat|xoxb|AKIA)[A-Za-z0-9_\-]{8,}\b/.test(code)
  )
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
  const detectedLanguage = detectReviewLanguage(reviewRequest)
  const isPythonFile =
    detectedLanguage === 'python'
  const isJsonOrConfigFile =
    detectedLanguage === 'json' || isConfigFile(filePath)
  const isTypeScriptLike =
    detectedLanguage === 'typescript' || detectedLanguage === 'react'
  const isReactFile =
    detectedLanguage === 'react' && hasReactEvidence(normalizedCode, filePath)

  const addUnique = (bucket: string[], value: string) => {
    if (!bucket.includes(value)) {
      bucket.push(value)
    }
  }

  if (isJsonOrConfigFile) {
    try {
      JSON.parse(normalizedCode)
    } catch {
      addUnique(bugs, 'The JSON/config content is invalid and cannot be parsed reliably.')
      addUnique(improvements, 'Fix the JSON syntax before using this configuration.')
    }

    if (hasSecretEvidence(normalizedCode)) {
      addUnique(securityIssues, 'The config appears to contain a secret-like value that should not be committed.')
      addUnique(improvements, 'Move secrets out of config files and into environment variables or a secrets manager.')
    }

    return {
      bugs: limitReviewItems(bugs),
      securityIssues: limitReviewItems(securityIssues),
      codeQuality: [],
      improvements: limitReviewItems(improvements),
    }
  }

  const functionMatches = normalizedCode.match(/\bfunction\b|\=\>\s*\{/g) ?? []
  const useStateMatches = normalizedCode.match(/\buseState\s*\(/g) ?? []
  const useEffectMatches = normalizedCode.match(/\buseEffect\s*\(/g) ?? []

  if (isTypeScriptLike && /\bany\b/.test(normalizedCode)) {
    addUnique(bugs, 'Unsafe `any` usage can hide type errors and let runtime bugs slip through.')
    addUnique(codeQuality, 'Type safety is weakened by `any`, which makes runtime regressions easier to miss.')
  }

  if (isTypeScriptLike && (/as\s+any\b/.test(normalizedCode) || /\/\/\s*@ts-ignore/.test(normalizedCode))) {
    addUnique(codeQuality, 'Type assertions or ignores are suppressing the compiler instead of fixing the underlying type issue.')
  }

  if (/catch\s*\(\s*[^)]*\s*\)\s*\{\s*\}/s.test(normalizedCode) || /catch\s*\{\s*\}/s.test(normalizedCode)) {
    addUnique(bugs, 'Empty `catch` blocks swallow failures and can hide broken async or state-update flows.')
    addUnique(codeQuality, 'Empty error handling hides real failures and makes the control flow hard to trust.')
    addUnique(improvements, 'Return or surface the error instead of silently swallowing it.')
  }

  if (
    hasSecretEvidence(normalizedCode) ||
    /password\s*=\s*["'`][^"'`]{4,}["'`]/i.test(normalizedCode) ||
    /const\s+\w*password\w*\s*=\s*["'`][^"'`]{4,}["'`]/i.test(normalizedCode) ||
    /["'`][^"'`]{4,}["'`]\s*===?\s*\w*password\w*/i.test(normalizedCode)
  ) {
    addUnique(bugs, 'Hardcoded password-like values create a serious authentication and credential-management bug.')
    addUnique(securityIssues, 'Credentials are embedded directly in code, which is unsafe and can leak sensitive access secrets.')
    addUnique(improvements, 'Move credentials into secure authentication/session handling and store secrets outside the source code.')
  }

  if (isPythonFile && hasSecretEvidence(normalizedCode)) {
    addUnique(bugs, 'A hardcoded secret or API key is stored directly in the source code.')
    addUnique(securityIssues, 'Secrets should not be embedded in code because they can leak into source control and logs.')
    addUnique(improvements, 'Load secrets from environment variables or a secrets manager instead of hardcoding them.')
  }

  if (
    hasSqlEvidence(normalizedCode) &&
    /f["'].*(select|insert|update|delete|drop|alter).*{.*}.*["']/is.test(normalizedCode) ||
    /query\s*=\s*f["'][\s\S]*(select|insert|update|delete|drop|alter)[\s\S]*{[\s\S]+}/i.test(normalizedCode) ||
    /cursor\.execute\s*\(\s*query\s*\)/i.test(normalizedCode) && /\bf["']/.test(normalizedCode)
  ) {
    addUnique(bugs, 'SQL is being constructed with user-controlled string interpolation, which is vulnerable to SQL injection.')
    addUnique(securityIssues, 'Use parameterized queries instead of interpolated SQL to prevent SQL injection.')
    addUnique(improvements, 'Bind query parameters with placeholders rather than building SQL strings manually.')
  }

  if (
    isPythonFile &&
    /sqlite3\.connect\(/i.test(normalizedCode) &&
    /cursor\.execute\(\s*query\s*\)/i.test(normalizedCode) &&
    /password/i.test(normalizedCode)
  ) {
    addUnique(codeQuality, 'The login flow mixes password handling directly into SQL access, which is brittle and unsafe.')
  }

  if (
    hasCommandExecutionEvidence(normalizedCode) &&
    /os\.system\s*\(/i.test(normalizedCode) ||
    /subprocess\.(call|run|popen|check_call|check_output)\s*\(/i.test(normalizedCode)
  ) {
    addUnique(bugs, 'Shell commands are built from raw input, which can lead to command injection.')
    addUnique(securityIssues, 'Avoid shell command execution with untrusted input because it can be exploited to run arbitrary commands.')
    addUnique(improvements, 'Use safer APIs with argument arrays and sanitize or validate all user-controlled path input.')
  }

  if (isPythonFile && /shell\s*=\s*True/i.test(normalizedCode)) {
    addUnique(securityIssues, 'Using `shell=True` exposes the command to shell injection when any part of the command is user-controlled.')
    addUnique(bugs, 'Running subprocess commands with `shell=True` makes command injection much easier to exploit.')
  }

  if (hasCommandExecutionEvidence(normalizedCode) && /path\s*\+\s*["'`].*|["'`].*\+\s*path/i.test(normalizedCode) && /(os\.system|subprocess\.)/i.test(normalizedCode)) {
    addUnique(improvements, 'Avoid string concatenation for shell commands; pass arguments explicitly and validate file paths.')
  }

  if (/(\breturn\s+)?[A-Za-z_][\w.]*\s*\/\s*[A-Za-z_][\w.]*\b/.test(normalizedCode) && !/if\s+.*==\s*0|if\s+.*!=\s*0|if\s+.*<=\s*0/.test(normalizedCode)) {
    addUnique(bugs, 'Division can fail with a zero denominator because there is no visible guard against zero.')
    addUnique(improvements, 'Validate the divisor before dividing and return a controlled error when it is zero.')
  }

  if (
    isPythonFile &&
    /(input|username|password|filename|path|query|filename)\s*[=,]/i.test(normalizedCode) &&
    !/if\s+.*(username|password|filename|path|query)/i.test(normalizedCode)
  ) {
    addUnique(codeQuality, 'User-controlled inputs appear to flow directly into sensitive operations without validation.')
    addUnique(improvements, 'Validate and normalize user input before using it in database or filesystem operations.')
  }

  if (/(login|signin|signIn|authenticate|auth)\s*\(/i.test(normalizedCode) && /password/i.test(normalizedCode)) {
    addUnique(bugs, 'The authentication flow appears to rely on plaintext password handling instead of proper auth/session logic.')
    addUnique(securityIssues, 'Passwords should not be compared or stored as plaintext in application logic or SQL strings.')
    addUnique(codeQuality, 'Authentication logic is oversimplified and likely needs a dedicated auth/session layer.')
  }

  if (
    /(login|signin|signIn|authenticate|auth)\s*\(/i.test(normalizedCode) &&
    /return\s+true/i.test(normalizedCode) &&
    /password|token|session/i.test(normalizedCode)
  ) {
    addUnique(bugs, 'The login flow appears to use a direct boolean password check instead of proper authentication/session handling.')
    addUnique(codeQuality, 'Authentication logic is oversimplified and likely needs a dedicated auth/session layer.')
  }

  if ((detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || isReactFile) && /setInterval\s*\(/.test(normalizedCode) && /useEffect\s*\(/.test(normalizedCode) && !/clearInterval\s*\(/.test(normalizedCode)) {
    addUnique(bugs, '`setInterval` is created without cleanup, so the timer can leak when the component unmounts.')
  }

  if ((detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || isReactFile) && /addEventListener\s*\(/.test(normalizedCode) && /useEffect\s*\(/.test(normalizedCode) && !/removeEventListener\s*\(/.test(normalizedCode)) {
    addUnique(bugs, 'Event listeners are registered without cleanup, which can create duplicate handlers or leaks.')
  }

  if ((detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || isReactFile) && /fetch\s*\(/.test(normalizedCode) && !/response\.ok/.test(normalizedCode) && !/status/.test(normalizedCode)) {
    addUnique(bugs, '`fetch` calls do not check the HTTP status, so failed requests may be treated as successful responses.')
    addUnique(improvements, 'Check `response.ok` and surface request failures to the user.')
  }

  if (/(^|[^=!])==([^=]|$)/.test(normalizedCode) || /(^|[^=!])!=([^=]|$)/.test(normalizedCode)) {
    addUnique(bugs, 'Loose equality can cause coercion bugs and unexpected branching.')
  }

  if (/eval\s*\(|new Function\s*\(|exec\s*\(/.test(normalizedCode)) {
    addUnique(securityIssues, 'Dynamic code execution can create security and maintainability risks.')
  }

  if (isPythonFile && /pickle\.loads\s*\(|yaml\.load\s*\(/i.test(normalizedCode) && /request|input|payload|data/i.test(normalizedCode)) {
    addUnique(securityIssues, 'Unsafe deserialization can execute attacker-controlled data or corrupt application state.')
  }

  if ((detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || isReactFile) && /innerHTML\s*=|dangerouslySetInnerHTML/.test(normalizedCode)) {
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

  if ((detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || isReactFile) && /window\.localStorage|localStorage/.test(normalizedCode) && /try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch\s*\{\s*\}/s.test(normalizedCode)) {
    addUnique(codeQuality, 'Storage errors are swallowed, which can hide persistence failures in production.')
  }

  return {
    bugs: limitReviewItems(bugs),
    securityIssues: limitReviewItems(securityIssues),
    codeQuality: limitReviewItems(codeQuality),
    improvements: limitReviewItems(improvements),
  }
}

function mergeReviewResults(primary: ReviewResult, secondary: ReviewResult): ReviewResult {
  return {
    bugs: limitReviewItems([...primary.bugs, ...secondary.bugs]),
    securityIssues: limitReviewItems([...primary.securityIssues, ...secondary.securityIssues]),
    codeQuality: limitReviewItems([...primary.codeQuality, ...secondary.codeQuality]),
    improvements: limitReviewItems([...primary.improvements, ...secondary.improvements]),
  }
}

function filterUnsupportedFindings(reviewRequest: ReviewRequest, review: ReviewResult): ReviewResult {
  const code = reviewRequest.code
  const detectedLanguage = detectReviewLanguage(reviewRequest)
  const reactEvidence = hasReactEvidence(code, reviewRequest.filePath)
  const sqlEvidence = hasSqlEvidence(code)
  const commandEvidence = hasCommandExecutionEvidence(code)
  const secretEvidence = hasSecretEvidence(code)
  const anyEvidence = /\bany\b/.test(code)
  const configReview = detectedLanguage === 'json' || isConfigFile(reviewRequest.filePath)

  const isSupported = (item: string) => {
    const lowerItem = item.toLowerCase()

    if (/^no\b/.test(lowerItem) || lowerItem.includes('no issues found')) {
      return false
    }

    if (!reactEvidence && /\breact\b|hook|component|state management|usestate|useeffect|props?\b|jsx|tsx/.test(lowerItem)) {
      return false
    }

    if (!anyEvidence && /unsafe `?any`?|type safety is weakened by `?any`?/.test(lowerItem)) {
      return false
    }

    if (!sqlEvidence && /sql injection|sql|query|sqlite|cursor/.test(lowerItem)) {
      return false
    }

    if (!commandEvidence && /command injection|shell=true|shell command|subprocess|os\.system|child_process|exec|spawn/.test(lowerItem)) {
      return false
    }

    if (!secretEvidence && /hardcoded secret|hardcoded credential|api key|token|credential|password-like|secret-like/.test(lowerItem)) {
      return false
    }

    if (configReview) {
      return /json|config|configuration|secret|permission|metadata|asset|parse|syntax|environment|setting/.test(lowerItem)
    }

    return true
  }

  return {
    bugs: limitReviewItems(review.bugs.filter(isSupported)),
    securityIssues: limitReviewItems(review.securityIssues.filter(isSupported)),
    codeQuality: limitReviewItems(review.codeQuality.filter(isSupported)),
    improvements: limitReviewItems(review.improvements.filter(isSupported)),
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
  const merged = mergeReviewResults(review, analyzeCodeHeuristics(reviewRequest))
  return filterUnsupportedFindings(reviewRequest, merged)
}
