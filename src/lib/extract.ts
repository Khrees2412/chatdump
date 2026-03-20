import { load, type CheerioAPI } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import { extractConversationInBrowser } from './browser'
import { ChatdumpError } from './errors'
import { renderConversationToMarkdown } from './render'
import type {
  BrowserExtractor,
  CodeBlock,
  ContentBlock,
  ConvertOptions,
  ConvertResult,
  FileBlock,
  FetchImpl,
  ImageBlock,
  ListBlock,
  MessageRole,
  NormalizedConversation,
  NormalizedMessage,
  QuoteBlock,
  TableBlock,
  TextBlock,
} from './types'
import { getOrCreateCachedShareConversation } from './share-cache'
import {
  getDefaultConversationTitle,
  normalizeShareUrl,
  tryNormalizeShareUrl,
} from './url'

const BLOCK_TAGS = new Set([
  'article',
  'blockquote',
  'div',
  'figure',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
])

const STRUCTURED_PAYLOAD_HINT =
  /("__NEXT_DATA__"|"loaderData"|"mapping"|"messages"|"conversation_id"|"serverResponse")|__NEXT_DATA__|__remixContext|__reactRouterDataRouter|__staticRouterHydrationData/

export async function convertShareUrlToMarkdown(
  rawUrl: string,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const { url } = normalizeShareUrl(rawUrl)
  const fetchImpl = options.fetchImpl ?? fetch

  const cached = await getOrCreateCachedShareConversation(url.toString(), async () => {
    const { finalUrl, html } = await fetchSharePage(url, fetchImpl)
    const { conversation, warnings } = await extractConversation(html, {
      browserExtractor: options.browserExtractor,
      browserUrl: url.toString(),
      enableBrowserFallback: options.enableBrowserFallback,
      sourceUrl: finalUrl,
    })

    return {
      conversation,
      warnings,
    }
  })

  const conversation = cached.conversation

  if (options.title?.trim()) {
    conversation.title = options.title.trim()
  }

  const markdown = renderConversationToMarkdown(conversation, {
    exportedAt: options.exportedAt,
    includeMetadata: options.includeMetadata,
    includeSystemMessages: options.includeSystemMessages,
  })

  return {
    conversation,
    markdown,
    warnings: cached.warnings,
  }
}

