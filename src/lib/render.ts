import type {
  ContentBlock,
  ConvertOptions,
  NormalizedConversation,
  NormalizedMessage,
} from './types'

export function renderConversationToMarkdown(
  conversation: NormalizedConversation,
  options: Pick<
    ConvertOptions,
    'exportedAt' | 'includeMetadata' | 'includeSystemMessages'
  > = {},
): string {
  const title = cleanText(conversation.title) || 'ChatGPT Conversation'
  const includeMetadata = options.includeMetadata !== false
  const includeSystemMessages = options.includeSystemMessages === true
  const sections: string[] = [`# ${title}`]

  if (includeMetadata) {
    sections.push(
      [
        `Source: ${conversation.sourceUrl}`,
        `Exported: ${(options.exportedAt ?? new Date()).toISOString()}`,
        conversation.createdAt
          ? `Conversation Created: ${conversation.createdAt}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const messages = includeSystemMessages
    ? conversation.messages
    : conversation.messages.filter((message) => message.role !== 'system')

  for (const message of messages) {
    sections.push(renderMessage(message))
  }

  return `${sections.join('\n\n').trim()}\n`
}

function renderMessage(message: NormalizedMessage): string {
  const heading = renderHeading(message)
  const body = message.blocks.length
    ? message.blocks.map(renderBlock).filter(Boolean).join('\n\n')
    : '[No visible content]'

  return `${heading}\n\n${body}`
}

function renderHeading(message: NormalizedMessage): string {
  const role = capitalize(message.role)
  const authorLabel = message.authorName ? cleanText(message.authorName) : ''

  if (authorLabel && authorLabel.toLowerCase() !== role.toLowerCase()) {
    return `## ${role} (${authorLabel})`
  }

  return `## ${role}`
}

function renderBlock(block: ContentBlock): string {
  switch (block.kind) {
    case 'text':
      return block.text.trim()
    case 'code':
      return renderCodeBlock(block.language, block.code)
    case 'quote':
      return block.text
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'list':
      return block.items
        .map((item, index) => {
          const prefix = block.ordered ? `${index + 1}. ` : '- '
          const lines = item.trim().split('\n')

          return lines
            .map((line, lineIndex) =>
              lineIndex === 0 ? `${prefix}${line}` : `  ${line}`,
            )
            .join('\n')
        })
        .join('\n')
    case 'table':
      return renderTable(block.headers, block.rows)
    case 'image':
      if (block.url) {
        return `![${block.alt ?? block.label ?? 'Image'}](${block.url})`
      }

      return `[Image: ${block.alt ?? block.label ?? 'unnamed'}]`
    case 'file':
      return block.url
        ? `[Attachment: ${block.name}](${block.url})`
        : `[Attachment: ${block.name}]`
    case 'unknown':
      if (block.rawText?.trim()) {
        return block.rawText.trim()
      }

      return `[Unsupported content block: ${block.description}]`
  }
}

function renderCodeBlock(language: string | undefined, code: string): string {
  const trimmed = code.replace(/\n+$/, '')
  const info = language?.trim() ?? ''

  return `\`\`\`${info}\n${trimmed}\n\`\`\``
}

function renderTable(headers: string[], rows: string[][]): string {
  const normalizedHeaders =
    headers.length > 0 ? headers : rows[0]?.map((_, index) => `Column ${index + 1}`) ?? []
  const normalizedRows = headers.length > 0 ? rows : rows.slice(1)

  if (normalizedHeaders.length === 0) {
    return ''
  }

  const headerRow = `| ${normalizedHeaders.map(escapeCell).join(' | ')} |`
  const separator = `| ${normalizedHeaders.map(() => '---').join(' | ')} |`
  const body = normalizedRows.map((row) => {
    const padded = normalizedHeaders.map((_, index) => escapeCell(row[index] ?? ''))
    return `| ${padded.join(' | ')} |`
  })

  return [headerRow, separator, ...body].join('\n')
}

function escapeCell(value: string): string {
  return cleanText(value).replace(/\|/g, '\\|')
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : 'Unknown'
}

function cleanText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}
