import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')
const definitionsPath = resolve(REPO_ROOT, 'scripts', 'data-classify', 'data', 'target-key-definitions.json')

describe('target-key-definitions webui guard', () => {
  it('defines all feature.webui.* keys so the data-classify generator picks them up', () => {
    expect(existsSync(definitionsPath)).toBe(true)
    const json = JSON.parse(readFileSync(definitionsPath, 'utf8')) as { definitions?: Array<{ targetKey: string }> }
    const webuiKeys = (json.definitions ?? [])
      .map((definition) => definition.targetKey)
      .filter((targetKey) => targetKey.startsWith('feature.webui.'))

    expect(webuiKeys).toContain('feature.webui.auth_key')
    expect(webuiKeys).toContain('feature.webui.enabled')
    expect(webuiKeys).toContain('feature.webui.host')
    expect(webuiKeys).toContain('feature.webui.port')
  })
})