export async function fetchSharePage(
  url: URL,
  fetchImpl: FetchImpl,
): Promise<{ finalUrl: string; html: string }> {
  let response: Response

  try {
    response = await fetchImpl(url.toString(), {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'chatdump/0.1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (cause) {
    throw new ChatdumpError(
      'FETCH_FAILED',
      `failed to fetch share page: ${cause instanceof Error ? cause.message : 'network error'}`,
    )
  }

  if (!response.ok) {
    throw new ChatdumpError(
      'FETCH_FAILED',
      `failed to fetch share page: HTTP ${response.status}`,
    )
  }

  const html = await response.text()

  if (!html.trim()) {
    throw new ChatdumpError('FETCH_FAILED', 'failed to fetch share page: empty body')
  }

  return {
    finalUrl: response.url || url.toString(),
    html,
  }
}

async function extractConversation(
  html: string,
  options: {
    browserExtractor?: BrowserExtractor
    browserUrl: string
    enableBrowserFallback?: boolean
    sourceUrl: string
  },
): Promise<{ conversation: NormalizedConversation; warnings: string[] }> {
  try {
    return extractConversationFromHtml(html, options.sourceUrl)
  } catch (cause) {
    if (
      !(cause instanceof ChatdumpError) ||
      cause.code !== 'EXTRACT_FAILED' ||
      options.enableBrowserFallback === false
    ) {
      throw cause
    }

    console.warn('[chatdump] Static extraction failed; trying browser fallback', {
      browserUrl: options.browserUrl,
      error: cause.message,
      sourceUrl: options.sourceUrl,
    })

    const fallback = await tryBrowserFallback(
      options.browserUrl,
      options.browserExtractor,
    )

    switch (fallback.status) {
      case 'success':
        return fallback.result
      case 'unavailable':
        throw new ChatdumpError(
          'EXTRACT_FAILED',
          `${cause.message}; ${getBrowserFallbackUnavailableMessage()}`,
        )
      case 'failed':
        throw new ChatdumpError(
          'EXTRACT_FAILED',
          `${cause.message}; browser fallback failed: ${getFailureMessage(fallback.cause)}`,
        )
    }
  }
}

async function tryBrowserFallback(
  url: string,
  browserExtractor?: BrowserExtractor,
): Promise<
  | {
      result: { conversation: NormalizedConversation; warnings: string[] }
      status: 'success'
    }
  | { status: 'failed'; cause: unknown }
  | { status: 'unavailable' }
> {
  const extractor = browserExtractor ?? extractConversationInBrowser
  console.info('[chatdump] Browser fallback starting', {
    extractor: browserExtractor ? 'custom' : 'default',
    url,
  })

  try {
    const browserResult = await extractor(url)

    if (!browserResult) {
      console.warn('[chatdump] Browser fallback unavailable', { url })
      return { status: 'unavailable' }
    }

    const warnings = [...(browserResult.warnings ?? [])]
    const pageTitle = browserResult.html
      ? extractPageTitle(load(browserResult.html), browserResult.sourceUrl)
      : getDefaultConversationTitle(browserResult.sourceUrl)
    const conversation = selectBestConversationFromPayloads(
      browserResult.payloads ?? [],
      browserResult.sourceUrl,
      pageTitle,
    )

    if (conversation) {
      console.info('[chatdump] Browser fallback succeeded from extracted payloads', {
        payloadCount: browserResult.payloads?.length ?? 0,
        sourceUrl: browserResult.sourceUrl,
        url,
        warningCount: warnings.length,
      })
      return {
        result: {
          conversation,
          warnings,
        },
        status: 'success',
      }
    }

    if (browserResult.html) {
      const extracted = extractConversationFromHtml(
        browserResult.html,
        browserResult.sourceUrl,
      )

      console.info('[chatdump] Browser fallback succeeded from browser HTML', {
        sourceUrl: browserResult.sourceUrl,
        url,
        warningCount: warnings.length + extracted.warnings.length,
      })

      return {
        result: {
          conversation: extracted.conversation,
          warnings: [...warnings, ...extracted.warnings],
        },
        status: 'success',
      }
    }

    return {
      cause: new ChatdumpError(
        'EXTRACT_FAILED',
        'browser fallback executed but no conversation payload or message markup was found',
      ),
      status: 'failed',
    }
  } catch (cause) {
    console.error('[chatdump] Browser fallback failed', {
      error: getFailureMessage(cause),
      url,
    })
    return {
      cause,
      status: 'failed',
    }
  }
}

function getBrowserFallbackUnavailableMessage(): string {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return 'browser fallback was unavailable in this deployment; check Vercel logs for serverless runtime loading errors'
  }

  return 'install playwright to enable browser fallback'
}

function getFailureMessage(cause: unknown): string {
  const message = getRawFailureMessage(cause)
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ?? 'unknown browser error'
}

function getRawFailureMessage(cause: unknown): string {
  if (cause instanceof ChatdumpError) {
    return cause.message
  }

  if (cause instanceof Error) {
    return cause.message
  }

  return 'unknown browser error'
}

export function extractConversationFromHtml(
  html: string,
  sourceUrl: string,
): { conversation: NormalizedConversation; warnings: string[] } {
  const $ = load(html)
  const warnings: string[] = []
  const structured = extractStructuredConversation($, sourceUrl)

  if (structured) {
    return {
      conversation: structured,
      warnings,
    }
  }

  const domConversation = extractDomConversation($, sourceUrl)

  if (domConversation) {
    warnings.push('Fell back to DOM extraction; formatting may be lossy.')

    return {
      conversation: domConversation,
      warnings,
    }
  }

  throw new ChatdumpError(
    'EXTRACT_FAILED',
    buildExtractionFailureMessage($, sourceUrl),
  )
}

function buildExtractionFailureMessage(
  $: CheerioAPI,
  sourceUrl: string,
): string {
  const defaultTitle = getDefaultConversationTitle(sourceUrl)
  const pageTitle = extractPageTitle($, sourceUrl)
  const scriptTexts = $('script')
    .toArray()
    .map((element) => $(element).html()?.trim() ?? '')
    .filter(Boolean)
  const hasStructuredHint = scriptTexts.some((text) => hasStructuredPayloadHint(text))
  const hasDomMessages = $('[data-message-author-role]').length > 0
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const looksLikeLoginPage =
    /(?:^|\b)log in(?:\b|$)/i.test(bodyText) &&
    /(?:^|\b)sign up(?:\b|$)/i.test(bodyText)
  const redirectedAwayFromShare = didRedirectAwayFromShare(sourceUrl)
  const titleSuffix =
    pageTitle && pageTitle !== defaultTitle ? ` (page title: ${pageTitle})` : ''

  if (redirectedAwayFromShare) {
    return `could not extract conversation data from share page: request resolved to a non-share page (${sourceUrl})${titleSuffix}`
  }

  if (hasStructuredHint) {
    return `could not extract conversation data from share page: found embedded payload markers but could not decode a conversation payload${titleSuffix}`
  }

  if (!hasDomMessages && looksLikeLoginPage) {
    return `could not extract conversation data from share page: received a generic page instead of a public shared conversation${titleSuffix}`
  }

  return `could not extract conversation data from share page: no conversation payload or message markup was found${titleSuffix}`
}

function didRedirectAwayFromShare(sourceUrl: string): boolean {
  return tryNormalizeShareUrl(sourceUrl) === null
}

function extractStructuredConversation(
  $: CheerioAPI,
  sourceUrl: string,
): NormalizedConversation | null {
  const pageTitle = extractPageTitle($, sourceUrl)
  const targetedConversation = selectBestConversationFromPayloads(
    collectFastStructuredPayloads($),
    sourceUrl,
    pageTitle,
  )

  if (targetedConversation) {
    return targetedConversation
  }

  return selectBestConversationFromPayloads(collectStructuredPayloads($), sourceUrl, pageTitle)
}

function selectBestConversationFromPayloads(
  payloads: unknown[],
  sourceUrl: string,
  pageTitle: string,
): NormalizedConversation | null {
  const preferred = selectBestConversationFromCandidates(
    payloads.flatMap((payload) => findKnownConversationCandidates(payload)),
    sourceUrl,
    pageTitle,
  )

  if (preferred) {
    return preferred
  }

  return selectBestConversationFromCandidates(
    payloads.flatMap((payload) => findConversationCandidates(payload)),
    sourceUrl,
    pageTitle,
  )
}

function selectBestConversationFromCandidates(
  candidates: unknown[],
  sourceUrl: string,
  pageTitle: string,
): NormalizedConversation | null {
  const defaultTitle = getDefaultConversationTitle(sourceUrl)
  let best: { conversation: NormalizedConversation; score: number } | null = null

  for (const candidate of candidates) {
    const conversation = normalizeConversationCandidate(
      candidate,
      sourceUrl,
      pageTitle,
    )

    if (!conversation || conversation.messages.length === 0) {
      continue
    }

    const score =
      conversation.messages.length * 10 +
      (conversation.conversationId ? 4 : 0) +
      (conversation.title !== defaultTitle ? 2 : 0)

    if (!best || score > best.score) {
      best = {
        conversation,
        score,
      }
    }
  }

  return best?.conversation ?? null
}

function collectFastStructuredPayloads($: CheerioAPI): unknown[] {
  const payloads: unknown[] = []
  const nextDataText = $('#__NEXT_DATA__').first().html()?.trim() ?? ''

  if (nextDataText) {
    const parsed = safeJsonParse(nextDataText)

    if (parsed !== null) {
      payloads.push(parsed)
    }
  }

  $('script').each((_, element) => {
    const script = $(element)

    if (script.attr('id') === '__NEXT_DATA__') {
      return
    }

    const text = script.html()?.trim() ?? ''

    if (!looksLikeHydrationBootstrap(text)) {
      return
    }

    for (const candidate of extractJsonParsePayloads(text)) {
      const parsed = safeJsonParse(candidate)

      if (parsed !== null) {
        payloads.push(parsed)
      }
    }
  })

  return payloads
}

function collectStructuredPayloads($: CheerioAPI): unknown[] {
  const payloads: unknown[] = []

  $('script').each((_, element) => {
    const script = $(element)
    const text = script.html()?.trim() ?? ''

    if (!text) {
      return
    }

    const type = script.attr('type') ?? ''
    const isJsonScript = type.includes('json') || script.attr('id') === '__NEXT_DATA__'

    if (isJsonScript || looksLikeJson(text)) {
      const parsed = safeJsonParse(text)

      if (parsed !== null) {
        payloads.push(parsed)
        return
      }
    }

    if (!hasStructuredPayloadHint(text)) {
      return
    }

    for (const candidate of extractJsonParsePayloads(text)) {
      const parsed = safeJsonParse(candidate)

      if (parsed !== null) {
        payloads.push(parsed)
      }
    }

    for (const candidate of extractBalancedJsonObjects(text)) {
      const parsed = safeJsonParse(candidate)

      if (parsed !== null) {
        payloads.push(parsed)
      }
    }
  })

  return payloads
}

function looksLikeJson(text: string): boolean {
  return text.startsWith('{') || text.startsWith('[')
}

function looksLikeHydrationBootstrap(text: string): boolean {
  return (
    text.includes('__staticRouterHydrationData') ||
    text.includes('__reactRouterDataRouter') ||
    text.includes('__remixContext')
  )
}

function hasStructuredPayloadHint(text: string): boolean {
  return STRUCTURED_PAYLOAD_HINT.test(text)
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractJsonParsePayloads(text: string): string[] {
  const results: string[] = []
  let searchIndex = 0

  while (searchIndex < text.length) {
    const parseIndex = text.indexOf('JSON.parse(', searchIndex)

    if (parseIndex === -1) {
      break
    }

    let index = parseIndex + 'JSON.parse('.length

    while (/\s/.test(text[index] ?? '')) {
      index += 1
    }

    const argument = readJsonParseArgument(text, index)

    if (argument && looksLikeJson(argument.value)) {
      results.push(argument.value)
      searchIndex = argument.end
      continue
    }

    searchIndex = index
  }

  return results
}

function readJsonParseArgument(
  text: string,
  index: number,
): { end: number; value: string } | null {
  if (text.startsWith('decodeURIComponent(', index)) {
    let cursor = index + 'decodeURIComponent('.length

    while (/\s/.test(text[cursor] ?? '')) {
      cursor += 1
    }

    const literal = readQuotedString(text, cursor)

    if (!literal) {
      return null
    }

    cursor = literal.end

    while (/\s/.test(text[cursor] ?? '')) {
      cursor += 1
    }

    if (text[cursor] !== ')') {
      return null
    }

    try {
      return {
        end: cursor + 1,
        value: decodeURIComponent(literal.value),
      }
    } catch {
      return null
    }
  }

  return readQuotedString(text, index)
}

function readQuotedString(
  text: string,
  start: number,
): { end: number; value: string } | null {
  const quote = text[start]

  if (quote !== '"' && quote !== '\'' && quote !== '`') {
    return null
  }

  let value = ''

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]

    if (char === '\\') {
      const escaped = decodeEscapedCharacter(text, index + 1)

      if (!escaped) {
        return null
      }

      value += escaped.value
      index = escaped.end - 1
      continue
    }

    if (char === quote) {
      return {
        end: index + 1,
        value,
      }
    }

    if (quote !== '`' && (char === '\n' || char === '\r')) {
      return null
    }

    value += char
  }

  return null
}

