import type {
  WebUiAgentSessionEntity,
  WebUiAgentSessionMessageEntity,
  WebUiAgentStatusEvent,
  WebUiCompactionAnchor,
  WebUiContentBlock,
  WebUiConversationSummary,
  WebUiCreateSessionWorkspace,
  WebUiMessagePart,
  WebUiMessageSnapshot,
  WebUiMessageTokenStats,
  WebUiProcessGroup,
  WebUiProcessItem,
  WebUiToolCallSnapshot,
  WebUiToolCallState,
  WebUiWorkspaceType
} from '../types/api'
import { isWebUiAgentTaskEventData } from './agentStatus'
import { collapsedWorkdirGroupsStorageKey, conversationGroupNoProjectId } from './constants'

export const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unable to reach the desktop bridge'
}

export const isAbortError = (error: unknown) => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    /signal\s+is\s+aborted|abort(?:ed)?/i.test(message)
  )
}

export const normalizeWorkdirPath = (path: string | null | undefined): string | null => {
  const trimmed = path?.trim()
  if (!trimmed) return null
  return trimmed.replace(/[\\/]+$/, '') || trimmed
}

export const getWorkdirPathBasename = (path: string): string => {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return segments.at(-1) ?? path
}

export const getWorkdirPathParentBasename = (path: string): string | undefined => {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return segments.length >= 2 ? segments.at(-2) : undefined
}

export const resolveConversationWorkspaceType = (
  session: Pick<WebUiAgentSessionEntity, 'workspaceId' | 'workspace'>
): WebUiWorkspaceType => {
  if (session.workspace?.type === 'user' || session.workspace?.type === 'system') {
    return session.workspace.type
  }
  return 'system'
}

export const toConversationSummary = (session: WebUiAgentSessionEntity): WebUiConversationSummary => {
  const workspaceType = resolveConversationWorkspaceType(session)
  const workspaceId = session.workspaceId ?? session.workspace?.id
  const workspacePath =
    workspaceType === 'user' ? (normalizeWorkdirPath(session.workspace?.path) ?? undefined) : undefined
  const workspaceLabel =
    workspaceType === 'user' ? session.workspace?.name?.trim() || workspacePath || undefined : undefined

  return {
    id: session.id,
    agentId: session.agentId,
    title: session.name || 'Untitled session',
    updatedAt: session.updatedAt,
    workspaceType,
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspaceLabel ? { workspaceLabel } : {}),
    ...(workspacePath ? { workspacePath } : {})
  }
}

export type ConversationWorkdirGroupKind = 'user' | 'no-project'

export type ConversationWorkdirGroup = {
  readonly id: string
  readonly kind: ConversationWorkdirGroupKind
  readonly label: string
  readonly workspaceId?: string
  readonly workspacePath?: string
  readonly conversations: readonly WebUiConversationSummary[]
}

export const conversationGroupKey = (conversation: WebUiConversationSummary): string => {
  if (conversation.workspaceType === 'user' && conversation.workspaceId) {
    return `group:workspace:${conversation.workspaceId}`
  }
  return conversationGroupNoProjectId
}

