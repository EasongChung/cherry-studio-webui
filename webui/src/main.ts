import './styles/main.scss'

import { createPinia, storeToRefs } from 'pinia'
import {
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type VNode,
  watch
} from 'vue'

import AskUserQuestionPanel from './components/AskUserQuestionPanel.vue'
import AuthPanel, { type RememberVerifyOption } from './components/AuthPanel.vue'
import PermissionRequestPanel from './components/PermissionRequestPanel.vue'
import ToolCallBlock from './components/ToolCallBlock.vue'
import { createWebUiHttpClient, WebUiHttpError } from './service/httpClient'
import { createWebUiSseClient } from './service/sseClient'
import { useWebUiChatStore } from './stores/chatStore'
import type {
  WebUiAgentEntity,
  WebUiAgentSessionEntity,
  WebUiAgentSessionMessageEntity,
  WebUiAgentStatusEvent,
  WebUiAgentWorkspace,
  WebUiAuthStatusResponse,
  WebUiChunkPayload,
  WebUiContentBlock,
  WebUiContextUsage,
  WebUiContextUsageResponse,
  WebUiConversationSummary,
  WebUiCreateSessionBody,
  WebUiCreateSessionWorkspace,
  WebUiCursorResponse,
  WebUiHealthResponse,
  WebUiKnowledgeBase,
  WebUiKnowledgeSearchResponse,
  WebUiKnowledgeSearchResult,
  WebUiMessageSnapshot,
  WebUiMessageTokenStats,
  WebUiModel,
  WebUiModelGroup,
  WebUiModelsResponse,
  WebUiOffsetResponse,
  WebUiPermissionMode,
  WebUiPermissionModeResponse,
  WebUiPreferencesResponse,
  WebUiProcessGroup,
  WebUiProcessItem,
  WebUiRole,
  WebUiSendAttachment,
  WebUiSkill,
  WebUiSlashCommand,
  WebUiSlashCommandsResponse,
  WebUiToolApprovalResponse,
  WebUiToolCallSnapshot,
  WebUiWorkspaceFileEntry,
  WebUiWorkspaceFilesResponse,
  WebUiWorkspaceTextPreview
} from './types/api'
import {
  buildWebUiAgentStatus,
  isWebUiAgentTaskEventData,
  type WebUiAgentArtifact,
  type WebUiAgentStatus,
  type WebUiAgentSubagent,
  type WebUiAgentTask
} from './utils/agentStatus'
import {
  composerDefaultHeight,
  composerKeyboardStep,
  composerMaxHeight,
  composerMinHeight,
  conversationGroupDefaultVisibleCount,
  conversationLoadHardCap,
  conversationPageSize,
  fallbackLanguage,
  maxAttachmentBytes,
  maxAttachmentCount,
  maxAttachmentsBytes,
  messagePageSize,
  normalizeLanguage,
  projectRepositoryUrl,
  webUiLanguages,
  webUiLogoPath,
  webUiVersion
} from './utils/constants'
import {
  appendContentReasoning,
  appendContentText,
  appendProcessReasoning,
  buildConversationGroups,
  conversationGroupKey,
  type ConversationWorkdirGroup,
  formatDuration,
  isAbortError,
  loadCollapsedWorkdirGroups,
  persistCollapsedWorkdirGroups,
  readFileAsDataUrl,
  resolveWorkspaceSeedFromConversation,
  terminalToolStates,
  toConversationSummary,
  toDisplayText,
  toErrorMessage,
  toMessageSnapshot,
  upsertAgentStatusEvent,
  upsertContentTool,
  upsertProcessTool
} from './utils/helpers'
import {
  type ActionIconName,
  type ComposerToolIconName,
  renderActionIcon,
  renderAgentStatusIcon,
  renderComposerToolIcon,
  renderGithubIcon,
  renderLanguageIcon,
  renderThemeIcon
} from './utils/icons'
import { renderCode, renderMarkdown } from './utils/renderMarkdown'
import { annotateSpeechSentences } from './utils/speechHighlight'
import {
  createSpeechSynthesisController,
  DEFAULT_SPEECH_PREFERENCES,
  listSpeechVoices,
  loadSpeechPanelPreferences,
  loadSpeechPreferences,
  saveSpeechPanelPreferences,
  saveSpeechPreferences,
  SPEECH_RATE_MAX,
  type SpeechPanelPreferences,
  type SpeechPreferences,
  type SpeechSynthesisControllerState,
  type SpeechVoiceOption
} from './utils/speechSynthesis'
import { contextCategoryTextKeys, type TextKey, textPacks } from './utils/textPacks'
import { getToolPresentation, getToolTaskDescription } from './utils/toolPresentation'
import {
  buildWorkspaceSearchTree,
  getWorkspaceCodeLanguage,
  getWorkspaceFilePreviewKind,
  getWorkspacePathBasename,
  resolveWorkspaceRelativeArtifactPath,
  resolveWorkspaceRequestPath,
  type WebUiWorkspaceTreeNode
} from './utils/workspaceFiles'

type WebuiStatus = {
  readonly label: string
  readonly value: string
}

type WebUiDraftAttachment = {
  readonly id: string
  readonly file: File
}

type WorkspaceFilePreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly path: string }
  | { readonly status: 'error'; readonly path: string; readonly message: string }
  | { readonly status: 'binary'; readonly path: string; readonly name: string }
  | { readonly status: 'text'; readonly path: string; readonly name: string; readonly content: string }
  | { readonly status: 'image'; readonly path: string; readonly name: string; readonly url: string }
  | { readonly status: 'pdf'; readonly path: string; readonly name: string; readonly url: string }
  | {
      readonly status: 'docx'
      readonly path: string
      readonly name: string
      readonly bodyHtml: string
      readonly styleHtml: string
    }
  | { readonly status: 'pptx'; readonly path: string; readonly name: string; readonly data: ArrayBuffer }

