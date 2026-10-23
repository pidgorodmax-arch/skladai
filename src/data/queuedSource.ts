// Офлайн-черга для Google Таблиці. У цеху мережа пропадає (холодильні
// камери, підвал), а партію треба записати зараз.
//
// Як працює:
//   apply()  — дія одразу лягає в чергу в localStorage (переживе закриття
//              застосунку) і відправляється, коли є зв'язок;
//   flush()  — відправляє чергу строго по порядку; після цього перечитує
//              таблицю, щоб на екрані був її справжній стан (інші телефони,
//              правки вручну), з ще не відправленими діями поверх;
//   load()   — без мережі віддає останню збережену копію таблиці + черга,
//              тож застосунок відкривається й офлайн.
//
// Що робити з помилкою відправки:
//   network / error  — лишаємо дію в черзі, повторимо пізніше (error —
//                      таблиця зайнята: показуємо це окремо від «немає мережі»);
//   auth / config    — лишаємо дію, показуємо причину (треба виправити токен
//                      чи таблицю), повторимо пізніше;
//   rejected         — таблиця відхилила саму дію: прибираємо її з черги й
//                      показуємо причину (повтор не допоможе).

import { migrate } from './migrate'
import type { KeyValueStorage } from './persist'
import { reducer, type Action } from './reducer'
import { SheetsError } from './sheetsSource'
import type { DataSource } from './source'
import type { AppState } from './types'

export const QUEUE_KEY = 'skladai:queue'
export const CACHE_KEY = 'skladai:cache'

export interface SyncStatus {
  /** Скільки дій ще не дійшло до таблиці. */
  pending: number
  /** Іде відправка. */
  syncing: boolean
  /** Останнім разом таблиця була недоступна (немає мережі). */
  offline: boolean
  /** Причина, яку має побачити людина (італійською), або null. */
  error: string | null
}

export interface SyncControl {
  status(): SyncStatus
  subscribe(listener: () => void): () => void
  /** Свіжий стан таблиці після синхронізації (з невідправленими діями поверх). */
  onFreshState(listener: (state: AppState) => void): () => void
  flush(): Promise<void>
  clearError(): void
}

export interface SyncedSource extends DataSource {
  readonly sync: SyncControl
}

export function isSynced(source: DataSource): source is SyncedSource {
  return 'sync' in source
}

/** Черга й копія прив'язані до адреси таблиці: інша таблиця — інші дані. */
function read<T>(storage: KeyValueStorage, key: string, owner: string): T | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw) as { owner?: unknown; value?: T }
    return data.owner === owner && data.value !== undefined ? data.value : null
  } catch {
    return null
  }
}

function write(storage: KeyValueStorage, key: string, owner: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify({ owner, value }))
  } catch {
    // Сховище недоступне (приватний режим) — черга живе хоча б у пам'яті.
  }
}

/** Коротко, що за дія, — для повідомлення про відхилену дію. */
function describe(action: Action): string {
  switch (action.type) {
    case 'register': return `Lotto di ${action.productId}`
    case 'ship': return `Uscita dal lotto ${action.code ?? action.lotId}`
    case 'move': return `Spostamento del lotto ${action.code ?? action.lotId}`
    case 'orderStatus': return `Ordine ${action.orderId}`
    default: return 'Operazione'
  }
}

/** Помилка, за якої дію варто повторити пізніше. */
function retryable(err: unknown): boolean {
  return !(err instanceof SheetsError) || err.code !== 'rejected'
}

/** Немає зв'язку з Google. */
function isNetwork(err: unknown): boolean {
  return err instanceof SheetsError && err.code === 'network'
}

/** Таблиця тимчасово недоступна (зв'язку немає чи вона зайнята) — можна стартувати з копії. */
function isTemporary(err: unknown): boolean {
  return err instanceof SheetsError && (err.code === 'network' || err.code === 'error')
}

/** Що показати людині, якщо дію треба буде повторити. */
function retryMessage(err: unknown): string | null {
  if (isNetwork(err)) return null // це покаже позначка «senza connessione»
  if (err instanceof SheetsError && err.code === 'error') return `Tabella occupata, nuovo tentativo a breve (${err.message})`
  return errorMessage(err)
}

/**
 * Обгортає джерело (SheetsSource) чергою. `owner` — адреса таблиці.
 */