export const buildConversationGroups = (
  conversations: readonly WebUiConversationSummary[],
  noProjectLabel: string
): readonly ConversationWorkdirGroup[] => {
  type MutableGroup = {
    id: string
    kind: ConversationWorkdirGroupKind
    workspaceId?: string
    workspacePath?: string
    labelRaw?: string
    conversations: WebUiConversationSummary[]
  }

  const groups = new Map<string, MutableGroup>()

  for (const conversation of conversations) {
    const id = conversationGroupKey(conversation)
    let group = groups.get(id)
    if (!group) {
      if (id === conversationGroupNoProjectId) {
        group = { id, kind: 'no-project', conversations: [] }
      } else {
        group = {
          id,
          kind: 'user',
          workspaceId: conversation.workspaceId,
          workspacePath: conversation.workspacePath,
          labelRaw: conversation.workspaceLabel,
          conversations: []
        }
      }
      groups.set(id, group)
    } else if (group.kind === 'user') {
      if (!group.workspacePath && conversation.workspacePath) {
        group.workspacePath = conversation.workspacePath
      }
      if (!group.labelRaw && conversation.workspaceLabel) {
        group.labelRaw = conversation.workspaceLabel
      }
    }
    group.conversations.push(conversation)
  }

  const basenameCounts = new Map<string, number>()
  for (const group of groups.values()) {
    if (group.kind !== 'user') continue
    const source = group.workspacePath ?? group.labelRaw ?? group.workspaceId ?? group.id
    const base = getWorkdirPathBasename(source)
    basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1)
  }

  const resolveUserLabel = (group: MutableGroup): string => {
    const source = group.workspacePath ?? group.labelRaw ?? group.workspaceId ?? group.id
    const base = getWorkdirPathBasename(source)
    if ((basenameCounts.get(base) ?? 0) > 1) {
      const parent = group.workspacePath ? getWorkdirPathParentBasename(group.workspacePath) : undefined
      return parent ? `${parent}/${base}` : base
    }
    return group.labelRaw?.trim() || base
  }

  const userGroups = [...groups.values()]
    .filter((group) => group.kind === 'user')
    .sort((left, right) => {
      const leftMs = Date.parse(left.conversations[0]?.updatedAt ?? '')
      const rightMs = Date.parse(right.conversations[0]?.updatedAt ?? '')
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0)
    })
    .map(
      (group): ConversationWorkdirGroup => ({
        id: group.id,
        kind: 'user',
        label: resolveUserLabel(group),
        workspaceId: group.workspaceId,
        workspacePath: group.workspacePath,
        conversations: group.conversations
      })
    )

  const noProject = groups.get(conversationGroupNoProjectId)
  const result: ConversationWorkdirGroup[] = [...userGroups]
  if (noProject) {
    result.push({
      id: noProject.id,
      kind: 'no-project',
      label: noProjectLabel,
      conversations: noProject.conversations
    })
  }
  return result
}

export const loadCollapsedWorkdirGroups = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(collapsedWorkdirGroupsStorageKey)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))
  } catch {
    return new Set()
  }
}

export const persistCollapsedWorkdirGroups = (ids: ReadonlySet<string>) => {
  try {
    window.localStorage.setItem(collapsedWorkdirGroupsStorageKey, JSON.stringify([...ids]))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export const resolveWorkspaceSeedFromConversation = (
  conversation: WebUiConversationSummary | undefined
): WebUiCreateSessionWorkspace => {
  if (conversation?.workspaceType === 'user' && conversation.workspaceId) {
    return { type: 'user', workspaceId: conversation.workspaceId }
  }
  return { type: 'system' }
}

export const terminalToolStates: ReadonlySet<WebUiToolCallState> = new Set([
  'output-available',
  'output-error',
  'output-denied'
])

export const toDisplayText = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const toToolName = (type: string, toolName?: string) => {
  if (toolName) return toolName
  if (type === 'dynamic-tool') return 'Tool'
  return type.startsWith('tool-') ? type.slice('tool-'.length) : type
}

export const toToolState = (state?: string): WebUiToolCallState => {
  switch (state) {
    case 'input-streaming':
    case 'approval-requested':
    case 'output-available':
    case 'output-error':
    case 'output-denied':
      return state
    default:
      return 'input-available'
  }
}

export const toToolCalls = (parts: readonly WebUiMessagePart[]) => {
  const tools = new Map<string, WebUiToolCallSnapshot>()

  for (const part of parts) {
    if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') continue
    const id = part.toolCallId
    if (!id) continue
    const state = part.state ?? 'input-available'
    const input = toDisplayText(part.input)
    const output = toDisplayText(part.output)
    const approvalId =
      typeof part.approval?.id === 'string' && part.approval.id.trim() ? part.approval.id.trim() : undefined
    const tool: WebUiToolCallSnapshot = {
      id,
      name: toToolName(part.type, part.toolName),
      state: toToolState(state),
      ...(approvalId ? { approvalId } : {}),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
      ...(part.errorText ? { errorText: part.errorText } : {})
    }
    tools.set(id, tool)
  }

  return [...tools.values()]
}

const HIDDEN_PROCESS_PART_TYPES = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear',
  // Rendered as its own timeline marker, not as a process-group entry.
  'data-compaction-anchor'
])

const isToolMessagePart = (part: WebUiMessagePart) => part.type.startsWith('tool-') || part.type === 'dynamic-tool'

