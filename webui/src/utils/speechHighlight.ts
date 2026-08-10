import { buildSpeechSegments } from './speechSynthesis'

export type SpeechHighlightResult = {
  /** HTML with each speakable sentence wrapped in `.speech-sentence` spans. */
  readonly html: string
  /** Plain speakable text (code blocks excluded) — must feed the speech controller so
   *  the DOM sentence indices match its `segmentIndex`. */
  readonly plainText: string
}

/**
 * Annotate rendered markdown HTML with sentence spans so the read-aloud feature can
 * highlight the current sentence and let the user jump to any sentence by clicking it.
 *
 * Code blocks (`pre` / `code`) are excluded: their content is not spoken, and trying to
 * sentence-split syntax-highlighted HTML would corrupt the markup. The plain text returned
 * here is exactly the concatenation of the annotated text nodes, so it aligns 1:1 with the
 * sentence indices stamped on the DOM spans.
 */
export const annotateSpeechSentences = (html: string): SpeechHighlightResult => {
  if (typeof document === 'undefined') return { html, plainText: '' }

  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content

  // Collect text nodes in document order, skipping anything inside code blocks.
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let currentNode: Node | null
  while ((currentNode = walker.nextNode())) {
    const node = currentNode as Text
    if (node.parentElement?.closest('pre, code')) continue
    textNodes.push(node)
  }
  if (!textNodes.length) return { html, plainText: '' }

  // Rebuild the full text and each node's offset in it.
  const offsets: number[] = []
  let fullText = ''
  for (const node of textNodes) {
    offsets.push(fullText.length)
    fullText += node.textContent ?? ''
  }

  const segments = buildSpeechSegments(fullText)
  if (!segments.length) return { html, plainText: fullText }

  // Locate each segment's character range in fullText (forward scan from the cursor so
  // segments are matched in order). A segment that can't be found (e.g. because trim
  // removed spaces) is left unwrapped rather than corrupting the HTML.
  type Range = { readonly start: number; readonly end: number; readonly index: number }
  const ranges: Range[] = []
  let cursor = 0
  segments.forEach((segment, index) => {
    const found = fullText.indexOf(segment.text, cursor)
    if (found < 0) return
    ranges.push({ start: found, end: found + segment.text.length, index })
    cursor = found + segment.text.length
  })

  // Wrap each range in a span, splitting its text nodes.
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i]!
    const nodeStart = offsets[i]!
    const nodeText = node.textContent ?? ''
    const nodeEnd = nodeStart + nodeText.length

    const overlaps = ranges.filter((range) => range.end > nodeStart && range.start < nodeEnd)
    if (!overlaps.length) continue

    const fragment = document.createDocumentFragment()
    let position = nodeStart
    for (const range of overlaps) {
      const start = Math.max(range.start, nodeStart)
      const end = Math.min(range.end, nodeEnd)
      if (start > position) {
        fragment.append(document.createTextNode(nodeText.slice(position - nodeStart, start - nodeStart)))
      }
      const span = document.createElement('span')
      span.className = 'speech-sentence'
      span.dataset.sentenceIndex = String(range.index)
      span.textContent = nodeText.slice(start - nodeStart, end - nodeStart)
      fragment.append(span)
      position = end
    }
    if (position < nodeEnd) {
      fragment.append(document.createTextNode(nodeText.slice(position - nodeStart)))
    }
    node.replaceWith(fragment)
  }

  return { html: template.innerHTML, plainText: fullText }
}
