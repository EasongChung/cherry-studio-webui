<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { createWebUiHttpClient } from '../service/httpClient'
import { fallbackLanguage } from '../utils/constants'
import { type TextKey, textPacks } from '../utils/textPacks'

export type SettingsTabId = 'agents' | 'providers' | 'prompts' | 'mcp' | 'usage' | 'preferences' | 'help'

interface HelpStatusItem {
  label: string
  value: string
}

// --- Agent Types ---
interface AgentEntity {
  id: string
  name: string
  description?: string
  instructions?: string
  model?: string | null
  modelName?: string | null
  planModel?: string | null
  smallModel?: string | null
  configuration?: {
    permission_mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto'
    reasoning_effort?: string
  }
}

// --- Providers & Models Types ---
interface ProviderEndpointConfig {
  baseUrl?: string
  url?: string
}

interface ProviderSettings {
  timeout?: number
  rateLimit?: number
  extraHeaders?: Record<string, string>
  notes?: string
}

interface ProviderEntity {
  id: string
  name: string
  isEnabled?: boolean
  presetProviderId?: string
  defaultChatEndpoint?: string
  endpointConfigs?: Record<string, ProviderEndpointConfig>
  providerSettings?: ProviderSettings
}

interface ModelEntity {
  id: string
  providerId: string
  modelId?: string
  name: string
  apiModelId?: string
  group?: string
  capabilities?: string[]
  endpointTypes?: string[]
  contextWindow?: number
}

// --- Prompts Types ---
interface PromptEntity {
  id: string
  title: string
  content: string
  visibility?: 'global' | 'restricted'
  createdAt?: string
}

// --- MCP & Skills Types ---
interface McpServerEntity {
  id: string
  name: string
  type: 'stdio' | 'sse' | 'streamableHttp'
  description?: string | null
  command?: string | null
  baseUrl?: string | null
  isActive?: boolean
}

interface SkillEntity {
  id: string
  name: string
  description?: string | null
  source?: string
  isGlobalEnabled?: boolean
  isEnabled?: boolean
}

// --- Usage Records Types ---
interface AiUsageRecordItem {
  id: string
  modelId?: string | null
  modelName?: string | null
  providerId?: string | null
  providerName?: string | null
  sourceType?: 'assistant' | 'agent' | null
  sourceId?: string | null
  sourceName?: string | null
  sourceIcon?: string | null
  modality?: 'language' | 'embedding' | 'image' | 'rerank'
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  cost?: number | null
  costCurrency?: string | null
  timeFirstTokenMs?: number | null
  timeCompletionMs?: number | null
  createdAt: string
}

type UsageRecordSortBy = 'createdAt' | 'totalTokens' | 'cost' | 'timeFirstTokenMs' | 'tokensPerSecond'
type UsageRecordSortOrder = 'asc' | 'desc'

interface AiUsageRecordListResponse {
  items: AiUsageRecordItem[]
  total: number
  nextCursor?: string
}

interface AiUsageStatsBucket {
  modelId?: string | null
  providerId?: string | null
  totalTokens?: number
  totalInputTokens?: number
  totalOutputTokens?: number
  totalNoCacheTokens?: number
  totalCacheReadTokens?: number
  totalCacheWriteTokens?: number
  requestCount?: number
}

interface AiUsageStatsResponse {
  totals?: {
    totalTokens?: number
    totalInputTokens?: number
    totalOutputTokens?: number
    totalNoCacheTokens?: number
    totalCacheReadTokens?: number
    totalCacheWriteTokens?: number
    requestCount?: number
  }
  buckets?: AiUsageStatsBucket[]
}

// --- Preferences Types ---
interface WebUiPreferences {
  showEstimatedTokens?: boolean
  thoughtAutoCollapse?: boolean
  chatInputPinnedTools?: string[]
  agentInputPinnedTools?: string[]
  webSearchProvider?: string
  webSearchMaxResults?: number
  webSearchProviderOverrides?: Record<string, { apiKey?: string; apiHost?: string }>
  searchApiKey?: string
  searchApiHost?: string
  contextManagementEnabled?: boolean
  contextMaxMessages?: number | null
  contextTruncateThreshold?: number
  contextCompressEnabled?: boolean
  contextCompressModelId?: string | null
}

const props = defineProps<{
  httpClient: ReturnType<typeof createWebUiHttpClient>
  language: string
  bridgeState: 'checking' | 'connected' | 'offline'
  bridgeDetail: string
  statusItems: readonly HelpStatusItem[]
  versionItems: readonly HelpStatusItem[]
  projectRepositoryUrl: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'settingsChanged'): void
}>()

const currentTab = ref<SettingsTabId>('providers')
const text = (key: TextKey) => {
  const langKey = (props.language in textPacks ? props.language : fallbackLanguage) as keyof typeof textPacks
  return textPacks[langKey]?.[key] ?? textPacks[fallbackLanguage][key]
}

// Toast feedback
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
let toastTimer: number | undefined
const showToast = (msg: string, kind: 'success' | 'error' = 'success') => {
  toastMessage.value = msg
  toastKind.value = kind
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 2500)
}
const showError = (msg: string) => showToast(msg, 'error')

// ==========================================
// 1. Agents Management
// ==========================================
const agents = ref<AgentEntity[]>([])
const agentSearchQuery = ref('')
const selectedAgentId = ref<string>('')
const isLoadingAgents = ref(false)
const isSavingAgent = ref(false)
const showNewAgentDrawer = ref(false)

const editAgentName = ref('')
const editAgentDescription = ref('')
const editAgentInstructions = ref('')
const editAgentModel = ref<string>('')
const editAgentPlanModel = ref<string>('')
const editAgentSmallModel = ref<string>('')
const editAgentPermissionMode = ref<'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto'>('auto')

const filteredAgents = computed(() => {
  const q = agentSearchQuery.value.trim().toLowerCase()
  if (!q) return agents.value
  return agents.value.filter(
    (a) => a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)
  )
})

const selectedAgent = computed(() => {
  return agents.value.find((a) => a.id === selectedAgentId.value)
})

const loadAgents = async () => {
  isLoadingAgents.value = true
  try {
    const res = await props.httpClient.getJson<{ items?: AgentEntity[] } | AgentEntity[]>('/api/data/agents')
    const list = Array.isArray(res) ? res : res?.items ?? []
    agents.value = list
    if (agents.value.length > 0 && !selectedAgentId.value && agents.value[0]) {
      selectAgent(agents.value[0].id)
    }
  } catch (err) {
    console.error('Failed to load agents:', err)
  } finally {
    isLoadingAgents.value = false
  }
}

const selectAgent = (id: string) => {
  selectedAgentId.value = id
  showNewAgentDrawer.value = false
  const a = agents.value.find((item) => item.id === id)
  if (a) {
    editAgentName.value = a.name || ''
    editAgentDescription.value = a.description || ''
    editAgentInstructions.value = a.instructions || ''
    editAgentModel.value = a.model || ''
    editAgentPlanModel.value = a.planModel || ''
    editAgentSmallModel.value = a.smallModel || ''
    editAgentPermissionMode.value = a.configuration?.permission_mode || 'auto'
  }
}

