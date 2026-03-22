import { validateShareUrl } from './url'
import type { NormalizedConversation } from './types'

export interface CachedShareConversation {
  conversation: NormalizedConversation
  warnings: string[]
}

const MAX_CACHE_ENTRIES = 200
export const SHARE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

type CacheEntry = CachedShareConversation & {
  expiresAt: number
}

const shareConversationCache = new Map<string, CacheEntry>()
const inFlightShareRequests = new Map<string, Promise<CachedShareConversation>>()

export async function getOrCreateCachedShareConversation(
  rawUrl: string,
  loader: () => Promise<CachedShareConversation>,
  options: {
    now?: () => number
  } = {},
): Promise<CachedShareConversation> {
  const now = options.now ?? Date.now
  const cacheKey = getShareCacheKey(rawUrl)
  const cached = getCachedShareConversationByKey(cacheKey, now())

  if (cached) {
    return cached
  }

  const inFlightRequest = inFlightShareRequests.get(cacheKey)

  if (inFlightRequest) {
    return inFlightRequest.then(cloneCachedShareConversation)
  }

  const pendingRequest = loader()
    .then((result) => {
      setCachedShareConversationByKey(cacheKey, result, now())
      return cloneCachedShareConversation(result)
    })
    .finally(() => {
      inFlightShareRequests.delete(cacheKey)
    })

  inFlightShareRequests.set(cacheKey, pendingRequest)

  return pendingRequest.then(cloneCachedShareConversation)
}

export function clearShareConversationCache() {
  shareConversationCache.clear()
  inFlightShareRequests.clear()
}

export function deleteShareConversationCacheEntry(rawUrl: string) {
  shareConversationCache.delete(getShareCacheKey(rawUrl))
}

function getShareCacheKey(rawUrl: string): string {
  return validateShareUrl(rawUrl).toString()
}

function getCachedShareConversationByKey(
  cacheKey: string,
  now: number,
): CachedShareConversation | null {
  pruneExpiredEntries(now)

  const cachedEntry = shareConversationCache.get(cacheKey)

  if (!cachedEntry) {
    return null
  }

  return cloneCachedShareConversation(cachedEntry)
}

function setCachedShareConversationByKey(
  cacheKey: string,
  result: CachedShareConversation,
  now: number,
) {
  shareConversationCache.set(cacheKey, {
    ...cloneCachedShareConversation(result),
    expiresAt: now + SHARE_CACHE_TTL_MS,
  })

  while (shareConversationCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = shareConversationCache.keys().next().value

    if (!oldestKey) {
      break
    }

    shareConversationCache.delete(oldestKey)
  }
}

function pruneExpiredEntries(now: number) {
  for (const [cacheKey, cachedEntry] of shareConversationCache.entries()) {
    if (cachedEntry.expiresAt <= now) {
      shareConversationCache.delete(cacheKey)
    }
  }
}

function cloneCachedShareConversation(
  result: CachedShareConversation,
): CachedShareConversation {
  return {
    conversation: cloneConversation(result.conversation),
    warnings: [...result.warnings],
  }
}

function cloneConversation(
  conversation: NormalizedConversation,
): NormalizedConversation {
  if (typeof structuredClone === 'function') {
    return structuredClone(conversation)
  }

  return JSON.parse(JSON.stringify(conversation))
}
