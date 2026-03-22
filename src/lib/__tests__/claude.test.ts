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
    expect(result.markdown).toContain('## Assistant')
    expect(result.markdown).toContain('Searched the web')
    expect(result.markdown).toContain('[Attachment: brief.pdf](https://example.com/brief.pdf)')
  })

  test('falls back to Claude shared DOM extraction for returned web images', async () => {
    const result = await convertShareUrlToMarkdown(
      'https://claude.ai/share/c90be06f-ad89-4e34-be25-05691b1b430a',
      {
        browserExtractor: async (url) => ({
          html: `
<!doctype html>
<html>
  <head>
    <title>Cloudflare proxy benefits for domains</title>
  </head>
  <body>
    <div data-testid="user-message">
      <p>generate an image of a cloud</p>
    </div>
    <div class="standard-markdown">
      <p>I can't generate images.</p>
    </div>
    <div data-testid="user-message">
      <p>just do it</p>
    </div>
    <div class="standard-markdown">
      <p>There you go ☁️</p>
      <figure>
        <img alt="Blue Sky and White Clouds · Free Stock Photo" src="https://images.pexels.com/photos/231009/pexels-photo-231009.jpeg?cs=srgb&amp;dl=background-blue-blue-sky-231009.jpg&amp;fm=jpg" />
      </figure>
      <figure>
        <img alt="Blue Sky White Clouds Wallpaper Hd at Kaitlyn Corkill blog" src="https://images.freeimages.com/images/large-previews/7c9/white-clouds-in-blue-sky-1163502.jpg" />
      </figure>
    </div>
  </body>
</html>
`,
          payloads: [],
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

    expect(result.conversation.title).toBe('Cloudflare proxy benefits for domains')
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(result.warnings).toContain('Fell back to DOM extraction; formatting may be lossy.')
    expect(result.markdown).toContain('## Assistant')
    expect(result.markdown).toContain('There you go ☁️')
    expect(result.markdown).toContain(
      '![Blue Sky and White Clouds · Free Stock Photo](https://images.pexels.com/photos/231009/pexels-photo-231009.jpeg?cs=srgb&dl=background-blue-blue-sky-231009.jpg&fm=jpg)',
    )
    expect(result.markdown).toContain(
      '![Blue Sky White Clouds Wallpaper Hd at Kaitlyn Corkill blog](https://images.freeimages.com/images/large-previews/7c9/white-clouds-in-blue-sky-1163502.jpg)',
    )
  })
})
