// Єдине сховище стану для всіх екранів.
// Дані приходять із джерела (DataSource, див. source.ts): зараз це демо в
// localStorage, далі — Google Sheets. Екрани при цьому не зміняться, бо
// працюють лише через useStore().
//
// Де що лежить:
//   source.ts   — DataSource: load() на старті, apply(action) на кожну зміну
//   sheetsSource.ts — те саме для Google Таблиці (Apps Script)
//   settings.ts — адреса таблиці й токен (лише в цьому браузері)
//   reducer.ts  — дії (Action) і як вони змінюють стан
//   persist.ts  — збереження в localStorage і читання з міграцією
//   migrate.ts  — перетворення старих даних на поточну версію
//   useStore.ts — доступ до стану з екранів
//   useToday.ts — «сьогодні» для селекторів

import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { browserStorage } from './persist'
import { reducer, type Action } from './reducer'
import { loadSettings, saveSettings, type SheetsSettings } from './settings'
import { createSheetsSource, SheetsError } from './sheetsSource'
import { createDemoSource, type DataSource } from './source'
import type { AppState } from './types'
import { ConnectionContext } from './useConnection'
import { useToday } from './useToday'
import { StoreContext } from './useStore'

const demoSource = createDemoSource()

/** Текст помилки для людини: наш SheetsError — як є, решта — загальний. */
function errorText(err: unknown, fallback: string): string {
  return err instanceof SheetsError ? err.message : fallback
}

/**
 * Обирає джерело даних за налаштуваннями: є адреса таблиці — Google Sheets,
 * немає — демо. Зміна налаштувань (сторінка Impostazioni) перемикає джерело,
 * і StoreProvider завантажує дані заново.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SheetsSettings | null>(() => loadSettings(browserStorage))
  const source = useMemo(() => (settings ? createSheetsSource(settings) : demoSource), [settings])
  const connection = useMemo(
    () => ({
      settings,
      connect: (next: SheetsSettings) => {
        saveSettings(browserStorage, next)
        setSettings(next)
      },
      disconnect: () => {
        saveSettings(browserStorage, null)
        setSettings(null)
      },
    }),
    [settings],
  )
  return (
    <ConnectionContext.Provider value={connection}>
      <StoreProvider source={source} onUseDemo={settings ? connection.disconnect : undefined}>
        {children}
      </StoreProvider>
    </ConnectionContext.Provider>
  )
}

type LoadStatus = { kind: 'loading' } | { kind: 'error'; message: string; source: DataSource } | { kind: 'ready'; state: AppState; source: DataSource }

/**
 * `source` має бути сталим об'єктом (створеним поза рендером): нове джерело
 * означає нове завантаження. Якщо джерело змінилося (демо ↔ Sheets у 2.4),
 * дані попереднього не показуємо, а чекаємо load() нового.
 */
export function StoreProvider({ source = demoSource, onUseDemo, children }: { source?: DataSource; onUseDemo?: () => void; children: ReactNode }) {
  const [status, setStatus] = useState<LoadStatus>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    source.load().then(
      (state) => active && setStatus({ kind: 'ready', state, source }),
      (err: unknown) => active && setStatus({ kind: 'error', message: errorText(err, 'Impossibile caricare i dati. Controlla la connessione.'), source }),
    )
    return () => {
      active = false
    }
  }, [source, attempt])

  if (status.kind === 'ready' && status.source === source) {
    return <LoadedStore initial={status.state} source={source}>{children}</LoadedStore>
  }
  // Помилку показуємо лише для поточного джерела: після «Usa i dati demo»
  // стара помилка таблиці не повинна висіти, поки вантажиться демо.
  const failed = status.kind === 'error' && status.source === source ? status : null
  return (
    <main className="page" aria-busy={!failed}>
      {!failed ? (
        <p className="muted">Caricamento dei dati…</p>
      ) : (
        <>
          <p role="alert">{failed.message}</p>
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
          {onUseDemo && (
            <button type="button" className="btn" onClick={onUseDemo}>
              Usa i dati demo
            </button>
          )}
        </>
      )}
    </main>
  )
}

function LoadedStore({ initial, source, children }: { initial: AppState; source: DataSource; children: ReactNode }) {
  const [state, apply] = useReducer(reducer, initial)
  const [saveError, setSaveError] = useState<string | null>(null)
  const today = useToday()
  // Екран оновлюється одразу, а збереження йде в джерело паралельно.
  // Якщо зберегти не вдалося — показуємо це, а не мовчимо: інакше працівник
  // думає, що партія в таблиці. Черга для роботи без мережі — завдання 2.5.
  const dispatch = useCallback(
    (action: Action) => {
      apply(action)
      source.apply(action).catch((err: unknown) => {
        console.error('Salvataggio non riuscito', err)
        setSaveError(errorText(err, 'Salvataggio non riuscito'))
      })
    },
    [source],
  )
  const value = useMemo(() => ({ state, dispatch, today }), [state, dispatch, today])
  return (
    <StoreContext.Provider value={value}>
      {saveError && (
        <div className="save-error" role="alert">
          <span>
            <strong>Non salvato nella tabella:</strong> {saveError}. I dati sullo schermo potrebbero non corrispondere.
          </span>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Ricarica i dati
          </button>
        </div>
      )}
      {children}
    </StoreContext.Provider>
  )
}
