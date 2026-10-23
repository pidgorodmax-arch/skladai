// Джерело даних «Google Таблиця»: та сама пара load/apply, що й у DemoSource,
// але через Apps Script Web App (apps-script/Code.gs).
//
//   load()  — GET  <url>?token=…            → { ok, state }
//   apply() — POST <url> {token, action}     → { ok } або { ok: false, error }
//
// POST іде з Content-Type text/plain: так браузер не робить попередній
// запит OPTIONS, якого Apps Script не вміє обробляти.

import { migrate } from './migrate'
import type { Action } from './reducer'
import type { SheetsSettings } from './settings'
import type { DataSource } from './source'
import type { AppState } from './types'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

/** Помилка з повідомленням для людини (італійською) — показуємо її на екрані. */
export class SheetsError extends Error {}

async function call(fetchFn: FetchLike, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchFn(url, { redirect: 'follow', ...init })
  } catch {
    throw new SheetsError('Tabella non raggiungibile: controlla la connessione')
  }
  if (!res.ok) throw new SheetsError(`La tabella ha risposto con errore ${res.status}`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new SheetsError("Risposta non valida: controlla l'indirizzo dello script")
  }
  if (typeof body !== 'object' || body === null) throw new SheetsError('Risposta non valida dalla tabella')
  const data = body as Record<string, unknown>
  if (data.ok !== true) throw new SheetsError(typeof data.error === 'string' ? data.error : 'Errore sconosciuto della tabella')
  return data
}

export function createSheetsSource(settings: SheetsSettings, fetchFn: FetchLike = (u, i) => fetch(u, i)): DataSource {
  const url = settings.url.trim()
  const token = settings.token.trim()
  // Дії відправляються строго по черзі: інакше два швидкі натискання можуть
  // дійти до таблиці в зворотному порядку.
  let queue: Promise<unknown> = Promise.resolve()

  return {
    async load(): Promise<AppState> {
      const sep = url.includes('?') ? '&' : '?'
      const data = await call(fetchFn, `${url}${sep}token=${encodeURIComponent(token)}`)
      // Ті самі перевірка й міграція, що й для даних із браузера.
      const state = migrate(data.state)
      if (!state) throw new SheetsError('I dati della tabella non sono nel formato previsto')
      return state
    },
    apply(action: Action): Promise<void> {
      if (action.type === 'reset') return Promise.reject(new SheetsError('Il ripristino dei dati demo non è disponibile con la tabella'))
      const send = () =>
        call(fetchFn, url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ token, action }),
        }).then(() => undefined)
      const result = queue.then(send, send)
      queue = result.catch(() => undefined)
      return result
    },
  }
}

/** Перевірка перед збереженням налаштувань: читає таблицю й рахує записи. */
export async function testConnection(settings: SheetsSettings, fetchFn?: FetchLike): Promise<{ products: number; lots: number; orders: number }> {
  const state = await createSheetsSource(settings, fetchFn).load()
  return { products: state.products.length, lots: state.lots.length, orders: state.orders.length }
}
