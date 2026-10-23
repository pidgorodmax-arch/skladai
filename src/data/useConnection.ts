// Звідки беруться дані: демо в браузері чи Google Таблиця.
// const { settings, connect, disconnect } = useConnection()

import { createContext, useContext } from 'react'
import type { SheetsSettings } from './settings'

export interface ConnectionValue {
  /** null — демо-режим (дані в цьому браузері). */
  settings: SheetsSettings | null
  /** Зберегти налаштування й перейти на таблицю. */
  connect: (settings: SheetsSettings) => void
  /** Повернутися до демо-даних (налаштування стираються з пристрою). */
  disconnect: () => void
}

export const ConnectionContext = createContext<ConnectionValue | null>(null)

export function useConnection(): ConnectionValue {
  const ctx = useContext(ConnectionContext)
  if (!ctx) throw new Error('useConnection must be used inside DataProvider')
  return ctx
}
