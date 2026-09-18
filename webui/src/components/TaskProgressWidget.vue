<script setup lang="ts">
import { computed, ref } from 'vue'

import type { WebUiAgentStatus } from '../utils/agentStatus'
import type { TextKey } from '../utils/textPacks'
import { currentTaskStep, summarizeTaskProgress } from '../utils/taskProgress'

const props = defineProps<{
  status: WebUiAgentStatus
  streaming: boolean
  text: (key: TextKey) => string
}>()

const emit = defineEmits<{ abort: [] }>()

const expanded = ref(false)
const dragging = ref(false)
const position = ref<{ x: number; y: number } | null>(null)

const summary = computed(() => summarizeTaskProgress(props.status))
const headline = computed(() => {
  const step = currentTaskStep(props.status.tasks)
  return step ? (step.status === 'in_progress' && step.activeText ? step.activeText : step.title) : ''
})

const widgetStyle = () =>
  position.value
    ? { left: `${position.value.x}px`, top: `${position.value.y}px`, right: 'auto', bottom: 'auto' }
    : undefined

const DRAG_THRESHOLD = 4

let dragOffset = { x: 0, y: 0 }
let dragOrigin = { x: 0, y: 0 }
let dragMoved = false

const onPointerDown = (event: PointerEvent) => {
  // The collapse control sits inside the drag handle. Capturing its pointer would retarget
  // the following click to the handle, so the panel could never close again.
  if ((event.target as Element | null)?.closest('.task-progress-collapse')) return

  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  dragOrigin = { x: event.clientX, y: event.clientY }
  dragMoved = false
  dragging.value = true
  el.setPointerCapture?.(event.pointerId)
}
const onPointerMove = (event: PointerEvent) => {
  if (!dragging.value) return
  if (!dragMoved && Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) < DRAG_THRESHOLD) return
  dragMoved = true

  const widget = el$()
  const pad = 8
  let x = event.clientX - dragOffset.x
  let y = event.clientY - dragOffset.y
  x = Math.min(Math.max(pad, x), window.innerWidth - (widget?.offsetWidth ?? 0) - pad)
  y = Math.min(Math.max(pad, y), window.innerHeight - (widget?.offsetHeight ?? 0) - pad)
  position.value = { x, y }
}
// A drag release must not count as a click, or the ball expands every time it is moved.
const onBallClick = () => {
  if (dragMoved) return
  expanded.value = true
}
const onPointerUp = (event: PointerEvent) => {
  dragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}
const el$ = () => (typeof document === 'undefined' ? undefined : document.querySelector('.task-progress-widget')) as HTMLElement | null
</script>

<template>
  <div
    class="task-progress-widget"
    :class="{ 'is-streaming': streaming, 'is-expanded': expanded }"
    :style="widgetStyle()"
    role="status"
    aria-live="polite"
  >
    <button
      v-if="!expanded"
      class="task-progress-ball"
      type="button"
      :aria-label="text('taskProgressTitle')"
      :title="headline"
      @click="onBallClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <span class="task-progress-ball-count">{{ summary.completed }}/{{ summary.total }}</span>
    </button>

    <div v-else class="task-progress-panel">
      <header
        class="task-progress-header"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <span class="task-progress-title">{{ text('taskProgressTitle') }}</span>
        <span class="agent-status-count-badge">{{ summary.completed }}/{{ summary.total }}</span>
        <button
          class="task-progress-collapse"
          type="button"
          :aria-label="text('close')"
          @click.stop="expanded = false"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </header>

      <ul class="agent-status-list task-progress-list">
        <li
          v-for="task in status.tasks"
          :key="task.id"
          class="agent-status-item"
          :class="`agent-status-item-${task.status}`"
        >
          <span class="agent-status-item-icon" :class="`agent-status-item-icon-${task.status}`">
            <svg v-if="task.status === 'completed'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            <svg v-else-if="task.status === 'error'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            <svg v-else-if="task.status === 'in_progress'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg>
          </span>
          <span class="agent-status-item-copy">
            <span
              class="agent-status-item-title"
              :class="{ 'agent-status-item-title-completed': task.status === 'completed' }"
            >{{ task.status === 'in_progress' && task.activeText ? task.activeText : task.title }}</span>
          </span>
        </li>
      </ul>

      <footer class="task-progress-footer">
        <button
          class="task-progress-abort"
          type="button"
          :disabled="!streaming"
          @click="emit('abort')"
        >
          {{ text('taskProgressAbort') }}
        </button>
      </footer>
    </div>
  </div>
</template>