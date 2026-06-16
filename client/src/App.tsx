import { useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
import { API_URL } from './lib/api'

type ReviewResult = {
  bugs: string[]
  securityIssues: string[]
  codeQuality: string[]
  improvements: string[]
}

type Mode = 'code' | 'github'

const languageOptions = ['JavaScript', 'TypeScript', 'Python', 'Java'] as const

const defaultReview: ReviewResult = {
  bugs: ['Paste code and click Review Code to see results.'],
  securityIssues: ['Security feedback will appear here after review.'],
  codeQuality: ['Code quality feedback will appear here after review.'],
  improvements: ['Suggestions will appear here after review.'],
}

type ReviewHistoryItem = {
  id: string
  code: string
  language: string
  result: ReviewResult
  timestamp: string
}

type ParsedGitHubRepo = {
  owner: string
  repo: string
}

type GitHubTreeFile = {
  path: string
  type: 'file'
  size?: number
}

type GitHubTreeResult = ParsedGitHubRepo & {
  files: GitHubTreeFile[]
}

type GitHubFileResult = ParsedGitHubRepo & {
  path: string
  content: string
  size: number
}

type GitHubProjectInfo = ParsedGitHubRepo & {
  projectTypes: string[]
  dependencies: string[]
  devDependencies: string[]
  scripts: string[]
  configFiles: string[]
}

type GitHubRepositorySummary = {
  projectType: string
  architecture: string[]
  keyFeatures: string[]
  importantFiles: string[]
  reviewPriority: 'Low' | 'Medium' | 'High'
  summary: string
}

type GitHubMultiFileReview = {
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

const HISTORY_STORAGE_KEY = 'repomind-ai-review-history'

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString()
}

function makeCodePreview(code: string) {
  const trimmed = code.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 72) {
    return trimmed
  }

  return `${trimmed.slice(0, 72)}...`
}

function formatReviewForCopy(review: ReviewResult) {
  return [
    'Bugs:',
    ...review.bugs.map((item) => `- ${item}`),
    '',
    'Security Issues:',
    ...review.securityIssues.map((item) => `- ${item}`),
    '',
    'Code Quality:',
    ...review.codeQuality.map((item) => `- ${item}`),
    '',
    'Improvements:',
    ...review.improvements.map((item) => `- ${item}`),
  ].join('\n')
}

function inferLanguageFromPath(path: string) {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()

  switch (extension) {
    case '.js':
    case '.jsx':
      return 'JavaScript'
    case '.ts':
    case '.tsx':
      return 'TypeScript'
    case '.py':
      return 'Python'
    case '.java':
      return 'Java'
    case '.json':
      return 'JSON'
    case '.css':
      return 'CSS'
    case '.html':
      return 'HTML'
    default:
      return 'Text'
  }
}

function isCodeLanguage(value: string): value is (typeof languageOptions)[number] {
  return (languageOptions as readonly string[]).includes(value)
}

