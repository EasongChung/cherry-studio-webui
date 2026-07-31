<script setup lang="ts">
import type { WebUiMessageSnapshot, WebUiToolCallSnapshot } from '../types/api'
import type { TextKey } from '../utils/textPacks'

defineProps<{
  tool: WebUiToolCallSnapshot
  message: WebUiMessageSnapshot
  text: (key: TextKey) => string
  submitting: boolean
  approvalError?: string
  preview?: string
}>()

const emit = defineEmits<{
  approve: []
  deny: []
}>()
</script>

<template>
  <div class="permission-request-panel" role="dialog" aria-labelledby="permission-request-title" aria-modal="false">
    <div class="permission-request-card">
      <div class="permission-request-header">
        <div class="permission-request-heading">
          <h2 id="permission-request-title" class="permission-request-title">
            <svg
              class="permission-request-title-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              />
            </svg>
            <span>{{ text('toolPermissionConfirmation') }}</span>
          </h2>
          <p class="permission-request-tool-name" :title="tool.name">{{ tool.name }}</p>
        </div>
        <span class="permission-request-badge">{{ text('toolPermissionPending') }}</span>
      </div>
      <div v-if="preview" class="permission-request-preview">
        <pre class="permission-request-preview-body">{{ preview }}</pre>
      </div>
      <div v-if="tool.approvalId" class="permission-request-actions">
        <button
          class="permission-request-option"
          type="button"
          :disabled="submitting"
          :aria-label="text('approveTool')"
          @click="emit('approve')"
        >
          <span class="permission-request-option-index">1</span>
          <span class="permission-request-option-label">{{ submitting ? text('approvalSubmitting') : text('approveTool') }}</span>
        </button>
        <button
          class="permission-request-option permission-request-option-deny"
          type="button"
          :disabled="submitting"
          :aria-label="text('denyTool')"
          @click="emit('deny')"
        >
          <span class="permission-request-option-index">2</span>
          <span class="permission-request-option-label">{{ text('denyTool') }}</span>
        </button>
      </div>
      <p v-else class="permission-request-readonly">{{ text('approvalReadonly') }}</p>
      <p v-if="approvalError" class="permission-request-error">{{ approvalError }}</p>
    </div>
  </div>
</template>