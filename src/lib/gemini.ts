const GEMINI_CONVERSATION_RPC_ID = 'ujx1Bf'
const GEMINI_DEFAULT_AUTHOR = 'Gemini'
const GEMINI_DEFAULT_TITLE = 'Gemini Conversation'
const GEMINI_IMAGE_GENERATION_HOST = 'googleusercontent.com'
const GEMINI_IMAGE_GENERATION_PLACEHOLDER_PATH = '/image_generation_content/'
const GEMINI_IMAGE_GENERATION_ASSET_PATH = '/gg/'

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
    const assistantImageContext = collectGeminiGeneratedImages(turn[3])
    const assistantParts = compactGeminiAssistantParts(
      assistantText,
      assistantImageContext.urls,
      assistantImageContext.placeholderCount,
    )

    if (assistantParts.length > 0) {
      const message: Record<string, unknown> = {
        author: {
          name: modelName,
          role: 'assistant',
        },
        created_at: turnCreatedAt,
        role: 'assistant',
      }

      if (
        assistantParts.length === 1 &&
        typeof assistantParts[0] === 'string'
      ) {
        message.text = assistantParts[0]
      } else {
        message.content = {
          parts: assistantParts,
        }
      }

      messages.push(message)
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

function collectGeminiGeneratedImages(candidate: unknown): {
  placeholderCount: number
  urls: string[]
} {
  const urls = new Set<string>()
  const placeholderUrls = new Set<string>()
  const queue: unknown[] = [candidate]

  while (queue.length > 0) {
    const current = queue.shift()

    if (typeof current === 'string') {
      const normalized = normalizeGeminiGeneratedImageUrl(current)

      if (normalized) {
        urls.add(normalized)

        if (isGeminiPlaceholderImageUrl(normalized)) {
          placeholderUrls.add(normalized)
        }
      }
      continue
    }

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    if (current && typeof current === 'object') {
      queue.push(...Object.values(current))
    }
  }

  return {
    placeholderCount: placeholderUrls.size,
    urls: [...urls],
  }
}

function compactGeminiAssistantParts(
  text: string | undefined,
  images: string[],
  placeholderCount = 0,
): unknown[] {
  const preferredImages = preferRenderableGeminiImages(images, placeholderCount)
  const parts: unknown[] = []

  if (text && !normalizeGeminiGeneratedImageUrl(text)) {
    parts.push(text)
  }

  for (const [index, url] of preferredImages.entries()) {
    parts.push({
      content_type: 'image',
      label:
        preferredImages.length > 1
          ? `Generated image ${index + 1}`
          : 'Generated image',
      url,
    })
  }

  return parts
}

function preferRenderableGeminiImages(
  images: string[],
  placeholderCount: number,
): string[] {
  const renderableAssets = images.filter((url) => isGeminiRenderableImageUrl(url))

  if (renderableAssets.length === 0) {
    return images
  }

  if (placeholderCount > 0) {
    return renderableAssets.slice(0, placeholderCount)
  }

  return renderableAssets
}

function normalizeGeminiGeneratedImageUrl(value: string): string | undefined {
  const trimmed = value.trim()

  if (!trimmed) {
    return undefined
  }

  try {
    const url = new URL(trimmed)

    if (
      !url.hostname.endsWith(GEMINI_IMAGE_GENERATION_HOST) ||
      !isGeminiImagePath(url.pathname)
    ) {
      return undefined
    }

    url.protocol = 'https:'
    return url.toString()
  } catch {
    return undefined
  }
}

function isGeminiImagePath(pathname: string): boolean {
  return (
    pathname.startsWith(GEMINI_IMAGE_GENERATION_PLACEHOLDER_PATH) ||
    pathname.startsWith(GEMINI_IMAGE_GENERATION_ASSET_PATH)
  )
}

function isGeminiRenderableImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.hostname.endsWith(GEMINI_IMAGE_GENERATION_HOST) &&
      url.pathname.startsWith(GEMINI_IMAGE_GENERATION_ASSET_PATH)
    )
  } catch {
    return false
  }
}

function isGeminiPlaceholderImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.hostname.endsWith(GEMINI_IMAGE_GENERATION_HOST) &&
      url.pathname.startsWith(GEMINI_IMAGE_GENERATION_PLACEHOLDER_PATH)
    )
  } catch {
    return false
  }
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