const toToolSnapshot = (part: WebUiMessagePart): WebUiToolCallSnapshot | undefined => {
  if (!isToolMessagePart(part) || !part.toolCallId) return undefined
  const input = toDisplayText(part.input)
  const output = toDisplayText(part.output)
  const approvalId =
    typeof part.approval?.id === 'string' && part.approval.id.trim() ? part.approval.id.trim() : undefined
  return {
    id: part.toolCallId,
    name: toToolName(part.type, part.toolName),
    state: toToolState(part.state),
    ...(approvalId ? { approvalId } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(part.errorText ? { errorText: part.errorText } : {})
  }
}

export const toProcessGroups = (
  parts: readonly WebUiMessagePart[],
  messageId: string
): readonly WebUiProcessGroup[] => {
  const groups: WebUiProcessGroup[] = []
  let items: WebUiProcessItem[] = []
  let reasoningIndex = -1

  const flush = () => {
    if (items.length === 0) return
    groups.push({ id: `${messageId}:process:${groups.length}`, items })
    items = []
    reasoningIndex = -1
  }

  for (const [index, part] of parts.entries()) {
    if (HIDDEN_PROCESS_PART_TYPES.has(part.type)) continue

    if (part.type === 'reasoning') {
      const content = part.text ?? ''
      const previous = items.at(-1)
      if (previous?.kind === 'reasoning') {
        items[items.length - 1] = { ...previous, content: `${previous.content}${content}` }
      } else {
        reasoningIndex = index
        items.push({
          kind: 'reasoning',
          id: part.id ?? `${messageId}:reasoning:${reasoningIndex}`,
          content
        })
      }
      continue
    }

    if (isToolMessagePart(part)) {
      const tool = toToolSnapshot(part)
      if (!tool) continue
      const previous = items.findIndex((item) => item.kind === 'tool' && item.id === tool.id)
      if (previous >= 0) {
        items[previous] = { kind: 'tool', id: tool.id, tool }
      } else {
        items.push({ kind: 'tool', id: tool.id, tool })
      }
      continue
    }

    flush()
  }

  flush()
  return groups
}

/**
 * Build the interleaved content blocks of a turn in original part order,
 * mirroring the desktop live layout: reasoning, prose and tool calls render
 * inline as they streamed; only the final prose tail is the answer.
 */
export const toContentBlocks = (parts: readonly WebUiMessagePart[]): readonly WebUiContentBlock[] => {
  const blocks: WebUiContentBlock[] = []

  for (const part of parts) {
    if (HIDDEN_PROCESS_PART_TYPES.has(part.type)) continue

    if (part.type === 'reasoning' && typeof part.text === 'string' && part.text.trim()) {
      blocks.push({
        kind: 'reasoning',
        id: part.id ?? `reasoning:${blocks.length}`,
        content: part.text,
        isStreaming: part.state === 'streaming'
      })
      continue
    }

    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      blocks.push({
        kind: 'text',
        id: part.id ?? `text:${blocks.length}`,
        content: part.text,
        isStreaming: part.state === 'streaming'
      })
      continue
    }

    if (isToolMessagePart(part) && part.toolCallId) {
      const tool = toToolSnapshot(part)
      if (tool) blocks.push({ kind: 'tool', id: part.toolCallId, tool })
    }
  }

  return blocks
}

export const toAgentStatusEvents = (parts: readonly WebUiMessagePart[]): readonly WebUiAgentStatusEvent[] => {
  const events: WebUiAgentStatusEvent[] = []

  for (const part of parts) {
    if (part.type === 'data-agent-task-event' && isWebUiAgentTaskEventData(part.data)) {
      events.push({
        kind: 'task-event',
        id: part.id ?? `${part.data.taskId}:${part.data.event}:${events.length}`,
        data: part.data
      })
      continue
    }
    if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') continue
    if (!part.toolCallId) continue
    events.push({
      kind: 'tool',
      id: part.toolCallId,
      name: toToolName(part.type, part.toolName),
      state: toToolState(part.state),
      ...(part.input !== undefined ? { input: part.input } : {}),
      ...(part.output !== undefined ? { output: part.output } : {})
    })
  }

  return events
}

