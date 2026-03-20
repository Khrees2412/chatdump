const CLAUDE_DEFAULT_AUTHOR = 'Claude'
const CLAUDE_DEFAULT_TITLE = 'Shared Conversation'

export function isClaudeSnapshotResponseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    return (
      url.hostname === 'claude.ai' &&
      /^\/api\/chat_snapshots\/[^/]+$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export function extractClaudeConversationPayloads(
  responseText: string,
): Record<string, unknown>[] {
  const parsed = safeJsonParse(responseText)
  const payload = normalizeClaudeSnapshot(parsed)

  return payload ? [payload] : []
}

function normalizeClaudeSnapshot(snapshot: unknown): Record<string, unknown> | null {
  const record = asRecord(snapshot)
  const messages = Array.isArray(record?.chat_messages)
    ? record.chat_messages
        .map((message) => normalizeClaudeMessage(message))
        .filter((message): message is Record<string, unknown> => Boolean(message))
    : []

  if (messages.length === 0) {
    return null
  }

  return {
    conversation_id:
      readString(record?.conversation_uuid) ??
      readString(record?.uuid) ??
      undefined,
    created_at:
      readString(record?.created_at) ??
      readString(record?.updated_at) ??
      undefined,
    messages,
    title:
      readString(record?.snapshot_name) ??
      readString(record?.name) ??
      CLAUDE_DEFAULT_TITLE,
  }
}

function normalizeClaudeMessage(candidate: unknown): Record<string, unknown> | null {
  const record = asRecord(candidate)

  if (!record) {
    return null
  }

  const contentParts = extractClaudeContentParts(record.content)
  const attachments = extractClaudeAttachments(record)

  if (contentParts.length === 0 && attachments.length === 0) {
    return null
  }

  const role = normalizeClaudeRole(record.sender)
  const message: Record<string, unknown> = {
    created_at:
      readString(record.created_at) ??
      readString(record.updated_at) ??
      undefined,
    role,
  }

  if (contentParts.length > 0) {
    message.content = {
      parts: contentParts,
    }
  }

  if (attachments.length > 0) {
    message.attachments = attachments
  }

  if (role === 'assistant') {
    message.author = {
      name: CLAUDE_DEFAULT_AUTHOR,
      role: 'assistant',
    }
  }

  return message
}

function extractClaudeContentParts(content: unknown): unknown[] {
  if (!Array.isArray(content)) {
    return []
  }

  const parts: unknown[] = []

  for (const item of content) {
    const record = asRecord(item)

    if (!record) {
      continue
    }

    const type = readString(record.type)

    switch (type) {
      case 'code': {
        const code = readString(record.code) ?? readString(record.text)

        if (code) {
          parts.push({
            content_type: 'code',
            language: readString(record.language),
            text: code,
          })
        }
        break
      }
      case 'file': {
        const name =
          readString(record.file_name) ??
          readString(record.name) ??
          'attachment'

        parts.push({
          content_type: 'file',
          name,
          url:
            readString(record.url) ??
            readString(record.preview_url) ??
            readString(asRecord(record.asset)?.url),
        })
        break
      }
      case 'image': {
        parts.push({
          alt: readString(record.alt),
          content_type: 'image',
          label: readString(record.file_name) ?? readString(record.name),
          url:
            readString(record.url) ??
            readString(record.preview_url) ??
            readString(asRecord(record.source)?.url),
        })
        break
      }
      case 'tool_result': {
        const displayContent =
          readString(record.display_content) ?? readString(record.message)

        if (displayContent) {
          parts.push(displayContent)
        }
        break
      }
      case 'tool_use': {
        const message =
          readString(record.message) ??
          readString(record.display_content) ??
          readString(record.name)

        if (message) {
          parts.push(message)
        }
        break
      }
      case 'text':
      default: {
        const text = readString(record.text)

        if (text) {
          parts.push(text)
        }
      }
    }
  }

  return parts
}

function extractClaudeAttachments(record: Record<string, unknown>): Record<string, unknown>[] {
  const collections = [record.attachments, record.files]
  const attachments: Record<string, unknown>[] = []

  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue
    }

    for (const item of collection) {
      const attachment = asRecord(item)

      if (!attachment) {
        continue
      }

      const name =
        readString(attachment.file_name) ??
        readString(attachment.filename) ??
        readString(attachment.name) ??
        'attachment'
      const url =
        readString(attachment.url) ??
        readString(attachment.preview_url) ??
        readString(attachment.download_url) ??
        readString(asRecord(attachment.asset)?.url)

      attachments.push({
        mime_type:
          readString(attachment.mime_type) ??
          readString(attachment.content_type) ??
          undefined,
        name,
        url,
      })
    }
  }

  return attachments
}

function normalizeClaudeRole(sender: unknown): string {
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
