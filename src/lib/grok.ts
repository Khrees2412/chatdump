const GROK_DEFAULT_AUTHOR = 'Grok'
const GROK_DEFAULT_TITLE = 'Shared Grok Conversation'

export function isGrokShareConversationResponseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    return (
      url.hostname === 'grok.com' &&
      /^\/rest\/app-chat\/share_links\/[^/]+$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export function createGrokShareConversationApiUrl(shareUrl: URL): URL {
  const pathParts = shareUrl.pathname.split('/').filter(Boolean)
  const shareId = pathParts[1]

  if (!shareId) {
    throw new Error('missing Grok share id')
  }

  return new URL(`/rest/app-chat/share_links/${shareId}`, shareUrl.origin)
}

export function extractGrokConversationPayloads(
  responseText: string,
): Record<string, unknown>[] {
  const parsed = safeJsonParse(responseText)
  const payload = normalizeGrokSharePayload(parsed)

  return payload ? [payload] : []
}

function normalizeGrokSharePayload(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload)
  const conversation = asRecord(record?.conversation)
  const messages = Array.isArray(record?.responses)
    ? record.responses
        .map((response) => normalizeGrokResponse(response))
        .filter((message): message is Record<string, unknown> => Boolean(message))
    : []

  if (messages.length === 0) {
    return null
  }

  return {
    conversation_id: readString(conversation?.conversationId) ?? undefined,
    created_at:
      normalizeTimestamp(conversation?.createTime) ??
      normalizeTimestamp(conversation?.modifyTime) ??
      undefined,
    messages,
    title: readString(conversation?.title) ?? GROK_DEFAULT_TITLE,
  }
}

function normalizeGrokResponse(candidate: unknown): Record<string, unknown> | null {
  const record = asRecord(candidate)

  if (!record) {
    return null
  }

  const parts: unknown[] = []
  const text = readString(record.message)

  if (text) {
    parts.push(text)
  }

  parts.push(...extractGeneratedImages(record.generatedImageUrls))

  const attachments = [
    ...extractAttachments(record.fileAttachments, { defaultMimeType: undefined }),
    ...extractAttachments(record.imageAttachments, { defaultMimeType: 'image/*' }),
  ]

  if (parts.length === 0 && attachments.length === 0) {
    return null
  }

  const role = normalizeGrokRole(record.sender)
  const message: Record<string, unknown> = {
    created_at: normalizeTimestamp(record.createTime) ?? undefined,
    id: readString(record.responseId) ?? undefined,
    role,
  }

  if (parts.length > 0) {
    message.content = {
      parts,
    }
  }

  if (attachments.length > 0) {
    message.attachments = attachments
  }

  if (role === 'assistant') {
    message.author = {
      name: GROK_DEFAULT_AUTHOR,
      role: 'assistant',
    }
  }

  return message
}

function extractGeneratedImages(candidate: unknown): Record<string, unknown>[] {
  if (!Array.isArray(candidate)) {
    return []
  }

  return candidate.flatMap((entry, index) => {
    const url = readString(entry)

    if (!url) {
      return []
    }

    return [
      {
        content_type: 'image',
        label: `Generated image ${index + 1}`,
        url,
      },
    ]
  })
}

function extractAttachments(
  candidate: unknown,
  options: { defaultMimeType: string | undefined },
): Record<string, unknown>[] {
  if (!Array.isArray(candidate)) {
    return []
  }

  return candidate.flatMap((entry, index) => {
    const attachment = asRecord(entry)

    if (!attachment) {
      return []
    }

    const url =
      readString(attachment.url) ??
      readString(attachment.downloadUrl) ??
      readString(attachment.download_url) ??
      readString(attachment.previewUrl) ??
      readString(attachment.preview_url)

    const name =
      readString(attachment.name) ??
      readString(attachment.fileName) ??
      readString(attachment.filename) ??
      readString(attachment.alt) ??
      `attachment-${index + 1}`
    const mimeType =
      readString(attachment.mimeType) ??
      readString(attachment.mime_type) ??
      options.defaultMimeType

    return [
      {
        mime_type: mimeType,
        name,
        url,
      },
    ]
  })
}

function normalizeGrokRole(sender: unknown): string {
  switch ((readString(sender) ?? '').toLowerCase()) {
    case 'assistant':
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
