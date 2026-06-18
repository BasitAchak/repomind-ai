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

export type ReviewProvider = 'groq' | 'mock'

export type ReviewDebugMetadata = {
  language: string
  filePath: string | null
  codeLength: number
  codePreview: string
  provider: ReviewProvider
  detectedLanguage: ReviewLanguage
}

export type ReviewExecutionResult = {
  review: ReviewResult
  debug: ReviewDebugMetadata
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
    'Use "bugs" for runtime failures and correctness issues grounded in the file.',
    'Use "securityIssues" for exploitable or sensitive-data risks grounded in the file.',
    'Use "codeQuality" for maintainability, readability, architecture, type-safety, and reliability concerns grounded in the file.',
    'Use "improvements" for concrete fixes and refactors that directly address the findings.',
    'Never mention React, hooks, components, state management, or UX unless React evidence exists in the provided code or file extension.',
    'Never mention TypeScript `any` unless the token `any` exists in the provided code.',
    'Never mention SQL, queries, or database issues unless SQL/query/database code exists.',
    'Never mention command execution unless shell, os.system, subprocess, child_process, exec, spawn, or similar command execution exists.',
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
      'For Python, focus on runtime errors, unsafe process execution, credential handling, database access, exception handling, input validation, and file/path safety.',
    )
  }

  if (detectedLanguage === 'javascript' || detectedLanguage === 'typescript') {
    lines.push(
      'For JavaScript/TypeScript, focus on type safety, async handling, null/undefined handling, injection risks, and error handling.',
    )
  }

  if (detectedLanguage === 'react') {
    lines.push(
      'For React/React Native UI files, focus on structure, state flow, side effects, loading and error handling, and opportunities to simplify dense sections.',
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

/**
 * Strip single-line (//) and multi-line (/* *\/) comments from code before
 * running regex heuristics. This prevents comment text from triggering false
 * positives (e.g. the word "any" or "auth" appearing in a comment).
 */
function stripComments(code: string): string {
  // Remove block comments first, then line comments
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/**
 * FIX: Check whether `any` is used as an actual TypeScript type annotation,
 * not just as a word appearing anywhere in the file (e.g. in comments,
 * strings, or identifiers like `cancelAllDealReminders`).
 *
 * Matches patterns like: `: any`, `as any`, `<any>`, `any[]`, `any,`, `any)`
 * but NOT words like "company", "many", "cancelAll", etc.
 */
function hasAnyTypeUsage(code: string): boolean {
  const stripped = stripComments(code)
  // Remove string literals to avoid matching "any" inside strings
  const noStrings = stripped
    .replace(/`[^`]*`/g, '""')
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
  return /(?::\s*any\b|as\s+any\b|<any>|any\[\]|,\s*any\b|\(\s*any\b)/.test(noStrings)
}

/**
 * FIX: Check for actual arithmetic division (e.g. `a / b`, `count / total`)
 * rather than matching the `/` character in route strings like `/(auth)/sign-in`
 * or regex literals.
 *
 * Requires both sides of `/` to be identifier-like tokens (no leading `'`, `"`,
 * `` ` ``, `(` from a route group, or whitespace-only context).
 */
function hasDivisionEvidence(code: string): boolean {
  const stripped = stripComments(code)
  // Remove string literals first so route paths don't match
  const noStrings = stripped
    .replace(/`[^`]*`/g, '""')
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
  // Match identifier / identifier but not things like /(route) or */
  return /\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\/\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\b/.test(noStrings)
}

/**
 * FIX: Check that auth-related and password-related patterns appear in close
 * proximity (same function body), not just anywhere in the file independently.
 * This prevents false positives where `useAuth()` and a `password` parameter
 * exist in unrelated parts of a well-structured file.
 *
 * Strategy: extract blocks that look like function bodies (~20 lines), then
 * check if both patterns co-occur within the same block.
 */
function hasColocatedAuthAndPassword(code: string): boolean {
  const stripped = stripComments(code)
  // Split into chunks of ~20 lines and test each chunk
  const lines = stripped.split('\n')
  const windowSize = 20
  for (let i = 0; i < lines.length; i += Math.floor(windowSize / 2)) {
    const chunk = lines.slice(i, i + windowSize).join('\n')
    const hasAuth = /(login|signin|signIn|authenticate)\s*\(/i.test(chunk)
    const hasPassword = /\bpassword\b/i.test(chunk)
    if (hasAuth && hasPassword) {
      return true
    }
  }
  return false
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

  // FIX: use hasAnyTypeUsage() instead of the broad /\bany\b/ regex which
  // matched the word "any" in comments, strings, and identifiers.
  if (isTypeScriptLike && hasAnyTypeUsage(normalizedCode)) {
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

  // FIX: use hasDivisionEvidence() which strips comments and string literals
  // before matching, preventing route strings like `/(auth)/sign-in` from
  // triggering a false "division by zero" finding.
  // Also gate to languages where arithmetic division is a real runtime concern;
  // skip JSON/config files entirely since they never execute arithmetic.
  if (
    !isJsonOrConfigFile &&
    (isPythonFile || detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || isReactFile) &&
    hasDivisionEvidence(normalizedCode) &&
    !/if\s+.*==\s*0|if\s+.*!=\s*0|if\s+.*<=\s*0/.test(normalizedCode)
  ) {
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

  // FIX: use hasColocatedAuthAndPassword() instead of two independent regex
  // checks. The old approach matched `useAuth()` for the auth pattern and a
  // separate `password` param elsewhere in the file, producing false positives
  // on well-structured code like the profile screen. Now both patterns must
  // appear within the same ~20-line window (i.e. the same function body).
  // Also skip JSON/config files — they never contain executable auth logic.
  if (!isJsonOrConfigFile && hasColocatedAuthAndPassword(normalizedCode)) {
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

  // Loose equality (== / !=) is only a bug pattern in JavaScript/TypeScript.
  // Python uses == for value comparison intentionally — do not flag it there.
  if (
    (detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || isReactFile) &&
    (/(^|[^=!])==([^=]|$)/.test(normalizedCode) || /(^|[^=!])!=([^=]|$)/.test(normalizedCode))
  ) {
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

function isReactSpecificFinding(item: string) {
  return /(?:\breact\b|\bhooks?\b|\bcomponents?\b|component responsibilities|state management|\buseState\b|\buseEffect\b|\bprops?\b|prop drilling|\bjsx\b|\btsx\b|\bfrontend\b|\bui\b|extract reusable hooks)/i.test(
    item,
  )
}

function isTypeScriptSpecificFinding(item: string) {
  return /(?:\btypescript\b|\btsconfig\b|unsafe `?any`?|type safety|type assertions?|@ts-ignore|\bany usage\b|type safety is weakened by `?any`?|\bgenerics?\b)/i.test(
    item,
  )
}

function isPythonSpecificFinding(item: string) {
  return /(?:\bpython\b|\bpythonic\b|\bpep 8\b|\bpep8\b|\bvenv\b|\bvirtualenv\b|\bpip\b|\bpytest\b|\bsqlite\b|\bsubprocess\b|os\.system|\basyncio\b|\bpickle\b|\byaml\b)/i.test(
    item,
  )
}

function isDivisionSpecificFinding(item: string) {
  return /(?:division by zero|zero denominator|divide by zero|divisor|numerator|denominator)/i.test(item)
}

function filterUnsupportedFindings(reviewRequest: ReviewRequest, review: ReviewResult): ReviewResult {
  const code = reviewRequest.code
  const detectedLanguage = detectReviewLanguage(reviewRequest)
  const reactEvidence = hasReactEvidence(code, reviewRequest.filePath)
  const sqlEvidence = hasSqlEvidence(code)
  const commandEvidence = hasCommandExecutionEvidence(code)
  const secretEvidence = hasSecretEvidence(code)
  // FIX: use the precise hasAnyTypeUsage() check here too, so the filter
  // stays consistent with the heuristic that produced the finding.
  const anyEvidence = hasAnyTypeUsage(code)
  const configReview = detectedLanguage === 'json' || isConfigFile(reviewRequest.filePath)
  const pythonEvidence = detectedLanguage === 'python'
  // FIX: use hasDivisionEvidence() for consistent filtering
  const divisionEvidence = hasDivisionEvidence(code)

  const isSupported = (item: string) => {
    const lowerItem = item.toLowerCase()

    if (/^no\b/.test(lowerItem) || lowerItem.includes('no issues found')) {
      return false
    }

    if (!reactEvidence && isReactSpecificFinding(lowerItem)) {
      return false
    }

    if (detectedLanguage !== 'typescript' && detectedLanguage !== 'react' && isTypeScriptSpecificFinding(lowerItem)) {
      return false
    }

    if (!anyEvidence && /unsafe `?any`?|type safety is weakened by `?any`?|type safety.*any usage/i.test(lowerItem)) {
      return false
    }

    if (!pythonEvidence && isPythonSpecificFinding(lowerItem)) {
      return false
    }

    if (!sqlEvidence && /sql injection|sql|query|sqlite|cursor/.test(lowerItem)) {
      return false
    }

    if (!commandEvidence && /command injection|shell=true|shell command|subprocess|os\.system|child_process|exec|spawn/.test(lowerItem)) {
      return false
    }

    if (!divisionEvidence && isDivisionSpecificFinding(lowerItem)) {
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

function buildReviewDebugMetadata(
  reviewRequest: ReviewRequest,
  provider: ReviewProvider,
): ReviewDebugMetadata {
  return {
    language: reviewRequest.language,
    filePath: reviewRequest.filePath ?? null,
    codeLength: reviewRequest.code.length,
    codePreview: reviewRequest.code.slice(0, 300),
    provider,
    detectedLanguage: detectReviewLanguage(reviewRequest),
  }
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
  prompt: string,
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
          content: prompt,
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

/**
 * Determines whether an error from Groq is a transient failure that is safe
 * to retry (5xx server errors, rate limits, network issues) vs. a permanent
 * client error (4xx bad request, invalid API key) that should not be retried.
 */
function isRetryableGroqError(error: unknown): boolean {
  if (!(error instanceof ReviewError)) return false
  // Match status codes in the error message: retry 429, 500, 502, 503, 504
  const match = error.message.match(/status (\d{3})/)
  if (!match) {
    // Network-level errors (no status code) are also retryable
    return error.message.startsWith('Groq request failed')
  }
  const status = parseInt(match[1], 10)
  return status === 429 || status >= 500
}

/**
 * Calls Groq once per model with automatic retries on transient failures.
 * Uses exponential backoff: 500ms, 1000ms, 2000ms between attempts.
 * Falls back to heuristics (instead of throwing) if all attempts fail, so
 * the user always gets a review result rather than an error screen.
 */
async function callGroq(reviewRequest: ReviewRequest): Promise<ReviewResult> {
  const apiKey = getGroqApiKey()

  if (!apiKey) {
    return analyzeCodeHeuristics(reviewRequest)
  }

  const prompt = buildPrompt(reviewRequest)
  const MAX_RETRIES = 3
  const BASE_DELAY_MS = 500

  for (const model of groqModels) {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await callGroqOnce(reviewRequest, model, prompt)
      } catch (error) {
        if (isRetryableGroqError(error)) {
          lastError = error instanceof Error ? error : new ReviewError(String(error))
          // Exponential backoff: 500ms, 1000ms, 2000ms
          const delay = BASE_DELAY_MS * Math.pow(2, attempt)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        // Non-retryable error (e.g. 400 bad request, parse failure): break
        // out of the retry loop and try the next model
        lastError = error instanceof Error ? error : new ReviewError(String(error))
        break
      }
    }

    // Log the failure for this model and try the next one
    console.error(`[RepoMind AI] Model ${model} failed after ${MAX_RETRIES} attempts:`, lastError?.message)
  }

  // All models exhausted — fall back to heuristics so the user still gets a
  // result instead of an error screen. This is the key fix: previously this
  // threw an error which the server caught and returned as a 502, causing the
  // client to show nothing and requiring the user to click again manually.
  console.warn('[RepoMind AI] All Groq models failed. Falling back to heuristic analysis.')
  return analyzeCodeHeuristics(reviewRequest)
}

export async function reviewCode(reviewRequest: ReviewRequest): Promise<ReviewResult> {
  const execution = await reviewCodeWithMetadata(reviewRequest)
  return execution.review
}

export async function reviewCodeWithMetadata(
  reviewRequest: ReviewRequest,
): Promise<ReviewExecutionResult> {
  const apiKey = getGroqApiKey()
  const review = await callGroq(reviewRequest)
  const hasFilePath = typeof reviewRequest.filePath === 'string' && reviewRequest.filePath.trim().length > 0

  // Pasted code does not carry a repository path, so the model gets less
  // context than a GitHub file review. Keep a heuristic assist for that case to
  // avoid empty-looking results when Groq is overly conservative.
  //
  // For repo-file reviews we still avoid merging heuristics when Groq is
  // available, so the existing GitHub flow stays grounded and less noisy.
  //
  // FIX: When there is no API key, callGroq() already returns analyzeCodeHeuristics()
  // directly. Merging heuristics again here doubled up every finding, producing
  // noisy and inflated results. Only merge the heuristic boost when Groq actually
  // ran (apiKey is present) AND the review is for pasted code (no filePath).
  const shouldMergeHeuristics = apiKey != null && !hasFilePath
  const mergedSource = shouldMergeHeuristics
    ? mergeReviewResults(review, analyzeCodeHeuristics(reviewRequest))
    : review
  const merged = filterUnsupportedFindings(reviewRequest, mergedSource)

  const provider: ReviewProvider = apiKey ? 'groq' : 'mock'

  return {
    review: merged,
    debug: buildReviewDebugMetadata(reviewRequest, provider),
  }
}
