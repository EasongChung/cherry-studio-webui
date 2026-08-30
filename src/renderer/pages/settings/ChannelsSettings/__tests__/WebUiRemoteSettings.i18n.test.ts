import deDE from '@renderer/i18n/locales/de-de.json'
import elGR from '@renderer/i18n/locales/el-gr.json'
import enUS from '@renderer/i18n/locales/en-us.json'
import esES from '@renderer/i18n/locales/es-es.json'
import frFR from '@renderer/i18n/locales/fr-fr.json'
import jaJP from '@renderer/i18n/locales/ja-jp.json'
import ptPT from '@renderer/i18n/locales/pt-pt.json'
import roRO from '@renderer/i18n/locales/ro-ro.json'
import ruRU from '@renderer/i18n/locales/ru-ru.json'
import viVN from '@renderer/i18n/locales/vi-vn.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import zhTW from '@renderer/i18n/locales/zh-tw.json'
import { describe, expect, it } from 'vitest'

const locales = { deDE, elGR, enUS, esES, frFR, jaJP, ptPT, roRO, ruRU, viVN, zhCN, zhTW }
const requiredKeys = [
  'settings.webui.access_key',
  'settings.webui.access_key_generated',
  'settings.webui.access_key_placeholder',
  'settings.webui.access_key_required',
  'settings.webui.description',
  'settings.webui.enable_lan_access',
  'settings.webui.generate_access_key',
  'settings.webui.hide_access_key',
  'settings.webui.host_custom',
  'settings.webui.host_custom_placeholder',
  'settings.webui.host_invalid',
  'settings.webui.host_lan',
  'settings.webui.host_loopback',
  'settings.webui.listen_host',
  'settings.webui.port',
  'settings.webui.running',
  'settings.webui.service_status',
  'settings.webui.show_access_key',
  'settings.webui.stopped',
  'settings.webui.title'
] as const

describe('WebUI channel locale contract', () => {
  it.each(Object.entries(locales))('%s retains every fork-owned WebUI setting key', (_locale, messages) => {
    for (const key of requiredKeys) {
      expect(messages[key as keyof typeof messages]).toEqual(expect.any(String))
      expect(messages[key as keyof typeof messages]).not.toBe('')
    }
  })
})
