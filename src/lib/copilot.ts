const COPILOT_DEFAULT_AUTHOR = 'Copilot'
const COPILOT_DEFAULT_TITLE = 'Shared Copilot Conversation'

export function isCopilotShareConversationResponseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    return (
      url.hostname === 'copilot.microsoft.com' &&
      /^\/c\/api\/conversations\/shares\/[^/]+$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export function createCopilotShareConversationApiUrl(shareUrl: URL): URL {
  const pathParts = shareUrl.pathname.split('/').filter(Boolean)
  const shareId = pathParts[1]

  if (!shareId) {
    throw new Error('missing Copilot share id')
  }

  return new URL(`/c/api/conversations/shares/${shareId}`, shareUrl.origin)
}

export function extractCopilotConversationPayloads(
  responseText: string,
): Record<string, unknown>[] {
  const parsed = safeJsonParse(responseText)
  const payload = normalizeCopilotSharePayload(parsed)

  return payload ? [payload] : []
}

function normalizeCopilotSharePayload(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload)
  const rawMessages = Array.isArray(record?.messages) ? record.messages : []
  const messages = rawMessages
    .map((message) => normalizeCopilotMessage(message))
    .filter((message): message is Record<string, unknown> => Boolean(message))

  if (messages.length === 0) {
    return null
  }

  return {
    conversation_id:
      readString(record?.conversationId) ?? readString(record?.id) ?? undefined,
    created_at:
      normalizeTimestamp(record?.createdAt) ??
      normalizeTimestamp(asRecord(rawMessages[0])?.createdAt) ??
      undefined,
    messages,
    title: readString(record?.conversationTitle) ?? COPILOT_DEFAULT_TITLE,
  }
}

function normalizeCopilotMessage(candidate: unknown): Record<string, unknown> | null {
  const record = asRecord(candidate)

  if (!record) {
    return null
  }

  const role = normalizeCopilotRole(record.author)
  const parts: unknown[] = []
  const citations: Array<{ title: string; url: string }> = []
  const content = Array.isArray(record.content) ? record.content : []

  for (const entry of content) {
    const normalized = normalizeCopilotContentEntry(entry)

    if (!normalized) {
      continue
    }

    if (normalized.kind === 'citation') {
      citations.push(normalized.value)
      continue
    }

    parts.push(normalized.value)
  }

  const citationsMarkdown = renderCitationList(citations)

  if (citationsMarkdown) {
    parts.push(citationsMarkdown)
  }

  if (parts.length === 0) {
    return null
  }

  const message: Record<string, unknown> = {
    created_at: normalizeTimestamp(record.createdAt) ?? undefined,
    id: readString(record.id) ?? undefined,
    role,
  }

  if (parts.length > 0) {
    message.content = {
      parts,
    }
  }

  if (role === 'assistant') {
    message.author = {
      name: COPILOT_DEFAULT_AUTHOR,
      role: 'assistant',
    }
  }

  return message
}

function normalizeCopilotContentEntry(
  candidate: unknown,
):
  | { kind: 'citation'; value: { title: string; url: string } }
  | { kind: 'part'; value: Record<string, unknown> | string }
  | null {
  const record = asRecord(candidate)

  if (!record) {
    return null
  }

  const type = readString(record.type)?.toLowerCase()

  if (type === 'citation') {
    const title = readString(record.title)
    const url = readString(record.url)

    if (!title || !url) {
      return null
    }

    return {
      kind: 'citation',
      value: { title, url },
    }
  }

  const text = readString(record.text)

  if (text) {
    return {
      kind: 'part',
      value: text,
    }
  }

  const url =
    readString(record.url) ??
    readString(record.imageUrl) ??
    readString(record.image_url) ??
    readString(record.downloadUrl) ??
    readString(record.download_url)

  if (!url) {
    return null
  }

  const label =
    readString(record.title) ??
    readString(record.label) ??
    readString(record.name) ??
    'attachment'
  const mimeType =
    readString(record.mimeType) ??
    readString(record.mime_type) ??
    readString(record.contentType) ??
    readString(record.content_type)

  if (type === 'image' || mimeType?.startsWith('image/')) {
    return {
      kind: 'part',
      value: {
        alt: label,
        content_type: 'image',
        label,
        url,
      },
    }
  }

  return {
    kind: 'part',
    value: {
      content_type: 'file',
      name: label,
      url,
    },
  }
}

function renderCitationList(citations: Array<{ title: string; url: string }>): string | null {
  const deduped = new Map<string, { title: string; url: string }>()

  for (const citation of citations) {
    const key = `${citation.title}\u0000${citation.url}`

    if (!deduped.has(key)) {
      deduped.set(key, citation)
    }
  }

  if (deduped.size === 0) {
    return null
  }

  return [
    'Sources:',
    '',
    ...[...deduped.values()].map((citation) =>
      `- ${citation.title}: ${citation.url}`,
    ),
  ].join('\n')
}

function normalizeCopilotRole(author: unknown): string {
  switch ((readString(author) ?? '').toLowerCase()) {
    case 'ai':
    case 'assistant':
    case 'copilot':
      return 'assistant'
    case 'human':
    case 'user':
      return 'user'
    case 'system':
      return 'system'
    default:
      return 'unknown'
  }
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  const trimmed = value.trim()
  const date = new Date(trimmed)

  return Number.isNaN(date.getTime()) ? trimmed : date.toISOString()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