type RepositoryPromptContext = {
  repo: ParsedGitHubRepo | null
  projectInfo: GitHubProjectInfo | null
  repositorySummary: GitHubRepositorySummary | null
  tree: GitHubTreeResult | null
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function formatBulletList(items: string[], emptyText = '- None detected') {
  if (items.length === 0) {
    return emptyText
  }

  return items.map((item) => `- ${item}`).join('\n')
}

function getTechnologySignals(projectInfo: GitHubProjectInfo | null) {
  if (!projectInfo) {
    return []
  }

  const values = uniqueStrings([
    ...projectInfo.projectTypes,
    ...projectInfo.dependencies,
    ...projectInfo.devDependencies,
  ])

  const priorityOrder = [
    'Node.js',
    'React',
    'React DOM',
    'React Native',
    'Expo',
    'Expo Router',
    'Next.js',
    'Vite',
    'TypeScript',
    'Express',
    'Firebase',
    'Supabase',
    'Zustand',
    'Redux',
    'Redux Toolkit',
    'React Router',
    'React Router DOM',
    'dotenv',
    'cors',
  ]

  const lowerValues = new Set(values.map((value) => value.toLowerCase()))

  return priorityOrder.filter((item) => lowerValues.has(item.toLowerCase()))
}

function inferPlatform(projectInfo: GitHubProjectInfo | null, repositorySummary: GitHubRepositorySummary | null) {
  const projectTypes = uniqueStrings([
    ...(projectInfo?.projectTypes ?? []),
    repositorySummary?.projectType ?? '',
  ]).map((value) => value.toLowerCase())

  const has = (...items: string[]) => items.some((item) => projectTypes.includes(item.toLowerCase()))

  if (has('react native') || has('expo') || has('expo router')) {
    return 'Mobile application'
  }

  if (has('next.js')) {
    return 'Web application with Next.js'
  }

  if (has('react') || has('vite')) {
    return 'Web application'
  }

  if (has('express')) {
    return 'Backend service'
  }

  if (projectTypes.length > 0) {
    return `Appears to be a ${projectTypes[0]} project`
  }

  return 'Platform is not explicit from the current evidence'
}

function inferArchitecture(projectInfo: GitHubProjectInfo | null, repositorySummary: GitHubRepositorySummary | null) {
  const architecture = uniqueStrings([
    ...(repositorySummary?.architecture ?? []),
    ...(projectInfo?.projectTypes ?? []),
  ])

  if (architecture.length > 0) {
    return architecture
  }

  return ['Architecture is not explicit from the current evidence']
}

function inferStateManagement(projectInfo: GitHubProjectInfo | null) {
  const dependencies = new Set(
    (projectInfo?.dependencies ?? []).map((value) => value.toLowerCase()),
  )
  const devDependencies = new Set(
    (projectInfo?.devDependencies ?? []).map((value) => value.toLowerCase()),
  )
  const has = (...items: string[]) =>
    items.some((item) => dependencies.has(item.toLowerCase()) || devDependencies.has(item.toLowerCase()))

  if (has('zustand')) {
    return 'Zustand'
  }

  if (has('redux', '@reduxjs/toolkit')) {
    return 'Redux Toolkit / Redux'
  }

  if (has('mobx')) {
    return 'MobX'
  }

  if (has('jotai')) {
    return 'Jotai'
  }

  if (has('valtio')) {
    return 'Valtio'
  }

  return 'State management is not explicit; use a lightweight approach that matches the detected architecture'
}

function inferNavigation(projectInfo: GitHubProjectInfo | null, repositorySummary: GitHubRepositorySummary | null) {
  const dependencies = new Set(
    [
      ...(projectInfo?.dependencies ?? []),
      ...(projectInfo?.devDependencies ?? []),
      ...(repositorySummary?.architecture ?? []),
    ].map((value) => value.toLowerCase()),
  )
  const has = (...items: string[]) => items.some((item) => dependencies.has(item.toLowerCase()))

  if (has('expo-router')) {
    return 'Expo Router / file-based routing'
  }

  if (has('react-router-dom') || has('react-router')) {
    return 'React Router'
  }

  if (has('next.js') || has('next')) {
    return 'Next.js routing'
  }

  if (has('navigation')) {
    return 'Navigation appears to be handled by a dedicated navigation layer'
  }

  return 'Navigation is not explicit; infer the routing model from the file structure and screens'
}

function inferBackend(projectInfo: GitHubProjectInfo | null, repositorySummary: GitHubRepositorySummary | null) {
  const dependencies = new Set(
    [
      ...(projectInfo?.dependencies ?? []),
      ...(projectInfo?.devDependencies ?? []),
      ...(repositorySummary?.architecture ?? []),
    ].map((value) => value.toLowerCase()),
  )
  const has = (...items: string[]) => items.some((item) => dependencies.has(item.toLowerCase()))

  if (has('express')) {
    return 'Express API server'
  }

  if (has('firebase')) {
    return 'Firebase-backed services'
  }

  if (has('@supabase/supabase-js', 'supabase')) {
    return 'Supabase-backed services'
  }

  if (has('axios', 'fetch')) {
    return 'Client/server communication through HTTP APIs'
  }

  return 'Backend integration is not explicit from the current evidence'
}

function collectEvidenceFiles(
  repositorySummary: GitHubRepositorySummary | null,
  tree: GitHubTreeResult | null,
) {
  const files = repositorySummary?.importantFiles ?? []

  if (files.length > 0) {
    return files.slice(0, 10)
  }

  const keywordMatches = (tree?.files ?? [])
    .map((file) => file.path)
    .filter((path) =>
      /auth|login|signup|sign-in|sign-up|profile|user|payment|billing|admin|firebase|supabase|api|service|config/i.test(
        path,
      ),
    )

  return keywordMatches.slice(0, 10)
}

function collectLikelyFeatures(
  projectInfo: GitHubProjectInfo | null,
  repositorySummary: GitHubRepositorySummary | null,
  tree: GitHubTreeResult | null,
) {
  const features = uniqueStrings(repositorySummary?.keyFeatures ?? [])

  if (features.length > 0) {
    return features
  }

  const paths = (tree?.files ?? []).map((file) => file.path.toLowerCase())
  const matches: string[] = []
  const add = (value: string) => {
    if (!matches.includes(value)) {
      matches.push(value)
    }
  }

  if (paths.some((path) => /auth|login|signup|sign-in|sign-up/.test(path))) {
    add('Authentication flow')
  }

  if (paths.some((path) => /profile|user/.test(path))) {
    add('User profile or account management')
  }

  if (paths.some((path) => /payment|billing|checkout/.test(path))) {
    add('Payments or billing flow')
  }

  if (paths.some((path) => /admin/.test(path))) {
    add('Admin tools or protected access')
  }

  if (paths.some((path) => /api|service/.test(path))) {
    add('API or service layer')
  }

  if (paths.some((path) => /settings|preferences/.test(path))) {
    add('Settings or preferences screens')
  }

  if (paths.some((path) => /firebase/.test(path))) {
    add('Firebase integration')
  }

  if (paths.some((path) => /supabase/.test(path))) {
    add('Supabase integration')
  }

  if (projectInfo?.projectTypes.some((type) => type.toLowerCase() === 'react native')) {
    add('Mobile application screens')
  }

  if (projectInfo?.projectTypes.some((type) => type.toLowerCase() === 'expo router')) {
    add('File-based screen routing')
  }

  if (matches.length === 0) {
    add('Core application flows that are not explicit from the current evidence')
  }

  return matches
}

function collectFolderStructure(tree: GitHubTreeResult | null) {
  if (!tree) {
    return []
  }

  const topLevelFolders = new Set<string>()

  for (const file of tree.files) {
    const segments = file.path.split('/').filter(Boolean)
    if (segments.length > 1) {
      topLevelFolders.add(segments[0])
    }
  }

  return [...topLevelFolders].slice(0, 8)
}

function buildRepositoryRebuildPrompt(context: RepositoryPromptContext) {
  const projectType = context.repositorySummary?.projectType
    ?? (context.projectInfo?.projectTypes.length
      ? context.projectInfo.projectTypes.join(' / ')
      : 'Unknown')
  const platform = inferPlatform(context.projectInfo, context.repositorySummary)
  const architecture = inferArchitecture(context.projectInfo, context.repositorySummary)
  const technologies = getTechnologySignals(context.projectInfo)
  const scripts = context.projectInfo?.scripts ?? []
  const configFiles = context.projectInfo?.configFiles ?? []
  const importantFiles = collectEvidenceFiles(context.repositorySummary, context.tree)
  const features = collectLikelyFeatures(context.projectInfo, context.repositorySummary, context.tree)
  const folderStructure = collectFolderStructure(context.tree)
  const stateManagement = inferStateManagement(context.projectInfo)
  const navigation = inferNavigation(context.projectInfo, context.repositorySummary)
  const backend = inferBackend(context.projectInfo, context.repositorySummary)
  const summaryText =
    context.repositorySummary?.summary?.trim() ||
    'A concise natural-language summary is not yet available, so rely on the repository signals below.'
  const reviewPriority = context.repositorySummary?.reviewPriority ?? 'Medium'
  const repoLabel =
    context.repo ? `${context.repo.owner}/${context.repo.repo}` : 'the analyzed repository'
  const evidenceFiles = importantFiles.length > 0 ? importantFiles.join(', ') : 'Not explicit from the current evidence'
  const detectedFeatures = features.length > 0 ? features.join(', ') : 'Not explicit from the current evidence'
  const configFilesText = configFiles.length > 0 ? configFiles.join(', ') : 'None detected'
  const scriptsText = scripts.length > 0 ? scripts.join(', ') : 'None detected'
  const folderText =
    folderStructure.length > 0 ? folderStructure.join(', ') : 'Folder organization is not explicit from the current evidence'

  return [
    'You are a senior software architect and full-stack engineer.',
    '',
    'Analyze the repository specification below and produce a build brief for recreating a similar product from scratch.',
    'This is a repository reconstruction prompt, not a code review prompt.',
    'Stay strictly grounded in the repository evidence.',
    'Do not invent unsupported technologies, features, or architecture.',
    'When confidence is low, use wording such as appears to, likely, inferred from repository structure, or based on detected dependencies.',
    '',
    `Repository Target: ${repoLabel}`,
    '',
    'Repository Profile:',
    `- Project Type: ${projectType}`,
    `- Platform: ${platform}`,
    `- Architecture: ${architecture.join(', ')}`,
    `- Technologies: ${technologies.length > 0 ? technologies.join(', ') : 'Not explicit from the current evidence'}`,
    `- Development Approach: ${scripts.length > 0 ? `Uses scripts such as ${scripts.slice(0, 4).join(', ')}` : 'Development workflow is not explicit from the current evidence'}`,
    `- Folder Organization: ${folderText}`,
    `- Backend Integration: ${backend}`,
    `- Navigation: ${navigation}`,
    `- State Management: ${stateManagement}`,
    `- Review Priority: ${reviewPriority}`,
    '',
    'Inferred Product Behavior:',
    formatBulletList(features),
    '',
    'Important Files and Responsibilities:',
    formatBulletList(importantFiles),
    '',
    'Evidence Notes:',
    `- Config Files: ${configFilesText}`,
    `- Scripts: ${scriptsText}`,
    `- Repository Summary: ${summaryText}`,
    `- Evidence Files: ${evidenceFiles}`,
    `- Detected Signals: ${detectedFeatures}`,
    '',
    'Objective:',
    '- Recreate the same user-facing flows, architecture, and developer workflow observed in the repository.',
    '- Preserve the detected stack choices wherever the repository provides evidence.',
    '- Use cautious language for uncertain areas and avoid unsupported assumptions.',
    '- Keep the rebuilt product aligned with the repository signals instead of adding unrelated scope.',
    '',
    'Build Brief:',
    '1. Architecture',
    '   Describe the overall system architecture and implement it with the same high-level shape as the repository.',
    '2. Core Features',
    '   Implement the major product flows inferred from the repository and keep them aligned with the observed file organization.',
    '3. State Management',
    '   Use the detected state-management approach when evidence exists; otherwise choose a lightweight equivalent that fits the app architecture.',
    '4. Navigation',
    '   Implement the detected routing or navigation approach; if it is not explicit, infer it from the screens and folder structure.',
    '5. Backend Integration',
    '   Implement the detected backend or API integration approach and keep UI/service boundaries clean.',
    '6. Security',
    '   Follow production-grade security practices appropriate for the detected application type.',
    '7. Code Quality',
    '   Use maintainable architecture, clear separation of concerns, and modular components or services.',
    '8. Folder Structure',
    '   Create a scalable folder structure appropriate for the detected project type and repository organization.',
    '9. Development Phases',
    '   Provide a phased implementation plan that starts with the foundation and expands toward higher-value features.',
    '10. Final Deliverable',
    '    Produce a working MVP that mirrors the repository\'s core behavior, followed by recommended future improvements.',
    '',
    'Style Guidance:',
    '- Write like a product-focused implementation brief for an AI coding assistant.',
    '- Be specific, practical, and concise.',
    '- Prefer clear section headings and direct instructions.',
    '- Keep the brief copy-paste ready for ChatGPT, Claude, Grok, Gemini, Codex, Cursor, Windsurf, or similar tools.',
  ].join('\n')
}

function App() {
  const [mode, setMode] = useState<Mode>('code')
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState<(typeof languageOptions)[number]>(
    'TypeScript',
  )
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [history, setHistory] = useState<ReviewHistoryItem[]>([])
  const [copyStatus, setCopyStatus] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubError, setGithubError] = useState('')
  const [githubResult, setGithubResult] = useState<ParsedGitHubRepo | null>(null)
  const [githubTree, setGithubTree] = useState<GitHubTreeResult | null>(null)
  const [githubTreeLoading, setGithubTreeLoading] = useState(false)
  const [githubTreeError, setGithubTreeError] = useState('')
  const [githubProjectInfo, setGitHubProjectInfo] = useState<GitHubProjectInfo | null>(null)
  const [githubProjectInfoLoading, setGitHubProjectInfoLoading] = useState(false)
  const [githubProjectInfoError, setGitHubProjectInfoError] = useState('')
  const [githubRepositorySummary, setGitHubRepositorySummary] =
    useState<GitHubRepositorySummary | null>(null)
  const [githubRepositorySummaryLoading, setGitHubRepositorySummaryLoading] = useState(false)
  const [githubRepositorySummaryError, setGitHubRepositorySummaryError] = useState('')
  const [repositoryRebuildPrompt, setRepositoryRebuildPrompt] = useState('')
  const [repositoryRebuildPromptCopyStatus, setRepositoryRebuildPromptCopyStatus] = useState('')
  const [selectedGitHubFiles, setSelectedGitHubFiles] = useState<string[]>([])
  const [multiFileReview, setMultiFileReview] = useState<GitHubMultiFileReview | null>(null)
  const [multiFileReviewLoading, setMultiFileReviewLoading] = useState(false)
  const [multiFileReviewError, setMultiFileReviewError] = useState('')
  const [selectedGitHubFile, setSelectedGitHubFile] = useState<GitHubFileResult | null>(
    null,
  )
  const [githubFileLoading, setGithubFileLoading] = useState(false)
  const [githubFileError, setGithubFileError] = useState('')

  const repositoryRebuildPromptDraft = useMemo(
    () =>
      buildRepositoryRebuildPrompt({
        repo: githubResult,
        projectInfo: githubProjectInfo,
        repositorySummary: githubRepositorySummary,
        tree: githubTree,
      }),
    [githubResult, githubProjectInfo, githubRepositorySummary, githubTree],
  )

  const cards = useMemo(
    () => [
      {
        title: 'Bugs',
        items: result?.bugs ?? defaultReview.bugs,
        emptyMessage: 'No bugs found.',
      },
      {
        title: 'Security Issues',
        items: result?.securityIssues ?? defaultReview.securityIssues,
        emptyMessage: 'No security issues found.',
      },
      {
        title: 'Code Quality',
        items: result?.codeQuality ?? defaultReview.codeQuality,
        emptyMessage: 'No code quality issues found.',
      },
      {
        title: 'Improvements',
        items: result?.improvements ?? defaultReview.improvements,
        emptyMessage: 'No improvements suggested.',
      },
    ],
    [result],
  )

  useEffect(() => {
    try {
      const storedHistory = window.localStorage.getItem(HISTORY_STORAGE_KEY)
      if (!storedHistory) {
        return
      }

      const parsed = JSON.parse(storedHistory) as ReviewHistoryItem[]
      if (Array.isArray(parsed)) {
        setHistory(parsed.slice(0, 5))
      }
    } catch {
      setHistory([])
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
    } catch {
      // Ignore storage failures in private mode or full storage scenarios.
    }
  }, [history])

  useEffect(() => {
    if (!githubResult) {
      setRepositoryRebuildPrompt('')
      setRepositoryRebuildPromptCopyStatus('')
      return
    }

    setRepositoryRebuildPrompt(repositoryRebuildPromptDraft)
    setRepositoryRebuildPromptCopyStatus('')
  }, [githubResult, repositoryRebuildPromptDraft])

  const updateHistory = (nextItem: ReviewHistoryItem) => {
    setHistory((currentHistory) => [nextItem, ...currentHistory].slice(0, 5))
  }

  const runReview = async (
    sourceCode: string,
    sourceLanguage: string,
    message: string,
    filePath?: string,
  ) => {
    setError('')
    setLoading(true)
    setLoadingMessage(message)
    setCopyStatus('')

    try {
      const response = await fetch(`${API_URL}/api/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: sourceCode,
          language: sourceLanguage,
          ...(filePath ? { filePath } : {}),
        }),
      })

      const data = (await response.json()) as ReviewResult & { error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to review code right now.')
      }

      setResult(data)
      updateHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        code: sourceCode,
        language: sourceLanguage,
        result: data,
        timestamp: new Date().toISOString(),
      })
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : 'Something went wrong while calling the review API.'
      setError(message)
      setResult(null)
    } finally {
      setLoading(false)
      setLoadingMessage('')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!code.trim()) {
      setError('Please paste some code before reviewing.')
      return
    }

    await runReview(code, language, 'Analyzing code...')
  }

  const handleClearCode = () => {
    setCode('')
    setError('')
  }

  const handleCopyReview = async () => {
    if (!result) {
      return
    }

    try {
      await navigator.clipboard.writeText(formatReviewForCopy(result))
      setCopyStatus('Review copied.')
    } catch {
      setCopyStatus('Unable to copy review right now.')
    }
  }

  const handleLoadHistoryItem = (item: ReviewHistoryItem) => {
    setCode(item.code)
    setLanguage(isCodeLanguage(item.language) ? item.language : 'TypeScript')
    setResult(item.result)
    setError('')
    setCopyStatus('')
  }

  const handleDeleteHistory = () => {
    setHistory([])
  }

  const handleParseRepo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setGithubError('')
    setGithubResult(null)
    setGithubTree(null)
    setGithubTreeError('')
    setGitHubProjectInfo(null)
    setGitHubProjectInfoError('')
    setGitHubRepositorySummary(null)
    setGitHubRepositorySummaryError('')
    setRepositoryRebuildPrompt('')
    setRepositoryRebuildPromptCopyStatus('')
    setSelectedGitHubFiles([])
    setMultiFileReview(null)
    setMultiFileReviewError('')
    setSelectedGitHubFile(null)
    setGithubFileError('')

    if (!githubUrl.trim()) {
      setGithubError('Please enter a GitHub repository URL.')
      return
    }

    setGithubLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/github/parse?url=${encodeURIComponent(githubUrl)}`)
      const data = (await response.json()) as ParsedGitHubRepo & { error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to parse repository URL.')
      }

      setGithubResult(data)
    } catch (parseError) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : 'Something went wrong while parsing the repository URL.'
      setGithubError(message)
    } finally {
      setGithubLoading(false)
    }
  }

  const handleDetectProjectType = async () => {
    setGitHubProjectInfoError('')

    if (!githubUrl.trim()) {
      setGitHubProjectInfoError('Please enter a parsed GitHub repository first.')
      return
    }

    setGitHubProjectInfoLoading(true)

    try {
      const response = await fetch(
        `${API_URL}/api/github/project-info?url=${encodeURIComponent(githubUrl)}`,
      )
      const data = (await response.json()) as GitHubProjectInfo & { error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to detect project type.')
      }

      setGitHubProjectInfo(data)
    } catch (projectInfoError) {
      const message =
        projectInfoError instanceof Error
          ? projectInfoError.message
          : 'Something went wrong while detecting the project type.'
      setGitHubProjectInfoError(message)
      setGitHubProjectInfo(null)
    } finally {
      setGitHubProjectInfoLoading(false)
    }
  }

  const handleGenerateRepositorySummary = async () => {
    setGitHubRepositorySummaryError('')

    if (!githubUrl.trim()) {
      setGitHubRepositorySummaryError('Please enter a parsed GitHub repository first.')
      return
    }

    setGitHubRepositorySummaryLoading(true)

    try {
      const response = await fetch(
        `${API_URL}/api/github/repository-summary?url=${encodeURIComponent(githubUrl)}`,
      )
      const data = (await response.json()) as GitHubRepositorySummary & { error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to generate repository summary.')
      }

      setGitHubRepositorySummary(data)
    } catch (summaryError) {
      const message =
        summaryError instanceof Error
          ? summaryError.message
          : 'Something went wrong while generating the repository summary.'
      setGitHubRepositorySummaryError(message)
      setGitHubRepositorySummary(null)
    } finally {
      setGitHubRepositorySummaryLoading(false)
    }
  }

  const handleGenerateRebuildPrompt = () => {
    if (!githubResult) {
      return
    }

    setRepositoryRebuildPrompt(repositoryRebuildPromptDraft)
    setRepositoryRebuildPromptCopyStatus('')
  }

  const handleCopyRebuildPrompt = async () => {
    if (!repositoryRebuildPrompt) {
      return
    }

    try {
      await navigator.clipboard.writeText(repositoryRebuildPrompt)
      setRepositoryRebuildPromptCopyStatus('Prompt copied.')
    } catch {
      setRepositoryRebuildPromptCopyStatus('Unable to copy prompt right now.')
    }
  }

  const handleSelectGitHubFiles = (path: string, checked: boolean) => {
    setMultiFileReviewError('')
    setSelectedGitHubFiles((currentFiles) => {
      if (checked) {
        if (currentFiles.includes(path) || currentFiles.length >= 5) {
          return currentFiles
        }

        return [...currentFiles, path]
      }

      return currentFiles.filter((filePath) => filePath !== path)
    })
  }

  const handleReviewSelectedFiles = async () => {
    setMultiFileReviewError('')

    if (!githubResult || selectedGitHubFiles.length === 0) {
      setMultiFileReviewError('Select at least one file first.')
      return
    }

    setMultiFileReviewLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/github/multi-file-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: githubUrl,
          filePaths: selectedGitHubFiles,
        }),
      })

      const data = (await response.json()) as GitHubMultiFileReview & { error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to review selected files.')
      }

      setMultiFileReview(data)
    } catch (reviewError) {
      const message =
        reviewError instanceof Error
          ? reviewError.message
          : 'Something went wrong while reviewing selected files.'
      setMultiFileReviewError(message)
      setMultiFileReview(null)
    } finally {
      setMultiFileReviewLoading(false)
    }
  }

  const handleSelectGitHubFile = async (path: string) => {
    setGithubFileError('')
    setGithubFileLoading(true)
    setSelectedGitHubFile(null)
    setResult(null)

    try {
      const response = await fetch(
        `${API_URL}/api/github/file?url=${encodeURIComponent(githubUrl)}&path=${encodeURIComponent(path)}`,
      )
      const data = (await response.json()) as GitHubFileResult & { error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to fetch file content.')
      }

      setSelectedGitHubFile(data)
    } catch (fileError) {
      const message =
        fileError instanceof Error
          ? fileError.message
          : 'Something went wrong while loading the file.'
      setGithubFileError(message)
    } finally {
      setGithubFileLoading(false)
    }
  }

  const handleFetchFiles = async () => {
    setGithubTreeError('')
    setGithubTree(null)

    if (!githubUrl.trim()) {
      setGithubTreeError('Please enter a parsed GitHub repository first.')
      return
    }

    setGithubTreeLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/github/tree?url=${encodeURIComponent(githubUrl)}`)
      const data = (await response.json()) as GitHubTreeResult & { error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to fetch repository files.')
      }

      setGithubTree(data)
    } catch (treeError) {
      const message =
        treeError instanceof Error
          ? treeError.message
          : 'Something went wrong while fetching repository files.'
      setGithubTreeError(message)
    } finally {
      setGithubTreeLoading(false)
    }
  }

  const handleModeChange = (nextMode: Mode) => {
    setMode(nextMode)
    setError('')
    setGithubError('')
    setGithubTreeError('')
    setGitHubProjectInfo(null)
    setGitHubProjectInfoError('')
    setGitHubRepositorySummary(null)
    setGitHubRepositorySummaryError('')
    setRepositoryRebuildPrompt('')
    setRepositoryRebuildPromptCopyStatus('')
    setSelectedGitHubFiles([])
    setMultiFileReview(null)
    setMultiFileReviewError('')
    setGithubFileError('')
    setCopyStatus('')
  }

  const handleReviewSelectedFile = async () => {
    if (!selectedGitHubFile) {
      setGithubFileError('Select a file first.')
      return
    }

    await runReview(
      selectedGitHubFile.content,
      inferLanguageFromPath(selectedGitHubFile.path),
      'Reviewing selected file...',
      selectedGitHubFile.path,
    )
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="eyebrow">Phase 6</div>
        <h1>RepoMind AI</h1>
        <p className="subtitle">AI code reviewer for students and developers</p>

        <div className="mode-switch" role="tablist" aria-label="Workspace mode">
          <button
            type="button"
            role="tab"
            className={mode === 'code' ? 'mode-button mode-button--active' : 'mode-button'}
            aria-selected={mode === 'code'}
            onClick={() => handleModeChange('code')}
          >
            Paste Code
          </button>
          <button
            type="button"
            role="tab"
            className={
              mode === 'github' ? 'mode-button mode-button--active' : 'mode-button'
            }
            aria-selected={mode === 'github'}
            onClick={() => handleModeChange('github')}
          >
            Analyze GitHub Repo
          </button>
        </div>

        {mode === 'code' ? (
          <form className="review-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Paste your code</span>
              <textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Paste JavaScript, TypeScript, Python, or Java code here..."
                rows={14}
              />
              <div className="meta-row">
                <span>{code.length} characters</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={handleClearCode}
                  disabled={!code}
                >
                  Clear Code
                </button>
              </div>
            </label>

            <div className="field-row">
              <label className="field field--compact">
                <span>Language</span>
                <select
                  value={language}
                  onChange={(event) =>
                    setLanguage(event.target.value as (typeof languageOptions)[number])
                  }
                >
                  {languageOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" className="review-button" disabled={loading}>
                {loading ? 'Analyzing code...' : 'Review Code'}
              </button>
            </div>
          </form>
        ) : (
          <form className="review-form" onSubmit={handleParseRepo}>
            <label className="field">
              <span>GitHub repository URL</span>
              <input
                className="repo-input"
                value={githubUrl}
                onChange={(event) => setGithubUrl(event.target.value)}
                placeholder="https://github.com/user/repo"
                type="url"
              />
            </label>

            <div className="field-row">
              <button type="submit" className="review-button" disabled={githubLoading}>
                {githubLoading ? 'Parsing repo...' : 'Parse Repo'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="status status--loading" aria-live="polite">
            {loadingMessage}
          </div>
        ) : null}

        {mode === 'github' && githubError ? (
          <div className="status status--error" role="alert">
            {githubError}
          </div>
        ) : null}
      </section>

      {mode === 'github' ? (
        <section className="github-panel">
          <div className="results-header results-header--stacked">
            <div>
              <h2>GitHub Repo</h2>
              <p>Parsed repository details, file tree, and project metadata live here.</p>
            </div>
          </div>

          {githubLoading ? (
            <div className="status status--loading" aria-live="polite">
              Parsing repository URL...
            </div>
          ) : null}

          <div className="repo-result-card">
            <div className="repo-result-row">
              <span>Owner</span>
              <strong>{githubResult?.owner ?? 'Waiting for a parsed repository...'}</strong>
            </div>
            <div className="repo-result-row">
              <span>Repo</span>
              <strong>{githubResult?.repo ?? 'Waiting for a parsed repository...'}</strong>
            </div>
          </div>

          {githubResult ? (
            <div className="repo-actions">
              <button
                type="button"
                className="review-button"
                onClick={handleFetchFiles}
                disabled={githubTreeLoading}
              >
                {githubTreeLoading ? 'Fetching repository files...' : 'Fetch Files'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleDetectProjectType}
                disabled={githubProjectInfoLoading}
              >
                {githubProjectInfoLoading ? 'Detecting project type...' : 'Detect Project Type'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleGenerateRepositorySummary}
                disabled={githubRepositorySummaryLoading}
              >
                {githubRepositorySummaryLoading
                  ? 'Generating repository summary...'
                  : 'Generate Repository Summary'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleReviewSelectedFiles}
                disabled={multiFileReviewLoading || selectedGitHubFiles.length === 0}
              >
                {multiFileReviewLoading ? 'Reviewing selected files...' : 'Review Selected Files'}
              </button>
            </div>
          ) : null}

          {githubProjectInfoLoading ? (
            <div className="status status--loading" aria-live="polite">
              Detecting project type...
            </div>
          ) : null}

          {githubProjectInfoError ? (
            <div className="status status--error" role="alert">
              {githubProjectInfoError}
            </div>
          ) : null}

          {githubRepositorySummaryLoading ? (
            <div className="status status--loading" aria-live="polite">
              Generating repository summary...
            </div>
          ) : null}

          {githubRepositorySummaryError ? (
            <div className="status status--error" role="alert">
              {githubRepositorySummaryError}
            </div>
          ) : null}

          {githubRepositorySummary ? (
            <section className="project-summary-card" aria-label="Repository overview">
              <div className="project-summary-card__header">
                <div>
                  <h3>Repository Overview</h3>
                  <p>Quick architecture summary and review focus for the repository.</p>
                </div>
              </div>

              <div className="project-summary-row">
                <span>Project Type</span>
                <strong>{githubRepositorySummary.projectType}</strong>
              </div>

              <div className="project-summary-group">
                <span className="project-summary-group__label">Architecture</span>
                {githubRepositorySummary.architecture.length === 0 ? (
                  <div className="history-empty">No specific architecture hints detected.</div>
                ) : (
                  <div className="badge-list">
                    {githubRepositorySummary.architecture.map((item) => (
                      <span key={item} className="badge">
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="project-summary-grid">
                <div className="project-summary-group">
                  <span className="project-summary-group__label">Key Features</span>
                  {githubRepositorySummary.keyFeatures.length === 0 ? (
                    <div className="history-empty">No key features detected.</div>
                  ) : (
                    <ul className="project-info-list">
                      {githubRepositorySummary.keyFeatures.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="project-summary-group">
                  <span className="project-summary-group__label">Review Priority</span>
                  <span className="priority-pill">{githubRepositorySummary.reviewPriority}</span>
                </div>
              </div>

              <div className="project-summary-group">
                <span className="project-summary-group__label">Important Files</span>
                {githubRepositorySummary.importantFiles.length === 0 ? (
                  <div className="history-empty">No important files detected.</div>
                ) : (
                  <ol className="overview-ranked-list">
                    {githubRepositorySummary.importantFiles.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="project-summary-group">
                <span className="project-summary-group__label">Summary</span>
                <p className="project-summary-text">{githubRepositorySummary.summary}</p>
              </div>
            </section>
          ) : null}

          {githubResult ? (
            <section className="rebuild-prompt-card" aria-label="Repository rebuild prompt">
              <div className="rebuild-prompt-card__header">
                <div>
                  <h3>Repository Rebuild Prompt</h3>
                  <p>Copy this prompt into another AI tool to recreate a similar application.</p>
                </div>

                <div className="rebuild-prompt-actions">
                  <button
                    type="button"
                    className="review-button"
                    onClick={handleGenerateRebuildPrompt}
                  >
                    Generate Rebuild Prompt
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleCopyRebuildPrompt}
                    disabled={!repositoryRebuildPrompt}
                  >
                    Copy Prompt
                  </button>
                </div>
              </div>

              {repositoryRebuildPromptCopyStatus ? (
                <div className="status status--copy" aria-live="polite">
                  {repositoryRebuildPromptCopyStatus}
                </div>
              ) : null}

              <textarea
                className="rebuild-prompt-textarea"
                value={repositoryRebuildPrompt}
                placeholder="Click Generate Rebuild Prompt to build a copy-paste ready system reconstruction prompt from the repository analysis."
                readOnly
                rows={22}
              />
            </section>
          ) : null}

          {githubProjectInfo ? (
            <section className="project-info-card" aria-label="Detected project information">
              <div className="project-info-card__header">
                <div>
                  <h3>Detected Project Type</h3>
                  <p>Project stack, package metadata, and configuration hints from the repo.</p>
                </div>
              </div>

              <div className="project-info-group">
                <span className="project-info-group__label">Project types</span>
                {githubProjectInfo.projectTypes.length === 0 ? (
                  <div className="history-empty">No project types detected.</div>
                ) : (
                  <div className="badge-list">
                    {githubProjectInfo.projectTypes.map((item) => (
                      <span key={item} className="badge">
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="project-info-grid">
                <div className="project-info-group">
                  <span className="project-info-group__label">Scripts</span>
                  {githubProjectInfo.scripts.length === 0 ? (
                    <div className="history-empty">No package scripts found.</div>
                  ) : (
                    <ul className="project-info-list">
                      {githubProjectInfo.scripts.map((script) => (
                        <li key={script}>{script}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="project-info-group">
                  <span className="project-info-group__label">Dependencies</span>
                  {githubProjectInfo.dependencies.length === 0 ? (
                    <div className="history-empty">No dependencies found.</div>
                  ) : (
                    <div className="badge-list">
                      {githubProjectInfo.dependencies.map((dependency) => (
                        <span key={dependency} className="badge badge--soft">
                          {dependency}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="project-info-group">
                  <span className="project-info-group__label">Dev dependencies</span>
                  {githubProjectInfo.devDependencies.length === 0 ? (
                    <div className="history-empty">No dev dependencies found.</div>
                  ) : (
                    <div className="badge-list">
                      {githubProjectInfo.devDependencies.map((dependency) => (
                        <span key={dependency} className="badge badge--soft">
                          {dependency}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="project-info-group">
                  <span className="project-info-group__label">Config files</span>
                  {githubProjectInfo.configFiles.length === 0 ? (
                    <div className="history-empty">No config files found.</div>
                  ) : (
                    <div className="badge-list">
                      {githubProjectInfo.configFiles.map((configFile) => (
                        <span key={configFile} className="badge badge--soft">
                          {configFile}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {githubTreeError ? (
            <div className="status status--error" role="alert">
              {githubTreeError}
            </div>
          ) : null}

          {githubFileLoading ? (
            <div className="status status--loading" aria-live="polite">
              Loading file...
            </div>
          ) : null}

          {githubFileError ? (
            <div className="status status--error" role="alert">
              {githubFileError}
            </div>
          ) : null}

          {githubTree ? (
            <div className="repo-tree">
              <div className="repo-tree__header">
                <h3>{githubTree.files.length} files found</h3>
                <span className="repo-tree__selection-count">
                  Selected {selectedGitHubFiles.length}/5 files
                </span>
              </div>

              <div className="repo-tree__list">
                {githubTree.files.length === 0 ? (
                  <div className="history-empty">No useful source files found.</div>
                ) : (
                  githubTree.files.map((file) => (
                    <div key={file.path} className="repo-tree__entry">
                      <label className="repo-tree__checkbox">
                        <input
                          type="checkbox"
                          checked={selectedGitHubFiles.includes(file.path)}
                          disabled={
                            !selectedGitHubFiles.includes(file.path) &&
                            selectedGitHubFiles.length >= 5
                          }
                          onChange={(event) =>
                            handleSelectGitHubFiles(file.path, event.target.checked)
                          }
                        />
                        <span>Select</span>
                      </label>

                      <button
                        type="button"
                        className={
                          selectedGitHubFile?.path === file.path
                            ? 'repo-tree__item repo-tree__item--selected'
                            : 'repo-tree__item'
                        }
                        onClick={() => handleSelectGitHubFile(file.path)}
                      >
                        <div className="repo-tree__path">{file.path}</div>
                        <div className="repo-tree__meta">
                          <span>{file.type}</span>
                          {typeof file.size === 'number' ? <span>{file.size} bytes</span> : null}
                        </div>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {selectedGitHubFile ? (
            <div className="file-preview-panel">
              <div className="file-preview-panel__header">
                <div>
                  <h3>{selectedGitHubFile.path}</h3>
                  <p>
                    {inferLanguageFromPath(selectedGitHubFile.path)} - {selectedGitHubFile.size} bytes
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleReviewSelectedFile}
                  disabled={loading}
                >
                  {loading ? 'Reviewing selected file...' : 'Review This File'}
                </button>
              </div>

              <pre className="file-preview">
                <code>{selectedGitHubFile.content}</code>
              </pre>
            </div>
          ) : githubTree ? (
            <div className="history-empty">Select a file to preview and review it.</div>
          ) : null}

          {githubTree ? (
            <section className="multi-file-review-card" aria-label="Multi-file review">
              <div className="multi-file-review-card__header">
                <div>
                  <h3>Multi-file Review</h3>
                  <p>Review selected files together for cross-file risks and maintainability issues.</p>
                </div>

                <span className="repo-tree__selection-count">
                  Selected {selectedGitHubFiles.length}/5 files
                </span>
              </div>

              {multiFileReviewLoading ? (
                <div className="status status--loading" aria-live="polite">
                  Reviewing selected files...
                </div>
              ) : null}

              {multiFileReviewError ? (
                <div className="status status--error" role="alert">
                  {multiFileReviewError}
                </div>
              ) : null}

              {multiFileReview ? (
                <>
                  <div className="project-summary-group">
                    <span className="project-summary-group__label">Reviewed Files</span>
                    {multiFileReview.reviewedFiles.length === 0 ? (
                      <div className="history-empty">No files were reviewed.</div>
                    ) : (
                      <ul className="project-info-list">
                        {multiFileReview.reviewedFiles.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="project-summary-group">
                    <span className="project-summary-group__label">Skipped Files</span>
                    {multiFileReview.skippedFiles.length === 0 ? (
                      <div className="history-empty">No files were skipped.</div>
                    ) : (
                      <ul className="multi-review-skipped-list">
                        {multiFileReview.skippedFiles.map((item) => (
                          <li key={item.path}>
                            <strong>{item.path}</strong>
                            <span>{item.reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="multi-review-grid">
                    {(
                      [
                        ['Architecture Issues', multiFileReview.architectureIssues],
                        ['Security Risks', multiFileReview.securityRisks],
                        ['State Management Issues', multiFileReview.stateManagementIssues],
                        ['Cross-file Concerns', multiFileReview.crossFileConcerns],
                        ['Recommended Next Steps', multiFileReview.recommendedNextSteps],
                      ] as Array<[string, string[]]>
                    ).map(([title, items]) => (
                      <article className="result-card" key={title}>
                        <h3>{title}</h3>
                        {items.length === 0 ? (
                          <p className="history-empty">No issues found.</p>
                        ) : (
                          <ul>
                            {items.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="history-empty">
                  Select up to 5 files and click Review Selected Files to generate a cross-file review.
                </div>
              )}
            </section>
          ) : null}
        </section>
      ) : null}

      <section className="results-panel" aria-live="polite">
        <div className="results-header results-header--stacked">
          <div>
            <h2>Review Results</h2>
            <p>Mock backend response for Phase 1 or Groq-powered review in Phase 2.</p>
          </div>

          <div className="results-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleCopyReview}
              disabled={!result}
            >
              Copy Review
            </button>
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              onClick={handleDeleteHistory}
              disabled={!history.length}
            >
              Delete History
            </button>
          </div>
        </div>

        {copyStatus ? (
          <div className="status status--copy" aria-live="polite">
            {copyStatus}
          </div>
        ) : null}

        {error ? (
          <div className="status status--error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="cards-grid">
          {cards.map((card) => (
            <article className="result-card" key={card.title}>
              <h3>{card.title}</h3>
              {card.items.length === 0 ? (
                <p className="history-empty">{card.emptyMessage}</p>
              ) : (
                <ul>
                  {card.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      {mode === 'code' ? (
        <>
          <section className="history-panel">
            <div className="results-header results-header--stacked">
              <div>
                <h2>Review History</h2>
                <p>Stored locally in your browser. Click an item to reload it.</p>
              </div>
            </div>

            <div className="history-list">
              {history.length === 0 ? (
                <div className="history-empty">No saved reviews yet.</div>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="history-item"
                    onClick={() => handleLoadHistoryItem(item)}
                  >
                    <div className="history-item__top">
                      <strong>{item.language}</strong>
                      <span>{formatTimestamp(item.timestamp)}</span>
                    </div>
                    <p>{makeCodePreview(item.code) || 'No preview available.'}</p>
                  </button>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
