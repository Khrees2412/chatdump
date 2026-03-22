import { describe, expect, test } from 'bun:test'
import {
  SHARE_CACHE_TTL_MS,
  clearShareConversationCache,
  deleteShareConversationCacheEntry,
  getOrCreateCachedShareConversation,
} from '../share-cache'
import type { NormalizedConversation } from '../types'

const shareUrl = 'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab'
const geminiShareUrl = 'https://gemini.google.com/share/ee5bab956b9f'

describe('getOrCreateCachedShareConversation', () => {
  const makeConversation = (title: string): NormalizedConversation => ({
    conversationId: 'cached',
    createdAt: '2026-03-20T00:00:00.000Z',
    messages: [],
    sourceUrl: shareUrl,
    title,
  })

  test('reuses a cached conversation for the same share URL within the TTL', async () => {
    clearShareConversationCache()

    let loaderCalls = 0

    const first = await getOrCreateCachedShareConversation(
      `${shareUrl}?src=cli`,
      async () => {
        loaderCalls += 1

        return {
          conversation: makeConversation('First'),
          warnings: ['cached warning'],
        }
      },
    )

    const second = await getOrCreateCachedShareConversation(
      shareUrl,
      async () => {
        loaderCalls += 1

        return {
          conversation: makeConversation('Second'),
          warnings: [],
        }
      },
    )

    expect(loaderCalls).toBe(1)
    expect(first.warnings).toEqual(['cached warning'])
    expect(first.conversation.title).toBe('First')
    expect(second.warnings).toEqual(first.warnings)
    expect(second.conversation.title).toBe('First')
  })

  test('expires cached entries after 24 hours', async () => {
    clearShareConversationCache()

    let now = 1_000
    let loaderCalls = 0
    const clock = () => now

    await getOrCreateCachedShareConversation(
      shareUrl,
      async () => {
        loaderCalls += 1

        return {
          conversation: makeConversation('Original'),
          warnings: [],
        }
      },
      { now: clock },
    )

    now += SHARE_CACHE_TTL_MS - 1

    const cached = await getOrCreateCachedShareConversation(
      shareUrl,
      async () => {
        loaderCalls += 1

        return {
          conversation: makeConversation('Should not appear'),
          warnings: [],
        }
      },
      { now: clock },
    )

    expect(loaderCalls).toBe(1)
    expect(cached.conversation.title).toBe('Original')

    now += 1

    const refreshed = await getOrCreateCachedShareConversation(
      shareUrl,
      async () => {
        loaderCalls += 1

        return {
          conversation: makeConversation('Refreshed result'),
          warnings: ['new warning'],
        }
      },
      { now: clock },
    )

    expect(loaderCalls).toBe(2)
    expect(refreshed.conversation.title).toBe('Refreshed result')
    expect(refreshed.warnings).toEqual(['new warning'])
  })

  test('deduplicates concurrent requests for the same share URL', async () => {
    clearShareConversationCache()

    let loaderCalls = 0

    const [first, second] = await Promise.all([
      getOrCreateCachedShareConversation(shareUrl, async () => {
        loaderCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))

        return {
          conversation: makeConversation('Shared result'),
          warnings: [],
        }
      }),
      getOrCreateCachedShareConversation(shareUrl, async () => {
        loaderCalls += 1

        return {
          conversation: makeConversation('Ignored result'),
          warnings: ['should not be used'],
        }
      }),
    ])

    expect(loaderCalls).toBe(1)
    expect(first.conversation.title).toBe('Shared result')
    expect(second.conversation.title).toBe('Shared result')
    expect(first.warnings).toEqual([])
    expect(second.warnings).toEqual([])
  })

  test('reuses cached Gemini conversations across canonical and short links', async () => {
    clearShareConversationCache()

    let loaderCalls = 0

    const first = await getOrCreateCachedShareConversation(
      'https://g.co/gemini/share/ee5bab956b9f?hl=en',
      async () => {
        loaderCalls += 1

        return {
          conversation: {
            conversationId: 'gemini-cached',
            createdAt: '2026-03-20T00:00:00.000Z',
            messages: [],
            sourceUrl: geminiShareUrl,
            title: 'Gemini Cached Result',
          },
          warnings: [],
        }
      },
    )

    const second = await getOrCreateCachedShareConversation(
      geminiShareUrl,
      async () => {
        loaderCalls += 1

        return {
          conversation: {
            conversationId: 'gemini-cached-2',
            createdAt: '2026-03-20T00:00:00.000Z',
            messages: [],
            sourceUrl: geminiShareUrl,
            title: 'Should not be used',
          },
          warnings: ['unexpected'],
        }
      },
    )

    expect(loaderCalls).toBe(1)
    expect(first.conversation.title).toBe('Gemini Cached Result')
    expect(second.conversation.title).toBe('Gemini Cached Result')
    expect(second.warnings).toEqual([])
  })

  test('removes a cached entry when the matching URL is deleted', async () => {
    clearShareConversationCache()

    let loaderCalls = 0

    await getOrCreateCachedShareConversation(shareUrl, async () => {
      loaderCalls += 1

      return {
        conversation: makeConversation('Initial'),
        warnings: [],
      }
    })

    deleteShareConversationCacheEntry(`${shareUrl}?src=history`)

    const refreshed = await getOrCreateCachedShareConversation(shareUrl, async () => {
      loaderCalls += 1

      return {
        conversation: makeConversation('Reloaded'),
        warnings: [],
      }
    })

    expect(loaderCalls).toBe(2)
    expect(refreshed.conversation.title).toBe('Reloaded')
  })
})