function decodeEscapedCharacter(
  text: string,
  index: number,
): { end: number; value: string } | null {
  const char = text[index]

  if (!char) {
    return null
  }

  switch (char) {
    case '\n':
      return { end: index + 1, value: '' }
    case '\r':
      return {
        end: text[index + 1] === '\n' ? index + 2 : index + 1,
        value: '',
      }
    case 'b':
      return { end: index + 1, value: '\b' }
    case 'f':
      return { end: index + 1, value: '\f' }
    case 'n':
      return { end: index + 1, value: '\n' }
    case 'r':
      return { end: index + 1, value: '\r' }
    case 't':
      return { end: index + 1, value: '\t' }
    case 'v':
      return { end: index + 1, value: '\v' }
    case 'x': {
      const hex = text.slice(index + 1, index + 3)

      if (!/^[\da-fA-F]{2}$/.test(hex)) {
        return null
      }

      return {
        end: index + 3,
        value: String.fromCodePoint(Number.parseInt(hex, 16)),
      }
    }
    case 'u': {
      if (text[index + 1] === '{') {
        const closingIndex = text.indexOf('}', index + 2)

        if (closingIndex === -1) {
          return null
        }

        const codePoint = text.slice(index + 2, closingIndex)

        if (!/^[\da-fA-F]+$/.test(codePoint)) {
          return null
        }

        return {
          end: closingIndex + 1,
          value: String.fromCodePoint(Number.parseInt(codePoint, 16)),
        }
      }

      const hex = text.slice(index + 1, index + 5)

      if (!/^[\da-fA-F]{4}$/.test(hex)) {
        return null
      }

      return {
        end: index + 5,
        value: String.fromCodePoint(Number.parseInt(hex, 16)),
      }
    }
    default:
      return { end: index + 1, value: char }
  }
}

