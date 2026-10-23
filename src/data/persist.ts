// Збереження стану в браузері (localStorage) і читання з міграцією.
// Сховище передається параметром — так це можна перевірити тестом.

import { migrate } from './migrate'
import { createSeed } from './seed'
import type { AppState } from './types'

/** Ключ не залежить від версії: версія записана всередині даних. */
export const STORAGE_KEY = 'skladai:v1'
/** Сюди кладемо дані, які не вдалося прочитати, — щоб вони не зникли безслідно. */
export const BACKUP_KEY = 'skladai:backup'

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

/** localStorage браузера. Звертаємось до нього лише всередині методів: якщо
 *  браузер блокує сховище, помилку перехопить try у loadState/saveState. */
export const browserStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
}

export function loadState(storage: KeyValueStorage): AppState {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return createSeed() // приватний режим — без збереження, на демо
  }
  if (!raw) return createSeed()

  try {
    const state = migrate(JSON.parse(raw))
    if (state) return state
  } catch {
    // пошкоджений JSON — нижче збережемо копію
  }
  try {
    storage.setItem(BACKUP_KEY, raw)
  } catch {
    // немає місця — нічого не вдієш, стартуємо з демо
  }
  return createSeed()
}

export function saveState(storage: KeyValueStorage, state: AppState) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // без збереження демо все одно працює
  }
}
