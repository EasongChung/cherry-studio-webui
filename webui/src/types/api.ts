export type WebUiRole = 'user' | 'assistant' | 'system' | 'tool'

export type WebUiWorkspaceType = 'user' | 'system'

export type WebUiConversationSummary = {
  readonly id: string
  readonly agentId: string | null
  readonly title: string
  readonly updatedAt: string
  readonly workspaceId?: string
  readonly workspaceType?: WebUiWorkspaceType
  readonly workspaceLabel?: string
  readonly workspacePath?: string
}

export type WebUiWorkspaceFileEntry = {
  readonly path: string
  readonly name: string
  readonly isDirectory: boolean
}

export type WebUiWorkspaceFilesResponse = {
  readonly workspaceName: string
  readonly directory: string
  readonly entries: readonly WebUiWorkspaceFileEntry[]
  readonly search: string
}

export type WebUiWorkspaceTextPreview = {
  readonly kind: 'text' | 'binary'
  readonly path: string
  readonly name: string
  readonly size: number
  readonly content?: string
}

export type WebUiContextUsage = {
  readonly model: string
  readonly totalTokens: number
  readonly maxTokens: number
  readonly categories: readonly {
    readonly name: string
    readonly tokens: number
  }[]
}

export type WebUiContextUsageResponse = {
  readonly usage: WebUiContextUsage | null
}

export type WebUiSlashCommand = {
  readonly name: string
  readonly description?: string
}

export type WebUiSlashCommandsResponse = {
  readonly commands: readonly WebUiSlashCommand[]
}

/** Installed skill exposed by the desktop Data API (`GET /skills`). */
export type WebUiSkill = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly isEnabled?: boolean
}

/** Knowledge base exposed by the desktop Data API (`GET /knowledge-bases`). */
export type WebUiKnowledgeBase = {
  readonly id: string
  readonly name: string
  readonly embeddingModelId?: string | null
}

/** Semantic search hit from the WebUI knowledge-search narrow bridge. */
export type WebUiKnowledgeSearchResult = {
  readonly pageContent?: string
  readonly score?: number
  readonly rank?: number
  readonly chunkId?: string
  readonly title?: string
}

export type WebUiKnowledgeSearchResponse = {
  readonly results: readonly WebUiKnowledgeSearchResult[]
}

/** Real token usage surfaced by the desktop Data API (mirrors `MessageStats`). */
export type WebUiMessageTokenStats = {
  readonly totalTokens: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly timeFirstTokenMs?: number
  readonly timeCompletionMs?: number
  readonly runtimeTiming?: boolean
  readonly measuredOutputTokens?: number
  readonly generationDurationMs?: number
}

export type WebUiProcessItem =
  | {
      readonly kind: 'reasoning'
      readonly id: string
      readonly content: string
      readonly isStreaming?: boolean
    }
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly tool: WebUiToolCallSnapshot
    }

export type WebUiProcessGroup = {
  readonly id: string
  readonly items: readonly WebUiProcessItem[]
}

/**
 * One completed (or in-flight) context compaction, mirroring the desktop
 * `data-compaction-anchor` part. Rendered as a timeline marker that reports how
 * much prompt space the fold reclaimed.
 */
export type WebUiCompactionAnchor = {
  readonly id: string
  readonly status: 'compacting' | 'done'
  /** `in-loop` folds render inline in the process group; others render full-width. */
  readonly phase?: string
  /** Prompt size before/after the fold, when the path could measure both ends. */
  readonly preTokens?: number
  readonly postTokens?: number
}

/**
 * One ordered content block of an assistant turn, mirroring the desktop message
 * part layout: reasoning, prose and tool calls are rendered IN LINE in the order
 * they streamed, rather than folded into separate pools. Only the final prose
 * tail is the "answer"; everything before it is process history that collapses
 * once the turn completes.
 */
export type WebUiContentBlock =
  | { readonly kind: 'reasoning'; readonly id: string; readonly content: string; readonly isStreaming?: boolean }
  | { readonly kind: 'text'; readonly id: string; readonly content: string; readonly isStreaming?: boolean }
  | { readonly kind: 'tool'; readonly id: string; readonly tool: WebUiToolCallSnapshot }

