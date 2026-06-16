# RepoMind AI

RepoMind AI is an AI-powered code review app with a React + Vite frontend and an Express + TypeScript backend.

It supports:
- Reviewing pasted code
- Reviewing a single file from a GitHub repository
- Parsing GitHub repositories
- Detecting project info and repository structure
- Generating repository summaries
- Reviewing multiple selected files from a repo

## Live Deployment

- Frontend: https://repomind-ai-promax.vercel.app
- Backend: https://repomind-ai-i4h7.onrender.com
- Health check: https://repomind-ai-i4h7.onrender.com/health

## Tech Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express, TypeScript
- Styling: Plain CSS
- API integrations: GitHub API and Groq-powered review services

## Project Structure

```text
repomind-ai/
  client/   # Vite frontend
  server/   # Express backend
```

## Features

- Code review by language
- GitHub repository parsing
- Repository tree browsing
- File-level content fetching
- Project type and dependency detection
- Repository summary generation
- Multi-file cross-file review
- Local review history in the browser

## Environment Variables

### Frontend

Create `client/.env` for local development:

```env
VITE_API_URL=http://localhost:5000
```

For Vercel, set:

```env
VITE_API_URL=https://repomind-ai-i4h7.onrender.com
```

### Backend

Create `server/.env` for local development:

```env
GROQ_API_KEY=your_groq_api_key_here
GITHUB_TOKEN=optional_github_token_here
```

Notes:
- `GROQ_API_KEY` is required for AI review features.
- `GITHUB_TOKEN` is optional, but helpful for avoiding GitHub API rate limits.
- Do not commit real secrets to the repository.

## Local Development

### 1. Install dependencies

From the repo root:

```bash
npm install
cd client && npm install
cd ../server && npm install
```

### 2. Configure environment files

Create:

- `client/.env`
- `server/.env`

You can copy the example files:

- `client/.env.example`
- `server/.env.example`

### 3. Start the backend

From the repo root:

```bash
npm run dev:server
```

The backend runs on:

```text
http://localhost:5000
```

### 4. Start the frontend

From the repo root:

```bash
npm run dev:client
```

The frontend runs on the Vite dev server, usually:

```text
http://localhost:5173
```

## Build Commands

From the repo root:

```bash
npm run build:server
npm run build:client
```

## Deployment Notes

### Backend on Render

- Render should deploy the `server` app
- Ensure `GROQ_API_KEY` is set in Render environment variables
- Add `GITHUB_TOKEN` in Render if you want authenticated GitHub API calls

### Frontend on Vercel

- Set `VITE_API_URL=https://repomind-ai-i4h7.onrender.com`
- No backend secrets should be exposed in the frontend

## API Health Check

The backend exposes:

```text
GET /health
```

Expected response:

```json
{ "status": "ok" }
```

## License

No license has been added yet.
