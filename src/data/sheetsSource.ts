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

/**
 * Що сталося:
 *   network  — немає зв'язку / Google тимчасово недоступний: повторити пізніше;
 *   auth     — неправильний токен; config — таблиця чи адреса не такі;
 *   rejected — таблиця відхилила саму дію (немає лоту тощо): повтор не допоможе;
 *   error    — інша помилка скрипта (наприклад, таблиця зайнята): повторити.
 */
export type SheetsErrorCode = 'network' | 'auth' | 'config' | 'rejected' | 'error'

/** Помилка з повідомленням для людини (італійською) — показуємо її на екрані. */
export class SheetsError extends Error {
  readonly code: SheetsErrorCode
  constructor(message: string, code: SheetsErrorCode = 'error') {
    super(message)
    this.code = code
  }
}

const SCRIPT_CODES: readonly string[] = ['auth', 'config', 'rejected', 'error']

async function call(fetchFn: FetchLike, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchFn(url, { redirect: 'follow', ...init })
  } catch {
    throw new SheetsError('Tabella non raggiungibile: controlla la connessione', 'network')
  }
  if (!res.ok) {
    // 5xx і 429 — Google тимчасово не відповідає; 4xx — найімовірніше, хибна адреса.
    const temporary = res.status >= 500 || res.status === 429
    throw new SheetsError(`La tabella ha risposto con errore ${res.status}`, temporary ? 'network' : 'config')
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    // Сторінка замість JSON: хибна адреса або Wi-Fi з входом через браузер.
    throw new SheetsError("Risposta non valida: controlla l'indirizzo dello script", 'network')
  }
  if (typeof body !== 'object' || body === null) throw new SheetsError('Risposta non valida dalla tabella', 'config')
  const data = body as Record<string, unknown>
  if (data.ok !== true) {
    const code = typeof data.code === 'string' && SCRIPT_CODES.includes(data.code) ? (data.code as SheetsErrorCode) : 'error'
    throw new SheetsError(typeof data.error === 'string' ? data.error : 'Errore sconosciuto della tabella', code)
  }
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
      if (!state) throw new SheetsError('I dati della tabella non sono nel formato previsto', 'config')
      return state
    },
    apply(action: Action): Promise<void> {
      if (action.type === 'reset') return Promise.reject(new SheetsError('Il ripristino dei dati demo non è disponibile con la tabella', 'rejected'))
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
