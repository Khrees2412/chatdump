import { beforeEach, describe, expect, test } from 'bun:test'
import {
  convertShareUrlToMarkdown,
  extractConversationFromHtml,
} from '../extract'
import { renderConversationToMarkdown } from '../render'
import { clearShareConversationCache } from '../share-cache'

const structuredHtml = `
<!doctype html>
<html>
  <head>
    <title>Shared Python Chat - ChatGPT</title>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "shareData": {
              "conversation_id": "conv_123",
              "title": "Shared Python Chat",
              "mapping": {
                "1": {
                  "id": "1",
                  "children": ["2"],
                  "message": {
                    "id": "m1",
                    "author": { "role": "user", "name": "User" },
                    "create_time": 1700000000,
                    "content": {
                      "content_type": "text",
                      "parts": ["How do I sum a list in Python?"]
                    }
                  }
                },
                "2": {
                  "id": "2",
                  "parent": "1",
                  "children": [],
                  "message": {
                    "id": "m2",
                    "author": { "role": "assistant", "name": "GPT-4o" },
                    "create_time": 1700000005,
                    "content": {
                      "content_type": "text",
                      "parts": [
                        "Use \`sum\`.",
                        {
                          "content_type": "code",
                          "language": "python",
                          "text": "numbers = [1, 2, 3]\\nsum(numbers)"
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      }
    </script>
  </head>
  <body></body>
</html>
`

const structuredHtmlWithSystem = `
<!doctype html>
<html>
  <head>
    <title>System Filter Chat - ChatGPT</title>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "shareData": {
              "conversation_id": "conv_system",
              "title": "System Filter Chat",
              "mapping": {
                "1": {
                  "id": "1",
                  "children": ["2"],
                  "message": {
                    "id": "m1",
                    "author": { "role": "system" },
                    "create_time": 1700000000,
                    "content": {
                      "content_type": "text",
                      "parts": ["Hidden instruction"]
                    }
                  }
                },
                "2": {
                  "id": "2",
                  "parent": "1",
                  "children": ["3"],
                  "message": {
                    "id": "m2",
                    "author": { "role": "user" },
                    "create_time": 1700000001,
                    "content": {
                      "content_type": "text",
                      "parts": ["Show me the visible chat."]
                    }
                  }
                },
                "3": {
                  "id": "3",
                  "parent": "2",
                  "children": [],
                  "message": {
                    "id": "m3",
                    "author": { "role": "assistant", "name": "GPT-4o" },
                    "create_time": 1700000002,
                    "content": {
                      "content_type": "text",
                      "parts": ["Visible answer"]
                    }
                  }
                }
              }
            }
          }
        }
      }
    </script>
  </head>
  <body></body>
</html>
`

const domFallbackHtml = `
<!doctype html>
<html>
  <head>
    <title>DOM Fallback - ChatGPT</title>
  </head>
  <body>
    <main>
      <article data-message-author-role="user">
        <p>Summarize the rule.</p>
      </article>
      <article data-message-author-role="assistant">
        <p>Use <code>sum</code> for sequences.</p>
        <pre><code class="language-python">sum([1, 2, 3])</code></pre>
      </article>
    </main>
  </body>
</html>
`

const reactRouterHydrationPayload = {
  loaderData: {
    'routes/share.$shareId.($action)': {
      serverResponse: {
        data: {
          conversation_id: 'conv_router',
          create_time: 1700000100,
          mapping: {
            root: {
              children: ['assistant'],
              id: 'root',
              message: {
                author: { role: 'user' },
                content: {
                  content_type: 'text',
                  parts: ['Where is the conversation payload now?'],
                },
                create_time: 1700000100,
                id: 'm3',
              },
            },
            assistant: {
              children: [],
              id: 'assistant',
              message: {
                author: { name: 'GPT-4.1', role: 'assistant' },
                content: {
                  content_type: 'text',
                  parts: ['It is embedded in the React Router loader response.'],
                },
                create_time: 1700000104,
                id: 'm4',
              },
              parent: 'root',
            },
          },
          title: 'Router Hydration Share',
        },
      },
    },
  },
}

const reactRouterHydrationHtml = `
<!doctype html>
<html>
  <head>
    <title>Router Hydration Share - ChatGPT</title>
  </head>
  <body>
    <script>
      window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(
        JSON.stringify(reactRouterHydrationPayload),
      )});
      window.__reactRouterDataRouter = { state: window.__staticRouterHydrationData };
    </script>
  </body>
</html>
`

