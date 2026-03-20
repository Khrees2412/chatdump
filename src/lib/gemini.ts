const GEMINI_CONVERSATION_RPC_ID = 'ujx1Bf'
const GEMINI_DEFAULT_AUTHOR = 'Gemini'
const GEMINI_DEFAULT_TITLE = 'Gemini Conversation'

export function isGeminiConversationResponseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const rpcids = url.searchParams.get('rpcids') ?? ''

    return (
      url.hostname === 'gemini.google.com' &&
      url.pathname.endsWith('/_/BardChatUi/data/batchexecute') &&
      rpcids.split(',').includes(GEMINI_CONVERSATION_RPC_ID)
    )
  } catch {
    return false
  }
}

export function extractGeminiConversationPayloads(
  responseText: string,
): Record<string, unknown>[] {
  const wrapper = parseBatchedWrapper(responseText)

  if (!Array.isArray(wrapper)) {
    return []
  }

  const payloads: Record<string, unknown>[] = []

  for (const entry of wrapper) {
    if (!Array.isArray(entry) || entry.length < 3) {
      continue
    }

    if (entry[0] !== 'wrb.fr' || entry[1] !== GEMINI_CONVERSATION_RPC_ID) {
      continue
    }

    const candidate = parseGeminiConversationPayload(entry[2])

    if (candidate) {
      payloads.push(candidate)
    }
  }

  return payloads
}

function parseBatchedWrapper(responseText: string): unknown[] | null {
  const lines = responseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const wrapperLine = lines.find((line) => line.startsWith('[['))

  if (!wrapperLine) {
    return null
  }

  const parsed = safeJsonParse(wrapperLine)
  return Array.isArray(parsed) ? parsed : null
}

function parseGeminiConversationPayload(payloadText: unknown): Record<string, unknown> | null {
  if (typeof payloadText !== 'string') {
    return null
  }

  const parsed = safeJsonParse(payloadText)

  if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
    return null
  }

  const shareRecord = parsed[0]
  const turns = Array.isArray(shareRecord[1]) ? shareRecord[1] : []
  const shareMetadata = Array.isArray(shareRecord[2]) ? shareRecord[2] : null
  const modelName = readGeminiModelName(shareMetadata)
  const shareCreatedAt = normalizeGeminiTimestamp(shareRecord[4])
  const messages: Record<string, unknown>[] = []

  for (const turn of turns) {
    if (!Array.isArray(turn)) {
      continue
    }

    const turnCreatedAt = normalizeGeminiTimestamp(turn[4]) ?? shareCreatedAt
    const userText = readGeminiUserText(turn[2])

    if (userText) {
      messages.push({
        created_at: turnCreatedAt,
        role: 'user',
        text: userText,
      })
    }

    const assistantText = readGeminiAssistantText(turn[3])

    if (assistantText) {
      messages.push({
        author: {
          name: modelName,
          role: 'assistant',
        },
        created_at: turnCreatedAt,
        role: 'assistant',
        text: assistantText,
      })
    }
  }

  if (messages.length === 0) {
    return null
  }

  return {
    conversation_id: readString(shareRecord[3]),
    created_at: shareCreatedAt ?? messages[0]?.created_at,
    messages,
    title: readString(shareMetadata?.[1]) ?? GEMINI_DEFAULT_TITLE,
  }
}

function readGeminiModelName(shareMetadata: unknown[] | null): string {
  const modelLabel = readString(
    Array.isArray(shareMetadata?.[7]) ? shareMetadata?.[7]?.[2] : undefined,
  )

  if (!modelLabel) {
    return GEMINI_DEFAULT_AUTHOR
  }

  return modelLabel.toLowerCase().includes('gemini')
    ? modelLabel
    : `${GEMINI_DEFAULT_AUTHOR} ${modelLabel}`
}

function readGeminiUserText(candidate: unknown): string | undefined {
  if (!Array.isArray(candidate) || !Array.isArray(candidate[0])) {
    return undefined
  }

  return readString(candidate[0][0])
}

function readGeminiAssistantText(candidate: unknown): string | undefined {
  return readString(readPath(candidate, [0, 0, 1, 0]))
}

function readPath(value: unknown, path: number[]): unknown {
  let current = value

  for (const index of path) {
    if (!Array.isArray(current)) {
      return undefined
    }

    current = current[index]
  }

  return current
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeGeminiTimestamp(value: unknown): string | undefined {
  if (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0])
  ) {
    const seconds = value[0]
    const nanoseconds =
      typeof value[1] === 'number' && Number.isFinite(value[1]) ? value[1] : 0
    const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000))

    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value.trim() : date.toISOString()
  }

  return undefined
}
