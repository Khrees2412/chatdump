import { describe, expect, test } from 'bun:test'
import {
  SHARE_CACHE_TTL_MS,
  clearShareMarkdownCache,
  getOrCreateCachedShareMarkdown,
} from '../share-cache'

const shareUrl = 'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab'

describe('getOrCreateCachedShareMarkdown', () => {
  test('reuses a cached markdown result for the same share URL within the TTL', async () => {
    clearShareMarkdownCache()

    let loaderCalls = 0

    const first = await getOrCreateCachedShareMarkdown(
      `${shareUrl}?ref=abc#fragment`,
      async () => {
        loaderCalls += 1

        return {
          markdown: '# Cached result',
          warnings: ['cached warning'],
        }
      },
    )

    const second = await getOrCreateCachedShareMarkdown(shareUrl, async () => {
      loaderCalls += 1

      return {
        markdown: '# Fresh result',
        warnings: [],
      }
    })

    expect(loaderCalls).toBe(1)
    expect(first).toEqual({
      markdown: '# Cached result',
      warnings: ['cached warning'],
    })
    expect(second).toEqual(first)
  })

  test('expires cached entries after 24 hours', async () => {
    clearShareMarkdownCache()

    let now = 1_000
    let loaderCalls = 0
    const clock = () => now

    await getOrCreateCachedShareMarkdown(
      shareUrl,
      async () => {
        loaderCalls += 1

        return {
          markdown: '# First result',
          warnings: [],
        }
      },
      { now: clock },
    )

    now += SHARE_CACHE_TTL_MS - 1

    const cached = await getOrCreateCachedShareMarkdown(
      shareUrl,
      async () => {
        loaderCalls += 1

        return {
          markdown: '# Unexpected refresh',
          warnings: [],
        }
      },
      { now: clock },
    )

    expect(loaderCalls).toBe(1)
    expect(cached.markdown).toBe('# First result')

    now += 1

    const refreshed = await getOrCreateCachedShareMarkdown(
      shareUrl,
      async () => {
        loaderCalls += 1

        return {
          markdown: '# Refreshed result',
          warnings: ['new warning'],
        }
      },
      { now: clock },
    )

    expect(loaderCalls).toBe(2)
    expect(refreshed).toEqual({
      markdown: '# Refreshed result',
      warnings: ['new warning'],
    })
  })

  test('deduplicates concurrent requests for the same share URL', async () => {
    clearShareMarkdownCache()

    let loaderCalls = 0

    const [first, second] = await Promise.all([
      getOrCreateCachedShareMarkdown(shareUrl, async () => {
        loaderCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))

        return {
          markdown: '# Shared in-flight result',
          warnings: [],
        }
      }),
      getOrCreateCachedShareMarkdown(shareUrl, async () => {
        loaderCalls += 1

        return {
          markdown: '# Duplicate result',
          warnings: ['should not be used'],
        }
      }),
    ])

    expect(loaderCalls).toBe(1)
    expect(first).toEqual({
      markdown: '# Shared in-flight result',
      warnings: [],
    })
    expect(second).toEqual(first)
  })
})
