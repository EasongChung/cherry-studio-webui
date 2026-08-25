<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { createWebUiHttpClient } from '../service/httpClient'
import { fallbackLanguage } from '../utils/constants'
import { type TextKey, textPacks } from '../utils/textPacks'

export type SettingsTabId = 'providers' | 'prompts' | 'mcp' | 'usage' | 'preferences'

// --- Providers & Models Types ---
interface ProviderEndpointConfig {
  baseUrl?: string
  url?: string
  apiKey?: string
}

interface ProviderApiKeyEntry {
  id: string
  key: string
  label?: string
  isEnabled?: boolean
}

interface ProviderEntity {
  id: string
  name: string
  isEnabled?: boolean
  presetProviderId?: string
  defaultChatEndpoint?: string
  endpointConfigs?: Record<string, ProviderEndpointConfig>
  apiKeys?: ProviderApiKeyEntry[]
}

interface ModelEntity {
  id: string
  providerId: string
  name: string
  apiModelId?: string
  isEnabled?: boolean
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
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  createdAt?: string | null
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
}

const props = defineProps<{
  httpClient: ReturnType<typeof createWebUiHttpClient>
  language: string
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
let toastTimer: number | undefined
const showToast = (msg: string) => {
  toastMessage.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 2500)
}

// ==========================================
// 1. Providers & Models Management
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

const editProviderName = ref('')
const editBaseUrl = ref('')
const editApiKey = ref('')
const isApiKeyDirty = ref(false)
const showApiKeyPlain = ref(false)
const editIsEnabled = ref(true)

const showAddModelForm = ref(false)
const newModelId = ref('')
const newModelName = ref('')
const isAddingModel = ref(false)
const isPullingModels = ref(false)

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

const loadProviders = async () => {
  isLoadingProviders.value = true
  try {
    const list = await props.httpClient.getJson<ProviderEntity[]>('/api/data/providers')
    providers.value = Array.isArray(list) ? list : []
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
    const list = await props.httpClient.getJson<ModelEntity[]>('/api/data/models')
    models.value = Array.isArray(list) ? list : []
  } catch (err) {
    console.error('Failed to load models:', err)
  }
}

const selectProvider = (id: string) => {
  selectedProviderId.value = id
  testConnectionState.value = { loading: false }
  showAddModelForm.value = false
  isApiKeyDirty.value = false
  showApiKeyPlain.value = false

  const p = providers.value.find((item) => item.id === id)
  if (p) {
    editProviderName.value = p.name || ''
    editIsEnabled.value = p.isEnabled !== false
    const chatCfg =
      p.endpointConfigs?.['openai-chat-completions'] ??
      p.endpointConfigs?.['anthropic-messages'] ??
      (p.endpointConfigs ? Object.values(p.endpointConfigs)[0] : undefined)
    editBaseUrl.value = chatCfg?.baseUrl ?? chatCfg?.url ?? ''

    const firstKey = p.apiKeys?.[0]?.key
    if (firstKey) {
      editApiKey.value = firstKey.length > 8 ? `${firstKey.slice(0, 4)}••••••••${firstKey.slice(-4)}` : '••••••••'
    } else {
      editApiKey.value = ''
    }
  }
}

const onApiKeyInput = () => {
  isApiKeyDirty.value = true
}

const saveProviderDetails = async () => {
  if (!selectedProvider.value) return
  isSavingProvider.value = true
  try {
    const p = selectedProvider.value
    const chatEndpointKey = p.defaultChatEndpoint || 'openai-chat-completions'
    const endpointConfigs = {
      ...(p.endpointConfigs ?? {}),
      [chatEndpointKey]: {
        ...(p.endpointConfigs?.[chatEndpointKey] ?? {}),
        baseUrl: editBaseUrl.value.trim()
      }
    }

    await props.httpClient.patchJson(`/api/data/providers/${p.id}`, {
      name: editProviderName.value.trim() || p.name,
      isEnabled: editIsEnabled.value,
      endpointConfigs
    })

    if (isApiKeyDirty.value && editApiKey.value.trim()) {
      const rawKey = editApiKey.value.trim()
      await props.httpClient.postJson(`/api/data/providers/${p.id}/api-keys`, {
        key: rawKey
      })
    }

    await loadProviders()
    selectProvider(p.id)
    showToast(text('save') + ' ✓')
    emit('settingsChanged')
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : 'Save failed')
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
    showToast(err instanceof Error ? err.message : 'Update failed')
  }
}

