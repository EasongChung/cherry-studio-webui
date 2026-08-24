import { h } from 'vue'

export type ComposerToolIconName =
  | 'attachment'
  | 'newConversation'
  | 'thinking'
  | 'permission'
  | 'skill'
  | 'knowledge'
  | 'compact'
  | 'fastMode'

export type ActionIconName =
  | 'copy'
  | 'download'
  | 'source'
  | 'wrap'
  | 'send'
  | 'stop'
  | 'menu'
  | 'down'
  | 'resize'
  | 'activity'
  | 'close'
  | 'folder'
  | 'edit'
  | 'sparkles'
  | 'trash'
  | 'more'
  | 'help'
  | 'refresh'
  | 'back'
  | 'search'
  | 'volume'
  | 'quote'
  | 'settings'

export type AgentStatusIconName = 'pending' | 'in_progress' | 'completed' | 'error' | 'subagent' | 'artifact'

/*
 * Standardized SVG icon contract:
 * - Line icons (the default): 24×24 viewBox, `fill: none`, `stroke: currentColor`,
 *   stroke-width 2 with rounded caps/joins — mirrors the desktop line-icon treatment.
 * - Filled icons: opt-in via the `filled` base (e.g. GitHub logo, stop button).
 * - `aria-hidden` is always set; interactive icons must get their own
 *   title/aria-label from the surrounding button.
 */

const iconBaseProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true'
} as const

const smallIconBaseProps = {
  ...iconBaseProps,
  width: 15,
  height: 15
} as const

const filledIconBaseProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': 'true'
} as const

