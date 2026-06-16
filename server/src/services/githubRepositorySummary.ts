import { fetchGitHubProjectInfo, GitHubProjectInfoError, type GitHubProjectInfoResult } from './githubProjectInfo'
import { fetchGitHubTree, GitHubTreeError, type GitHubTreeResult } from './githubTree'

export type GitHubRepositorySummaryResult = {
  projectType: string
  architecture: string[]
  keyFeatures: string[]
  importantFiles: string[]
  reviewPriority: 'Low' | 'Medium' | 'High'
  summary: string
}

class GitHubRepositorySummaryError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'GitHubRepositorySummaryError'
    this.statusCode = statusCode
  }
}

const groqModels = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'] as const

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
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

function toLowerSet(values: string[]) {
  return new Set(values.map((value) => value.toLowerCase()))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function hasAnyKeyword(text: string, keywords: string[]) {
  const lowerText = text.toLowerCase()
  return keywords.some((keyword) => lowerText.includes(keyword))
}

function detectArchitecture(projectInfo: GitHubProjectInfoResult) {
  const dependencyNames = toLowerSet([
    ...projectInfo.dependencies,
    ...projectInfo.devDependencies,
  ])
  const projectTypes = toLowerSet(projectInfo.projectTypes)

  const architecture: string[] = []

  const hasDependency = (...names: string[]) => names.some((name) => dependencyNames.has(name))
  const hasProjectType = (...names: string[]) => names.some((name) => projectTypes.has(name))

  if (hasDependency('expo-router') || hasProjectType('expo router')) {
    architecture.push('File-based routing')
  }

  if (hasDependency('firebase') || hasProjectType('firebase')) {
    architecture.push('Firebase backend')
  }

  if (hasDependency('zustand')) {
    architecture.push('Zustand state management')
  }

  if (hasDependency('react-native') || hasProjectType('react native')) {
    architecture.push('React Native mobile application')
  }

  if (hasDependency('express') || hasProjectType('express')) {
    architecture.push('Express API server')
  }

  if (hasDependency('@supabase/supabase-js', 'supabase') || hasProjectType('supabase')) {
    architecture.push('Supabase backend')
  }

  if (hasProjectType('next.js')) {
    architecture.push('Next.js application')
  }

  if (hasProjectType('vite')) {
    architecture.push('Vite build setup')
  }

  if (hasProjectType('react')) {
    architecture.push('React UI layer')
  }

  return unique(architecture)
}

function scoreImportantFile(path: string) {
  const lowerPath = path.toLowerCase()
  const fileName = lowerPath.split('/').pop() ?? lowerPath

  const scoredPatterns: Array<[number, string[]]> = [
    [120, ['auth', 'login', 'signup', 'signin', 'register']],
    [110, ['payment', 'billing', 'checkout', 'invoice']],
    [105, ['admin']],
    [100, ['firebase']],
    [100, ['supabase']],
    [95, ['profile']],
    [90, ['user']],
    [85, ['api']],
    [82, ['service']],
    [78, ['settings']],
    [75, ['config']],
  ]

  let score = 0

  if (fileName === 'package.json' || fileName === 'app.json') {
    score += 115
  }

  if (fileName.includes('config')) {
    score += 75
  }

  if (fileName.endsWith('.tsx') || fileName.endsWith('.ts')) {
    score += 12
  }

  for (const [value, keywords] of scoredPatterns) {
    if (hasAnyKeyword(lowerPath, keywords)) {
      score = Math.max(score, value)
    }
  }

  if (lowerPath.includes('src/') || lowerPath.startsWith('src')) {
    score += 10
  }

  return score
}

function detectImportantFiles(tree: GitHubTreeResult) {
  const ranked = tree.files
    .map((file) => ({
      path: file.path,
      score: scoreImportantFile(file.path),
    }))
    .filter((file) => file.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))

  const topFiles = ranked.slice(0, 10).map((file) => file.path)

  if (topFiles.length > 0) {
    return topFiles
  }

  return tree.files.slice(0, 10).map((file) => file.path)
}

function detectReviewPriority(importantFiles: string[], tree: GitHubTreeResult) {
  const priorityText = importantFiles.join(' ').toLowerCase()

  if (hasAnyKeyword(priorityText, ['auth', 'login', 'signup', 'payment', 'billing', 'admin'])) {
    return 'High' as const
  }

  if (
    hasAnyKeyword(priorityText, ['profile', 'settings', 'data']) ||
    tree.files.some((file) => hasAnyKeyword(file.path, ['profile', 'settings', 'data']))
  ) {
    return 'Medium' as const
  }

  return 'Low' as const
}

function detectKeyFeatures(projectInfo: GitHubProjectInfoResult, importantFiles: string[]) {
  const dependencyNames = toLowerSet([
    ...projectInfo.dependencies,
    ...projectInfo.devDependencies,
  ])
  const scripts = projectInfo.scripts.map((script) => script.toLowerCase())
  const fileText = importantFiles.join(' ').toLowerCase()

  const features: string[] = []
  const add = (value: string) => {
    if (!features.includes(value)) {
      features.push(value)
    }
  }

  if (hasAnyKeyword(fileText, ['auth', 'login', 'signup', 'signin', 'register'])) {
    add('Authentication flows')
  }

  if (hasAnyKeyword(fileText, ['profile', 'user'])) {
    add('Profile and account management')
  }

  if (hasAnyKeyword(fileText, ['payment', 'billing', 'checkout'])) {
    add('Payments and billing')
  }

  if (hasAnyKeyword(fileText, ['admin'])) {
    add('Admin controls')
  }

  if (hasAnyKeyword(fileText, ['api', 'service'])) {
    add('API and service layer')
  }

  if (hasAnyKeyword(fileText, ['config'])) {
    add('Configuration and environment setup')
  }

  if (dependencyNames.has('firebase')) {
    add('Firebase integration')
  }

  if (dependencyNames.has('@supabase/supabase-js') || dependencyNames.has('supabase')) {
    add('Supabase integration')
  }

  if (dependencyNames.has('expo-router')) {
    add('Routing and screen organization')
  }

  if (dependencyNames.has('react-native')) {
    add('Mobile app screens')
  }

  if (scripts.some((script) => script.includes('build') || script.includes('dev') || script.includes('start'))) {
    add('Development and build scripts')
  }

  if (features.length === 0) {
    add('Core application logic')
  }

  return features
}

