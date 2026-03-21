import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createGrokShareConversationApiUrl,
  extractGrokConversationPayloads,
  isGrokShareConversationResponseUrl,
} from '../grok'
import { convertShareUrlToMarkdown } from '../extract'
import { clearShareConversationCache } from '../share-cache'

function buildGrokShareResponse(): string {
  return JSON.stringify({
    allowIndexing: true,
    conversation: {
      conversationId: '35c7683a-8a9c-4718-b237-b07669900a77',
      createTime: '2026-03-20T22:44:53.139787Z',
      modifyTime: '2026-03-20T22:48:36.106Z',
      title: 'Soviet Union: History and Legacy',
    },
    responses: [
      {
        createTime: '2026-03-20T22:44:53.172Z',
        fileAttachments: [
          {
            fileName: 'notes.txt',
            mimeType: 'text/plain',
            url: 'https://assets.grok.com/notes.txt',
          },
        ],
        generatedImageUrls: [],
        imageAttachments: [],
        message: 'tell me about the soviet union',
        responseId: '34eddbe8-4767-453a-ab4c-fce688989c35',
        sender: 'human',
      },
      {
        createTime: '2026-03-20T22:45:08.721Z',
        fileAttachments: [],
        generatedImageUrls: ['https://assets.grok.com/generated/soviet-map.png'],
        imageAttachments: [],
        message:
          'The **Soviet Union** existed from **1922 to 1991**.\n\n### Origins\nIt emerged after the Russian Revolution.',
        model: 'grok-4-auto',
        parentResponseId: '34eddbe8-4767-453a-ab4c-fce688989c35',
        responseId: 'e238216f-9969-4f85-9099-130f25f73135',
        sender: 'assistant',
      },
      {
        createTime: '2026-03-20T22:48:24.232Z',
        fileAttachments: [],
        generatedImageUrls: [],
        imageAttachments: [],
        message: 'how did it end?',
        responseId: '0bfe9884-0ad3-43fe-b6f7-a670ec750795',
        sender: 'human',
      },
      {
        createTime: '2026-03-20T22:48:36.106Z',
        fileAttachments: [],
        generatedImageUrls: [],
        imageAttachments: [],
        message:
          'The **Soviet Union ended** in late **1991** after failed reforms, nationalist movements, and the August coup attempt.',
        model: 'grok-4-auto',
        parentResponseId: '0bfe9884-0ad3-43fe-b6f7-a670ec750795',
        responseId: 'caf16d0a-d0a7-438d-8e73-5ae8859c6513',
        sender: 'assistant',
      },
    ],
  })
}

describe('extractGrokConversationPayloads', () => {
  test('parses Grok share responses into normalized messages', () => {
    const payloads = extractGrokConversationPayloads(buildGrokShareResponse())

    expect(payloads).toHaveLength(1)

    const [conversation] = payloads
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : []

    expect(conversation?.conversation_id).toBe(
      '35c7683a-8a9c-4718-b237-b07669900a77',
    )
    expect(conversation?.title).toBe('Soviet Union: History and Legacy')
    expect(messages).toHaveLength(4)
    expect(messages[0]).toMatchObject({
      attachments: [
        {
          mime_type: 'text/plain',
          name: 'notes.txt',
          url: 'https://assets.grok.com/notes.txt',
        },
      ],
      created_at: '2026-03-20T22:44:53.172Z',
      role: 'user',
    })
    expect(messages[1]).toMatchObject({
      author: { name: 'Grok', role: 'assistant' },
      created_at: '2026-03-20T22:45:08.721Z',
      role: 'assistant',
    })
    expect(messages[1]?.content).toEqual({
      parts: [
        'The **Soviet Union** existed from **1922 to 1991**.\n\n### Origins\nIt emerged after the Russian Revolution.',
        {
          content_type: 'image',
          label: 'Generated image 1',
          url: 'https://assets.grok.com/generated/soviet-map.png',
        },
      ],
    })
  })

  test('recognizes Grok share conversation response URLs', () => {
    expect(
      isGrokShareConversationResponseUrl(
        'https://grok.com/rest/app-chat/share_links/c2hhcmQtNQ_f461c973-f826-418e-9e7e-8097b676b357',
      ),
    ).toBe(true)
    expect(
      isGrokShareConversationResponseUrl('https://grok.com/share/example'),
    ).toBe(false)
  })

  test('builds the Grok share conversation API URL from a share page URL', () => {
    expect(
      createGrokShareConversationApiUrl(
        new URL(
          'https://grok.com/share/c2hhcmQtNQ_f461c973-f826-418e-9e7e-8097b676b357',
        ),
      ).toString(),
    ).toBe(
      'https://grok.com/rest/app-chat/share_links/c2hhcmQtNQ_f461c973-f826-418e-9e7e-8097b676b357',
    )
  })
})

describe('convertShareUrlToMarkdown with Grok shares', () => {
  beforeEach(() => {
    clearShareConversationCache()
  })

  test('supports Grok share URLs through direct share payload extraction', async () => {
    const shareUrl =
      'https://grok.com/share/c2hhcmQtNQ_f461c973-f826-418e-9e7e-8097b676b357?rid=abc123'

    const result = await convertShareUrlToMarkdown(shareUrl, {
      fetchImpl: async (input) => {
        const url = String(input)

        if (
          url ===
          'https://grok.com/rest/app-chat/share_links/c2hhcmQtNQ_f461c973-f826-418e-9e7e-8097b676b357'
        ) {
          return new Response(buildGrokShareResponse(), {
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
      'https://grok.com/share/c2hhcmQtNQ_f461c973-f826-418e-9e7e-8097b676b357',
    )
    expect(result.conversation.title).toBe('Soviet Union: History and Legacy')
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(result.warnings).toEqual([])
    expect(result.markdown).toContain('# Soviet Union: History and Legacy')
    expect(result.markdown).toContain(
      'Source: https://grok.com/share/c2hhcmQtNQ_f461c973-f826-418e-9e7e-8097b676b357',
    )
    expect(result.markdown).toContain('## Assistant (Grok)')
    expect(result.markdown).toContain('[Attachment: notes.txt](https://assets.grok.com/notes.txt)')
    expect(result.markdown).toContain(
      '![Generated image 1](https://assets.grok.com/generated/soviet-map.png)',
    )
    expect(result.markdown).toContain(
      'The **Soviet Union ended** in late **1991**',
    )
  })
})
