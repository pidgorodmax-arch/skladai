// Єдине сховище стану для всіх екранів.
// Дані приходять із джерела (DataSource, див. source.ts): зараз це демо в
// localStorage, далі — Google Sheets. Екрани при цьому не зміняться, бо
// працюють лише через useStore().
//
// Де що лежить:
//   source.ts   — DataSource: load() на старті, apply(action) на кожну зміну
//   reducer.ts  — дії (Action) і як вони змінюють стан
//   persist.ts  — збереження в localStorage і читання з міграцією
//   migrate.ts  — перетворення старих даних на поточну версію
//   useStore.ts — доступ до стану з екранів
//   useToday.ts — «сьогодні» для селекторів

import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { reducer, type Action } from './reducer'
import { createDemoSource, type DataSource } from './source'
import type { AppState } from './types'
import { useToday } from './useToday'
import { StoreContext } from './useStore'

const demoSource = createDemoSource()

type LoadStatus = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; state: AppState; source: DataSource }

/**
 * `source` має бути сталим об'єктом (створеним поза рендером): нове джерело
 * означає нове завантаження. Якщо джерело змінилося (демо ↔ Sheets у 2.4),
 * дані попереднього не показуємо, а чекаємо load() нового.
 */
export function StoreProvider({ source = demoSource, children }: { source?: DataSource; children: ReactNode }) {
  const [status, setStatus] = useState<LoadStatus>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    source.load().then(
      (state) => active && setStatus({ kind: 'ready', state, source }),
      () => active && setStatus({ kind: 'error' }),
    )
    return () => {
      active = false
    }
  }, [source, attempt])

  if (status.kind === 'ready' && status.source === source) {
    return <LoadedStore initial={status.state} source={source}>{children}</LoadedStore>
  }
  return (
    <main className="page" aria-busy={status.kind !== 'error'}>
      {status.kind !== 'error' ? (
        <p className="muted">Caricamento dei dati…</p>
      ) : (
        <>
          <p>Impossibile caricare i dati. Controlla la connessione.</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setStatus({ kind: 'loading' })
              setAttempt((n) => n + 1)
            }}
          >
            Riprova
          </button>
        </>
      )}
    </main>
  )
}

function LoadedStore({ initial, source, children }: { initial: AppState; source: DataSource; children: ReactNode }) {
  const [state, apply] = useReducer(reducer, initial)
  const today = useToday()
  // Екран оновлюється одразу, а збереження йде в джерело паралельно.
  // Що робити, коли зберегти не вдалося (немає мережі), — завдання 2.5.
  const dispatch = useCallback(
    (action: Action) => {
      apply(action)
      source.apply(action).catch((err: unknown) => console.error('Salvataggio non riuscito', err))
    },
    [source],
  )
  const value = useMemo(() => ({ state, dispatch, today }), [state, dispatch, today])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
