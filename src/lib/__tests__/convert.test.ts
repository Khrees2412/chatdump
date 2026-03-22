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

const structuredHtmlWithImage = `
<!doctype html>
<html>
  <head>
    <title>Image Share - ChatGPT</title>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "shareData": {
              "conversation_id": "conv_image",
              "title": "Image Share",
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
                      "parts": ["Show me a generated image."]
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
                        "Here is the image.",
                        {
                          "content_type": "image_asset_pointer",
                          "asset_pointer": "file-service://file-123",
                          "metadata": {
                            "image_url": "https://files.oaiusercontent.com/file-123/generated.png"
                          }
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

const structuredHtmlWithDomImage = `
<!doctype html>
<html>
  <head>
    <title>Image Share - ChatGPT</title>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "shareData": {
              "conversation_id": "conv_image_dom",
              "title": "Image Share",
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
                      "parts": ["Generate this image."]
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
                        "Generated image 1",
                        { "content_type": "image_asset_pointer", "asset_pointer": "file-service://file-1", "name": "Generated image 1" },
                        "Generated image 2",
                        { "content_type": "image_asset_pointer", "asset_pointer": "file-service://file-2", "name": "Generated image 2" }
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
  <body>
    <main>
      <article data-message-author-role="user">
        <p>Generate this image.</p>
      </article>
      <article data-message-author-role="assistant">
        <p>Generated image 1</p>
        <img alt="Generated image 1" src="https://files.oaiusercontent.com/file-1/generated-1.png" />
        <p>Generated image 2</p>
        <img alt="Generated image 2" src="https://files.oaiusercontent.com/file-2/generated-2.png" />
      </article>
    </main>
  </body>
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

const antiBotChallengeHtml = `
<!doctype html>
<html lang="en-US">
  <head>
    <title>Just a moment...</title>
  </head>
  <body>
    <div>Verifying you are human. This may take a few seconds.</div>
    <div>Performance and Security by Cloudflare</div>
    <script>
      window._cf_chl_opt = { cZone: 'example.com' };
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

  test('extracts image blocks from structured ChatGPT message parts', () => {
    const { conversation, warnings } = extractConversationFromHtml(
      structuredHtmlWithImage,
      'https://chatgpt.com/share/example',
    )

    expect(warnings).toEqual([])
    expect(conversation.messages).toHaveLength(2)
    expect(conversation.messages[1]?.blocks).toContainEqual({
      alt: 'Generated image',
      kind: 'image',
      label: 'Generated image',
      url: 'https://files.oaiusercontent.com/file-123/generated.png',
    })
  })

  test('fills missing structured ChatGPT image URLs from DOM images', () => {
    const { conversation, warnings } = extractConversationFromHtml(
      structuredHtmlWithDomImage,
      'https://chatgpt.com/share/example',
    )

    expect(warnings).toEqual([])
    expect(conversation.messages[1]?.blocks).toContainEqual({
      alt: 'Generated image 1',
      kind: 'image',
      label: 'Generated image 1',
      url: 'https://files.oaiusercontent.com/file-1/generated-1.png',
    })
    expect(conversation.messages[1]?.blocks).toContainEqual({
      alt: 'Generated image 2',
      kind: 'image',
      label: 'Generated image 2',
      url: 'https://files.oaiusercontent.com/file-2/generated-2.png',
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

  test('reports when a share page is blocked by an anti-bot challenge', () => {
    expect(() =>
      extractConversationFromHtml(
        antiBotChallengeHtml,
        'https://chatgpt.com/share/example',
      ),
    ).toThrow(
      'could not extract conversation data from share page: received an anti-bot challenge page instead of the public shared conversation (page title: Just a moment...)',
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

  test('can bypass the share cache for live probes', async () => {
    let fetchCalls = 0

    const fetchImpl = async () => {
      fetchCalls += 1

      return new Response(structuredHtml, {
        headers: {
          'content-type': 'text/html',
        },
        status: 200,
      })
    }

    await convertShareUrlToMarkdown(
      'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
      {
        fetchImpl,
      },
    )

    await convertShareUrlToMarkdown(
      'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
      {
        disableCache: true,
        fetchImpl,
      },
    )

    expect(fetchCalls).toBe(2)
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

  test('renders image blocks as markdown images', () => {
    const markdown = renderConversationToMarkdown(
      {
        messages: [
          {
            authorName: 'GPT-4o',
            blocks: [
              {
                alt: 'Generated image',
                kind: 'image',
                label: 'Generated image',
                url: 'https://files.oaiusercontent.com/file-123/generated.png',
              },
            ],
            id: 'assistant-1',
            role: 'assistant',
          },
        ],
        sourceUrl: 'https://chatgpt.com/share/example',
        title: 'Image Chat',
      },
      {
        exportedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    )

    expect(markdown).toContain(
      '![Generated image](https://files.oaiusercontent.com/file-123/generated.png)',
    )
  })

  test('resolves relative image and attachment URLs against the share URL', () => {
    const markdown = renderConversationToMarkdown(
      {
        messages: [
          {
            authorName: 'Grok',
            blocks: [
              {
                alt: 'Generated image 1',
                kind: 'image',
                label: 'Generated image 1',
                url: 'users/795f19db-cef1-410d-bbb5-ee64cb944e89/generated/bcc2a557-a1cb-4829-a6ee-5e1c89a6734f/image.jpg',
              },
              {
                kind: 'file',
                name: 'notes.txt',
                url: '/downloads/notes.txt',
              },
            ],
            id: 'assistant-1',
            role: 'assistant',
          },
        ],
        sourceUrl: 'https://grok.com/share/example',
        title: 'Relative Image Chat',
      },
      {
        exportedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    )

    expect(markdown).toContain(
      '![Generated image 1](https://grok.com/users/795f19db-cef1-410d-bbb5-ee64cb944e89/generated/bcc2a557-a1cb-4829-a6ee-5e1c89a6734f/image.jpg)',
    )
    expect(markdown).toContain(
      '[Attachment: notes.txt](https://grok.com/downloads/notes.txt)',
    )
  })
})
