export const fallbackLanguage = 'en-US'
export const webUiLogoPath = './icon.png'
export const webUiVersion = '0.1.0'
export const projectRepositoryUrl = 'https://github.com/EasongChung/cherry-studio'
/** First page + each older page size. Keep small so multi-turn chats (≈5 rounds) paginate early. */
export const messagePageSize = 10
/** Session history sidebar: first page + each older page. */
export const conversationPageSize = 50
/** Stop auto-filling older sessions so the sidebar stays responsive. */
export const conversationLoadHardCap = 500
/** Per-workdir group: default conversations shown before its "show more / collapse" footer button appears. */
export const conversationGroupDefaultVisibleCount = 8
export const conversationGroupNoProjectId = 'group:no-project'
export const collapsedWorkdirGroupsStorageKey = 'cherry-webui.collapsed-workdir-groups'
export const maxAttachmentCount = 5
export const maxAttachmentBytes = 10 * 1024 * 1024
export const maxAttachmentsBytes = 25 * 1024 * 1024
export const composerDefaultHeight = 92
export const composerMinHeight = 76
export const composerMaxHeight = 220
export const composerKeyboardStep = 12
// Align with desktop LanguageVarious (src/shared/data/preference/preferenceTypes.ts).
export const webUiLanguages = [
  { id: 'en-US', label: 'English' },
  { id: 'zh-CN', label: '中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'el-GR', label: 'Ελληνικά' },
  { id: 'es-ES', label: 'Español' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'pt-PT', label: 'Português' },
  { id: 'ro-RO', label: 'Română' },
  { id: 'ru-RU', label: 'Русский' },
  { id: 'vi-VN', label: 'Tiếng Việt' }
] as const

export const normalizeLanguage = (language?: string | null) => {
  if (!language) return fallbackLanguage
  const lower = language.toLowerCase()

  return (
    (
      {
        'de-de': 'de-DE',
        'el-gr': 'el-GR',
        'en-us': 'en-US',
        'es-es': 'es-ES',
        'fr-fr': 'fr-FR',
        'ja-jp': 'ja-JP',
        'pt-pt': 'pt-PT',
        'ro-ro': 'ro-RO',
        'ru-ru': 'ru-RU',
        'vi-vn': 'vi-VN',
        'zh-cn': 'zh-CN',
        'zh-tw': 'zh-TW'
      } as Record<string, string>
    )[lower] ?? fallbackLanguage
  )
}