const App = defineComponent({
  name: 'CherryStudioWebuiShell',
  setup() {
    const httpClient = createWebUiHttpClient()
    const sseClient = createWebUiSseClient()
    // Pinia store inside Vue setup; not a React Hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Vue Pinia store used in defineComponent setup
    const chatStore = useWebUiChatStore()
    const { activeRunConversationId, conversations, messages, selectedConversationId } = storeToRefs(chatStore)
    const bridgeState = ref<'checking' | 'connected' | 'offline'>('checking')
    const language = ref(normalizeLanguage(navigator.language))
    const languageOverride = ref(false)
    const languagePickerOpen = ref(false)
    const authRequired = ref(false)
    const isAuthenticated = ref(true)
    const authKeyDraft = ref('')
    const authError = ref('')
    const REMEMBER_VERIFY_SECONDS: Readonly<Record<Exclude<RememberVerifyOption, 'off'>, number>> = {
      '3h': 3 * 60 * 60,
      '1d': 24 * 60 * 60,
      '1w': 7 * 24 * 60 * 60
    }
    const rememberVerify = ref<RememberVerifyOption>('off')
    const showEstimatedTokens = ref(false)
    /** Mirrors desktop `chat.message.thought.auto_collapse` — thinking stays folded while streaming when enabled. */
    const thoughtAutoCollapse = ref(true)
    /** Pinned tool ids for the chat composer toolbar, mirroring the desktop preference. */
    const chatInputPinnedTools = ref<readonly string[]>([])
    /** Pinned tool ids for the agent composer toolbar, mirroring the desktop preference. */
    const agentInputPinnedTools = ref<readonly string[]>([])
    /** Whether the "➕" quick-panel tool picker is open. */
    const quickPanelOpen = ref(false)
    /** Live search text typed inside the quick panel (the desktop panel filters as you type). */
    const quickPanelQuery = ref('')
    /** Keyboard cursor into the filtered launcher list. */
    const quickPanelActiveIndex = ref(0)
    /** Open submenu id, e.g. 'prompts' — mirrors the desktop `isMenu` drill-down. */
    const quickPanelSubmenu = ref<string | null>(null)
    /** Points at the rolling reasoning sliver of the currently-streaming message, for `scrollLeft` updates. */
    const activeThinkingPreview = ref<HTMLElement | null>(null)
    /** Re-renders active process elapsed time once per second, matching desktop live progress. */
    const processElapsedTick = ref(0)
    let processElapsedTimer: number | undefined
    /** Per-message user open/close intent for the process block, overriding auto-open from the preference. */
    const processOpenOverrides = ref<Map<string, boolean>>(new Map())
    const userName = ref('')
    const bridgeDetail = ref('')
    const appVersion = ref('')
    const serviceStartedAt = ref('Pending')
    const sseClientCount = ref('0')
    const conversationLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const conversationLoadMessage = ref('Loading conversations')
    const messageLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const messageLoadMessage = ref('')
    const composerText = ref('')
    const submitError = ref('')
    const pendingSubmittedTurnCount = ref(0)
    const queuedFollowups = ref<{ id: string; text: string }[]>([])
    const agents = ref<readonly WebUiAgentEntity[]>([])
    const modelGroups = ref<readonly WebUiModelGroup[]>([])
    const newConversationOpen = ref(false)
    const newConversationState = ref<'idle' | 'loading' | 'creating' | 'error'>('idle')
    const newConversationError = ref('')
    const selectedAgentId = ref('')
    /** Snapshot at dialog open so switching selection mid-dialog does not change workspace. */
    const pendingWorkspaceSeed = ref<WebUiCreateSessionWorkspace>({ type: 'system' })
    const pendingWorkspaceHint = ref('')
    const collapsedWorkdirGroupIds = ref<Set<string>>(loadCollapsedWorkdirGroups())
    const contextUsage = ref<WebUiContextUsage | null>(null)
    const statusPreviewOpen = ref(false)
    const statusPanelOpen = ref(false)
    const rightPanelTab = ref<'status' | 'files' | 'speech' | 'help'>('status')
    const statusPanelWidth = ref(Number(window.localStorage.getItem('cherry-webui.right-panel-width')) || 380)
    const statusPanelResizing = ref(false)
    const openConversationMenuId = ref<string>()
    const editingConversationId = ref<string>()
    const editingConversationTitle = ref('')
    const conversationActionId = ref<string>()
    const conversationActionState = ref<'idle' | 'saving' | 'generating' | 'deleting' | 'error'>('idle')
    const conversationActionError = ref('')
    const deleteConversationId = ref<string>()
    const speechPreferences = ref<SpeechPreferences>(loadSpeechPreferences())
    const speechPanelPreferences = ref<SpeechPanelPreferences>(loadSpeechPanelPreferences())
    const speechVoices = ref<readonly SpeechVoiceOption[]>([])
    const speechNotice = ref<{ readonly message: string; readonly messageId: string } | null>(null)
    const workspaceDirectoryEntries = ref<Readonly<Record<string, readonly WebUiWorkspaceFileEntry[]>>>({})
    const workspaceExpandedDirectories = ref<ReadonlySet<string>>(new Set())
    const workspaceFileSearch = ref('')
    const workspacePathDraft = ref('')
    const copiedHint = ref<string>()
    const reloadHint = ref<string>()
    const workspaceSearchEntries = ref<readonly WebUiWorkspaceFileEntry[]>([])
    const workspaceFilesLoading = ref(false)
    const workspaceFilesError = ref('')
    const selectedWorkspaceFile = ref('')
    const workspaceFilePreview = ref<WorkspaceFilePreviewState>({ status: 'idle' })
    const workspacePreviewMode = ref<'preview' | 'source'>('preview')
    const workspacePreviewWrap = ref(false)
    const slashCommands = ref<readonly WebUiSlashCommand[]>([])
    const modelPickerOpen = ref(false)
    const reasoningPickerOpen = ref(false)
    const permissionModePickerOpen = ref(false)
    const agentPickerOpen = ref(false)
    const workspacePickerOpen = ref(false)
    /** True on ≤640px viewports — the three header selectors collapse into one grouped menu. */
    const isCompactHeader = ref(false)
    const compactHeaderPickerOpen = ref(false)
    const compactHeaderMql = window.matchMedia('(max-width: 640px)')
    isCompactHeader.value = compactHeaderMql.matches
    const onCompactHeaderChange = (event: MediaQueryListEvent) => {
      isCompactHeader.value = event.matches
      if (!event.matches) compactHeaderPickerOpen.value = false
    }
    compactHeaderMql.addEventListener('change', onCompactHeaderChange)
    const skillPickerOpen = ref(false)
    /** Enabled skills for the currently selected agent (Skill launcher). */
    const skills = ref<readonly WebUiSkill[]>([])
    const skillSearchQuery = ref('')
    const kbPickerOpen = ref(false)
    /** Knowledge bases available for semantic-search reference (baseId picker). */
    const knowledgeBases = ref<readonly WebUiKnowledgeBase[]>([])
    const kbSelectedBaseId = ref('')
    const kbSearchQuery = ref('')
    const kbResults = ref<readonly WebUiKnowledgeSearchResult[]>([])
    const kbSearching = ref(false)
    const workspaces = ref<readonly WebUiAgentWorkspace[]>([])
    const workspacesLoading = ref(false)
    const reasoningEffort = ref(
      (() => {
        try {
          return window.localStorage.getItem('cherry-webui.reasoningEffort') || 'default'
        } catch {
          return 'default'
        }
      })()
    )
    watch(reasoningEffort, (val) => {
      try {
        window.localStorage.setItem('cherry-webui.reasoningEffort', val)
      } catch {
        /* ignore — ephemeral setting */
      }
    })
    /** Fast-mode toggle (openai-priority service tier). Restored from localStorage — an
     *  authoring preference, not session data, so it survives reloads without persistence. */
    const fastModeEnabled = ref(false)
    try {
      fastModeEnabled.value = window.localStorage.getItem('cherry-webui.fastmode') === '1'
    } catch {
      fastModeEnabled.value = false
    }
    const modelUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    const permissionModeUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    const agentUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    const workspaceUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    const pendingModelSwitchTarget = ref<WebUiModel | null>(null)
    const skipModelSwitchConfirm = ref(!!localStorage.getItem('skipModelSwitchConfirm'))
    const multiSelectMode = ref(false)
    const selectedMessageIds = ref<Set<string>>(new Set())
    /** Assistant message whose "more" menu is currently open. */
    const moreMenuMessageId = ref<string | null>(null)
    /** Per-session composer drafts, cached in localStorage and restored on selection. */
    const composerDraftCacheKey = (conversationId: string) => `cherry-webui.composer-draft:${conversationId}`
    /** Input history (↑/↓) across the current session; oldest first. */
    const maxInputHistory = 50
    const inputHistory = ref<string[]>([])
    const inputHistoryIndex = ref(-1) // -1 = live draft; 0 = newest entry; length-1 = oldest
    const inputHistoryDraft = ref('') // saved draft when first entering history navigation
    /** Optimistic submit keys: `${messageId}:${toolCallId}` */
    const approvalSubmittingKeys = ref<ReadonlySet<string>>(new Set())
    const approvalErrorByKey = ref<Readonly<Record<string, string>>>({})
    const mobileSidebarOpen = ref(false)
    const themeMode = ref<'light' | 'dark'>(
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    )
    /** Coarse pointer (touchscreen / mobile): Enter must insert a newline instead of sending. */
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches
    const messageStack = ref<HTMLElement>()
    const composerTextarea = ref<HTMLTextAreaElement>()
    const attachmentInput = ref<HTMLInputElement>()
    const attachments = ref<readonly WebUiDraftAttachment[]>([])
    const olderMessagesCursor = ref<string>()
    const olderMessagesLoading = ref(false)
    const conversationNav = ref<HTMLElement>()
    const olderConversationsCursor = ref<string>()
    const olderConversationsLoading = ref(false)
    /** Workdir groups whose conversations are fully expanded (show-more opened); collapsed groups cap at the default count. */
    const expandedConversationGroupIds = ref(new Set<string>())
    const showScrollToBottom = ref(false)
    const composerHeight = ref(composerDefaultHeight)
    const deleteMessageId = ref<string>()
    const messageDeleteState = ref<'idle' | 'deleting' | 'error'>('idle')
    const messageDeleteError = ref('')
    const speechState = ref<SpeechSynthesisControllerState>({
      isSpeaking: false,
      isPaused: false,
      segmentIndex: 0,
      segmentCount: 0,
      paragraphIndex: 0,
      paragraphCount: 0
    })
    const speechController = createSpeechSynthesisController({
      onStateChange: (state) => {
        speechState.value = state
      },
      getPreferences: () => speechPreferences.value
    })
    /** Plain (markdown-stripped) text of each rendered message, so speech segment
     *  indices align 1:1 with the `.speech-sentence` spans stamped on the DOM. */
    const speechPlainTextCache = new Map<string, string>()
    /**
     * Highlight the currently spoken sentence. The spans live inside the rendered
     * markdown (innerHTML), so class updates must happen on the live DOM after render.
     */
    watch(speechState, (state) => {
      void nextTick(() => {
        document.querySelectorAll('.speech-sentence-active').forEach((element) => {
          element.classList.remove('speech-sentence-active')
        })
        if (!state.isSpeaking || !state.messageId) return
        const container = document.querySelector<HTMLElement>(
          `.markdown-content[data-message-id="${CSS.escape(state.messageId)}"]`
        )
        const sentence = container?.querySelector<HTMLElement>(
          `.speech-sentence[data-sentence-index="${state.segmentIndex}"]`
        )
        sentence?.classList.add('speech-sentence-active')
      })
    })
    const pendingChunks = new Map<string, WebUiChunkPayload[]>()
    const pendingChunkRetries = new Map<string, number>()
    /** Assistant turns that finished streaming — ignore late text/reasoning deltas (prevents duplicate body after long thinking). */
    const sealedStreamMessageIds = new Set<string>()
    let healthTimer: number | undefined
    let contextUsageTimer: number | undefined
    let syncTimer: number | undefined
    let streamRefreshTimer: number | undefined
    let chunkFrame: number | undefined
    let latestMessageRequest = 0
    let statusPreviewOpenTimer: number | undefined
    let statusPreviewCloseTimer: number | undefined
    let workspaceFileSearchTimer: number | undefined
    let workspaceFileRequestGeneration = 0
    let workspacePreviewRequestGeneration = 0
    let workspacePptxPreviewController: AbortController | undefined
    let workspacePptxPreviewDestroy: (() => void) | undefined

    const selectedConversation = computed(() =>
      conversations.value.find((conversation) => conversation.id === selectedConversationId.value)
    )
    const selectedAgentName = computed(() => {
      const agentId = selectedConversation.value?.agentId
      return agents.value.find((agent) => agent.id === agentId)?.name
    })
    const selectedAgent = computed(() => agents.value.find((agent) => agent.id === selectedConversation.value?.agentId))
    /** Whether the selected agent's model advertises fast-mode support (openai-priority). */
    const fastModeSupported = computed(() => {
      const modelId = selectedAgent.value?.model
      if (!modelId) return false
      for (const group of modelGroups.value) {
        const model = group.models.find((candidate) => candidate.id === modelId)
        if (model?.supportsFastMode) return true
      }
      return false
    })
    const toggleFastMode = () => {
      fastModeEnabled.value = !fastModeEnabled.value
      try {
        if (fastModeEnabled.value) {
          window.localStorage.setItem('cherry-webui.fastmode', '1')
        } else {
          window.localStorage.removeItem('cherry-webui.fastmode')
        }
      } catch {
        // localStorage unavailable — the toggle still applies for this page load.
      }
    }
    const selectedPermissionMode = computed<WebUiPermissionMode>(() => {
      const mode = selectedAgent.value?.configuration?.permission_mode
      if (mode === 'plan' || mode === 'acceptEdits' || mode === 'bypassPermissions' || mode === 'default') return mode
      return 'default'
    })
    const permissionModeCards = computed(
      () =>
        [
          {
            mode: 'default' as const,
            titleKey: 'permissionModeDefault' as const,
            descriptionKey: 'permissionModeDefaultDesc' as const
          },
          {
            mode: 'plan' as const,
            titleKey: 'permissionModePlan' as const,
            descriptionKey: 'permissionModePlanDesc' as const
          },
          {
            mode: 'acceptEdits' as const,
            titleKey: 'permissionModeAcceptEdits' as const,
            descriptionKey: 'permissionModeAcceptEditsDesc' as const
          },
          {
            mode: 'bypassPermissions' as const,
            titleKey: 'permissionModeBypass' as const,
            descriptionKey: 'permissionModeBypassDesc' as const
          }
        ] as const
    )
    const permissionModeLabel = computed(() => {
      const card = permissionModeCards.value.find((item) => item.mode === selectedPermissionMode.value)
      return card ? text(card.titleKey) : text('permissionModeDefault')
    })
    const models = computed(() => modelGroups.value.flatMap((group) => group.models))
    const selectedModel = computed(() => models.value.find((model) => model.id === selectedAgent.value?.model))
    /**
     * Strip an id prefix from a model display name.
     *
     * Agent-backed models arrive as `<agentId>:<modelName>` (the agent id is a
     * UUID) and catalog ids as `<providerId>::<modelId>`. Both prefixes are
     * plumbing, not something the user should read in the picker or the message
     * header. Applied at every render site — computing it in one place only
     * (the header trigger) left the dropdown and the message byline unstripped.
     */
    const stripModelNamePrefix = (raw: string): string => {
      // `providerId::modelId` — the double colon is unambiguous, so take the tail.
      const providerPrefixMatch = raw.match(/^[^:]+::(.+)$/)
      if (providerPrefixMatch) return providerPrefixMatch[1] ?? raw
      // `<uuid>:<name>` — match the UUID with and without dashes; only a UUID
      // prefix is stripped so legitimate names containing ':' survive intact.
      const uuidMatch = raw.match(
        /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}):(.+)$/i
      )
      if (uuidMatch) return uuidMatch[1] ?? raw
      return raw
    }
    const modelPickerLabel = computed(() => {
      const raw =
        selectedModel.value?.name ?? selectedAgent.value?.modelName ?? selectedAgent.value?.model ?? text('agent')
      return stripModelNamePrefix(raw)
    })
    /**
     * Whether the currently selected conversation already has any message(s).
     * Mirrors the desktop UX: once a session has messages, its agent and workspace
     * bindings are locked (only the model stays switchable). Empty / brand-new
     * sessions keep all three pickers operable.
     */
    const sessionHasMessages = computed(() => (selectedConversation.value ? messages.value.length > 0 : false))
    const contextUsagePercentage = computed(() => {
      if (!contextUsage.value?.maxTokens) return undefined
      return Math.min(100, Math.round((contextUsage.value.totalTokens / contextUsage.value.maxTokens) * 100))
    })
    const contextUsageLabel = computed(() => {
      if (contextUsagePercentage.value === undefined) return text('noContext')
      return `${text('context')}: ${contextUsagePercentage.value}%`
    })
    const contextUsageTone = computed(() => {
      const percentage = contextUsagePercentage.value
      if (percentage === undefined) return 'empty'
      if (percentage >= 90) return 'critical'
      if (percentage >= 75) return 'warning'
      return 'normal'
    })
    const contextUsageColor = computed(() => {
      const percentage = contextUsagePercentage.value
      if (percentage === undefined) return undefined
      if (percentage <= 50) {
        const warningWeight = percentage * 2
        return `color-mix(in oklch, #22c55e ${100 - warningWeight}%, #f59e0b ${warningWeight}%)`
      }
      const errorWeight = (percentage - 50) * 2
      return `color-mix(in oklch, #f59e0b ${100 - errorWeight}%, #ef4444 ${errorWeight}%)`
    })
    const renderContextOrb = () =>
      h(
        'span',
        {
          class: [
            'context-orb',
            contextUsagePercentage.value === undefined ? 'context-orb-empty' : `context-orb-${contextUsageTone.value}`
          ],
          style: {
            '--context-usage':
              contextUsagePercentage.value === undefined
                ? '0deg'
                : `${Math.round((contextUsagePercentage.value / 100) * 360)}deg`
          },
          'aria-hidden': 'true'
        },
        contextUsagePercentage.value === undefined ? '--' : String(contextUsagePercentage.value)
      )
    const agentStatus = computed(() => buildWebUiAgentStatus(messages.value))
    const incompleteTaskCount = computed(
      () => agentStatus.value.tasks.filter((task) => task.status !== 'completed').length
    )
    const contextUsageCategories = computed(() =>
      (contextUsage.value?.categories ?? []).filter((category) => category.tokens > 0).slice(0, 4)
    )
    const workspaceSearchTree = computed(() => buildWorkspaceSearchTree(workspaceSearchEntries.value))
    const workspaceRootKey = computed(() => workspacePathDraft.value.trim())
    const workspaceRootPath = computed(
      () => workspacePathDraft.value.trim() || selectedConversation.value?.workspacePath || ''
    )
    const workspaceRootLabel = computed(
      () => workspacePathDraft.value.trim() || selectedConversation.value?.workspaceLabel || text('files')
    )
    const themeToggleLabel = computed(() => (themeMode.value === 'dark' ? text('switchToLight') : text('switchToDark')))
    const reasoningOptions = computed(() => selectedModel.value?.reasoningOptions ?? [])
    const reasoningConfigurable = computed(() => reasoningOptions.value.length > 0)
    const reasoningLabel = computed(() => {
      const labels: Record<string, TextKey> = {
        default: 'reasoningDefault',
        none: 'reasoningNone',
        minimal: 'reasoningMinimal',
        low: 'reasoningLow',
        medium: 'reasoningMedium',
        high: 'reasoningHigh',
        xhigh: 'reasoningXhigh',
        auto: 'reasoningAuto'
      }
      return text(labels[reasoningEffort.value] ?? 'reasoningDefault')
    })
    const slashCommandSuggestions = computed(() => {
      const input = composerText.value.trimStart()
      if (modelPickerOpen.value || skillPickerOpen.value || kbPickerOpen.value || !input.startsWith('/')) return []

      const query = input.slice(1).toLowerCase()
      const matches = slashCommands.value.filter((command) => command.name.toLowerCase().startsWith(query))
      // Compaction is a runtime slash command (Claude Code built-in). Surface a built-in
      // candidate when the host catalog does not (e.g. it is filtered by host-managed
      // slash commands) so the entry stays reachable for the user.
      if (!matches.some((command) => command.name.toLowerCase() === 'compact') && 'compact'.startsWith(query)) {
        matches.push({ name: 'compact', description: text('compactDescription') })
      }
      return matches.slice(0, 6)
    })
    const skillsFiltered = computed(() => {
      const query = skillSearchQuery.value.trim().toLowerCase()
      if (!query) return skills.value
      return skills.value.filter(
        (skill) => skill.name.toLowerCase().includes(query) || (skill.description ?? '').toLowerCase().includes(query)
      )
    })
    const kbSelectedBaseName = computed(
      () => knowledgeBases.value.find((base) => base.id === kbSelectedBaseId.value)?.name ?? ''
    )
    const showEmptyConversationGreeting = computed(() =>
      Boolean(selectedConversation.value && messages.value.length === 0 && messageLoadState.value === 'ready')
    )
    const messageAuthorName = (role: WebUiRole) => {
      if (role === 'user') return userName.value || role
      if (role === 'assistant') return selectedAgentName.value || role
      return role
    }
    /**
     * Model name for the assistant message header: always the turn snapshot
     * (`message.modelId` at reply time). Do not fall back to the live agent model,
     * so switching models later does not rewrite historical headers.
     */
    const messageModelLabel = (message: WebUiMessageSnapshot) => {
      if (message.role !== 'assistant') return ''
      if (!message.modelId) return ''
      const fromCatalog = models.value.find((model) => model.id === message.modelId)
      if (fromCatalog?.name) return stripModelNamePrefix(fromCatalog.name)
      const bareId = message.modelId.includes('::')
        ? (message.modelId.split('::').pop() ?? message.modelId)
        : message.modelId
      return stripModelNamePrefix(bareId)
    }
    const messageHeaderLabel = (message: WebUiMessageSnapshot) => {
      const author = messageAuthorName(message.role)
      if (message.role !== 'assistant') return author
      const modelLabel = messageModelLabel(message)
      return modelLabel ? `${author} · ${modelLabel}` : author
    }
    const conversationAgentName = (agentId: string | null) =>
      agents.value.find((agent) => agent.id === agentId)?.name ?? text('agent')
    const deletingConversation = computed(() =>
      conversations.value.find((conversation) => conversation.id === deleteConversationId.value)
    )

    const text = (key: TextKey) => {
      const pack = textPacks[language.value as keyof typeof textPacks] ?? textPacks[fallbackLanguage]
      return pack[key] ?? textPacks[fallbackLanguage][key]
    }

    /**
     * Render message markdown and annotate speakable sentences. The cache entry lets
     * read-aloud start from the exact same plain text that the sentence spans were
     * built from, so `segmentIndex` matches the `data-sentence-index` on the DOM.
     */
    const renderSpeechMarkdown = (
      content: string,
      messageId: string,
      options: Parameters<typeof renderMarkdown>[1]
    ): string => {
      const html = renderMarkdown(content, options)
      const annotated = annotateSpeechSentences(html)
      speechPlainTextCache.set(messageId, annotated.plainText)
      return annotated.html
    }

    const conversationGroups = computed(() => buildConversationGroups(conversations.value, text('noProject')))

    const localizedErrorMessage = (error: unknown) =>
      isAbortError(error) ? text('requestAborted') : toErrorMessage(error)
    const showCopiedHint = (label: string) => {
      // Toast payload is the visible microcopy (usually text('copied')).
      // Keep a unique stamp so rapid successive copies still reset the timer.
      const stamp = `${label}::${Date.now()}`
      copiedHint.value = stamp
      window.setTimeout(() => {
        if (copiedHint.value === stamp) copiedHint.value = undefined
      }, 1600)
    }
    const renderCopiedToast = () => {
      const raw = copiedHint.value
      if (!raw) return undefined
      const base = raw.includes('::') ? raw.slice(0, raw.lastIndexOf('::')) : raw
      const label = base === text('downloadSource') ? text('downloadSource') : text('copied')
      return h(
        'div',
        {
          class: 'webui-copy-toast',
          role: 'status',
          'aria-live': 'polite'
        },
        label
      )
    }
    const showReloadHint = () => {
      const stamp = `reload::${Date.now()}`
      reloadHint.value = stamp
      window.setTimeout(() => {
        if (reloadHint.value === stamp) reloadHint.value = undefined
      }, 1600)
    }
    const renderReloadToast = () => {
      if (!reloadHint.value) return undefined
      return h(
        'div',
        {
          class: 'webui-copy-toast',
          role: 'status',
          'aria-live': 'polite'
        },
        text('conversationRefreshed')
      )
    }
    const markdownToPlainText = (value: string) => {
      const container = document.createElement('div')
      container.innerHTML = renderMarkdown(value, {
        copyCodeLabel: text('copyCode'),
        downloadCodeLabel: text('downloadSource'),
        wrapLinesLabel: text('wrapLines')
      })
      return (container.textContent ?? value).trim()
    }
    const isReadingMessage = (messageId: string) =>
      Boolean(speechState.value.messageId === messageId && speechState.value.isSpeaking)
    const hasActiveSpeechSession = computed(() => Boolean(speechState.value.messageId) && speechState.value.isSpeaking)
    const isSpeechPaused = computed(() => speechState.value.isPaused)
    const isSpeechPlaying = computed(() => speechState.value.isSpeaking && !speechState.value.isPaused)
    const refreshSpeechVoices = () => {
      speechVoices.value = listSpeechVoices()
      speechController.refreshSupport()
    }
    const persistSpeechPreferences = (next: SpeechPreferences) => {
      speechPreferences.value = next
      saveSpeechPreferences(next)
      speechController.applyLivePreferences(next)
    }
    const updateSpeechPreference = <K extends keyof SpeechPreferences>(key: K, value: SpeechPreferences[K]) => {
      persistSpeechPreferences({ ...speechPreferences.value, [key]: value })
    }
    const resetSpeechPreferences = () => {
      persistSpeechPreferences({ ...DEFAULT_SPEECH_PREFERENCES })
    }
    const persistSpeechPanelPreferences = (next: SpeechPanelPreferences) => {
      speechPanelPreferences.value = next
      saveSpeechPanelPreferences(next)
    }
    const updateSpeechAutoOpenPanel = (enabled: boolean) => {
      persistSpeechPanelPreferences({ ...speechPanelPreferences.value, autoOpenPanel: enabled })
    }
    const showSpeechNotice = (message: string, messageId?: string) => {
      const targetMessageId = messageId ?? ''
      speechNotice.value = { message, messageId: targetMessageId }
      window.setTimeout(() => {
        const current = speechNotice.value
        if (current?.message === message && current.messageId === targetMessageId) speechNotice.value = null
      }, 2600)
    }
    const openSpeechPanel = () => {
      clearStatusPreviewTimers()
      statusPreviewOpen.value = false
      statusPanelOpen.value = true
      rightPanelTab.value = 'speech'
      refreshSpeechVoices()
    }
    const previewSpeechSettings = () => {
      if (!speechController.refreshSupport()) {
        showSpeechNotice(text('speechUnavailable'))
        return
      }
      speechController.preview(text('speechPreviewSample'), language.value)
    }
    const handleSpeechPlayPause = () => {
      if (!speechController.refreshSupport()) {
        showSpeechNotice(text('speechUnavailable'))
        return
      }
      if (isSpeechPlaying.value) {
        speechController.pause()
        return
      }
      if (isSpeechPaused.value || hasActiveSpeechSession.value) {
        speechController.play()
      }
    }
    const handleSpeechStop = () => {
      speechController.stop()
    }
    const handleSpeechPreviousSentence = () => {
      speechController.previousSentence()
    }
    const handleSpeechNextSentence = () => {
      speechController.nextSentence()
    }
    const handleSpeechPreviousParagraph = () => {
      speechController.previousParagraph()
    }
    const handleSpeechNextParagraph = () => {
      speechController.nextParagraph()
    }
    const renderSpeechTransportButton = (
      label: string,
      onClick: () => void,
      options?: { readonly disabled?: boolean; readonly active?: boolean; readonly caution?: boolean }
    ) =>
      h(
        'button',
        {
          class: [
            'speech-transport-button',
            {
              'speech-transport-button-active': Boolean(options?.active),
              'speech-transport-button-caution': Boolean(options?.caution)
            }
          ],
          type: 'button',
          disabled: Boolean(options?.disabled) || !speechController.isSupported,
          title: label,
          'aria-label': label,
          onClick
        },
        label
      )
    const renderSpeechPanel = () => {
      const state = speechState.value
      const sessionActive = hasActiveSpeechSession.value
      const progressLabel = sessionActive
        ? `${text('speechProgress')}: ${state.segmentIndex + 1}/${Math.max(state.segmentCount, 1)} · ${state.paragraphIndex + 1}/${Math.max(state.paragraphCount, 1)}`
        : text('speechNoActiveReading')

      return h('div', { class: 'speech-settings-panel' }, [
        !speechController.isSupported
          ? h('p', { class: 'speech-settings-warning', role: 'status' }, text('speechUnavailable'))
          : undefined,
        h('section', { class: 'speech-transport-panel', 'aria-label': text('speechTransport') }, [
          h('div', { class: 'speech-transport-header' }, [
            h('h3', { class: 'speech-transport-title' }, text('speechTransport')),
            h('p', { class: 'speech-transport-progress', role: 'status' }, progressLabel)
          ]),
          h('div', { class: 'speech-transport-grid' }, [
            renderSpeechTransportButton(
              isSpeechPlaying.value ? text('speechPause') : text('speechPlay'),
              handleSpeechPlayPause,
              {
                disabled: !sessionActive && !isSpeechPaused.value,
                active: isSpeechPlaying.value
              }
            ),
            renderSpeechTransportButton(text('speechStop'), handleSpeechStop, {
              disabled: !sessionActive,
              caution: true
            }),
            renderSpeechTransportButton(text('speechPreviousSentence'), handleSpeechPreviousSentence, {
              disabled: !sessionActive
            }),
            renderSpeechTransportButton(text('speechNextSentence'), handleSpeechNextSentence, {
              disabled: !sessionActive
            }),
            renderSpeechTransportButton(text('speechPreviousParagraph'), handleSpeechPreviousParagraph, {
              disabled: !sessionActive
            }),
            renderSpeechTransportButton(text('speechNextParagraph'), handleSpeechNextParagraph, {
              disabled: !sessionActive
            })
          ]),
          !sessionActive ? h('p', { class: 'speech-transport-hint' }, text('speechIdleHint')) : undefined
        ]),
        h('label', { class: 'speech-setting-row speech-auto-open-row' }, [
          h('div', { class: 'speech-auto-open-copy' }, [
            h('span', text('speechAutoOpenPanel')),
            h('span', { class: 'speech-auto-open-hint' }, text('speechAutoOpenPanelHint'))
          ]),
          h('input', {
            class: 'speech-auto-open-switch',
            type: 'checkbox',
            checked: speechPanelPreferences.value.autoOpenPanel,
            'aria-label': text('speechAutoOpenPanel'),
            onChange: (event: Event) => {
              updateSpeechAutoOpenPanel((event.target as HTMLInputElement).checked)
            }
          })
        ]),
        h('label', { class: 'speech-setting-row' }, [
          h('span', text('speechRate')),
          h('div', { class: 'speech-setting-control' }, [
            h('input', {
              type: 'range',
              min: '0.5',
              max: String(SPEECH_RATE_MAX),
              step: '0.1',
              value: String(speechPreferences.value.rate),
              disabled: !speechController.isSupported,
              'aria-label': text('speechRate'),
              onInput: (event: Event) => {
                updateSpeechPreference('rate', Number((event.target as HTMLInputElement).value))
              }
            }),
            h('span', { class: 'speech-setting-value' }, speechPreferences.value.rate.toFixed(1))
          ])
        ]),
        h('label', { class: 'speech-setting-row' }, [
          h('span', text('speechPitch')),
          h('div', { class: 'speech-setting-control' }, [
            h('input', {
              type: 'range',
              min: '0',
              max: '2',
              step: '0.1',
              value: String(speechPreferences.value.pitch),
              disabled: !speechController.isSupported,
              'aria-label': text('speechPitch'),
              onInput: (event: Event) => {
                updateSpeechPreference('pitch', Number((event.target as HTMLInputElement).value))
              }
            }),
            h('span', { class: 'speech-setting-value' }, speechPreferences.value.pitch.toFixed(1))
          ])
        ]),
        h('label', { class: 'speech-setting-row' }, [
          h('span', text('speechVolume')),
          h('div', { class: 'speech-setting-control' }, [
            h('input', {
              type: 'range',
              min: '0',
              max: '1',
              step: '0.05',
              value: String(speechPreferences.value.volume),
              disabled: !speechController.isSupported,
              'aria-label': text('speechVolume'),
              onInput: (event: Event) => {
                updateSpeechPreference('volume', Number((event.target as HTMLInputElement).value))
              }
            }),
            h('span', { class: 'speech-setting-value' }, `${Math.round(speechPreferences.value.volume * 100)}%`)
          ])
        ]),
        h('label', { class: 'speech-setting-row speech-setting-row-select' }, [
          h('span', text('speechVoice')),
          h(
            'select',
            {
              class: 'speech-voice-select',
              value: speechPreferences.value.voiceURI,
              disabled: !speechController.isSupported,
              'aria-label': text('speechVoice'),
              onChange: (event: Event) => {
                updateSpeechPreference('voiceURI', (event.target as HTMLSelectElement).value)
              },
              onFocus: refreshSpeechVoices
            },
            [
              h('option', { value: '' }, text('speechVoiceDefault')),
              ...speechVoices.value.map((voice) =>
                h('option', { value: voice.voiceURI, key: voice.voiceURI }, `${voice.name} (${voice.lang})`)
              )
            ]
          )
        ]),
        h('div', { class: 'speech-settings-actions' }, [
          h(
            'button',
            {
              class: 'speech-settings-button',
              type: 'button',
              disabled: !speechController.isSupported,
              onClick: previewSpeechSettings
            },
            text('speechPreview')
          ),
          h(
            'button',
            {
              class: ['speech-settings-button', 'speech-settings-button-secondary'],
              type: 'button',
              onClick: resetSpeechPreferences
            },
            text('speechReset')
          )
        ])
      ])
    }
    const localizedSseErrorMessage = (message?: string) =>
      message && isAbortError(message) ? text('requestAborted') : message || text('disconnected')
    const isAbortSseMessage = (message?: string) => Boolean(message && isAbortError(message))

    const hasProcessDetails = (message: WebUiMessageSnapshot) =>
      Boolean(message.processGroups?.length || message.reasoning || message.toolCalls?.length)
    const getProcessSummary = (message: WebUiMessageSnapshot) => {
      processElapsedTick.value
      // Completed: mirror the desktop "已处理 N 个工具 · 用时 X" single-row summary.
      if (message.status !== 'pending') {
        const toolCount = message.toolCalls?.length ?? 0
        const action = toolCount
          ? text('toolCallsProcessed').replace('{{count}}', String(toolCount))
          : text('reasoning')
        const duration = message.processingTimeMs ? formatDuration(message.processingTimeMs) : undefined
        return duration ? `${action} · ${duration}` : action
      }
      // Match desktop live progress: keep one stable process label and append elapsed time while streaming.
      if (message.status === 'pending') {
        const startedAt = Date.parse(message.createdAt)
        const elapsed = Number.isFinite(startedAt) ? formatDuration(Math.max(0, Date.now() - startedAt)) : undefined
        return elapsed ? `${text('processDetails')} · ${elapsed}` : text('processDetails')
      }
      return text('reasoning')
    }
    const approvalKey = (messageId: string, toolId: string) => `${messageId}:${toolId}`
    const isApprovalSubmitting = (messageId: string, toolId: string) =>
      approvalSubmittingKeys.value.has(approvalKey(messageId, toolId))
    const setApprovalSubmitting = (messageId: string, toolId: string, submitting: boolean) => {
      const key = approvalKey(messageId, toolId)
      const next = new Set(approvalSubmittingKeys.value)
      if (submitting) next.add(key)
      else next.delete(key)
      approvalSubmittingKeys.value = next
    }
    const setApprovalError = (messageId: string, toolId: string, error: string) => {
      const key = approvalKey(messageId, toolId)
      if (!error) {
        if (!(key in approvalErrorByKey.value)) return
        approvalErrorByKey.value = Object.fromEntries(
          Object.entries(approvalErrorByKey.value).filter(([entryKey]) => entryKey !== key)
        )
        return
      }
      approvalErrorByKey.value = { ...approvalErrorByKey.value, [key]: error }
    }
    const respondToolApproval = async (
      tool: WebUiToolCallSnapshot,
      message: WebUiMessageSnapshot,
      approved: boolean,
      updatedInput?: Record<string, unknown>
    ) => {
      const conversationId = selectedConversationId.value
      const approvalId = tool.approvalId
      if (!conversationId || !approvalId || isApprovalSubmitting(message.id, tool.id)) return

      setApprovalSubmitting(message.id, tool.id, true)
      setApprovalError(message.id, tool.id, '')
      try {
        await httpClient.postJson<WebUiToolApprovalResponse>(
          `/api/agent-sessions/${encodeURIComponent(conversationId)}/tool-approvals`,
          {
            approvalId,
            approved,
            ...(approved ? {} : { reason: text('denyTool') }),
            ...(updatedInput !== undefined ? { updatedInput } : {})
          }
        )
      } catch (error) {
        setApprovalSubmitting(message.id, tool.id, false)
        setApprovalError(message.id, tool.id, localizedErrorMessage(error) || text('approvalFailed'))
      }
    }

    /** Latest tool awaiting approval — drives the composer overlay (desktop-style). */
    type PendingToolApproval = {
      readonly message: WebUiMessageSnapshot
      readonly tool: WebUiToolCallSnapshot
    }
    const pendingToolApproval = computed((): PendingToolApproval | null => {
      let latest: PendingToolApproval | null = null
      for (const message of messages.value) {
        for (const tool of message.toolCalls ?? []) {
          if (tool.state !== 'approval-requested') continue
          latest = { message, tool }
        }
      }
      return latest
    })

    const truncateApprovalPreview = (value: string | undefined, max = 1200) => {
      if (!value) return ''
      const trimmed = value.trim()
      if (trimmed.length <= max) return trimmed
      return `${trimmed.slice(0, max)}…`
    }

    /** Desktop interactive tools that surface a structured question UI (AskUserQuestion). */
    const isAskUserQuestionToolName = (name: string) => name === 'AskUserQuestion' || name === 'builtin_AskUserQuestion'

    /** Whether the current conversation has an active stream (either tracked or detected from pending messages). */
    const isCurrentlyStreaming = computed(() => {
      if (activeRunConversationId.value === selectedConversationId.value) return true
      if (!selectedConversationId.value) return false
      // Fallback: check if the last assistant message in the selected conversation is still pending.
      for (const message of messages.value) {
        if (message.conversationId === selectedConversationId.value && message.status === 'pending') return true
      }
      return false
    })

    const renderPermissionRequestOverlay = () => {
      const pending = pendingToolApproval.value
      if (!pending) return undefined
      if (isAskUserQuestionToolName(pending.tool.name)) {
        return h(AskUserQuestionPanel, {
          tool: pending.tool,
          message: pending.message,
          text,
          submitting: isApprovalSubmitting(pending.message.id, pending.tool.id),
          approvalError: approvalErrorByKey.value[approvalKey(pending.message.id, pending.tool.id)],
          onSubmit: (updatedInput) => void respondToolApproval(pending.tool, pending.message, true, updatedInput),
          onDeny: () => void respondToolApproval(pending.tool, pending.message, false)
        })
      }
      return h(PermissionRequestPanel, {
        tool: pending.tool,
        message: pending.message,
        text,
        preview: truncateApprovalPreview(pending.tool.input),
        submitting: isApprovalSubmitting(pending.message.id, pending.tool.id),
        approvalError: approvalErrorByKey.value[approvalKey(pending.message.id, pending.tool.id)],
        onApprove: () => void respondToolApproval(pending.tool, pending.message, true),
        onDeny: () => void respondToolApproval(pending.tool, pending.message, false)
      })
    }

    /**
     * Timeline marker for a compacted stretch of conversation — mirrors the
     * desktop CompactionAnchorBlock. `compacting` shows a live status row;
     * `done` settles into a dashed rule annotated with the tokens reclaimed
     * (or a plain dot when the path could not measure both ends).
     */
    const renderCompactionAnchors = (message: WebUiMessageSnapshot) => {
      const anchors = message.compactionAnchors ?? []
      if (!anchors.length) return undefined
      return anchors.map((anchor) => {
        const saved =
          anchor.preTokens !== undefined && anchor.postTokens !== undefined && anchor.preTokens > anchor.postTokens
            ? anchor.preTokens - anchor.postTokens
            : undefined
        const compacting = anchor.status === 'compacting'
        const label = compacting
          ? text('compactionCompacting')
          : saved === undefined
            ? text('compactionCompacted')
            : text('compactionCompactedSaved').replace('{count}', formatCompactNumber(saved))
        // In-loop folds happen between tool calls of one continuous loop, so they
        // render as a compact inline row instead of a full-width rule.
        if (anchor.phase === 'in-loop') {
          return h(
            'div',
            {
              class: 'compaction-anchor compaction-anchor-inline',
              key: anchor.id,
              ...(compacting ? { role: 'status', 'aria-live': 'polite' } : {})
            },
            [
              h('span', { class: 'compaction-anchor-dot', 'aria-hidden': 'true' }),
              h('span', { class: 'compaction-anchor-label' }, label)
            ]
          )
        }
        return h(
          'div',
          {
            class: ['compaction-anchor', { 'compaction-anchor-pending': compacting }],
            key: anchor.id,
            ...(compacting ? { role: 'status', 'aria-live': 'polite' } : { role: 'separator' })
          },
          [
            h('span', { class: 'compaction-anchor-rule', 'aria-hidden': 'true' }),
            h('span', { class: 'compaction-anchor-label' }, label),
            h('span', { class: 'compaction-anchor-rule', 'aria-hidden': 'true' })
          ]
        )
      })
    }

    const renderProcessDetails = (message: WebUiMessageSnapshot) => {
      if (!hasProcessDetails(message)) return undefined

      const isThinking = message.status === 'pending'
      const processGroups: readonly WebUiProcessGroup[] = message.processGroups?.length
        ? message.processGroups
        : message.reasoning || message.toolCalls?.length
          ? [
              {
                id: `${message.id}:process:fallback`,
                items: [
                  ...(message.reasoning
                    ? [
                        {
                          kind: 'reasoning' as const,
                          id: `${message.id}:reasoning:fallback`,
                          content: message.reasoning
                        }
                      ]
                    : []),
                  ...(message.toolCalls ?? []).map((tool) => ({ kind: 'tool' as const, id: tool.id, tool }))
                ]
              }
            ]
          : []
      const previewText = isThinking ? (message.reasoning ?? '').replace(/\s+/g, ' ').trim() : ''
      const showRollingPreview = isThinking && previewText.length > 0
      const openOverride = processOpenOverrides.value.get(message.id)
      // Mirror the desktop: while the turn is live the whole process (thinking + tools)
      // is expanded and streams in order; once completed it collapses into a single row
      // summary. The thoughtAutoCollapse preference governs the reasoning block inside,
      // not the process container itself (user clicks win via override).
      const isProcessOpen = openOverride !== undefined ? openOverride : isThinking

      return h(
        'details',
        {
          class: ['process-block', { 'process-block-pending': isThinking }],
          ...(isProcessOpen ? { open: true } : {})
        },
        [
          h(
            'summary',
            {
              onClick: (event: MouseEvent) => {
                const details = (event.currentTarget as HTMLElement).closest('details')
                const next = new Map(processOpenOverrides.value)
                next.set(message.id, !(details?.open ?? false))
                processOpenOverrides.value = next
              }
            },
            [
              h('span', { class: 'process-state-indicator', 'aria-hidden': 'true' }),
              h('span', { class: 'process-summary' }, getProcessSummary(message)),
              showRollingPreview
                ? h(
                    'span',
                    { class: 'process-preview-sliver', 'aria-hidden': 'true', ref: activeThinkingPreview },
                    previewText
                  )
                : undefined
            ]
          ),
          h(
            'div',
            { class: 'process-history' },
            processGroups.length
              ? processGroups.map((group) => {
                  // Merge consecutive tool items into one collapsible group, mirroring the
                  // desktop ToolBlockGroup. Reasoning items stay separate so narration reads
                  // in order with the tools it justifies.
                  const rows: Array<
                    | { kind: 'reasoning'; item: Extract<WebUiProcessItem, { kind: 'reasoning' }> }
                    | { kind: 'tool-group'; tools: readonly WebUiToolCallSnapshot[] }
                  > = []
                  let toolRun: WebUiToolCallSnapshot[] = []
                  const flushToolRun = () => {
                    if (!toolRun.length) return
                    rows.push({ kind: 'tool-group', tools: toolRun })
                    toolRun = []
                  }
                  for (const item of group.items) {
                    if (item.kind === 'reasoning') {
                      flushToolRun()
                      rows.push({ kind: 'reasoning', item })
                    } else {
                      toolRun.push(item.tool)
                    }
                  }
                  flushToolRun()

                  return h(
                    'div',
                    { class: 'process-history-group', key: group.id },
                    rows.map((row) => {
                      if (row.kind === 'reasoning') {
                        // Desktop ThinkingBlock defaults folded; the auto-collapse preference
                        // forces it closed while streaming so the summary sliver rolls instead.
                        const reasoningOpen = !thoughtAutoCollapse.value && row.item.isStreaming
                        return h('details', { class: 'reasoning-block', key: row.item.id, open: reasoningOpen }, [
                          h('summary', [
                            h('span', { class: 'process-item-indicator', 'aria-hidden': 'true' }),
                            h('span', text('reasoning'))
                          ]),
                          h('div', {
                            class: 'markdown-content process-reasoning-content',
                            onClick: handleMarkdownContentClick,
                            innerHTML: renderMarkdown(row.item.content, {
                              copyCodeLabel: text('copyCode'),
                              downloadCodeLabel: text('downloadSource'),
                              wrapLinesLabel: text('wrapLines')
                            })
                          })
                        ])
                      }

                      const renderTool = (tool: WebUiToolCallSnapshot) =>
                        h(ToolCallBlock, {
                          key: tool.id,
                          tool,
                          message,
                          text,
                          submitting: isApprovalSubmitting(message.id, tool.id),
                          approvalError: approvalErrorByKey.value[approvalKey(message.id, tool.id)],
                          onApprove: () => void respondToolApproval(tool, message, true),
                          onDeny: () => void respondToolApproval(tool, message, false)
                        })

                      // Single tool stays a bare card; multiple consecutive tools collapse.
                      if (row.tools.length === 1) return renderTool(row.tools[0]!)
                      const anyActive = row.tools.some(
                        (tool) => message.status === 'pending' && !terminalToolStates.has(tool.state)
                      )
                      const latest = row.tools[row.tools.length - 1]!
                      const presentation = getToolPresentation(latest.name)
                      const latestTask = getToolTaskDescription(latest.name, latest.input)
                      return h(
                        'details',
                        {
                          class: ['tool-call-group', { 'tool-call-group-pending': anyActive }],
                          key: `group:${row.tools.map((tool) => tool.id).join('|')}`,
                          ...(anyActive ? { open: true } : {})
                        },
                        [
                          h('summary', [
                            h('span', { class: 'tool-call-group-indicator', 'aria-hidden': 'true' }),
                            h('span', { class: 'tool-call-icon', 'aria-hidden': 'true' }, presentation.icon),
                            h(
                              'span',
                              { class: 'tool-call-group-summary' },
                              latestTask
                                ? `${text(presentation.labelKey)} · ${latestTask}`
                                : `${text(presentation.labelKey)} · ${row.tools.length}`
                            )
                          ]),
                          h('div', { class: 'tool-call-group-body' }, row.tools.map(renderTool))
                        ]
                      )
                    })
                  )
                })
              : message.reasoning
                ? [
                    h('details', { class: 'reasoning-block', open: isThinking }, [
                      h('summary', text('reasoning')),
                      h('div', {
                        class: 'markdown-content process-reasoning-content',
                        onClick: handleMarkdownContentClick,
                        innerHTML: renderMarkdown(message.reasoning, {
                          copyCodeLabel: text('copyCode'),
                          downloadCodeLabel: text('downloadSource'),
                          wrapLinesLabel: text('wrapLines')
                        })
                      })
                    ])
                  ]
                : []
          )
        ]
      )
    }

    const renderReasoningBlock = (id: string, content: string, isStreaming: boolean | undefined, open?: boolean) => {
      // Desktop ThinkingBlock defaults folded; the auto-collapse preference forces it
      // closed while streaming so the summary sliver rolls instead. Completed blocks
      // stay foldable by the user.
      const reasoningOpen = open ?? (!thoughtAutoCollapse.value && isStreaming)
      return h('details', { class: 'reasoning-block', key: id, open: reasoningOpen }, [
        h('summary', [
          h('span', { class: 'process-item-indicator', 'aria-hidden': 'true' }),
          h('span', text('reasoning'))
        ]),
        h('div', {
          class: 'markdown-content process-reasoning-content',
          onClick: handleMarkdownContentClick,
          innerHTML: renderMarkdown(content, {
            copyCodeLabel: text('copyCode'),
            downloadCodeLabel: text('downloadSource'),
            wrapLinesLabel: text('wrapLines')
          })
        })
      ])
    }

    const renderToolCard = (tool: WebUiToolCallSnapshot, message: WebUiMessageSnapshot) =>
      h(ToolCallBlock, {
        key: tool.id,
        tool,
        message,
        text,
        submitting: isApprovalSubmitting(message.id, tool.id),
        approvalError: approvalErrorByKey.value[approvalKey(message.id, tool.id)],
        onApprove: () => void respondToolApproval(tool, message, true),
        onDeny: () => void respondToolApproval(tool, message, false)
      })

    /** A single inline content block, rendered in its original stream order. */
    const renderContentBlock = (block: WebUiContentBlock, message: WebUiMessageSnapshot) => {
      if (block.kind === 'reasoning') {
        // Render intermediate reasoning as inline process narration (matching the desktop),
        // not as a collapsible "已深度思考" thinking block.
        return h(
          'div',
          { class: 'process-narration markdown-content', key: block.id, onClick: handleMarkdownContentClick },
          {
            innerHTML: renderMarkdown(block.content, {
              copyCodeLabel: text('copyCode'),
              downloadCodeLabel: text('downloadSource'),
              wrapLinesLabel: text('wrapLines')
            })
          }
        )
      }
      if (block.kind === 'tool') {
        return renderToolCard(block.tool, message)
      }
      // Non-final prose rendered inline as process narration (lightweight).
      return h(
        'div',
        { class: 'process-narration markdown-content', key: block.id, onClick: handleMarkdownContentClick },
        {
          innerHTML: renderMarkdown(block.content, {
            copyCodeLabel: text('copyCode'),
            downloadCodeLabel: text('downloadSource'),
            wrapLinesLabel: text('wrapLines')
          })
        }
      )
    }

    /**
     * Render an assistant turn's body from its ordered content blocks, mirroring the
     * desktop layout: while the turn is live, reasoning, prose and tool cards render
     * IN LINE in streaming order; once completed, all non-final blocks collapse into a
     * single-row process container and only the final prose tail stays outside it.
     */
    const renderMessageContentBlocks = (message: WebUiMessageSnapshot) => {
      const blocks = message.contentBlocks
      if (!blocks?.length) return undefined

      const isThinking = message.status === 'pending'
      // The last text block is the final answer; everything before it is process history.
      let lastTextIndex = -1
      for (let index = blocks.length - 1; index >= 0; index--) {
        if (blocks[index]?.kind === 'text') {
          lastTextIndex = index
          break
        }
      }
      const processBlocks = lastTextIndex >= 0 ? blocks.slice(0, lastTextIndex) : blocks
      const lastBlock = lastTextIndex >= 0 ? blocks[lastTextIndex] : undefined
      const finalText = lastBlock?.kind === 'text' ? lastBlock : undefined

      // Live turn: render process blocks inline in order, then the streaming answer tail.
      if (isThinking) {
        const nodes = [...processBlocks.map((block) => renderContentBlock(block, message))]
        if (finalText) {
          nodes.push(
            h('div', {
              class: 'markdown-content',
              'data-message-id': message.id,
              ...(speechState.value.messageId === message.id && speechState.value.isSpeaking
                ? { 'data-reading': '' }
                : {}),
              onClick: handleMarkdownContentClick,
              innerHTML: renderSpeechMarkdown(finalText.content, message.id, {
                copyCodeLabel: text('copyCode'),
                downloadCodeLabel: text('downloadSource'),
                wrapLinesLabel: text('wrapLines')
              })
            })
          )
        }
        return nodes
      }

      // Completed turn: fold process blocks into a single-row container; answer stays out.
      const openOverride = processOpenOverrides.value.get(message.id)
      const isProcessOpen = openOverride !== undefined ? openOverride : false
      const nodes: VNode[] = []
      if (processBlocks.length) {
        nodes.push(
          h(
            'details',
            {
              class: 'process-block',
              ...(isProcessOpen ? { open: true } : {})
            },
            [
              h(
                'summary',
                {
                  onClick: (event: MouseEvent) => {
                    const details = (event.currentTarget as HTMLElement).closest('details')
                    const next = new Map(processOpenOverrides.value)
                    next.set(message.id, !(details?.open ?? false))
                    processOpenOverrides.value = next
                  }
                },
                [
                  h('span', { class: 'process-state-indicator', 'aria-hidden': 'true' }),
                  h('span', { class: 'process-summary' }, getProcessSummary(message))
                ]
              ),
              h(
                'div',
                { class: 'process-history' },
                processBlocks.map((block) => renderContentBlock(block, message))
              )
            ]
          )
        )
      }
      if (finalText) {
        nodes.push(
          h('div', {
            class: 'markdown-content',
            'data-message-id': message.id,
            ...(speechState.value.messageId === message.id && speechState.value.isSpeaking
              ? { 'data-reading': '' }
              : {}),
            onClick: handleMarkdownContentClick,
            innerHTML: renderSpeechMarkdown(finalText.content, message.id, {
              copyCodeLabel: text('copyCode'),
              downloadCodeLabel: text('downloadSource'),
              wrapLinesLabel: text('wrapLines')
            })
          })
        )
      }
      return nodes
    }

    const workspaceApiPath = (route: 'files' | 'file' | 'preview', requestPath = '', search = '') => {
      const conversationId = selectedConversationId.value
      if (!conversationId) return undefined
      const query = new URLSearchParams()
      if (requestPath) query.set('path', requestPath)
      if (search) query.set('search', search)
      const suffix = query.size ? `?${query.toString()}` : ''
      return `/api/agent-sessions/${encodeURIComponent(conversationId)}/workspace/${route}${suffix}`
    }

    const getWorkspaceFileErrorMessage = (error: unknown) => {
      if (error instanceof WebUiHttpError) {
        if (error.payload?.code === 'WEBUI_WORKSPACE_AUTH_REQUIRED') return text('fileAuthRequired')
        if (error.payload?.code === 'WEBUI_WORKSPACE_FILE_TOO_LARGE') return text('fileTooLarge')
        if (error.payload?.code === 'WEBUI_WORKSPACE_PREVIEW_UNSUPPORTED') return text('binaryUnavailable')
        if (error.payload?.code?.startsWith('WEBUI_WORKSPACE_')) return text('fileUnavailable')
      }
      return localizedErrorMessage(error)
    }

    const releaseWorkspacePptxPreview = () => {
      workspacePptxPreviewController?.abort()
      workspacePptxPreviewDestroy?.()
      workspacePptxPreviewController = undefined
      workspacePptxPreviewDestroy = undefined
    }

    const releaseWorkspacePreview = () => {
      releaseWorkspacePptxPreview()
      if (workspaceFilePreview.value.status === 'image' || workspaceFilePreview.value.status === 'pdf') {
        URL.revokeObjectURL(workspaceFilePreview.value.url)
      }
    }

    const mountWorkspacePptxPreview = async (container: HTMLElement, data: ArrayBuffer, requestPath: string) => {
      releaseWorkspacePptxPreview()
      const controller = new AbortController()
      workspacePptxPreviewController = controller
      try {
        const { mountPptxPreview } = await import('./utils/pptxPreview')
        const handle = await mountPptxPreview(container, data, controller.signal)
        if (
          controller.signal.aborted ||
          workspacePptxPreviewController !== controller ||
          workspaceFilePreview.value.status !== 'pptx' ||
          workspaceFilePreview.value.path !== requestPath
        ) {
          handle.destroy()
          return
        }
        workspacePptxPreviewDestroy = handle.destroy
      } catch (error) {
        if (controller.signal.aborted || workspacePptxPreviewController !== controller) return
        if (workspaceFilePreview.value.status === 'pptx' && workspaceFilePreview.value.path === requestPath) {
          workspaceFilePreview.value = { status: 'error', path: requestPath, message: text('fileUnavailable') }
        }
      }
    }

    const resetWorkspaceFiles = () => {
      workspaceFileRequestGeneration += 1
      workspacePreviewRequestGeneration += 1
      if (workspaceFileSearchTimer !== undefined) window.clearTimeout(workspaceFileSearchTimer)
      workspaceFileSearchTimer = undefined
      releaseWorkspacePreview()
      workspaceDirectoryEntries.value = {}
      workspaceExpandedDirectories.value = new Set()
      workspaceFileSearch.value = ''
      workspacePathDraft.value = ''
      workspaceSearchEntries.value = []
      workspaceFilesLoading.value = false
      workspaceFilesError.value = ''
      selectedWorkspaceFile.value = ''
      workspaceFilePreview.value = { status: 'idle' }
    }

    const loadWorkspaceDirectory = async (directory = workspaceRootKey.value, force = false) => {
      if (!selectedConversationId.value) {
        workspaceFilesError.value = text('filesEmpty')
        return
      }
      if (!authRequired.value) {
        workspaceFilesError.value = text('fileAuthRequired')
        return
      }
      if (!force && workspaceDirectoryEntries.value[directory]) return
      const apiPath = workspaceApiPath('files', directory)
      if (!apiPath) return

      const generation = workspaceFileRequestGeneration
      const conversationId = selectedConversationId.value
      workspaceFilesLoading.value = true
      workspaceFilesError.value = ''
      try {
        const response = await httpClient.getJson<WebUiWorkspaceFilesResponse>(apiPath)
        if (generation !== workspaceFileRequestGeneration || conversationId !== selectedConversationId.value) return
        workspaceDirectoryEntries.value = { ...workspaceDirectoryEntries.value, [directory]: response.entries }
      } catch (error) {
        if (generation !== workspaceFileRequestGeneration || conversationId !== selectedConversationId.value) return
        workspaceFilesError.value = getWorkspaceFileErrorMessage(error)
      } finally {
        if (generation === workspaceFileRequestGeneration) workspaceFilesLoading.value = false
      }
    }

    const loadWorkspaceSearch = async (query: string) => {
      const apiPath = workspaceApiPath('files', workspaceRootKey.value, query)
      if (!apiPath || !selectedConversationId.value || !authRequired.value) {
        workspaceSearchEntries.value = []
        if (!authRequired.value) workspaceFilesError.value = text('fileAuthRequired')
        return
      }

      const generation = workspaceFileRequestGeneration
      const conversationId = selectedConversationId.value
      workspaceFilesLoading.value = true
      workspaceFilesError.value = ''
      try {
        const response = await httpClient.getJson<WebUiWorkspaceFilesResponse>(apiPath)
        if (
          generation !== workspaceFileRequestGeneration ||
          conversationId !== selectedConversationId.value ||
          query !== workspaceFileSearch.value.trim()
        ) {
          return
        }
        workspaceSearchEntries.value = response.entries
      } catch (error) {
        if (generation !== workspaceFileRequestGeneration || conversationId !== selectedConversationId.value) return
        workspaceFilesError.value = getWorkspaceFileErrorMessage(error)
      } finally {
        if (generation === workspaceFileRequestGeneration) workspaceFilesLoading.value = false
      }
    }

    const refreshWorkspaceFiles = () => {
      const search = workspaceFileSearch.value.trim()
      workspaceDirectoryEntries.value = {}
      workspaceSearchEntries.value = []
      if (search) void loadWorkspaceSearch(search)
      else void loadWorkspaceDirectory(workspaceRootKey.value, true)
    }

    const openWorkspaceRootPath = () => {
      workspaceFileSearch.value = ''
      workspaceExpandedDirectories.value = new Set()
      closeWorkspaceFilePreview()
      workspaceDirectoryEntries.value = {}
      void loadWorkspaceDirectory(workspaceRootKey.value, true)
    }

    const toggleWorkspaceDirectory = (directory: string) => {
      const next = new Set(workspaceExpandedDirectories.value)
      if (next.has(directory)) {
        next.delete(directory)
      } else {
        next.add(directory)
        void loadWorkspaceDirectory(directory)
      }
      workspaceExpandedDirectories.value = next
    }

    const closeWorkspaceFilePreview = () => {
      workspacePreviewRequestGeneration += 1
      releaseWorkspacePreview()
      selectedWorkspaceFile.value = ''
      workspaceFilePreview.value = { status: 'idle' }
    }

    const openWorkspaceFile = async (filePath: string) => {
      const requestPath = resolveWorkspaceRequestPath(selectedConversation.value?.workspacePath, filePath)
      if (!requestPath) return
      const previewKind = getWorkspaceFilePreviewKind(requestPath)
      const isBinaryPreview =
        previewKind === 'image' || previewKind === 'pdf' || previewKind === 'docx' || previewKind === 'pptx'
      const apiPath = workspaceApiPath(isBinaryPreview ? 'preview' : 'file', requestPath)
      if (!apiPath) return

      releaseWorkspacePreview()
      workspacePreviewMode.value = 'preview'
      workspacePreviewWrap.value = false
      selectedWorkspaceFile.value = requestPath
      workspaceFilePreview.value = { status: 'loading', path: requestPath }
      const requestGeneration = ++workspacePreviewRequestGeneration
      const conversationId = selectedConversationId.value
      try {
        if (isBinaryPreview) {
          const blob = await httpClient.getBlob(apiPath)
          if (
            requestGeneration !== workspacePreviewRequestGeneration ||
            conversationId !== selectedConversationId.value
          )
            return
          if (previewKind === 'docx') {
            const { renderDocxPreviewHtml } = await import('./utils/docxPreview')
            const rendered = await renderDocxPreviewHtml(blob)
            if (
              requestGeneration !== workspacePreviewRequestGeneration ||
              conversationId !== selectedConversationId.value
            )
              return
            workspaceFilePreview.value = {
              status: 'docx',
              path: requestPath,
              name: getWorkspacePathBasename(requestPath),
              ...rendered
            }
            return
          }
          if (previewKind === 'pptx') {
            const data = await blob.arrayBuffer()
            if (
              requestGeneration !== workspacePreviewRequestGeneration ||
              conversationId !== selectedConversationId.value
            )
              return
            workspaceFilePreview.value = {
              status: 'pptx',
              path: requestPath,
              name: getWorkspacePathBasename(requestPath),
              data
            }
            return
          }
          workspaceFilePreview.value = {
            status: previewKind,
            path: requestPath,
            name: getWorkspacePathBasename(requestPath),
            url: URL.createObjectURL(blob)
          }
          return
        }

        const response = await httpClient.getJson<WebUiWorkspaceTextPreview>(apiPath)
        if (requestGeneration !== workspacePreviewRequestGeneration || conversationId !== selectedConversationId.value)
          return
        workspaceFilePreview.value =
          response.kind === 'text'
            ? { status: 'text', path: requestPath, name: response.name, content: response.content ?? '' }
            : { status: 'binary', path: requestPath, name: response.name }
      } catch (error) {
        if (requestGeneration !== workspacePreviewRequestGeneration || conversationId !== selectedConversationId.value)
          return
        workspaceFilePreview.value = {
          status: 'error',
          path: requestPath,
          message: getWorkspaceFileErrorMessage(error)
        }
      }
    }

    const handleWorkspacePreviewCopy = async (value: string, label: string) => {
      await copyText(value)
      showCopiedHint(label)
    }

    const downloadWorkspacePreviewSource = (preview: Extract<WorkspaceFilePreviewState, { status: 'text' }>) => {
      const blob = new Blob([preview.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = preview.name || getWorkspacePathBasename(preview.path)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      showCopiedHint(text('downloadSource'))
    }

    const codeLanguageExtension = (language: string | undefined) => {
      const key = (language ?? '').trim().toLowerCase()
      const map: Record<string, string> = {
        js: 'js',
        javascript: 'js',
        jsx: 'jsx',
        ts: 'ts',
        typescript: 'ts',
        tsx: 'tsx',
        py: 'py',
        python: 'py',
        rb: 'rb',
        ruby: 'rb',
        go: 'go',
        rs: 'rs',
        rust: 'rs',
        java: 'java',
        kt: 'kt',
        kotlin: 'kt',
        c: 'c',
        cpp: 'cpp',
        'c++': 'cpp',
        cs: 'cs',
        csharp: 'cs',
        php: 'php',
        sh: 'sh',
        bash: 'sh',
        zsh: 'sh',
        shell: 'sh',
        powershell: 'ps1',
        ps1: 'ps1',
        sql: 'sql',
        json: 'json',
        yaml: 'yml',
        yml: 'yml',
        toml: 'toml',
        xml: 'xml',
        html: 'html',
        css: 'css',
        scss: 'scss',
        less: 'less',
        md: 'md',
        markdown: 'md',
        vue: 'vue',
        svelte: 'svelte',
        dockerfile: 'Dockerfile',
        docker: 'Dockerfile',
        text: 'txt',
        plaintext: 'txt',
        txt: 'txt'
      }
      return map[key] ?? (key && /^[a-z0-9.+-]+$/i.test(key) ? key : 'txt')
    }

    const downloadTextAsFile = (value: string, filename: string) => {
      const blob = new Blob([value], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    }

    const openMessageAttachment = async (attachment: {
      readonly name: string
      readonly mediaType?: string
      readonly fileEntryId?: string
    }) => {
      const fileEntryId = attachment.fileEntryId?.trim()
      if (!fileEntryId) {
        submitError.value = text('attachmentPreviewUnavailable')
        return
      }
      try {
        const blob = await httpClient.getBlob(`/api/files/${encodeURIComponent(fileEntryId)}`)
        const mediaType = attachment.mediaType || blob.type || 'application/octet-stream'
        const isTextLike =
          mediaType.startsWith('text/') ||
          mediaType.includes('json') ||
          mediaType.includes('xml') ||
          mediaType.includes('javascript') ||
          mediaType.includes('markdown') ||
          /\.(txt|md|json|csv|log|xml|yml|yaml|ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|css|html|sh|bat|ps1)$/i.test(
            attachment.name
          )
        const isImage = mediaType.startsWith('image/')
        const isPdf = mediaType === 'application/pdf' || attachment.name.toLowerCase().endsWith('.pdf')

        if (isTextLike) {
          const content = await blob.text()
          clearStatusPreviewTimers()
          statusPreviewOpen.value = false
          statusPanelOpen.value = true
          rightPanelTab.value = 'files'
          releaseWorkspacePreview()
          workspacePreviewMode.value = 'preview'
          workspacePreviewWrap.value = true
          selectedWorkspaceFile.value = attachment.name
          workspaceFilePreview.value = {
            status: 'text',
            path: attachment.name,
            name: attachment.name,
            content
          }
          return
        }

        const objectUrl = URL.createObjectURL(blob)
        if (isImage || isPdf) {
          clearStatusPreviewTimers()
          statusPreviewOpen.value = false
          statusPanelOpen.value = true
          rightPanelTab.value = 'files'
          releaseWorkspacePreview()
          workspacePreviewMode.value = 'preview'
          selectedWorkspaceFile.value = attachment.name
          workspaceFilePreview.value = {
            status: isImage ? 'image' : 'pdf',
            path: attachment.name,
            name: attachment.name,
            url: objectUrl
          }
          return
        }

        const link = document.createElement('a')
        link.href = objectUrl
        link.download = attachment.name || 'attachment'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
        showCopiedHint(text('downloadSource'))
      } catch (error) {
        submitError.value =
          error instanceof WebUiHttpError
            ? error.payload?.code === 'WEBUI_FILE_AUTH_REQUIRED'
              ? text('fileAuthRequired')
              : error.payload?.message || text('attachmentPreviewOpenFailed')
            : text('attachmentPreviewOpenFailed')
      }
    }

    const handleMarkdownContentClick = (event: MouseEvent) => {
      // Clicking a sentence span starts read-aloud from that sentence.
      const sentence =
        event.target instanceof Element ? event.target.closest<HTMLElement>('[data-sentence-index]') : null
      if (sentence) {
        const messageElement = sentence.closest<HTMLElement>('[data-message-id]')
        const messageId = messageElement?.dataset.messageId
        const index = Number(sentence.dataset.sentenceIndex)
        if (messageId && Number.isInteger(index) && index >= 0) {
          // Sentence-click only rewinds the read-aloud session once the user has
          // started reading via the message footer button — a bare click does nothing.
          if (speechState.value.messageId === messageId && speechState.value.isSpeaking) {
            event.preventDefault()
            speechController.jumpToSegment(index)
          }
        }
        return
      }

      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              '[data-webui-copy-code], [data-webui-download-code], [data-webui-wrap-code], [data-webui-file-path]'
            )
          : null
      if (!target) return

      if (target.dataset.webuiCopyCode !== undefined) {
        const code = target.closest('.markdown-code-block')?.querySelector('pre code')?.textContent ?? ''
        if (code) void copyText(code).then(() => showCopiedHint(text('copied')))
        return
      }

      if (target.dataset.webuiDownloadCode !== undefined) {
        const block = target.closest('.markdown-code-block')
        const code = block?.querySelector('pre code')?.textContent ?? ''
        if (!code) return
        const language = target.dataset.webuiCodeLang ?? ''
        const ext = codeLanguageExtension(language)
        const filename = ext === 'Dockerfile' ? 'Dockerfile' : `code.${ext}`
        downloadTextAsFile(code, filename)
        showCopiedHint(text('downloadSource'))
        return
      }

      if (target.dataset.webuiWrapCode !== undefined) {
        const block = target.closest('.markdown-code-block')
        if (!block) return
        const next = !block.classList.contains('markdown-code-block-wrap')
        block.classList.toggle('markdown-code-block-wrap', next)
        target.setAttribute('aria-pressed', next ? 'true' : 'false')
        target.classList.toggle('markdown-code-tool-active', next)
        target.setAttribute('title', next ? text('unwrapLines') : text('wrapLines'))
        target.setAttribute('aria-label', next ? text('unwrapLines') : text('wrapLines'))
        return
      }

      const filePath = target.dataset.webuiFilePath
      if (filePath) {
        event.preventDefault()
        openFilesPanel()
        void openWorkspaceFile(filePath)
      }
    }

    const openFilesPanel = () => {
      clearStatusPreviewTimers()
      statusPreviewOpen.value = false
      statusPanelOpen.value = true
      rightPanelTab.value = 'files'
      if (!workspaceDirectoryEntries.value[workspaceRootKey.value]) void loadWorkspaceDirectory(workspaceRootKey.value)
    }

    const openWorkspaceArtifact = (artifact: WebUiAgentArtifact) => {
      const relativePath = resolveWorkspaceRelativeArtifactPath(
        selectedConversation.value?.workspacePath,
        artifact.path
      )
      if (!relativePath) return
      openFilesPanel()
      void openWorkspaceFile(relativePath)
    }

    const getAgentStatusLabel = (status: WebUiAgentTask['status'] | WebUiAgentSubagent['status']) => {
      if (status === 'in_progress' || status === 'running') return text('statusRunning')
      if (status === 'completed' || status === 'done') return text('statusCompleted')
      if (status === 'error') return text('statusError')
      return text('statusPending')
    }

    const getContextCategoryLabel = (name: string) => {
      const key = contextCategoryTextKeys[name]
      return key ? text(key) : name
    }

    const renderContextUsageSummary = (compact = false) => {
      const percentage = contextUsagePercentage.value
      const usage = contextUsage.value
      return h(
        'section',
        { class: ['agent-status-section', 'context-usage-summary', { 'agent-status-section-compact': compact }] },
        [
          h('h3', text('contextUsage')),
          usage && percentage !== undefined
            ? h('div', { class: 'context-usage-content' }, [
                h(
                  'div',
                  { class: 'context-progress-track' },
                  h('span', {
                    class: ['context-progress-value', `context-progress-value-${contextUsageTone.value}`],
                    style: { width: `${percentage}%`, background: contextUsageColor.value }
                  })
                ),
                h('div', { class: 'context-usage-meta' }, [
                  h(
                    'span',
                    `${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} (${percentage}%)`
                  ),
                  h('span', { title: stripModelNamePrefix(usage.model) }, stripModelNamePrefix(usage.model))
                ]),
                contextUsageCategories.value.length
                  ? h(
                      'dl',
                      { class: 'context-category-list' },
                      contextUsageCategories.value.flatMap((category) => [
                        h('dt', { key: `${category.name}-name` }, getContextCategoryLabel(category.name)),
                        h('dd', { key: `${category.name}-tokens` }, category.tokens.toLocaleString())
                      ])
                    )
                  : undefined
              ])
            : h('p', { class: 'agent-status-empty' }, text('noContext'))
        ]
      )
    }

    const renderTaskList = (tasks: readonly WebUiAgentTask[], compact = false) =>
      tasks.length
        ? h('section', { class: ['agent-status-section', { 'agent-status-section-compact': compact }] }, [
            h('div', { class: 'agent-status-section-heading' }, [
              h('h3', text('tasks')),
              h(
                'span',
                { class: 'agent-status-count-badge' },
                `${agentStatus.value.completedTaskCount}/${agentStatus.value.totalTaskCount}`
              )
            ]),
            h(
              'ul',
              { class: 'agent-status-list' },
              tasks.map((task) =>
                h('li', { class: ['agent-status-item', `agent-status-item-${task.status}`], key: task.id }, [
                  h(
                    'span',
                    { class: ['agent-status-item-icon', `agent-status-item-icon-${task.status}`] },
                    renderAgentStatusIcon(task.status)
                  ),
                  h('span', { class: 'agent-status-item-copy' }, [
                    h(
                      'span',
                      {
                        class: [
                          'agent-status-item-title',
                          { 'agent-status-item-title-completed': task.status === 'completed' }
                        ]
                      },
                      task.status === 'in_progress' && task.activeText ? task.activeText : task.title
                    ),
                    compact
                      ? undefined
                      : h('span', { class: 'agent-status-item-state' }, getAgentStatusLabel(task.status))
                  ])
                ])
              )
            )
          ])
        : undefined

    const renderSubagentList = (subagents: readonly WebUiAgentSubagent[], compact = false) =>
      subagents.length
        ? h('section', { class: ['agent-status-section', { 'agent-status-section-compact': compact }] }, [
            h('div', { class: 'agent-status-section-heading agent-status-section-heading-icon' }, [
              renderAgentStatusIcon('subagent'),
              h('h3', text('subagents'))
            ]),
            h(
              'ul',
              { class: 'agent-status-list' },
              subagents.map((subagent) => {
                const iconName =
                  subagent.status === 'running' ? 'in_progress' : subagent.status === 'done' ? 'completed' : 'error'
                return h('li', { class: 'agent-status-item', key: subagent.id }, [
                  h(
                    'span',
                    { class: ['agent-status-item-icon', `agent-status-item-icon-${iconName}`] },
                    renderAgentStatusIcon(iconName)
                  ),
                  h('span', { class: 'agent-status-item-copy' }, [
                    h('span', { class: 'agent-status-item-title' }, subagent.name),
                    compact
                      ? undefined
                      : h('span', { class: 'agent-status-item-state' }, getAgentStatusLabel(subagent.status))
                  ])
                ])
              })
            )
          ])
        : undefined

    const renderArtifactList = (artifacts: readonly WebUiAgentArtifact[], compact = false) =>
      artifacts.length
        ? h('section', { class: ['agent-status-section', { 'agent-status-section-compact': compact }] }, [
            h('div', { class: 'agent-status-section-heading agent-status-section-heading-icon' }, [
              renderAgentStatusIcon('artifact'),
              h('h3', text('artifacts'))
            ]),
            h(
              'ul',
              { class: 'agent-status-list agent-artifact-list' },
              artifacts.map((artifact) => {
                const canPreview = Boolean(
                  resolveWorkspaceRelativeArtifactPath(selectedConversation.value?.workspacePath, artifact.path)
                )
                return h(
                  'li',
                  { key: artifact.id },
                  h(
                    'button',
                    {
                      class: 'agent-status-item agent-artifact-item',
                      type: 'button',
                      disabled: !canPreview,
                      title: canPreview ? artifact.path : text('filePreviewPending'),
                      onClick: () => openWorkspaceArtifact(artifact)
                    },
                    [
                      h(
                        'span',
                        { class: 'agent-status-item-icon agent-status-item-icon-artifact' },
                        renderAgentStatusIcon('artifact')
                      ),
                      h('span', { class: 'agent-status-item-copy' }, [
                        h('span', { class: 'agent-status-item-title' }, artifact.name),
                        compact
                          ? undefined
                          : h(
                              'span',
                              { class: 'agent-status-item-state', title: artifact.path },
                              artifact.description ?? artifact.path
                            )
                      ])
                    ]
                  )
                )
              })
            )
          ])
        : undefined

    function renderWorkspaceTreeNodes(
      nodes: readonly WebUiWorkspaceTreeNode[],
      depth = 0,
      searchMode = false
    ): ReturnType<typeof h>[] {
      return nodes.flatMap((node) => {
        const expanded = searchMode || workspaceExpandedDirectories.value.has(node.path)
        const children = searchMode
          ? (node.children ?? [])
          : (workspaceDirectoryEntries.value[node.path] ?? []).map((entry) => ({ ...entry }))
        const row = h(
          'button',
          {
            class: ['workspace-file-row', { 'workspace-file-row-selected': selectedWorkspaceFile.value === node.path }],
            key: node.path,
            type: 'button',
            style: { '--workspace-file-depth': String(depth) },
            title: node.path,
            onClick: () => {
              if (node.isDirectory) toggleWorkspaceDirectory(node.path)
              else void openWorkspaceFile(node.path)
            }
          },
          [
            node.isDirectory
              ? h('span', { class: ['workspace-file-chevron', { 'workspace-file-chevron-expanded': expanded }] }, '›')
              : h('span', { class: 'workspace-file-chevron workspace-file-chevron-spacer' }),
            h(
              'span',
              {
                class: [
                  'workspace-file-kind-icon',
                  node.isDirectory ? 'workspace-file-kind-folder' : 'workspace-file-kind-file'
                ]
              },
              node.isDirectory ? renderActionIcon('folder') : renderAgentStatusIcon('artifact')
            ),
            h('span', { class: 'workspace-file-name' }, node.name)
          ]
        )
        return expanded && children.length ? [row, ...renderWorkspaceTreeNodes(children, depth + 1, searchMode)] : [row]
      })
    }

    const renderWorkspacePreviewToolButton = (
      label: string,
      onClick: () => void,
      options: { active?: boolean; icon?: ActionIconName; shortLabel?: string } = {}
    ) =>
      h(
        'button',
        {
          class: ['workspace-preview-tool-button', { 'workspace-preview-tool-button-active': options.active }],
          type: 'button',
          title: label,
          'aria-label': label,
          'aria-pressed': options.active === undefined ? undefined : String(options.active),
          onClick
        },
        options.icon ? renderActionIcon(options.icon) : (options.shortLabel ?? label)
      )

    const renderWorkspacePreviewToolbar = (preview: WorkspaceFilePreviewState, previewKind: string) => {
      if (preview.status !== 'text') return [] as const
      const isMarkdown = previewKind === 'markdown'
      const language = isMarkdown ? 'markdown' : (getWorkspaceCodeLanguage(preview.path) ?? 'text')
      // Left type label (TEXT / MARKDOWN / TS …); action buttons sit as a separate right group.
      const languageLabel =
        !language || language === 'text' || language === 'plaintext' ? 'TEXT' : language.toUpperCase()
      return [
        h('span', { class: 'workspace-preview-language' }, languageLabel),
        h('div', { class: 'workspace-preview-tool-actions', role: 'toolbar' }, [
          isMarkdown
            ? renderWorkspacePreviewToolButton(
                text('copyMarkdown'),
                () => {
                  void handleWorkspacePreviewCopy(preview.content, text('copyMarkdown'))
                },
                { shortLabel: 'MD' }
              )
            : undefined,
          renderWorkspacePreviewToolButton(
            isMarkdown ? text('copyPlainText') : text('copySource'),
            () => {
              void handleWorkspacePreviewCopy(
                isMarkdown ? markdownToPlainText(preview.content) : preview.content,
                isMarkdown ? text('copyPlainText') : text('copySource')
              )
            },
            { shortLabel: 'TXT' }
          ),
          isMarkdown
            ? renderWorkspacePreviewToolButton(
                workspacePreviewMode.value === 'preview' ? text('sourceMode') : text('previewMode'),
                () => {
                  workspacePreviewMode.value = workspacePreviewMode.value === 'preview' ? 'source' : 'preview'
                },
                { active: workspacePreviewMode.value === 'source', icon: 'source' }
              )
            : undefined,
          renderWorkspacePreviewToolButton(
            workspacePreviewWrap.value ? text('unwrapLines') : text('wrapLines'),
            () => {
              workspacePreviewWrap.value = !workspacePreviewWrap.value
            },
            { active: workspacePreviewWrap.value, icon: 'wrap' }
          ),
          renderWorkspacePreviewToolButton(text('downloadSource'), () => downloadWorkspacePreviewSource(preview), {
            icon: 'download'
          })
        ])
      ] as const
    }

    const renderWorkspaceFilePreview = () => {
      const preview = workspaceFilePreview.value
      if (preview.status === 'idle') return undefined
      const previewKind = getWorkspaceFilePreviewKind(preview.path)
      return h('section', { class: 'workspace-file-preview' }, [
        h('header', { class: 'workspace-file-preview-header' }, [
          h(
            'button',
            {
              class: 'workspace-file-preview-back',
              type: 'button',
              title: text('backToFiles'),
              'aria-label': text('backToFiles'),
              onClick: closeWorkspaceFilePreview
            },
            renderActionIcon('back')
          ),
          h('span', { class: 'workspace-file-preview-title' }, getWorkspacePathBasename(preview.path)),
          ...renderWorkspacePreviewToolbar(preview, previewKind)
        ]),
        h('div', { class: ['workspace-file-preview-content', `workspace-file-preview-${preview.status}`] }, [
          preview.status === 'loading'
            ? h('p', { class: 'workspace-files-state' }, text('loadingFiles'))
            : preview.status === 'error'
              ? h('p', { class: 'workspace-files-state workspace-files-state-error' }, preview.message)
              : preview.status === 'binary'
                ? h('p', { class: 'workspace-files-state' }, text('binaryUnavailable'))
                : preview.status === 'pptx'
                  ? h(
                      'div',
                      {
                        class: 'workspace-pptx-preview-stage',
                        role: 'document',
                        tabindex: 0,
                        'aria-label': preview.name,
                        onVnodeMounted: (vnode: VNode) => {
                          if (vnode.el instanceof HTMLElement) {
                            void mountWorkspacePptxPreview(vnode.el, preview.data, preview.path)
                          }
                        },
                        onVnodeBeforeUnmount: releaseWorkspacePptxPreview
                      },
                      h(
                        'p',
                        { class: 'workspace-pptx-preview-loading', 'data-pptx-preview-loading': '', role: 'status' },
                        text('loadingFiles')
                      )
                    )
                  : preview.status === 'docx'
                    ? h('div', { class: 'workspace-docx-preview-scroll' }, [
                        h('div', { class: 'workspace-docx-preview-style', innerHTML: preview.styleHtml }),
                        h('div', { class: 'workspace-docx-preview', innerHTML: preview.bodyHtml })
                      ])
                    : preview.status === 'pdf'
                      ? h('iframe', {
                          class: 'workspace-pdf-preview',
                          src: preview.url,
                          title: preview.name
                        })
                      : preview.status === 'image'
                        ? h('img', {
                            class: 'workspace-image-preview',
                            src: preview.url,
                            alt: preview.name,
                            onError: () => {
                              URL.revokeObjectURL(preview.url)
                              workspaceFilePreview.value = {
                                status: 'error',
                                path: preview.path,
                                message: text('fileUnavailable')
                              }
                            }
                          })
                        : previewKind === 'markdown'
                          ? h('div', {
                              class: [
                                'workspace-markdown-preview markdown-content',
                                { 'workspace-preview-wrapped': workspacePreviewWrap.value }
                              ],
                              onClick: handleMarkdownContentClick,
                              innerHTML:
                                workspacePreviewMode.value === 'source'
                                  ? `<pre class="workspace-code-preview hljs"><code>${renderCode(preview.content, 'markdown')}</code></pre>`
                                  : renderMarkdown(preview.content, {
                                      copyCodeLabel: text('copyCode'),
                                      downloadCodeLabel: text('downloadSource'),
                                      wrapLinesLabel: text('wrapLines')
                                    })
                            })
                          : h(
                              'pre',
                              {
                                class: [
                                  'workspace-code-preview hljs',
                                  { 'workspace-code-preview-wrapped': workspacePreviewWrap.value }
                                ]
                              },
                              h('code', {
                                innerHTML: renderCode(preview.content, getWorkspaceCodeLanguage(preview.path))
                              })
                            )
        ])
      ])
    }

    const renderWorkspaceFilesPanel = () => {
      const search = workspaceFileSearch.value.trim()
      const rootEntries = (workspaceDirectoryEntries.value[workspaceRootKey.value] ?? []).map((entry) => ({ ...entry }))
      const nodes = search ? workspaceSearchTree.value : rootEntries
      return h('div', { class: 'workspace-files-panel' }, [
        renderWorkspaceFilePreview() ??
          h('div', { class: 'workspace-files-browser' }, [
            h('div', { class: 'workspace-files-toolbar' }, [
              h('div', { class: 'workspace-file-path-wrap' }, [
                h('input', {
                  class: 'workspace-file-path-input',
                  type: 'text',
                  value: workspacePathDraft.value,
                  placeholder: workspaceRootPath.value || text('pathInputPlaceholder'),
                  'aria-label': text('pathInputPlaceholder'),
                  onInput: (event: Event) => {
                    workspacePathDraft.value = (event.target as HTMLInputElement).value
                  },
                  onKeydown: (event: KeyboardEvent) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      openWorkspaceRootPath()
                    }
                  }
                }),
                h(
                  'button',
                  {
                    class: 'workspace-files-refresh',
                    type: 'button',
                    title: text('openPath'),
                    'aria-label': text('openPath'),
                    onClick: openWorkspaceRootPath
                  },
                  renderActionIcon('folder')
                )
              ]),
              h('div', { class: 'workspace-file-search-wrap' }, [
                h('span', { class: 'workspace-file-search-icon', 'aria-hidden': 'true' }, renderActionIcon('search')),
                h('input', {
                  class: 'workspace-file-search',
                  type: 'search',
                  value: workspaceFileSearch.value,
                  placeholder: text('searchFiles'),
                  'aria-label': text('searchFiles'),
                  onInput: (event: Event) => {
                    workspaceFileSearch.value = (event.target as HTMLInputElement).value
                  }
                })
              ]),
              h(
                'button',
                {
                  class: 'workspace-files-refresh',
                  type: 'button',
                  title: text('refreshFiles'),
                  'aria-label': text('refreshFiles'),
                  onClick: refreshWorkspaceFiles
                },
                renderActionIcon('refresh')
              )
            ]),
            h('div', { class: 'workspace-files-root-label' }, [
              renderActionIcon('folder'),
              h('span', workspaceRootLabel.value)
            ]),
            h('div', { class: 'workspace-file-tree' }, [
              workspaceFilesLoading.value && !nodes.length
                ? h('p', { class: 'workspace-files-state' }, text('loadingFiles'))
                : workspaceFilesError.value
                  ? h('p', { class: 'workspace-files-state workspace-files-state-error' }, workspaceFilesError.value)
                  : !nodes.length
                    ? h('p', { class: 'workspace-files-state' }, search ? text('noSearchResults') : text('filesEmpty'))
                    : renderWorkspaceTreeNodes(nodes, 0, Boolean(search))
            ])
          ])
      ])
    }

    const renderAgentStatusBody = (status: WebUiAgentStatus, compact = false) => [
      compact ? undefined : renderTaskList(status.tasks, false),
      renderContextUsageSummary(compact),
      compact ? renderTaskList(status.tasks, true) : undefined,
      renderSubagentList(status.subagents, compact),
      renderArtifactList(status.artifacts, compact)
    ]

    const clearStatusPreviewTimers = () => {
      if (statusPreviewOpenTimer !== undefined) window.clearTimeout(statusPreviewOpenTimer)
      if (statusPreviewCloseTimer !== undefined) window.clearTimeout(statusPreviewCloseTimer)
      statusPreviewOpenTimer = undefined
      statusPreviewCloseTimer = undefined
    }

    const scheduleStatusPreviewOpen = () => {
      if (statusPanelOpen.value) return
      if (statusPreviewCloseTimer !== undefined) window.clearTimeout(statusPreviewCloseTimer)
      statusPreviewCloseTimer = undefined
      if (statusPreviewOpen.value || statusPreviewOpenTimer !== undefined) return
      statusPreviewOpenTimer = window.setTimeout(() => {
        statusPreviewOpenTimer = undefined
        statusPreviewOpen.value = true
        refreshComposerInfo()
      }, 150)
    }

    const scheduleStatusPreviewClose = () => {
      if (statusPreviewOpenTimer !== undefined) window.clearTimeout(statusPreviewOpenTimer)
      statusPreviewOpenTimer = undefined
      if (statusPreviewCloseTimer !== undefined) window.clearTimeout(statusPreviewCloseTimer)
      statusPreviewCloseTimer = window.setTimeout(() => {
        statusPreviewCloseTimer = undefined
        statusPreviewOpen.value = false
      }, 100)
    }

    const toggleStatusPanel = () => {
      clearStatusPreviewTimers()
      statusPreviewOpen.value = false
      if (statusPanelOpen.value && rightPanelTab.value === 'status') {
        statusPanelOpen.value = false
        return
      }
      statusPanelOpen.value = true
      rightPanelTab.value = 'status'
      refreshComposerInfo()
    }

    const selectLanguage = (nextLanguage: (typeof webUiLanguages)[number]['id']) => {
      language.value = nextLanguage
      languageOverride.value = true
      languagePickerOpen.value = false
      bridgeDetail.value = bridgeState.value === 'connected' ? text('connected') : text('disconnected')
    }

    const statusItems = computed<readonly WebuiStatus[]>(() => [
      {
        label: text('runtime'),
        value: bridgeDetail.value
      },
      {
        label: text('serviceStarted'),
        value: serviceStartedAt.value
      },
      {
        label: text('sseClients'),
        value: sseClientCount.value
      }
    ])
    const versionItems = computed<readonly WebuiStatus[]>(() => [
      {
        label: text('appVersion'),
        value: appVersion.value || text('unavailable')
      },
      {
        label: text('webUiVersion'),
        value: webUiVersion
      }
    ])

    const refreshHealth = async () => {
      try {
        const health = await httpClient.getJson<WebUiHealthResponse>('/api/health')
        if (!languageOverride.value) language.value = normalizeLanguage(health.language)
        bridgeState.value = health.ok ? 'connected' : 'offline'
        bridgeDetail.value = health.ok ? text('connected') : text('disconnected')
        appVersion.value = health.appVersion ?? ''
        serviceStartedAt.value = new Date(health.startedAt).toLocaleString()
        sseClientCount.value = String(health.sseClients)
      } catch (error) {
        bridgeState.value = 'offline'
        bridgeDetail.value = localizedErrorMessage(error)
        appVersion.value = ''
        serviceStartedAt.value = text('unavailable')
        sseClientCount.value = '0'
      }
    }

    const sortConversations = (items: readonly WebUiConversationSummary[]) =>
      [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))

    const mergeConversations = (
      current: readonly WebUiConversationSummary[],
      incoming: readonly WebUiConversationSummary[]
    ): readonly WebUiConversationSummary[] => {
      const byId = new Map(current.map((conversation) => [conversation.id, conversation]))
      for (const conversation of incoming) byId.set(conversation.id, conversation)
      return sortConversations([...byId.values()])
    }

    const loadConversations = async () => {
      conversationLoadState.value = 'loading'
      conversationLoadMessage.value = ''
      olderConversationsCursor.value = undefined

      try {
        const query = new URLSearchParams({ limit: String(conversationPageSize) })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionEntity>>(
          `/api/data/agent-sessions?${query.toString()}`
        )
        conversations.value = sortConversations(page.items.map(toConversationSummary))
        olderConversationsCursor.value = page.nextCursor
        if (
          selectedConversationId.value &&
          !conversations.value.some((conversation) => conversation.id === selectedConversationId.value)
        ) {
          selectedConversationId.value = undefined
          messages.value = []
          resetWorkspaceFiles()
          messageLoadState.value = 'idle'
          messageLoadMessage.value = text('sessionsChanged')
        }
        conversationLoadState.value = 'ready'
        conversationLoadMessage.value = conversations.value.length ? '' : text('noSessions')
        // Open WebUI / after refresh: land on the newest session when nothing is selected.
        // Guard the index access: noUncheckedIndexedAccess still types [0] as possibly undefined.
        const latestConversation = conversations.value[0]
        // Show only the newest session's workdir group (its first `conversationGroupDefaultVisibleCount`
        // items) by default; collapse every other workdir group to its header. Not persisted, so a
        // later load re-derives the layout from the then-newest session.
        const latestGroupKey = latestConversation ? conversationGroupKey(latestConversation) : undefined
        collapsedWorkdirGroupIds.value = new Set(
          conversationGroups.value.filter((group) => group.id !== latestGroupKey).map((group) => group.id)
        )
        if (!selectedConversationId.value && latestConversation) {
          // Auto-open the newest session without expanding its per-group show-more footer,
          // so a refreshed sidebar stays collapsed until the user explicitly expands it.
          selectConversation(latestConversation.id, { reveal: false })
        }
        // Fill the sidebar until the viewport is full; groups beyond the default visible
        // count stay collapsed behind their per-group "show more" footer button.
        await nextTick()
        const nav = conversationNav.value
        if (olderConversationsCursor.value && nav && nav.scrollHeight <= nav.clientHeight + 8) {
          void loadOlderConversations()
        }
      } catch (error) {
        conversations.value = []
        olderConversationsCursor.value = undefined
        conversationLoadState.value = 'error'
        conversationLoadMessage.value = localizedErrorMessage(error)
      }
    }

    const loadOlderConversations = async () => {
      const cursor = olderConversationsCursor.value
      if (!cursor || olderConversationsLoading.value) return
      if (conversations.value.length >= conversationLoadHardCap) {
        olderConversationsCursor.value = undefined
        return
      }

      olderConversationsLoading.value = true
      try {
        const query = new URLSearchParams({ limit: String(conversationPageSize), cursor })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionEntity>>(
          `/api/data/agent-sessions?${query.toString()}`
        )
        conversations.value = mergeConversations(conversations.value, page.items.map(toConversationSummary))
        olderConversationsCursor.value =
          conversations.value.length >= conversationLoadHardCap ? undefined : page.nextCursor
        await nextTick()
        const nav = conversationNav.value
        // Keep filling the sidebar while older pages remain (button + scroll still work).
        if (olderConversationsCursor.value && nav && nav.scrollHeight <= nav.clientHeight + 8) {
          olderConversationsLoading.value = false
          await loadOlderConversations()
          return
        }
      } catch (error) {
        conversationLoadMessage.value = localizedErrorMessage(error)
      } finally {
        olderConversationsLoading.value = false
      }
    }

    const updateConversationScrollState = () => {
      const nav = conversationNav.value
      if (!nav) return
      // Auto-load older sessions when the user scrolls near the bottom.
      if (
        nav.scrollHeight - nav.scrollTop - nav.clientHeight <= 72 &&
        olderConversationsCursor.value &&
        !olderConversationsLoading.value
      ) {
        void loadOlderConversations()
      }
    }

    const mergeMessages = (
      current: readonly WebUiMessageSnapshot[],
      incoming: readonly WebUiMessageSnapshot[]
    ): readonly WebUiMessageSnapshot[] => {
      const byId = new Map(current.map((message) => [message.id, message]))
      for (const message of incoming) byId.set(message.id, message)
      return [...byId.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    }

    const loadConversationMessages = async (conversationId: string, mode: 'replace' | 'refresh' = 'replace') => {
      const requestId = ++latestMessageRequest
      if (mode === 'replace') {
        messageLoadState.value = 'loading'
        messageLoadMessage.value = ''
      }

      try {
        const query = new URLSearchParams({ limit: String(messagePageSize) })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionMessageEntity>>(
          `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages?${query.toString()}`
        )
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        const latest = page.items.map(toMessageSnapshot).reverse()
        messages.value = mode === 'replace' ? latest : mergeMessages(messages.value, latest)
        if (mode === 'replace') olderMessagesCursor.value = page.nextCursor
        messageLoadState.value = 'ready'
        messageLoadMessage.value = messages.value.length ? '' : text('emptyConversation')
        refreshComposerInfo(conversationId)
        if (mode === 'replace') {
          scrollMessagesToEnd()
          // If the first page does not fill the viewport, keep loading older pages.
          await nextTick()
          const stack = messageStack.value
          if (olderMessagesCursor.value && stack && stack.scrollHeight <= stack.clientHeight + 8) {
            void loadOlderMessages()
          }
        }
      } catch (error) {
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        messageLoadState.value = 'error'
        messageLoadMessage.value = localizedErrorMessage(error)
      }
    }

    const loadOlderMessages = async () => {
      const conversationId = selectedConversationId.value
      const cursor = olderMessagesCursor.value
      const stack = messageStack.value
      if (!conversationId || !cursor || olderMessagesLoading.value) return

      olderMessagesLoading.value = true
      const previousScrollHeight = stack?.scrollHeight ?? 0
      try {
        const query = new URLSearchParams({ limit: String(messagePageSize), cursor })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionMessageEntity>>(
          `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages?${query.toString()}`
        )
        if (selectedConversationId.value !== conversationId) return
        messages.value = mergeMessages(page.items.map(toMessageSnapshot).reverse(), messages.value)
        olderMessagesCursor.value = page.nextCursor
        await nextTick()
        if (stack) stack.scrollTop += stack.scrollHeight - previousScrollHeight
        // Keep filling the viewport while older pages remain (button + scroll-to-top still work).
        if (olderMessagesCursor.value && stack && stack.scrollHeight <= stack.clientHeight + 8) {
          olderMessagesLoading.value = false
          await loadOlderMessages()
          return
        }
      } catch (error) {
        submitError.value = localizedErrorMessage(error)
      } finally {
        olderMessagesLoading.value = false
      }
    }

    const loadAgents = async () => {
      const page = await httpClient.getJson<WebUiOffsetResponse<WebUiAgentEntity>>('/api/data/agents')
      agents.value = page.items
    }

    const loadModels = async () => {
      const response = await httpClient.getJson<WebUiModelsResponse>('/api/webui/models')
      modelGroups.value = response.groups
    }

    const updateSessionModel = async (model: WebUiModel) => {
      const conversationId = selectedConversationId.value
      if (!conversationId || model.id === selectedAgent.value?.model || modelUpdateState.value === 'updating') return

      modelUpdateState.value = 'updating'
      submitError.value = ''
      try {
        await httpClient.patchJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/model`, {
          model: model.id
        })
        await loadAgents()
        refreshComposerInfo(conversationId)
        modelPickerOpen.value = false
        modelUpdateState.value = 'idle'
      } catch (error) {
        submitError.value = localizedErrorMessage(error)
        modelUpdateState.value = 'error'
      }
    }

    const updateSessionAgent = async (agentId: string) => {
      const conversationId = selectedConversationId.value
      if (!conversationId || agentId === selectedConversation.value?.agentId || agentUpdateState.value === 'updating')
        return
      agentUpdateState.value = 'updating'
      submitError.value = ''
      try {
        await httpClient.patchJson(`/api/data/agent-sessions/${encodeURIComponent(conversationId)}`, { agentId })
        await loadAgents()
        // SSE session-updated 会触发 refreshFromDesktopSync → loadConversations
        refreshSkills(agentId)
        agentPickerOpen.value = false
        agentUpdateState.value = 'idle'
      } catch (error) {
        submitError.value = localizedErrorMessage(error)
        agentUpdateState.value = 'error'
      }
    }

    const confirmSwitchModel = () => {
      const target = pendingModelSwitchTarget.value
      if (!target) return
      if (skipModelSwitchConfirm.value) {
        localStorage.setItem('skipModelSwitchConfirm', 'true')
      } else {
        localStorage.removeItem('skipModelSwitchConfirm')
      }
      pendingModelSwitchTarget.value = null
      void updateSessionModel(target)
    }

    const cancelSwitchModel = () => {
      pendingModelSwitchTarget.value = null
    }

    const loadWorkspaces = async () => {
      workspacesLoading.value = true
      try {
        const response = await httpClient.getJson<WebUiAgentWorkspace[]>('/api/data/agent-workspaces')
        workspaces.value = response
        workspacesLoading.value = false
      } catch (error) {
        workspacesLoading.value = false
        submitError.value = localizedErrorMessage(error)
      }
    }

    const updateSessionWorkspace = async (workspaceId: string | null) => {
      const conversationId = selectedConversationId.value
      if (!conversationId || workspaceUpdateState.value === 'updating') return
      workspaceUpdateState.value = 'updating'
      submitError.value = ''
      try {
        const body = workspaceId ? { type: 'user' as const, workspaceId } : { type: 'system' as const }
        await httpClient.putJson(`/api/data/agent-sessions/${encodeURIComponent(conversationId)}/workspace`, body)
        workspacePickerOpen.value = false
        workspaceUpdateState.value = 'idle'
        await loadConversations()
      } catch (error) {
        submitError.value = localizedErrorMessage(error)
        workspaceUpdateState.value = 'error'
      }
    }

    const updatePermissionMode = async (mode: WebUiPermissionMode) => {
      const conversationId = selectedConversationId.value
      if (
        !conversationId ||
        !selectedAgent.value ||
        mode === selectedPermissionMode.value ||
        permissionModeUpdateState.value === 'updating'
      ) {
        return
      }

      permissionModeUpdateState.value = 'updating'
      submitError.value = ''
      try {
        await httpClient.patchJson<WebUiPermissionModeResponse>(
          `/api/agent-sessions/${encodeURIComponent(conversationId)}/permission-mode`,
          { permissionMode: mode }
        )
        await loadAgents()
        permissionModePickerOpen.value = false
        permissionModeUpdateState.value = 'idle'
      } catch (error) {
        submitError.value = localizedErrorMessage(error)
        permissionModeUpdateState.value = 'error'
      }
    }

    const refreshComposerInfo = (conversationId = selectedConversationId.value) => {
      if (!conversationId) return
      void httpClient
        .getJson<WebUiContextUsageResponse>(`/api/agent-sessions/${encodeURIComponent(conversationId)}/context-usage`)
        .then((response) => {
          if (selectedConversationId.value === conversationId) contextUsage.value = response.usage
        })
        .catch(() => {
          if (selectedConversationId.value === conversationId) contextUsage.value = null
        })
    }

    const refreshSlashCommands = (conversationId = selectedConversationId.value) => {
      if (!conversationId) return
      void httpClient
        .getJson<WebUiSlashCommandsResponse>(`/api/agent-sessions/${encodeURIComponent(conversationId)}/slash-commands`)
        .then((response) => {
          if (selectedConversationId.value === conversationId) slashCommands.value = response.commands
        })
        .catch(() => {
          if (selectedConversationId.value === conversationId) slashCommands.value = []
        })
    }

    const refreshSkills = (agentId: string | null | undefined = selectedAgentId.value) => {
      const suffix = agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''
      void httpClient
        .getJson<readonly WebUiSkill[]>(`/api/data/skills${suffix}`)
        .then((response) => {
          skills.value = response
        })
        .catch(() => {
          skills.value = []
        })
    }

    const refreshKnowledgeBases = () => {
      void httpClient
        .getJson<readonly WebUiKnowledgeBase[]>('/api/data/knowledge-bases')
        .then((response) => {
          knowledgeBases.value = response
        })
        .catch(() => {
          knowledgeBases.value = []
        })
    }

    const selectConversation = (conversationId: string, options?: { reveal?: boolean }) => {
      clearStatusPreviewTimers()
      closeConversationMenu()
      statusPreviewOpen.value = false
      const target = conversations.value.find((conversation) => conversation.id === conversationId)
      if (target) {
        expandWorkdirGroup(conversationGroupKey(target))
        // Ensure a selected session hidden behind a collapsed group footer is revealed,
        // unless the caller opted out (auto-open after refresh must not expand the group).
        if (options?.reveal !== false) expandConversationGroup(conversationGroupKey(target))
      }
      if (conversationId === selectedConversationId.value) {
        mobileSidebarOpen.value = false
        void loadConversationMessages(conversationId, 'refresh')
        refreshComposerInfo(conversationId)
        refreshSlashCommands(conversationId)
        refreshSkills(target?.agentId)
        refreshKnowledgeBases()
        if (statusPanelOpen.value && rightPanelTab.value === 'files') refreshWorkspaceFiles()
        return
      }

      // Drop previous send/model errors when switching sessions.
      submitError.value = ''

      // Drop in-flight stream state from the previous session (avoids cross-chat delta apply / seals).
      if (chunkFrame !== undefined) {
        window.cancelAnimationFrame(chunkFrame)
        chunkFrame = undefined
      }
      if (streamRefreshTimer !== undefined) {
        window.clearTimeout(streamRefreshTimer)
        streamRefreshTimer = undefined
      }
      clearPendingStreamChunks()
      sealedStreamMessageIds.clear()

      resetWorkspaceFiles()
      selectedConversationId.value = conversationId
      mobileSidebarOpen.value = false
      messages.value = []
      contextUsage.value = null
      slashCommands.value = []
      olderMessagesCursor.value = undefined
      attachments.value = []
      reasoningEffort.value = 'default'
      modelPickerOpen.value = false
      reasoningPickerOpen.value = false
      permissionModePickerOpen.value = false
      approvalSubmittingKeys.value = new Set()
      approvalErrorByKey.value = {}
      void loadConversationMessages(conversationId)
      refreshComposerInfo(conversationId)
      refreshSlashCommands(conversationId)
      refreshSkills(target?.agentId)
      refreshKnowledgeBases()
    }

    const toggleConversationMenu = (conversationId: string) => {
      openConversationMenuId.value = openConversationMenuId.value === conversationId ? undefined : conversationId
    }

    const closeConversationMenu = () => {
      openConversationMenuId.value = undefined
    }

    const openEditConversation = (conversation: WebUiConversationSummary) => {
      closeConversationMenu()
      editingConversationId.value = conversation.id
      editingConversationTitle.value = conversation.title
      conversationActionId.value = conversation.id
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const closeEditConversation = () => {
      if (conversationActionState.value === 'saving' || conversationActionState.value === 'generating') return
      editingConversationId.value = undefined
      editingConversationTitle.value = ''
      conversationActionId.value = undefined
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const saveConversationTitle = async () => {
      const conversationId = editingConversationId.value
      if (
        !conversationId ||
        conversationActionState.value === 'saving' ||
        conversationActionState.value === 'generating'
      )
        return
      const nextTitle = editingConversationTitle.value.trim()
      if (!nextTitle) {
        conversationActionError.value = text('titleRequired')
        return
      }
      conversationActionState.value = 'saving'
      conversationActionError.value = ''
      try {
        await httpClient.patchJson(`/api/data/agent-sessions/${encodeURIComponent(conversationId)}`, {
          name: nextTitle,
          isNameManuallyEdited: true
        })
        editingConversationId.value = undefined
        editingConversationTitle.value = ''
        conversationActionState.value = 'idle'
        await loadConversations()
      } catch (error) {
        conversationActionState.value = 'error'
        conversationActionError.value = localizedErrorMessage(error)
      }
    }

    const generateConversationTitle = async (conversationId: string) => {
      if (
        !conversationId ||
        conversationActionState.value === 'saving' ||
        conversationActionState.value === 'generating'
      )
        return
      closeConversationMenu()
      conversationActionId.value = conversationId
      conversationActionState.value = 'generating'
      conversationActionError.value = ''
      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/generate-title`, {})
        await loadConversations()
        if (selectedConversationId.value === conversationId) {
          await loadConversationMessages(conversationId, 'refresh')
        }
        conversationActionState.value = 'idle'
      } catch (error) {
        conversationActionState.value = 'error'
        conversationActionError.value = localizedErrorMessage(error)
      }
    }

    const openDeleteConversation = (conversationId: string) => {
      if (conversationActionState.value === 'saving' || conversationActionState.value === 'generating') return
      closeConversationMenu()
      deleteConversationId.value = conversationId
      conversationActionId.value = conversationId
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const closeDeleteConversation = () => {
      if (conversationActionState.value === 'deleting') return
      deleteConversationId.value = undefined
      conversationActionId.value = undefined
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const confirmDeleteConversation = async () => {
      const conversationId = deleteConversationId.value
      if (!conversationId || conversationActionState.value === 'deleting') return
      conversationActionState.value = 'deleting'
      conversationActionError.value = ''
      try {
        await httpClient.deleteJson(`/api/data/agent-sessions/${encodeURIComponent(conversationId)}`)
        deleteConversationId.value = undefined
        conversationActionId.value = undefined
        conversationActionState.value = 'idle'
        if (selectedConversationId.value === conversationId) {
          selectedConversationId.value = undefined
          messages.value = []
          contextUsage.value = null
          slashCommands.value = []
          olderMessagesCursor.value = undefined
          messageLoadState.value = 'idle'
          messageLoadMessage.value = text('sessionsChanged')
        }
        await loadConversations()
      } catch (error) {
        conversationActionState.value = 'error'
        conversationActionError.value = localizedErrorMessage(error)
      }
    }

    const beginPanelResize = (event: PointerEvent) => {
      if (!statusPanelOpen.value) return
      const host = event.currentTarget as HTMLElement | null
      const pointerId = event.pointerId
      const startX = event.clientX
      const startWidth = statusPanelWidth.value
      const minWidth = 300
      const maxWidth = 520
      statusPanelResizing.value = true
      host?.setPointerCapture(pointerId)
      const onMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX
        statusPanelWidth.value = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth + delta)))
      }
      const onUp = () => {
        statusPanelResizing.value = false
        window.localStorage.setItem('cherry-webui.right-panel-width', String(statusPanelWidth.value))
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    const workspaceSeedHint = (seed: WebUiCreateSessionWorkspace, group?: ConversationWorkdirGroup): string => {
      if (seed.type === 'user') {
        const label =
          group?.label ||
          conversations.value.find(
            (conversation) => conversation.workspaceType === 'user' && conversation.workspaceId === seed.workspaceId
          )?.workspaceLabel ||
          conversations.value.find(
            (conversation) => conversation.workspaceType === 'user' && conversation.workspaceId === seed.workspaceId
          )?.workspacePath ||
          seed.workspaceId
        return `${text('createWorkspaceHint')}: ${label}`
      }
      return text('createWorkspaceSystemHint')
    }

    const isWorkdirGroupCollapsed = (groupId: string) => collapsedWorkdirGroupIds.value.has(groupId)

    const toggleWorkdirGroupCollapsed = (groupId: string) => {
      const next = new Set(collapsedWorkdirGroupIds.value)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      collapsedWorkdirGroupIds.value = next
      persistCollapsedWorkdirGroups(next)
    }

    const expandWorkdirGroup = (groupId: string) => {
      if (!collapsedWorkdirGroupIds.value.has(groupId)) return
      const next = new Set(collapsedWorkdirGroupIds.value)
      next.delete(groupId)
      collapsedWorkdirGroupIds.value = next
      persistCollapsedWorkdirGroups(next)
    }

    const toggleConversationGroupExpanded = (groupId: string) => {
      const next = new Set(expandedConversationGroupIds.value)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      expandedConversationGroupIds.value = next
    }

    const expandConversationGroup = (groupId: string) => {
      if (expandedConversationGroupIds.value.has(groupId)) return
      const next = new Set(expandedConversationGroupIds.value)
      next.add(groupId)
      expandedConversationGroupIds.value = next
    }

    const openNewConversation = async (options?: {
      workspaceSeed?: WebUiCreateSessionWorkspace
      defaultAgentId?: string | null
      workspaceHint?: string
      group?: ConversationWorkdirGroup
    }) => {
      const seed = options?.workspaceSeed ?? resolveWorkspaceSeedFromConversation(selectedConversation.value)
      const preferredAgentId = options?.defaultAgentId ?? selectedConversation.value?.agentId ?? undefined

      pendingWorkspaceSeed.value = seed
      pendingWorkspaceHint.value = options?.workspaceHint ?? workspaceSeedHint(seed, options?.group)
      // Mobile drawer sits above the create dialog (z-index 30 > modal 20); always close it first.
      mobileSidebarOpen.value = false
      newConversationOpen.value = true
      newConversationState.value = 'loading'
      newConversationError.value = ''

      try {
        await loadAgents()
        const preferredStillAvailable = preferredAgentId && agents.value.some((agent) => agent.id === preferredAgentId)
        selectedAgentId.value = preferredStillAvailable ? preferredAgentId : (agents.value[0]?.id ?? '')
        newConversationState.value = 'idle'
        if (!agents.value.length) newConversationError.value = text('noAgents')
      } catch (error) {
        agents.value = []
        selectedAgentId.value = ''
        newConversationState.value = 'error'
        newConversationError.value = localizedErrorMessage(error)
      }
    }

    const openNewConversationInGroup = (group: ConversationWorkdirGroup, event?: Event) => {
      event?.stopPropagation()
      const seed: WebUiCreateSessionWorkspace =
        group.kind === 'user' && group.workspaceId
          ? { type: 'user', workspaceId: group.workspaceId }
          : { type: 'system' }
      const defaultAgentId = group.conversations.find((conversation) => conversation.agentId)?.agentId ?? null
      void openNewConversation({
        workspaceSeed: seed,
        defaultAgentId,
        workspaceHint: workspaceSeedHint(seed, group),
        group
      })
    }

    const createConversation = async () => {
      if (!selectedAgentId.value || newConversationState.value === 'creating') return

      newConversationState.value = 'creating'
      newConversationError.value = ''
      try {
        const body: WebUiCreateSessionBody = {
          agentId: selectedAgentId.value,
          name: '',
          workspace:
            pendingWorkspaceSeed.value.type === 'user'
              ? {
                  type: 'user',
                  workspaceId: pendingWorkspaceSeed.value.workspaceId
                }
              : { type: 'system' }
        }
        const session = await httpClient.postJson<WebUiAgentSessionEntity>('/api/data/agent-sessions', body)
        newConversationOpen.value = false
        pendingWorkspaceSeed.value = { type: 'system' }
        pendingWorkspaceHint.value = ''
        await loadConversations()
        selectConversation(session.id)
      } catch (error) {
        newConversationState.value = 'error'
        newConversationError.value = localizedErrorMessage(error)
      }
    }

    const clearPendingStreamChunks = (messageId?: string) => {
      if (!messageId) {
        pendingChunks.clear()
        pendingChunkRetries.clear()
        return
      }
      pendingChunks.delete(messageId)
      pendingChunkRetries.delete(messageId)
    }

    const sealStreamMessage = (messageId?: string) => {
      if (!messageId) return
      sealedStreamMessageIds.add(messageId)
      clearPendingStreamChunks(messageId)
    }

    const isTextLikeStreamChunk = (chunk: WebUiChunkPayload['chunk']) =>
      chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'

    /** Single authoritative reload after stream end; merges done + stream-terminal. */
    const refreshMessagesAfterStream = (conversationId: string, messageId?: string) => {
      sealStreamMessage(messageId)
      if (streamRefreshTimer !== undefined) window.clearTimeout(streamRefreshTimer)
      streamRefreshTimer = window.setTimeout(() => {
        streamRefreshTimer = undefined
        if (selectedConversationId.value !== conversationId) return
        void loadConversationMessages(conversationId, 'refresh')
        refreshComposerInfo(conversationId)
        refreshSlashCommands(conversationId)
        if (statusPanelOpen.value && rightPanelTab.value === 'files') refreshWorkspaceFiles()
      }, 120)
    }

    const refreshFromDesktopSync = (reason?: string, conversationId?: string, messageId?: string) => {
      if (syncTimer) window.clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        syncTimer = undefined
        void loadConversations()
        if (reason === 'agent-permission-mode-updated' || reason === 'agent-model-updated') {
          void loadAgents().catch(() => {
            /* ignore — label falls back until next manual refresh */
          })
        }
        const selectedId = selectedConversationId.value
        if (selectedId && (!conversationId || conversationId === selectedId)) {
          if (reason === 'stream-terminal') {
            // Share path with SSE `done` — do not double-append via a second blind refresh race.
            refreshMessagesAfterStream(selectedId, messageId)
          } else if (reason === 'message-submitted' || reason === 'message-deleted') {
            void loadConversationMessages(selectedId, 'refresh')
          }
          if (reason !== 'stream-terminal') refreshComposerInfo(selectedId)
        }
      }, 180)
    }

    const scrollThinkingPreview = () => {
      void nextTick(() => {
        const el = activeThinkingPreview.value
        if (el) el.scrollLeft = el.scrollWidth
      })
    }

    const applyStreamChunk = (payload: WebUiChunkPayload): boolean => {
      if (payload.conversationId !== selectedConversationId.value) return true

      const messageIndex = messages.value.findIndex((message) => message.id === payload.messageId)
      if (messageIndex < 0) return false

      const nextMessages = [...messages.value]
      const message = nextMessages[messageIndex]
      if (!message) return false
      const chunk = payload.chunk
      const streamSealed =
        sealedStreamMessageIds.has(payload.messageId) ||
        message.status === 'success' ||
        message.status === 'error' ||
        message.status === 'paused'

      if (chunk.type === 'text-delta' && chunk.delta) {
        // Terminal or already-authoritative rows must not keep appending (duplicate body after long thinking).
        if (streamSealed) return true
        if (message.content.endsWith(chunk.delta)) return true
        nextMessages[messageIndex] = {
          ...message,
          content: `${message.content}${chunk.delta}`,
          contentBlocks: appendContentText(message.contentBlocks ?? [], message.id, chunk.delta)
        }
      } else if (chunk.type === 'reasoning-delta' && chunk.delta) {
        if (streamSealed) return true
        const previousReasoning = message.reasoning ?? ''
        if (previousReasoning.endsWith(chunk.delta)) return true
        nextMessages[messageIndex] = {
          ...message,
          reasoning: `${previousReasoning}${chunk.delta}`,
          processGroups: appendProcessReasoning(message.processGroups ?? [], message.id, chunk.delta),
          contentBlocks: appendContentReasoning(message.contentBlocks ?? [], message.id, chunk.delta)
        }
        scrollThinkingPreview()
      } else if (chunk.type === 'data-agent-task-event' && isWebUiAgentTaskEventData(chunk.data)) {
        const statusEvent: WebUiAgentStatusEvent = {
          kind: 'task-event',
          id: chunk.id ?? `${chunk.data.taskId}:${chunk.data.event}`,
          data: chunk.data
        }
        nextMessages[messageIndex] = {
          ...message,
          agentStatusEvents: upsertAgentStatusEvent(message.agentStatusEvents ?? [], statusEvent)
        }
      } else if (chunk.toolCallId) {
        const previousTools = message.toolCalls ?? []
        const previousTool = previousTools.find((tool) => tool.id === chunk.toolCallId)
        const previousStatusEvents = message.agentStatusEvents ?? []
        const previousStatusEvent = previousStatusEvents.find(
          (event): event is Extract<WebUiAgentStatusEvent, { kind: 'tool' }> =>
            event.kind === 'tool' && event.id === chunk.toolCallId
        )
        const input = toDisplayText(chunk.input)
        const output = toDisplayText(chunk.output)
        const approvalId =
          typeof chunk.approvalId === 'string' && chunk.approvalId.trim()
            ? chunk.approvalId.trim()
            : previousTool?.approvalId
        const nextTool: WebUiToolCallSnapshot = {
          id: chunk.toolCallId,
          name: chunk.toolName ?? previousTool?.name ?? 'Tool',
          state:
            chunk.type === 'tool-approval-request'
              ? 'approval-requested'
              : chunk.type === 'tool-output-available'
                ? 'output-available'
                : chunk.type === 'tool-output-error'
                  ? 'output-error'
                  : chunk.type === 'tool-output-denied'
                    ? 'output-denied'
                    : chunk.type === 'tool-input-start'
                      ? 'input-streaming'
                      : chunk.type === 'tool-input-available'
                        ? 'input-available'
                        : (previousTool?.state ?? 'input-streaming'),
          ...(approvalId &&
          (chunk.type === 'tool-approval-request' ||
            previousTool?.state === 'approval-requested' ||
            previousTool?.approvalId)
            ? { approvalId }
            : {}),
          ...(chunk.type === 'tool-input-delta'
            ? { input: `${previousTool?.input ?? ''}${chunk.inputTextDelta ?? ''}` }
            : input
              ? { input }
              : previousTool?.input
                ? { input: previousTool.input }
                : {}),
          ...(chunk.type === 'tool-approval-request' && chunk.input !== undefined
            ? { rawInput: chunk.input }
            : previousTool?.rawInput
              ? { rawInput: previousTool.rawInput }
              : {}),
          ...(output ? { output } : previousTool?.output ? { output: previousTool.output } : {}),
          ...(chunk.errorText
            ? { errorText: chunk.errorText }
            : previousTool?.errorText
              ? { errorText: previousTool.errorText }
              : {})
        }
        if (chunk.type === 'tool-approval-request' || nextTool.state !== 'approval-requested') {
          setApprovalSubmitting(message.id, chunk.toolCallId, false)
          if (nextTool.state !== 'approval-requested') setApprovalError(message.id, chunk.toolCallId, '')
        }
        nextMessages[messageIndex] = {
          ...message,
          toolCalls: [...previousTools.filter((tool) => tool.id !== chunk.toolCallId), nextTool],
          processGroups: upsertProcessTool(message.processGroups ?? [], message.id, nextTool),
          contentBlocks: upsertContentTool(message.contentBlocks ?? [], message.id, nextTool),
          agentStatusEvents: upsertAgentStatusEvent(previousStatusEvents, {
            kind: 'tool',
            id: chunk.toolCallId,
            name: chunk.toolName ?? previousStatusEvent?.name ?? previousTool?.name ?? 'Tool',
            state: nextTool.state,
            ...(chunk.type === 'tool-input-delta'
              ? {
                  input: `${typeof previousStatusEvent?.input === 'string' ? previousStatusEvent.input : ''}${chunk.inputTextDelta ?? ''}`
                }
              : chunk.input !== undefined
                ? { input: chunk.input }
                : previousStatusEvent?.input !== undefined
                  ? { input: previousStatusEvent.input }
                  : {}),
            ...(chunk.output !== undefined
              ? { output: chunk.output }
              : previousStatusEvent?.output !== undefined
                ? { output: previousStatusEvent.output }
                : {})
          })
        }
      } else {
        return true
      }
      messages.value = nextMessages
      return true
    }

    const queueStreamChunk = (payload: WebUiChunkPayload) => {
      // Drop text/reasoning for sealed turns before they enter the queue (late SSE after done).
      if (sealedStreamMessageIds.has(payload.messageId) && isTextLikeStreamChunk(payload.chunk)) return

      const chunks = pendingChunks.get(payload.messageId) ?? []
      chunks.push(payload)
      pendingChunks.set(payload.messageId, chunks)
      if (chunkFrame !== undefined) return

      chunkFrame = window.requestAnimationFrame(() => {
        chunkFrame = undefined
        // Follow stream only while the user stays near the bottom; scrolling up stops auto-follow.
        // Send still one-shot pins via waitForUserBubbleThenScrollToEnd (does not force the whole run).
        const shouldFollow = !showScrollToBottom.value
        /** Only non-text tool/status chunks may reload+retry; never re-append text-delta after refresh. */
        const retryChunks: WebUiChunkPayload[] = []
        for (const queued of pendingChunks.values()) {
          for (const chunk of queued) {
            if (sealedStreamMessageIds.has(chunk.messageId) && isTextLikeStreamChunk(chunk.chunk)) {
              pendingChunkRetries.delete(chunk.messageId)
              continue
            }
            if (applyStreamChunk(chunk)) {
              pendingChunkRetries.delete(chunk.messageId)
              continue
            }
            // Message row not in memory yet.
            if (isTextLikeStreamChunk(chunk.chunk)) {
              // Blind re-append after refresh is the main duplicate-body bug after long thinking.
              // Refresh once to materialize the row; discard text-like deltas (server snapshot wins).
              const retries = pendingChunkRetries.get(chunk.messageId) ?? 0
              if (retries < 1) {
                pendingChunkRetries.set(chunk.messageId, retries + 1)
                retryChunks.push(chunk)
              }
              continue
            }
            const retries = pendingChunkRetries.get(chunk.messageId) ?? 0
            if (retries < 2) {
              pendingChunkRetries.set(chunk.messageId, retries + 1)
              retryChunks.push(chunk)
            }
          }
        }
        pendingChunks.clear()
        if (shouldFollow) scrollMessagesToEnd()
        if (retryChunks.length > 0 && selectedConversationId.value) {
          const conversationId = selectedConversationId.value
          const textLikeRetries = retryChunks.filter((chunk) => isTextLikeStreamChunk(chunk.chunk))
          const toolRetries = retryChunks.filter((chunk) => !isTextLikeStreamChunk(chunk.chunk))
          void loadConversationMessages(conversationId, 'refresh').finally(() => {
            // After refresh, never re-apply text/reasoning deltas (would duplicate persisted body).
            for (const chunk of textLikeRetries) {
              pendingChunkRetries.delete(chunk.messageId)
            }
            for (const chunk of toolRetries) queueStreamChunk(chunk)
          })
        }
      })
    }

    const distanceFromMessageStackBottom = () => {
      const stack = messageStack.value
      if (!stack) return Number.POSITIVE_INFINITY
      return stack.scrollHeight - stack.scrollTop - stack.clientHeight
    }

    const syncScrollToBottomFlag = () => {
      const stack = messageStack.value
      if (!stack) return
      showScrollToBottom.value = distanceFromMessageStackBottom() > 96
    }

    const scrollMessagesToEnd = (behavior: ScrollBehavior = 'auto') => {
      void nextTick(() => {
        const stack = messageStack.value
        if (!stack) return
        stack.scrollTo({ top: stack.scrollHeight, behavior })
        // Re-measure after layout; smooth/auto both can leave a residual gap when height is still growing.
        window.requestAnimationFrame(() => {
          const live = messageStack.value
          if (!live) return
          if (distanceFromMessageStackBottom() > 8) {
            live.scrollTo({ top: live.scrollHeight, behavior: 'auto' })
          }
          syncScrollToBottomFlag()
        })
      })
    }

    /**
     * Wait until a user bubble for this send is in the message list (and preferably painted),
     * then pin to bottom. Avoids scrolling to the previous assistant bottom during the send→visible gap.
     */
    const waitForUserBubbleThenScrollToEnd = async (options: {
      readonly conversationId: string
      readonly previousLatestUserMessageId?: string
      readonly timeoutMs?: number
    }) => {
      const timeoutMs = options.timeoutMs ?? 2500
      const started = Date.now()
      const hasNewUserBubble = () => {
        if (selectedConversationId.value !== options.conversationId) return false
        for (let index = messages.value.length - 1; index >= 0; index -= 1) {
          const message = messages.value[index]
          if (!message || message.role !== 'user') continue
          if (!options.previousLatestUserMessageId) return true
          return message.id !== options.previousLatestUserMessageId
        }
        return false
      }

      while (!hasNewUserBubble() && Date.now() - started < timeoutMs) {
        await loadConversationMessages(options.conversationId, 'refresh')
        if (hasNewUserBubble()) break
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
      }

      // Prefer layout-stable pin over smooth (smooth often stops mid-way when height changes).
      scrollMessagesToEnd('auto')
      await nextTick()
      window.requestAnimationFrame(() => {
        scrollMessagesToEnd('auto')
        window.requestAnimationFrame(() => scrollMessagesToEnd('auto'))
      })
    }

    const updateMessageScrollState = () => {
      const stack = messageStack.value
      if (!stack) return
      showScrollToBottom.value = distanceFromMessageStackBottom() > 96
      // Auto-load older pages when the user scrolls near the top (keep manual button too).
      if (stack.scrollTop <= 72 && olderMessagesCursor.value && !olderMessagesLoading.value) {
        void loadOlderMessages()
      }
    }

    // Reload the current conversation after 3 deliberate scroll-down gestures near the bottom.
    // Desktop wheels fire many events per motion (smooth / free-spin wheels especially), so a
    // raw event counter over-triggers. Instead group events into gestures by gap + minimum
    // cumulative delta, and only count a gesture once it has scrolled a meaningful amount.
    // A reload gesture is one deliberate scroll action: wheel events accumulate until the wheel rests
    // for `bottomReloadGestureSettleMs`, then that motion settles as a single count. A fast multi-notch
    // spin (events a few ms apart) therefore settles once instead of counting once per 100px.
    const bottomReloadGestureSettleMs = 500
    const bottomReloadScrollMinPx = 100
    // The user's cadence: roughly 0.5–2s between scroll actions. Anything slower resets the sequence.
    const bottomReloadWheelWindowMs = 2500
    let bottomWheelReloadCount = 0
    let bottomWheelReloadDelta = 0
    let bottomWheelReloadLastAt = 0
    let bottomWheelSettleTimer: number | undefined
    // Mobile touch scrolling emits no wheel events, so track explicit pull-up gestures near the
    // bottom (touchstart → upward touchmove → touchend) and reload after 3 of them.
    let bottomTouchReloadCount = 0
    let bottomTouchStartY = 0
    let bottomTouchPulledUp = false
    let bottomTouchLastEndAt = 0
    const triggerConversationReload = () => {
      const conversationId = selectedConversationId.value
      if (!conversationId) return
      showReloadHint()
      void loadConversationMessages(conversationId, 'refresh')
    }
    const settleBottomWheelGesture = () => {
      bottomWheelSettleTimer = undefined
      if (bottomWheelReloadDelta >= bottomReloadScrollMinPx) {
        bottomWheelReloadDelta = 0
        bottomWheelReloadCount += 1
        if (bottomWheelReloadCount >= 3) {
          bottomWheelReloadCount = 0
          triggerConversationReload()
        }
      } else {
        bottomWheelReloadDelta = 0
      }
    }
    const handleMessageStackWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0 || distanceFromMessageStackBottom() > 96) {
        // Upward scroll or leaving the bottom resets the sequence and cancels a pending settle.
        bottomWheelReloadCount = 0
        bottomWheelReloadDelta = 0
        if (bottomWheelSettleTimer !== undefined) {
          window.clearTimeout(bottomWheelSettleTimer)
          bottomWheelSettleTimer = undefined
        }
        return
      }
      const now = performance.now()
      if (now - bottomWheelReloadLastAt > bottomReloadWheelWindowMs) {
        // The gap between scroll actions exceeded the cadence — start the sequence over.
        bottomWheelReloadCount = 0
        bottomWheelReloadDelta = 0
      }
      bottomWheelReloadLastAt = now
      const delta =
        event.deltaMode === 1 ? event.deltaY * 40 : event.deltaMode === 2 ? event.deltaY * 600 : event.deltaY
      bottomWheelReloadDelta += delta
      // Arm/restart the settle timer: once the wheel rests for `bottomReloadGestureSettleMs`, the
      // accumulated motion counts as one deliberate scroll action.
      if (bottomWheelSettleTimer !== undefined) window.clearTimeout(bottomWheelSettleTimer)
      bottomWheelSettleTimer = window.setTimeout(settleBottomWheelGesture, bottomReloadGestureSettleMs)
    }
    const handleMessageStackTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      if (distanceFromMessageStackBottom() > 96) bottomTouchReloadCount = 0
      bottomTouchStartY = touch.clientY
      bottomTouchPulledUp = false
    }
    const handleMessageStackTouchMove = (event: TouchEvent) => {
      if (bottomTouchPulledUp) return
      const touch = event.touches[0]
      if (!touch) return
      if (touch.clientY >= bottomTouchStartY) return
      if (distanceFromMessageStackBottom() > 96) return
      if (bottomTouchStartY - touch.clientY >= 20) bottomTouchPulledUp = true
    }
    const handleMessageStackTouchEnd = () => {
      if (!bottomTouchPulledUp) return
      bottomTouchPulledUp = false
      const now = performance.now()
      if (now - bottomTouchLastEndAt > 3000) bottomTouchReloadCount = 0
      bottomTouchLastEndAt = now
      bottomTouchReloadCount += 1
      if (bottomTouchReloadCount >= 3) {
        bottomTouchReloadCount = 0
        triggerConversationReload()
      }
    }

    const beginComposerResize = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startY = event.clientY
      const startHeight = composerHeight.value
      const onMove = (moveEvent: PointerEvent) => {
        composerHeight.value = Math.max(
          composerMinHeight,
          Math.min(composerMaxHeight, startHeight + startY - moveEvent.clientY)
        )
      }
      const onEnd = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd, { once: true })
    }

    const handleComposerResizeKeydown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Home') {
        composerHeight.value = composerDefaultHeight
        return
      }
      const delta = event.key === 'ArrowUp' ? composerKeyboardStep : -composerKeyboardStep
      composerHeight.value = Math.max(composerMinHeight, Math.min(composerMaxHeight, composerHeight.value + delta))
    }

    const toggleComposerHeight = () => {
      composerHeight.value = composerHeight.value === composerDefaultHeight ? composerMaxHeight : composerDefaultHeight
    }

    const addAttachments = (selectedFiles: FileList | null) => {
      if (!selectedFiles?.length) return
      const next = [...attachments.value]
      let totalBytes = next.reduce((sum, attachment) => sum + attachment.file.size, 0)
      for (const file of Array.from(selectedFiles)) {
        if (
          next.length >= maxAttachmentCount ||
          file.size > maxAttachmentBytes ||
          totalBytes + file.size > maxAttachmentsBytes
        ) {
          submitError.value = text('attachmentLimit')
          break
        }
        next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`, file })
        totalBytes += file.size
      }
      attachments.value = next
    }

    const buildSendAttachments = async (): Promise<readonly WebUiSendAttachment[]> =>
      Promise.all(
        attachments.value.map(async ({ file }) => ({
          name: file.name,
          mediaType: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: await readFileAsDataUrl(file)
        }))
      )

    const saveComposerDraft = () => {
      const conversationId = selectedConversationId.value
      if (!conversationId) return
      try {
        const key = composerDraftCacheKey(conversationId)
        if (composerText.value.trim()) {
          window.localStorage.setItem(key, composerText.value)
        } else {
          window.localStorage.removeItem(key)
        }
      } catch {
        // localStorage may be unavailable; silently skip persistence.
      }
    }
    const loadComposerDraft = (conversationId: string) => {
      try {
        composerText.value = window.localStorage.getItem(composerDraftCacheKey(conversationId)) ?? ''
      } catch {
        composerText.value = ''
      }
    }
    const pushInputHistory = (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const next = inputHistory.value.indexOf(trimmed) === -1 ? [...inputHistory.value, trimmed] : inputHistory.value
      inputHistory.value = next.slice(-maxInputHistory)
      inputHistoryIndex.value = -1
      inputHistoryDraft.value = ''
    }
    const navigateInputHistory = (direction: -1 | 1) => {
      const history = inputHistory.value
      const length = history.length
      if (!length) return
      if (direction === -1) {
        // ArrowUp: step toward older entries.
        if (inputHistoryIndex.value === -1) {
          inputHistoryDraft.value = composerText.value
          inputHistoryIndex.value = 0
        } else if (inputHistoryIndex.value < length - 1) {
          inputHistoryIndex.value += 1
        } else {
          return
        }
        composerText.value = history[inputHistoryIndex.value] ?? ''
      } else {
        // ArrowDown: step back toward the newest entry, then restore the draft.
        if (inputHistoryIndex.value === -1) return
        if (inputHistoryIndex.value > 0) {
          inputHistoryIndex.value -= 1
          composerText.value = history[inputHistoryIndex.value] ?? ''
        } else {
          inputHistoryIndex.value = -1
          composerText.value = inputHistoryDraft.value
        }
      }
    }
    const insertQuotedMessage = (message: WebUiMessageSnapshot) => {
      if (!message.content) return
      const quoted = message.content
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      composerText.value = composerText.value ? `${quoted}\n\n${composerText.value}` : quoted
      saveComposerDraft()
      void nextTick(() => {
        const textarea = composerTextarea.value
        if (!textarea) return
        textarea.focus()
        const position = textarea.value.length
        textarea.setSelectionRange(position, position)
      })
    }
    const focusComposerEnd = () => {
      void nextTick(() => {
        const textarea = composerTextarea.value
        if (!textarea) return
        textarea.focus()
        const position = textarea.value.length
        textarea.setSelectionRange(position, position)
      })
    }
    const insertSkillReference = (skill: WebUiSkill) => {
      // Prompt-level reference to an available skill (@mention style). Runtime
      // recognition is verified on-device; falls back to `/use <name>` if needed.
      const ref = `@${skill.name}${skill.description ? `: ${skill.description}` : ''}`
      composerText.value = composerText.value ? `${ref}\n\n${composerText.value}` : ref
      skillPickerOpen.value = false
      saveComposerDraft()
      focusComposerEnd()
    }
    const insertCompact = () => {
      // Compaction entry point: /compact is a runtime slash command executed as a
      // normal message by the agent session. Fill the composer and let the user
      // review / send.
      composerText.value = '/compact'
      saveComposerDraft()
      focusComposerEnd()
    }
    const searchKnowledge = async () => {
      const baseId = kbSelectedBaseId.value
      const query = kbSearchQuery.value.trim()
      const conversationId = selectedConversationId.value
      if (!baseId || !query || !conversationId) return
      kbSearching.value = true
      try {
        const response = await httpClient.getJson<WebUiKnowledgeSearchResponse>(
          `/api/agent-sessions/${encodeURIComponent(conversationId)}/knowledge-search?baseId=${encodeURIComponent(baseId)}&query=${encodeURIComponent(query)}`
        )
        if (selectedConversationId.value === conversationId) kbResults.value = response.results
      } catch {
        if (selectedConversationId.value === conversationId) kbResults.value = []
      } finally {
        kbSearching.value = false
      }
    }
    const insertKnowledgeReference = (result: WebUiKnowledgeSearchResult) => {
      const baseName =
        knowledgeBases.value.find((base) => base.id === kbSelectedBaseId.value)?.name || kbSelectedBaseId.value
      const title = result.title || baseName
      const snippet = (result.pageContent ?? '').slice(0, 400)
      const block = [`> 📚 ${title}`, ...snippet.split('\n').map((line) => `> ${line}`)].join('\n')
      composerText.value = composerText.value ? `${block}\n\n${composerText.value}` : block
      kbPickerOpen.value = false
      kbResults.value = []
      kbSearchQuery.value = ''
      saveComposerDraft()
      focusComposerEnd()
    }

    const submitMessage = async (options?: { force?: boolean }) => {
      const conversationId = selectedConversationId.value
      const messageText = composerText.value.trim()
      if (!conversationId || (!messageText && attachments.value.length === 0) || pendingToolApproval.value) return

      const finalizeSubmittedMessage = () => {
        pushInputHistory(messageText)
        composerText.value = ''
        attachments.value = []
        // The draft is consumed on send; drop the persisted copy for this session.
        try {
          window.localStorage.removeItem(composerDraftCacheKey(conversationId))
        } catch {
          // ignore
        }
      }

      // If assistant is currently streaming and not forced, queue the message instead of POSTing.
      if (activeRunConversationId.value === conversationId && !options?.force) {
        queuedFollowups.value = [
          ...queuedFollowups.value,
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: messageText }
        ]
        finalizeSubmittedMessage()
        return
      }

      submitError.value = ''
      activeRunConversationId.value = conversationId
      pendingSubmittedTurnCount.value += 1
      // New user turn: allow streaming again (previous seals must not block a new assistant message id,
      // but clear stale pending text from the last turn to avoid cross-turn re-append).
      clearPendingStreamChunks()
      const previousLatestUserMessageId = [...messages.value].reverse().find((message) => message.role === 'user')?.id
      try {
        const sendAttachments = await buildSendAttachments()
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/messages`, {
          text: messageText,
          attachments: sendAttachments,
          reasoningEffort: reasoningEffort.value,
          fastMode: fastModeEnabled.value ? true : undefined
        })
        finalizeSubmittedMessage()
        // One-shot pin after the user bubble is visible. Stream follow after this is only while
        // the viewport stays near the bottom; scrolling up stops auto-follow for this turn.
        await waitForUserBubbleThenScrollToEnd({
          conversationId,
          previousLatestUserMessageId
        })
        refreshSlashCommands(conversationId)
      } catch (error) {
        pendingSubmittedTurnCount.value = Math.max(0, pendingSubmittedTurnCount.value - 1)
        if (isAbortError(error)) {
          submitError.value = ''
          bridgeDetail.value = text('requestAborted')
          if (pendingSubmittedTurnCount.value === 0) activeRunConversationId.value = undefined
          return
        }
        submitError.value = error instanceof DOMException ? text('attachmentReadFailed') : localizedErrorMessage(error)
        if (pendingSubmittedTurnCount.value === 0) activeRunConversationId.value = undefined
      }
    }

    const flushQueuedFollowup = () => {
      if (queuedFollowups.value.length === 0 || activeRunConversationId.value) return
      const next = queuedFollowups.value[0]
      if (!next) return
      queuedFollowups.value = queuedFollowups.value.slice(1)
      composerText.value = next.text
      void submitMessage()
    }

    const steerQueuedFollowup = (id: string) => {
      const item = queuedFollowups.value.find((q) => q.id === id)
      if (!item) return
      queuedFollowups.value = queuedFollowups.value.filter((q) => q.id !== id)
      composerText.value = item.text
      void submitMessage({ force: true })
    }

    const removeQueuedFollowup = (id: string) => {
      queuedFollowups.value = queuedFollowups.value.filter((q) => q.id !== id)
    }

    const abortMessage = async () => {
      const conversationId = selectedConversationId.value
      if (!conversationId || activeRunConversationId.value !== conversationId) return

      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/abort`, {})
      } catch (error) {
        submitError.value = ''
        bridgeDetail.value = localizedErrorMessage(error)
        activeRunConversationId.value = undefined
        pendingSubmittedTurnCount.value = 0
      }
    }

    const toggleReadMessageAloud = (message: WebUiMessageSnapshot, startIndex = 0) => {
      if (!speechController.refreshSupport()) {
        showSpeechNotice(text('speechUnavailable'), message.id)
        return
      }
      if (message.status === 'pending') {
        showSpeechNotice(text('speechGeneratingBlocked'), message.id)
        return
      }
      if (!message.content.trim()) {
        showSpeechNotice(text('speechEmptyContent'), message.id)
        return
      }
      if (speechPanelPreferences.value.autoOpenPanel) {
        openSpeechPanel()
      }
      // Speak the rendered plain text (the same text the sentence spans were built from)
      // so `segmentIndex` aligns with the `data-sentence-index` on the DOM.
      const plainText = speechPlainTextCache.get(message.id) ?? message.content
      speechController.speak(message.id, plainText, language.value, startIndex)
    }

    const formatCompactNumber = (value: number): string => {
      try {
        return new Intl.NumberFormat(language.value, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      } catch {
        return String(value)
      }
    }

    /** Rough local token estimate (~4 characters per token), used only when the desktop reports no stats. */
    const estimateTextTokens = (text: string): number => Math.max(1, Math.round(text.length / 4))

    /**
     * Mirrors the desktop `getMessageModelTokensPerSecond`: prefers measured
     * runtime timing, falls back to legacy scalar timestamps.
     */
    const getMessageModelTokensPerSecond = (stats: WebUiMessageTokenStats): number | undefined => {
      if (stats.runtimeTiming) {
        const outputTokens = stats.measuredOutputTokens
        const durationMs = stats.generationDurationMs
        return outputTokens !== undefined && durationMs !== undefined && durationMs > 0
          ? outputTokens / (durationMs / 1000)
          : undefined
      }
      const completion = stats.timeCompletionMs
      if (completion === undefined || completion <= 0) return undefined
      const firstToken = Math.min(stats.timeFirstTokenMs ?? 0, completion)
      const generationDuration = completion - firstToken
      const outputTokens = stats.outputTokens
      return outputTokens !== undefined && outputTokens > 0 && generationDuration > 0
        ? outputTokens / (generationDuration / 1000)
        : undefined
    }

    const messageEstimatedTokenLabel = (message: WebUiMessageSnapshot): string | undefined => {
      if (!showEstimatedTokens.value || message.status === 'pending') return undefined
      // User turns surface real token usage when the desktop reported stats for them.
      if (message.role !== 'assistant') {
        if (!message.tokenStats) return undefined
        return text('estimatedTokens').replace('{{value}}', formatCompactNumber(message.tokenStats.totalTokens))
      }
      const tokens = message.tokenStats?.totalTokens ?? estimateTextTokens(message.content)
      const tokenLabel = text('estimatedTokens').replace('{{value}}', formatCompactNumber(tokens))
      const tokensPerSecond = message.tokenStats
        ? getMessageModelTokensPerSecond(message.tokenStats)
        : message.processingTimeMs
          ? tokens / (message.processingTimeMs / 1000)
          : undefined
      if (!(tokensPerSecond !== undefined && tokensPerSecond > 0)) return tokenLabel
      return `${tokenLabel} · ${text('estimatedTokensPerSecond').replace('{{value}}', tokensPerSecond.toFixed(1))}`
    }

    const downloadMessageMarkdown = (message: WebUiMessageSnapshot, includeReasoning: boolean) => {
      const lines: string[] = []
      if (includeReasoning && message.reasoning) {
        lines.push(
          message.reasoning
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n'),
          ''
        )
      }
      if (message.content) lines.push(message.content)
      const blob = new Blob([lines.join('\n').trim()], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `cherry-message-${message.id.slice(0, 8)}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    }

    const renderMessageActions = (message: WebUiMessageSnapshot) =>
      h('div', { class: 'message-actions' }, [
        message.content
          ? h(
              'button',
              {
                class: 'message-action-button',
                type: 'button',
                title: text('copy'),
                'aria-label': text('copy'),
                onClick: () => {
                  void copyText(message.content).then(() => showCopiedHint(text('copy')))
                }
              },
              renderActionIcon('copy')
            )
          : undefined,
        message.content
          ? h('span', { class: 'message-action-wrap' }, [
              speechNotice.value?.messageId === message.id
                ? h('span', { class: 'speech-notice', role: 'status' }, speechNotice.value.message)
                : undefined,
              h(
                'button',
                {
                  class: [
                    'message-action-button',
                    {
                      'message-action-button-active': isReadingMessage(message.id),
                      'message-action-button-unsupported': !speechController.isSupported
                    }
                  ],
                  type: 'button',
                  disabled: message.status === 'pending' || !message.content.trim(),
                  title: speechController.isSupported
                    ? isReadingMessage(message.id)
                      ? text('stopReading')
                      : text('readAloud')
                    : text('speechUnavailable'),
                  'aria-label': isReadingMessage(message.id) ? text('stopReading') : text('readAloud'),
                  'aria-pressed': isReadingMessage(message.id) ? 'true' : 'false',
                  onClick: () => toggleReadMessageAloud(message)
                },
                renderActionIcon(isReadingMessage(message.id) ? 'stop' : 'volume')
              )
            ])
          : undefined,
        h(
          'button',
          {
            class: ['message-action-button', 'message-delete-button'],
            type: 'button',
            disabled: activeRunConversationId.value === selectedConversationId.value,
            title: text('delete'),
            'aria-label': text('delete'),
            onClick: () => openDeleteMessage(message.id)
          },
          h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
            h('path', { d: 'M3 6h18' }),
            h('path', { d: 'M8 6V4h8v2' }),
            h('path', { d: 'm19 6-1 14H6L5 6' }),
            h('path', { d: 'M10 11v5' }),
            h('path', { d: 'M14 11v5' })
          ])
        ),
        message.role !== 'user' && message.content
          ? h('span', { class: 'message-action-wrap' }, [
              h(
                'button',
                {
                  class: [
                    'message-action-button',
                    { 'message-action-button-active': moreMenuMessageId.value === message.id }
                  ],
                  type: 'button',
                  title: text('moreActions'),
                  'aria-label': text('moreActions'),
                  'aria-expanded': moreMenuMessageId.value === message.id,
                  'aria-haspopup': 'menu',
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation()
                    moreMenuMessageId.value = moreMenuMessageId.value === message.id ? null : message.id
                  }
                },
                renderActionIcon('more')
              ),
              moreMenuMessageId.value === message.id
                ? h('div', { class: 'message-more-menu', role: 'menu' }, [
                    h(
                      'button',
                      {
                        class: 'message-more-menu-item',
                        type: 'button',
                        role: 'menuitem',
                        onClick: () => {
                          moreMenuMessageId.value = null
                          multiSelectMode.value = true
                        }
                      },
                      [h('span', { class: 'message-more-menu-item-label' }, text('multiSelectMode'))]
                    ),
                    h('div', { class: 'message-more-menu-separator', role: 'separator' }),
                    message.content
                      ? h(
                          'button',
                          {
                            class: 'message-more-menu-item',
                            type: 'button',
                            role: 'menuitem',
                            onClick: () => {
                              moreMenuMessageId.value = null
                              insertQuotedMessage(message)
                            }
                          },
                          [h('span', { class: 'message-more-menu-item-label' }, text('quote'))]
                        )
                      : undefined,
                    h(
                      'button',
                      {
                        class: 'message-more-menu-item',
                        type: 'button',
                        role: 'menuitem',
                        onClick: () => {
                          moreMenuMessageId.value = null
                          downloadMessageMarkdown(message, false)
                        }
                      },
                      [h('span', { class: 'message-more-menu-item-label' }, text('saveMessage'))]
                    ),
                    h(
                      'button',
                      {
                        class: 'message-more-menu-item',
                        type: 'button',
                        role: 'menuitem',
                        onClick: () => {
                          moreMenuMessageId.value = null
                          downloadMessageMarkdown(message, false)
                        }
                      },
                      [h('span', { class: 'message-more-menu-item-label' }, text('exportMarkdown'))]
                    ),
                    h(
                      'button',
                      {
                        class: 'message-more-menu-item',
                        type: 'button',
                        role: 'menuitem',
                        onClick: () => {
                          moreMenuMessageId.value = null
                          downloadMessageMarkdown(message, true)
                        }
                      },
                      [h('span', { class: 'message-more-menu-item-label' }, text('exportMarkdownReason'))]
                    ),
                    h(
                      'button',
                      {
                        class: 'message-more-menu-item',
                        type: 'button',
                        role: 'menuitem',
                        onClick: () => {
                          moreMenuMessageId.value = null
                          void copyText(message.content).then(() => showCopiedHint(text('copyPlainText')))
                        }
                      },
                      [h('span', { class: 'message-more-menu-item-label' }, text('copyPlainText'))]
                    )
                  ])
                : undefined
            ])
          : undefined
      ])

    const renderQueuedFollowupDock = () => {
      if (!queuedFollowups.value.length) return undefined
      return h(
        'div',
        { class: 'queued-followup-dock' },
        queuedFollowups.value.map((item) =>
          h('div', { class: 'queued-followup-item', key: item.id }, [
            h('span', { class: 'queued-followup-text' }, item.text),
            h(
              'button',
              {
                class: 'queued-followup-steer',
                type: 'button',
                title: '引导',
                onClick: () => steerQueuedFollowup(item.id)
              },
              [h('span', { class: 'queued-followup-label' }, '引导')]
            ),
            h(
              'button',
              {
                class: 'queued-followup-cancel',
                type: 'button',
                title: text('delete'),
                onClick: () => removeQueuedFollowup(item.id)
              },
              [h('span', { class: 'queued-followup-label' }, text('delete'))]
            )
          ])
        )
      )
    }

    const copyText = async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        return
      } catch {
        const fallback = document.createElement('textarea')
        fallback.value = value
        fallback.setAttribute('readonly', 'true')
        fallback.style.position = 'fixed'
        fallback.style.top = '-1000px'
        fallback.style.opacity = '0'
        document.body.appendChild(fallback)
        fallback.select()
        document.execCommand('copy')
        fallback.remove()
      }
    }

    const openDeleteMessage = (messageId: string) => {
      if (activeRunConversationId.value === selectedConversationId.value) return
      deleteMessageId.value = messageId
      messageDeleteState.value = 'idle'
      messageDeleteError.value = ''
    }

    const closeDeleteMessage = () => {
      if (messageDeleteState.value === 'deleting') return
      deleteMessageId.value = undefined
      messageDeleteState.value = 'idle'
      messageDeleteError.value = ''
    }

    const confirmDeleteMessage = async () => {
      const conversationId = selectedConversationId.value
      const messageId = deleteMessageId.value
      if (!conversationId || !messageId || messageDeleteState.value === 'deleting') return
      if (activeRunConversationId.value === conversationId) return

      messageDeleteState.value = 'deleting'
      messageDeleteError.value = ''
      try {
        await httpClient.deleteJson(
          `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`
        )
        messages.value = messages.value.filter((message) => message.id !== messageId)
        contextUsage.value = null
        deleteMessageId.value = undefined
        messageDeleteState.value = 'idle'
        messageLoadMessage.value = messages.value.length ? '' : text('emptyConversation')
        await Promise.all([loadConversationMessages(conversationId, 'refresh'), loadConversations()])
        refreshComposerInfo(conversationId)
      } catch (error) {
        messageDeleteState.value = 'error'
        messageDeleteError.value = localizedErrorMessage(error)
      }
    }

    const loadWebUiPreferences = async () => {
      try {
        const preferences = await httpClient.getJson<WebUiPreferencesResponse>('/api/webui/preferences')
        showEstimatedTokens.value = preferences.showEstimatedTokens
        thoughtAutoCollapse.value = preferences.thoughtAutoCollapse ?? true
        chatInputPinnedTools.value = preferences.chatInputPinnedTools ?? []
        agentInputPinnedTools.value = preferences.agentInputPinnedTools ?? []
      } catch {
        showEstimatedTokens.value = false
        thoughtAutoCollapse.value = true
        chatInputPinnedTools.value = []
        agentInputPinnedTools.value = []
      }
    }

    /** Persist updated pinned tool order back to the desktop preference. */
    const savePinnedTools = async (pinnedIds: readonly string[]) => {
      chatInputPinnedTools.value = pinnedIds
      try {
        await httpClient.putJson('/api/webui/preferences', { chatInputPinnedTools: pinnedIds })
      } catch {
        // silently ignore — the local state is already updated for the session.
      }
    }

    /**
     * One row of the composer tool launcher, mirroring the desktop
     * `QuickPanelListItem` shape used by `composer/quickPanel/unifiedPanel.ts`.
     */
    type QuickPanelEntry = {
      readonly id: string
      readonly label: string
      readonly description?: string
      readonly icon?: ComposerToolIconName
      readonly suffix?: string
      /** Drills into a submenu instead of firing an action. */
      readonly isMenu?: boolean
      readonly disabled?: boolean
      readonly section: 'primary-tools' | 'commands' | 'resources'
      readonly action?: () => void
    }

    /** Close the panel and reset its transient search / cursor / submenu state. */
    const closeQuickPanel = () => {
      quickPanelOpen.value = false
      quickPanelQuery.value = ''
      quickPanelActiveIndex.value = 0
      quickPanelSubmenu.value = null
    }

    /** Clear every other composer popover so only one surface is open at a time. */
    const closeOtherComposerPopovers = () => {
      modelPickerOpen.value = false
      reasoningPickerOpen.value = false
      permissionModePickerOpen.value = false
      agentPickerOpen.value = false
      workspacePickerOpen.value = false
      skillPickerOpen.value = false
      kbPickerOpen.value = false
    }

    /**
     * Full launcher catalog, in desktop section order:
     * primary tools → slash commands → resources (skills / knowledge bases).
     *
     * Pinned tools are NOT removed from the list (the desktop keeps them
     * reachable); they render with a "pinned" badge instead so the panel stays
     * a launcher rather than a pin/unpin toggle board.
     */
    const quickPanelEntries = computed<readonly QuickPanelEntry[]>(() => {
      const entries: QuickPanelEntry[] = [
        {
          id: 'attachment',
          label: text('attachmentPending'),
          description: text('quickPanelAttachmentDescription'),
          icon: 'attachment',
          section: 'primary-tools',
          disabled: attachments.value.length >= maxAttachmentCount,
          action: () => attachmentInput.value?.click()
        },
        {
          id: 'knowledge',
          label: text('knowledgeSearch'),
          description: knowledgeBases.value.length
            ? text('quickPanelKnowledgeDescription')
            : text('quickPanelKnowledgeEmpty'),
          icon: 'knowledge',
          section: 'primary-tools',
          disabled: !selectedConversation.value || !knowledgeBases.value.length,
          action: () => {
            closeOtherComposerPopovers()
            kbPickerOpen.value = true
          }
        },
        {
          id: 'skill',
          label: text('skillLauncher'),
          description: skills.value.length ? text('quickPanelSkillDescription') : text('skillLauncherEmpty'),
          icon: 'skill',
          section: 'primary-tools',
          isMenu: true,
          disabled: !selectedConversation.value || !skills.value.length,
          action: () => {
            quickPanelSubmenu.value = 'skill'
            quickPanelQuery.value = ''
            quickPanelActiveIndex.value = 0
          }
        },
        {
          id: 'compact',
          label: text('compact'),
          description: text('compactDescription'),
          icon: 'compact',
          section: 'primary-tools',
          disabled: !selectedConversation.value,
          action: () => {
            closeOtherComposerPopovers()
            insertCompact()
          }
        },
        {
          id: 'fastMode',
          label: text('fastMode'),
          description: text('fastModeDescription'),
          icon: 'fastMode',
          section: 'primary-tools',
          suffix: fastModeEnabled.value ? text('on') : undefined,
          disabled: !selectedConversation.value || !fastModeSupported.value,
          action: () => {
            closeOtherComposerPopovers()
            toggleFastMode()
          }
        },
        {
          id: 'newConversation',
          label: text('newConversationTool'),
          description: text('quickPanelNewConversationDescription'),
          icon: 'newConversation',
          section: 'primary-tools',
          action: () => void openNewConversation()
        },
        {
          id: 'thinking',
          label: text('thinkingPending'),
          description: reasoningConfigurable.value ? reasoningLabel.value : text('thinkingUnavailable'),
          icon: 'thinking',
          section: 'primary-tools',
          disabled: !reasoningConfigurable.value,
          action: () => {
            closeOtherComposerPopovers()
            reasoningPickerOpen.value = true
          }
        },
        {
          id: 'permission',
          label: text('permissionMode'),
          description: permissionModeLabel.value,
          icon: 'permission',
          section: 'primary-tools',
          disabled: !selectedConversation.value,
          action: () => {
            closeOtherComposerPopovers()
            permissionModePickerOpen.value = true
          }
        },
        {
          id: 'customToolbar',
          label: text('customToolbar'),
          description: text('customToolbarDescription'),
          section: 'primary-tools',
          isMenu: true,
          action: () => {
            quickPanelSubmenu.value = 'customToolbar'
            quickPanelQuery.value = ''
            quickPanelActiveIndex.value = 0
          }
        }
      ]

      // Slash commands become launcher rows too — selecting one prefills the composer.
      for (const command of slashCommands.value) {
        entries.push({
          id: `command:${command.name}`,
          label: `/${command.name}`,
          ...(command.description ? { description: command.description } : {}),
          section: 'commands',
          action: () => {
            composerText.value = `/${command.name} `
            composerTextarea.value?.focus()
          }
        })
      }

      return entries
    })

    /** Rows of the open submenu — skill drill-down or custom-toolbar pin toggles. */
    const quickPanelSubmenuEntries = computed<readonly QuickPanelEntry[]>(() => {
      if (quickPanelSubmenu.value === 'skill') {
        return skills.value.map((skill) => ({
          id: `skill:${skill.name}`,
          label: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
          section: 'resources' as const,
          action: () => {
            composerText.value = `${composerText.value}${composerText.value && !composerText.value.endsWith(' ') ? ' ' : ''}/${skill.name} `
            composerTextarea.value?.focus()
          }
        }))
      }

      if (quickPanelSubmenu.value === 'customToolbar') {
        const pinableTools: Array<{ id: string; labelKey: TextKey }> = [
          { id: 'skill', labelKey: 'skillLauncher' },
          { id: 'knowledge', labelKey: 'knowledgeSearch' },
          { id: 'compact', labelKey: 'compact' },
          { id: 'fastMode', labelKey: 'fastMode' }
        ]
        return pinableTools.map((tool) => ({
          id: `pin:${tool.id}`,
          label: text(tool.labelKey),
          suffix: chatInputPinnedTools.value.includes(tool.id) ? text('quickPanelPinned') : undefined,
          section: 'resources' as const,
          action: () => {
            const current = chatInputPinnedTools.value
            if (current.includes(tool.id)) {
              void savePinnedTools(current.filter((id) => id !== tool.id))
            } else {
              void savePinnedTools([...current, tool.id])
            }
          }
        }))
      }

      return []
    })

    /**
     * Case-insensitive substring match over label + description, matching the
     * desktop `filterUnifiedQuickPanelItems` behaviour minus its pinyin passes
     * (the web build has no tiny-pinyin dependency).
     */
    const quickPanelVisibleEntries = computed<readonly QuickPanelEntry[]>(() => {
      const source = quickPanelSubmenu.value ? quickPanelSubmenuEntries.value : quickPanelEntries.value
      const query = quickPanelQuery.value.trim().toLowerCase()
      if (!query) return source
      return source.filter((entry) => `${entry.label} ${entry.description ?? ''}`.toLowerCase().includes(query))
    })

    /** Run a launcher row, honouring `disabled` and submenu drill-down. */
    const activateQuickPanelEntry = (entry: QuickPanelEntry) => {
      if (entry.disabled) return
      entry.action?.()
      // Submenu rows keep the panel open so the user can pick from the drill-down.
      if (!entry.isMenu) closeQuickPanel()
    }

    /**
     * Keyboard model copied from the desktop panel footer hint:
     * ▲▼ move, Ctrl+▲▼ page, Tab/Enter confirm, Esc closes (or exits a submenu).
     */
    const handleQuickPanelKeydown = (event: KeyboardEvent) => {
      const entries = quickPanelVisibleEntries.value
      const pageSize = 5
      if (event.key === 'Escape') {
        event.preventDefault()
        if (quickPanelSubmenu.value) {
          quickPanelSubmenu.value = null
          quickPanelQuery.value = ''
          quickPanelActiveIndex.value = 0
          return
        }
        closeQuickPanel()
        return
      }
      if (!entries.length) return
      const move = (delta: number) => {
        event.preventDefault()
        const next = quickPanelActiveIndex.value + delta
        quickPanelActiveIndex.value = Math.max(0, Math.min(entries.length - 1, next))
      }
      if (event.key === 'ArrowDown') return move(event.ctrlKey ? pageSize : 1)
      if (event.key === 'ArrowUp') return move(event.ctrlKey ? -pageSize : -1)
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const entry = entries[Math.min(quickPanelActiveIndex.value, entries.length - 1)]
        if (entry) activateQuickPanelEntry(entry)
      }
    }

    const startAuthenticatedSession = () => {
      void loadWebUiPreferences()
      void refreshHealth()
      void loadConversations()
      void loadAgents().catch(() => {
        agents.value = []
      })
      void loadModels().catch(() => {
        modelGroups.value = []
      })
      sseClient.connect()
      if (!healthTimer) healthTimer = window.setInterval(() => void refreshHealth(), 15_000)
    }

    const applyThemeMode = () => {
      document.documentElement.dataset.webuiTheme = themeMode.value
    }

    const toggleThemeMode = () => {
      themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark'
      applyThemeMode()
    }

    const loadAuthStatus = async () => {
      try {
        const status = await httpClient.getJson<WebUiAuthStatusResponse>('/api/auth/status')
        if (!languageOverride.value) language.value = normalizeLanguage(status.language)
        userName.value = status.userName?.trim() ?? ''
        authRequired.value = status.authRequired
        const authenticated = !status.authRequired || status.authenticated === true
        isAuthenticated.value = authenticated
        bridgeDetail.value = text('checkingBridge')
        serviceStartedAt.value = text('unavailable')
        if (authenticated) startAuthenticatedSession()
      } catch (error) {
        bridgeState.value = 'offline'
        bridgeDetail.value = localizedErrorMessage(error)
        serviceStartedAt.value = text('unavailable')
      }
    }

    const verifyAuthKey = async () => {
      const key = authKeyDraft.value.trim()
      if (!key) {
        authError.value = text('invalidKey')
        return
      }

      httpClient.setAuthKey(key)
      sseClient.setAuthKey(key)
      try {
        await refreshHealth()
        // Best-effort: persist (or clear) the remember-verification cookie via the desktop bridge.
        try {
          await httpClient.postJson<{ ok: boolean }>('/api/auth/session', {
            key,
            rememberSeconds: rememberVerify.value === 'off' ? 0 : REMEMBER_VERIFY_SECONDS[rememberVerify.value]
          })
        } catch {
          // Remember-verification is optional — the access key itself was already validated above.
        }
        authError.value = ''
        isAuthenticated.value = true
        startAuthenticatedSession()
      } catch {
        httpClient.setAuthKey('')
        sseClient.setAuthKey('')
        authError.value = text('invalidKey')
        isAuthenticated.value = false
      }
    }

    const unsubscribeSync = sseClient.subscribe<{
      conversationId?: string
      reason?: string
      messageId?: string
    }>('sync', ({ data }) => refreshFromDesktopSync(data?.reason, data?.conversationId, data?.messageId))
    const unsubscribeChunk = sseClient.subscribe<WebUiChunkPayload>('chunk', ({ data }) => {
      if (data && typeof data === 'object') queueStreamChunk(data)
    })
    const unsubscribeDone = sseClient.subscribe<{ conversationId?: string; messageId?: string }>('done', ({ data }) => {
      const conversationId = data?.conversationId
      pendingSubmittedTurnCount.value = Math.max(0, pendingSubmittedTurnCount.value - 1)
      if (pendingSubmittedTurnCount.value === 0 && conversationId === activeRunConversationId.value) {
        activeRunConversationId.value = undefined
      }
      if (conversationId && conversationId === selectedConversationId.value) {
        // Capture before refresh: only pin if the user was still near the bottom.
        const wasNearBottom = !showScrollToBottom.value
        refreshMessagesAfterStream(conversationId, data?.messageId)
        // Final pin only when still following; do not yank users who scrolled up to read.
        if (wasNearBottom) scrollMessagesToEnd('auto')
        // Auto-drain the next queued follow-up once the stream fully settles.
        if (pendingSubmittedTurnCount.value === 0) flushQueuedFollowup()
      } else {
        sealStreamMessage(data?.messageId)
      }
    })
    const unsubscribeError = sseClient.subscribe<{
      conversationId?: string
      message?: string
      messageId?: string
    }>('error', ({ data }) => {
      sealStreamMessage(data?.messageId)
      if (data?.conversationId === activeRunConversationId.value) {
        const message = localizedSseErrorMessage(data.message)
        if (isAbortSseMessage(data.message)) {
          submitError.value = ''
          bridgeDetail.value = message
        } else {
          submitError.value = message
        }
        pendingSubmittedTurnCount.value = Math.max(0, pendingSubmittedTurnCount.value - 1)
        if (pendingSubmittedTurnCount.value === 0) activeRunConversationId.value = undefined
      }
    })

    onMounted(() => {
      applyThemeMode()
      processElapsedTimer = window.setInterval(() => {
        if (isCurrentlyStreaming.value) processElapsedTick.value += 1
      }, 1000)
      void loadAuthStatus()
      refreshSpeechVoices()
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoices)
      }
    })

    watch(selectedModel, () => {
      if (!reasoningOptions.value.includes(reasoningEffort.value)) reasoningEffort.value = 'default'
      reasoningPickerOpen.value = false
    })

    watch(selectedConversationId, (nextId, previousId) => {
      speechController.stop()
      // Persist the current session's draft, then restore the newly-selected session's draft.
      if (previousId) saveComposerDraft()
      if (nextId) loadComposerDraft(nextId)
    })

    watch(workspaceFileSearch, (value) => {
      if (workspaceFileSearchTimer !== undefined) window.clearTimeout(workspaceFileSearchTimer)
      workspaceFileSearchTimer = undefined
      workspaceSearchEntries.value = []
      if (!statusPanelOpen.value || rightPanelTab.value !== 'files') return
      const query = value.trim()
      if (!query) {
        void loadWorkspaceDirectory()
        return
      }
      workspaceFileSearchTimer = window.setTimeout(() => {
        workspaceFileSearchTimer = undefined
        void loadWorkspaceSearch(query)
      }, 200)
    })

    watch([statusPreviewOpen, statusPanelOpen, activeRunConversationId, selectedConversationId], () => {
      if (contextUsageTimer !== undefined) window.clearInterval(contextUsageTimer)
      contextUsageTimer = undefined
      const conversationId = selectedConversationId.value
      if (
        !conversationId ||
        activeRunConversationId.value !== conversationId ||
        (!statusPreviewOpen.value && !statusPanelOpen.value)
      ) {
        return
      }
      refreshComposerInfo(conversationId)
      contextUsageTimer = window.setInterval(() => refreshComposerInfo(conversationId), 1200)
    })

    onBeforeUnmount(() => {
      clearStatusPreviewTimers()
      saveComposerDraft()
      if (bottomWheelSettleTimer !== undefined) window.clearTimeout(bottomWheelSettleTimer)
      if (workspaceFileSearchTimer !== undefined) window.clearTimeout(workspaceFileSearchTimer)
      releaseWorkspacePreview()
      if (healthTimer) window.clearInterval(healthTimer)
      if (contextUsageTimer) window.clearInterval(contextUsageTimer)
      if (processElapsedTimer !== undefined) window.clearInterval(processElapsedTimer)
      if (syncTimer) window.clearTimeout(syncTimer)
      if (streamRefreshTimer !== undefined) window.clearTimeout(streamRefreshTimer)
      if (chunkFrame !== undefined) window.cancelAnimationFrame(chunkFrame)
      clearPendingStreamChunks()
      sealedStreamMessageIds.clear()
      speechController.stop()
      unsubscribeSync()
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      sseClient.close()
      delete document.documentElement.dataset.webuiTheme
      compactHeaderMql.removeEventListener('change', onCompactHeaderChange)
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.removeEventListener('voiceschanged', refreshSpeechVoices)
      }
    })

    // Shared header selector option renderers — used by the desktop three-button row (Agent/Model/Workspace)
    // and by the compact mobile header (single button + grouped menu) so both stay in lockstep.
    const renderAgentPickerOptions = () =>
      agents.value.map((agent) =>
        h(
          'button',
          {
            class: [
              'chat-header-picker-option',
              { 'chat-header-picker-option-selected': agent.id === selectedConversation.value?.agentId }
            ],
            key: agent.id,
            type: 'button',
            role: 'option',
            'aria-selected': agent.id === selectedConversation.value?.agentId,
            disabled: sessionHasMessages.value,
            onClick: () => void updateSessionAgent(agent.id)
          },
          [
            h('span', { class: 'chat-header-picker-option-name' }, agent.name),
            agent.model
              ? h('span', { class: 'chat-header-picker-option-detail' }, stripModelNamePrefix(agent.model))
              : undefined
          ]
        )
      )
    const renderModelPickerOptions = () =>
      modelGroups.value.flatMap((group) => [
        h('p', { class: 'model-picker-group', key: `group-${group.id}` }, group.name),
        ...group.models.map((model) =>
          h(
            'button',
            {
              class: [
                'model-picker-option',
                { 'model-picker-option-selected': model.id === selectedAgent.value?.model }
              ],
              key: model.id,
              type: 'button',
              role: 'option',
              'aria-selected': model.id === selectedAgent.value?.model,
              onClick: () => {
                if (model.id === selectedAgent.value?.model) return
                if (messages.value.length > 0 && !skipModelSwitchConfirm.value) {
                  pendingModelSwitchTarget.value = model
                  modelPickerOpen.value = false
                  return
                }
                void updateSessionModel(model)
              }
            },
            [
              h('span', { class: 'model-picker-name' }, stripModelNamePrefix(model.name)),
              h('span', { class: 'model-picker-provider' }, model.group ?? model.providerId)
            ]
          )
        )
      ])
    const renderWorkspacePickerOptions = () => {
      if (workspacesLoading.value) {
        return [h('p', { class: 'chat-header-picker-placeholder' }, text('loadingConversations'))]
      }
      if (!workspaces.value.length) {
        return [h('p', { class: 'chat-header-picker-placeholder' }, text('workspaceSelectPlaceholder'))]
      }
      return [
        h(
          'button',
          {
            class: [
              'chat-header-picker-option',
              { 'chat-header-picker-option-selected': !selectedConversation.value?.workspaceId }
            ],
            key: '__system__',
            type: 'button',
            role: 'option',
            'aria-selected': !selectedConversation.value?.workspaceId,
            disabled: sessionHasMessages.value,
            onClick: () => void updateSessionWorkspace(null)
          },
          [h('span', { class: 'chat-header-picker-option-name' }, text('noProject'))]
        ),
        ...workspaces.value.map((ws) =>
          h(
            'button',
            {
              class: [
                'chat-header-picker-option',
                { 'chat-header-picker-option-selected': ws.id === selectedConversation.value?.workspaceId }
              ],
              key: ws.id,
              type: 'button',
              role: 'option',
              'aria-selected': ws.id === selectedConversation.value?.workspaceId,
              disabled: sessionHasMessages.value,
              onClick: () => void updateSessionWorkspace(ws.id)
            },
            [
              h('span', { class: 'chat-header-picker-option-name' }, ws.name),
              h('span', { class: 'chat-header-picker-option-detail' }, ws.path)
            ]
          )
        )
      ]
    }
    // Desktop header selector row: Agent / Model / Workspace as three independent pickers.
    const renderDesktopHeaderControls = () =>
      h('div', { class: 'chat-header-controls' }, [
        // Agent selector
        h('div', { class: 'chat-header-selector-wrap' }, [
          h(
            'button',
            {
              class: 'chat-header-selector-button',
              type: 'button',
              title: `${text('switchAgent')}: ${selectedAgentName.value ?? text('selectAgent')}`,
              'aria-label': text('switchAgent'),
              'aria-expanded': agentPickerOpen.value,
              disabled: agentUpdateState.value === 'updating' || sessionHasMessages.value,
              onClick: () => {
                agentPickerOpen.value = !agentPickerOpen.value
                modelPickerOpen.value = false
                workspacePickerOpen.value = false
              }
            },
            [
              h('span', { class: 'chat-header-selector-label' }, selectedAgentName.value ?? text('selectAgent')),
              h('span', { class: 'chat-header-selector-chevron' }, ' ▼')
            ]
          ),
          agentPickerOpen.value
            ? h('div', { class: 'chat-header-picker-menu', role: 'listbox' }, renderAgentPickerOptions())
            : undefined
        ]),
        // Model selector
        h('div', { class: 'chat-header-selector-wrap' }, [
          h(
            'button',
            {
              class: 'chat-header-selector-button',
              type: 'button',
              title: `${selectedAgentName.value ?? ''}: ${modelPickerLabel.value}`,
              'aria-label': text('model'),
              'aria-expanded': modelPickerOpen.value,
              disabled: !models.value.length || modelUpdateState.value === 'updating',
              onClick: () => {
                modelPickerOpen.value = !modelPickerOpen.value
                agentPickerOpen.value = false
                workspacePickerOpen.value = false
              }
            },
            [
              h(
                'span',
                { class: 'chat-header-selector-label' },
                modelUpdateState.value === 'updating' ? text('generating') : modelPickerLabel.value
              ),
              h('span', { class: 'chat-header-selector-chevron' }, ' ▼')
            ]
          ),
          modelPickerOpen.value
            ? h('div', { class: 'chat-header-picker-menu', role: 'listbox' }, renderModelPickerOptions())
            : undefined
        ]),
        // Workspace selector
        h('div', { class: 'chat-header-selector-wrap' }, [
          h(
            'button',
            {
              class: 'chat-header-selector-button',
              type: 'button',
              title: text('workspace'),
              'aria-label': text('workspace'),
              'aria-expanded': workspacePickerOpen.value,
              disabled: workspaceUpdateState.value === 'updating' || sessionHasMessages.value,
              onClick: () => {
                workspacePickerOpen.value = !workspacePickerOpen.value
                if (workspacePickerOpen.value && !workspaces.value.length) {
                  void loadWorkspaces()
                }
                agentPickerOpen.value = false
                modelPickerOpen.value = false
              }
            },
            [
              h(
                'span',
                { class: 'chat-header-selector-label' },
                selectedConversation.value?.workspaceLabel ?? text('workspace')
              ),
              h('span', { class: 'chat-header-selector-chevron' }, ' ▼')
            ]
          ),
          workspacePickerOpen.value
            ? h('div', { class: 'chat-header-picker-menu', role: 'listbox' }, renderWorkspacePickerOptions())
            : undefined
        ])
      ])
    // Compact mobile header: a single model trigger opens a grouped Agent/Model/Workspace menu.
    const renderCompactHeaderControls = () =>
      h('div', { class: 'chat-header-selector-wrap mobile-header-selector-wrap' }, [
        h(
          'button',
          {
            class: 'chat-header-selector-button mobile-header-selector-button',
            type: 'button',
            title: modelUpdateState.value === 'updating' ? text('generating') : modelPickerLabel.value,
            'aria-label': text('switchAgent'),
            'aria-expanded': compactHeaderPickerOpen.value,
            onClick: () => {
              compactHeaderPickerOpen.value = !compactHeaderPickerOpen.value
              agentPickerOpen.value = false
              modelPickerOpen.value = false
              workspacePickerOpen.value = false
            }
          },
          [
            h(
              'span',
              { class: 'chat-header-selector-label' },
              modelUpdateState.value === 'updating' ? text('generating') : modelPickerLabel.value
            ),
            h('span', { class: 'chat-header-selector-chevron' }, ' ▼')
          ]
        ),
        compactHeaderPickerOpen.value
          ? h('div', { class: 'chat-header-picker-menu mobile-header-picker-menu', role: 'menu' }, [
              h('section', { class: 'mobile-header-picker-group' }, [
                h('p', { class: 'mobile-header-picker-group-title' }, text('switchAgent')),
                renderAgentPickerOptions()
              ]),
              h('section', { class: 'mobile-header-picker-group' }, [
                h('p', { class: 'mobile-header-picker-group-title' }, text('model')),
                renderModelPickerOptions()
              ]),
              h('section', { class: 'mobile-header-picker-group' }, [
                h('p', { class: 'mobile-header-picker-group-title' }, text('workspace')),
                renderWorkspacePickerOptions()
              ])
            ])
          : undefined
      ])

    return () =>
      authRequired.value && !isAuthenticated.value
        ? h(AuthPanel, {
            modelValue: authKeyDraft.value,
            'onUpdate:modelValue': (value: string) => {
              authKeyDraft.value = value
            },
            rememberVerify: rememberVerify.value,
            'onUpdate:rememberVerify': (value: RememberVerifyOption) => {
              rememberVerify.value = value
            },
            error: authError.value,
            text: text,
            logoPath: webUiLogoPath,
            onVerify: () => void verifyAuthKey()
          })
        : h(
            'main',
            {
              class: [
                'webui-shell',
                {
                  'webui-shell-status-open': statusPanelOpen.value,
                  'webui-shell-files-open': statusPanelOpen.value && rightPanelTab.value === 'files',
                  'webui-shell-resizing': statusPanelResizing.value
                }
              ],
              style: statusPanelOpen.value ? { '--webui-right-panel-width': `${statusPanelWidth.value}px` } : undefined
            },
            [
              mobileSidebarOpen.value
                ? h('button', {
                    class: 'mobile-sidebar-backdrop',
                    type: 'button',
                    'aria-label': text('close'),
                    onClick: () => {
                      mobileSidebarOpen.value = false
                    }
                  })
                : undefined,
              h(
                'section',
                {
                  class: ['conversation-list', { 'conversation-list-open': mobileSidebarOpen.value }],
                  'aria-label': text('newConversation')
                },
                [
                  h('header', { class: 'panel-header' }, [
                    h('img', { class: 'brand-logo', src: webUiLogoPath, alt: 'Cherry Studio' }),
                    h('div', [h('p', { class: 'eyebrow' }, 'Cherry Studio'), h('h1', text('webui'))]),
                    h('div', { class: 'panel-actions' }, [
                      h('div', { class: 'language-menu-wrap' }, [
                        h(
                          'button',
                          {
                            class: 'panel-icon-button language-toggle-button',
                            type: 'button',
                            title: text('changeLanguage'),
                            'aria-label': text('changeLanguage'),
                            'aria-expanded': languagePickerOpen.value,
                            onClick: () => {
                              languagePickerOpen.value = !languagePickerOpen.value
                            }
                          },
                          renderLanguageIcon()
                        ),
                        languagePickerOpen.value
                          ? h(
                              'div',
                              { class: 'language-picker-menu', role: 'menu' },
                              webUiLanguages.map((item) =>
                                h(
                                  'button',
                                  {
                                    class: [
                                      'language-picker-option',
                                      { 'language-picker-option-selected': language.value === item.id }
                                    ],
                                    type: 'button',
                                    role: 'menuitemradio',
                                    'aria-checked': language.value === item.id,
                                    onClick: () => selectLanguage(item.id)
                                  },
                                  item.label
                                )
                              )
                            )
                          : undefined
                      ]),
                      h(
                        'button',
                        {
                          class: ['panel-icon-button', 'theme-toggle-button', `theme-toggle-button-${themeMode.value}`],
                          type: 'button',
                          title: themeToggleLabel.value,
                          'aria-label': themeToggleLabel.value,
                          onClick: toggleThemeMode
                        },
                        renderThemeIcon(themeMode.value)
                      )
                    ]),
                    h(
                      'button',
                      {
                        class: 'mobile-close-button',
                        type: 'button',
                        title: text('close'),
                        'aria-label': text('close'),
                        onClick: () => {
                          mobileSidebarOpen.value = false
                        }
                      },
                      '×'
                    )
                  ]),
                  h(
                    'button',
                    {
                      class: 'new-chat-button',
                      type: 'button',
                      onClick: () => void openNewConversation()
                    },
                    text('newConversation')
                  ),
                  h('div', { class: 'conversation-list-heading' }, [
                    h('p', { class: 'conversation-section-label' }, text('conversationHistory')),
                    conversationLoadMessage.value
                      ? h(
                          'p',
                          { class: ['empty-copy', `empty-copy-${conversationLoadState.value}`] },
                          conversationLoadMessage.value
                        )
                      : undefined
                  ]),
                  h(
                    'nav',
                    {
                      class: 'conversation-nav',
                      'aria-label': text('desktopSession'),
                      ref: conversationNav,
                      onScroll: updateConversationScrollState
                    },
                    [
                      ...conversationGroups.value.flatMap((group) => {
                        const collapsed = isWorkdirGroupCollapsed(group.id)
                        const createLabel =
                          group.kind === 'user' ? text('createInWorkspace') : text('createInNoProject')
                        const groupExpanded = expandedConversationGroupIds.value.has(group.id)
                        const totalCount = group.conversations.length
                        // Mirrors the desktop per-group "show more / collapse" footer button:
                        // no button while the group fits the default count, and expanded
                        // groups with more than the default can collapse back to it.
                        const groupHasMore = totalCount > conversationGroupDefaultVisibleCount
                        const groupCanCollapse = groupExpanded && groupHasMore
                        const renderConversationItem = (conversation: WebUiConversationSummary) =>
                          h(
                            'div',
                            {
                              key: conversation.id,
                              class: [
                                'conversation-item-wrap',
                                {
                                  'conversation-item-wrap-selected': conversation.id === selectedConversationId.value
                                }
                              ]
                            },
                            [
                              editingConversationId.value === conversation.id
                                ? h('div', { class: ['conversation-item', 'conversation-item-editing'] }, [
                                    h('input', {
                                      class: 'conversation-title-input',
                                      value: editingConversationTitle.value,
                                      autofocus: true,
                                      onInput: (event: Event) => {
                                        editingConversationTitle.value = (event.target as HTMLInputElement).value
                                      },
                                      onKeydown: (event: KeyboardEvent) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          void saveConversationTitle()
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault()
                                          closeEditConversation()
                                        }
                                      }
                                    }),
                                    h('span', { class: 'conversation-meta' }, [
                                      `${conversationAgentName(conversation.agentId)} · `,
                                      new Date(conversation.updatedAt).toLocaleString()
                                    ])
                                  ])
                                : h(
                                    'button',
                                    {
                                      type: 'button',
                                      class: [
                                        'conversation-item',
                                        {
                                          'conversation-item-selected': conversation.id === selectedConversationId.value
                                        }
                                      ],
                                      'aria-current':
                                        conversation.id === selectedConversationId.value ? 'page' : undefined,
                                      onClick: () => selectConversation(conversation.id)
                                    },
                                    [
                                      h('span', { class: 'conversation-title' }, conversation.title),
                                      h('span', { class: 'conversation-meta' }, [
                                        `${conversationAgentName(conversation.agentId)} · `,
                                        new Date(conversation.updatedAt).toLocaleString()
                                      ])
                                    ]
                                  ),
                              h('div', { class: 'conversation-actions' }, [
                                h(
                                  'button',
                                  {
                                    class: 'conversation-action-button',
                                    type: 'button',
                                    title: text('editTitle'),
                                    'aria-label': text('editTitle'),
                                    'aria-expanded': openConversationMenuId.value === conversation.id,
                                    disabled: conversationActionState.value === 'deleting',
                                    onClick: () => toggleConversationMenu(conversation.id)
                                  },
                                  conversationActionState.value === 'generating' &&
                                    conversationActionId.value === conversation.id
                                    ? h('span', {
                                        class: 'mini-spinner',
                                        'aria-hidden': 'true'
                                      })
                                    : renderActionIcon('more')
                                ),
                                openConversationMenuId.value === conversation.id
                                  ? h('div', { class: 'conversation-action-menu', role: 'menu' }, [
                                      h(
                                        'button',
                                        {
                                          class: 'conversation-action-menu-item',
                                          type: 'button',
                                          role: 'menuitem',
                                          disabled: conversationActionState.value === 'deleting',
                                          onClick: () => openEditConversation(conversation)
                                        },
                                        [renderActionIcon('edit'), h('span', text('editTitle'))]
                                      ),
                                      h(
                                        'button',
                                        {
                                          class: 'conversation-action-menu-item',
                                          type: 'button',
                                          role: 'menuitem',
                                          disabled:
                                            conversationActionState.value === 'generating' &&
                                            conversationActionId.value === conversation.id,
                                          onClick: () => void generateConversationTitle(conversation.id)
                                        },
                                        [renderActionIcon('sparkles'), h('span', text('generateTopicName'))]
                                      ),
                                      h(
                                        'button',
                                        {
                                          class: ['conversation-action-menu-item', 'conversation-action-menu-danger'],
                                          type: 'button',
                                          role: 'menuitem',
                                          disabled: activeRunConversationId.value === conversation.id,
                                          onClick: () => openDeleteConversation(conversation.id)
                                        },
                                        [renderActionIcon('trash'), h('span', text('deleteConversation'))]
                                      )
                                    ])
                                  : undefined
                              ])
                            ]
                          )
                        return [
                          h(
                            'div',
                            {
                              key: `header-${group.id}`,
                              class: [
                                'conversation-group',
                                {
                                  'conversation-group-collapsed': collapsed,
                                  'conversation-group-no-project': group.kind === 'no-project'
                                }
                              ]
                            },
                            [
                              h(
                                'div',
                                {
                                  class: 'conversation-group-header'
                                },
                                [
                                  h(
                                    'button',
                                    {
                                      type: 'button',
                                      class: 'conversation-group-toggle',
                                      title: collapsed ? text('expandGroup') : text('collapseGroup'),
                                      'aria-label': collapsed ? text('expandGroup') : text('collapseGroup'),
                                      'aria-expanded': !collapsed,
                                      onClick: () => toggleWorkdirGroupCollapsed(group.id)
                                    },
                                    [
                                      h(
                                        'span',
                                        {
                                          class: [
                                            'conversation-group-chevron',
                                            { 'conversation-group-chevron-collapsed': collapsed }
                                          ],
                                          'aria-hidden': 'true'
                                        },
                                        '▾'
                                      ),
                                      h(
                                        'span',
                                        {
                                          class: [
                                            'conversation-group-icon',
                                            {
                                              'conversation-group-icon-no-project': group.kind === 'no-project'
                                            }
                                          ],
                                          'aria-hidden': 'true'
                                        },
                                        group.kind === 'user' ? '📁' : '○'
                                      ),
                                      h('span', { class: 'conversation-group-label' }, group.label),
                                      h(
                                        'span',
                                        { class: 'conversation-group-count' },
                                        String(group.conversations.length)
                                      )
                                    ]
                                  ),
                                  h(
                                    'button',
                                    {
                                      type: 'button',
                                      class: 'conversation-group-create',
                                      title: createLabel,
                                      'aria-label': createLabel,
                                      onClick: (event: Event) => openNewConversationInGroup(group, event)
                                    },
                                    renderComposerToolIcon('newConversation')
                                  )
                                ]
                              ),
                              collapsed
                                ? undefined
                                : h('div', { class: 'conversation-group-items' }, [
                                    ...group.conversations
                                      .slice(0, conversationGroupDefaultVisibleCount)
                                      .map(renderConversationItem),
                                    ...(groupHasMore && !collapsed
                                      ? [
                                          h(
                                            'div',
                                            { class: 'conversation-group-footer' },
                                            h(
                                              'button',
                                              {
                                                class: [
                                                  'conversation-group-show-more-button',
                                                  { 'conversation-group-show-more-open': groupCanCollapse }
                                                ],
                                                type: 'button',
                                                'aria-expanded': groupExpanded,
                                                onClick: () => toggleConversationGroupExpanded(group.id)
                                              },
                                              [
                                                h(
                                                  'span',
                                                  {
                                                    class: 'conversation-group-show-more-chevron',
                                                    'aria-hidden': 'true'
                                                  },
                                                  renderActionIcon('down')
                                                ),
                                                h(
                                                  'span',
                                                  groupCanCollapse ? text('collapseGroupMore') : text('showMoreGroup')
                                                )
                                              ]
                                            )
                                          )
                                        ]
                                      : []),
                                    ...(groupExpanded
                                      ? group.conversations
                                          .slice(conversationGroupDefaultVisibleCount)
                                          .map(renderConversationItem)
                                      : [])
                                  ])
                            ]
                          )
                        ]
                      })
                    ]
                  ),
                  conversationActionError.value
                    ? h(
                        'p',
                        { class: 'composer-error conversation-action-error', role: 'alert' },
                        conversationActionError.value
                      )
                    : undefined
                ]
              ),
              h('section', { class: 'chat-stage', 'aria-label': text('desktopSession') }, [
                renderCopiedToast(),
                renderReloadToast(),
                h('header', { class: 'chat-header' }, [
                  h(
                    'button',
                    {
                      class: 'mobile-sidebar-button',
                      type: 'button',
                      title: text('desktopSession'),
                      'aria-label': text('desktopSession'),
                      'aria-expanded': mobileSidebarOpen.value,
                      onClick: () => {
                        mobileSidebarOpen.value = !mobileSidebarOpen.value
                      }
                    },
                    renderActionIcon('menu')
                  ),
                  h('div', { class: 'chat-header-titles' }, [
                    h('div', { class: 'eyebrow' }, [
                      // Agent / Model / Workspace selector buttons lead the header's first row.
                      // On ≤640px they collapse into one grouped selector menu (mobile-header-selector-wrap).
                      selectedConversation.value
                        ? isCompactHeader.value
                          ? renderCompactHeaderControls()
                          : renderDesktopHeaderControls()
                        : undefined,
                      // Composer/send/model errors surface right after the selector group (not under the input).
                      submitError.value
                        ? h(
                            'span',
                            {
                              class: 'chat-header-status-alert',
                              role: 'alert',
                              title: submitError.value
                            },
                            ` · ${submitError.value}`
                          )
                        : undefined,
                      conversationLoadState.value === 'loading' || messageLoadState.value === 'loading'
                        ? h(
                            'span',
                            { class: 'header-loading-state' },
                            ` · ${
                              messageLoadState.value === 'loading'
                                ? text('loadingMessages')
                                : text('loadingConversations')
                            }`
                          )
                        : undefined
                    ]),
                    h('h2', selectedConversation.value?.title ?? text('selectConversation'))
                  ]),
                  h('div', { class: 'mobile-chat-actions' }, [
                    h(
                      'div',
                      {
                        class: 'agent-status-shortcut-wrap',
                        onMouseenter: scheduleStatusPreviewOpen,
                        onMouseleave: scheduleStatusPreviewClose,
                        onFocusin: scheduleStatusPreviewOpen,
                        onFocusout: (event: FocusEvent) => {
                          if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
                            scheduleStatusPreviewClose()
                          }
                        }
                      },
                      [
                        h(
                          'button',
                          {
                            class: [
                              'agent-status-shortcut',
                              'agent-status-context-shortcut',
                              { 'agent-status-shortcut-active': statusPanelOpen.value }
                            ],
                            type: 'button',
                            disabled: !selectedConversation.value,
                            title: `${text('status')} · ${contextUsageLabel.value}`,
                            'aria-label': text('status'),
                            'aria-expanded': statusPanelOpen.value,
                            onClick: toggleStatusPanel
                          },
                          [
                            renderContextOrb(),
                            incompleteTaskCount.value > 0
                              ? h('span', { class: 'agent-status-shortcut-badge' }, String(incompleteTaskCount.value))
                              : undefined
                          ]
                        ),
                        statusPreviewOpen.value && !statusPanelOpen.value
                          ? h(
                              'section',
                              { class: 'agent-status-hover-card', role: 'dialog', 'aria-label': text('status') },
                              renderAgentStatusBody(agentStatus.value, true)
                            )
                          : undefined
                      ]
                    )
                  ])
                ]),
                h(
                  'div',
                  {
                    class: 'message-stack',
                    'aria-live': 'polite',
                    ref: messageStack,
                    onScroll: updateMessageScrollState,
                    onWheel: handleMessageStackWheel,
                    onClick: () => {
                      if (moreMenuMessageId.value) moreMenuMessageId.value = null
                    },
                    onTouchstart: handleMessageStackTouchStart,
                    onTouchmove: handleMessageStackTouchMove,
                    onTouchend: handleMessageStackTouchEnd
                  },
                  [
                    olderMessagesCursor.value
                      ? h(
                          'button',
                          {
                            class: 'load-older-button',
                            type: 'button',
                            disabled: olderMessagesLoading.value,
                            onClick: () => void loadOlderMessages()
                          },
                          olderMessagesLoading.value ? text('loadingOlder') : text('loadOlder')
                        )
                      : undefined,
                    messageLoadMessage.value ? h('p', { class: 'empty-copy' }, messageLoadMessage.value) : undefined,
                    showEmptyConversationGreeting.value
                      ? h('div', { class: 'conversation-greeting', role: 'status' }, [
                          h('p', { class: 'conversation-greeting-agent' }, selectedAgentName.value || text('agent')),
                          h('h3', { class: 'conversation-greeting-title' }, text('emptyConversationGreetingTitle')),
                          h('p', { class: 'conversation-greeting-subtitle' }, text('emptyConversationGreeting'))
                        ])
                      : undefined,
                    ...messages.value.map((message) => {
                      const estimatedTokenLabel = messageEstimatedTokenLabel(message)
                      return h(
                        'article',
                        {
                          class: [
                            'message',
                            message.role === 'user' ? 'user-message' : 'assistant-message',
                            { 'message-selected': selectedMessageIds.value.has(message.id) }
                          ],
                          key: message.id
                        },
                        [
                          multiSelectMode.value
                            ? h(
                                'label',
                                {
                                  class: 'message-checkbox-label',
                                  onClick: (event: MouseEvent) => {
                                    event.stopPropagation()
                                  }
                                },
                                [
                                  h('input', {
                                    type: 'checkbox',
                                    class: 'message-checkbox',
                                    checked: selectedMessageIds.value.has(message.id),
                                    onChange: () => {
                                      const next = new Set(selectedMessageIds.value)
                                      if (next.has(message.id)) {
                                        next.delete(message.id)
                                      } else {
                                        next.add(message.id)
                                      }
                                      selectedMessageIds.value = next
                                    }
                                  })
                                ]
                              )
                            : undefined,
                          h('header', { class: 'message-header' }, [
                            h('p', { class: 'message-role' }, messageHeaderLabel(message))
                          ]),
                          // New interleaved layout when ordered content blocks are available;
                          // falls back to the legacy process-block + content split otherwise.
                          ...(message.contentBlocks?.length
                            ? [
                                ...(renderMessageContentBlocks(message) ?? []),
                                renderCompactionAnchors(message),
                                message.attachments?.length
                                  ? h(
                                      'div',
                                      { class: 'message-attachments' },
                                      message.attachments.map((attachment) =>
                                        attachment.fileEntryId
                                          ? h(
                                              'button',
                                              {
                                                class: ['message-attachment', 'message-attachment-link'],
                                                type: 'button',
                                                title: attachment.mediaType || attachment.name,
                                                onClick: () => void openMessageAttachment(attachment)
                                              },
                                              attachment.name
                                            )
                                          : h(
                                              'span',
                                              {
                                                class: 'message-attachment',
                                                title: attachment.mediaType || attachment.name
                                              },
                                              attachment.name
                                            )
                                      )
                                    )
                                  : undefined
                              ]
                            : [
                                renderProcessDetails(message),
                                renderCompactionAnchors(message),
                                message.attachments?.length
                                  ? h(
                                      'div',
                                      { class: 'message-attachments' },
                                      message.attachments.map((attachment) =>
                                        attachment.fileEntryId
                                          ? h(
                                              'button',
                                              {
                                                class: ['message-attachment', 'message-attachment-link'],
                                                type: 'button',
                                                title: attachment.mediaType || attachment.name,
                                                onClick: () => void openMessageAttachment(attachment)
                                              },
                                              attachment.name
                                            )
                                          : h(
                                              'span',
                                              {
                                                class: 'message-attachment',
                                                title: attachment.mediaType || attachment.name
                                              },
                                              attachment.name
                                            )
                                      )
                                    )
                                  : undefined,
                                message.content
                                  ? h('div', {
                                      class: 'markdown-content',
                                      'data-message-id': message.id,
                                      ...(speechState.value.messageId === message.id && speechState.value.isSpeaking
                                        ? { 'data-reading': '' }
                                        : {}),
                                      onClick: handleMarkdownContentClick,
                                      innerHTML: renderSpeechMarkdown(message.content, message.id, {
                                        copyCodeLabel: text('copyCode'),
                                        downloadCodeLabel: text('downloadSource'),
                                        wrapLinesLabel: text('wrapLines')
                                      })
                                    })
                                  : message.toolCalls?.length
                                    ? undefined
                                    : h('span', {
                                        class: 'streaming-placeholder',
                                        'aria-label': text('generating')
                                      })
                              ]),
                          h('footer', { class: 'message-footer' }, [
                            h('span', { class: 'message-footer-meta' }, [
                              h(
                                'time',
                                { class: 'message-time', datetime: message.createdAt },
                                new Date(message.createdAt).toLocaleString()
                              ),
                              ...(estimatedTokenLabel
                                ? [h('span', { class: 'message-estimated-tokens' }, estimatedTokenLabel)]
                                : [])
                            ]),
                            renderMessageActions(message)
                          ])
                        ]
                      )
                    })
                  ]
                ),
                showScrollToBottom.value
                  ? h(
                      'button',
                      {
                        class: 'scroll-bottom-button',
                        type: 'button',
                        style: { bottom: `${composerHeight.value + (attachments.value.length ? 116 : 84)}px` },
                        title: text('backToBottom'),
                        'aria-label': text('backToBottom'),
                        onClick: () => scrollMessagesToEnd('smooth')
                      },
                      renderActionIcon('down')
                    )
                  : undefined,
                renderQueuedFollowupDock(),
                multiSelectMode.value && selectedMessageIds.value.size > 0
                  ? h('div', { class: 'multi-select-bar' }, [
                      h('span', { class: 'multi-select-bar-count' }, `${selectedMessageIds.value.size} selected`),
                      h('div', { class: 'multi-select-bar-actions' }, [
                        h(
                          'button',
                          {
                            class: 'multi-select-bar-button',
                            type: 'button',
                            onClick: () => {
                              const conversationId = selectedConversationId.value
                              if (!conversationId) return
                              const ids = [...selectedMessageIds.value]
                              void Promise.all(
                                ids.map((id) =>
                                  httpClient.deleteJson(
                                    `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(id)}`
                                  )
                                )
                              ).then(() => {
                                messages.value = messages.value.filter((m) => !ids.includes(m.id))
                                selectedMessageIds.value = new Set()
                                void loadConversationMessages(conversationId, 'refresh')
                                void loadConversations()
                              })
                            }
                          },
                          text('multiSelectDelete')
                        ),
                        h(
                          'button',
                          {
                            class: 'multi-select-bar-button',
                            type: 'button',
                            onClick: () => {
                              const ids = [...selectedMessageIds.value]
                              const selectedTexts = messages.value
                                .filter((m) => ids.includes(m.id))
                                .map((m) => m.content)
                                .join('\n\n---\n\n')
                              void navigator.clipboard.writeText(selectedTexts)
                            }
                          },
                          text('multiSelectCopy')
                        ),
                        h(
                          'button',
                          {
                            class: 'multi-select-bar-button',
                            type: 'button',
                            onClick: () => {
                              multiSelectMode.value = false
                              selectedMessageIds.value = new Set()
                            }
                          },
                          text('multiSelectExit')
                        )
                      ])
                    ])
                  : undefined,
                h('footer', { class: 'composer' }, [
                  renderPermissionRequestOverlay(),
                  h(
                    'div',
                    {
                      class: ['composer-surface', { 'composer-surface-dimmed': Boolean(pendingToolApproval.value) }]
                    },
                    [
                      h('input', {
                        class: 'attachment-input',
                        ref: attachmentInput,
                        type: 'file',
                        multiple: true,
                        onChange: (event: Event) => {
                          const input = event.target as HTMLInputElement
                          addAttachments(input.files)
                          input.value = ''
                        }
                      }),
                      attachments.value.length
                        ? h(
                            'div',
                            { class: 'attachment-strip' },
                            attachments.value.map((attachment) =>
                              h('span', { class: 'attachment-chip', key: attachment.id }, [
                                h(
                                  'span',
                                  { class: 'attachment-chip-name', title: attachment.file.name },
                                  attachment.file.name
                                ),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    title: text('removeAttachment'),
                                    'aria-label': `${text('removeAttachment')}: ${attachment.file.name}`,
                                    onClick: () => {
                                      attachments.value = attachments.value.filter((item) => item.id !== attachment.id)
                                    }
                                  },
                                  '×'
                                )
                              ])
                            )
                          )
                        : undefined,
                      h('textarea', {
                        ref: composerTextarea,
                        disabled: !selectedConversation.value || Boolean(pendingToolApproval.value),
                        value: composerText.value,
                        placeholder: pendingToolApproval.value
                          ? text('toolPermissionConfirmation')
                          : selectedConversation.value
                            ? text('sendPlaceholder')
                            : text('selectFirst'),
                        rows: 3,
                        style: { height: `${composerHeight.value}px` },
                        onInput: (event: Event) => {
                          composerText.value = (event.target as HTMLTextAreaElement).value
                          saveComposerDraft()
                        },
                        onKeydown: (event: KeyboardEvent) => {
                          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !isCoarsePointer) {
                            event.preventDefault()
                            void submitMessage()
                            return
                          }
                          // ↑/↓ browse input history only when the caret is at the very start/end,
                          // preserving normal caret movement inside multi-line text.
                          const target = event.target as HTMLTextAreaElement
                          if (event.key === 'ArrowUp' && !event.isComposing && target.selectionStart === 0) {
                            event.preventDefault()
                            navigateInputHistory(-1)
                          } else if (
                            event.key === 'ArrowDown' &&
                            !event.isComposing &&
                            target.selectionStart === composerText.value.length
                          ) {
                            event.preventDefault()
                            navigateInputHistory(1)
                          }
                        }
                      }),
                      h('div', {
                        class: 'composer-resize-handle',
                        role: 'separator',
                        tabindex: 0,
                        title: text('resizeComposer'),
                        'aria-label': text('resizeComposer'),
                        'aria-orientation': 'horizontal',
                        'aria-valuemin': composerMinHeight,
                        'aria-valuemax': composerMaxHeight,
                        'aria-valuenow': composerHeight.value,
                        onPointerdown: beginComposerResize,
                        onKeydown: handleComposerResizeKeydown,
                        onDblclick: () => {
                          composerHeight.value = composerDefaultHeight
                        }
                      }),
                      h(
                        'button',
                        {
                          class: 'composer-expand-control',
                          type: 'button',
                          title: text('resizeComposer'),
                          'aria-label': text('resizeComposer'),
                          'aria-pressed': composerHeight.value !== composerDefaultHeight,
                          onClick: toggleComposerHeight
                        },
                        renderActionIcon('resize', composerHeight.value !== composerDefaultHeight)
                      ),
                      h('div', { class: 'composer-toolbar' }, [
                        h('div', { class: 'composer-tools' }, [
                          h(
                            'button',
                            {
                              class: 'composer-tool-button',
                              type: 'button',
                              title: text('newConversationTool'),
                              'aria-label': text('newConversationTool'),
                              onClick: () => void openNewConversation()
                            },
                            renderComposerToolIcon('newConversation')
                          ),
                          h(
                            'button',
                            {
                              class: 'composer-tool-button',
                              type: 'button',
                              title: text('attachmentPending'),
                              'aria-label': text('attachmentPending'),
                              disabled: attachments.value.length >= maxAttachmentCount,
                              onClick: () => attachmentInput.value?.click()
                            },
                            renderComposerToolIcon('attachment')
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'composer-tool-button',
                                { 'composer-tool-button-active': reasoningEffort.value !== 'default' }
                              ],
                              type: 'button',
                              disabled: !reasoningConfigurable.value,
                              title: reasoningConfigurable.value
                                ? `${text('thinkingPending')}: ${reasoningLabel.value}`
                                : text('thinkingUnavailable'),
                              'aria-label': text('thinkingPending'),
                              'aria-expanded': reasoningPickerOpen.value,
                              onClick: () => {
                                reasoningPickerOpen.value = !reasoningPickerOpen.value
                                modelPickerOpen.value = false
                                permissionModePickerOpen.value = false
                                agentPickerOpen.value = false
                                workspacePickerOpen.value = false
                              }
                            },
                            renderComposerToolIcon('thinking')
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'composer-tool-button',
                                {
                                  'composer-tool-button-active': selectedPermissionMode.value !== 'default',
                                  'composer-tool-button-caution': selectedPermissionMode.value === 'bypassPermissions'
                                }
                              ],
                              type: 'button',
                              disabled: !selectedConversation.value || permissionModeUpdateState.value === 'updating',
                              title: `${text('permissionMode')}: ${permissionModeLabel.value}`,
                              'aria-label': text('permissionMode'),
                              'aria-expanded': permissionModePickerOpen.value,
                              onClick: () => {
                                permissionModePickerOpen.value = !permissionModePickerOpen.value
                                modelPickerOpen.value = false
                                reasoningPickerOpen.value = false
                                agentPickerOpen.value = false
                                workspacePickerOpen.value = false
                              }
                            },
                            renderComposerToolIcon('permission')
                          ),
                          // Conditionally rendered tools: only show when pinned in the quick panel.
                          chatInputPinnedTools.value.includes('skill')
                            ? h(
                                'button',
                                {
                                  class: [
                                    'composer-tool-button',
                                    { 'composer-tool-button-active': skillPickerOpen.value }
                                  ],
                                  type: 'button',
                                  disabled: !selectedConversation.value,
                                  title: text('skillLauncher'),
                                  'aria-label': text('skillLauncher'),
                                  'aria-expanded': skillPickerOpen.value,
                                  onClick: () => {
                                    skillPickerOpen.value = !skillPickerOpen.value
                                    modelPickerOpen.value = false
                                    reasoningPickerOpen.value = false
                                    permissionModePickerOpen.value = false
                                    agentPickerOpen.value = false
                                    workspacePickerOpen.value = false
                                    kbPickerOpen.value = false
                                  }
                                },
                                renderComposerToolIcon('skill')
                              )
                            : undefined,
                          chatInputPinnedTools.value.includes('knowledge')
                            ? h(
                                'button',
                                {
                                  class: [
                                    'composer-tool-button',
                                    { 'composer-tool-button-active': kbPickerOpen.value }
                                  ],
                                  type: 'button',
                                  disabled: !selectedConversation.value,
                                  title: text('knowledgeSearch'),
                                  'aria-label': text('knowledgeSearch'),
                                  'aria-expanded': kbPickerOpen.value,
                                  onClick: () => {
                                    kbPickerOpen.value = !kbPickerOpen.value
                                    modelPickerOpen.value = false
                                    reasoningPickerOpen.value = false
                                    permissionModePickerOpen.value = false
                                    agentPickerOpen.value = false
                                    workspacePickerOpen.value = false
                                    skillPickerOpen.value = false
                                  }
                                },
                                renderComposerToolIcon('knowledge')
                              )
                            : undefined,
                          chatInputPinnedTools.value.includes('compact')
                            ? h(
                                'button',
                                {
                                  class: 'composer-tool-button',
                                  type: 'button',
                                  disabled: !selectedConversation.value,
                                  title: text('compact'),
                                  'aria-label': text('compact'),
                                  onClick: () => {
                                    modelPickerOpen.value = false
                                    reasoningPickerOpen.value = false
                                    permissionModePickerOpen.value = false
                                    agentPickerOpen.value = false
                                    workspacePickerOpen.value = false
                                    skillPickerOpen.value = false
                                    kbPickerOpen.value = false
                                    insertCompact()
                                  }
                                },
                                renderComposerToolIcon('compact')
                              )
                            : undefined,
                          chatInputPinnedTools.value.includes('fastMode')
                            ? h(
                                'button',
                                {
                                  class: [
                                    'composer-tool-button',
                                    { 'composer-tool-button-active': fastModeEnabled.value }
                                  ],
                                  type: 'button',
                                  disabled: !selectedConversation.value || !fastModeSupported.value,
                                  title: text('fastModeDescription'),
                                  'aria-label': text('fastMode'),
                                  'aria-pressed': fastModeEnabled.value,
                                  onClick: () => {
                                    modelPickerOpen.value = false
                                    reasoningPickerOpen.value = false
                                    permissionModePickerOpen.value = false
                                    agentPickerOpen.value = false
                                    workspacePickerOpen.value = false
                                    skillPickerOpen.value = false
                                    kbPickerOpen.value = false
                                    toggleFastMode()
                                  }
                                },
                                renderComposerToolIcon('fastMode')
                              )
                            : undefined,
                          // Quick-panel trigger button (stays inside the toolbar).
                          h('div', { class: 'composer-tools-quick-panel-slot' }, [
                            h(
                              'button',
                              {
                                class: [
                                  'composer-tool-button',
                                  { 'composer-tool-button-active': quickPanelOpen.value }
                                ],
                                type: 'button',
                                title: text('quickPanel'),
                                'aria-label': text('quickPanel'),
                                'aria-expanded': quickPanelOpen.value,
                                onClick: () => {
                                  quickPanelOpen.value = !quickPanelOpen.value
                                  if (quickPanelOpen.value) {
                                    closeOtherComposerPopovers()
                                  } else {
                                    quickPanelQuery.value = ''
                                    quickPanelActiveIndex.value = 0
                                    quickPanelSubmenu.value = null
                                  }
                                }
                              },
                              h('span', { class: 'quick-panel-trigger-icon' }, '+')
                            )
                          ])
                        ]),
                        h(
                          'button',
                          {
                            class: [
                              'send-button',
                              {
                                'send-button-is-stop':
                                  isCurrentlyStreaming.value &&
                                  !composerText.value.trim() &&
                                  attachments.value.length === 0
                              }
                            ],
                            type: 'button',
                            disabled:
                              !selectedConversation.value ||
                              (Boolean(pendingToolApproval.value) && !isCurrentlyStreaming.value) ||
                              (!composerText.value.trim() &&
                                attachments.value.length === 0 &&
                                !isCurrentlyStreaming.value),
                            'aria-label':
                              isCurrentlyStreaming.value && !composerText.value.trim() && attachments.value.length === 0
                                ? text('stop')
                                : text('send'),
                            title:
                              isCurrentlyStreaming.value && !composerText.value.trim() && attachments.value.length === 0
                                ? text('stop')
                                : text('send'),
                            onClick: () => {
                              if (
                                isCurrentlyStreaming.value &&
                                !composerText.value.trim() &&
                                attachments.value.length === 0
                              ) {
                                void abortMessage()
                                return
                              }
                              void submitMessage()
                            }
                          },
                          renderActionIcon(
                            activeRunConversationId.value === selectedConversationId.value &&
                              !composerText.value.trim() &&
                              attachments.value.length === 0
                              ? 'stop'
                              : 'send'
                          )
                        )
                      ]),
                      reasoningPickerOpen.value
                        ? h(
                            'div',
                            { class: 'reasoning-picker-menu', role: 'listbox' },
                            reasoningOptions.value.map((option) =>
                              h(
                                'button',
                                {
                                  class: [
                                    'reasoning-picker-option',
                                    { 'reasoning-picker-option-selected': option === reasoningEffort.value }
                                  ],
                                  key: option,
                                  type: 'button',
                                  role: 'option',
                                  'aria-selected': option === reasoningEffort.value,
                                  onClick: () => {
                                    reasoningEffort.value = option
                                    reasoningPickerOpen.value = false
                                  }
                                },
                                text(
                                  (
                                    {
                                      default: 'reasoningDefault',
                                      none: 'reasoningNone',
                                      minimal: 'reasoningMinimal',
                                      low: 'reasoningLow',
                                      medium: 'reasoningMedium',
                                      high: 'reasoningHigh',
                                      xhigh: 'reasoningXhigh',
                                      auto: 'reasoningAuto'
                                    } as Record<string, TextKey>
                                  )[option] ?? 'reasoningDefault'
                                )
                              )
                            )
                          )
                        : undefined,
                      permissionModePickerOpen.value
                        ? h(
                            'div',
                            { class: 'permission-mode-picker-menu', role: 'listbox' },
                            permissionModeCards.value.map((card) =>
                              h(
                                'button',
                                {
                                  class: [
                                    'permission-mode-option',
                                    {
                                      'permission-mode-option-selected': card.mode === selectedPermissionMode.value,
                                      'permission-mode-option-caution': card.mode === 'bypassPermissions'
                                    }
                                  ],
                                  key: card.mode,
                                  type: 'button',
                                  role: 'option',
                                  'aria-selected': card.mode === selectedPermissionMode.value,
                                  disabled: permissionModeUpdateState.value === 'updating',
                                  onClick: () => void updatePermissionMode(card.mode)
                                },
                                [
                                  h('span', { class: 'permission-mode-option-title' }, text(card.titleKey)),
                                  h('span', { class: 'permission-mode-option-desc' }, text(card.descriptionKey))
                                ]
                              )
                            )
                          )
                        : undefined,
                      pendingModelSwitchTarget.value
                        ? h('button', {
                            class: 'model-switch-confirm-backdrop',
                            type: 'button',
                            'aria-label': text('cancel'),
                            onClick: () => {
                              cancelSwitchModel()
                            }
                          })
                        : undefined,
                      pendingModelSwitchTarget.value
                        ? h('div', { class: 'model-switch-confirm-dialog', role: 'dialog', 'aria-modal': 'true' }, [
                            h('p', { class: 'model-switch-confirm-title' }, text('modelSwitchConfirmTitle')),
                            h(
                              'p',
                              { class: 'model-switch-confirm-description' },
                              text('modelSwitchConfirmDescription')
                            ),
                            h('label', { class: 'model-switch-confirm-skip' }, [
                              h('input', {
                                type: 'checkbox',
                                checked: skipModelSwitchConfirm.value,
                                onChange: (event: Event) => {
                                  skipModelSwitchConfirm.value = (event.target as HTMLInputElement).checked
                                }
                              }),
                              text('modelSwitchConfirmSkip')
                            ]),
                            h('div', { class: 'model-switch-confirm-actions' }, [
                              h(
                                'button',
                                {
                                  class: 'model-switch-confirm-cancel',
                                  type: 'button',
                                  onClick: () => {
                                    cancelSwitchModel()
                                  }
                                },
                                text('cancel')
                              ),
                              h(
                                'button',
                                {
                                  class: 'model-switch-confirm-ok',
                                  type: 'button',
                                  onClick: () => {
                                    confirmSwitchModel()
                                  }
                                },
                                text('confirm')
                              )
                            ])
                          ])
                        : undefined,
                      slashCommandSuggestions.value.length
                        ? h(
                            'div',
                            { class: 'slash-command-menu', role: 'listbox' },
                            slashCommandSuggestions.value.map((command) =>
                              h(
                                'button',
                                {
                                  class: 'slash-command-option',
                                  key: command.name,
                                  type: 'button',
                                  role: 'option',
                                  onClick: () => {
                                    composerText.value = `/${command.name} `
                                  }
                                },
                                [
                                  h('span', { class: 'slash-command-name' }, `/${command.name}`),
                                  command.description
                                    ? h('span', { class: 'slash-command-description' }, command.description)
                                    : undefined
                                ]
                              )
                            )
                          )
                        : undefined,
                      skillPickerOpen.value
                        ? h('div', { class: 'skill-picker-menu', role: 'listbox' }, [
                            h('input', {
                              class: 'skill-picker-search',
                              type: 'search',
                              placeholder: text('skillSearchPlaceholder'),
                              value: skillSearchQuery.value,
                              onInput: (event: Event) => {
                                skillSearchQuery.value = (event.target as HTMLInputElement).value
                              }
                            }),
                            skillsFiltered.value.length
                              ? skillsFiltered.value.map((skill) =>
                                  h(
                                    'button',
                                    {
                                      class: 'skill-picker-option',
                                      key: skill.id,
                                      type: 'button',
                                      role: 'option',
                                      onClick: () => {
                                        insertSkillReference(skill)
                                      }
                                    },
                                    [
                                      h('span', { class: 'skill-picker-name' }, skill.name),
                                      skill.description
                                        ? h('span', { class: 'skill-picker-description' }, skill.description)
                                        : undefined
                                    ]
                                  )
                                )
                              : h('div', { class: 'skill-picker-empty' }, text('skillLauncherEmpty'))
                          ])
                        : undefined,
                      kbPickerOpen.value
                        ? h('div', { class: 'kb-picker-menu' }, [
                            h('div', { class: 'kb-picker-label' }, text('knowledgeSelectBase')),
                            h('div', { class: 'kb-picker-bases' }, [
                              knowledgeBases.value.length
                                ? knowledgeBases.value.map((base) =>
                                    h(
                                      'button',
                                      {
                                        class: [
                                          'kb-base-option',
                                          { 'kb-base-option-selected': base.id === kbSelectedBaseId.value }
                                        ],
                                        key: base.id,
                                        type: 'button',
                                        onClick: () => {
                                          kbSelectedBaseId.value = base.id
                                          kbResults.value = []
                                        }
                                      },
                                      base.name
                                    )
                                  )
                                : h('div', { class: 'kb-picker-empty' }, text('knowledgeSelectBaseEmpty'))
                            ]),
                            h('div', { class: 'kb-picker-search-row' }, [
                              h('input', {
                                class: 'kb-picker-search',
                                type: 'search',
                                placeholder: text('knowledgeSearchPlaceholder'),
                                disabled: !kbSelectedBaseId.value,
                                value: kbSearchQuery.value,
                                onKeydown: (event: KeyboardEvent) => {
                                  if (event.key === 'Enter') void searchKnowledge()
                                },
                                onInput: (event: Event) => {
                                  kbSearchQuery.value = (event.target as HTMLInputElement).value
                                }
                              }),
                              h(
                                'button',
                                {
                                  class: 'kb-picker-search-button',
                                  type: 'button',
                                  disabled: !kbSelectedBaseId.value || kbSearching.value,
                                  onClick: () => void searchKnowledge()
                                },
                                kbSearching.value ? text('knowledgeSearching') : text('knowledgeSearch')
                              )
                            ]),
                            kbResults.value.length
                              ? kbResults.value.map((result, index) =>
                                  h(
                                    'button',
                                    {
                                      class: 'kb-result-option',
                                      key: result.chunkId ?? `result-${index}`,
                                      type: 'button',
                                      onClick: () => {
                                        insertKnowledgeReference(result)
                                      }
                                    },
                                    [
                                      h('span', { class: 'kb-result-title' }, result.title || kbSelectedBaseName.value),
                                      h(
                                        'span',
                                        { class: 'kb-result-snippet' },
                                        (result.pageContent ?? '').slice(0, 200)
                                      )
                                    ]
                                  )
                                )
                              : kbSelectedBaseId.value && kbSearchQuery.value.trim()
                                ? h('div', { class: 'kb-picker-empty' }, text('knowledgeSearchNoResult'))
                                : undefined
                          ])
                        : undefined
                    ]
                  ),
                  quickPanelOpen.value
                    ? h('div', {
                        class: 'quick-panel-overlay',
                        onClick: closeQuickPanel
                      })
                    : undefined,
                  quickPanelOpen.value
                    ? h('div', { class: 'quick-panel', role: 'dialog', 'aria-label': text('quickPanel') }, [
                        h('div', { class: 'quick-panel-search-row' }, [
                          quickPanelSubmenu.value
                            ? h(
                                'button',
                                {
                                  class: 'quick-panel-back',
                                  type: 'button',
                                  'aria-label': text('back'),
                                  onClick: () => {
                                    quickPanelSubmenu.value = null
                                    quickPanelQuery.value = ''
                                    quickPanelActiveIndex.value = 0
                                  }
                                },
                                '‹'
                              )
                            : undefined,
                          h('input', {
                            class: 'quick-panel-search',
                            type: 'text',
                            // Autofocus so the panel is keyboard-driven the moment it opens,
                            // matching the desktop panel's type-to-filter behaviour.
                            autofocus: true,
                            placeholder: text('quickPanel'),
                            value: quickPanelQuery.value,
                            onInput: (event: Event) => {
                              quickPanelQuery.value = (event.target as HTMLInputElement).value
                              quickPanelActiveIndex.value = 0
                            },
                            onKeydown: handleQuickPanelKeydown
                          })
                        ]),
                        h(
                          'div',
                          { class: 'quick-panel-items', role: 'listbox' },
                          quickPanelVisibleEntries.value.length
                            ? quickPanelVisibleEntries.value.map((entry, index) => {
                                const isPinned = chatInputPinnedTools.value.includes(entry.id)
                                return h(
                                  'button',
                                  {
                                    class: [
                                      'quick-panel-item',
                                      {
                                        'quick-panel-item-active': index === quickPanelActiveIndex.value,
                                        'quick-panel-item-disabled': entry.disabled
                                      }
                                    ],
                                    type: 'button',
                                    role: 'option',
                                    'aria-selected': index === quickPanelActiveIndex.value,
                                    key: entry.id,
                                    disabled: entry.disabled,
                                    onMouseenter: () => {
                                      quickPanelActiveIndex.value = index
                                    },
                                    onClick: () => activateQuickPanelEntry(entry)
                                  },
                                  [
                                    h(
                                      'span',
                                      { class: 'quick-panel-item-icon' },
                                      entry.icon ? renderComposerToolIcon(entry.icon) : '›'
                                    ),
                                    h('span', { class: 'quick-panel-item-text' }, [
                                      h('span', { class: 'quick-panel-item-label' }, entry.label),
                                      entry.description
                                        ? h('span', { class: 'quick-panel-item-description' }, entry.description)
                                        : undefined
                                    ]),
                                    isPinned
                                      ? h('span', { class: 'quick-panel-item-badge' }, text('quickPanelPinned'))
                                      : undefined,
                                    entry.suffix
                                      ? h('span', { class: 'quick-panel-item-suffix' }, entry.suffix)
                                      : undefined,
                                    entry.isMenu
                                      ? h('span', { class: 'quick-panel-item-chevron', 'aria-hidden': 'true' }, '›')
                                      : undefined
                                  ]
                                )
                              })
                            : h('p', { class: 'quick-panel-empty' }, text('knowledgeSearchNoResult'))
                        ),
                        // Footer hint bar mirrors the desktop panel's keyboard legend.
                        h('p', { class: 'quick-panel-hint' }, text('quickPanelHint'))
                      ])
                    : undefined
                ])
              ]),
              statusPanelOpen.value
                ? h('button', {
                    class: 'agent-status-panel-backdrop',
                    type: 'button',
                    'aria-label': text('close'),
                    onClick: () => {
                      statusPanelOpen.value = false
                    }
                  })
                : undefined,
              statusPanelOpen.value
                ? h(
                    'aside',
                    {
                      class: 'status-panel agent-status-panel',
                      'aria-label': text(rightPanelTab.value === 'help' ? 'help' : 'status')
                    },
                    [
                      h('div', {
                        class: 'status-panel-resize-handle',
                        role: 'separator',
                        'aria-orientation': 'vertical',
                        'aria-label': text('resizeComposer'),
                        onPointerdown: beginPanelResize
                      }),
                      h('header', { class: 'agent-status-panel-header' }, [
                        h('div', { class: 'agent-status-panel-tabs' }, [
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'status' }
                              ],
                              type: 'button',
                              onClick: () => {
                                rightPanelTab.value = 'status'
                                refreshComposerInfo()
                              }
                            },
                            [
                              renderActionIcon('activity'),
                              h('span', text('status')),
                              incompleteTaskCount.value > 0
                                ? h(
                                    'span',
                                    { class: 'agent-status-panel-tab-badge' },
                                    String(incompleteTaskCount.value)
                                  )
                                : undefined
                            ]
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'files' }
                              ],
                              type: 'button',
                              onClick: openFilesPanel
                            },
                            [renderActionIcon('folder'), h('span', text('files'))]
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'speech' }
                              ],
                              type: 'button',
                              onClick: openSpeechPanel
                            },
                            [renderActionIcon('volume'), h('span', text('speechPanel'))]
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'help' }
                              ],
                              type: 'button',
                              onClick: () => {
                                clearStatusPreviewTimers()
                                statusPreviewOpen.value = false
                                statusPanelOpen.value = true
                                rightPanelTab.value = 'help'
                              }
                            },
                            [renderActionIcon('help'), h('span', text('help'))]
                          )
                        ]),
                        h(
                          'button',
                          {
                            class: 'agent-status-panel-close',
                            type: 'button',
                            title: text('close'),
                            'aria-label': text('close'),
                            onClick: () => {
                              statusPanelOpen.value = false
                            }
                          },
                          renderActionIcon('close')
                        )
                      ]),
                      rightPanelTab.value === 'files'
                        ? renderWorkspaceFilesPanel()
                        : rightPanelTab.value === 'speech'
                          ? h('div', { class: 'agent-status-panel-scroll' }, [renderSpeechPanel()])
                          : rightPanelTab.value === 'help'
                            ? h('div', { class: 'agent-status-panel-scroll help-panel' }, [
                                h('details', { class: 'help-guide-tree', open: true }, [
                                  h('summary', [renderActionIcon('help'), h('span', text('helpGuide'))]),
                                  h(
                                    'ul',
                                    [
                                      'helpGuideIntro',
                                      'helpGuideSessions',
                                      'helpGuideStatus',
                                      'helpGuideFiles',
                                      'helpGuidePreview',
                                      'helpGuideSpeech',
                                      'helpGuideSecurity'
                                    ].map((key) => h('li', text(key as TextKey)))
                                  )
                                ]),
                                h('section', { class: 'help-runtime-section' }, [
                                  h('div', { class: 'help-runtime-header' }, [
                                    h('h3', text('runtimeDetails')),
                                    h('span', {
                                      class: [
                                        'bridge-indicator',
                                        {
                                          'bridge-indicator-connected': bridgeState.value === 'connected',
                                          'bridge-indicator-offline': bridgeState.value === 'offline'
                                        }
                                      ],
                                      title: bridgeDetail.value,
                                      'aria-label': bridgeDetail.value,
                                      role: 'status'
                                    })
                                  ]),
                                  h('div', { class: 'status-runtime-body' }, [
                                    ...statusItems.value.map((item, index) =>
                                      h(
                                        'dl',
                                        {
                                          class: [
                                            'status-row',
                                            { 'status-row-terminal': index === statusItems.value.length - 1 }
                                          ],
                                          key: item.label
                                        },
                                        [h('dt', item.label), h('dd', item.value)]
                                      )
                                    ),
                                    h('div', { class: 'version-block' }, [
                                      ...versionItems.value.map((item) =>
                                        h('dl', { class: 'status-row version-row', key: item.label }, [
                                          h('dt', item.label),
                                          h('dd', item.value)
                                        ])
                                      ),
                                      h(
                                        'a',
                                        {
                                          class: 'status-github-link',
                                          href: projectRepositoryUrl,
                                          target: '_blank',
                                          rel: 'noreferrer',
                                          title: text('githubProject'),
                                          'aria-label': text('githubProject')
                                        },
                                        renderGithubIcon()
                                      )
                                    ])
                                  ])
                                ])
                              ])
                            : h(
                                'div',
                                { class: 'agent-status-panel-scroll' },
                                renderAgentStatusBody(agentStatus.value, false)
                              )
                    ]
                  )
                : undefined,
              newConversationOpen.value
                ? h('div', { class: 'modal-backdrop' }, [
                    h('section', { class: 'new-conversation-dialog', role: 'dialog', 'aria-modal': 'true' }, [
                      h('header', { class: 'dialog-header' }, [
                        h('h2', text('newConversation')),
                        h(
                          'button',
                          {
                            class: 'icon-button',
                            type: 'button',
                            title: text('close'),
                            'aria-label': text('close'),
                            onClick: () => {
                              newConversationOpen.value = false
                              pendingWorkspaceSeed.value = { type: 'system' }
                              pendingWorkspaceHint.value = ''
                            }
                          },
                          '×'
                        )
                      ]),
                      pendingWorkspaceHint.value
                        ? h('p', { class: 'create-workspace-hint' }, pendingWorkspaceHint.value)
                        : undefined,
                      h('label', { class: 'field-label', for: 'agent-select' }, text('agent')),
                      h(
                        'select',
                        {
                          id: 'agent-select',
                          disabled: newConversationState.value === 'loading' || !agents.value.length,
                          value: selectedAgentId.value,
                          onChange: (event: Event) => {
                            selectedAgentId.value = (event.target as HTMLSelectElement).value
                          }
                        },
                        agents.value.map((agent) =>
                          h(
                            'option',
                            { key: agent.id, value: agent.id },
                            `${agent.name} · ${stripModelNamePrefix(agent.modelName ?? agent.model ?? '')}`
                          )
                        )
                      ),
                      newConversationError.value
                        ? h('p', { class: 'composer-error', role: 'alert' }, newConversationError.value)
                        : undefined,
                      h('footer', { class: 'dialog-actions' }, [
                        h(
                          'button',
                          {
                            class: 'secondary-button',
                            type: 'button',
                            onClick: () => {
                              newConversationOpen.value = false
                              pendingWorkspaceSeed.value = { type: 'system' }
                              pendingWorkspaceHint.value = ''
                            }
                          },
                          text('cancel')
                        ),
                        h(
                          'button',
                          {
                            class: 'primary-button',
                            type: 'button',
                            disabled: !selectedAgentId.value || newConversationState.value === 'creating',
                            onClick: () => void createConversation()
                          },
                          newConversationState.value === 'creating' ? text('creating') : text('create')
                        )
                      ])
                    ])
                  ])
                : undefined,
              deleteMessageId.value
                ? h('div', { class: 'modal-backdrop', onClick: closeDeleteMessage }, [
                    h(
                      'section',
                      {
                        class: 'new-conversation-dialog delete-message-dialog',
                        role: 'dialog',
                        'aria-modal': 'true',
                        'aria-labelledby': 'delete-message-title',
                        'aria-describedby': 'delete-message-description',
                        onClick: (event: MouseEvent) => event.stopPropagation(),
                        onKeydown: (event: KeyboardEvent) => {
                          if (event.key === 'Escape') closeDeleteMessage()
                        }
                      },
                      [
                        h('header', { class: 'dialog-header' }, [
                          h('h2', { id: 'delete-message-title' }, text('deleteMessage')),
                          h(
                            'button',
                            {
                              class: 'icon-button',
                              type: 'button',
                              disabled: messageDeleteState.value === 'deleting',
                              title: text('close'),
                              'aria-label': text('close'),
                              onClick: closeDeleteMessage
                            },
                            renderActionIcon('close')
                          )
                        ]),
                        h(
                          'p',
                          { id: 'delete-message-description', class: 'dialog-description' },
                          text('deleteMessageDescription')
                        ),
                        messageDeleteError.value
                          ? h('p', { class: 'composer-error', role: 'alert' }, messageDeleteError.value)
                          : undefined,
                        h('footer', { class: 'dialog-actions' }, [
                          h(
                            'button',
                            {
                              class: 'secondary-button',
                              type: 'button',
                              disabled: messageDeleteState.value === 'deleting',
                              autofocus: true,
                              onClick: closeDeleteMessage
                            },
                            text('cancel')
                          ),
                          h(
                            'button',
                            {
                              class: 'primary-button danger-button',
                              type: 'button',
                              disabled:
                                messageDeleteState.value === 'deleting' ||
                                activeRunConversationId.value === selectedConversationId.value,
                              onClick: () => void confirmDeleteMessage()
                            },
                            messageDeleteState.value === 'deleting' ? text('deleting') : text('delete')
                          )
                        ])
                      ]
                    )
                  ])
                : undefined,
              deleteConversationId.value
                ? h('div', { class: 'modal-backdrop', onClick: closeDeleteConversation }, [
                    h(
                      'section',
                      {
                        class: 'new-conversation-dialog delete-message-dialog',
                        role: 'dialog',
                        'aria-modal': 'true',
                        'aria-labelledby': 'delete-conversation-title',
                        'aria-describedby': 'delete-conversation-description',
                        onClick: (event: MouseEvent) => event.stopPropagation(),
                        onKeydown: (event: KeyboardEvent) => {
                          if (event.key === 'Escape') closeDeleteConversation()
                        }
                      },
                      [
                        h('header', { class: 'dialog-header' }, [
                          h('h2', { id: 'delete-conversation-title' }, text('deleteConversation')),
                          h(
                            'button',
                            {
                              class: 'icon-button',
                              type: 'button',
                              disabled: conversationActionState.value === 'deleting',
                              title: text('close'),
                              'aria-label': text('close'),
                              onClick: closeDeleteConversation
                            },
                            renderActionIcon('close')
                          )
                        ]),
                        h('p', { id: 'delete-conversation-description', class: 'dialog-description' }, [
                          text('deleteConversationDescription'),
                          deletingConversation.value ? h('strong', `\n${deletingConversation.value.title}`) : undefined
                        ]),
                        conversationActionError.value
                          ? h('p', { class: 'composer-error', role: 'alert' }, conversationActionError.value)
                          : undefined,
                        h('footer', { class: 'dialog-actions' }, [
                          h(
                            'button',
                            {
                              class: 'secondary-button',
                              type: 'button',
                              disabled: conversationActionState.value === 'deleting',
                              autofocus: true,
                              onClick: closeDeleteConversation
                            },
                            text('cancel')
                          ),
                          h(
                            'button',
                            {
                              class: 'primary-button danger-button',
                              type: 'button',
                              disabled: conversationActionState.value === 'deleting',
                              onClick: () => void confirmDeleteConversation()
                            },
                            conversationActionState.value === 'deleting' ? text('deleting') : text('delete')
                          )
                        ])
                      ]
                    )
                  ])
                : undefined
            ]
          )
  }
})

createApp(App).use(createPinia()).mount('#app')
