// Джерело даних: звідки застосунок бере стан і куди відправляє зміни.
// Екрани про нього не знають — вони працюють через useStore(). Щоб перейти
// з демо на Google Sheets (2.4), достатньо передати в StoreProvider інше
// джерело з тими самими двома методами.

import { browserStorage, loadState, saveState, type KeyValueStorage } from './persist'
import { reducer, type Action } from './reducer'
import type { AppState } from './types'

export interface DataSource {
  /** Повний стан на старті застосунку. */
  load(): Promise<AppState>
  /** Зберегти одну дію (ту саму, що пішла в dispatch). */
  apply(action: Action): Promise<void>
}

/**
 * Демо-режим: дані в localStorage цього браузера, як і раніше.
 * Джерело тримає свою копію стану й застосовує до неї ті самі дії через
 * reducer — так само, як це робитиме Apps Script з таблицею.
 */
export function createDemoSource(storage: KeyValueStorage = browserStorage): DataSource {
  let saved: AppState | null = null
  return {
    async load() {
      saved = loadState(storage)
      return saved
    },
    async apply(action) {
      saved = reducer(saved ?? loadState(storage), action)
      saveState(storage, saved)
    },
  }
}