function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  let quote = '"'

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (start === -1) {
      if (char === '{') {
        start = index
        depth = 1
      }

      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
      }

      continue
    }

    if (char === '"' || char === '\'') {
      inString = true
      quote = char
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1

      if (depth === 0) {
        const candidate = text.slice(start, index + 1)

        if (hasStructuredPayloadHint(candidate)) {
          results.push(candidate)
        }

        start = -1
      }
    }
  }

  return results
}

function findKnownConversationCandidates(root: unknown): unknown[] {
  const candidates: unknown[] = []
  const seen = new Set<unknown>()

  function add(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) {
      return
    }

    seen.add(value)
    candidates.push(value)
  }

  const record = asRecord(root)

  if (!record) {
    return candidates
  }

  add(record.shareData)
  add(record.conversation)
  add(asRecord(record.serverResponse)?.data)
  add(record.data)

  const props = asRecord(record.props)
  const pageProps = asRecord(props?.pageProps)
  add(pageProps?.shareData)
  add(pageProps?.conversation)
  add(pageProps?.data)

  collectKnownLoaderCandidates(record.loaderData, add)
  collectKnownLoaderCandidates(asRecord(record.state)?.loaderData, add)

  return candidates
}

function collectKnownLoaderCandidates(
  loaderData: unknown,
  add: (value: unknown) => void,
) {
  const record = asRecord(loaderData)

  if (!record) {
    return
  }

  for (const value of Object.values(record)) {
    add(value)
    add(asRecord(value)?.data)
    add(asRecord(asRecord(value)?.serverResponse)?.data)
  }
}

