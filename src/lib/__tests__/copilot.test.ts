import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createCopilotShareConversationApiUrl,
  extractCopilotConversationPayloads,
  isCopilotShareConversationResponseUrl,
} from '../copilot'
import { convertShareUrlToMarkdown } from '../extract'
import { clearShareConversationCache } from '../share-cache'

function buildCopilotShareResponse(): string {
  return JSON.stringify({
    conversationTitle: 'Overview of the United States',
    messages: [
      {
        author: 'ai',
        content: [
          {
            partId: 'assistant-text-1',
            text: 'The **United States** is a federal republic of 50 states.',
            type: 'text',
          },
          {
            partId: 'assistant-citation-1',
            publisher: 'Wikipedia',
            title: 'United States - Wikipedia',
            type: 'citation',
            url: 'https://en.wikipedia.org/wiki/United_States',
          },
          {
            partId: 'assistant-citation-2',
            publisher: 'Britannica',
            title: 'United States | History, Map, Flag, & Population | Britannica',
            type: 'citation',
            url: 'https://www.britannica.com/place/United-States',
          },
        ],
        createdAt: '2026-03-20T23:23:22.150+00:00',
        id: 'assistant-message-1',
      },
      {
        author: 'human',
        content: [
          {
            partId: 'user-text-1',
            text: 'tell me about the US',
            type: 'text',
          },
        ],
        createdAt: '2026-03-20T23:23:22.141+00:00',
        id: 'user-message-1',
      },
    ],
  })
}

describe('extractCopilotConversationPayloads', () => {
  test('parses Copilot share responses into normalized messages', () => {
    const payloads = extractCopilotConversationPayloads(buildCopilotShareResponse())

    expect(payloads).toHaveLength(1)

    const [conversation] = payloads
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : []

    expect(conversation?.title).toBe('Overview of the United States')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      author: {
        name: 'Copilot',
        role: 'assistant',
      },
      created_at: '2026-03-20T23:23:22.150Z',
      role: 'assistant',
    })
    expect(messages[0]?.content).toEqual({
      parts: [
        'The **United States** is a federal republic of 50 states.',
        [
          'Sources:',
          '',
          '- [United States - Wikipedia](https://en.wikipedia.org/wiki/United_States)',
          '- [United States | History, Map, Flag, & Population | Britannica](https://www.britannica.com/place/United-States)',
        ].join('\n'),
      ],
    })
    expect(messages[1]).toMatchObject({
      created_at: '2026-03-20T23:23:22.141Z',
      role: 'user',
    })
  })

  test('recognizes Copilot share conversation response URLs', () => {
    expect(
      isCopilotShareConversationResponseUrl(
        'https://copilot.microsoft.com/c/api/conversations/shares/RPq5nxaEsHmgN8dK842Wq',
      ),
    ).toBe(true)
    expect(
      isCopilotShareConversationResponseUrl(
        'https://copilot.microsoft.com/c/api/conversations/shares/RPq5nxaEsHmgN8dK842Wq/preview',
      ),
    ).toBe(false)
  })

  test('builds the Copilot share conversation API URL from a share page URL', () => {
    expect(
      createCopilotShareConversationApiUrl(
        new URL('https://copilot.microsoft.com/shares/RPq5nxaEsHmgN8dK842Wq'),
      ).toString(),
    ).toBe(
      'https://copilot.microsoft.com/c/api/conversations/shares/RPq5nxaEsHmgN8dK842Wq',
    )
  })
})

describe('convertShareUrlToMarkdown with Copilot shares', () => {
  beforeEach(() => {
    clearShareConversationCache()
  })

  test('supports Copilot share URLs through direct share payload extraction', async () => {
    const shareUrl =
      'https://copilot.microsoft.com/shares/RPq5nxaEsHmgN8dK842Wq?conversation=1'

    const result = await convertShareUrlToMarkdown(shareUrl, {
      fetchImpl: async (input) => {
        const url = String(input)

        if (
          url ===
          'https://copilot.microsoft.com/c/api/conversations/shares/RPq5nxaEsHmgN8dK842Wq'
        ) {
          return new Response(buildCopilotShareResponse(), {
            headers: {
              'content-type': 'application/json',
            },
            status: 200,
          })
        }

        throw new Error(`Unexpected fetch: ${url}`)
      },
    })

    expect(result.conversation.sourceUrl).toBe(
      'https://copilot.microsoft.com/shares/RPq5nxaEsHmgN8dK842Wq',
    )
    expect(result.conversation.title).toBe('Overview of the United States')
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(result.warnings).toEqual([])
    expect(result.markdown).toContain('# Overview of the United States')
    expect(result.markdown).toContain(
      'Source: https://copilot.microsoft.com/shares/RPq5nxaEsHmgN8dK842Wq',
    )
    expect(result.markdown).toContain('## Assistant (Copilot)')
    expect(result.markdown).toContain(
      'The **United States** is a federal republic of 50 states.',
    )
    expect(result.markdown).toContain('Sources:')
    expect(result.markdown).toContain(
      '- [United States - Wikipedia](https://en.wikipedia.org/wiki/United_States)',
    )
  })
})
