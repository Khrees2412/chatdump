import { beforeEach, describe, expect, test } from 'bun:test'
import { convertShareUrlToMarkdown } from '../extract'
import { extractGeminiConversationPayloads } from '../gemini'
import { clearShareConversationCache } from '../share-cache'

type GeminiTurnFixture = {
  assistantText: string
  createdAt: [number, number]
  userText: string
}

function buildGeminiBatchedResponse(options: {
  modelLabel?: string
  publishedAt?: [number, number]
  shareId: string
  title: string
  turns: GeminiTurnFixture[]
}): string {
  const modelKey = 'model_1'
  const shareMetadata = [
    true,
    options.title,
    null,
    null,
    null,
    ['', '', ''],
    null,
    [2, modelKey, options.modelLabel ?? 'Fast'],
    true,
  ]
  const shareRecord = [
    null,
    options.turns.map((turn, index) => [
      [`conversation_${index + 1}`, `response_${index + 1}`],
      null,
      [[turn.userText]],
      [[[`response_${index + 1}`, [turn.assistantText]]]],
      turn.createdAt,
    ]),
    shareMetadata,
    options.shareId,
    options.publishedAt ?? options.turns[0]?.createdAt ?? [0, 0],
    null,
    null,
  ]
  const innerPayload = JSON.stringify([shareRecord, null, false])
  const wrapper = JSON.stringify([
    ['wrb.fr', 'ujx1Bf', innerPayload, null, null, null, 'generic'],
  ])

  return [')]}\'', '', String(wrapper.length), wrapper, '0', '[]'].join('\n')
}

describe('extractGeminiConversationPayloads', () => {
  test('parses Gemini batchexecute transcript payloads into normalized messages', () => {
    const payloads = extractGeminiConversationPayloads(
      buildGeminiBatchedResponse({
        shareId: 'ee5bab956b9f',
        title: 'Repo Sync Plan',
        turns: [
          {
            assistantText: 'Use GraphQL history pagination.',
            createdAt: [1772028570, 583237000],
            userText: 'How do I fetch commits from oldest to newest?',
          },
          {
            assistantText: 'Use `COPY` for the write path.',
            createdAt: [1772041596, 761356000],
            userText: 'What about SQL insertion speed?',
          },
        ],
      }),
    )

    expect(payloads).toHaveLength(1)

    const [conversation] = payloads
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : []

    expect(conversation?.conversation_id).toBe('ee5bab956b9f')
    expect(conversation?.title).toBe('Repo Sync Plan')
    expect(messages).toHaveLength(4)
    expect(messages[0]).toMatchObject({
      created_at: '2026-02-25T14:09:30.583Z',
      role: 'user',
      text: 'How do I fetch commits from oldest to newest?',
    })
    expect(messages[1]).toMatchObject({
      author: { name: 'Gemini Fast', role: 'assistant' },
      created_at: '2026-02-25T14:09:30.583Z',
      role: 'assistant',
      text: 'Use GraphQL history pagination.',
    })
    expect(messages[3]).toMatchObject({
      author: { name: 'Gemini Fast', role: 'assistant' },
      created_at: '2026-02-25T17:46:36.761Z',
      role: 'assistant',
      text: 'Use `COPY` for the write path.',
    })
  })
})

describe('convertShareUrlToMarkdown with Gemini shares', () => {
  beforeEach(() => {
    clearShareConversationCache()
  })

  test('supports Gemini share URLs through browser payload extraction', async () => {
    const payloads = extractGeminiConversationPayloads(
      buildGeminiBatchedResponse({
        shareId: 'ee5bab956b9f',
        title: 'Repo Sync Plan',
        turns: [
          {
            assistantText: 'Use GraphQL history pagination.',
            createdAt: [1772028570, 583237000],
            userText: 'How do I fetch commits from oldest to newest?',
          },
          {
            assistantText:
              'Use `COPY` for the write path and batch by commit timestamp.',
            createdAt: [1772041596, 761356000],
            userText: 'What about SQL insertion speed?',
          },
        ],
      }),
    )

    const result = await convertShareUrlToMarkdown(
      'https://g.co/gemini/share/ee5bab956b9f?hl=en',
      {
        browserExtractor: async (url) => ({
          payloads,
          sourceUrl: url,
        }),
        fetchImpl: async () =>
          new Response(
            `
<!doctype html>
<html>
  <head>
    <title>Gemini - Repo Sync Plan</title>
  </head>
  <body>
    <chat-app id="app-root"></chat-app>
  </body>
</html>
`,
            {
              headers: {
                'content-type': 'text/html',
              },
              status: 200,
            },
          ),
      },
    )

    expect(result.conversation.sourceUrl).toBe(
      'https://gemini.google.com/share/ee5bab956b9f',
    )
    expect(result.conversation.title).toBe('Repo Sync Plan')
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(result.warnings).toEqual([])
    expect(result.markdown).toContain('# Repo Sync Plan')
    expect(result.markdown).toContain(
      'Source: https://gemini.google.com/share/ee5bab956b9f',
    )
    expect(result.markdown).toContain('## Assistant (Gemini Fast)')
    expect(result.markdown).toContain('Use `COPY` for the write path')
  })
})
