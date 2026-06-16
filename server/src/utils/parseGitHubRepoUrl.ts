export type ParsedGitHubRepo = {
  owner: string
  repo: string
}

function trimTrailingGitSuffix(value: string) {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepo | null {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(url)
  } catch {
    return null
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return null
  }

  if (parsedUrl.hostname !== 'github.com') {
    return null
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean)

  if (segments.length !== 2) {
    return null
  }

  const owner = segments[0]
  const repo = trimTrailingGitSuffix(segments[1])

  if (!owner || !repo) {
    return null
  }

  if (repo.includes('.') && !segments[1].endsWith('.git')) {
    return null
  }

  return {
    owner,
    repo,
  }
}