/** Mirrors the compact line-icon treatment used by the desktop ComposerSurface. */
export const renderComposerToolIcon = (name: ComposerToolIconName) => {
  if (name === 'newConversation') {
    return h('svg', iconBaseProps, [
      h('path', { d: 'M13 4H6a2 2 0 0 0-2 2v13l4-3h10a2 2 0 0 0 2-2v-3' }),
      h('path', { d: 'M18 3.5v5' }),
      h('path', { d: 'M15.5 6h5' })
    ])
  }

  if (name === 'attachment') {
    return h(
      'svg',
      iconBaseProps,
      h('path', {
        d: 'm21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5'
      })
    )
  }

  if (name === 'thinking') {
    return h('svg', iconBaseProps, [
      h('path', { d: 'M9 18h6' }),
      h('path', { d: 'M10 22h4' }),
      h('path', { d: 'M8.5 14.5A6.5 6.5 0 1 1 15.5 14c-1.1.8-1.5 1.6-1.5 2.5h-4c0-.9-.4-1.5-1.5-2' })
    ])
  }

  if (name === 'permission') {
    // Shield-check: permission / policy control (aligns with desktop permission mode affordance).
    return h('svg', iconBaseProps, [
      h('path', { d: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z' }),
      h('path', { d: 'm9 12 2 2 4-4' })
    ])
  }

  if (name === 'skill') {
    // Zap: a named skill is used like a capability / prompt aid.
    return h('svg', iconBaseProps, [h('path', { d: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z' })])
  }

  if (name === 'knowledge') {
    // Book-open: knowledge base reference.
    return h('svg', iconBaseProps, [
      h('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }),
      h('path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' })
    ])
  }

  if (name === 'compact') {
    // Compress: arrows converging toward the center (context compaction).
    return h('svg', iconBaseProps, [h('path', { d: 'm6 9 6-6 6 6' }), h('path', { d: 'm6 15 6 6 6-6' })])
  }

  if (name === 'fastMode') {
    // Fast-forward: priority service tier for fast responses.
    return h('svg', iconBaseProps, [h('path', { d: 'm5 5 6 7-6 7V5z' }), h('path', { d: 'm13 5 6 7-6 7V5z' })])
  }

  return h('svg', iconBaseProps, [
    h('path', { d: 'M9 18h6' }),
    h('path', { d: 'M10 22h4' }),
    h('path', { d: 'M8.5 14.5A6.5 6.5 0 1 1 15.5 14c-1.1.8-1.5 1.6-1.5 2.5h-4c0-.9-.4-1.5-1.5-2' })
  ])
}

export const renderLanguageIcon = () =>
  h('svg', iconBaseProps, [
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('path', { d: 'M2 12h20' }),
    h('path', { d: 'M12 2a15.3 15.3 0 0 1 0 20' }),
    h('path', { d: 'M12 2a15.3 15.3 0 0 0 0 20' })
  ])

export const renderThemeIcon = (theme: 'light' | 'dark') =>
  theme === 'light'
    ? h('svg', iconBaseProps, [
        h('circle', { cx: 12, cy: 12, r: 4 }),
        h('path', { d: 'M12 2v2' }),
        h('path', { d: 'M12 20v2' }),
        h('path', { d: 'm4.93 4.93 1.41 1.41' }),
        h('path', { d: 'm17.66 17.66 1.41 1.41' }),
        h('path', { d: 'M2 12h2' }),
        h('path', { d: 'M20 12h2' }),
        h('path', { d: 'm6.34 17.66-1.41 1.41' }),
        h('path', { d: 'm19.07 4.93-1.41 1.41' })
      ])
    : h('svg', iconBaseProps, h('path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }))

export const renderGithubIcon = () =>
  h('svg', filledIconBaseProps, [
    h('path', {
      d: 'M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.21-3.37-1.21-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.15-4.56-5.12 0-1.13.39-2.05 1.03-2.78-.1-.26-.45-1.32.1-2.75 0 0 .84-.28 2.75 1.06A9.3 9.3 0 0 1 12 6.86c.85 0 1.7.12 2.5.35 1.91-1.34 2.75-1.06 2.75-1.06.55 1.43.2 2.49.1 2.75.64.73 1.03 1.65 1.03 2.78 0 3.98-2.34 4.86-4.57 5.11.36.32.68.93.68 1.88 0 1.36-.01 2.45-.01 2.78 0 .27.18.59.69.49A10.23 10.23 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z'
    })
  ])

export const renderActionIcon = (name: ActionIconName, restore = false) => {
  if (name === 'copy')
    return h('svg', iconBaseProps, [
      h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
      h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
    ])
  if (name === 'download')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M12 3v12' }),
      h('path', { d: 'm7 10 5 5 5-5' }),
      h('path', { d: 'M5 21h14' })
    ])
  if (name === 'source')
    return h('svg', iconBaseProps, [h('path', { d: 'm8 18-6-6 6-6' }), h('path', { d: 'm16 6 6 6-6 6' })])
  if (name === 'wrap')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M3 7h14a4 4 0 0 1 0 8H7' }),
      h('path', { d: 'm10 12-3 3 3 3' }),
      h('path', { d: 'M3 19h8' })
    ])
  if (name === 'send') return h('svg', iconBaseProps, [h('path', { d: 'm5 12 7-7 7 7' }), h('path', { d: 'M12 19V5' })])
  if (name === 'stop')
    return h(
      'svg',
      { ...iconBaseProps, fill: 'currentColor', stroke: 'none' },
      h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5 })
    )
  if (name === 'menu')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M4 7h16' }),
      h('path', { d: 'M4 12h16' }),
      h('path', { d: 'M4 17h16' })
    ])
  if (name === 'down') return h('svg', iconBaseProps, [h('path', { d: 'm6 9 6 6 6-6' })])
  if (name === 'resize') {
    return restore
      ? h('svg', iconBaseProps, [
          h('path', { d: 'm14 10 7-7' }),
          h('path', { d: 'M20 10h-6V4' }),
          h('path', { d: 'm3 21 7-7' }),
          h('path', { d: 'M4 14v6h6' })
        ])
      : h('svg', iconBaseProps, [
          h('path', { d: 'M15 3h6v6' }),
          h('path', { d: 'm21 3-7 7' }),
          h('path', { d: 'M9 21H3v-6' }),
          h('path', { d: 'm3 21 7-7' })
        ])
  }
  if (name === 'activity') return h('svg', iconBaseProps, h('path', { d: 'M3 12h4l2.5-7 5 14 2.5-7h4' }))
  if (name === 'close')
    return h('svg', iconBaseProps, [h('path', { d: 'm6 6 12 12' }), h('path', { d: 'm18 6-12 12' })])
  if (name === 'folder')
    return h(
      'svg',
      iconBaseProps,
      h('path', { d: 'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' })
    )
  if (name === 'edit')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M12 20h9' }),
      h('path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' })
    ])
  if (name === 'sparkles')
    return h('svg', iconBaseProps, [
      h('path', { d: 'm12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z' }),
      h('path', { d: 'm5 14 .9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9Z' }),
      h('path', { d: 'm19 14 .7 1.6 1.6.7-1.6.7L19 19l-.7-1.6-1.6-.7 1.6-.7Z' })
    ])
  if (name === 'trash')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M3 6h18' }),
      h('path', { d: 'M8 6V4h8v2' }),
      h('path', { d: 'm19 6-1 14H6L5 6' }),
      h('path', { d: 'M10 11v5' }),
      h('path', { d: 'M14 11v5' })
    ])
  if (name === 'more')
    return h('svg', iconBaseProps, [
      h('circle', { cx: 5, cy: 12, r: 1 }),
      h('circle', { cx: 12, cy: 12, r: 1 }),
      h('circle', { cx: 19, cy: 12, r: 1 })
    ])
  if (name === 'help')
    return h('svg', iconBaseProps, [
      h('circle', { cx: 12, cy: 12, r: 9 }),
      h('path', { d: 'M9.1 9a3 3 0 1 1 5.8 1c-.5 1.1-1.7 1.5-2.2 2.4-.2.3-.2.7-.2 1.1' }),
      h('path', { d: 'M12 17h.01' })
    ])
  if (name === 'refresh')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M20 6v5h-5' }),
      h('path', { d: 'M4 18v-5h5' }),
      h('path', { d: 'M6.1 9A7 7 0 0 1 18 6l2 5' }),
      h('path', { d: 'm4 13 2 5a7 7 0 0 0 11.9-3' })
    ])
  if (name === 'back')
    return h('svg', iconBaseProps, [h('path', { d: 'm15 18-6-6 6-6' }), h('path', { d: 'M9 12h10' })])
  if (name === 'search')
    return h('svg', iconBaseProps, [h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-4-4' })])
  if (name === 'volume')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M11 5 6 9H3v6h3l5 4V5Z' }),
      h('path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }),
      h('path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' })
    ])
  if (name === 'quote')
    return h('svg', iconBaseProps, [
      h('path', { d: 'M10 4c-3.3 0-6 2.3-6 6v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2c0-1.5.9-2.5 2-3z' }),
      h('path', { d: 'M19 4c-3.3 0-6 2.3-6 6v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2c0-1.5.9-2.5 2-3z' })
    ])
  if (name === 'settings')
    return h('svg', iconBaseProps, [
      h('path', {
        d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'
      }),
      h('circle', { cx: '12', cy: '12', r: '3' })
    ])
  return h('svg', iconBaseProps)
}

