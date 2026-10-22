// Доступ до спільного стану з будь-якого екрана: const { state, dispatch, today } = useStore()

import { createContext, useContext } from 'react'
import type { Action } from './reducer'
import type { AppState } from './types'

export interface StoreValue {
  state: AppState
  dispatch: (action: Action) => void
  /** «Сьогодні» для селекторів (див. useToday). */
  today: Date
}

export const StoreContext = createContext<StoreValue | null>(null)

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