const genericShellHtml = `
<!doctype html>
<html>
  <head>
    <title>ChatGPT</title>
  </head>
  <body>
    <main>
      <h1>ChatGPT</h1>
      <p>Log in to continue</p>
      <p>Sign up for free</p>
    </main>
  </body>
</html>
`

describe('extractConversationFromHtml', () => {
  test('prefers structured payloads and renders markdown-ready blocks', () => {
    const { conversation, warnings } = extractConversationFromHtml(
      structuredHtml,
      'https://chatgpt.com/share/example',
    )

    expect(warnings).toEqual([])
    expect(conversation.title).toBe('Shared Python Chat')
    expect(conversation.messages).toHaveLength(2)
    expect(conversation.messages[0]?.role).toBe('user')
    expect(conversation.messages[1]?.authorName).toBe('GPT-4o')
  })

  test('falls back to DOM extraction when structured payloads are missing', () => {
    const { conversation, warnings } = extractConversationFromHtml(
      domFallbackHtml,
      'https://chatgpt.com/share/example',
    )

    expect(warnings).toEqual([
      'Fell back to DOM extraction; formatting may be lossy.',
    ])
    expect(conversation.messages).toHaveLength(2)
    expect(conversation.messages[1]?.blocks[1]).toEqual({
      code: 'sum([1, 2, 3])',
      kind: 'code',
      language: 'python',
    })
  })

  test('extracts conversations from React Router hydration payloads', () => {
    const { conversation, warnings } = extractConversationFromHtml(
      reactRouterHydrationHtml,
      'https://chatgpt.com/share/example',
    )

    expect(warnings).toEqual([])
    expect(conversation.title).toBe('Router Hydration Share')
    expect(conversation.messages).toHaveLength(2)
    expect(conversation.messages[0]?.role).toBe('user')
    expect(conversation.messages[1]?.authorName).toBe('GPT-4.1')
    expect(conversation.messages[1]?.blocks[0]).toEqual({
      kind: 'text',
      text: 'It is embedded in the React Router loader response.',
    })
  })

  test('reports when a share URL resolves to a generic page', () => {
    expect(() =>
      extractConversationFromHtml(
        genericShellHtml,
        'https://chatgpt.com/',
      ),
    ).toThrow(
      'could not extract conversation data from share page: request resolved to a non-share page (https://chatgpt.com/)',
    )
  })

  test('reports when payload markers exist but parsing still fails', () => {
    const undecodablePayloadHtml = `
<!doctype html>
<html>
  <head>
    <title>Shared Chat - ChatGPT</title>
  </head>
  <body>
    <script>
      window.__staticRouterHydrationData = JSON.parse("not actually json");
    </script>
  </body>
</html>
`

    expect(() =>
      extractConversationFromHtml(
        undecodablePayloadHtml,
        'https://chatgpt.com/share/example',
      ),
    ).toThrow(
      'could not extract conversation data from share page: found embedded payload markers but could not decode a conversation payload (page title: Shared Chat)',
    )
  })
})

