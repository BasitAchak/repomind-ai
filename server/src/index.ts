import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import {
  getServerEnvPath,
  reviewCodeWithMetadata,
  type ReviewDebugMetadata,
  type ReviewRequest,
  type ReviewResult,
} from './services/aiReviewer'
import { fetchGitHubFile, GitHubFileError } from './services/githubFile'
import { fetchGitHubProjectInfo, GitHubProjectInfoError } from './services/githubProjectInfo'
import {
  fetchGitHubRepositorySummary,
  GitHubRepositorySummaryError,
} from './services/githubRepositorySummary'
import { reviewGitHubFiles, GitHubMultiFileReviewError } from './services/githubMultiFileReview'
import { fetchGitHubTree, GitHubTreeError } from './services/githubTree'
import { parseGitHubRepoUrl } from './utils/parseGitHubRepoUrl'

dotenv.config({ path: getServerEnvPath() })

const app = express()
const port = 5000
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://repomind-ai-promax.vercel.app',
]

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true)
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      return callback(new Error('Not allowed by CORS'))
    },
  }),
)
app.use(express.json())

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' })
})

app.get('/api/github/parse', (request, response) => {
  const url = request.query.url

  if (typeof url !== 'string' || url.trim().length === 0) {
    return response.status(400).json({ error: 'url is required' })
  }

  const parsedRepo = parseGitHubRepoUrl(url)

  if (!parsedRepo) {
    return response
      .status(400)
      .json({ error: 'Please provide a valid GitHub repository URL.' })
  }

  return response.status(200).json(parsedRepo)
})

app.get('/api/github/tree', async (request, response) => {
  const url = request.query.url

  if (typeof url !== 'string' || url.trim().length === 0) {
    return response.status(400).json({ error: 'url is required' })
  }

  try {
    const tree = await fetchGitHubTree(url)
    return response.status(200).json(tree)
  } catch (error) {
    if (error instanceof GitHubTreeError) {
      return response.status(error.statusCode).json({ error: error.message })
    }

    const message = error instanceof Error ? error.message : 'Failed to fetch repository files.'
    return response.status(502).json({ error: message })
  }
})

app.get('/api/github/file', async (request, response) => {
  const url = request.query.url
  const path = request.query.path

  if (typeof url !== 'string' || url.trim().length === 0) {
    return response.status(400).json({ error: 'url is required' })
  }

  if (typeof path !== 'string' || path.trim().length === 0) {
    return response.status(400).json({ error: 'path is required' })
  }

  try {
    const file = await fetchGitHubFile(url, path)
    return response.status(200).json(file)
  } catch (error) {
    if (error instanceof GitHubFileError) {
      return response.status(error.statusCode).json({ error: error.message })
    }

    const message = error instanceof Error ? error.message : 'Failed to fetch file.'
    return response.status(502).json({ error: message })
  }
})

app.get('/api/github/project-info', async (request, response) => {
  const url = request.query.url

  if (typeof url !== 'string' || url.trim().length === 0) {
    return response.status(400).json({ error: 'url is required' })
  }

  try {
    const projectInfo = await fetchGitHubProjectInfo(url)
    return response.status(200).json(projectInfo)
  } catch (error) {
    if (error instanceof GitHubProjectInfoError) {
      return response.status(error.statusCode).json({ error: error.message })
    }

    const message = error instanceof Error ? error.message : 'Failed to fetch project info.'
    return response.status(502).json({ error: message })
  }
})

app.get('/api/github/repository-summary', async (request, response) => {
  const url = request.query.url

  if (typeof url !== 'string' || url.trim().length === 0) {
    return response.status(400).json({ error: 'url is required' })
  }

  try {
    const summary = await fetchGitHubRepositorySummary(url)
    return response.status(200).json(summary)
  } catch (error) {
    if (error instanceof GitHubRepositorySummaryError) {
      return response.status(error.statusCode).json({ error: error.message })
    }

    const message = error instanceof Error ? error.message : 'Failed to generate repository summary.'
    return response.status(502).json({ error: message })
  }
})

app.post('/api/github/multi-file-review', async (request, response) => {
  const { repoUrl, filePaths } = request.body as { repoUrl?: unknown; filePaths?: unknown }

  if (typeof repoUrl !== 'string' || repoUrl.trim().length === 0) {
    return response.status(400).json({ error: 'repoUrl is required' })
  }

  if (!Array.isArray(filePaths)) {
    return response.status(400).json({ error: 'filePaths is required' })
  }

  try {
    const review = await reviewGitHubFiles({
      repoUrl,
      filePaths: filePaths as string[],
    })

    return response.status(200).json(review)
  } catch (error) {
    if (error instanceof GitHubMultiFileReviewError) {
      return response.status(error.statusCode).json({ error: error.message })
    }

    const message = error instanceof Error ? error.message : 'Failed to review selected files.'
    return response.status(502).json({ error: message })
  }
})

app.post('/api/review', async (request, response) => {
  const { code, language, filePath } = request.body as Partial<ReviewRequest>

  if (typeof code !== 'string' || code.trim().length === 0) {
    return response.status(400).json({ error: 'code is required' })
  }

  if (typeof language !== 'string' || language.trim().length === 0) {
    return response.status(400).json({ error: 'language is required' })
  }

  try {
    const execution = await reviewCodeWithMetadata({
      code,
      language,
      filePath,
    })

    const review: ReviewResult & { _debug?: ReviewDebugMetadata } = execution.review

    if (process.env.NODE_ENV !== 'production') {
      review._debug = execution.debug
    }

    return response.status(200).json(review)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Review failed'
    return response.status(502).json({ error: message })
  }
})

app.listen(port, () => {
  console.log(`RepoMind AI server running on http://localhost:${port}`)
})