/** Extract compaction anchors from message parts. */
export const toCompactionAnchors = (parts: readonly WebUiMessagePart[]): readonly WebUiCompactionAnchor[] => {
  const anchors: WebUiCompactionAnchor[] = []
  for (const part of parts) {
    if (part.type !== 'data-compaction-anchor' || !part.data || typeof part.data !== 'object') continue
    const data = part.data as Record<string, unknown>
    const status = data.status === 'compacting' || data.status === 'done' ? data.status : 'done'
    anchors.push({
      id: part.id ?? `compaction:${anchors.length}`,
      status,
      ...(typeof data.phase === 'string' ? { phase: data.phase } : {}),
      ...(typeof data.preTokens === 'number' ? { preTokens: data.preTokens } : {}),
      ...(typeof data.postTokens === 'number' ? { postTokens: data.postTokens } : {})
    })
  }
  return anchors
}

export const upsertAgentStatusEvent = (
  events: readonly WebUiAgentStatusEvent[],
  event: WebUiAgentStatusEvent
): readonly WebUiAgentStatusEvent[] => {
  const index = events.findIndex((item) => item.kind === event.kind && item.id === event.id)
  if (index < 0) return [...events, event]
  const next = [...events]
  next[index] = event
  return next
}

export const appendProcessReasoning = (
  groups: readonly WebUiProcessGroup[],
  messageId: string,
  delta: string
): readonly WebUiProcessGroup[] => {
  if (!delta) return groups
  const next = groups.map((group) => ({ ...group, items: [...group.items] }))
  const lastGroup = next.at(-1)
  const lastItem = lastGroup?.items.at(-1)
  if (lastGroup && lastItem?.kind === 'reasoning') {
    lastGroup.items[lastGroup.items.length - 1] = {
      ...lastItem,
      content: `${lastItem.content}${delta}`,
      isStreaming: true
    }
    return next
  }

  const group = lastGroup
  if (group) {
    group.items.push({
      kind: 'reasoning',
      id: `${messageId}:stream-reasoning:${group.items.length}`,
      content: delta,
      isStreaming: true
    })
    return next
  }

  next.push({
    id: `${messageId}:process:${next.length}`,
    items: [
      {
        kind: 'reasoning',
        id: `${messageId}:stream-reasoning:${next.length}`,
        content: delta,
        isStreaming: true
      }
    ]
  })
  return next
}

export const upsertProcessTool = (
  groups: readonly WebUiProcessGroup[],
  messageId: string,
  tool: WebUiToolCallSnapshot
): readonly WebUiProcessGroup[] => {
  const next = groups.map((group) => ({ ...group, items: [...group.items] }))
  for (const group of next) {
    const index = group.items.findIndex((item) => item.kind === 'tool' && item.id === tool.id)
    if (index >= 0) {
      group.items[index] = { kind: 'tool', id: tool.id, tool }
      return next
    }
  }

  const lastGroup = next.at(-1)
  if (lastGroup) {
    const lastItem = lastGroup.items.at(-1)
    if (lastItem?.kind === 'reasoning') {
      lastGroup.items[lastGroup.items.length - 1] = { ...lastItem, isStreaming: false }
    }
    lastGroup.items.push({ kind: 'tool', id: tool.id, tool })
    return next
  }

  next.push({ id: `${messageId}:process:0`, items: [{ kind: 'tool', id: tool.id, tool }] })
  return next
}

export const settleProcessGroups = (groups: readonly WebUiProcessGroup[]): readonly WebUiProcessGroup[] =>
  groups.map((group) => ({
    ...group,
    items: group.items.map((item) => (item.kind === 'reasoning' ? { ...item, isStreaming: false } : item))
  }))

const cloneBlocks = (blocks: readonly WebUiContentBlock[]): WebUiContentBlock[] => [...blocks]

/** Append a reasoning delta to the trailing reasoning block, or open a new one. */
export const appendContentReasoning = (
  blocks: readonly WebUiContentBlock[],
  messageId: string,
  delta: string
): readonly WebUiContentBlock[] => {
  if (!delta) return blocks
  const next = cloneBlocks(blocks)
  const last = next.at(-1)
  if (last?.kind === 'reasoning') {
    next[next.length - 1] = { ...last, content: `${last.content}${delta}`, isStreaming: true }
    return next
  }
  next.push({
    kind: 'reasoning',
    id: `${messageId}:stream-reasoning:${next.length}`,
    content: delta,
    isStreaming: true
  })
  return next
}

