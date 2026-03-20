import { ChatdumpError } from './errors'

export type ShareProvider = 'chatgpt' | 'gemini'

export interface ParsedShareUrl {
  provider: ShareProvider
  shareId: string
  url: URL
}

const DEFAULT_CONVERSATION_TITLE = 'Shared Conversation'

const PROVIDER_DETAILS: Record<
  ShareProvider,
  {
    canonicalHost: string
  }
> = {
  chatgpt: {
    canonicalHost: 'chatgpt.com',
  },
  gemini: {
    canonicalHost: 'gemini.google.com',
  },
}

export function normalizeShareUrl(rawUrl: string): ParsedShareUrl {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ChatdumpError('INVALID_URL', 'invalid URL syntax')
  }

  if (parsed.protocol !== 'https:') {
    throw new ChatdumpError(
      'UNSUPPORTED_URL',
      'unsupported share URL: expected an https public share link',
    )
  }

  const hostname = parsed.hostname.toLowerCase()
  const parts = parsed.pathname.split('/').filter(Boolean)
  const shareId = readShareId(hostname, parts)

  if (!shareId) {
    throw new ChatdumpError(
      'UNSUPPORTED_URL',
      'unsupported share URL: expected a public share link',
    )
  }

  const provider = getProviderForHost(hostname)

  parsed.hostname = PROVIDER_DETAILS[provider].canonicalHost
  parsed.hash = ''
  parsed.pathname = `share/${shareId}`
  parsed.search = ''

  return {
    provider,
    shareId,
    url: parsed,
  }
}

export function validateShareUrl(rawUrl: string): URL {
  return normalizeShareUrl(rawUrl).url
}

export function tryNormalizeShareUrl(rawUrl: string): ParsedShareUrl | null {
  try {
    return normalizeShareUrl(rawUrl)
  } catch {
    return null
  }
}

export function getDefaultConversationTitle(rawUrl?: string | null): string {
  void rawUrl
  return DEFAULT_CONVERSATION_TITLE
}

function getProviderForHost(hostname: string): ShareProvider {
  switch (hostname) {
    case 'chat.openai.com':
    case 'chatgpt.com':
      return 'chatgpt'
    case 'g.co':
    case 'gemini.google.com':
      return 'gemini'
    default:
      throw new ChatdumpError(
        'UNSUPPORTED_URL',
        'unsupported share URL: expected a public share link',
      )
  }
}

function readShareId(
  hostname: string,
  pathParts: string[],
): string | null {
  if (
    (hostname === 'chat.openai.com' || hostname === 'chatgpt.com') &&
    pathParts.length === 2 &&
    pathParts[0] === 'share' &&
    pathParts[1]
  ) {
    return pathParts[1]
  }

  if (
    hostname === 'gemini.google.com' &&
    pathParts.length === 2 &&
    pathParts[0] === 'share' &&
    pathParts[1]
  ) {
    return pathParts[1]
  }

  if (
    hostname === 'g.co' &&
    pathParts.length === 3 &&
    pathParts[0] === 'gemini' &&
    pathParts[1] === 'share' &&
    pathParts[2]
  ) {
    return pathParts[2]
  }

  return null
}
