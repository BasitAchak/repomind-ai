const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

export function getGitHubRequestHeaders() {
  const token = process.env.GITHUB_TOKEN?.trim()

  if (!token) {
    return githubHeaders
  }

  return {
    ...githubHeaders,
    Authorization: `Bearer ${token}`,
  }
}

export function isGitHubRateLimitResponse(status: number, bodyText: string) {
  const lowerBody = bodyText.toLowerCase()

  return (
    status === 403 &&
    (lowerBody.includes('rate limit') || lowerBody.includes('api rate limit'))
  )
}
