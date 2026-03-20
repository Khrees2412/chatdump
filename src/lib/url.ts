import { ChatdumpError } from './errors'

const SUPPORTED_HOSTS = new Set([
  'chat.openai.com',
  'chatgpt.com',
])

export function validateShareUrl(rawUrl: string): URL {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ChatdumpError('INVALID_URL', 'invalid URL syntax')
  }

  if (parsed.protocol !== 'https:') {
    throw new ChatdumpError(
      'UNSUPPORTED_URL',
      'unsupported share URL: expected an https ChatGPT share link',
    )
  }

  if (!SUPPORTED_HOSTS.has(parsed.hostname)) {
    throw new ChatdumpError(
      'UNSUPPORTED_URL',
      'unsupported share URL: expected a ChatGPT share link',
    )
  }

  const parts = parsed.pathname.split('/').filter(Boolean)

  if (parts.length !== 2 || parts[0] !== 'share' || !parts[1]) {
    throw new ChatdumpError(
      'UNSUPPORTED_URL',
      'unsupported share URL: expected a /share/<id> path',
    )
  }

  parsed.hash = ''
  parsed.search = ''

  return parsed
}
