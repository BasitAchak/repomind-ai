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
  const [selectedGitHubFiles, setSelectedGitHubFiles] = useState<string[]>([])
  const [multiFileReview, setMultiFileReview] = useState<GitHubMultiFileReview | null>(null)
  const [multiFileReviewLoading, setMultiFileReviewLoading] = useState(false)
  const [multiFileReviewError, setMultiFileReviewError] = useState('')
  const [selectedGitHubFile, setSelectedGitHubFile] = useState<GitHubFileResult | null>(
    null,
  )
  const [githubFileLoading, setGithubFileLoading] = useState(false)
  const [githubFileError, setGithubFileError] = useState('')

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
        <div className="eyebrow">RepoMind AI</div>
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