function findConversationCandidates(root: unknown): unknown[] {
  const seen = new Set<unknown>()
  const candidates: unknown[] = []

  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || seen.has(value)) {
      return
    }

    seen.add(value)

    if (looksLikeMappingConversation(value) || looksLikeMessagesConversation(value)) {
      candidates.push(value)
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }

    for (const child of Object.values(value as Record<string, unknown>)) {
      visit(child)
    }
  }

  visit(root)

  return candidates
}

function looksLikeMappingConversation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const mapping = (value as Record<string, unknown>).mapping

  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return false
  }

  return Object.values(mapping).some((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return false
    }

    const candidate = node as Record<string, unknown>
    return 'message' in candidate || 'children' in candidate
  })
}

function looksLikeMessagesConversation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const messages = (value as Record<string, unknown>).messages

  return (
    Array.isArray(messages) &&
    messages.some((message) => looksLikeMessageRecord(message))
  )
}

function looksLikeMessageRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.role === 'string' ||
    typeof (record.author as Record<string, unknown> | undefined)?.role === 'string' ||
    'content' in record
  )
}

function normalizeConversationCandidate(
  candidate: unknown,
  sourceUrl: string,
  pageTitle: string,
): NormalizedConversation | null {
  if (looksLikeMappingConversation(candidate)) {
    return normalizeMappingConversation(
      candidate as Record<string, unknown>,
      sourceUrl,
      pageTitle,
    )
  }

  if (looksLikeMessagesConversation(candidate)) {
    return normalizeMessagesConversation(
      candidate as Record<string, unknown>,
      sourceUrl,
      pageTitle,
    )
  }

  return null
}

function normalizeMappingConversation(
  candidate: Record<string, unknown>,
  sourceUrl: string,
  pageTitle: string,
): NormalizedConversation | null {
  const mappingValue = candidate.mapping

  if (!mappingValue || typeof mappingValue !== 'object' || Array.isArray(mappingValue)) {
    return null
  }

  const mapping = mappingValue as Record<string, Record<string, unknown>>
  const orderedIds: string[] = []
  const visited = new Set<string>()

  const roots = Object.entries(mapping)
    .filter(([, node]) => {
      const parent = typeof node.parent === 'string' ? node.parent : undefined
      return !parent || !mapping[parent]
    })
    .map(([id]) => id)

  function walk(id: string) {
    if (visited.has(id) || !mapping[id]) {
      return
    }

    visited.add(id)
    orderedIds.push(id)

    const children = Array.isArray(mapping[id].children)
      ? mapping[id].children.filter((child): child is string => typeof child === 'string')
      : []

    for (const child of children) {
      walk(child)
    }
  }

  for (const rootId of roots) {
    walk(rootId)
  }

  for (const id of Object.keys(mapping)) {
    walk(id)
  }

  const messages = orderedIds
    .map((id) => normalizeMessage(mapping[id].message, id))
    .filter((message): message is NormalizedMessage => Boolean(message))

  if (messages.length === 0) {
    return null
  }

  return {
    conversationId:
      readString(candidate.conversation_id) ?? readString(candidate.id) ?? undefined,
    createdAt:
      normalizeTimestamp(candidate.create_time) ??
      normalizeTimestamp(candidate.created_at) ??
      messages[0]?.createdAt,
    messages,
    sourceUrl,
    title:
      readString(candidate.title) ??
      readString(candidate.name) ??
      pageTitle ??
      getDefaultConversationTitle(sourceUrl),
  }
}

