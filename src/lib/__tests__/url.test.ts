import { describe, expect, test } from 'bun:test'
import { normalizeShareUrl } from '../url'

describe('normalizeShareUrl', () => {
  test('canonicalizes ChatGPT share URLs', () => {
    const normalized = normalizeShareUrl(
      'https://chat.openai.com/share/12345678-1234-1234-1234-1234567890ab?ref=app#section',
    )

    expect(normalized.provider).toBe('chatgpt')
    expect(normalized.shareId).toBe('12345678-1234-1234-1234-1234567890ab')
    expect(normalized.url.toString()).toBe(
      'https://chatgpt.com/share/12345678-1234-1234-1234-1234567890ab',
    )
  })

  test('canonicalizes Gemini share URLs, including g.co short links', () => {
    const normalized = normalizeShareUrl(
      'https://g.co/gemini/share/ee5bab956b9f?utm_source=test#copy',
    )

    expect(normalized.provider).toBe('gemini')
    expect(normalized.shareId).toBe('ee5bab956b9f')
    expect(normalized.url.toString()).toBe(
      'https://gemini.google.com/share/ee5bab956b9f',
    )
  })
})
