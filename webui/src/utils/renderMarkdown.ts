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
 * Preprocess incomplete GFM table syntax so markdown-it can render it during streaming.
 * markdown-it requires complete table syntax (header + separator + optional body rows);
 * this function pads the last incomplete row with trailing `|` and empty cells, and
 * adds a minimal separator if one is missing. Does NOT modify the original source.
 */
const preprocessTable = (source: string): string => {
  const lines = source.split('\n')

  // Find the last line that looks like a table row (starts with |).
  let lastTableRow = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim() ?? ''
    if (trimmed.startsWith('|')) {
      lastTableRow = i
      break
    }
    // Empty lines between table and end are OK; other content breaks the table block.
    if (trimmed !== '') break
  }

  if (lastTableRow < 0) return source

  // Find the first line of this table block (consecutive |-prefixed lines upward).
  let firstTableRow = lastTableRow
  while (firstTableRow > 0) {
    const trimmed = lines[firstTableRow - 1]?.trim() ?? ''
    if (trimmed.startsWith('|')) {
      firstTableRow--
    } else {
      break
    }
  }

  // Count columns from the header row (first table row).
  const header = lines[firstTableRow]
  if (!header) return source
  const headerCells = header.split('|').filter((cell) => cell.trim() !== '').length
  if (headerCells === 0) return source

  // Check if a separator row (|---|) already exists.
  let hasSeparator = false
  for (let i = firstTableRow + 1; i <= lastTableRow; i++) {
    const trimmed = lines[i]?.trim() ?? ''
    if (/^\|[\s\-:]+\|?$/.test(trimmed) && trimmed.includes('-')) {
      hasSeparator = true
      break
    }
  }

  // Clone so we can modify the display copy without touching the original source.
  const result = [...lines]
  const lastLine = result[lastTableRow]
  if (!lastLine) return source

  const trimmed = lastLine.trim()

  // 1. Ensure the last line ends with | (closes the last cell).
  let fixedLine = trimmed
  if (!fixedLine.endsWith('|')) {
    fixedLine = `${fixedLine} |`
  }

  // 2. Count cells in the fixed last line; pad with empty cells if fewer than header.
  const cells = fixedLine.split('|').filter((cell) => cell.trim() !== '')
  while (cells.length < headerCells) {
    cells.push('')
    fixedLine = `${fixedLine}  |`
  }

  // Preserve original indentation (margin/blockquote context).
  const indent = lastLine.match(/^\s*/)?.[0] ?? ''
  result[lastTableRow] = `${indent}${fixedLine}`

  // 3. If the table has only a header (no separator yet), insert a minimal separator
  //    so markdown-it renders the table immediately instead of waiting for the next chunk.
  if (!hasSeparator && firstTableRow === lastTableRow) {
    const sep = `| ${Array.from({ length: headerCells }, () => '---').join(' | ')} |`
    result.splice(firstTableRow + 1, 0, sep)
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
