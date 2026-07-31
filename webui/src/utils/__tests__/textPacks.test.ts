import { describe, expect, it } from 'vitest'

import { fallbackLanguage, webUiLanguages } from '../constants'
import { contextCategoryTextKeys, type TextKey, textPacks } from '../textPacks'

describe('textPacks', () => {
  const languages = Object.keys(textPacks) as Array<keyof typeof textPacks>

  it('contains exactly the supported languages', () => {
    expect(languages.sort()).toEqual(webUiLanguages.map((item) => item.id).sort())
  })

  it('has identical key sets across all languages', () => {
    const reference = Object.keys(textPacks[fallbackLanguage]).sort() as TextKey[]
    for (const lang of languages) {
      expect(Object.keys(textPacks[lang]).sort(), `key mismatch in ${String(lang)}`).toEqual(reference)
    }
  })

  it('has no empty translations in the fallback pack', () => {
    for (const key of Object.keys(textPacks[fallbackLanguage]) as TextKey[]) {
      expect(String(textPacks[fallbackLanguage][key]).length, `empty key: ${key}`).toBeGreaterThan(0)
    }
  })

  it('exposes a valid fallback translation for every key', () => {
    const fallback = textPacks[fallbackLanguage]
    for (const lang of languages) {
      for (const key of Object.keys(fallback) as TextKey[]) {
        expect(textPacks[lang][key], `missing '${String(key)}' in ${String(lang)}`).toBeDefined()
      }
    }
  })
})

describe('contextCategoryTextKeys', () => {
  it('maps context categories to valid TextKey values', () => {
    const validKeys = new Set(Object.keys(textPacks[fallbackLanguage]))
    for (const [category, textKey] of Object.entries(contextCategoryTextKeys)) {
      expect(validKeys.has(textKey), `'${category}' → invalid key '${textKey}'`).toBe(true)
    }
  })
})
