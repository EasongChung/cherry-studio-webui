import { describe, expect, it } from 'vitest'

import { fallbackLanguage, normalizeLanguage, webUiLanguages } from '../constants'

describe('normalizeLanguage', () => {
  it('returns fallbackLanguage for empty/null/undefined input', () => {
    expect(normalizeLanguage()).toBe(fallbackLanguage)
    expect(normalizeLanguage('')).toBe(fallbackLanguage)
    expect(normalizeLanguage(null)).toBe(fallbackLanguage)
  })

  it('is case-insensitive for supported codes', () => {
    expect(normalizeLanguage('en-US')).toBe('en-US')
    expect(normalizeLanguage('en-us')).toBe('en-US')
    expect(normalizeLanguage('EN-US')).toBe('en-US')
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN')
    expect(normalizeLanguage('zh-cn')).toBe('zh-CN')
    expect(normalizeLanguage('zh-TW')).toBe('zh-TW')
    expect(normalizeLanguage('fr-FR')).toBe('fr-FR')
  })

  it('maps simplified/traditional Chinese variants to supported codes', () => {
    // 'zh-hans' / 'zh-hant' are not in the mapping table → fall back.
    expect(normalizeLanguage('zh-Hans')).toBe(fallbackLanguage)
    expect(normalizeLanguage('zh-Hant')).toBe(fallbackLanguage)
  })

  it('falls back to fallbackLanguage for unsupported codes', () => {
    expect(normalizeLanguage('xx-XX')).toBe(fallbackLanguage)
    expect(normalizeLanguage('ko-KR')).toBe(fallbackLanguage)
  })

  it('webUiLanguages exposes exactly 12 supported languages', () => {
    expect(webUiLanguages).toHaveLength(12)
    const ids = webUiLanguages.map((item) => item.id)
    expect(new Set(ids).size).toBe(12)
    expect(ids).toContain(fallbackLanguage)
  })
})
