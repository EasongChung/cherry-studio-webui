const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_EOCD_MIN_BYTES = 22
const ZIP_CENTRAL_FILE_HEADER_BYTES = 46
const ZIP_LOCAL_FILE_HEADER_BYTES = 30
const ZIP_MAX_COMMENT_BYTES = 0xffff
const ZIP_UINT16_MAX = 0xffff
const ZIP_UINT32_MAX = 0xffffffff
const DOCX_INFLATE_BUDGET_EXCEEDED = 'DOCX_INFLATE_BUDGET_EXCEEDED'

const DOCX_ZIP_MAX_ENTRIES = 4000
const DOCX_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024
const DOCX_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const SAFE_HYPERLINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'blob:'])
const FORBIDDEN_DOCX_TAGS = new Set([
  'base',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'style',
  'svg',
  'template'
])
const EVENT_HANDLER_ATTRIBUTE = /^on[a-z]+$/
const DANGEROUS_ATTRIBUTES = new Set(['formaction', 'ping', 'poster', 'srcdoc', 'srcset'])

export type DocxPreviewHtml = {
  readonly bodyHtml: string
  readonly styleHtml: string
}

const findEndOfCentralDirectory = (view: DataView) => {
  const minOffset = Math.max(0, view.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES)

  for (let offset = view.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === view.byteLength) return offset
  }

  throw new Error('DOCX preview requires a valid ZIP archive')
}

export type DocxZipEntry = {
  readonly method: number
  readonly uncompressedBytes: number
  readonly localHeaderOffset: number
}

const assertDocxZipLimits = (
  bytes: Uint8Array
): { readonly entries: readonly DocxZipEntry[]; readonly centralDirectoryOffset: number } => {
  if (bytes.byteLength < ZIP_EOCD_MIN_BYTES) throw new Error('DOCX preview requires a valid ZIP archive')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(view)
  const diskNumber = view.getUint16(eocdOffset + 4, true)
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true)
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('DOCX preview does not support multi-disk ZIP archives')
  }
  if (
    entryCount === ZIP_UINT16_MAX ||
    centralDirectorySize === ZIP_UINT32_MAX ||
    centralDirectoryOffset === ZIP_UINT32_MAX
  ) {
    throw new Error('DOCX preview does not support ZIP64 archives')
  }
  if (entryCount > DOCX_ZIP_MAX_ENTRIES) {
    throw new Error(`DOCX preview supports ZIP archives with up to ${DOCX_ZIP_MAX_ENTRIES} entries`)
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  if (centralDirectoryEnd > eocdOffset || centralDirectoryEnd < centralDirectoryOffset) {
    throw new Error('DOCX preview requires a valid ZIP central directory')
  }

  const entries: DocxZipEntry[] = []
  let cursor = centralDirectoryOffset
  let totalUncompressedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + ZIP_CENTRAL_FILE_HEADER_BYTES > centralDirectoryEnd ||
      view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE_HEADER_SIGNATURE
    ) {
      throw new Error('DOCX preview requires a valid ZIP central directory')
    }

    const method = view.getUint16(cursor + 10, true)
    const compressedBytes = view.getUint32(cursor + 20, true)
    const uncompressedBytes = view.getUint32(cursor + 24, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraFieldLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const diskStart = view.getUint16(cursor + 34, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    if (
      compressedBytes === ZIP_UINT32_MAX ||
      uncompressedBytes === ZIP_UINT32_MAX ||
      localHeaderOffset === ZIP_UINT32_MAX
    ) {
      throw new Error('DOCX preview does not support ZIP64 archives')
    }
    if (diskStart !== 0) throw new Error('DOCX preview does not support multi-disk ZIP archives')
    if (uncompressedBytes > DOCX_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error('DOCX preview contains an entry that is too large')
    }

    totalUncompressedBytes += uncompressedBytes
    if (totalUncompressedBytes > DOCX_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('DOCX preview expands beyond the safe size limit')
    }

    entries.push({ method, uncompressedBytes, localHeaderOffset })
    cursor += ZIP_CENTRAL_FILE_HEADER_BYTES + fileNameLength + extraFieldLength + commentLength
    if (cursor > centralDirectoryEnd) throw new Error('DOCX preview requires a valid ZIP central directory')
  }

  if (cursor !== centralDirectoryEnd) throw new Error('DOCX preview requires a valid ZIP central directory')
  return { entries, centralDirectoryOffset }
}

/**
 * The central-directory sizes above are attacker-controlled metadata. A crafted DOCX can
 * declare small sizes yet inflate to gigabytes, so the real byte count is enforced here by
 * actually decompressing each entry (streamed, bounded). Method 0 is stored verbatim.
 */