/** Append a text delta to the trailing text block, or open a new one. */
export const appendContentText = (
  blocks: readonly WebUiContentBlock[],
  messageId: string,
  delta: string
): readonly WebUiContentBlock[] => {
  if (!delta) return blocks
  const next = cloneBlocks(blocks)
  const last = next.at(-1)
  if (last?.kind === 'text') {
    next[next.length - 1] = { ...last, content: `${last.content}${delta}`, isStreaming: true }
    return next
  }
  next.push({ kind: 'text', id: `${messageId}:stream-text:${next.length}`, content: delta, isStreaming: true })
  return next
}

/** Insert or refresh a tool block, replacing the existing one in place. */
export const upsertContentTool = (
  blocks: readonly WebUiContentBlock[],
  messageId: string,
  tool: WebUiToolCallSnapshot
): readonly WebUiContentBlock[] => {
  const next = cloneBlocks(blocks)
  const index = next.findIndex((block) => block.kind === 'tool' && block.id === tool.id)
  if (index >= 0) {
    next[index] = { kind: 'tool', id: tool.id, tool }
    return next
  }
  next.push({ kind: 'tool', id: tool.id, tool })
  return next
}

export const toMessageSnapshot = (message: WebUiAgentSessionMessageEntity): WebUiMessageSnapshot => {
  const parts = message.data.parts ?? []
  const content = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
  const reasoning = parts
    .filter((part) => part.type === 'reasoning' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
  const toolCalls = toToolCalls(parts)
  const processGroups = toProcessGroups(parts, message.id)
  const contentBlocks = toContentBlocks(parts)
  const agentStatusEvents = toAgentStatusEvents(parts)
  const compactionAnchors = toCompactionAnchors(parts)
  const attachments = parts
    .filter((part) => part.type === 'file')
    .map((part) => {
      const fileEntryId = part.providerMetadata?.cherry?.fileEntryId
      return {
        name: part.filename || 'Attachment',
        ...(part.mediaType ? { mediaType: part.mediaType } : {}),
        ...(fileEntryId ? { fileEntryId } : {})
      }
    })
  const processingTimeMs =
    message.stats?.timeCompletionMs ??
    message.stats?.timeThinkingMs ??
    parts.find((part) => part.type === 'reasoning')?.providerMetadata?.cherry?.thinkingMs
  const modelId = typeof message.modelId === 'string' && message.modelId.trim() ? message.modelId : undefined
  const tokenStats = toMessageTokenStats(message.stats)

  return {
    id: message.id,
    conversationId: message.sessionId,
    role: message.role,
    content: content || message.searchableText || '',
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(processGroups.length ? { processGroups } : {}),
    ...(contentBlocks.length ? { contentBlocks } : {}),
    ...(compactionAnchors.length ? { compactionAnchors } : {}),
    ...(agentStatusEvents.length ? { agentStatusEvents } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(modelId ? { modelId } : {}),
    status: message.status,
    ...(processingTimeMs ? { processingTimeMs } : {}),
    ...(tokenStats ? { tokenStats } : {}),
    createdAt: message.createdAt
  }
}

/**
 * Extracts the real token usage reported by the desktop (mirrors `MessageStats`).
 * Returns undefined when the row carries no stats, so callers can fall back to
 * a local estimate instead of showing nothing.
 */
export const toMessageTokenStats = (
  stats: WebUiAgentSessionMessageEntity['stats']
): WebUiMessageTokenStats | undefined => {
  if (!stats) return undefined
  const totalTokens = stats.totalTokens ?? (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)
  if (!(totalTokens > 0)) return undefined
  return {
    totalTokens,
    ...(stats.inputTokens !== undefined ? { inputTokens: stats.inputTokens } : {}),
    ...(stats.outputTokens !== undefined ? { outputTokens: stats.outputTokens } : {}),
    ...(stats.timeFirstTokenMs !== undefined ? { timeFirstTokenMs: stats.timeFirstTokenMs } : {}),
    ...(stats.timeCompletionMs !== undefined ? { timeCompletionMs: stats.timeCompletionMs } : {}),
    ...(stats.runtimeTiming ? { runtimeTiming: true } : {}),
    ...(stats.providerPerformance?.measuredOutputTokens !== undefined
      ? { measuredOutputTokens: stats.providerPerformance.measuredOutputTokens }
      : {}),
    ...(stats.providerPerformance?.generationDurationMs !== undefined
      ? { generationDurationMs: stats.providerPerformance.generationDurationMs }
      : {})
  }
}

export const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid file data'))
    )
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read file')))
    reader.readAsDataURL(file)
  })

export const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0.1, milliseconds / 1000)
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}