function buildProjectType(projectInfo: GitHubProjectInfoResult) {
  if (projectInfo.projectTypes.length === 0) {
    return 'Unknown'
  }

  return projectInfo.projectTypes.join(' / ')
}

function buildFallbackSummary(
  projectType: string,
  architecture: string[],
  keyFeatures: string[],
  importantFiles: string[],
  reviewPriority: 'Low' | 'Medium' | 'High',
) {
  const architectureText =
    architecture.length > 0 ? architecture.slice(0, 3).join(', ') : 'straightforward project structure'
  const featureText =
    keyFeatures.length > 0 ? keyFeatures.slice(0, 2).join(', ') : 'core application flows'
  const fileText =
    importantFiles.length > 0 ? importantFiles.slice(0, 3).join(', ') : 'the main source files'

  return `${projectType} project with ${architectureText}. Focus first on ${featureText} in ${fileText}. Review priority is ${reviewPriority}.`
}

async function callGroqOnce(prompt: string, model: string): Promise<string> {
  const apiKey = getGroqApiKey()

  if (!apiKey) {
    throw new GitHubRepositorySummaryError(503, 'Groq is not configured.')
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
              'Return only valid JSON with this exact shape: {"summary":""}. No markdown. No code fences. No explanation outside JSON.',
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
    throw new GitHubRepositorySummaryError(502, 'Network error while contacting Groq.')
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new GitHubRepositorySummaryError(
      502,
      `Groq request failed with status ${response.status}: ${errorText}`,
    )
  }

  const data = (await response.json()) as GroqChatResponse
  const rawContent = data.choices?.[0]?.message?.content

  if (!rawContent) {
    throw new GitHubRepositorySummaryError(502, 'Groq returned an empty response.')
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
      const parsed = JSON.parse(attempt) as { summary?: unknown }
      if (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
        return parsed.summary.trim()
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new GitHubRepositorySummaryError(502, 'Groq returned content that could not be parsed.')
}

function buildSummaryPrompt(
  projectType: string,
  architecture: string[],
  keyFeatures: string[],
  importantFiles: string[],
  reviewPriority: 'Low' | 'Medium' | 'High',
) {
  return [
    'You are RepoMind AI generating a concise repository overview for a developer.',
    'Use only the provided metadata and keep the summary grounded in it.',
    'Write 2 sentences maximum.',
    'Explain what the project is and where a developer should focus attention first.',
    'Return JSON only with this exact shape: {"summary":""}',
    `Project type: ${projectType}`,
    `Architecture: ${architecture.join(', ') || 'None detected'}`,
    `Key features: ${keyFeatures.join(', ') || 'None detected'}`,
    `Important files: ${importantFiles.join(', ') || 'None detected'}`,
    `Review priority: ${reviewPriority}`,
  ].join('\n')
}

async function generateSummaryText(
  projectType: string,
  architecture: string[],
  keyFeatures: string[],
  importantFiles: string[],
  reviewPriority: 'Low' | 'Medium' | 'High',
) {
  const prompt = buildSummaryPrompt(projectType, architecture, keyFeatures, importantFiles, reviewPriority)

  for (const model of groqModels) {
    try {
      return await callGroqOnce(prompt, model)
    } catch (error) {
      if (error instanceof GitHubRepositorySummaryError && error.message.startsWith('Groq request failed')) {
        continue
      }

      if (error instanceof GitHubRepositorySummaryError && error.message === 'Groq is not configured.') {
        break
      }
    }
  }

  return buildFallbackSummary(projectType, architecture, keyFeatures, importantFiles, reviewPriority)
}

export async function fetchGitHubRepositorySummary(url: string): Promise<GitHubRepositorySummaryResult> {
  try {
    const [projectInfo, tree] = await Promise.all([
      fetchGitHubProjectInfo(url),
      fetchGitHubTree(url),
    ])

    const projectType = buildProjectType(projectInfo)
    const architecture = detectArchitecture(projectInfo)
    const importantFiles = detectImportantFiles(tree)
    const keyFeatures = detectKeyFeatures(projectInfo, importantFiles)
    const reviewPriority = detectReviewPriority(importantFiles, tree)
    const summary = await generateSummaryText(
      projectType,
      architecture,
      keyFeatures,
      importantFiles,
      reviewPriority,
    )

    return {
      projectType,
      architecture,
      keyFeatures,
      importantFiles,
      reviewPriority,
      summary,
    }
  } catch (error) {
    if (error instanceof GitHubProjectInfoError) {
      throw new GitHubRepositorySummaryError(error.statusCode, error.message)
    }

    if (error instanceof GitHubTreeError) {
      throw new GitHubRepositorySummaryError(error.statusCode, error.message)
    }

    if (error instanceof GitHubRepositorySummaryError) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'Failed to generate repository summary.'
    throw new GitHubRepositorySummaryError(502, message)
  }
}

export { GitHubRepositorySummaryError }
