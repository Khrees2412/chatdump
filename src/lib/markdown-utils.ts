export function stripMarkdown(markdown: string): string {
  let result = markdown

  result = result.replace(/^#{1,6}\s+/gm, '')

  result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
  result = result.replace(/__([^_]+)__/g, '$1')
  result = result.replace(/\*([^*]+)\*/g, '$1')
  result = result.replace(/_([^_]+)_/g, '$1')
  result = result.replace(/~~([^~]+)~~/g, '$1')

  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const content = match.replace(/```[^\n]*\n?/, '').replace(/```$/, '')
    return content.trim()
  })
  result = result.replace(/`([^`]+)`/g, '$1')

  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]')
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  result = result.replace(/^[-*+]\s+/gm, '')
  result = result.replace(/^\d+\.\s+/gm, '')

  result = result.replace(/^>\s+/gm, '')

  result = result.replace(/^\|[^|]+\|/gm, (match) => {
    return match.replace(/\|/g, '  ').trim()
  })
  result = result.replace(/^\|[-:\s|]+\|$/gm, '')

  result = result.replace(/---+/g, '')

  result = result.replace(/\n{3,}/g, '\n\n')

  result = result.trim()

  return result
}