export const renderAgentStatusIcon = (name: AgentStatusIconName) => {
  if (name === 'completed')
    return h('svg', smallIconBaseProps, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'm8 12 2.5 2.5L16 9' })])
  if (name === 'in_progress')
    return h('svg', smallIconBaseProps, [h('path', { d: 'M21 12a9 9 0 1 1-3-6.7' }), h('path', { d: 'M21 3v6h-6' })])
  if (name === 'error')
    return h('svg', smallIconBaseProps, [
      h('circle', { cx: 12, cy: 12, r: 9 }),
      h('path', { d: 'M12 8v5' }),
      h('path', { d: 'M12 16h.01' })
    ])
  if (name === 'subagent')
    return h('svg', smallIconBaseProps, [
      h('rect', { x: 4, y: 7, width: 16, height: 12, rx: 2 }),
      h('path', { d: 'M12 3v4' }),
      h('path', { d: 'M8 12h.01' }),
      h('path', { d: 'M16 12h.01' }),
      h('path', { d: 'M9 16h6' })
    ])
  if (name === 'artifact')
    return h('svg', smallIconBaseProps, [
      h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
      h('path', { d: 'M14 2v6h6' })
    ])
  return h('svg', smallIconBaseProps, h('circle', { cx: 12, cy: 12, r: 8 }))
}
