import { beforeEach, describe, expect, test } from 'bun:test'
import { extractClaudeConversationPayloads } from '../claude'
import { convertShareUrlToMarkdown } from '../extract'
import { clearShareConversationCache } from '../share-cache'

function buildClaudeSnapshotResponse(): string {
  return JSON.stringify({
    chat_messages: [
      {
        attachments: [
          {
            file_name: 'brief.pdf',
            mime_type: 'application/pdf',
            url: 'https://example.com/brief.pdf',
          },
        ],
        content: [
          {
            citations: [],
            text: 'Which model is better for complex coding tasks?',
            type: 'text',
          },
        ],
        created_at: '2026-03-20T02:11:12.313151Z',
        files: [],
        sender: 'human',
        uuid: 'human-1',
      },
      {
        attachments: [],
        content: [
          {
            message: 'Searched the web',
            name: 'web_search',
            type: 'tool_use',
          },
          {
            content: [
              {
                text: 'internal tool result that should not be rendered',
                type: 'text',
              },
            ],
            type: 'tool_result',
          },
          {
            citations: [],
            text: 'For terminal-heavy work, Codex is stronger. For high-level reasoning, Opus remains competitive.',
            type: 'text',
          },
        ],
        created_at: '2026-03-20T02:11:14.313151Z',
        files: [],
        sender: 'assistant',
        uuid: 'assistant-1',
      },
    ],
    conversation_uuid: 'e781bbee-815f-4a3b-807d-dc7d9df20625',
    created_at: '2026-03-20T03:22:49.523597Z',
    snapshot_name: 'Codex vs Opus for complex coding tasks',
    uuid: '51c6593c-c94b-4708-ba87-92e60b693f7b',
  })
}

describe('extractClaudeConversationPayloads', () => {
  test('parses Claude snapshot responses into normalized messages', () => {
    const payloads = extractClaudeConversationPayloads(buildClaudeSnapshotResponse())

    expect(payloads).toHaveLength(1)

    const [conversation] = payloads
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : []

    expect(conversation?.conversation_id).toBe('e781bbee-815f-4a3b-807d-dc7d9df20625')
    expect(conversation?.title).toBe('Codex vs Opus for complex coding tasks')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      created_at: '2026-03-20T02:11:12.313151Z',
      role: 'user',
    })
    expect(messages[0]?.attachments).toEqual([
      {
        mime_type: 'application/pdf',
        name: 'brief.pdf',
        url: 'https://example.com/brief.pdf',
      },
    ])
    expect(messages[1]).toMatchObject({
      author: { name: 'Claude', role: 'assistant' },
      created_at: '2026-03-20T02:11:14.313151Z',
      role: 'assistant',
    })
    expect(messages[1]?.content).toEqual({
      parts: [
        'Searched the web',
        'For terminal-heavy work, Codex is stronger. For high-level reasoning, Opus remains competitive.',
      ],
    })
  })
})

describe('convertShareUrlToMarkdown with Claude shares', () => {
  beforeEach(() => {
    clearShareConversationCache()
  })

  test('falls back to browser extraction when Claude share fetches are blocked', async () => {
    const payloads = extractClaudeConversationPayloads(buildClaudeSnapshotResponse())

    const result = await convertShareUrlToMarkdown(
      'https://claude.ai/share/51c6593c-c94b-4708-ba87-92e60b693f7b',
      {
        browserExtractor: async (url) => ({
          payloads,
          sourceUrl: url,
        }),
        fetchImpl: async () =>
          new Response('blocked', {
            headers: {
              'content-type': 'text/html',
            },
            status: 403,
          }),
      },
    )

    expect(result.conversation.sourceUrl).toBe(
      'https://claude.ai/share/51c6593c-c94b-4708-ba87-92e60b693f7b',
    )
    expect(result.conversation.title).toBe('Codex vs Opus for complex coding tasks')
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(result.markdown).toContain('# Codex vs Opus for complex coding tasks')
    expect(result.markdown).toContain(
      'Source: https://claude.ai/share/51c6593c-c94b-4708-ba87-92e60b693f7b',
    )
    expect(result.markdown).toContain('## Assistant (Claude)')
    expect(result.markdown).toContain('Searched the web')
    expect(result.markdown).toContain('[Attachment: brief.pdf](https://example.com/brief.pdf)')
  })
})
