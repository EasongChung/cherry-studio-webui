<script setup lang="ts">
import type { WebUiMessageSnapshot, WebUiToolCallSnapshot } from '../types/api'
import type { TextKey } from '../utils/textPacks'
import { terminalToolStates } from '../utils/helpers'

defineProps<{
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
      <span class="tool-call-name">{{ tool.name }}</span>
      <span class="tool-call-state">{{ tool.state.replaceAll('-', ' ') }}</span>
    </summary>
    <div class="tool-call-body">
      <pre v-if="tool.input" class="tool-call-data">{{ tool.input }}</pre>
      <pre v-if="tool.output" class="tool-call-data">{{ tool.output }}</pre>
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