export type WebUiMessageSnapshot = {
  readonly id: string
  readonly conversationId: string
  readonly role: WebUiRole
  readonly content: string
  readonly reasoning?: string
  readonly toolCalls?: readonly WebUiToolCallSnapshot[]
  /** Reasoning and tool calls grouped in their original message-part order. */
  readonly processGroups?: readonly WebUiProcessGroup[]
  /** Every reasoning/text/tool part in streaming order — drives the live interleaved layout. */
  readonly contentBlocks?: readonly WebUiContentBlock[]
  /** Context compactions that happened during this turn, in part order. */
  readonly compactionAnchors?: readonly WebUiCompactionAnchor[]
  readonly agentStatusEvents?: readonly WebUiAgentStatusEvent[]
  readonly attachments?: readonly WebUiMessageAttachmentSnapshot[]
  /** Unique model id (`providerId::modelId`) when the assistant turn was created. */
  readonly modelId?: string
  readonly status: 'pending' | 'success' | 'error' | 'paused'
  readonly processingTimeMs?: number
  /**
   * Wall-clock duration of the whole turn (row `updatedAt - createdAt`), covering
   * every stream round plus the tool execution and approval waits between them.
   * `processingTimeMs` only measures a single LLM stream, so it under-reports the
   * time the user actually waited on multi-round turns.
   */
  readonly totalElapsedMs?: number
  /** Real token usage reported by the desktop — absent when the row has no stats. */
  readonly tokenStats?: WebUiMessageTokenStats
  readonly createdAt: string
}

export type WebUiAgentTaskStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export type WebUiAgentTaskEventData = {
  readonly event: 'started' | 'progress' | 'updated' | 'notification'
  readonly taskId: string
  readonly status?: WebUiAgentTaskStatus
  readonly title?: string
  readonly activeText?: string
  readonly description?: string
  readonly summary?: string
}

export type WebUiAgentStatusEvent =
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly name: string
      readonly state: WebUiToolCallState
      readonly input?: unknown
      readonly output?: unknown
    }
  | {
      readonly kind: 'task-event'
      readonly id: string
      readonly data: WebUiAgentTaskEventData
    }

export type WebUiMessageAttachmentSnapshot = {
  readonly name: string
  readonly mediaType?: string
  /** FileManager entry id — enables preview/download via WebUI file API. */
  readonly fileEntryId?: string
}

export type WebUiSendAttachment = {
  readonly name: string
  readonly mediaType: string
  readonly size: number
  readonly dataUrl: string
}

export type WebUiToolCallState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

export type WebUiToolCallSnapshot = {
  readonly id: string
  readonly name: string
  readonly state: WebUiToolCallState
  /** Live `tool-approval-request` id — required to respond; absent on read-only history. */
  readonly approvalId?: string
  readonly input?: string
  readonly output?: string
  readonly errorText?: string
  /**
   * Structured `tool-approval-request` payload kept verbatim for interactive tools such as
   * AskUserQuestion, whose input must not be flattened to display text before rendering.
   */
  readonly rawInput?: unknown
}

export type WebUiPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

export type WebUiToolApprovalResponse = {
  readonly ok: boolean
  readonly code?: string
  readonly message?: string
}

export type WebUiPermissionModeResponse = {
  readonly permissionMode: WebUiPermissionMode
  readonly agent?: unknown
}

export type WebUiPreferencesResponse = {
  readonly showEstimatedTokens: boolean
  /** Mirrors desktop `chat.message.thought.auto_collapse` — keeps WebUI thinking blocks folded on stream. */
  readonly thoughtAutoCollapse: boolean
  /** Ordered list of pinned tool ids for the chat composer toolbar (mirrors `chat.input.toolbar.pinned_tools`). */
  readonly chatInputPinnedTools: readonly string[]
  /** Ordered list of pinned tool ids for the agent composer toolbar (mirrors `agent.input.toolbar.pinned_tools`). */
  readonly agentInputPinnedTools: readonly string[]
}

export type WebUiSseEventName = 'ready' | 'chunk' | 'sync' | 'error' | 'done'

export type WebUiSseMessage<TData = unknown> = {
  readonly event: WebUiSseEventName
  readonly data: TData
}

export type WebUiChunkPayload = {
  readonly conversationId: string
  readonly messageId: string
  readonly chunk: WebUiStreamChunk
}