const saveAgent = async () => {
  if (!selectedAgent.value || !editAgentName.value.trim()) return
  isSavingAgent.value = true
  try {
    await props.httpClient.patchJson(`/api/data/agents/${encodeURIComponent(selectedAgent.value.id)}`, {
      name: editAgentName.value.trim(),
      description: editAgentDescription.value.trim() || undefined,
      instructions: editAgentInstructions.value.trim() || undefined,
      model: editAgentModel.value || undefined,
      planModel: editAgentPlanModel.value || undefined,
      smallModel: editAgentSmallModel.value || undefined,
      configuration: {
        ...(selectedAgent.value.configuration ?? {}),
        permission_mode: editAgentPermissionMode.value
      }
    })
    await loadAgents()
    selectAgent(selectedAgent.value.id)
    showToast(text('agentSaved'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Save agent failed')
  } finally {
    isSavingAgent.value = false
  }
}

const openNewAgent = () => {
  showNewAgentDrawer.value = true
  selectedAgentId.value = ''
  editAgentName.value = ''
  editAgentDescription.value = ''
  editAgentInstructions.value = ''
  editAgentModel.value = models.value[0]?.id || ''
  editAgentPlanModel.value = ''
  editAgentSmallModel.value = ''
  editAgentPermissionMode.value = 'auto'
}

const createAgent = async () => {
  if (!editAgentName.value.trim() || !editAgentModel.value) return
  isSavingAgent.value = true
  try {
    const created = await props.httpClient.postJson<AgentEntity>('/api/data/agents', {
      name: editAgentName.value.trim(),
      description: editAgentDescription.value.trim() || undefined,
      instructions: editAgentInstructions.value.trim() || undefined,
      model: editAgentModel.value,
      planModel: editAgentPlanModel.value || undefined,
      smallModel: editAgentSmallModel.value || undefined,
      type: 'claude-code',
      configuration: {
        permission_mode: editAgentPermissionMode.value
      }
    })
    showNewAgentDrawer.value = false
    await loadAgents()
    if (created?.id) {
      selectAgent(created.id)
    }
    showToast(text('agentCreated'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Create agent failed')
  } finally {
    isSavingAgent.value = false
  }
}

const deleteAgent = async (id: string) => {
  try {
    await props.httpClient.deleteJson(`/api/webui/agents/${encodeURIComponent(id)}`)
    selectedAgentId.value = ''
    await loadAgents()
    showToast(text('agentDeleted'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Delete agent failed')
  }
}

// ==========================================
// 2. Providers & Models Management
// ==========================================
const providers = ref<ProviderEntity[]>([])
const models = ref<ModelEntity[]>([])
const selectedProviderId = ref<string>('')
const providerSearchQuery = ref('')
const isLoadingProviders = ref(false)
const isSavingProvider = ref(false)
const testConnectionState = ref<{
  loading: boolean
  success?: boolean
  latencyMs?: number
  message?: string
}>({ loading: false })

const testingModelId = ref<string>('')

const customEndpointTypes = [
  'openai-chat-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generate-content',
  'openai-image-generation',
  'openai-image-edit'
] as const
const customTextEndpointTypes = customEndpointTypes.slice(0, 4)
const primaryEndpointTypes = ['openai-chat-completions', 'anthropic-messages'] as const
const additionalEndpointTypes = [
  'openai-responses',
  'google-generate-content',
  'openai-image-generation',
  'openai-image-edit'
] as const
const endpointLabels = {
  'openai-chat-completions': 'endpointOpenAiChat',
  'openai-responses': 'endpointOpenAiResponses',
  'anthropic-messages': 'endpointAnthropicMessages',
  'google-generate-content': 'endpointGoogleGenerate',
  'openai-image-generation': 'endpointOpenAiImageGeneration',
  'openai-image-edit': 'endpointOpenAiImageEdit'
} as const satisfies Record<(typeof customEndpointTypes)[number], TextKey>

const editProviderName = ref('')
const editApiKey = ref('')
const isApiKeyDirty = ref(false)
const editIsEnabled = ref(true)
const editDefaultChatEndpoint = ref<string>('openai-chat-completions')
const editEndpointConfigs = ref<Record<string, ProviderEndpointConfig>>({})
const editProviderTimeout = ref<number | undefined>()
const editProviderRateLimit = ref<number | undefined>()
const editProviderHeaders = ref('')
const editProviderNotes = ref('')
const providerAdvancedOpen = ref(false)
const isCreatingProvider = ref(false)
const showCreateProviderForm = ref(false)

const showAddModelForm = ref(false)
const newModelId = ref('')
const newModelName = ref('')
const isAddingModel = ref(false)
const isPullingModels = ref(false)
const isApplyingModelSync = ref(false)
const showFetchedModelsDialog = ref(false)
const fetchedModels = ref<ModelEntity[]>([])
const selectedFetchedModelIds = ref<Set<string>>(new Set())
const selectedStaleModelIds = ref<Set<string>>(new Set())

const filteredProviders = computed(() => {
  const query = providerSearchQuery.value.trim().toLowerCase()
  if (!query) return providers.value
  return providers.value.filter(
    (p) => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query)
  )
})

const selectedProvider = computed(() => {
  return providers.value.find((p) => p.id === selectedProviderId.value)
})

const currentProviderModels = computed(() => {
  if (!selectedProviderId.value) return []
  return models.value.filter((m) => m.providerId === selectedProviderId.value)
})

const fetchedModelIdSet = computed(() => new Set(fetchedModels.value.map((model) => model.id)))
const staleModels = computed(() => currentProviderModels.value.filter((model) => !fetchedModelIdSet.value.has(model.id)))

const loadProviders = async () => {
  isLoadingProviders.value = true
  try {
    const res = await props.httpClient.getJson<{ items?: ProviderEntity[] } | ProviderEntity[]>('/api/data/providers')
    const list = Array.isArray(res) ? res : res?.items ?? []
    providers.value = list
    if (providers.value.length > 0 && !selectedProviderId.value && providers.value[0]) {
      selectProvider(providers.value[0].id)
    }
  } catch (err) {
    console.error('Failed to load providers:', err)
  } finally {
    isLoadingProviders.value = false
  }
}

const loadModels = async () => {
  try {
    const res = await props.httpClient.getJson<{ items?: ModelEntity[] } | ModelEntity[]>('/api/data/models')
    const list = Array.isArray(res) ? res : res?.items ?? []
    models.value = list
  } catch (err) {
    console.error('Failed to load models:', err)
  }
}

const selectProvider = (id: string) => {
  selectedProviderId.value = id
  testConnectionState.value = { loading: false }
  showAddModelForm.value = false
  showCreateProviderForm.value = false
  isApiKeyDirty.value = false

  const p = providers.value.find((item) => item.id === id)
  if (p) {
    editProviderName.value = p.name || ''
    editIsEnabled.value = p.isEnabled !== false
    editDefaultChatEndpoint.value = p.defaultChatEndpoint || 'openai-chat-completions'
    editEndpointConfigs.value = { ...(p.endpointConfigs ?? {}) }
    editProviderTimeout.value = p.providerSettings?.timeout
    editProviderRateLimit.value = p.providerSettings?.rateLimit
    editProviderHeaders.value = Object.entries(p.providerSettings?.extraHeaders ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')
    editProviderNotes.value = p.providerSettings?.notes ?? ''
    providerAdvancedOpen.value = Boolean(
      p.providerSettings?.timeout ||
        p.providerSettings?.rateLimit ||
        Object.keys(p.providerSettings?.extraHeaders ?? {}).length ||
        p.providerSettings?.notes
    )

    // A key is intentionally never returned to the browser. The main process uses the saved key
    // when testing or fetching models, unless the user explicitly enters a replacement.
    editApiKey.value = ''
  }
}

const onApiKeyInput = () => {
  isApiKeyDirty.value = true
}

const endpointBaseUrl = (endpointType: string) => editEndpointConfigs.value[endpointType]?.baseUrl ?? ''

const availableDefaultChatEndpoints = computed(() =>
  customTextEndpointTypes.filter((endpointType) => Boolean(endpointBaseUrl(endpointType)))
)

const updateEndpointBaseUrl = (endpointType: string, value: string) => {
  const baseUrl = value.trim()
  const next = { ...editEndpointConfigs.value }
  if (baseUrl) {
    next[endpointType] = { ...(next[endpointType] ?? {}), baseUrl }
  } else {
    delete next[endpointType]
  }
  editEndpointConfigs.value = next
}

// --- Provider list reorder via long-press ---
const isDraggingProvider = ref(false)
const draggingProviderId = ref<string | null>(null)
const dragOverProviderId = ref<string | null>(null)
let providerLongPressTimer: ReturnType<typeof setTimeout> | null = null
let providerPointerStartX = 0
let providerPointerStartY = 0
let providerDragStartIndex = -1
let providerDidDrag = false
let providerActivePointerId: number | null = null

const onProviderPointerDown = (event: PointerEvent, p: ProviderEntity, index: number) => {
  if (providerSearchQuery.value.trim()) return
  if (event.button !== 0) return

  providerPointerStartX = event.clientX
  providerPointerStartY = event.clientY
  providerDragStartIndex = index
  providerDidDrag = false
  providerActivePointerId = event.pointerId

  if (providerLongPressTimer) clearTimeout(providerLongPressTimer)
  providerLongPressTimer = setTimeout(() => {
    isDraggingProvider.value = true
    draggingProviderId.value = p.id
    dragOverProviderId.value = p.id
    try {
      (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId)
    } catch {
      // ignore
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(35)
      } catch {
        // ignore
      }
    }
  }, 250)
}

const onProviderPointerMove = (event: PointerEvent) => {
  if (!isDraggingProvider.value) {
    if (
      providerLongPressTimer &&
      Math.hypot(event.clientX - providerPointerStartX, event.clientY - providerPointerStartY) > 8
    ) {
      clearTimeout(providerLongPressTimer)
      providerLongPressTimer = null
    }
    return
  }

  event.preventDefault()
  providerDidDrag = true

  const el = document.elementFromPoint(event.clientX, event.clientY)?.closest('.provider-list-item') as HTMLElement | null
  const targetId = el?.getAttribute('data-provider-id')
  if (targetId && targetId !== draggingProviderId.value) {
    dragOverProviderId.value = targetId
    const currentList = [...providers.value]
    const fromIdx = currentList.findIndex((item) => item.id === draggingProviderId.value)
    const toIdx = currentList.findIndex((item) => item.id === targetId)
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
      const [moved] = currentList.splice(fromIdx, 1)
      if (moved) {
        currentList.splice(toIdx, 0, moved)
        providers.value = currentList
      }
    }
  }
}

const onProviderPointerUp = async (event: PointerEvent) => {
  if (providerLongPressTimer) {
    clearTimeout(providerLongPressTimer)
    providerLongPressTimer = null
  }

  if (providerActivePointerId !== null) {
    try {
      (event.currentTarget as HTMLElement)?.releasePointerCapture?.(providerActivePointerId)
    } catch {
      // ignore
    }
    providerActivePointerId = null
  }

  if (isDraggingProvider.value) {
    const movedId = draggingProviderId.value
    isDraggingProvider.value = false
    draggingProviderId.value = null
    dragOverProviderId.value = null

    if (providerDidDrag && movedId) {
      const finalIndex = providers.value.findIndex((p) => p.id === movedId)
      if (finalIndex !== -1 && finalIndex !== providerDragStartIndex) {
        let anchor: { position: 'first' } | { position: 'last' } | { after: string }
        const prevProvider = providers.value[finalIndex - 1]
        if (finalIndex === 0 || !prevProvider) {
          anchor = { position: 'first' }
        } else if (finalIndex === providers.value.length - 1) {
          anchor = { position: 'last' }
        } else {
          anchor = { after: prevProvider.id }
        }

        try {
          await props.httpClient.patchJson(
            `/api/data/providers/${encodeURIComponent(movedId)}/order`,
            anchor
          )
          showToast(text('providerOrderUpdated'))
          emit('settingsChanged')
        } catch (err: unknown) {
          showError(err instanceof Error ? err.message : 'Reorder failed')
          await loadProviders()
        }
      }
    }
  }
}

const onProviderClick = (id: string) => {
  if (providerDidDrag) {
    providerDidDrag = false
    return
  }
  selectProvider(id)
  if (isMobileLayout.value) showProvidersDrawer.value = false
}

const openCreateProvider = () => {
  selectedProviderId.value = ''
  showCreateProviderForm.value = true
  showAddModelForm.value = false
  editProviderName.value = ''
  editApiKey.value = ''
  isApiKeyDirty.value = false
  editIsEnabled.value = true
  editDefaultChatEndpoint.value = 'openai-chat-completions'
  editEndpointConfigs.value = {}
  editProviderTimeout.value = undefined
  editProviderRateLimit.value = undefined
  editProviderHeaders.value = ''
  editProviderNotes.value = ''
  providerAdvancedOpen.value = false
}

const createProviderId = (name: string) => {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-provider'
  let candidate = base
  let suffix = 2
  const existingIds = new Set(providers.value.map((provider) => provider.id))
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix++}`
  }
  return candidate
}

const resolvedDefaultChatEndpoint = () =>
  availableDefaultChatEndpoints.value.includes(editDefaultChatEndpoint.value as (typeof customTextEndpointTypes)[number])
    ? editDefaultChatEndpoint.value
    : (availableDefaultChatEndpoints.value[0] ?? 'openai-chat-completions')

const hasInvalidEndpointUrl = () =>
  customEndpointTypes.some((endpointType) => {
    const value = endpointBaseUrl(endpointType)
    if (!value) return false
    try {
      const url = new URL(value)
      return url.protocol !== 'http:' && url.protocol !== 'https:'
    } catch {
      return true
    }
  })

const createCustomProvider = async () => {
  const name = editProviderName.value.trim()
  const hasTextEndpoint = customTextEndpointTypes.some((endpointType) => Boolean(endpointBaseUrl(endpointType)))
  if (!name || !hasTextEndpoint) {
    showError(text('providerEndpointRequired'))
    return
  }
  if (hasInvalidEndpointUrl()) {
    showError(text('providerInvalidEndpointUrl'))
    return
  }

  isCreatingProvider.value = true
  try {
    const providerId = createProviderId(name)
    await props.httpClient.postJson('/api/data/providers', {
      providerId,
      name,
      authConfig: { type: 'api-key' },
      defaultChatEndpoint: resolvedDefaultChatEndpoint(),
      endpointConfigs: editEndpointConfigs.value,
      providerSettings: buildProviderSettings()
    })
    if (editIsEnabled.value) {
      await props.httpClient.patchJson(`/api/data/providers/${encodeURIComponent(providerId)}`, { isEnabled: true })
    }

    if (editApiKey.value.trim()) {
      await props.httpClient.postJson(`/api/data/providers/${encodeURIComponent(providerId)}/api-keys`, {
        key: editApiKey.value.trim()
      })
    }

    showCreateProviderForm.value = false
    await loadProviders()
    selectProvider(providerId)
    showToast(text('providerCreated'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Create provider failed')
  } finally {
    isCreatingProvider.value = false
  }
}

const parseExtraHeaders = (raw: string): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue
    const separatorIndex = trimmedLine.indexOf(':')
    if (separatorIndex > 0) {
      const key = trimmedLine.slice(0, separatorIndex).trim()
      const value = trimmedLine.slice(separatorIndex + 1).trim()
      if (key && value) headers[key] = value
    }
  }
  return headers
}

const buildProviderSettings = () => ({
  timeout: editProviderTimeout.value,
  rateLimit: editProviderRateLimit.value,
  extraHeaders: parseExtraHeaders(editProviderHeaders.value),
  ...(editProviderNotes.value.trim() ? { notes: editProviderNotes.value.trim() } : {})
})

const saveProviderDetails = async () => {
  if (!selectedProvider.value) return
  if (hasInvalidEndpointUrl()) {
    showError(text('providerInvalidEndpointUrl'))
    return
  }
  isSavingProvider.value = true
  try {
    const p = selectedProvider.value

    await props.httpClient.patchJson(`/api/data/providers/${p.id}`, {
      name: editProviderName.value.trim() || p.name,
      isEnabled: editIsEnabled.value,
      defaultChatEndpoint: resolvedDefaultChatEndpoint(),
      endpointConfigs: editEndpointConfigs.value,
      providerSettings: buildProviderSettings()
    })

    if (isApiKeyDirty.value && editApiKey.value.trim()) {
      const rawKey = editApiKey.value.trim()
      await props.httpClient.postJson(`/api/data/providers/${p.id}/api-keys`, {
        key: rawKey
      })
      isApiKeyDirty.value = false
      // Never keep the entered key in component state after it has been persisted.
      editApiKey.value = ''
    }

    await loadProviders()
    selectProvider(p.id)
    showToast(text('save') + ' ✓')
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Save failed')
  } finally {
    isSavingProvider.value = false
  }
}

const deleteProvider = async () => {
  if (!selectedProvider.value) return
  isSavingProvider.value = true
  try {
    await props.httpClient.deleteJson(`/api/data/providers/${encodeURIComponent(selectedProvider.value.id)}`)
    selectedProviderId.value = ''
    await loadProviders()
    await loadModels()
    showToast(text('providerDeleted'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Delete provider failed')
  } finally {
    isSavingProvider.value = false
  }
}

const toggleProviderEnabled = async (p: ProviderEntity) => {
  const nextVal = p.isEnabled === false
  try {
    await props.httpClient.patchJson(`/api/data/providers/${p.id}`, {
      isEnabled: nextVal
    })
    p.isEnabled = nextVal
    if (p.id === selectedProviderId.value) {
      editIsEnabled.value = nextVal
    }
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Update failed')
  }
}

const testConnection = async () => {
  if (!selectedProvider.value) return
  testConnectionState.value = { loading: true }
  try {
    const rawKey = editApiKey.value.trim() || undefined
    const res = await props.httpClient.postJson<{
      ok: boolean
      latencyMs?: number
      error?: string
    }>('/api/webui/providers/test', {
      providerId: selectedProvider.value.id,
      baseUrl: endpointBaseUrl(resolvedDefaultChatEndpoint()) || undefined,
      endpointType: resolvedDefaultChatEndpoint(),
      ...(rawKey ? { apiKey: rawKey } : {})
    })

    if (res.ok) {
      testConnectionState.value = {
        loading: false,
        success: true,
        latencyMs: res.latencyMs,
        message: `✓ ${text('connectionSuccessful')} (${res.latencyMs ?? 0}ms)`
      }
    } else {
      testConnectionState.value = {
        loading: false,
        success: false,
        message: res.error || text('connectionFailed')
      }
    }
  } catch (err: unknown) {
    testConnectionState.value = {
      loading: false,
      success: false,
      message: err instanceof Error ? err.message : text('connectionFailed')
    }
  }
}

const testModel = async (m: ModelEntity) => {
  testingModelId.value = m.id
  try {
    const res = await props.httpClient.postJson<{ ok: boolean; latencyMs?: number; error?: string }>(
      '/api/webui/models/test',
      {
        uniqueModelId: m.id,
        ...(editApiKey.value.trim() ? { apiKey: editApiKey.value.trim() } : {})
      }
    )
    if (res.ok) {
      showToast(`✓ ${m.name || m.id}: ${res.latencyMs ?? 0}ms`)
    } else {
      showError(`✗ ${m.name || m.id}: ${res.error || text('connectionFailed')}`)
    }
  } catch (err: unknown) {
    showError(`✗ ${m.name || m.id}: ${err instanceof Error ? err.message : text('connectionFailed')}`)
  } finally {
    testingModelId.value = ''
  }
}

const pullModels = async () => {
  if (!selectedProvider.value) return
  const currentPid = selectedProvider.value.id
  isPullingModels.value = true
  try {
    const res = await props.httpClient.postJson<{ models?: ModelEntity[] }>(
      `/api/webui/providers/${encodeURIComponent(currentPid)}/fetch-models`,
      {}
    )
    const fetched = res?.models ?? []
    if (fetched.length > 0) {
      fetchedModels.value = fetched
      const existingIds = new Set(currentProviderModels.value.map((model) => model.id))
      selectedFetchedModelIds.value = new Set(fetched.filter((model) => existingIds.has(model.id)).map((model) => model.id))
      selectedStaleModelIds.value = new Set()
      showFetchedModelsDialog.value = true
    } else {
      showToast(text('noModelsFound'))
    }
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Pull failed')
  } finally {
    isPullingModels.value = false
  }
}

const toggleFetchedModel = (modelId: string) => {
  const next = new Set(selectedFetchedModelIds.value)
  if (next.has(modelId)) next.delete(modelId)
  else next.add(modelId)
  selectedFetchedModelIds.value = next
}

const toggleStaleModel = (modelId: string) => {
  const next = new Set(selectedStaleModelIds.value)
  if (next.has(modelId)) next.delete(modelId)
  else next.add(modelId)
  selectedStaleModelIds.value = next
}

const addAllFetchedModels = () => {
  selectedFetchedModelIds.value = new Set(fetchedModels.value.map((model) => model.id))
}

const removeAllStaleModels = () => {
  selectedFetchedModelIds.value = new Set()
  selectedStaleModelIds.value = new Set(staleModels.value.map((model) => model.id))
}

const applyModelSync = async () => {
  if (!selectedProvider.value) return
  isApplyingModelSync.value = true
  try {
    const existingIds = new Set(currentProviderModels.value.map((model) => model.id))
    const toAdd = fetchedModels.value
      .filter((model) => selectedFetchedModelIds.value.has(model.id) && !existingIds.has(model.id))
      .map((model) => ({
        providerId: model.providerId,
        modelId: model.modelId ?? model.apiModelId ?? model.name,
        name: model.name,
        group: model.group,
        capabilities: model.capabilities,
        endpointTypes: model.endpointTypes,
        contextWindow: model.contextWindow
      }))

    const toRemoveSet = new Set<string>(selectedStaleModelIds.value)
    for (const m of currentProviderModels.value) {
      if (fetchedModelIdSet.value.has(m.id) && !selectedFetchedModelIds.value.has(m.id)) {
        toRemoveSet.add(m.id)
      }
    }

    await props.httpClient.postJson(
      `/api/data/providers/${encodeURIComponent(selectedProvider.value.id)}/models:reconcile`,
      {
        toAdd,
        toRemove: Array.from(toRemoveSet)
      }
    )
    await loadModels()
    showFetchedModelsDialog.value = false
    showToast(text('modelsSynced'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Sync failed')
  } finally {
    isApplyingModelSync.value = false
  }
}

const deleteModel = async (m: ModelEntity) => {
  if (!window.confirm(text('deleteModelConfirm'))) return
  try {
    await props.httpClient.deleteJson(`/api/data/models/${encodeURIComponent(m.id)}`)
    await loadModels()
    showToast(text('modelDeleted'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Delete model failed')
  }
}

const addCustomModel = async () => {
  if (!selectedProvider.value || !newModelId.value.trim()) return
  isAddingModel.value = true
  try {
    await props.httpClient.postJson('/api/data/models', [{
      providerId: selectedProvider.value.id,
      modelId: newModelId.value.trim(),
      name: newModelName.value.trim() || newModelId.value.trim()
    }])
    newModelId.value = ''
    newModelName.value = ''
    showAddModelForm.value = false
    await loadModels()
    showToast(text('modelAdded'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Add model failed')
  } finally {
    isAddingModel.value = false
  }
}

// ==========================================
// 3. Prompts Management
// ==========================================
const prompts = ref<PromptEntity[]>([])
const promptSearchQuery = ref('')
const selectedPromptId = ref<string>('')
const isLoadingPrompts = ref(false)
const isSavingPrompt = ref(false)
const showNewPromptDrawer = ref(false)

const editPromptTitle = ref('')
const editPromptContent = ref('')

const filteredPrompts = computed(() => {
  const q = promptSearchQuery.value.trim().toLowerCase()
  if (!q) return prompts.value
  return prompts.value.filter(
    (p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
  )
})

const selectedPrompt = computed(() => {
  return prompts.value.find((p) => p.id === selectedPromptId.value)
})

const loadPrompts = async () => {
  isLoadingPrompts.value = true
  try {
    const res = await props.httpClient.getJson<{ items?: PromptEntity[] } | PromptEntity[]>('/api/data/prompts')
    const list = Array.isArray(res) ? res : res?.items ?? []
    prompts.value = list
    if (prompts.value.length > 0 && !selectedPromptId.value && prompts.value[0]) {
      selectPrompt(prompts.value[0].id)
    }
  } catch (err) {
    console.error('Failed to load prompts:', err)
  } finally {
    isLoadingPrompts.value = false
  }
}

const selectPrompt = (id: string) => {
  selectedPromptId.value = id
  showNewPromptDrawer.value = false
  const p = prompts.value.find((item) => item.id === id)
  if (p) {
    editPromptTitle.value = p.title || ''
    editPromptContent.value = p.content || ''
  }
}

const savePrompt = async () => {
  if (!selectedPrompt.value || !editPromptTitle.value.trim()) return
  isSavingPrompt.value = true
  try {
    await props.httpClient.patchJson(`/api/data/prompts/${encodeURIComponent(selectedPrompt.value.id)}`, {
      title: editPromptTitle.value.trim(),
      content: editPromptContent.value.trim()
    })
    await loadPrompts()
    selectPrompt(selectedPrompt.value.id)
    showToast(text('promptSaved'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Save prompt failed')
  } finally {
    isSavingPrompt.value = false
  }
}

const openNewPrompt = () => {
  showNewPromptDrawer.value = true
  selectedPromptId.value = ''
  editPromptTitle.value = ''
  editPromptContent.value = ''
}

const createPrompt = async () => {
  if (!editPromptTitle.value.trim() || !editPromptContent.value.trim()) return
  isSavingPrompt.value = true
  try {
    const created = await props.httpClient.postJson<PromptEntity>('/api/data/prompts', {
      title: editPromptTitle.value.trim(),
      content: editPromptContent.value.trim(),
      visibility: 'global'
    })
    showNewPromptDrawer.value = false
    await loadPrompts()
    if (created?.id) {
      selectPrompt(created.id)
    }
    showToast(text('promptCreated'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Create prompt failed')
  } finally {
    isSavingPrompt.value = false
  }
}

const deletePrompt = async (id: string) => {
  try {
    await props.httpClient.deleteJson(`/api/data/prompts/${encodeURIComponent(id)}`)
    selectedPromptId.value = ''
    await loadPrompts()
    showToast(text('promptDeleted'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Delete prompt failed')
  }
}

// ==========================================
// 4. MCP & Skills Management
// ==========================================
const mcpServers = ref<McpServerEntity[]>([])
const skillsList = ref<SkillEntity[]>([])
const isLoadingMcp = ref(false)
const isLoadingSkills = ref(false)
/** Sub-group toggle within the MCP & Skills tab. */
const mcpSkillGroup = ref<'mcp' | 'skills'>('mcp')

const loadMcpServers = async () => {
  isLoadingMcp.value = true
  try {
    const res = await props.httpClient.getJson<{ items?: McpServerEntity[] } | McpServerEntity[]>('/api/data/mcp-servers')
    const list = Array.isArray(res) ? res : res?.items ?? []
    mcpServers.value = list
  } catch (err) {
    console.error('Failed to load MCP servers:', err)
  } finally {
    isLoadingMcp.value = false
  }
}

const loadSkills = async () => {
  isLoadingSkills.value = true
  try {
    const res = await props.httpClient.getJson<{ items?: SkillEntity[] } | SkillEntity[]>('/api/data/skills')
    const list = Array.isArray(res) ? res : res?.items ?? []
    skillsList.value = list
  } catch (err) {
    console.error('Failed to load skills:', err)
  } finally {
    isLoadingSkills.value = false
  }
}

const toggleMcpServer = async (server: McpServerEntity) => {
  const nextVal = server.isActive === false
  try {
    await props.httpClient.patchJson(`/api/data/mcp-servers/${encodeURIComponent(server.id)}`, {
      isActive: nextVal
    })
    server.isActive = nextVal
    showToast(nextVal ? text('mcpServerEnabled') : text('mcpServerDisabled'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Update MCP server failed')
  }
}

const toggleSkill = async (skill: SkillEntity) => {
  const nextVal = skill.isGlobalEnabled === false
  try {
    await props.httpClient.patchJson(`/api/data/skills/${encodeURIComponent(skill.id)}`, {
      isGlobalEnabled: nextVal
    })
    skill.isGlobalEnabled = nextVal
    showToast(nextVal ? text('skillEnabled') : text('skillDisabled'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Update skill failed')
  }
}

// ==========================================
// 5. Usage Statistics Management
// ==========================================
const usageRecords = ref<AiUsageRecordItem[]>([])
const usageBuckets = ref<AiUsageStatsBucket[]>([])
const usageTotals = ref<{
  requests: number
  input: number
  output: number
  total: number
  noCache: number
  cacheRead: number
  cacheWrite: number
}>({
  requests: 0,
  input: 0,
  output: 0,
  total: 0,
  noCache: 0,
  cacheRead: 0,
  cacheWrite: 0
})
const isLoadingUsage = ref(false)
const isLoadingMoreUsage = ref(false)
const usageRangeDays = ref<1 | 7 | 30 | 365>(1)
const usageRecordsTotal = ref(0)
const usageRecordsNextCursor = ref<string | undefined>()
const usageRecordSortBy = ref<UsageRecordSortBy>('createdAt')
const usageRecordSortOrder = ref<UsageRecordSortOrder>('desc')

const usageRangeParts = (days: 7 | 30 | 365) => {
  const label = text(`rangeDays${days}` as TextKey)
  const compactLabel = label.replace(/\s+/g, '')
  return compactLabel.startsWith('近')
    ? { prefix: '近', value: compactLabel.slice(1) }
    : { prefix: '', value: label }
}

const usageWindowMs = computed(() => {
  const days = usageRangeDays.value
  return days === 1 ? 24 * 60 * 60 * 1000 : days * 24 * 60 * 60 * 1000
})

/** Cache hit rate = cache-read tokens ÷ all observable tokens (aligns with desktop). */
const usageCacheHitRate = computed(() => {
  const observable = usageTotals.value.noCache + usageTotals.value.cacheRead + usageTotals.value.cacheWrite
  return observable > 0 ? usageTotals.value.cacheRead / observable : 0
})

/** Daily average tokens = total ÷ window days (desktop `dailyAverage` card). */
const usageDailyAverage = computed(() => {
  const days = usageRangeDays.value
  return days > 0 ? usageTotals.value.total / days : 0
})

/** Chinese-style compact number: x.x 亿 / 千万 / 百万 / 万. */
const formatCompactChinese = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e8) {
    const v = value / 1e8
    return `${Number.isInteger(v) ? v : v.toFixed(1)}亿`
  }
  if (abs >= 1e7) {
    const v = value / 1e7
    return `${Number.isInteger(v) ? v : v.toFixed(1)}千万`
  }
  if (abs >= 1e6) {
    const v = value / 1e6
    return `${Number.isInteger(v) ? v : v.toFixed(1)}百万`
  }
  if (abs >= 1e4) {
    const v = value / 1e4
    return `${Number.isInteger(v) ? v : v.toFixed(1)}万`
  }
  return String(Math.round(value))
}

/** Percent formatter for cache hit rate (desktop uses percent notation). */
const formatPercent = (value: number) => {
  if (!Number.isFinite(value)) return '0%'
  return `${(value * 100).toFixed(1)}%`
}

const usageMaxBucketTokens = computed(() =>
  Math.max(1, ...usageBuckets.value.map((b) => b.totalTokens ?? 0))
)

const usageLocale = computed(() => props.language in textPacks ? props.language : fallbackLanguage)
const usageNumberFormatter = computed(() => new Intl.NumberFormat(usageLocale.value, { maximumFractionDigits: 0 }))
const usageDateFormatter = computed(() => new Intl.DateTimeFormat(usageLocale.value, { dateStyle: 'medium' }))
const usageTimeFormatter = computed(() => new Intl.DateTimeFormat(usageLocale.value, { hour: '2-digit', minute: '2-digit' }))

const usageRecordTotalTokens = (record: AiUsageRecordItem) => {
  if (record.totalTokens !== null && record.totalTokens !== undefined) return record.totalTokens
  if (record.inputTokens === null && record.outputTokens === null) return undefined
  return (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
}

const usageRecordTps = (record: AiUsageRecordItem) => {
  if (!record.outputTokens || !record.timeCompletionMs) return undefined
  const generationMs =
    record.timeFirstTokenMs !== null && record.timeFirstTokenMs !== undefined && record.timeFirstTokenMs < record.timeCompletionMs
      ? record.timeCompletionMs - record.timeFirstTokenMs
      : record.timeCompletionMs
  return generationMs > 0 ? record.outputTokens / (generationMs / 1000) : undefined
}

const formatUsageCost = (value: number | null | undefined, currency: string | null | undefined) => {
  if (value === null || value === undefined) return '–'
  const symbol = currency?.toUpperCase() === 'CNY' ? '¥' : '$'
  if (value > 0 && value < 0.0001) return `<${symbol}0.0001`
  return `${symbol}${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`
}

const formatUsageDuration = (milliseconds: number | null | undefined) => {
  if (milliseconds === null || milliseconds === undefined) return '–'
  if (milliseconds < 1000) return `${usageNumberFormatter.value.format(milliseconds)}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`
  const minutes = Math.floor(milliseconds / 60_000)
  return `${minutes}m ${((milliseconds % 60_000) / 1000).toFixed(1)}s`
}

const formatUsageTimestamp = (value: string) => {
  const date = new Date(value)
  return `${usageDateFormatter.value.format(date)} ${usageTimeFormatter.value.format(date)}`
}

const usageSourceLabel = (record: AiUsageRecordItem) => {
  if (record.sourceId) return record.sourceName || record.sourceId
  if (record.modality === 'embedding') return text('usageSourceEmbedding')
  if (record.modality === 'image') return text('usageSourceImage')
  if (record.modality === 'rerank') return text('usageSourceRerank')
  return text('usageSourceLanguage')
}

const loadUsageRecords = async () => {
  isLoadingUsage.value = true
  try {
    // 1. Database-wide aggregate statistics for the selected window
    const statsQuery = new URLSearchParams({
      groupBy: 'model',
      metric: 'tokens',
      from: String(Date.now() - usageWindowMs.value),
      to: String(Date.now()),
      limit: '50'
    })
    const statsRes = await props.httpClient.getJson<AiUsageStatsResponse>(
      `/api/data/ai-usage-records/stats?${statsQuery.toString()}`
    )
    if (statsRes?.totals) {
      usageTotals.value = {
        requests: statsRes.totals.requestCount ?? 0,
        input: statsRes.totals.totalInputTokens ?? 0,
        output: statsRes.totals.totalOutputTokens ?? 0,
        total: statsRes.totals.totalTokens ?? 0,
        noCache: statsRes.totals.totalNoCacheTokens ?? 0,
        cacheRead: statsRes.totals.totalCacheReadTokens ?? 0,
        cacheWrite: statsRes.totals.totalCacheWriteTokens ?? 0
      }
    }
    usageBuckets.value = statsRes?.buckets ?? []

    // 2. Recent invocation items: use the same cursor, sort and total contract as the desktop table.
    const recentQuery = new URLSearchParams({
      limit: '25',
      sortBy: usageRecordSortBy.value,
      sortOrder: usageRecordSortOrder.value,
      from: String(Date.now() - usageWindowMs.value),
      to: String(Date.now())
    })
    const res = await props.httpClient.getJson<AiUsageRecordListResponse>(
      `/api/data/ai-usage-records?${recentQuery.toString()}`
    )
    usageRecords.value = res.items ?? []
    usageRecordsTotal.value = res.total ?? 0
    usageRecordsNextCursor.value = res.nextCursor
  } catch (err) {
    console.error('Failed to load usage records:', err)
  } finally {
    isLoadingUsage.value = false
  }
}

const sortUsageRecords = (nextSortBy: UsageRecordSortBy) => {
  usageRecordSortOrder.value = usageRecordSortBy.value === nextSortBy && usageRecordSortOrder.value === 'desc' ? 'asc' : 'desc'
  usageRecordSortBy.value = nextSortBy
  void loadUsageRecords()
}

const loadMoreUsageRecords = async () => {
  if (!usageRecordsNextCursor.value || isLoadingMoreUsage.value) return
  isLoadingMoreUsage.value = true
  try {
    const recentQuery = new URLSearchParams({
      limit: '25',
      cursor: usageRecordsNextCursor.value,
      sortBy: usageRecordSortBy.value,
      sortOrder: usageRecordSortOrder.value,
      from: String(Date.now() - usageWindowMs.value),
      to: String(Date.now())
    })
    const res = await props.httpClient.getJson<AiUsageRecordListResponse>(
      `/api/data/ai-usage-records?${recentQuery.toString()}`
    )
    usageRecords.value = [...usageRecords.value, ...(res.items ?? [])]
    usageRecordsNextCursor.value = res.nextCursor
  } catch (err) {
    console.error('Failed to load more usage records:', err)
  } finally {
    isLoadingMoreUsage.value = false
  }
}

// ==========================================
// 6. Preferences & Web Search & Context Management
// ==========================================
const preferences = ref<WebUiPreferences>({
  showEstimatedTokens: false,
  thoughtAutoCollapse: false,
  webSearchProvider: 'tavily',
  webSearchMaxResults: 5,
  searchApiKey: '',
  searchApiHost: '',
  contextManagementEnabled: true,
  contextMaxMessages: null,
  contextTruncateThreshold: 50000,
  contextCompressEnabled: true,
  contextCompressModelId: null
})
const isSavingPreferences = ref(false)

const webSearchEngineOptions = [
  { id: 'tavily', name: 'Tavily Search' },
  { id: 'google', name: 'Google Search' },
  { id: 'bing', name: 'Bing Search' },
  { id: 'brave', name: 'Brave Search' },
  { id: 'searxng', name: 'SearXNG' },
  { id: 'jina', name: 'Jina Search' },
  { id: 'exa-mcp', name: 'Exa (MCP)' }
]

const loadPreferences = async () => {
  try {
    const data = await props.httpClient.getJson<WebUiPreferences>('/api/webui/preferences')
    if (data) {
      const selectedEngine = data.webSearchProvider || 'tavily'
      const override = data.webSearchProviderOverrides?.[selectedEngine]
      preferences.value = {
        showEstimatedTokens: Boolean(data.showEstimatedTokens),
        thoughtAutoCollapse: Boolean(data.thoughtAutoCollapse),
        webSearchProvider: selectedEngine,
        webSearchMaxResults: data.webSearchMaxResults ?? 5,
        searchApiKey: override?.apiKey || '',
        searchApiHost: override?.apiHost || '',
        contextManagementEnabled: data.contextManagementEnabled !== false,
        contextMaxMessages: data.contextMaxMessages ?? null,
        contextTruncateThreshold: data.contextTruncateThreshold ?? 50000,
        contextCompressEnabled: data.contextCompressEnabled !== false,
        contextCompressModelId: data.contextCompressModelId ?? null
      }
    }
  } catch (err) {
    console.error('Failed to load preferences:', err)
  }
}

const onWebSearchProviderChange = () => {
  preferences.value.searchApiKey = ''
  preferences.value.searchApiHost = ''
}

const saveWebSearchPreferences = async () => {
  isSavingPreferences.value = true
  try {
    const rawKey = (preferences.value.searchApiKey || '').trim()
    const rawHost = (preferences.value.searchApiHost || '').trim()
    const providerOverrides = {
      ...(preferences.value.webSearchProviderOverrides ?? {}),
      [preferences.value.webSearchProvider || 'tavily']: {
        apiKey: rawKey || undefined,
        apiHost: rawHost || undefined
      }
    }

    await props.httpClient.putJson('/api/webui/preferences', {
      webSearchProvider: preferences.value.webSearchProvider,
      webSearchMaxResults: Number(preferences.value.webSearchMaxResults),
      webSearchProviderOverrides: providerOverrides
    })
    showToast(text('searchPreferencesSaved'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Save search settings failed')
  } finally {
    isSavingPreferences.value = false
  }
}

const saveContextPreferences = async () => {
  isSavingPreferences.value = true
  try {
    await props.httpClient.putJson('/api/webui/preferences', {
      contextManagementEnabled: preferences.value.contextManagementEnabled,
      contextMaxMessages: preferences.value.contextMaxMessages,
      contextTruncateThreshold: preferences.value.contextTruncateThreshold,
      contextCompressEnabled: preferences.value.contextCompressEnabled,
      contextCompressModelId: preferences.value.contextCompressModelId || null
    })
    showToast(text('save') + ' ✓')
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Save context settings failed')
  } finally {
    isSavingPreferences.value = false
  }
}

const togglePreference = async (key: 'thoughtAutoCollapse' | 'showEstimatedTokens') => {
  preferences.value[key] = !preferences.value[key]
  isSavingPreferences.value = true
  try {
    await props.httpClient.putJson('/api/webui/preferences', {
      [key]: preferences.value[key]
    })
    showToast(text('save') + ' ✓')
    emit('settingsChanged')
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : 'Save preference failed')
  } finally {
    isSavingPreferences.value = false
  }
}

// --- Layout responsive state (mobile breakpoint drives drawer mode for nav + provider list) ---
const isMobileLayout = ref(false)
const showNavDrawer = ref(false)
const showProvidersDrawer = ref(false)
const showAgentsDrawer = ref(false)
let mobileMql: MediaQueryList | undefined
const syncMobileLayout = () => {
  if (mobileMql) {
    isMobileLayout.value = mobileMql.matches
    if (!mobileMql.matches) {
      showNavDrawer.value = false
      showProvidersDrawer.value = false
      showAgentsDrawer.value = false
    }
  }
}
onMounted(() => {
  loadAgents()
  loadProviders()
  loadModels()
  loadPrompts()
  loadMcpServers()
  loadSkills()
  loadUsageRecords()
  loadPreferences()
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mobileMql = window.matchMedia('(max-width: 900px)')
    isMobileLayout.value = mobileMql.matches
    mobileMql.addEventListener('change', syncMobileLayout)
  }
})
onBeforeUnmount(() => {
  if (mobileMql) {
    mobileMql.removeEventListener('change', syncMobileLayout)
    mobileMql = undefined
  }
})
</script>

<template>
  <div class="settings-modal-backdrop" @click.self="emit('close')">
    <div class="settings-modal" role="dialog" aria-modal="true">
      <!-- Header -->
      <header class="settings-modal-header">
        <button
          v-if="isMobileLayout"
          class="settings-nav-hamburger"
          type="button"
          :title="text('showSidebar')"
          :aria-label="text('showSidebar')"
          :aria-expanded="showNavDrawer"
          @click="showNavDrawer = true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <div class="settings-modal-title">
          <svg class="settings-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <h2>{{ text('settings') }}</h2>
        </div>
        <button class="settings-close-button" type="button" :title="text('close')" @click="emit('close')">
          ×
        </button>
      </header>

      <!-- Body Layout: Sidebar Tabs + Content Area -->
      <div class="settings-modal-body">
        <button
          v-if="isMobileLayout && showNavDrawer"
          class="settings-nav-drawer-backdrop"
          type="button"
          :aria-label="text('close')"
          @click="showNavDrawer = false"
        />
        <nav
          class="settings-nav"
          :class="{ 'settings-nav-drawer': isMobileLayout, 'settings-nav-drawer-open': isMobileLayout && showNavDrawer }"
          aria-label="Settings Categories"
        >
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'providers' }"
            type="button"
            @click="currentTab = 'providers'; showNavDrawer = false"
          >
            <span class="settings-nav-icon">🤖</span>
            <span>{{ text('modelProviders') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'prompts' }"
            type="button"
            @click="currentTab = 'prompts'; showNavDrawer = false"
          >
            <span class="settings-nav-icon">📝</span>
            <span>{{ text('promptsLibrary') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'mcp' }"
            type="button"
            @click="currentTab = 'mcp'; showNavDrawer = false"
          >
            <span class="settings-nav-icon">🧩</span>
            <span>{{ text('mcpAndSkills') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'usage' }"
            type="button"
            @click="currentTab = 'usage'; showNavDrawer = false"
          >
            <span class="settings-nav-icon">📊</span>
            <span>{{ text('usageStatistics') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'preferences' }"
            type="button"
            @click="currentTab = 'preferences'; showNavDrawer = false"
          >
            <span class="settings-nav-icon">⚙️</span>
            <span>{{ text('generalPreferences') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'agents' }"
            type="button"
            @click="currentTab = 'agents'; showNavDrawer = false"
          >
            <span class="settings-nav-icon">👤</span>
            <span>{{ text('agentsManagement') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'help' }"
            type="button"
            @click="currentTab = 'help'; showNavDrawer = false"
          >
            <span class="settings-nav-icon">?</span>
            <span>{{ text('help') }}</span>
          </button>
        </nav>

        <!-- Main Content Area -->
        <main class="settings-content-area">
          <!-- Toast notification -->
          <div v-if="toastMessage" class="settings-toast" :class="{ 'settings-toast-error': toastKind === 'error' }">
            {{ toastMessage }}
          </div>

          <!-- TAB 0: Agents Management -->
          <div v-if="currentTab === 'agents'" class="settings-tab-pane">
            <div class="prompts-layout">
              <button
                v-if="isMobileLayout && showAgentsDrawer"
                class="agents-list-drawer-backdrop"
                type="button"
                :aria-label="text('close')"
                @click="showAgentsDrawer = false"
              />
              <aside
                class="prompts-sidebar"
                :class="{
                  'agents-list-drawer': isMobileLayout,
                  'agents-list-drawer-open': isMobileLayout && showAgentsDrawer
                }"
              >
                <div class="prompts-search-wrap">
                  <input
                    v-model="agentSearchQuery"
                    class="settings-input settings-search-input"
                    type="search"
                    :placeholder="text('searchAgents')"
                  />
                  <button class="settings-btn settings-btn-sm settings-btn-primary" type="button" @click="openNewAgent">
                    + {{ text('newAgent') }}
                  </button>
                </div>
                <div class="prompts-list">
                  <div
                    v-for="ag in filteredAgents"
                    :key="ag.id"
                    class="prompt-list-item"
                    :class="{ 'prompt-list-item-selected': ag.id === selectedAgentId && !showNewAgentDrawer }"
                    @click="selectAgent(ag.id); if (isMobileLayout) showAgentsDrawer = false"
                  >
                    <div class="prompt-item-info">
                      <span class="prompt-item-title">{{ ag.name }}</span>
                      <span class="prompt-item-snippet">{{ ag.description || ag.model || '-' }}</span>
                    </div>
                  </div>
                  <div v-if="filteredAgents.length === 0" class="settings-empty-hint">
                    {{ text('noAgentsFound') }}
                  </div>
                </div>
              </aside>

              <section class="prompt-details-panel">
                <div v-if="showNewAgentDrawer || selectedAgent" class="prompt-form-wrap">
                  <div class="panel-section-header">
                    <button
                      v-if="isMobileLayout"
                      class="settings-btn settings-btn-sm agents-list-fab"
                      type="button"
                      :title="text('agentsManagement')"
                      :aria-label="text('agentsManagement')"
                      :aria-expanded="showAgentsDrawer"
                      @click="showAgentsDrawer = !showAgentsDrawer"
                    >
                      {{ text('agents') }}
                    </button>
                    <h3>{{ showNewAgentDrawer ? text('newAgent') : text('editAgent') }}</h3>
                    <div class="section-actions">
                      <button
                        v-if="!showNewAgentDrawer && selectedAgent"
                        class="settings-btn settings-btn-sm settings-btn-danger"
                        type="button"
                        @click="deleteAgent(selectedAgent.id)"
                      >
                        {{ text('delete') }}
                      </button>
                      <button
                        class="settings-btn settings-btn-sm settings-btn-primary"
                        type="button"
                        :disabled="isSavingAgent || !editAgentName.trim()"
                        @click="showNewAgentDrawer ? createAgent() : saveAgent()"
                      >
                        {{ isSavingAgent ? text('saving') : text('save') }}
                      </button>
                    </div>
                  </div>

                  <div class="settings-form-grid">
                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('agentName') }}</label>
                      <input
                        v-model="editAgentName"
                        class="settings-input"
                        type="text"
                        placeholder="e.g. Claude Code"
                      />
                    </div>

                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('agentDescription') }}</label>
                      <input
                        v-model="editAgentDescription"
                        class="settings-input"
                        type="text"
                        placeholder="e.g. AI Coding Assistant"
                      />
                    </div>

                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('primaryModel') }}</label>
                      <select v-model="editAgentModel" class="settings-select">
                        <option v-for="m in models" :key="m.id" :value="m.id">
                          {{ m.name || m.apiModelId || m.id }}
                        </option>
                      </select>
                    </div>

                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('planModel') }}</label>
                      <select v-model="editAgentPlanModel" class="settings-select">
                        <option value="">-- {{ text('reasoningNone') }} --</option>
                        <option v-for="m in models" :key="m.id" :value="m.id">
                          {{ m.name || m.apiModelId || m.id }}
                        </option>
                      </select>
                    </div>

                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('defaultPermissionMode') }}</label>
                      <select v-model="editAgentPermissionMode" class="settings-select">
                        <option value="auto">Auto (Smart Approve)</option>
                        <option value="default">Normal (Strict Confirmation)</option>
                        <option value="bypassPermissions">Bypass (Full Autonomous)</option>
                        <option value="acceptEdits">Accept Edits</option>
                      </select>
                    </div>

                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('agentInstructions') }}</label>
                      <textarea
                        v-model="editAgentInstructions"
                        class="settings-textarea"
                        rows="6"
                        :placeholder="text('agentInstructionsPlaceholder')"
                      />
                    </div>
                  </div>
                </div>
                <div v-else class="settings-empty-hint-large">
                  {{ text('selectAgentToEdit') }}
                </div>
              </section>
            </div>
          </div>

          <!-- TAB 1: Providers & Models -->
          <div v-if="currentTab === 'providers'" class="settings-tab-pane">
            <div class="providers-layout">
              <button
                v-if="isMobileLayout && showProvidersDrawer"
                class="providers-list-drawer-backdrop"
                type="button"
                :aria-label="text('close')"
                @click="showProvidersDrawer = false"
              />
              <aside
                class="providers-sidebar"
                :class="{
                  'providers-list-drawer': isMobileLayout,
                  'providers-list-drawer-open': isMobileLayout && showProvidersDrawer
                }"
              >
                <div class="providers-search-wrap">
                  <input
                    v-model="providerSearchQuery"
                    class="settings-input settings-search-input"
                    type="search"
                    :placeholder="text('searchProviders')"
                  />
                  <button class="settings-btn settings-btn-sm settings-btn-primary" type="button" @click="openCreateProvider">
                    + {{ text('newProvider') }}
                  </button>
                </div>
                <div class="providers-list">
                  <div
                    v-for="(p, index) in filteredProviders"
                    :key="p.id"
                    class="provider-list-item"
                    :class="{
                      'provider-list-item-selected': p.id === selectedProviderId,
                      'provider-list-item-dragging': isDraggingProvider && draggingProviderId === p.id,
                      'provider-list-item-drag-over': isDraggingProvider && dragOverProviderId === p.id
                    }"
                    :data-provider-id="p.id"
                    @click="onProviderClick(p.id)"
                    @pointerdown="onProviderPointerDown($event, p, index)"
                    @pointermove="onProviderPointerMove($event)"
                    @pointerup="onProviderPointerUp($event)"
                    @pointercancel="onProviderPointerUp($event)"
                  >
                    <div class="provider-item-info">
                      <span class="provider-item-name">{{ p.name || p.id }}</span>
                      <span class="provider-item-id">{{ p.id }}</span>
                    </div>
                    <label class="settings-switch" @click.stop @pointerdown.stop>
                      <input
                        type="checkbox"
                        :checked="p.isEnabled !== false"
                        @change="toggleProviderEnabled(p)"
                      />
                      <span class="settings-slider" />
                    </label>
                  </div>
                  <div v-if="filteredProviders.length === 0" class="settings-empty-hint">
                    {{ text('noProvidersFound') }}
                  </div>
                </div>
              </aside>

              <section v-if="selectedProvider && !showCreateProviderForm" class="provider-details-panel">
                <div class="panel-section-header">
                  <button
                    v-if="isMobileLayout"
                    class="settings-btn settings-btn-sm providers-list-fab"
                    type="button"
                    :title="text('modelProviders')"
                    :aria-label="text('modelProviders')"
                    :aria-expanded="showProvidersDrawer"
                    @click="showProvidersDrawer = !showProvidersDrawer"
                  >
                    {{ text('providers') }}
                  </button>
                  <h3>{{ selectedProvider.name || selectedProvider.id }}</h3>
                  <div class="section-actions">
                    <button
                      class="settings-btn settings-btn-sm settings-btn-danger"
                      type="button"
                      :disabled="isSavingProvider"
                      @click="deleteProvider"
                    >
                      {{ text('delete') }}
                    </button>
                    <button
                      class="settings-btn settings-btn-sm settings-btn-primary"
                      type="button"
                      :disabled="isSavingProvider"
                      @click="saveProviderDetails"
                    >
                      {{ isSavingProvider ? text('saving') : text('save') }}
                    </button>
                  </div>
                </div>

                <div class="settings-form-grid">
                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('providerName') }}</label>
                    <input
                      v-model="editProviderName"
                      class="settings-input"
                      type="text"
                      :placeholder="text('providerNamePlaceholder')"
                    />
                  </div>

                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('defaultChatEndpoint') }}</label>
                    <select v-model="editDefaultChatEndpoint" class="settings-select">
                      <option v-for="endpointType in customTextEndpointTypes" :key="endpointType" :value="endpointType">
                        {{ text(endpointLabels[endpointType]) }}
                      </option>
                    </select>
                  </div>

                  <div class="endpoint-config-list">
                    <div v-for="endpointType in primaryEndpointTypes" :key="endpointType" class="settings-form-row">
                      <label class="settings-label">{{ text(endpointLabels[endpointType]) }}</label>
                      <input
                        class="settings-input"
                        type="url"
                        :value="endpointBaseUrl(endpointType)"
                        :placeholder="text('endpointUrlPlaceholder')"
                        @input="updateEndpointBaseUrl(endpointType, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </div>

                  <details class="provider-more-endpoints-details">
                    <summary>{{ text('providerMoreEndpoints') }}</summary>
                    <div class="endpoint-config-list provider-more-endpoints-list">
                      <div v-for="endpointType in additionalEndpointTypes" :key="endpointType" class="settings-form-row">
                        <label class="settings-label">{{ text(endpointLabels[endpointType]) }}</label>
                        <input
                          class="settings-input"
                          type="url"
                          :value="endpointBaseUrl(endpointType)"
                          :placeholder="text('endpointUrlPlaceholder')"
                          @input="updateEndpointBaseUrl(endpointType, ($event.target as HTMLInputElement).value)"
                        />
                      </div>
                    </div>
                  </details>

                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('apiKey') }}</label>
                    <div class="api-key-input-wrap">
                      <input
                        v-model="editApiKey"
                        class="settings-input"
                        type="password"
                        :placeholder="text('apiKeyPlaceholder')"
                        @input="onApiKeyInput"
                      />
                    </div>
                  </div>

                  <details
                    class="provider-advanced-details"
                    :open="providerAdvancedOpen"
                    @toggle="providerAdvancedOpen = ($event.currentTarget as HTMLDetailsElement).open"
                  >
                    <summary>{{ text('providerAdvancedSettings') }}</summary>
                    <div class="provider-advanced-content">
                      <div class="provider-advanced-grid">
                        <div class="settings-form-row">
                          <label class="settings-label">{{ text('providerTimeout') }}</label>
                          <input v-model.number="editProviderTimeout" class="settings-input" type="number" min="1" />
                        </div>
                        <div class="settings-form-row">
                          <label class="settings-label">{{ text('providerRateLimit') }}</label>
                          <input v-model.number="editProviderRateLimit" class="settings-input" type="number" min="1" />
                        </div>
                      </div>
                      <div class="settings-form-row">
                        <label class="settings-label">{{ text('providerExtraHeaders') }}</label>
                        <textarea v-model="editProviderHeaders" class="settings-textarea" rows="3" :placeholder="text('providerExtraHeadersHint')" />
                      </div>
                      <div class="settings-form-row">
                        <label class="settings-label">{{ text('providerNotes') }}</label>
                        <textarea v-model="editProviderNotes" class="settings-textarea" rows="2" />
                      </div>
                    </div>
                  </details>

                  <div class="settings-form-row test-connection-row">
                    <button
                      class="settings-btn settings-btn-secondary"
                      type="button"
                      :disabled="testConnectionState.loading"
                      @click="testConnection"
                    >
                      <span v-if="testConnectionState.loading" class="spinner-inline" />
                      {{ testConnectionState.loading ? text('testing') : text('testConnection') }}
                    </button>
                    <span
                      v-if="testConnectionState.message"
                      class="test-connection-status"
                      :class="{ 'test-success': testConnectionState.success, 'test-failed': !testConnectionState.success }"
                    >
                      {{ testConnectionState.message }}
                    </span>
                  </div>
                </div>

                <div class="models-section">
                  <div class="models-section-header">
                    <h4>{{ text('modelList') }} ({{ currentProviderModels.length }})</h4>
                    <div class="models-actions">
                      <button
                        class="settings-btn settings-btn-sm"
                        type="button"
                        :disabled="isPullingModels"
                        @click="pullModels"
                      >
                        {{ isPullingModels ? text('pullingModels') : text('pullModels') }}
                      </button>
                      <button
                        class="settings-btn settings-btn-sm settings-btn-secondary"
                        type="button"
                        @click="showAddModelForm = !showAddModelForm"
                      >
                        {{ showAddModelForm ? text('cancel') : text('addModel') }}
                      </button>
                    </div>
                  </div>

                  <div v-if="showAddModelForm" class="add-model-inline-form">
                    <input
                      v-model="newModelId"
                      class="settings-input settings-input-sm"
                      type="text"
                      placeholder="Model ID (e.g. deepseek-chat)"
                    />
                    <input
                      v-model="newModelName"
                      class="settings-input settings-input-sm"
                      type="text"
                      placeholder="Display Name (optional)"
                    />
                    <button
                      class="settings-btn settings-btn-sm settings-btn-primary"
                      type="button"
                      :disabled="!newModelId.trim() || isAddingModel"
                      @click="addCustomModel"
                    >
                      {{ text('confirm') }}
                    </button>
                  </div>

                  <!-- Pull-sync preview: select remote models to add and local models to remove,
                       then apply both sides through the atomic reconcile endpoint. -->
                  <div v-if="showFetchedModelsDialog" class="fetched-models-dialog">
                    <div class="fetched-models-header">
                      <div class="fetched-models-title-row">
                        <h5>{{ text('modelsPulled') }}: {{ fetchedModels.length }}</h5>
                        <div class="fetched-models-bulk-actions">
                          <button
                            class="settings-btn settings-btn-sm settings-btn-secondary"
                            type="button"
                            :disabled="fetchedModels.length === 0"
                            @click="addAllFetchedModels"
                          >
                            {{ text('addAllModels') }}
                          </button>
                          <button
                            class="settings-btn settings-btn-sm settings-btn-secondary"
                            type="button"
                            :disabled="staleModels.length === 0"
                            @click="removeAllStaleModels"
                          >
                            {{ text('removeAllModels') }}
                          </button>
                        </div>
                      </div>
                      <button
                        class="settings-btn settings-btn-sm settings-btn-secondary"
                        type="button"
                        @click="showFetchedModelsDialog = false"
                      >
                        ×
                      </button>
                    </div>
                    <p class="fetched-models-hint">{{ text('fetchedModelsHint') }}</p>
                    <div class="fetched-models-list">
                      <div v-for="m in fetchedModels" :key="m.id" class="model-table-row">
                        <div class="model-row-info">
                          <span class="model-row-name">{{ m.name || m.modelId }}</span>
                          <span class="model-row-id">{{ m.modelId }}</span>
                        </div>
                        <div class="model-row-controls">
                          <button
                            class="settings-btn settings-btn-sm settings-btn-secondary"
                            type="button"
                            :disabled="testingModelId === m.id"
                            :title="text('testModel')"
                            @click.stop="testModel(m)"
                          >
                            <span v-if="testingModelId === m.id" class="spinner-inline" />
                            <span v-else>⚡ {{ text('test') }}</span>
                          </button>
                          <button
                            class="settings-btn settings-btn-sm"
                            :class="selectedFetchedModelIds.has(m.id) ? 'settings-btn-danger' : 'settings-btn-primary'"
                            type="button"
                            @click.stop="toggleFetchedModel(m.id)"
                          >
                            {{ selectedFetchedModelIds.has(m.id) ? text('delete') : text('add') }}
                          </button>
                        </div>
                      </div>
                      <template v-if="staleModels.length > 0">
                        <p class="fetched-models-stale-label">{{ text('staleModelsLabel') }} ({{ staleModels.length }})</p>
                        <div v-for="m in staleModels" :key="m.id" class="model-table-row">
                          <div class="model-row-info">
                            <span class="model-row-name">{{ m.name || m.modelId || m.id }}</span>
                            <span class="model-row-id">{{ m.modelId || m.id }}</span>
                          </div>
                          <div class="model-row-controls">
                            <button
                              class="settings-btn settings-btn-sm settings-btn-secondary"
                              type="button"
                              :disabled="testingModelId === m.id"
                              :title="text('testModel')"
                              @click.stop="testModel(m)"
                            >
                              <span v-if="testingModelId === m.id" class="spinner-inline" />
                              <span v-else>⚡ {{ text('test') }}</span>
                            </button>
                            <button
                              class="settings-btn settings-btn-sm"
                              :class="selectedStaleModelIds.has(m.id) ? 'settings-btn-danger' : 'settings-btn-secondary'"
                              type="button"
                              @click.stop="toggleStaleModel(m.id)"
                            >
                              {{ selectedStaleModelIds.has(m.id) ? text('delete') : text('cancel') }}
                            </button>
                          </div>
                        </div>
                      </template>
                    </div>
                    <footer class="fetched-models-footer">
                      <button
                        class="settings-btn settings-btn-sm settings-btn-secondary"
                        type="button"
                        :disabled="isApplyingModelSync"
                        @click="showFetchedModelsDialog = false"
                      >
                        {{ text('cancel') }}
                      </button>
                      <button
                        class="settings-btn settings-btn-sm settings-btn-primary"
                        type="button"
                        :disabled="isApplyingModelSync"
                        @click="applyModelSync"
                      >
                        {{ isApplyingModelSync ? text('saving') : text('apply') }}
                      </button>
                    </footer>
                  </div>

                  <div class="models-table-wrap">
                    <div
                      v-for="m in currentProviderModels"
                      :key="m.id"
                      class="model-table-row"
                    >
                      <div class="model-row-info">
                        <span class="model-row-name">{{ m.name || m.modelId || m.id }}</span>
                        <span class="model-row-id">{{ m.modelId || m.id }}</span>
                      </div>
                      <div class="model-row-controls">
                        <button
                          class="settings-btn-icon"
                          type="button"
                          :disabled="testingModelId === m.id"
                          :title="text('testModel')"
                          @click="testModel(m)"
                        >
                          <span v-if="testingModelId === m.id" class="spinner-inline" />
                          <span v-else>⚡</span>
                        </button>
                        <button
                          class="settings-btn-icon settings-btn-icon-danger"
                          type="button"
                          :title="text('delete')"
                          @click="deleteModel(m)"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="settings-btn-icon-svg"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="m19 6-1 14H6L5 6" />
                            <path d="M10 11v5" />
                            <path d="M14 11v5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div v-if="currentProviderModels.length === 0" class="settings-empty-hint">
                      {{ text('noModelsConfigured') }}
                    </div>
                  </div>
                </div>
              </section>
              <section v-else-if="showCreateProviderForm" class="provider-details-panel">
                <div class="panel-section-header">
                  <h3>{{ text('newProvider') }}</h3>
                  <div class="section-actions">
                    <button class="settings-btn settings-btn-sm settings-btn-secondary" type="button" @click="showCreateProviderForm = false">
                      {{ text('cancel') }}
                    </button>
                    <button
                      class="settings-btn settings-btn-sm settings-btn-primary"
                      type="button"
                      :disabled="isCreatingProvider || !editProviderName.trim()"
                      @click="createCustomProvider"
                    >
                      {{ isCreatingProvider ? text('saving') : text('create') }}
                    </button>
                  </div>
                </div>
                <div class="settings-form-grid">
                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('providerName') }}</label>
                    <input v-model="editProviderName" class="settings-input" type="text" :placeholder="text('providerNamePlaceholder')" />
                  </div>
                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('defaultChatEndpoint') }}</label>
                    <select v-model="editDefaultChatEndpoint" class="settings-select">
                      <option v-for="endpointType in customTextEndpointTypes" :key="endpointType" :value="endpointType">
                        {{ text(endpointLabels[endpointType]) }}
                      </option>
                    </select>
                  </div>
                  <div class="endpoint-config-list">
                    <div v-for="endpointType in primaryEndpointTypes" :key="endpointType" class="settings-form-row">
                      <label class="settings-label">{{ text(endpointLabels[endpointType]) }}</label>
                      <input
                        class="settings-input"
                        type="url"
                        :value="endpointBaseUrl(endpointType)"
                        :placeholder="text('endpointUrlPlaceholder')"
                        @input="updateEndpointBaseUrl(endpointType, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </div>
                  <details class="provider-more-endpoints-details">
                    <summary>{{ text('providerMoreEndpoints') }}</summary>
                    <div class="endpoint-config-list provider-more-endpoints-list">
                      <div v-for="endpointType in additionalEndpointTypes" :key="endpointType" class="settings-form-row">
                        <label class="settings-label">{{ text(endpointLabels[endpointType]) }}</label>
                        <input
                          class="settings-input"
                          type="url"
                          :value="endpointBaseUrl(endpointType)"
                          :placeholder="text('endpointUrlPlaceholder')"
                          @input="updateEndpointBaseUrl(endpointType, ($event.target as HTMLInputElement).value)"
                        />
                      </div>
                    </div>
                  </details>
                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('apiKey') }}</label>
                    <input v-model="editApiKey" class="settings-input" type="password" @input="onApiKeyInput" />
                  </div>
                </div>
              </section>
              <section v-else class="provider-details-panel">
                <div class="settings-empty-hint-large">{{ text('selectProviderToEdit') }}</div>
              </section>
            </div>
          </div>

          <!-- TAB 2: Prompts Library -->
          <div v-if="currentTab === 'prompts'" class="settings-tab-pane">
            <div class="prompts-layout">
              <aside class="prompts-sidebar">
                <div class="prompts-search-wrap">
                  <input
                    v-model="promptSearchQuery"
                    class="settings-input settings-search-input"
                    type="search"
                    :placeholder="text('searchPrompts')"
                  />
                  <button class="settings-btn settings-btn-sm settings-btn-primary" type="button" @click="openNewPrompt">
                    + {{ text('newPrompt') }}
                  </button>
                </div>
                <div class="prompts-list">
                  <div
                    v-for="pr in filteredPrompts"
                    :key="pr.id"
                    class="prompt-list-item"
                    :class="{ 'prompt-list-item-selected': pr.id === selectedPromptId && !showNewPromptDrawer }"
                    @click="selectPrompt(pr.id)"
                  >
                    <div class="prompt-item-info">
                      <span class="prompt-item-title">{{ pr.title }}</span>
                      <span class="prompt-item-snippet">{{ pr.content.slice(0, 50) }}</span>
                    </div>
                  </div>
                  <div v-if="filteredPrompts.length === 0" class="settings-empty-hint">
                    {{ text('noPromptsFound') }}
                  </div>
                </div>
              </aside>

              <section class="prompt-details-panel">
                <div v-if="showNewPromptDrawer || selectedPrompt" class="prompt-form-wrap">
                  <div class="panel-section-header">
                    <h3>{{ showNewPromptDrawer ? text('newPrompt') : text('editPrompt') }}</h3>
                    <div class="section-actions">
                      <button
                        v-if="!showNewPromptDrawer && selectedPrompt"
                        class="settings-btn settings-btn-sm settings-btn-danger"
                        type="button"
                        @click="deletePrompt(selectedPrompt.id)"
                      >
                        {{ text('delete') }}
                      </button>
                      <button
                        class="settings-btn settings-btn-sm settings-btn-primary"
                        type="button"
                        :disabled="isSavingPrompt || !editPromptTitle.trim() || !editPromptContent.trim()"
                        @click="showNewPromptDrawer ? createPrompt() : savePrompt()"
                      >
                        {{ isSavingPrompt ? text('saving') : text('save') }}
                      </button>
                    </div>
                  </div>

                  <div class="settings-form-grid">
                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('promptTitle') }}</label>
                      <input
                        v-model="editPromptTitle"
                        class="settings-input"
                        type="text"
                        :placeholder="text('promptTitlePlaceholder')"
                      />
                    </div>
                    <div class="settings-form-row">
                      <label class="settings-label">{{ text('promptContent') }}</label>
                      <textarea
                        v-model="editPromptContent"
                        class="settings-textarea"
                        rows="8"
                        :placeholder="text('promptContentPlaceholder')"
                      />
                    </div>
                  </div>
                </div>
                <div v-else class="settings-empty-hint-large">
                  {{ text('selectPromptToEdit') }}
                </div>
              </section>
            </div>
          </div>

          <!-- TAB 3: MCP & Skills (sub-grouped: MCP / Skills) -->
          <div v-if="currentTab === 'mcp'" class="settings-tab-pane">
            <div class="mcp-skills-layout">
              <div class="mcp-skills-tabs" role="tablist" aria-label="MCP and Skills">
                <button
                  class="mcp-skills-tab"
                  :class="{ 'mcp-skills-tab-active': mcpSkillGroup === 'mcp' }"
                  type="button"
                  role="tab"
                  :aria-selected="mcpSkillGroup === 'mcp'"
                  @click="mcpSkillGroup = 'mcp'"
                >
                  {{ text('mcpServers') }} ({{ mcpServers.length }})
                </button>
                <button
                  class="mcp-skills-tab"
                  :class="{ 'mcp-skills-tab-active': mcpSkillGroup === 'skills' }"
                  type="button"
                  role="tab"
                  :aria-selected="mcpSkillGroup === 'skills'"
                  @click="mcpSkillGroup = 'skills'"
                >
                  {{ text('installedSkills') }} ({{ skillsList.length }})
                </button>
              </div>

              <section v-if="mcpSkillGroup === 'mcp'" class="mcp-section">
                <div class="mcp-servers-list">
                  <div v-for="srv in mcpServers" :key="srv.id" class="mcp-card">
                    <div class="mcp-card-meta">
                      <div class="mcp-card-header">
                        <span class="mcp-card-name">{{ srv.name }}</span>
                        <span class="mcp-card-type-badge">{{ srv.type }}</span>
                      </div>
                      <span class="mcp-card-desc">{{ srv.description || srv.command || srv.baseUrl || '-' }}</span>
                    </div>
                    <label class="settings-switch">
                      <input
                        type="checkbox"
                        :checked="srv.isActive !== false"
                        @change="toggleMcpServer(srv)"
                      />
                      <span class="settings-slider" />
                    </label>
                  </div>
                  <div v-if="mcpServers.length === 0" class="settings-empty-hint">
                    {{ text('noMcpServers') }}
                  </div>
                </div>
              </section>

              <section v-if="mcpSkillGroup === 'skills'" class="skills-section">
                <div class="skills-list">
                  <div v-for="sk in skillsList" :key="sk.id" class="skill-card">
                    <div class="skill-card-meta">
                      <span class="skill-card-name">{{ sk.name }}</span>
                      <span class="skill-card-desc">{{ sk.description || '-' }}</span>
                    </div>
                    <label class="settings-switch">
                      <input
                        type="checkbox"
                        :checked="sk.isGlobalEnabled !== false"
                        @change="toggleSkill(sk)"
                      />
                      <span class="settings-slider" />
                    </label>
                  </div>
                  <div v-if="skillsList.length === 0" class="settings-empty-hint">
                    {{ text('noSkillsInstalled') }}
                  </div>
                </div>
              </section>
            </div>
          </div>

          <!-- TAB 4: Usage Statistics -->
          <div v-if="currentTab === 'usage'" class="settings-tab-pane">
            <div class="usage-panel">
              <div class="panel-section-header">
                <h3 class="usage-panel-title">{{ text('usageStatistics') }}</h3>
                <div class="usage-header-controls">
                  <div class="usage-range-switcher" role="tablist">
                    <button
                      v-for="d in ([1, 7, 30, 365] as const)"
                      :key="d"
                      class="usage-range-option"
                      :class="{ 'usage-range-option-active': usageRangeDays === d }"
                      type="button"
                      role="tab"
                      :aria-selected="usageRangeDays === d"
                      @click="usageRangeDays = d; loadUsageRecords()"
                    >
                      <template v-if="d === 1">{{ text('rangeToday') }}</template>
                      <template v-else>
                        <span v-if="usageRangeParts(d).prefix" class="usage-range-prefix">{{ usageRangeParts(d).prefix }}</span>
                        <span class="usage-range-value">{{ usageRangeParts(d).value }}</span>
                      </template>
                    </button>
                  </div>
                  <button
                    class="settings-btn settings-btn-sm settings-btn-secondary"
                    type="button"
                    :disabled="isLoadingUsage"
                    @click="loadUsageRecords"
                  >
                    <span class="usage-refresh-icon" aria-hidden="true">↻</span>
                    <span class="usage-refresh-label">{{ isLoadingUsage ? text('loading') : text('refresh') }}</span>
                  </button>
                </div>
              </div>

              <!-- Summary Cards (Direct from SQLite aggregate totals) -->
              <div class="usage-summary-grid">
                <div class="usage-stat-card">
                  <span class="usage-stat-label">{{ text('totalRequests') }}</span>
                  <span class="usage-stat-val">{{ formatCompactChinese(usageTotals.requests) }}</span>
                </div>
                <div class="usage-stat-card usage-stat-card-primary">
                  <span class="usage-stat-label">{{ text('totalTokens') }}</span>
                  <span class="usage-stat-val text-primary">{{ formatCompactChinese(usageTotals.total) }}</span>
                </div>
                <div class="usage-stat-card">
                  <span class="usage-stat-label">{{ text('cacheHitRate') }}</span>
                  <span class="usage-stat-val">{{ formatPercent(usageCacheHitRate) }}</span>
                </div>
                <div class="usage-stat-card">
                  <span class="usage-stat-label">{{ text('dailyAverageTokens') }}</span>
                  <span class="usage-stat-val">{{ formatCompactChinese(usageDailyAverage) }}</span>
                </div>
              </div>

              <!-- Top Model Usage Breakdown with bar chart -->
              <div v-if="usageBuckets.length > 0" class="usage-table-section">
                <h4>{{ text('modelList') }}</h4>
                <div class="usage-bar-chart">
                  <div
                    v-for="b in usageBuckets.slice(0, 10)"
                    :key="b.modelId || b.providerId || ''"
                    class="usage-bar-row"
                  >
                    <div class="usage-bar-meta">
                      <span class="usage-bar-name" :title="b.modelId || ''">{{ b.modelId || 'Unknown Model' }}</span>
                      <span class="usage-bar-tokens">{{ formatCompactChinese(b.totalTokens ?? 0) }}</span>
                    </div>
                    <div class="usage-bar-track">
                      <span
                        class="usage-bar-fill"
                        :style="{ width: `${Math.max(2, Math.round(((b.totalTokens ?? 0) / usageMaxBucketTokens) * 100))}%` }"
                      />
                    </div>
                    <span class="usage-bar-requests">{{ b.requestCount ?? 0 }} req · in {{ formatCompactChinese(b.totalInputTokens ?? 0) }} / out {{ formatCompactChinese(b.totalOutputTokens ?? 0) }}</span>
                  </div>
                </div>
              </div>

              <!-- Recent Calls Table: same Data API fields and sort semantics as desktop UsageEntriesTable. -->
              <div class="usage-table-section">
                <div class="usage-table-heading">
                  <h4>{{ text('recentUsageRecords') }}</h4>
                  <span class="usage-record-count">{{ usageRecordsTotal }} {{ text('usageRecords') }}</span>
                </div>
                <div class="usage-records-table-wrap">
                  <table v-if="usageRecords.length > 0" class="usage-records-table">
                    <thead>
                      <tr>
                        <th>{{ text('usageModel') }}</th>
                        <th>{{ text('usageSource') }}</th>
                        <th>
                          <button class="usage-sort-button" type="button" @click="sortUsageRecords('createdAt')">
                            {{ text('usageDate') }} {{ usageRecordSortBy === 'createdAt' ? (usageRecordSortOrder === 'asc' ? '↑' : '↓') : '↕' }}
                          </button>
                        </th>
                        <th class="usage-number-cell">
                          <button class="usage-sort-button" type="button" @click="sortUsageRecords('totalTokens')">
                            {{ text('usageTokens') }} {{ usageRecordSortBy === 'totalTokens' ? (usageRecordSortOrder === 'asc' ? '↑' : '↓') : '↕' }}
                          </button>
                        </th>
                        <th class="usage-number-cell">
                          <button class="usage-sort-button" type="button" @click="sortUsageRecords('cost')">
                            {{ text('usageCost') }} {{ usageRecordSortBy === 'cost' ? (usageRecordSortOrder === 'asc' ? '↑' : '↓') : '↕' }}
                          </button>
                        </th>
                        <th class="usage-number-cell">
                          <button class="usage-sort-button" type="button" @click="sortUsageRecords('timeFirstTokenMs')">
                            {{ text('usageTtft') }} {{ usageRecordSortBy === 'timeFirstTokenMs' ? (usageRecordSortOrder === 'asc' ? '↑' : '↓') : '↕' }}
                          </button>
                        </th>
                        <th class="usage-number-cell">
                          <button class="usage-sort-button" type="button" @click="sortUsageRecords('tokensPerSecond')">
                            {{ text('usageTps') }} {{ usageRecordSortBy === 'tokensPerSecond' ? (usageRecordSortOrder === 'asc' ? '↑' : '↓') : '↕' }}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="rec in usageRecords" :key="rec.id">
                        <td>
                          <div class="usage-record-model">
                            <span class="usage-row-model-name">{{ rec.modelName || rec.modelId || '–' }}</span>
                            <span class="usage-row-provider">{{ rec.providerName || rec.providerId || '–' }}</span>
                          </div>
                        </td>
                        <td><span class="usage-source-label">{{ usageSourceLabel(rec) }}</span></td>
                        <td><time :datetime="rec.createdAt">{{ formatUsageTimestamp(rec.createdAt) }}</time></td>
                        <td class="usage-number-cell">{{ usageRecordTotalTokens(rec) === undefined ? '–' : formatCompactChinese(usageRecordTotalTokens(rec) ?? 0) }}</td>
                        <td class="usage-number-cell">{{ formatUsageCost(rec.cost, rec.costCurrency) }}</td>
                        <td class="usage-number-cell">{{ formatUsageDuration(rec.timeFirstTokenMs) }}</td>
                        <td class="usage-number-cell">{{ usageRecordTps(rec) === undefined ? '–' : `${usageNumberFormatter.format(usageRecordTps(rec) ?? 0)} tok/s` }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="settings-empty-hint">
                    {{ isLoadingUsage ? text('loading') : text('noUsageRecords') }}
                  </div>
                </div>
                <button
                  v-if="usageRecordsNextCursor"
                  class="settings-btn settings-btn-sm settings-btn-secondary usage-load-more"
                  type="button"
                  :disabled="isLoadingMoreUsage"
                  @click="loadMoreUsageRecords"
                >
                  {{ isLoadingMoreUsage ? text('loading') : text('usageLoadMore') }}
                </button>
              </div>
            </div>
          </div>

          <!-- TAB 5: Preferences & Web Search & Context Management -->
          <div v-if="currentTab === 'preferences'" class="settings-tab-pane">
            <div class="preferences-panel">
              <!-- Context Management Section -->
              <div class="preference-section-block">
                <div class="panel-section-header">
                  <div>
                    <h3>{{ text('contextManagementTitle') }}</h3>
                    <p class="preference-section-desc">{{ text('contextManagementDesc') }}</p>
                  </div>
                  <button
                    class="settings-btn settings-btn-sm settings-btn-primary"
                    type="button"
                    :disabled="isSavingPreferences"
                    @click="saveContextPreferences"
                  >
                    {{ isSavingPreferences ? text('saving') : text('save') }}
                  </button>
                </div>

                <div class="settings-form-grid">
                  <div class="preference-item">
                    <div class="preference-item-meta">
                      <span class="preference-title">{{ text('contextManagementEnabled') }}</span>
                    </div>
                    <label class="settings-switch">
                      <input
                        v-model="preferences.contextManagementEnabled"
                        type="checkbox"
                      />
                      <span class="settings-slider" />
                    </label>
                  </div>

                  <div v-if="preferences.contextManagementEnabled" class="settings-form-row">
                    <label class="settings-label">{{ text('contextMaxMessages') }}</label>
                    <input
                      v-model.number="preferences.contextMaxMessages"
                      class="settings-input"
                      type="number"
                      min="1"
                      step="1"
                      :placeholder="text('unlimited')"
                    />
                    <span class="settings-field-hint">{{ text('contextMaxMessagesDesc') }}</span>
                  </div>

                  <div v-if="preferences.contextManagementEnabled" class="settings-form-row">
                    <label class="settings-label">{{ text('contextTruncateThreshold') }}</label>
                    <input
                      v-model.number="preferences.contextTruncateThreshold"
                      class="settings-input"
                      type="number"
                      min="1000"
                      step="1000"
                    />
                    <span class="settings-field-hint">{{ text('contextTruncateThresholdDesc') }}</span>
                  </div>

                  <div v-if="preferences.contextManagementEnabled" class="preference-item">
                    <div class="preference-item-meta">
                      <span class="preference-title">{{ text('contextCompressEnabled') }}</span>
                      <span class="preference-desc">{{ text('contextCompressEnabledDesc') }}</span>
                    </div>
                    <label class="settings-switch">
                      <input
                        v-model="preferences.contextCompressEnabled"
                        type="checkbox"
                      />
                      <span class="settings-slider" />
                    </label>
                  </div>

                  <div v-if="preferences.contextManagementEnabled && preferences.contextCompressEnabled" class="settings-form-row">
                    <label class="settings-label">{{ text('contextCompressModel') }}</label>
                    <select v-model="preferences.contextCompressModelId" class="settings-select">
                      <option :value="null">{{ text('contextCompressModelFollow') }}</option>
                      <option v-for="m in models" :key="m.id" :value="m.id">
                        {{ m.name || m.apiModelId || m.id }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Web Search Section -->
              <div class="preference-section-block">
                <div class="panel-section-header">
                  <h3>{{ text('webSearchSettings') }}</h3>
                  <button
                    class="settings-btn settings-btn-sm settings-btn-primary"
                    type="button"
                    :disabled="isSavingPreferences"
                    @click="saveWebSearchPreferences"
                  >
                    {{ isSavingPreferences ? text('saving') : text('save') }}
                  </button>
                </div>

                <div class="settings-form-grid">
                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('searchEngine') }}</label>
                    <select
                      v-model="preferences.webSearchProvider"
                      class="settings-select"
                      @change="onWebSearchProviderChange"
                    >
                      <option v-for="opt in webSearchEngineOptions" :key="opt.id" :value="opt.id">
                        {{ opt.name }}
                      </option>
                    </select>
                  </div>

                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('searchApiKey') }}</label>
                    <input
                      v-model="preferences.searchApiKey"
                      class="settings-input"
                      type="password"
                      placeholder="API Key for selected engine (e.g. tvly-...)"
                    />
                  </div>

                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('searchApiHost') }}</label>
                    <input
                      v-model="preferences.searchApiHost"
                      class="settings-input"
                      type="url"
                      placeholder="https://api.tavily.com"
                    />
                  </div>

                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('searchMaxResults') }}: {{ preferences.webSearchMaxResults }}</label>
                    <input
                      v-model.number="preferences.webSearchMaxResults"
                      class="settings-range"
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                    />
                  </div>
                </div>
              </div>

              <!-- General Display Switches -->
              <div class="preference-section-block">
                <div class="panel-section-header">
                  <h3>{{ text('generalPreferences') }}</h3>
                </div>

                <div class="preference-group">
                  <div class="preference-item">
                    <div class="preference-item-meta">
                      <span class="preference-title">{{ text('thoughtAutoCollapseTitle') }}</span>
                      <span class="preference-desc">{{ text('thoughtAutoCollapseDesc') }}</span>
                    </div>
                    <label class="settings-switch">
                      <input
                        type="checkbox"
                        :checked="preferences.thoughtAutoCollapse"
                        @change="togglePreference('thoughtAutoCollapse')"
                      />
                      <span class="settings-slider" />
                    </label>
                  </div>

                  <div class="preference-item">
                    <div class="preference-item-meta">
                      <span class="preference-title">{{ text('showEstimatedTokensTitle') }}</span>
                      <span class="preference-desc">{{ text('showEstimatedTokensDesc') }}</span>
                    </div>
                    <label class="settings-switch">
                      <input
                        type="checkbox"
                        :checked="preferences.showEstimatedTokens"
                        @change="togglePreference('showEstimatedTokens')"
                      />
                      <span class="settings-slider" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 6: Help -->
          <div v-if="currentTab === 'help'" class="settings-tab-pane">
            <div class="settings-help-panel">
              <details class="help-guide-tree" open>
                <summary><span class="settings-help-icon" aria-hidden="true">?</span><span>{{ text('helpGuide') }}</span></summary>
                <ul>
                  <li>{{ text('helpGuideIntro') }}</li>
                  <li>{{ text('helpGuideSessions') }}</li>
                  <li>{{ text('helpGuideStatus') }}</li>
                  <li>{{ text('helpGuideFiles') }}</li>
                  <li>{{ text('helpGuidePreview') }}</li>
                  <li>{{ text('helpGuideSpeech') }}</li>
                  <li>{{ text('helpGuideSecurity') }}</li>
                </ul>
              </details>

              <section class="help-runtime-section">
                <div class="help-runtime-header">
                  <h3>{{ text('runtimeDetails') }}</h3>
                  <span
                    class="bridge-indicator"
                    :class="{
                      'bridge-indicator-connected': bridgeState === 'connected',
                      'bridge-indicator-offline': bridgeState === 'offline'
                    }"
                    :title="bridgeDetail"
                    :aria-label="bridgeDetail"
                    role="status"
                  />
                </div>
                <div class="status-runtime-body">
                  <dl
                    v-for="(item, index) in statusItems"
                    :key="item.label"
                    class="status-row"
                    :class="{ 'status-row-terminal': index === statusItems.length - 1 }"
                  >
                    <dt>{{ item.label }}</dt>
                    <dd>{{ item.value }}</dd>
                  </dl>
                  <div class="version-block">
                    <dl v-for="item in versionItems" :key="item.label" class="status-row version-row">
                      <dt>{{ item.label }}</dt>
                      <dd>{{ item.value }}</dd>
                    </dl>
                    <a
                      class="settings-help-github-link"
                      :href="projectRepositoryUrl"
                      target="_blank"
                      rel="noreferrer"
                      :title="text('githubProject')"
                      :aria-label="text('githubProject')"
                    >
                      <svg
                        class="settings-help-github-icon"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.21-3.37-1.21-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.15-4.56-5.12 0-1.13.39-2.05 1.03-2.78-.1-.26-.45-1.32.1-2.75 0 0 .84-.28 2.75 1.06A9.3 9.3 0 0 1 12 6.86c.85 0 1.7.12 2.5.35 1.91-1.34 2.75-1.06 2.75-1.06.55 1.43.2 2.49.1 2.75.64.73 1.03 1.65 1.03 2.78 0 3.98-2.34 4.86-4.57 5.11.36.32.68.93.68 1.88 0 1.36-.01 2.45-.01 2.78 0 .27.18.59.69.49A10.23 10.23 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
                      </svg>
                    </a>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>
