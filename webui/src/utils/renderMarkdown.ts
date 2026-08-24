import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'

import { isInlineFilePath, normalizeInlineFilePath } from './workspaceFiles'

export type RenderMarkdownOptions = {
  readonly copyCodeLabel?: string
  readonly downloadCodeLabel?: string
  readonly wrapLinesLabel?: string
}

const markdown: MarkdownIt = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
})

const renderHighlightedCode = (code: string, language: string) => {
  const escaped = markdown.utils.escapeHtml(code)
  if (!language || !hljs.getLanguage(language)) return escaped

  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return escaped
  }
}

const escapeAttribute = (value: string) => markdown.utils.escapeHtml(value).replaceAll('"', '&quot;')

/** Compact line icons for the code-block hover toolbar (matches WebUI action icons). */
const toolbarIcon = (name: 'copy' | 'download' | 'wrap') => {
  if (name === 'copy') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
  }
  if (name === 'download') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>'
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h14a4 4 0 0 1 0 8H7"></path><path d="m10 12-3 3 3 3"></path><path d="M3 19h8"></path></svg>'
}

markdown.renderer.rules.code_inline = (tokens, index) => {
  const content = tokens[index]?.content ?? ''
  if (isInlineFilePath(content)) {
    const normalizedPath = normalizeInlineFilePath(content)
    const escapedPath = escapeAttribute(normalizedPath)
    return `<code class="webui-inline-file-path"><button type="button" class="webui-file-link" data-webui-file-path="${escapedPath}">${markdown.utils.escapeHtml(normalizedPath)}</button></code>`
  }
  return `<code>${markdown.utils.escapeHtml(content)}</code>`
}

markdown.renderer.rules.fence = (tokens, index, options) => {
  const token = tokens[index]
  if (!token) return ''

  const language = token.info.trim().split(/\s+/)[0] ?? ''
  const content = token.content
  if ((!language || language === 'text') && isInlineFilePath(content)) {
    const normalizedPath = normalizeInlineFilePath(content)
    const escapedPath = escapeAttribute(normalizedPath)
    return `<pre class="hljs webui-file-path-block"><code class="webui-inline-file-path"><button type="button" class="webui-file-link" data-webui-file-path="${escapedPath}">${markdown.utils.escapeHtml(normalizedPath)}</button></code></pre>`
  }

  const highlighted = options.highlight?.(content, language, '') ?? markdown.utils.escapeHtml(content)
  const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : ''
  const opts = options as RenderMarkdownOptions
  const copyLabel = escapeAttribute(opts.copyCodeLabel ?? 'Copy code')
  const downloadLabel = escapeAttribute(opts.downloadCodeLabel ?? 'Download')
  const wrapLabel = escapeAttribute(opts.wrapLinesLabel ?? 'Wrap lines')
  // Always show a left-side type label (aligns with desktop CodeBlockView header).
  // Bare / text / plaintext fences use TEXT so the left edge is never empty.
  const languageDisplay = !language || language === 'text' || language === 'plaintext' ? 'TEXT' : language.toUpperCase()
  const languageLabel = `<span class="markdown-code-language">${markdown.utils.escapeHtml(languageDisplay)}</span>`
  const langAttr = language ? ` data-webui-code-lang="${escapeAttribute(language)}"` : ''
  const toolbar = `<div class="markdown-code-toolbar" role="toolbar" aria-label="code">
<button type="button" class="markdown-code-tool" data-webui-copy-code title="${copyLabel}" aria-label="${copyLabel}">${toolbarIcon('copy')}</button>
<button type="button" class="markdown-code-tool" data-webui-download-code${langAttr} title="${downloadLabel}" aria-label="${downloadLabel}">${toolbarIcon('download')}</button>
<button type="button" class="markdown-code-tool" data-webui-wrap-code title="${wrapLabel}" aria-label="${wrapLabel}" aria-pressed="false">${toolbarIcon('wrap')}</button>
</div>`
  return `<div class="markdown-code-block">${languageLabel}${toolbar}<pre class="hljs"><code${languageClass}>${highlighted}</code></pre></div>`
}

markdown.set({
  highlight(code: string, language: string): string {
    return renderHighlightedCode(code, language)
  }
})

type MutableMarkdownLabels = {
  copyCodeLabel?: string
  downloadCodeLabel?: string
  wrapLinesLabel?: string
}