function normalizeMessagesConversation(
  candidate: Record<string, unknown>,
  sourceUrl: string,
  pageTitle: string,
): NormalizedConversation | null {
  const messageList = candidate.messages

  if (!Array.isArray(messageList)) {
    return null
  }

  const normalized = messageList
    .map((message, index) => normalizeMessage(message, `message-${index + 1}`))
    .filter((message): message is NormalizedMessage => Boolean(message))

  if (normalized.length === 0) {
    return null
  }

  normalized.sort((left, right) => {
    if (!left.createdAt || !right.createdAt) {
      return 0
    }

    return left.createdAt.localeCompare(right.createdAt)
  })

  return {
    conversationId:
      readString(candidate.conversation_id) ?? readString(candidate.id) ?? undefined,
    createdAt:
      normalizeTimestamp(candidate.create_time) ??
      normalizeTimestamp(candidate.created_at) ??
      normalized[0]?.createdAt,
    messages: normalized,
    sourceUrl,
    title:
      readString(candidate.title) ??
      readString(candidate.name) ??
      pageTitle ??
      getDefaultConversationTitle(sourceUrl),
  }
}

function normalizeMessage(
  candidate: unknown,
  fallbackId: string,
): NormalizedMessage | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null
  }

  const message = candidate as Record<string, unknown>
  const blocks = compactBlocks([
    ...extractMessageBlocks(message),
    ...extractAttachments(message),
  ])

  if (blocks.length === 0) {
    return null
  }

  return {
    authorName: normalizeAuthorName(message),
    blocks,
    createdAt:
      normalizeTimestamp(message.create_time) ??
      normalizeTimestamp(message.created_at) ??
      undefined,
    id: readString(message.id) ?? fallbackId,
    role: normalizeRole(message),
  }
}

function extractMessageBlocks(message: Record<string, unknown>): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const content = asRecord(message.content) ?? asRecord(message.message)

  if (typeof message.text === 'string') {
    blocks.push(textBlock(message.text))
  }

  if (!content) {
    return blocks
  }

  const contentType = readString(content.content_type) ?? readString(content.type)

  if (contentType === 'code') {
    blocks.push({
      code:
        readString(content.text) ??
        readString(content.code) ??
        readFirstString(content.parts) ??
        '',
      kind: 'code',
      language: readString(content.language),
    } satisfies CodeBlock)
  }

  for (const part of readParts(content)) {
    blocks.push(...normalizePart(part))
  }

  if (blocks.length === 0) {
    if (typeof content.text === 'string') {
      blocks.push(textBlock(content.text))
    } else if (Array.isArray(content.text)) {
      for (const part of content.text) {
        if (typeof part === 'string') {
          blocks.push(textBlock(part))
        }
      }
    }
  }

  return blocks
}

function readParts(content: Record<string, unknown>): unknown[] {
  if (Array.isArray(content.parts)) {
    return content.parts
  }

  if (typeof content.text === 'string') {
    return [content.text]
  }

  if (Array.isArray(content.text)) {
    return content.text
  }

  return []
}

function normalizePart(part: unknown): ContentBlock[] {
  if (typeof part === 'string') {
    return [textBlock(part)]
  }

  if (!part || typeof part !== 'object' || Array.isArray(part)) {
    return []
  }

  const record = part as Record<string, unknown>
  const type = readString(record.content_type) ?? readString(record.type)

  if (type === 'code') {
    return [
      {
        code:
          readString(record.text) ??
          readString(record.code) ??
          readFirstString(record.parts) ??
          '',
        kind: 'code',
        language: readString(record.language),
      } satisfies CodeBlock,
    ]
  }

  if (type === 'image') {
    return [
      {
        alt: readString(record.alt),
        kind: 'image',
        label: readString(record.name) ?? readString(record.label),
        url: readString(record.url),
      } satisfies ImageBlock,
    ]
  }

  if (type === 'file') {
    return [
      {
        kind: 'file',
        name: readString(record.name) ?? 'attachment',
        url: readString(record.url),
      } satisfies FileBlock,
    ]
  }

  if (typeof record.text === 'string') {
    return [textBlock(record.text)]
  }

  if (Array.isArray(record.parts)) {
    return record.parts.flatMap((nested) => normalizePart(nested))
  }

  return []
}

function extractAttachments(message: Record<string, unknown>): ContentBlock[] {
  const attachmentCollections = [
    message.attachments,
    asRecord(message.metadata)?.attachments,
  ]

  const blocks: ContentBlock[] = []

  for (const collection of attachmentCollections) {
    if (!Array.isArray(collection)) {
      continue
    }

    for (const entry of collection) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue
      }

      const attachment = entry as Record<string, unknown>
      const name =
        readString(attachment.name) ??
        readString(attachment.filename) ??
        readString(attachment.display_name) ??
        'attachment'
      const url = readString(attachment.url) ?? readString(attachment.download_url)
      const mimeType = readString(attachment.mime_type) ?? readString(attachment.mimeType)

      if (mimeType?.startsWith('image/')) {
        blocks.push({
          alt: name,
          kind: 'image',
          label: name,
          url,
        } satisfies ImageBlock)
      } else {
        blocks.push({
          kind: 'file',
          name,
          url,
        } satisfies FileBlock)
      }
    }
  }

  return blocks
}