describe('convertShareUrlToMarkdown', () => {
  beforeEach(() => {
    clearShareConversationCache()
  })

  test('produces deterministic markdown output', async () => {
    const result = await convertShareUrlToMarkdown(
      'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
      {
        exportedAt: new Date('2026-03-20T00:00:00.000Z'),
        fetchImpl: async () =>
          new Response(structuredHtml, {
            headers: {
              'content-type': 'text/html',
            },
            status: 200,
          }),
      },
    )

    expect(result.markdown).toContain('# Shared Python Chat')
    expect(result.markdown).toContain('Source: https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab')
    expect(result.markdown).toContain('## Assistant (GPT-4o)')
    expect(result.markdown).toContain('```python')
    expect(result.markdown).toContain('sum(numbers)')
  })

  test('omits system messages by default', async () => {
    const result = await convertShareUrlToMarkdown(
      'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
      {
        exportedAt: new Date('2026-03-20T00:00:00.000Z'),
        fetchImpl: async () =>
          new Response(structuredHtmlWithSystem, {
            headers: {
              'content-type': 'text/html',
            },
            status: 200,
          }),
      },
    )

    expect(result.markdown).not.toContain('## System')
    expect(result.markdown).not.toContain('Hidden instruction')
    expect(result.markdown).toContain('## User')
    expect(result.markdown).toContain('## Assistant (GPT-4o)')
  })

  test('falls back to browser extraction when static HTML has no conversation', async () => {
    const result = await convertShareUrlToMarkdown(
      'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
      {
        browserExtractor: async (url) => ({
          payloads: [reactRouterHydrationPayload],
          sourceUrl: url,
        }),
        fetchImpl: async () =>
          new Response(genericShellHtml, {
            headers: {
              'content-type': 'text/html',
            },
            status: 200,
          }),
      },
    )

    expect(result.conversation.title).toBe('Router Hydration Share')
    expect(result.warnings).toEqual([])
    expect(result.markdown).toContain('# Router Hydration Share')
    expect(result.markdown).toContain('It is embedded in the React Router loader response.')
  })

  test('reports how to enable browser fallback when static extraction fails', async () => {
    await expect(
      convertShareUrlToMarkdown(
        'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
        {
          browserExtractor: async () => null,
          enableBrowserFallback: true,
          fetchImpl: async () =>
            new Response(genericShellHtml, {
              headers: {
                'content-type': 'text/html',
              },
              status: 200,
            }),
        },
      ),
    ).rejects.toThrow(
      'could not extract conversation data from share page: received a generic page instead of a public shared conversation (page title: ChatGPT); install playwright to enable browser fallback',
    )
  })

  test('reports a deployment-specific browser fallback error on Vercel', async () => {
    const previousVercel = process.env.VERCEL
    const previousVercelEnv = process.env.VERCEL_ENV

    process.env.VERCEL = '1'
    delete process.env.VERCEL_ENV

    try {
      await expect(
        convertShareUrlToMarkdown(
          'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
          {
            browserExtractor: async () => null,
            enableBrowserFallback: true,
            fetchImpl: async () =>
              new Response(genericShellHtml, {
                headers: {
                  'content-type': 'text/html',
                },
                status: 200,
              }),
          },
        ),
      ).rejects.toThrow(
        'could not extract conversation data from share page: received a generic page instead of a public shared conversation (page title: ChatGPT); browser fallback was unavailable in this deployment; check Vercel logs for serverless runtime loading errors',
      )
    } finally {
      if (previousVercel === undefined) {
        delete process.env.VERCEL
      } else {
        process.env.VERCEL = previousVercel
      }

      if (previousVercelEnv === undefined) {
        delete process.env.VERCEL_ENV
      } else {
        process.env.VERCEL_ENV = previousVercelEnv
      }
    }
  })
})

describe('renderConversationToMarkdown', () => {
  test('omits system messages from the rendered markdown by default', () => {
    const markdown = renderConversationToMarkdown(
      {
        createdAt: '2026-03-20T00:00:00.000Z',
        messages: [
          {
            blocks: [{ kind: 'text', text: 'Internal instruction' }],
            id: 'ignored',
            role: 'system',
          },
          {
            blocks: [{ kind: 'text', text: 'Hi' }],
            id: 'user-1',
            role: 'user',
          },
          {
            authorName: 'GPT-4o',
            blocks: [{ kind: 'text', text: 'Hello' }],
            id: 'assistant-1',
            role: 'assistant',
          },
        ],
        sourceUrl: 'https://chatgpt.com/share/example',
        title: 'Filtered Chat',
      },
      {
        exportedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    )

    expect(markdown).not.toContain('## System')
    expect(markdown).toContain('## User')
    expect(markdown).toContain('## Assistant (GPT-4o)')
  })

  test('can include system messages when requested', () => {
    const markdown = renderConversationToMarkdown(
      {
        createdAt: '2026-03-20T00:00:00.000Z',
        messages: [
          {
            blocks: [{ kind: 'text', text: 'Internal instruction' }],
            id: 'system-1',
            role: 'system',
          },
          {
            blocks: [{ kind: 'text', text: 'Hi' }],
            id: 'user-1',
            role: 'user',
          },
        ],
        sourceUrl: 'https://chatgpt.com/share/example',
        title: 'Filtered Chat',
      },
      {
        exportedAt: new Date('2026-03-20T00:00:00.000Z'),
        includeSystemMessages: true,
      },
    )

    expect(markdown).toContain('## System')
    expect(markdown).toContain('Internal instruction')
    expect(markdown).toContain('## User')
  })
})
