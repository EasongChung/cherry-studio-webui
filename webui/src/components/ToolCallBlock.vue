<script setup lang="ts">
import { computed } from 'vue'
import type { WebUiMessageSnapshot, WebUiToolCallSnapshot, WebUiToolCallState } from '../types/api'
import type { TextKey } from '../utils/textPacks'
import { terminalToolStates } from '../utils/helpers'
import { renderCode } from '../utils/renderMarkdown'
import { getToolInputLanguage, getToolPresentation, getToolTaskDescription } from '../utils/toolPresentation'

const props = defineProps<{
  tool: WebUiToolCallSnapshot
  message: WebUiMessageSnapshot
  text: (key: TextKey) => string
  submitting: boolean
  approvalError?: string
}>()

const emit = defineEmits<{
  approve: []
  deny: []
}>()

/** Semantic action label (e.g. 修改文件 / Edit file) derived from the tool name. */
const presentation = computed(() => getToolPresentation(props.tool.name))

/** Task/agent name surfaced from the tool input (e.g. 子任务 · 修复 CI workflow). */
const taskDescription = computed(() => getToolTaskDescription(props.tool.name, props.tool.input))

const STATE_LABEL_KEYS: Record<WebUiToolCallState, TextKey> = {
  'input-streaming': 'toolStateStreaming',
  'input-available': 'toolStateReady',
  'approval-requested': 'toolStateApproval',
  'output-available': 'toolStateDone',
  'output-error': 'toolStateError',
  'output-denied': 'toolStateDenied'
}

/** Localized status badge text. */
const stateLabel = computed(() => props.text(STATE_LABEL_KEYS[props.tool.state] ?? 'toolStateReady'))

/** Syntax-highlighted input, empty when absent. */
const highlightedInput = computed(() =>
  props.tool.input ? renderCode(props.tool.input, getToolInputLanguage(props.tool.name, props.tool.input)) : ''
)

/** Syntax-highlighted output, empty when absent. */
const highlightedOutput = computed(() =>
  props.tool.output ? renderCode(props.tool.output, getToolInputLanguage(props.tool.name, props.tool.output)) : ''
)
</script>

<template>
  <details
    class="tool-call"
    :class="`tool-call-${tool.state}`"
    :open="
      (message.status === 'pending' && !terminalToolStates.has(tool.state)) ||
      tool.state === 'approval-requested'
    "
  >
    <summary>
      <span class="tool-state-indicator" aria-hidden="true" />
      <span class="tool-call-icon" aria-hidden="true">{{ presentation.icon }}</span>
      <span class="tool-call-name">{{ text(presentation.labelKey) }}</span>
      <span v-if="taskDescription" class="tool-call-task" :title="taskDescription">{{ taskDescription }}</span>
      <span class="tool-call-state">{{ stateLabel }}</span>
    </summary>
    <div class="tool-call-body">
      <div v-if="highlightedInput" class="tool-call-data" v-html="highlightedInput" />
      <div v-if="highlightedOutput" class="tool-call-data" v-html="highlightedOutput" />
      <p v-if="tool.errorText" class="tool-call-error">{{ tool.errorText }}</p>
      <div v-if="tool.state === 'approval-requested'" class="tool-approval-bar">
        <div v-if="tool.approvalId" class="tool-approval-actions">
          <button
            class="tool-approval-button tool-approval-button-approve"
            type="button"
            :disabled="submitting"
            @click.prevent.stop="emit('approve')"
          >
            {{ submitting ? text('approvalSubmitting') : text('approveTool') }}
          </button>
          <button
            class="tool-approval-button tool-approval-button-deny"
            type="button"
            :disabled="submitting"
            @click.prevent.stop="emit('deny')"
          >
            {{ text('denyTool') }}
          </button>
        </div>
        <p v-else class="tool-approval-readonly">{{ text('approvalReadonly') }}</p>
        <p v-if="approvalError" class="tool-call-error">{{ approvalError }}</p>
      </div>
    </div>
  </details>
</template>