/**
 * Preprocess GFM table syntax so markdown-it can render it during streaming.
 * markdown-it requires a complete table: header row + separator row (|---|) + optional body rows.
 * During streaming the table may be the last block in the source (typical) or a complete
 * table followed by later-generated text.  This function finds ALL `|`-prefixed table blocks
 * and fixes each one:
 *  1. Counts columns from the header row.
 *  2. If the separator row is missing or has fewer than 3 dashes per column, replaces it.
 *  3. Pads the last data row with trailing `|` and empty cells so it parses as a table row.
 * Does NOT modify the original source — only the display copy passed to markdown-it.
 */
const preprocessTable = (source: string): string => {
  const lines = source.split('\n')
  const result = [...lines]

  // Scan every line for table blocks (consecutive |-prefixed lines with ≥2 rows).
  let row = 0
  while (row < result.length) {
    const trimmed = result[row]?.trim() ?? ''
    if (!trimmed.startsWith('|')) {
      row++
      continue
    }

    // Found a candidate — walk the block.
    const blockStart = row
    while (row < result.length && (result[row]?.trim() ?? '').startsWith('|')) row++
    const blockEnd = row - 1
    if (blockEnd - blockStart < 1) continue // Need at least header + separator.

    const header = result[blockStart]
    if (!header) continue
    const headerCells = header.split('|').filter((cell) => cell.trim() !== '').length
    if (headerCells < 2) continue

    // Find the separator row (must contain dashes).
    let sepIdx = -1
    for (let i = blockStart + 1; i <= blockEnd; i++) {
      const t = result[i]?.trim() ?? ''
      if (/^\|[\s\-:]+\|?$/.test(t) && /-/.test(t)) {
        sepIdx = i
        break
      }
    }

    const makeSep = (cols: number) => `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`

    // Fix or insert the separator.
    if (sepIdx >= 0) {
      // Only replace if the existing separator has fewer than 3 dashes per column
      // (streaming may produce `| - | - |` which markdown-it does not parse as a table).
      const sepLine = result[sepIdx]?.trim() ?? ''
      const sepCells = sepLine.split('|').filter((c) => c.trim() !== '')
      const needsFix = sepCells.some((cell) => {
        const stripped = cell.replaceAll(/[\s:]/g, '')
        return stripped.length < 3 || !/^-+$/.test(stripped)
      })
      if (needsFix) result[sepIdx] = makeSep(headerCells)
    } else {
      result.splice(blockStart + 1, 0, makeSep(headerCells))
      row++
      // blockEnd shifted by the insert.
    }

    // Fix the last data row (skip if it's the separator itself).
    const lastRow = result[blockEnd]
    if (!lastRow) continue
    const lastTrimmed = lastRow.trim()
    if (!lastTrimmed.startsWith('|')) continue
    if (/^\|[\s\-:]+\|?$/.test(lastTrimmed) && /-/.test(lastTrimmed)) continue

    let fixed = lastTrimmed
    if (!fixed.endsWith('|')) fixed = `${fixed} |`
    const cells = fixed.split('|').filter((c) => c.trim() !== '')
    while (cells.length < headerCells) {
      cells.push('')
      fixed = `${fixed}  |`
    }
    const indent = lastRow.match(/^\s*/)?.[0] ?? ''
    result[blockEnd] = `${indent}${fixed}`
  }

  return result.join('\n')
}

export const renderMarkdown = (source: string, options: RenderMarkdownOptions = {}) => {
  // Preprocess incomplete table syntax for streaming; markdown-it requires complete tables.
  // This is a display-only transformation — the original source is never modified.
  const displaySource = preprocessTable(source)
  // Labels are stashed on the shared markdown-it options object for the fence renderer.
  const markdownOptions = markdown.options as typeof markdown.options & MutableMarkdownLabels
  const previousCopyCodeLabel = markdownOptions.copyCodeLabel
  const previousDownloadCodeLabel = markdownOptions.downloadCodeLabel
  const previousWrapLinesLabel = markdownOptions.wrapLinesLabel
  markdownOptions.copyCodeLabel = options.copyCodeLabel
  markdownOptions.downloadCodeLabel = options.downloadCodeLabel
  markdownOptions.wrapLinesLabel = options.wrapLinesLabel
  try {
    return markdown.render(displaySource)
  } finally {
    markdownOptions.copyCodeLabel = previousCopyCodeLabel
    markdownOptions.downloadCodeLabel = previousDownloadCodeLabel
    markdownOptions.wrapLinesLabel = previousWrapLinesLabel
  }
}

export const renderCode = (source: string, language?: string) => renderHighlightedCode(source, language ?? '')
