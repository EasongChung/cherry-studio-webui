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
 * Repair GFM tables in a display-only copy so markdown-it renders them mid-stream.
 * Never mutates the source, and is idempotent: a well-formed table passes through unchanged.
 */
const preprocessTable = (source: string): string => {
  const cellCount = (line: string) => line.split('|').filter((c) => c.trim() !== '').length
  // GFM delimiter row: each column matches `:?-+:?` after optional edge pipes (e.g. `| --- | --- |`).
  const isDelimiter = (line: string) => {
    const t = line.trim()
    if (!t.includes('-')) return false
    return t.replace(/^\|/, '').replace(/\|$/, '').split('|').every((c) => /^\s*:?-+:?\s*$/.test(c))
  }
  const makeSep = (cols: number) => `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  // markdown-it rejects a table whose separator column count differs from the header's and
  // falls back to a paragraph, which would print the raw `| --- |` row. Re-shape the row to
  // the header's column count so a half-typed separator still keeps the table parseable.
  const shapeSep = (line: string, cols: number) => {
    const indent = line.match(/^\s*/)?.[0] ?? ''
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
    const align = (cell: string) => {
      const left = cell.trim().startsWith(':')
      const right = cell.trim().endsWith(':')
      if (left && right) return ':---:'
      if (left) return ':---'
      return right ? '---:' : '---'
    }
    return `${indent}| ${Array.from({ length: cols }, (_, index) => (cells[index] ? align(cells[index]!) : '---')).join(' | ')} |`
  }
  const fixBlock = (block: string[]): string[] => {
    const cols = cellCount(block[0] ?? '')
    if (cols < 2) return block
    const delimAt = block.findIndex((line, idx) => idx > 0 && isDelimiter(line))
    // Inject a separator only when the model has not emitted one yet; a repeated separator
    // would otherwise render as a literal `---` data row, so keep only the first one.
    const rows = (delimAt === -1 ? [block[0] ?? '', makeSep(cols), ...block.slice(1)] : block.slice()).filter(
      (line, idx) => idx <= 1 || !isDelimiter(line)
    )
    const fixed = rows.map((line, idx) => (idx === 1 ? shapeSep(line, cols) : line))
    // Pad a half-typed trailing data row so its last cell parses while streaming.
    const lastIdx = fixed.length - 1
    const last = fixed[lastIdx]
    if (lastIdx > 1 && last && !isDelimiter(last)) {
      let row = last.trim()
      if (!row.endsWith('|')) row = `${row} |`
      for (let n = cellCount(row); n < cols; n++) row = `${row}  |`
      fixed[lastIdx] = `${last.match(/^\s*/)?.[0] ?? ''}${row}`
    }
    return fixed
  }
  const lines = source.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i]?.trim().startsWith('|')) {
      out.push(lines[i] ?? '')
      i++
      continue
    }
    let j = i
    while (j < lines.length && lines[j]?.trim().startsWith('|')) j++
    out.push(...fixBlock(lines.slice(i, j)))
    i = j
  }
  return out.join('\n')
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
