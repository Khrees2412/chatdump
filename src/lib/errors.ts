export class ChatdumpError extends Error {
  constructor(
    readonly code:
      | 'EXTRACT_FAILED'
      | 'FETCH_FAILED'
      | 'INVALID_URL'
      | 'UNSUPPORTED_URL',
    message: string,
  ) {
    super(message)
    this.name = 'ChatdumpError'
  }
}

export function getErrorMessage(cause: unknown): string {
  if (cause instanceof ChatdumpError) {
    return cause.message
  }

  if (cause instanceof Error) {
    return cause.message
  }

  return 'Unknown error'
}
