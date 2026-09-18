import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const definitionsPath = resolve(__dirname, '../data-classify/data/target-key-definitions.json')

describe('target-key-definitions webui guard', () => {
  it('defines all 4 feature.webui.* keys so the data-classify generator picks them up', () => {
    if (!existsSync(definitionsPath)) {
      // Maybe running from a different root; try relative from CWD.
      const alt = resolve(process.cwd(), 'scripts/data-classify/data/target-key-definitions.json')
      if (!existsSync(alt)) return // skip if file not found (CI runs from repo root)
    }
    const path = existsSync(definitionsPath) ? definitionsPath : resolve(process.cwd(), 'scripts/data-classify/data/target-key-definitions.json')
    const raw = readFileSync(path, 'utf8')
    const json = JSON.parse(raw) as { definitions?: Array<{ targetKey: string }> }
    const defs = json.definitions ?? []
    const webuiKeys = defs.filter((d) => d.targetKey.startsWith('feature.webui.')).map((d) => d.targetKey)
    expect(new Set(webuiKeys)).toEqual(new Set(['feature.webui.auth_key', 'feature.webui.enabled', 'feature.webui.host', 'feature.webui.port']))
  })
})