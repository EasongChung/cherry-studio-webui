import type { TextKey } from './textPacks'

/**
 * Semantic presentation for a tool call card, mirroring the desktop `ToolHeader`
 * behaviour: every tool name maps to a human-readable action label + icon, and
 * its input/output render as a syntax-highlighted code block.
 *
 * The label is an i18n key so each of the 12 language packs controls its own copy.
 */

type ToolPresentation = {
  /** Compact emoji icon shown on the card's left edge. */
  readonly icon: string
  /** i18n key for the semantic action label (e.g. 修改文件 / Edit file). */
  readonly labelKey: TextKey
  /** Code language for highlighting the tool input/output, when one is clear. */
  readonly language?: string
}

const TOOL_PRESENTATIONS: Record<string, ToolPresentation> = {
  Bash: { icon: '💻', labelKey: 'toolRunCommand', language: 'bash' },
  BashOutput: { icon: '💻', labelKey: 'toolRunCommand', language: 'bash' },
  Read: { icon: '👁️', labelKey: 'toolReadFile' },
  Write: { icon: '📝', labelKey: 'toolModifyFile' },
  Edit: { icon: '📝', labelKey: 'toolModifyFile' },
  MultiEdit: { icon: '📝', labelKey: 'toolModifyFile' },
  NotebookEdit: { icon: '📝', labelKey: 'toolModifyFile' },
  TodoWrite: { icon: '📝', labelKey: 'toolModifyFile' },
  Glob: { icon: '🔍', labelKey: 'toolSearch' },
  Grep: { icon: '🔍', labelKey: 'toolSearch' },
  Search: { icon: '🔍', labelKey: 'toolSearch' },
  WebSearch: { icon: '🌐', labelKey: 'toolWebSearch' },
  WebFetch: { icon: '🌐', labelKey: 'toolWebFetch' },
  Workflow: { icon: '🚀', labelKey: 'toolWorkflow' },
  Skill: { icon: '🧰', labelKey: 'toolSkill' },
  Task: { icon: '✅', labelKey: 'toolTask' },
  TaskCreate: { icon: '✅', labelKey: 'toolTask' },
  TaskGet: { icon: '✅', labelKey: 'toolTask' },
  TaskList: { icon: '✅', labelKey: 'toolTask' },
  TaskOutput: { icon: '✅', labelKey: 'toolTask' },
  TaskStop: { icon: '✅', labelKey: 'toolTask' },
  TaskUpdate: { icon: '✅', labelKey: 'toolTask' },
  Agent: { icon: '🤖', labelKey: 'toolAgent' },
  SendMessage: { icon: '🤖', labelKey: 'toolAgent' }
}

const DEFAULT_TOOL_PRESENTATION: ToolPresentation = { icon: '🔧', labelKey: 'toolGeneric' }

/** Resolve the presentation for a tool by its semantic name. */
export const getToolPresentation = (toolName: string): ToolPresentation =>
  TOOL_PRESENTATIONS[toolName] ?? DEFAULT_TOOL_PRESENTATION

/** Tools whose card should surface a task/agent name alongside the action label. */
const TASK_DISPLAY_TOOLS = new Set([
  'Agent',
  'Task',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'Workflow',
  'Skill'
])

const isTaskDisplayTool = (toolName: string) => TASK_DISPLAY_TOOLS.has(toolName)

/**
 * Extract a human task name from a tool's JSON input, mirroring the desktop
 * `getReadableToolActivity` fallback (description → subject → prompt → summary).
 * Agent/Task/Workflow/Skill tools show this as the card subtitle so a subagent
 * row reads as e.g. "子任务 · 修复 CI workflow" instead of a bare tool name.
 */
export const getToolTaskDescription = (toolName: string, input: string | undefined): string | undefined => {
  if (!isTaskDisplayTool(toolName) || !input) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const candidate =
    record.description ??
    record.subject ??
    record.prompt ??
    record.summary ??
    record.taskName ??
    record.activeForm ??
    record.name
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

/** Pick a code language for syntax highlighting, preferring a known tool language. */
export const getToolInputLanguage = (toolName: string, input: string | undefined): string => {
  const known = TOOL_PRESENTATIONS[toolName]?.language
  if (known) return known
  if (!input) return 'text'
  const trimmed = input.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  return 'text'
}
