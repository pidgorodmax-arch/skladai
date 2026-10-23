// Єдине сховище стану для всіх екранів.
// Дані приходять із джерела (DataSource, див. source.ts): зараз це демо в
// localStorage, далі — Google Sheets. Екрани при цьому не зміняться, бо
// працюють лише через useStore().
//
// Де що лежить:
//   source.ts   — DataSource: load() на старті, apply(action) на кожну зміну
//   sheetsSource.ts — те саме для Google Таблиці (Apps Script)
//   settings.ts — адреса таблиці й токен (лише в цьому браузері)
//   queuedSource.ts — офлайн-черга дій і копія таблиці для роботи без мережі
//   reducer.ts  — дії (Action) і як вони змінюють стан
//   persist.ts  — збереження в localStorage і читання з міграцією
//   migrate.ts  — перетворення старих даних на поточну версію
//   useStore.ts — доступ до стану з екранів
//   useToday.ts — «сьогодні» для селекторів

import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore, type ReactNode } from 'react'
import { browserStorage } from './persist'
import { isSynced, createQueuedSource, type SyncControl } from './queuedSource'
import { reducer, stamp, type Action } from './reducer'
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
  const source = useMemo(
    () => (settings ? createQueuedSource(createSheetsSource(settings), settings.url, browserStorage) : demoSource),
    [settings],
  )
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

/** Свіжий стан із таблиці після синхронізації — замінює те, що на екрані. */
type Fresh = { type: 'fresh'; state: AppState }

function storeReducer(state: AppState, msg: Action | Fresh): AppState {
  return msg.type === 'fresh' ? msg.state : reducer(state, msg)
}

function LoadedStore({ initial, source, children }: { initial: AppState; source: DataSource; children: ReactNode }) {
  const [state, apply] = useReducer(storeReducer, initial)
  const [saveError, setSaveError] = useState<string | null>(null)
  const today = useToday()
  // Екран оновлюється одразу, а збереження йде в джерело паралельно.
  // Дія отримує час і id (stamp): з офлайн-черги вона дійде до таблиці
  // пізніше, але з часом, коли її зробили. Якщо зберегти не вдалося —
  // показуємо це, а не мовчимо.
  const dispatch = useCallback(
    (action: Action) => {
      const stamped = stamp(action)
      apply(stamped)
      source.apply(stamped).catch((err: unknown) => {
        console.error('Salvataggio non riuscito', err)
        setSaveError(errorText(err, 'Salvataggio non riuscito'))
      })
    },
    [source],
  )
  const value = useMemo(() => ({ state, dispatch, today }), [state, dispatch, today])
  const onFresh = useCallback((fresh: AppState) => apply({ type: 'fresh', state: fresh }), [])
  return (
    <StoreContext.Provider value={value}>
      {isSynced(source) && <SyncBar sync={source.sync} onFresh={onFresh} />}
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

const RETRY_MS = 30_000

/**
 * Позначка «non sincronizzato» і повторна відправка черги: коли з'являється
 * мережа, коли застосунок знову на екрані і раз на 30 секунд.
 */
function SyncBar({ sync, onFresh }: { sync: SyncControl; onFresh: (state: AppState) => void }) {
  const status = useSyncExternalStore(sync.subscribe, sync.status)

  useEffect(() => sync.onFreshState(onFresh), [sync, onFresh])
  useEffect(() => {
    const retry = () => void sync.flush()
    const onVisible = () => document.visibilityState === 'visible' && retry()
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => sync.status().pending > 0 && retry(), RETRY_MS)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [sync])

  const { pending, syncing, offline, error } = status
  return (
    <>
      {error && (
        <div className="save-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={sync.clearError}>
            Chiudi
          </button>
        </div>
      )}
      {(pending > 0 || offline) && (
        <div className="sync-bar" role="status">
          <span>
            {pending > 0 ? (
              <>
                <strong>{pending === 1 ? '1 operazione non sincronizzata' : `${pending} operazioni non sincronizzate`}</strong>
                {offline ? ` · senza connessione, ${pending === 1 ? 'salvata' : 'salvate'} sul telefono` : syncing ? ' · invio in corso…' : ''}
              </>
            ) : (
              <strong>Senza connessione: dati dell'ultima sincronizzazione</strong>
            )}
          </span>
          {pending > 0 && (
            <button type="button" className="btn" onClick={() => void sync.flush()} disabled={syncing}>
              Sincronizza ora
            </button>
          )}
        </div>
      )}
    </>
  )
}
