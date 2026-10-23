// Reducer — єдине місце, де змінюється стан: (стан, дія) → новий стан.
// Його викликає StoreProvider через dispatch; ті самі дії згодом
// застосовуватиме DataSource (Google Sheets) і AI-агент.

import { createSeed, expiryFor, lotCode, withSuffix } from './seed'
import { romeDate, romeDateTime } from './time'
import type { AppState, Lot, OrderStatus } from './types'

/**
 * Службові поля, які ставить dispatch (див. stamp):
 *   at — коли дію зробили («РРРР-ММ-ДДTгг:хх» за Римом): дія з офлайн-черги,
 *        відправлена пізніше, лишається в журналі й у даті партії тим часом,
 *        коли її зробили в цеху;
 *   id — унікальний номер дії: таблиця не виконає повтор тієї самої дії двічі.
 */
export type Action = (
  // lotId — внутрішній ID нової партії (ставить stamp); code — код, який
  // людина бачила на екрані: якщо він уже зайнятий, береться наступний.
  | { type: 'register'; productId: string; qty: number; locationId: string; milkLitres?: number; lotId?: string; code?: string }
  // lotId у ship/move — завжди внутрішній ID (Lot.id); code — лише для
  // повідомлень людям (наприклад, «Lotto L-2310-MZ non trovato»), не для пошуку.
  | { type: 'ship'; lotId: string; qty: number; code?: string }
  | { type: 'move'; lotId: string; locationId: string; code?: string }
  | { type: 'orderStatus'; orderId: string; status: OrderStatus }
  | { type: 'reset' }
) & { at?: string; id?: string }

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Позначає дію часом «зараз» за Римом і унікальним id (робить dispatch).
 * Нова партія одразу отримує внутрішній ID — на телефоні, без мережі.
 */
export function stamp(action: Action, at: Date = new Date(), id: string = newId()): Action {
  const stamped: Action = { ...action, at: romeDateTime(at), id }
  return stamped.type === 'register' && !stamped.lotId ? { ...stamped, lotId: newId() } : stamped
}

/** Формат коду для людей: L-ДДММ-сигла[суфікс]. */
export const LOT_CODE = /^L-\d{4}-[A-Z0-9]+$/

export function reducer(state: AppState, action: Action): AppState {
  const now = () => action.at ?? romeDateTime(new Date())
  switch (action.type) {
    case 'register': {
      const product = state.products.find((p) => p.id === action.productId)
      const location = state.locations.find((l) => l.id === action.locationId)
      if (!product || !location || action.qty <= 0) return state
      // Ця партія вже є (повтор тієї самої дії) — другу не створюємо.
      if (action.lotId && state.lots.some((l) => l.id === action.lotId)) return state
      // Дата за Римом (як на екрані Registra), а не UTC і не пояс пристрою:
      // після півночі в Італії UTC ще показує вчорашній день.
      const producedAt = action.at ? action.at.slice(0, 10) : romeDate(new Date())
      const codes = state.lots.map((l) => l.code)
      const code =
        action.code && LOT_CODE.test(action.code) && !codes.includes(action.code)
          ? action.code
          : lotCode(product.abbr, producedAt, codes)
      const lot: Lot = {
        id: action.lotId ?? withSuffix(code, state.lots.map((l) => l.id)),
        code,
        productId: product.id,
        qty: action.qty,
        locationId: location.id,
        producedAt,
        expiresAt: expiryFor(product, producedAt),
        milkLitres: action.milkLitres,
      }
      return {
        ...state,
        lots: [...state.lots, lot],
        log: [...state.log, { at: now(), text: `Prodotto lotto ${lot.code}: ${product.name} ${action.qty} ${product.unit} → ${location.name}` }],
      }
    }
    case 'ship': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      if (!lot) return state
      const qty = Math.min(action.qty, lot.qty)
      const lots = state.lots
        .map((l) => (l.id === lot.id ? { ...l, qty: l.qty - qty } : l))
        .filter((l) => l.qty > 0)
      return { ...state, lots, log: [...state.log, { at: now(), text: `Uscita ${qty} dal lotto ${lot.code}` }] }
    }
    case 'move': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      const to = state.locations.find((l) => l.id === action.locationId)
      if (!lot || !to) return state
      return {
        ...state,
        lots: state.lots.map((l) => (l.id === lot.id ? { ...l, locationId: to.id } : l)),
        log: [...state.log, { at: now(), text: `Lotto ${lot.code} spostato in ${to.name}` }],
      }
    }
    case 'orderStatus': {
      const order = state.orders.find((o) => o.id === action.orderId)
      if (!order || order.status === action.status) return state
      // «Spedito» остаточний: товар уже списано. Повернення — окрема дія (reso, етап 5).
      if (order.status === 'spedito') return state
      let lots = state.lots
      const log = [...state.log]
      if (action.status === 'spedito') {
        // Списуємо зі складу за принципом FEFO: спершу те, що раніше спливає
        // (для Montasio — найстаріші форми).
        for (const line of order.lines) {
          let left = line.qty
          const candidates = lots
            .filter((l) => l.productId === line.productId)
            .sort((a, b) => (a.expiresAt ?? a.producedAt).localeCompare(b.expiresAt ?? b.producedAt))
          for (const c of candidates) {
            if (left <= 0) break
            const take = Math.min(left, c.qty)
            left -= take
            lots = lots.map((l) => (l.id === c.id ? { ...l, qty: l.qty - take } : l))
          }
        }
        lots = lots.filter((l) => l.qty > 0)
        log.push({ at: now(), text: `Spedito ordine ${order.id} a ${order.client}` })
      }
      return {
        ...state,
        lots,
        log,
        orders: state.orders.map((o) => (o.id === action.orderId ? { ...o, status: action.status } : o)),
      }
    }
    case 'reset':
      return createSeed()
  }
}