function normalizeRole(message: Record<string, unknown>): MessageRole {
  const author = asRecord(message.author)
  const rawRole =
    readString(author?.role) ??
    readString(message.role) ??
    readString(message.author_role) ??
    'unknown'

  switch (rawRole.toLowerCase()) {
    case 'assistant':
      return 'assistant'
    case 'system':
      return 'system'
    case 'user':
    case 'human':
      return 'user'
    default:
      return 'unknown'
  }
}

function normalizeAuthorName(message: Record<string, unknown>): string | undefined {
  const author = asRecord(message.author)
  return (
    readString(author?.name) ??
    readString(asRecord(message.metadata)?.model_slug) ??
    undefined
  )
}

function extractDomConversation(
  $: CheerioAPI,
  sourceUrl: string,
): NormalizedConversation | null {
  const elements = $('[data-message-author-role]').toArray()

  if (elements.length === 0) {
    return null
  }

  const messages: NormalizedMessage[] = []

  elements.forEach((element, index) => {
    const role = normalizeDomRole($(element).attr('data-message-author-role'))
    const blocks = compactBlocks(extractBlocksFromNodes($(element).contents().toArray(), $))

    if (blocks.length === 0) {
      return
    }

    messages.push({
      blocks,
      id: `dom-${index + 1}`,
      role,
    })
  })

  if (messages.length === 0) {
    return null
  }

  return {
    messages,
    sourceUrl,
    title: extractPageTitle($, sourceUrl),
  }
}

function normalizeDomRole(value: string | undefined): MessageRole {
  switch ((value ?? '').toLowerCase()) {
    case 'assistant':
      return 'assistant'
    case 'system':
      return 'system'
    case 'user':
      return 'user'
    default:
      return 'unknown'
  }
}

function extractBlocksFromNodes(nodes: AnyNode[], $: CheerioAPI): ContentBlock[] {
  const blocks = nodes.flatMap((node) => extractBlocksFromNode(node, $))
  return compactBlocks(blocks)
}

function extractBlocksFromNode(node: AnyNode, $: CheerioAPI): ContentBlock[] {
  if (node.type === 'text') {
    const text = normalizeInlineText(node.data)
    return text ? [textBlock(text)] : []
  }

  if (node.type !== 'tag') {
    return []
  }

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  switch (tag) {
    case 'pre':
      return [extractCodeBlock(element, $)]
    case 'blockquote':
      return [extractQuoteBlock(element, $)]
    case 'ul':
    case 'ol':
      return [extractListBlock(element, $, tag === 'ol')]
    case 'table':
      return [extractTableBlock(element, $)]
    case 'img':
      return [extractImageBlock(element, $)]
    case 'article':
    case 'div':
    case 'section':
      if (hasNestedBlockChildren(element)) {
        return extractBlocksFromNodes(element.children, $)
      }

      return paragraphBlock(element, $)
    case 'p':
      return paragraphBlock(element, $)
    default: {
      const inline = renderInlineNodes(element.children, $)
      return inline ? [textBlock(inline)] : []
    }
  }
}

function paragraphBlock(element: Element, $: CheerioAPI): ContentBlock[] {
  const inline = renderInlineNodes(element.children, $)
  return inline ? [textBlock(inline)] : []
}

function hasNestedBlockChildren(element: Element): boolean {
  return element.children.some(
    (child) => child.type === 'tag' && BLOCK_TAGS.has((child as Element).tagName),
  )
}

function extractCodeBlock(element: Element, $: CheerioAPI): CodeBlock {
  const codeElement = $(element).find('code').first()
  const languageClass = codeElement.attr('class') ?? ''
  const languageMatch = languageClass.match(/language-([\w-]+)/)

  return {
    code: codeElement.text() || $(element).text(),
    kind: 'code',
    language: languageMatch?.[1],
  }
}

function extractQuoteBlock(element: Element, $: CheerioAPI): QuoteBlock {
  return {
    kind: 'quote',
    text: renderInlineNodes(element.children, $),
  }
}

function extractListBlock(
  element: Element,
  $: CheerioAPI,
  ordered: boolean,
): ListBlock {
  const items = $(element)
    .children('li')
    .toArray()
    .map((item) => {
      const cloned = $(item).clone()

      cloned.children('ul, ol').remove()

      const primary = renderInlineNodes(cloned.contents().toArray(), $)
      const nested = $(item)
        .children('ul, ol')
        .toArray()
        .map((list) =>
          $(list)
            .children('li')
            .toArray()
            .map((nestedItem, index) => {
              const prefix = list.tagName.toLowerCase() === 'ol' ? `${index + 1}. ` : '- '
              return `${prefix}${renderInlineNodes($(nestedItem).contents().toArray(), $)}`
            })
            .join('\n'),
        )
        .filter(Boolean)
        .join('\n')

      return [primary, nested].filter(Boolean).join('\n')
    })
    .filter(Boolean)

  return {
    items,
    kind: 'list',
    ordered,
  }
}