export type WebUiStreamChunk = {
  readonly type: string
  readonly id?: string
  readonly data?: unknown
  readonly delta?: string
  readonly toolCallId?: string
  readonly toolName?: string
  readonly approvalId?: string
  readonly inputTextDelta?: string
  readonly input?: unknown
  readonly output?: unknown
  readonly errorText?: string
}

export type WebUiApiError = {
  readonly message: string
  readonly code?: string
}

export type WebUiHealthResponse = {
  readonly ok: true
  readonly appVersion?: string
  readonly language?: string | null
  readonly service: 'cherry-studio-webui'
  readonly startedAt: string
  readonly sseClients: number
  readonly timestamp: string
}

export type WebUiAuthStatusResponse = {
  readonly authRequired: boolean
  /** Whether the current request is already authenticated (e.g. via the remember cookie). */
  readonly authenticated?: boolean
  readonly language?: string | null
  readonly userName?: string | null
  readonly timestamp: string
}

export type WebUiCursorResponse<TItem> = {
  readonly items: readonly TItem[]
  readonly nextCursor?: string
}

export type WebUiOffsetResponse<TItem> = {
  readonly items: readonly TItem[]
  readonly total: number
  readonly page: number
}

export type WebUiAgentEntity = {
  readonly id: string
  readonly name: string
  readonly model: string | null
  readonly modelName: string | null
  readonly configuration?: {
    readonly permission_mode?: WebUiPermissionMode
    readonly [key: string]: unknown
  }
}

export type WebUiAgentWorkspace = {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly type: 'user' | 'system'
  readonly orderKey: string
}

export type WebUiModel = {
  readonly id: string
  readonly name: string
  readonly providerId: string
  readonly group?: string
  readonly isEnabled: boolean
  readonly isHidden: boolean
  readonly capabilities: readonly string[]
  readonly reasoningOptions?: readonly string[]
  readonly supportsFastMode?: boolean
}

export type WebUiModelGroup = {
  readonly id: string
  readonly name: string
  readonly models: readonly WebUiModel[]
}

export type WebUiModelsResponse = {
  readonly groups: readonly WebUiModelGroup[]
}

export type WebUiAgentSessionEntity = {
  readonly id: string
  readonly name: string
  readonly agentId: string | null
  readonly updatedAt: string
  readonly workspaceId?: string
  readonly workspace?: {
    readonly id?: string
    readonly name?: string
    readonly path?: string
    readonly type?: WebUiWorkspaceType
  }
}

/** Body for POST /api/data/agent-sessions — workspace must be system or user+id (never path). */
export type WebUiCreateSessionWorkspace =
  | { readonly type: 'system' }
  | { readonly type: 'user'; readonly workspaceId: string }

export type WebUiCreateSessionBody = {
  readonly agentId: string
  readonly name: string
  readonly workspace: WebUiCreateSessionWorkspace
}

export type WebUiMessagePart = {
  readonly type: string
  readonly id?: string
  readonly data?: unknown
  readonly text?: string
  readonly toolCallId?: string
  readonly toolName?: string
  readonly state?: string
  readonly input?: unknown
  readonly output?: unknown
  readonly errorText?: string
  readonly filename?: string
  readonly mediaType?: string
  readonly url?: string
  /** ToolUIPart approval payload — `id` is the live registry key. */
  readonly approval?: {
    readonly id?: string
    readonly approved?: boolean
    readonly reason?: string
  }
  readonly providerMetadata?: {
    readonly cherry?: {
      readonly thinkingMs?: number
      readonly fileEntryId?: string
    }
  }
}

export type WebUiAgentSessionMessageEntity = {
  readonly id: string
  readonly sessionId: string
  readonly role: Exclude<WebUiRole, 'tool'>
  readonly data: {
    readonly parts?: readonly WebUiMessagePart[]
  }
  readonly searchableText: string
  readonly status: 'pending' | 'success' | 'error' | 'paused'
  readonly modelId?: string | null
  readonly stats?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
    readonly providerPerformance?: {
      readonly measuredOutputTokens?: number
      readonly generationDurationMs?: number
    } | null
    readonly runtimeTiming?: unknown | null
    readonly timeFirstTokenMs?: number
    readonly timeCompletionMs?: number
    readonly timeThinkingMs?: number
  } | null
  readonly createdAt: string
  readonly updatedAt: string
}
