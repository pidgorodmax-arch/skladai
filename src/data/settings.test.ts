// Тести налаштувань підключення: зберігаються в браузері, сміття не ламає старт.

import { describe, expect, it } from 'vitest'
import type { KeyValueStorage } from './persist'
import { SETTINGS_KEY, loadSettings, saveSettings, validateSettings } from './settings'

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = { ...initial }
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

const good = { url: 'https://script.google.com/macros/s/prova/exec', token: 'abc' }

describe('settings', () => {
  it('без налаштувань — демо (null)', () => {
    expect(loadSettings(memoryStorage())).toBeNull()
  })

  it('зберігає й читає, прибирає пробіли по краях', () => {
    const storage = memoryStorage()
    saveSettings(storage, { url: `  ${good.url} `, token: ' abc ' })
    expect(loadSettings(storage)).toEqual(good)
  })

  it('від\'єднання стирає налаштування', () => {
    const storage = memoryStorage()
    saveSettings(storage, good)
    saveSettings(storage, null)
    expect(loadSettings(storage)).toBeNull()
  })

  it('пошкоджені або неповні дані → демо, а не падіння', () => {
    for (const raw of ['{', '"текст"', '{"url":1}', JSON.stringify({ url: 'http://x.it/exec', token: 'a' })]) {
      expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: raw }))).toBeNull()
    }
    const throwing: KeyValueStorage = { getItem: () => { throw new Error('bloccato') }, setItem: () => {} }
    expect(loadSettings(throwing)).toBeNull()
  })

  it('перевірка полів — повідомлення італійською', () => {
    expect(validateSettings(good)).toBeNull()
    expect(validateSettings({ ...good, url: 'script google' })).toBe("L'indirizzo non è valido")
    expect(validateSettings({ ...good, url: 'http://script.google.com/exec' })).toBe("L'indirizzo deve iniziare con https://")
    expect(validateSettings({ ...good, token: '  ' })).toBe('Inserisci il token')
  })
})
