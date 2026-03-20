export type MessageRole = 'assistant' | 'system' | 'unknown' | 'user'

export type ContentBlock =
  | CodeBlock
  | FileBlock
  | ImageBlock
  | ListBlock
  | QuoteBlock
  | TableBlock
  | TextBlock
  | UnknownBlock

export interface TextBlock {
  kind: 'text'
  text: string
}

export interface CodeBlock {
  code: string
  kind: 'code'
  language?: string
}

export interface QuoteBlock {
  kind: 'quote'
  text: string
}

export interface ListBlock {
  items: string[]
  kind: 'list'
  ordered: boolean
}

export interface TableBlock {
  headers: string[]
  kind: 'table'
  rows: string[][]
}

export interface ImageBlock {
  alt?: string
  kind: 'image'
  label?: string
  url?: string
}

export interface FileBlock {
  kind: 'file'
  name: string
  url?: string
}

export interface UnknownBlock {
  description: string
  kind: 'unknown'
  rawText?: string
}

export interface NormalizedMessage {
  authorName?: string
  blocks: ContentBlock[]
  createdAt?: string
  id?: string
  role: MessageRole
}

export interface NormalizedConversation {
  conversationId?: string
  createdAt?: string
  messages: NormalizedMessage[]
  sourceUrl: string
  title: string
}

export interface ConvertOptions {
  browserExtractor?: BrowserExtractor
  enableBrowserFallback?: boolean
  exportedAt?: Date
  fetchImpl?: FetchImpl
  includeMetadata?: boolean
  includeSystemMessages?: boolean
  title?: string
}

export interface ConvertResult {
  conversation: NormalizedConversation
  markdown: string
  warnings: string[]
}

export type FetchImpl = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface BrowserExtractResult {
  html?: string
  payloads?: unknown[]
  sourceUrl: string
  warnings?: string[]
}

export type BrowserExtractor = (
  url: string,
) => Promise<BrowserExtractResult | null>