function extractTableBlock(element: Element, $: CheerioAPI): TableBlock {
  const rows = $(element)
    .find('tr')
    .toArray()
    .map((row) =>
      $(row)
        .children('th, td')
        .toArray()
        .map((cell) => renderInlineNodes($(cell).contents().toArray(), $)),
    )
    .filter((row) => row.length > 0)

  if (rows.length === 0) {
    return {
      headers: [],
      kind: 'table',
      rows: [],
    }
  }

  const headerCells = $(element)
    .find('thead tr')
    .first()
    .children('th, td')
    .toArray()
    .map((cell) => renderInlineNodes($(cell).contents().toArray(), $))

  return {
    headers: headerCells.length > 0 ? headerCells : rows[0] ?? [],
    kind: 'table',
    rows: headerCells.length > 0 ? rows.slice(1) : rows,
  }
}

function extractImageBlock(element: Element, $: CheerioAPI): ImageBlock {
  return {
    alt: $(element).attr('alt') ?? undefined,
    kind: 'image',
    label: $(element).attr('title') ?? undefined,
    url: $(element).attr('src') ?? undefined,
  }
}

function renderInlineNodes(nodes: AnyNode[], $: CheerioAPI): string {
  const rendered = nodes.map((node) => renderInlineNode(node, $)).join('')
  return rendered
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderInlineNode(node: AnyNode, $: CheerioAPI): string {
  if (node.type === 'text') {
    return normalizeInlineText(node.data)
  }

  if (node.type !== 'tag') {
    return ''
  }

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  switch (tag) {
    case 'br':
      return '\n'
    case 'strong':
    case 'b':
      return wrap('**', renderInlineNodes(element.children, $))
    case 'em':
    case 'i':
      return wrap('*', renderInlineNodes(element.children, $))
    case 'code':
      return wrap('`', renderInlineNodes(element.children, $))
    case 'a': {
      const href = $(element).attr('href')
      const label = renderInlineNodes(element.children, $) || href || ''
      return href ? `[${label}](${href})` : label
    }
    case 'img': {
      const alt = $(element).attr('alt') || 'Image'
      const src = $(element).attr('src')
      return src ? `![${alt}](${src})` : `[Image: ${alt}]`
    }
    default:
      return renderInlineNodes(element.children, $)
  }
}

function wrap(token: string, text: string): string {
  if (!text) {
    return ''
  }

  return `${token}${text}${token}`
}

function compactBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const compacted: ContentBlock[] = []

  for (const block of blocks) {
    if (!isMeaningfulBlock(block)) {
      continue
    }

    const previous = compacted.at(-1)

    if (previous?.kind === 'text' && block.kind === 'text') {
      previous.text = `${previous.text}\n\n${block.text}`.trim()
      continue
    }

    compacted.push(block)
  }

  return compacted
}

function isMeaningfulBlock(block: ContentBlock): boolean {
  switch (block.kind) {
    case 'text':
      return block.text.trim().length > 0
    case 'code':
      return block.code.trim().length > 0
    case 'quote':
      return block.text.trim().length > 0
    case 'list':
      return block.items.some((item) => item.trim().length > 0)
    case 'table':
      return block.headers.length > 0 || block.rows.length > 0
    case 'image':
      return Boolean(block.url || block.alt || block.label)
    case 'file':
      return block.name.trim().length > 0
    case 'unknown':
      return Boolean(block.description || block.rawText)
  }
}

function textBlock(text: string): TextBlock {
  return {
    kind: 'text',
    text: text.replace(/\r\n/g, '\n').trim(),
  }
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractPageTitle($: CheerioAPI, sourceUrl?: string): string {
  const rawTitle =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim()
  const cleanedTitle = rawTitle
    .replace(/^[\u200e\u200f\u202a-\u202e]+/gu, '')
    .replace(/\s*-\s*ChatGPT$/i, '')
    .replace(/^Gemini\s*-\s*/i, '')
    .replace(/\s*-\s*Gemini$/i, '')
    .trim()

  return cleanedTitle || getDefaultConversationTitle(sourceUrl)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readFirstString(value: unknown): string | undefined {
  return Array.isArray(value)
    ? value.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : undefined
}

function normalizeTimestamp(value: unknown): string | undefined {
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