const enforceDocxInflateBudget = async (
  bytes: Uint8Array,
  entries: readonly DocxZipEntry[],
  centralDirectoryOffset: number
) => {
  // Browsers that lack streaming deflate fall back to the metadata-only check above.
  if (typeof DecompressionStream === 'undefined') return

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const inflateAndCount = async (compressed: Uint8Array, budget: number) => {
    let total = 0
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      const reader = stream.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > budget) {
          await reader.cancel().catch(() => {})
          throw new Error(DOCX_INFLATE_BUDGET_EXCEEDED)
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === DOCX_INFLATE_BUDGET_EXCEEDED) {
        throw new Error('DOCX preview expands beyond the safe size limit')
      }
      // The slice also contains the data descriptor / padding, which is not valid deflate
      // raw. Erroring there only means counting stopped; under-counting is lenient, never
      // a false budget breach.
    }
    return total
  }

  const ordered = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset)
  let totalInflated = 0
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]!
    const nextOffset = index + 1 < ordered.length ? ordered[index + 1]!.localHeaderOffset : centralDirectoryOffset

    const localHeaderOffset = entry.localHeaderOffset
    if (
      localHeaderOffset + ZIP_LOCAL_FILE_HEADER_BYTES > bytes.byteLength ||
      view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new Error('DOCX preview requires a valid ZIP local file header')
    }
    const method = view.getUint16(localHeaderOffset + 8, true)
    const nameLength = view.getUint16(localHeaderOffset + 26, true)
    const extraFieldLength = view.getUint16(localHeaderOffset + 28, true)
    const dataStart = localHeaderOffset + ZIP_LOCAL_FILE_HEADER_BYTES + nameLength + extraFieldLength
    if (dataStart > nextOffset) throw new Error('DOCX preview requires a valid ZIP local file header')
    const data = bytes.subarray(dataStart, nextOffset)

    if (method === 0) {
      totalInflated += data.byteLength
    } else if (method === 8) {
      totalInflated += await inflateAndCount(data, DOCX_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES - totalInflated)
    } else {
      totalInflated += entry.uncompressedBytes
    }
    if (totalInflated > DOCX_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('DOCX preview expands beyond the safe size limit')
    }
  }
}

const isSafeUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('data:')) return trimmed.startsWith('data:image/')
  let protocol: string | undefined
  try {
    protocol = new URL(trimmed, 'https://docx-preview.invalid/').protocol
  } catch {
    protocol = undefined
  }
  return Boolean(protocol && SAFE_HYPERLINK_PROTOCOLS.has(protocol))
}

const sanitizeDocxPreview = (container: HTMLElement) => {
  // Remove dangerous element types attribute-level sanitisation cannot secure.
  container.querySelectorAll([...FORBIDDEN_DOCX_TAGS].join(',')).forEach((element) => element.remove())

  for (const element of container.querySelectorAll<HTMLElement>('*')) {
    for (const name of [...element.getAttributeNames()]) {
      const lower = name.toLowerCase()
      if (EVENT_HANDLER_ATTRIBUTE.test(lower) || DANGEROUS_ATTRIBUTES.has(lower)) {
        element.removeAttribute(name)
        continue
      }
      if ((lower === 'href' || lower === 'src' || lower === 'action') && !isSafeUrl(element.getAttribute(name) ?? '')) {
        element.removeAttribute(name)
      }
    }
    if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer')
  }
}

export const renderDocxPreviewHtml = async (blob: Blob): Promise<DocxPreviewHtml> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const { entries, centralDirectoryOffset } = assertDocxZipLimits(bytes)
  await enforceDocxInflateBudget(bytes, entries, centralDirectoryOffset)

  const stagingHost = document.createElement('div')
  const styleContainer = document.createElement('div')
  const bodyContainer = document.createElement('div')
  stagingHost.setAttribute('aria-hidden', 'true')
  stagingHost.style.cssText = 'position:fixed;top:0;left:-99999px;visibility:hidden;pointer-events:none;'
  stagingHost.append(styleContainer, bodyContainer)
  document.body.appendChild(stagingHost)

  try {
    const { renderAsync } = await import('docx-preview')
    await renderAsync(bytes, bodyContainer, styleContainer, {
      breakPages: true,
      className: 'docx-preview',
      ignoreLastRenderedPageBreak: true,
      inWrapper: true,
      renderAltChunks: false,
      renderEndnotes: true,
      renderFooters: true,
      renderFootnotes: true,
      renderHeaders: true,
      useBase64URL: true
    })
    sanitizeDocxPreview(bodyContainer)
    return { bodyHtml: bodyContainer.innerHTML, styleHtml: styleContainer.innerHTML }
  } finally {
    stagingHost.remove()
  }
}
