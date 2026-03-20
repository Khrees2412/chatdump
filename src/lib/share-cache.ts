import { validateShareUrl } from './url'

export interface CachedShareMarkdown {
  markdown: string
  warnings: string[]
}

const MAX_CACHE_ENTRIES = 200
export const SHARE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

type CacheEntry = CachedShareMarkdown & {
  expiresAt: number
}

const shareMarkdownCache = new Map<string, CacheEntry>()
const inFlightShareRequests = new Map<string, Promise<CachedShareMarkdown>>()

export async function getOrCreateCachedShareMarkdown(
  rawUrl: string,
  loader: () => Promise<CachedShareMarkdown>,
  options: {
    now?: () => number
  } = {},
): Promise<CachedShareMarkdown> {
  const now = options.now ?? Date.now
  const cacheKey = getShareCacheKey(rawUrl)
  const cached = getCachedShareMarkdownByKey(cacheKey, now())

  if (cached) {
    return cached
  }

  const inFlightRequest = inFlightShareRequests.get(cacheKey)

  if (inFlightRequest) {
    return inFlightRequest.then(cloneCachedShareMarkdown)
  }

  const pendingRequest = loader()
    .then((result) => {
      setCachedShareMarkdownByKey(cacheKey, result, now())
      return cloneCachedShareMarkdown(result)
    })
    .finally(() => {
      inFlightShareRequests.delete(cacheKey)
    })

  inFlightShareRequests.set(cacheKey, pendingRequest)

  return pendingRequest.then(cloneCachedShareMarkdown)
}

export function clearShareMarkdownCache() {
  shareMarkdownCache.clear()
  inFlightShareRequests.clear()
}

function getShareCacheKey(rawUrl: string): string {
  return validateShareUrl(rawUrl).toString()
}

function getCachedShareMarkdownByKey(
  cacheKey: string,
  now: number,
): CachedShareMarkdown | null {
  pruneExpiredEntries(now)

  const cachedEntry = shareMarkdownCache.get(cacheKey)

  if (!cachedEntry) {
    return null
  }

  return cloneCachedShareMarkdown(cachedEntry)
}

function setCachedShareMarkdownByKey(
  cacheKey: string,
  result: CachedShareMarkdown,
  now: number,
) {
  shareMarkdownCache.set(cacheKey, {
    ...cloneCachedShareMarkdown(result),
    expiresAt: now + SHARE_CACHE_TTL_MS,
  })

  while (shareMarkdownCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = shareMarkdownCache.keys().next().value

    if (!oldestKey) {
      break
    }

    shareMarkdownCache.delete(oldestKey)
  }
}

function pruneExpiredEntries(now: number) {
  for (const [cacheKey, cachedEntry] of shareMarkdownCache.entries()) {
    if (cachedEntry.expiresAt <= now) {
      shareMarkdownCache.delete(cacheKey)
    }
  }
}

function cloneCachedShareMarkdown(
  result: CachedShareMarkdown,
): CachedShareMarkdown {
  return {
    markdown: result.markdown,
    warnings: [...result.warnings],
  }
}
