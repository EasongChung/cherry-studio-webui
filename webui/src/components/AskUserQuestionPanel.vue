<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WebUiMessageSnapshot, WebUiToolCallSnapshot } from '../types/api'
import type { TextKey } from '../utils/textPacks'

/**
 * WebUI 复刻主程序「助手向用户提问」面板（AskUserQuestion）。
 * 数据源是 tool-approval-request 分片的 rawInput（结构化 questions），
 * 用户作答后通过 tool-approvals 通道以 updatedInput 回传答案。
 */

type AskUserQuestionOption = {
  label: string
  description?: string
}

type AskUserQuestionItem = {
  question: string
  header?: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

const props = defineProps<{
  tool: WebUiToolCallSnapshot
  message: WebUiMessageSnapshot
  text: (key: TextKey) => string
  submitting: boolean
  approvalError?: string
}>()

const emit = defineEmits<{
  submit: [updatedInput: Record<string, unknown>]
  deny: []
}>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const safeParseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Tolerant parser aligned with the desktop AskUserQuestion tool input shape. */
const parseQuestions = (raw: unknown): AskUserQuestionItem[] => {
  const input = (isRecord(raw) ? raw : safeParseJson(raw)) ?? {}
  const questions = (input as { questions?: unknown }).questions
  if (!Array.isArray(questions)) return []
  const items: AskUserQuestionItem[] = []
  for (const q of questions) {
    if (!isRecord(q)) continue
    const question = typeof q.question === 'string' ? q.question : ''
    const options = Array.isArray(q.options)
      ? q.options
          .filter(isRecord)
          .map((o) => ({
            label: typeof o.label === 'string' ? o.label : '',
            ...(typeof o.description === 'string' ? { description: o.description } : {})
          }))
          .filter((o) => o.label.length > 0)
      : []
    if (!question || options.length === 0) continue
    items.push({
      question,
      header: typeof q.header === 'string' && q.header ? q.header : undefined,
      options,
      multiSelect: q.multiSelect === true
    })
  }
  return items
}

const questions = computed(() => parseQuestions(props.tool.rawInput ?? props.tool.input))

const currentIndex = ref(0)
const selectedByIndex = ref<Record<number, string[]>>({})
const customByIndex = ref<Record<number, string>>({})

const currentQuestion = computed((): AskUserQuestionItem => {
  const q = questions.value[currentIndex.value]
  /* istanbul ignore next — guarded by v-if="questions.length" in template */
  if (!q) throw new Error('unreachable: currentQuestion called without questions')
  return q
})
const totalQuestions = computed(() => questions.value.length)
const isFirst = computed(() => currentIndex.value === 0)
const isLast = computed(() => currentIndex.value === totalQuestions.value - 1)
const selectedForCurrent = computed(() => selectedByIndex.value[currentIndex.value] ?? [])

const hasAnyAnswer = computed(() => Object.values(selectedByIndex.value).some((values) => values.length > 0))

/** Answers are keyed by question text, matching the desktop composer. */
const buildAnswers = (): Record<string, string> => {
  const answers: Record<string, string> = {}
  questions.value.forEach((question, index) => {
    const values = selectedByIndex.value[index] ?? []
    if (values.length > 0) answers[question.question] = values.join(', ')
  })
  return answers
}

const buildUpdatedInput = (): Record<string, unknown> | undefined => {
  const answers = buildAnswers()
  const original = isRecord(props.tool.rawInput)
    ? props.tool.rawInput
    : { questions: questions.value.map((q) => ({ ...q })) }
  return { ...original, answers }
}

const emitSubmit = () => {
  if (props.submitting) return
  const updatedInput = buildUpdatedInput()
  if (!updatedInput || !hasAnyAnswer.value) return
  emit('submit', updatedInput)
}

const handleSelectOption = (label: string) => {
  if (!currentQuestion.value || props.submitting) return
  const current = selectedForCurrent.value
  const nextForCurrent = currentQuestion.value.multiSelect
    ? current.includes(label)
      ? current.filter((value) => value !== label)
      : [...current, label]
    : [label]
  selectedByIndex.value = { ...selectedByIndex.value, [currentIndex.value]: nextForCurrent }
  if (!currentQuestion.value.multiSelect) {
    if (isLast.value) emitSubmit()
    else currentIndex.value += 1
  }
}

const handleCustomAnswer = () => {
  if (props.submitting) return
  const custom = (customByIndex.value[currentIndex.value] ?? '').trim()
  if (custom) {
    selectedByIndex.value = { ...selectedByIndex.value, [currentIndex.value]: [custom] }
    if (isLast.value) {
      emitSubmit()
      return
    }
  } else if (isLast.value && hasAnyAnswer.value) {
    emitSubmit()
    return
  }
  if (!isLast.value) currentIndex.value += 1
}

const handleDeny = () => {
  if (props.submitting) return
  emit('deny')
}
</script>

<template>
  <div class="permission-request-panel" role="dialog" aria-labelledby="ask-user-question-title" aria-modal="false">
    <div class="permission-request-card">
      <template v-if="questions.length">
        <div class="permission-request-header">
          <div class="permission-request-heading">
            <h2 id="ask-user-question-title" class="permission-request-title">
              <span class="ask-user-question-title-icon" aria-hidden="true">?</span>
              <span>{{ text('askUserQuestionTitle') }}</span>
            </h2>
            <p class="permission-request-tool-name">
              {{ text('askUserQuestionProgress') }} {{ currentIndex + 1 }}/{{ totalQuestions }}
            </p>
          </div>
          <button
            class="ask-user-question-close"
            type="button"
            :disabled="submitting"
            :aria-label="text('askUserQuestionClose')"
            @click="handleDeny"
          >
            ×
          </button>
        </div>

        <h3 class="ask-user-question-question">{{ currentQuestion.question }}</h3>

        <div class="ask-user-question-options">
          <button
            v-for="(option, index) in currentQuestion.options"
            :key="`${option.label}-${index}`"
            class="ask-user-question-option"
            :class="{ 'ask-user-question-option-selected': selectedForCurrent.includes(option.label) }"
            type="button"
            :disabled="submitting"
            :aria-pressed="selectedForCurrent.includes(option.label)"
            @click="handleSelectOption(option.label)"
          >
            <span class="ask-user-question-option-index">{{ index + 1 }}</span>
            <span class="ask-user-question-option-body">
              <span class="ask-user-question-option-label">{{ option.label }}</span>
              <span v-if="option.description" class="ask-user-question-option-description">{{ option.description }}</span>
            </span>
            <span
              v-if="currentQuestion.multiSelect"
              class="ask-user-question-multi"
              :class="{ 'ask-user-question-multi-checked': selectedForCurrent.includes(option.label) }"
              aria-hidden="true"
            >✓</span>
          </button>
        </div>

        <div class="ask-user-question-custom-row">
          <input
            v-model="customByIndex[currentIndex]"
            class="ask-user-question-custom-input"
            type="text"
            :disabled="submitting"
            :placeholder="text('askUserQuestionCustomPlaceholder')"
            @keydown.enter.prevent="handleCustomAnswer"
          />
          <button
            class="ask-user-question-custom-submit"
            type="button"
            :disabled="submitting"
            @click="handleCustomAnswer"
          >
            {{ text('askUserQuestionSubmit') }}
          </button>
        </div>

        <div class="ask-user-question-nav">
          <button
            class="ask-user-question-nav-button"
            type="button"
            :disabled="isFirst || submitting"
            @click="currentIndex -= 1"
          >
            {{ text('askUserQuestionPrevious') }}
          </button>
          <span class="ask-user-question-nav-spacer" />
          <button
            v-if="!isLast"
            class="ask-user-question-nav-button"
            type="button"
            :disabled="submitting"
            @click="currentIndex += 1"
          >
            {{ text('askUserQuestionNext') }}
          </button>
          <button
            v-else
            class="ask-user-question-nav-button ask-user-question-nav-submit"
            type="button"
            :disabled="!hasAnyAnswer || submitting"
            @click="emitSubmit"
          >
            {{ text('askUserQuestionSubmit') }}
          </button>
        </div>

        <p v-if="approvalError" class="permission-request-error">{{ approvalError }}</p>
      </template>
      <template v-else>
        <!-- Parsing failed (no structured questions): fall back to a read-only preview with a dismiss action. -->
        <div class="permission-request-header">
          <div class="permission-request-heading">
            <h2 id="ask-user-question-title" class="permission-request-title">
              <span class="ask-user-question-title-icon" aria-hidden="true">?</span>
              <span>{{ text('askUserQuestionTitle') }}</span>
            </h2>
            <p class="permission-request-tool-name">{{ tool.name }}</p>
          </div>
          <span class="permission-request-badge">{{ text('toolPermissionPending') }}</span>
        </div>
        <div v-if="tool.input" class="permission-request-preview">
          <pre class="permission-request-preview-body">{{ tool.input }}</pre>
        </div>
        <div class="permission-request-actions">
          <button
            class="permission-request-option permission-request-option-deny"
            type="button"
            :disabled="submitting"
            :aria-label="text('denyTool')"
            @click="handleDeny"
          >
            <span class="permission-request-option-index">1</span>
            <span class="permission-request-option-label">{{ submitting ? text('approvalSubmitting') : text('denyTool') }}</span>
          </button>
        </div>
        <p v-if="approvalError" class="permission-request-error">{{ approvalError }}</p>
      </template>
    </div>
  </div>
</template>
