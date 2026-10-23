// Reducer — єдине місце, де змінюється стан: (стан, дія) → новий стан.
// Його викликає StoreProvider через dispatch; ті самі дії згодом
// застосовуватиме DataSource (Google Sheets) і AI-агент.

import { createSeed, expiryFor, lotCode } from './seed'
import { romeDate, romeDateTime } from './time'
import type { AppState, Lot, OrderStatus } from './types'

/**
 * `at` — коли дію зробили («РРРР-ММ-ДДTгг:хх» за Римом). Його ставить
 * dispatch, щоб дія з офлайн-черги, відправлена пізніше, лишилась у журналі
 * й у даті партії тим часом, коли її зробили в цеху.
 */
export type Action = (
  | { type: 'register'; productId: string; qty: number; locationId: string; milkLitres?: number }
  | { type: 'ship'; lotId: string; qty: number }
  | { type: 'move'; lotId: string; locationId: string }
  | { type: 'orderStatus'; orderId: string; status: OrderStatus }
  | { type: 'reset' }
) & { at?: string }

/** Позначає дію часом «зараз» за Римом (робить dispatch). */
export function stamp(action: Action, at: Date = new Date()): Action {
  return { ...action, at: romeDateTime(at) }
}

export function reducer(state: AppState, action: Action): AppState {
  const now = () => action.at ?? romeDateTime(new Date())
  switch (action.type) {
    case 'register': {
      const product = state.products.find((p) => p.id === action.productId)
      const location = state.locations.find((l) => l.id === action.locationId)
      if (!product || !location || action.qty <= 0) return state
      // Дата за Римом (як на екрані Registra), а не UTC і не пояс пристрою:
      // після півночі в Італії UTC ще показує вчорашній день.
      const producedAt = action.at ? action.at.slice(0, 10) : romeDate(new Date())
      const lot: Lot = {
        id: lotCode(product.abbr, producedAt, state.lots.map((l) => l.id)),
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
        log: [...state.log, { at: now(), text: `Prodotto lotto ${lot.id}: ${product.name} ${action.qty} ${product.unit} → ${location.name}` }],
      }
    }
    case 'ship': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      if (!lot) return state
      const qty = Math.min(action.qty, lot.qty)
      const lots = state.lots
        .map((l) => (l.id === lot.id ? { ...l, qty: l.qty - qty } : l))
        .filter((l) => l.qty > 0)
      return { ...state, lots, log: [...state.log, { at: now(), text: `Uscita ${qty} dal lotto ${lot.id}` }] }
    }
    case 'move': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      const to = state.locations.find((l) => l.id === action.locationId)
      if (!lot || !to) return state
      return {
        ...state,
        lots: state.lots.map((l) => (l.id === lot.id ? { ...l, locationId: to.id } : l)),
        log: [...state.log, { at: now(), text: `Lotto ${lot.id} spostato in ${to.name}` }],
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
