import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { TextKey } from '../../utils/textPacks'
import AuthPanel from '../AuthPanel.vue'

const text = (key: TextKey): string => key

const mountAuthPanel = (
  props: { modelValue?: string; error?: string; rememberVerify?: 'off' | '3h' | '1d' | '1w' } = {}
) =>
  mount(AuthPanel, {
    props: {
      modelValue: props.modelValue ?? '',
      error: props.error ?? '',
      rememberVerify: props.rememberVerify ?? 'off',
      text,
      logoPath: './icon.png'
    }
  })

describe('AuthPanel', () => {
  it('renders the brand logo, title, input and submit button', () => {
    const wrapper = mountAuthPanel()
    expect(wrapper.find('img.brand-logo').attributes('src')).toBe('./icon.png')
    expect(wrapper.find('h1').text()).toBe('authTitle')
    expect(wrapper.find('input#webui-auth-key').exists()).toBe(true)
    expect(wrapper.find('button.auth-submit-button').exists()).toBe(true)
  })

  it('reflects modelValue and emits updates on input', async () => {
    const wrapper = mountAuthPanel({ modelValue: 'secret' })
    expect((wrapper.find('input#webui-auth-key').element as HTMLInputElement).value).toBe('secret')

    await wrapper.find('input#webui-auth-key').setValue('new-key')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('new-key')
  })

  it('emits verify on submit button click', async () => {
    const wrapper = mountAuthPanel()
    await wrapper.find('button.auth-submit-button').trigger('click')
    expect(wrapper.emitted('verify')).toHaveLength(1)
  })

  it('emits verify on Enter keydown in the input', async () => {
    const wrapper = mountAuthPanel()
    await wrapper.find('input#webui-auth-key').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('verify')).toHaveLength(1)
  })

  it('renders the remember-verification select with the expected options', () => {
    const wrapper = mountAuthPanel({ rememberVerify: '1d' })
    const select = wrapper.find('select#webui-auth-remember')
    expect(select.exists()).toBe(true)
    expect((select.element as HTMLSelectElement).value).toBe('1d')
    expect(select.findAll('option')).toHaveLength(4)
  })

  it('emits update:rememberVerify on select change', async () => {
    const wrapper = mountAuthPanel()
    const select = wrapper.find('select#webui-auth-remember')
    await select.setValue('1w')
    const emitted = wrapper.emitted('update:rememberVerify')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('1w')
  })

  it('shows the error message when provided', () => {
    const wrapper = mountAuthPanel({ error: 'invalid key' })
    expect(wrapper.find('p.composer-error').text()).toBe('invalid key')
  })

  it('does not render the error paragraph when empty', () => {
    const wrapper = mountAuthPanel()
    expect(wrapper.find('p.composer-error').exists()).toBe(false)
  })
})