export function createQueuedSource(inner: DataSource, owner: string, storage: KeyValueStorage): SyncedSource {
  let queue: Action[] = read<Action[]>(storage, QUEUE_KEY, owner) ?? []
  let status: SyncStatus = { pending: queue.length, syncing: false, offline: false, error: null }
  const listeners = new Set<() => void>()
  const freshListeners = new Set<(state: AppState) => void>()
  // Спроби відправки йдуть одна за одною. Кожен виклик flush() — нова
  // спроба після поточної: якщо мережа з'явилась, поки попередня спроба ще
  // падала, нова все одно відбудеться.
  let tail: Promise<void> = Promise.resolve()
  // Дві різні причини: проблема з токеном/таблицею зникає сама після першої
  // вдалої відправки; відхилену дію людина має побачити й закрити.
  let problem: string | null = null
  let rejected: string | null = null

  function setStatus(patch: Partial<SyncStatus>) {
    // Новий об'єкт лише коли щось змінилося — так React не перемальовує зайве.
    const next = { ...status, ...patch, pending: queue.length, error: rejected ?? problem }
    if ((Object.keys(next) as (keyof SyncStatus)[]).some((k) => next[k] !== status[k])) {
      status = next
      listeners.forEach((l) => l())
    }
  }

  function saveQueue() {
    write(storage, QUEUE_KEY, owner, queue)
  }

  /** Стан таблиці + ще не відправлені дії поверх. */
  function withPending(state: AppState): AppState {
    return queue.reduce(reducer, state)
  }

  /** Перечитує таблицю: копія для офлайн-старту + свіжий стан для екрана. */
  async function refresh(): Promise<void> {
    try {
      const fresh = await inner.load()
      write(storage, CACHE_KEY, owner, fresh)
      setStatus({ offline: false })
      const state = withPending(fresh)
      freshListeners.forEach((l) => l(state))
    } catch (err) {
      // Не страшно: дії вже в таблиці, екран оновиться наступного разу.
      if (isNetwork(err)) setStatus({ offline: true })
    }
  }

  async function drain(): Promise<void> {
    if (!queue.length && !status.offline) return
    setStatus({ syncing: true })
    try {
      // Відкрились без мережі й нічого не чекає відправки — лише перевіряємо,
      // чи повернувся зв'язок, і підтягуємо свіжі дані.
      if (!queue.length) await refresh()
      // Цикл, бо поки відправляємо чи читаємо таблицю, можуть з'явитися нові дії.
      while (queue.length) {
        while (queue.length) {
          const action = queue[0]
          try {
            await inner.apply(action)
          } catch (err) {
            if (retryable(err)) {
              problem = retryMessage(err)
              setStatus({ offline: isNetwork(err) })
              return
            }
            rejected = `${describe(action)} non salvato: ${errorMessage(err)}`
          }
          // Таблиця відповіла (прийняла чи відхилила) — з токеном і таблицею все гаразд.
          problem = null
          queue = queue.slice(1)
          saveQueue()
          setStatus({ offline: false })
        }
        // Усе відправлено: перечитуємо таблицю, щоб екран збігся з нею.
        await refresh()
      }
    } finally {
      setStatus({ syncing: false })
    }
  }

  function flush(): Promise<void> {
    tail = tail.then(drain, drain)
    return tail
  }

  return {
    async load() {
      // Спершу відправляємо те, що лишилось із минулого разу.
      if (queue.length) await flush()
      try {
        const fresh = await inner.load()
        write(storage, CACHE_KEY, owner, fresh)
        setStatus({ offline: false })
        return withPending(fresh)
      } catch (err) {
        const cached = isTemporary(err) ? migrate(read<unknown>(storage, CACHE_KEY, owner)) : null
        if (!cached) throw err
        setStatus({ offline: true })
        return withPending(cached)
      }
    },
    async apply(action) {
      if (action.type === 'reset') throw new SheetsError('Il ripristino dei dati demo non è disponibile con la tabella', 'rejected')
      queue = [...queue, action]
      saveQueue()
      setStatus({})
      void flush()
    },
    sync: {
      status: () => status,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      onFreshState(listener) {
        freshListeners.add(listener)
        return () => freshListeners.delete(listener)
      },
      flush,
      clearError: () => {
        rejected = null
        problem = null
        setStatus({})
      },
    },
  }
}

function errorMessage(err: unknown): string {
  return err instanceof SheetsError ? err.message : 'errore sconosciuto'
}
