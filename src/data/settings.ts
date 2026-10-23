// Налаштування підключення до Google Таблиці (Apps Script Web App).
// Живуть лише в цьому браузері (localStorage), не в коді: репозиторій
// публічний, а в кожного клієнта своя таблиця й свій токен.
// Це не дані складу (AppState), тому вони не йдуть через dispatch.

import type { KeyValueStorage } from './persist'

export const SETTINGS_KEY = 'skladai:settings'

export interface SheetsSettings {
  /** Адреса Web App, закінчується на /exec. */
  url: string
  /** Токен із властивостей скрипта (TOKEN). */
  token: string
}

/** Повертає текст помилки італійською або null, якщо все гаразд. */
export function validateSettings(s: SheetsSettings): string | null {
  let url: URL
  try {
    url = new URL(s.url.trim())
  } catch {
    return "L'indirizzo non è valido"
  }
  if (url.protocol !== 'https:') return "L'indirizzo deve iniziare con https://"
  if (!s.token.trim()) return 'Inserisci il token'
  return null
}

/** Збережені налаштування або null (тоді застосунок працює на демо-даних). */
export function loadSettings(storage: KeyValueStorage): SheetsSettings | null {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return null
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return null
    const { url, token } = data as Record<string, unknown>
    if (typeof url !== 'string' || typeof token !== 'string') return null
    const settings = { url, token }
    return validateSettings(settings) ? null : settings
  } catch {
    return null
  }
}

/** null — від'єднатися від таблиці й повернутися до демо. */
export function saveSettings(storage: KeyValueStorage, settings: SheetsSettings | null): void {
  storage.setItem(SETTINGS_KEY, settings ? JSON.stringify({ url: settings.url.trim(), token: settings.token.trim() }) : '')
}