const testConnection = async () => {
  if (!selectedProvider.value) return
  testConnectionState.value = { loading: true }
  try {
    const rawKey = isApiKeyDirty.value ? editApiKey.value.trim() : undefined
    const res = await props.httpClient.postJson<{
      ok: boolean
      latencyMs?: number
      error?: string
    }>('/api/webui/providers/test', {
      providerId: selectedProvider.value.id,
      baseUrl: editBaseUrl.value.trim() || undefined,
      apiKey: rawKey
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

const pullModels = async () => {
  if (!selectedProvider.value) return
  const currentPid = selectedProvider.value.id
  isPullingModels.value = true
  try {
    const res = await props.httpClient.getJson<{ models?: ModelEntity[] } | ModelEntity[]>(
      `/api/data/providers/${currentPid}/models:resolve`
    )
    const resolved = Array.isArray(res) ? res : res?.models ?? []
    if (resolved.length > 0) {
      await props.httpClient.postJson('/api/data/models:batch', {
        models: resolved.map((m: ModelEntity) => ({
          ...m,
          providerId: currentPid
        }))
      })
      await loadModels()
      showToast(`${text('modelsPulled')}: ${resolved.length}`)
      emit('settingsChanged')
    } else {
      showToast(text('noModelsFound'))
    }
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : 'Pull failed')
  } finally {
    isPullingModels.value = false
  }
}

const toggleModelEnabled = async (m: ModelEntity) => {
  const nextVal = m.isEnabled === false
  try {
    await props.httpClient.patchJson(`/api/data/models/${encodeURIComponent(m.id)}`, {
      isEnabled: nextVal
    })
    m.isEnabled = nextVal
    emit('settingsChanged')
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : 'Update model failed')
  }
}

const addCustomModel = async () => {
  if (!selectedProvider.value || !newModelId.value.trim()) return
  isAddingModel.value = true
  try {
    await props.httpClient.postJson('/api/data/models', {
      id: `${selectedProvider.value.id}:${newModelId.value.trim()}`,
      providerId: selectedProvider.value.id,
      apiModelId: newModelId.value.trim(),
      name: newModelName.value.trim() || newModelId.value.trim(),
      isEnabled: true
    })
    newModelId.value = ''
    newModelName.value = ''
    showAddModelForm.value = false
    await loadModels()
    showToast(text('modelAdded'))
    emit('settingsChanged')
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : 'Add model failed')
  } finally {
    isAddingModel.value = false
  }
}

// ==========================================
// 2. Prompts Management
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
    const list = await props.httpClient.getJson<PromptEntity[]>('/api/data/prompts')
    prompts.value = Array.isArray(list) ? list : []
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
    showToast(err instanceof Error ? err.message : 'Save prompt failed')
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
    showToast(err instanceof Error ? err.message : 'Create prompt failed')
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
    showToast(err instanceof Error ? err.message : 'Delete prompt failed')
  }
}

// ==========================================
// 3. MCP & Skills Management
// ==========================================
const mcpServers = ref<McpServerEntity[]>([])
const skillsList = ref<SkillEntity[]>([])
const isLoadingMcp = ref(false)
const isLoadingSkills = ref(false)

const loadMcpServers = async () => {
  isLoadingMcp.value = true
  try {
    const list = await props.httpClient.getJson<McpServerEntity[]>('/api/data/mcp-servers')
    mcpServers.value = Array.isArray(list) ? list : []
  } catch (err) {
    console.error('Failed to load MCP servers:', err)
  } finally {
    isLoadingMcp.value = false
  }
}

const loadSkills = async () => {
  isLoadingSkills.value = true
  try {
    const list = await props.httpClient.getJson<SkillEntity[]>('/api/data/skills')
    skillsList.value = Array.isArray(list) ? list : []
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
    showToast(err instanceof Error ? err.message : 'Update MCP server failed')
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
    showToast(err instanceof Error ? err.message : 'Update skill failed')
  }
}

// ==========================================
// 4. Usage Statistics Management
// ==========================================
const usageRecords = ref<AiUsageRecordItem[]>([])
const isLoadingUsage = ref(false)

const totalUsageStats = computed(() => {
  let reqs = usageRecords.value.length
  let input = 0
  let output = 0
  let total = 0
  for (const r of usageRecords.value) {
    input += r.inputTokens ?? 0
    output += r.outputTokens ?? 0
    total += r.totalTokens ?? (r.inputTokens ?? 0) + (r.outputTokens ?? 0)
  }
  return { requests: reqs, input, output, total }
})

const loadUsageRecords = async () => {
  isLoadingUsage.value = true
  try {
    const res = await props.httpClient.getJson<{ items?: AiUsageRecordItem[]; total?: number } | AiUsageRecordItem[]>(
      '/api/data/ai-usage-records'
    )
    const list = Array.isArray(res) ? res : res?.items ?? []
    usageRecords.value = list
  } catch (err) {
    console.error('Failed to load usage records:', err)
  } finally {
    isLoadingUsage.value = false
  }
}

