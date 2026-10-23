// Єдине сховище стану для всіх екранів.
// Зараз дані живуть у браузері (localStorage, див. persist.ts). Наступний
// крок — замінити їх на Google Sheets (Sistema Latteria) або PostgreSQL:
// екрани при цьому не зміняться, бо працюють лише через useStore().
//
// Де що лежить:
//   reducer.ts  — дії (Action) і як вони змінюють стан
//   persist.ts  — збереження в localStorage і читання з міграцією
//   migrate.ts  — перетворення старих даних на поточну версію
//   useStore.ts — доступ до стану з екранів
//   useToday.ts — «сьогодні» для селекторів

import { useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { browserStorage, loadState, saveState } from './persist'
import { reducer } from './reducer'
import { useToday } from './useToday'
import { StoreContext } from './useStore'

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, browserStorage, loadState)
  useEffect(() => saveState(browserStorage, state), [state])
  const today = useToday()
  const value = useMemo(() => ({ state, dispatch, today }), [state, today])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
