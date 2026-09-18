import { describe, expect, it, vi } from 'vitest'

import { renderDocxPreviewHtml } from '../docxPreview'

const textEncoder = new TextEncoder()

const buildZip = (entries: { name: string; data: Uint8Array; declaredUncompressed?: number }[]) => {
  const nameBytes = (name: string) => textEncoder.encode(name)
  const byteArrays: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = nameBytes(entry.name)
    const compSize = entry.data.length
    const uncompessed = entry.declaredUncompressed ?? compSize

    const local = new Uint8Array(30 + name.length + compSize)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header signature
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(8, 0, true) // method: stored
    lv.setUint32(18, compSize, true)
    lv.setUint32(22, uncompessed, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(entry.data, 30 + name.length)
    byteArrays.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // central directory signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint32(20, compSize, true)
    cv.setUint32(24, uncompessed, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, localOffset, true)
    central.set(name, 46)
    centrals.push(central)

    localOffset += local.length
  }

  const centralSize = centrals.reduce((size, central) => size + central.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central directory signature
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, localOffset, true)

  const total = localOffset + centralSize + eocd.length
  const result = new Uint8Array(total)
  let cursor = 0
  for (const part of [...byteArrays, ...centrals, eocd]) {
    result.set(part, cursor)
    cursor += part.length
  }
  return result
}

const asBlob = (bytes: Uint8Array) => new Blob([bytes])

const renderAsyncMock = vi.fn()

vi.mock('docx-preview', () => ({
  renderAsync: renderAsyncMock
}))

const injectHostileBody = () => {
  renderAsyncMock.mockImplementation(async (_bytes: Uint8Array, body: HTMLElement) => {
    body.innerHTML = [
      '<script>window.evil = 1</script>',
      '<img src="data:text/html;base64,PHNjcmlwdD4=" onerror="window.evil=2">',
      '<iframe srcdoc="<script>window.evil=3</script>"></iframe>',
      '<svg onload="window.evil=4"><a xlink:href="javascript:window.evil=5">x</a></svg>',
      '<a href="javascript:window.evil=6">bad link</a>',
      '<a href="https://ok.example/path?q=1#frag">ok link</a>',
      '<img src="data:image/png;base64,iVBORw0KGgo=">',
      '<button formaction="https://evil.example">steal</button>'
    ].join('')
  })
}

describe('renderDocxPreviewHtml', () => {
  it('strips script-executing markup and attributes added by the renderer', async () => {
    injectHostileBody()
    const zip = buildZip([{ name: 'word/document.xml', data: textEncoder.encode('<w:document/>') }])
    renderAsyncMock.mockClear()

    const html = await renderDocxPreviewHtml(asBlob(zip))

    expect(renderAsyncMock).toHaveBeenCalledTimes(1)
    expect(html.bodyHtml).not.toContain('<script')
    expect(html.bodyHtml).not.toContain('<iframe')
    expect(html.bodyHtml).not.toContain('<svg')
    expect(html.bodyHtml).not.toContain('onerror')
    expect(html.bodyHtml).not.toContain('onload')
    expect(html.bodyHtml).not.toContain('javascript:')
    expect(html.bodyHtml).not.toContain('data:text/html')
    expect(html.bodyHtml).not.toContain('formaction')

    // Legitimately image data URLs and plain anchors survive.
    expect(html.bodyHtml).toContain('data:image/png;base64')
    expect(html.bodyHtml).toContain('https://ok.example/path?q=1#frag')
    expect(html.bodyHtml).toContain('rel="noopener noreferrer"')
  })

  it('rejects an archive whose single entry declares more than the per-entry cap', async () => {
    const zip = buildZip([
      { name: 'word/document.xml', data: textEncoder.encode('x'), declaredUncompressed: 33 * 1024 * 1024 }
    ])
    await expect(renderDocxPreviewHtml(asBlob(zip))).rejects.toThrow('entry that is too large')
  })

  it('rejects an archive whose declared total exceeds the archive cap', async () => {
    // 20 entries × 20 MB: each stays under the per-entry cap but the sum breaks the total budget.
    const zip = buildZip(
      Array.from({ length: 20 }, (_, index) => ({
        name: `part-${index}.xml`,
        data: textEncoder.encode('x'),
        declaredUncompressed: 20 * 1024 * 1024
      }))
    )
    await expect(renderDocxPreviewHtml(asBlob(zip))).rejects.toThrow('expands beyond the safe size limit')
  })
})