// ==========================================
// 5. Preferences & Web Search
// ==========================================
const preferences = ref<{
  showEstimatedTokens: boolean
  thoughtAutoCollapse: boolean
  webSearchProvider: string
  webSearchMaxResults: number
  searchApiKey: string
  searchApiHost: string
}>({
  showEstimatedTokens: false,
  thoughtAutoCollapse: false,
  webSearchProvider: 'tavily',
  webSearchMaxResults: 5,
  searchApiKey: '',
  searchApiHost: ''
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
        searchApiHost: override?.apiHost || ''
      }
    }
  } catch (err) {
    console.error('Failed to load preferences:', err)
  }
}

const onWebSearchProviderChange = () => {
  // Clear key or reload for the new provider
  preferences.value.searchApiKey = ''
  preferences.value.searchApiHost = ''
}

const saveWebSearchPreferences = async () => {
  isSavingPreferences.value = true
  try {
    const providerOverrides = {
      [preferences.value.webSearchProvider]: {
        apiKey: preferences.value.searchApiKey.trim() || undefined,
        apiHost: preferences.value.searchApiHost.trim() || undefined
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
    showToast(err instanceof Error ? err.message : 'Save search settings failed')
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
    showToast(err instanceof Error ? err.message : 'Save preference failed')
  } finally {
    isSavingPreferences.value = false
  }
}

onMounted(() => {
  loadProviders()
  loadModels()
  loadPrompts()
  loadMcpServers()
  loadSkills()
  loadUsageRecords()
  loadPreferences()
})
</script>

<template>
  <div class="settings-modal-backdrop" @click.self="emit('close')">
    <div class="settings-modal" role="dialog" aria-modal="true">
      <!-- Header -->
      <header class="settings-modal-header">
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
        <nav class="settings-nav" aria-label="Settings Categories">
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'providers' }"
            type="button"
            @click="currentTab = 'providers'"
          >
            <span class="settings-nav-icon">🤖</span>
            <span>{{ text('modelProviders') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'prompts' }"
            type="button"
            @click="currentTab = 'prompts'"
          >
            <span class="settings-nav-icon">📝</span>
            <span>{{ text('promptsLibrary') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'mcp' }"
            type="button"
            @click="currentTab = 'mcp'"
          >
            <span class="settings-nav-icon">🧩</span>
            <span>{{ text('mcpAndSkills') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'usage' }"
            type="button"
            @click="currentTab = 'usage'"
          >
            <span class="settings-nav-icon">📊</span>
            <span>{{ text('usageStatistics') }}</span>
          </button>
          <button
            class="settings-nav-item"
            :class="{ 'settings-nav-item-active': currentTab === 'preferences' }"
            type="button"
            @click="currentTab = 'preferences'"
          >
            <span class="settings-nav-icon">⚙️</span>
            <span>{{ text('generalPreferences') }}</span>
          </button>
        </nav>

        <!-- Main Content Area -->
        <main class="settings-content-area">
          <!-- Toast notification -->
          <div v-if="toastMessage" class="settings-toast">
            {{ toastMessage }}
          </div>

          <!-- TAB 1: Providers & Models -->
          <div v-if="currentTab === 'providers'" class="settings-tab-pane">
            <div class="providers-layout">
              <aside class="providers-sidebar">
                <div class="providers-search-wrap">
                  <input
                    v-model="providerSearchQuery"
                    class="settings-input settings-search-input"
                    type="search"
                    :placeholder="text('searchProviders')"
                  />
                </div>
                <div class="providers-list">
                  <div
                    v-for="p in filteredProviders"
                    :key="p.id"
                    class="provider-list-item"
                    :class="{ 'provider-list-item-selected': p.id === selectedProviderId }"
                    @click="selectProvider(p.id)"
                  >
                    <div class="provider-item-info">
                      <span class="provider-item-name">{{ p.name || p.id }}</span>
                      <span class="provider-item-id">{{ p.id }}</span>
                    </div>
                    <label class="settings-switch" @click.stop>
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

              <section v-if="selectedProvider" class="provider-details-panel">
                <div class="panel-section-header">
                  <h3>{{ selectedProvider.name || selectedProvider.id }}</h3>
                  <div class="section-actions">
                    <button
                      class="settings-btn settings-btn-primary"
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
                      placeholder="e.g. DeepSeek"
                    />
                  </div>

                  <div class="settings-form-row">
                    <label class="settings-label">{{ text('apiHost') }} / Base URL</label>
                    <input
                      v-model="editBaseUrl"
                      class="settings-input"
                      type="url"
                      placeholder="https://api.deepseek.com/v1"
                    />
                  </div>

                  <div class="settings-form-row">
                    <label class="settings-label">API Key</label>
                    <div class="api-key-input-wrap">
                      <input
                        v-model="editApiKey"
                        class="settings-input"
                        :type="showApiKeyPlain ? 'text' : 'password'"
                        placeholder="sk-..."
                        @input="onApiKeyInput"
                      />
                      <button
                        class="settings-btn settings-btn-sm"
                        type="button"
                        @click="showApiKeyPlain = !showApiKeyPlain"
                      >
                        {{ showApiKeyPlain ? '🙈' : '👁️' }}
                      </button>
                    </div>
                  </div>

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

                  <div class="models-table-wrap">
                    <div
                      v-for="m in currentProviderModels"
                      :key="m.id"
                      class="model-table-row"
                    >
                      <div class="model-row-info">
                        <span class="model-row-name">{{ m.name || m.apiModelId || m.id }}</span>
                        <span class="model-row-id">{{ m.apiModelId || m.id }}</span>
                      </div>
                      <label class="settings-switch">
                        <input
                          type="checkbox"
                          :checked="m.isEnabled !== false"
                          @change="toggleModelEnabled(m)"
                        />
                        <span class="settings-slider" />
                      </label>
                    </div>
                    <div v-if="currentProviderModels.length === 0" class="settings-empty-hint">
                      {{ text('noModelsConfigured') }}
                    </div>
                  </div>
                </div>
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
                        class="settings-btn settings-btn-primary"
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

          <!-- TAB 3: MCP & Skills -->
          <div v-if="currentTab === 'mcp'" class="settings-tab-pane">
            <div class="mcp-skills-layout">
              <section class="mcp-section">
                <div class="panel-section-header">
                  <h4>{{ text('mcpServers') }} ({{ mcpServers.length }})</h4>
                </div>
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

              <section class="skills-section">
                <div class="panel-section-header">
                  <h4>{{ text('installedSkills') }} ({{ skillsList.length }})</h4>
                </div>
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
                <h3>{{ text('usageStatistics') }}</h3>
                <button
                  class="settings-btn settings-btn-sm settings-btn-secondary"
                  type="button"
                  :disabled="isLoadingUsage"
                  @click="loadUsageRecords"
                >
                  🔄 {{ isLoadingUsage ? text('loading') : text('refresh') }}
                </button>
              </div>

              <!-- Summary Cards -->
              <div class="usage-summary-grid">
                <div class="usage-stat-card">
                  <span class="usage-stat-label">{{ text('totalRequests') }}</span>
                  <span class="usage-stat-val">{{ totalUsageStats.requests }}</span>
                </div>
                <div class="usage-stat-card">
                  <span class="usage-stat-label">{{ text('totalTokens') }}</span>
                  <span class="usage-stat-val text-primary">{{ totalUsageStats.total.toLocaleString() }}</span>
                </div>
                <div class="usage-stat-card">
                  <span class="usage-stat-label">{{ text('inputTokens') }}</span>
                  <span class="usage-stat-val">{{ totalUsageStats.input.toLocaleString() }}</span>
                </div>
                <div class="usage-stat-card">
                  <span class="usage-stat-label">{{ text('outputTokens') }}</span>
                  <span class="usage-stat-val">{{ totalUsageStats.output.toLocaleString() }}</span>
                </div>
              </div>

              <!-- Usage Records Table -->
              <div class="usage-table-section">
                <h4>{{ text('recentUsageRecords') }}</h4>
                <div class="usage-table-wrap">
                  <div
                    v-for="rec in usageRecords.slice(0, 30)"
                    :key="rec.id"
                    class="usage-table-row"
                  >
                    <div class="usage-row-model">
                      <span class="usage-row-model-name">{{ rec.modelName || rec.modelId || 'Unknown Model' }}</span>
                      <span class="usage-row-provider">{{ rec.providerName || rec.providerId || '-' }}</span>
                    </div>
                    <div class="usage-row-tokens">
                      <span class="usage-token-badge">{{ (rec.totalTokens ?? 0).toLocaleString() }} tok</span>
                      <span class="usage-token-detail">
                        in: {{ (rec.inputTokens ?? 0).toLocaleString() }} / out: {{ (rec.outputTokens ?? 0).toLocaleString() }}
                      </span>
                    </div>
                  </div>
                  <div v-if="usageRecords.length === 0" class="settings-empty-hint">
                    {{ text('noUsageRecords') }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 5: Preferences & Web Search -->
          <div v-if="currentTab === 'preferences'" class="settings-tab-pane">
            <div class="preferences-panel">
              <!-- Web Search Section -->
              <div class="preference-section-block">
                <div class="panel-section-header">
                  <h3>{{ text('webSearchSettings') }}</h3>
                  <button
                    class="settings-btn settings-btn-primary"
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

              <!-- General Switches -->
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
        </main>
      </div>
    </div>
  </div>
</template>
