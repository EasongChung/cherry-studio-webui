<script setup lang="ts">
import type { TextKey } from '../utils/textPacks'

defineProps<{
  modelValue: string
  error: string
  text: (key: TextKey) => string
  logoPath: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'verify': []
}>()
</script>

<template>
  <main class="auth-shell">
    <section class="auth-panel">
      <img class="brand-logo" :src="logoPath" alt="Cherry Studio" />
      <h1>{{ text('authTitle') }}</h1>
      <p class="empty-copy">{{ text('authDescription') }}</p>
      <label class="field-label" for="webui-auth-key">{{ text('authKey') }}</label>
      <div class="auth-field-row">
        <input
          id="webui-auth-key"
          autocomplete="current-password"
          type="password"
          :value="modelValue"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="emit('verify')"
        />
        <button
          class="auth-submit-button"
          type="button"
          :title="text('verify')"
          :aria-label="text('verify')"
          @click="emit('verify')"
        >
          ↑
        </button>
      </div>
      <p v-if="error" class="composer-error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>