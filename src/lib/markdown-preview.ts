export type PreviewSegment =
  | {
      kind: 'markdown'
      content: string
    }
  | {
      headers: string[]
      kind: 'table'
      rows: string[][]
    }

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/u
const TABLE_SEPARATOR_RE = /^\s*\|[\s:|-]+\|[\s:|-]*\|?\s*$/u

export function splitMarkdownForPreview(markdown: string): PreviewSegment[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const segments: PreviewSegment[] = []
  const buffer: string[] = []
  let index = 0
  let inFence = false
  let fenceMarker = ''

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trimStart()

    if (isFenceLine(trimmed)) {
      if (!inFence) {
        inFence = true
        fenceMarker = trimmed.slice(0, 3)
      } else if (trimmed.startsWith(fenceMarker)) {
        inFence = false
        fenceMarker = ''
      }

      buffer.push(line)
      index += 1
      continue
    }

    if (!inFence) {
      const table = readTableBlock(lines, index)

      if (table) {
        flushMarkdownBuffer(buffer, segments)
        segments.push(table.segment)
        index = table.nextIndex
        continue
      }
    }

    buffer.push(line)
    index += 1
  }

  flushMarkdownBuffer(buffer, segments)
  return segments
}

function readTableBlock(
  lines: string[],
  startIndex: number,
): { nextIndex: number; segment: PreviewSegment } | null {
  const firstLine = lines[startIndex] ?? ''
  const secondLine = lines[startIndex + 1] ?? ''

  if (!TABLE_ROW_RE.test(firstLine) || !TABLE_SEPARATOR_RE.test(secondLine)) {
    return null
  }

  const block: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!TABLE_ROW_RE.test(line) && !TABLE_SEPARATOR_RE.test(line)) {
      break
    }

    block.push(line)
    index += 1
  }

  if (block.length < 2) {
    return null
  }

  const rows = block.map((line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim()),
  )

  const headers = rows[0] ?? []
  const bodyRows = rows.slice(2)

  return {
    nextIndex: index,
    segment: {
      headers,
      kind: 'table',
      rows: bodyRows,
    },
  }
}

function flushMarkdownBuffer(
  buffer: string[],
  segments: PreviewSegment[],
): void {
  if (buffer.length === 0) {
    return
  }

  const content = buffer.join('\n')
  if (content.trim().length > 0) {
    segments.push({
      content,
      kind: 'markdown',
    })
  }

  buffer.length = 0
}

function isFenceLine(line: string): boolean {
  return /^```+|^~~~+/u.test(line)
}
