// Reducer — єдине місце, де змінюється стан: (стан, дія) → новий стан.
// Його викликає StoreProvider через dispatch; ті самі дії згодом
// застосовуватиме DataSource (Google Sheets) і AI-агент.

import { createSeed, expiryFor, firstBoxId, lotCode, withSuffix } from './seed'
import { romeDate, romeDateTime } from './time'
import type { AppState, Box, Lot, OrderStatus } from './types'

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
  // Передавай code завжди (екрани, AI-агент): інакше в повідомленні буде ID.
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

/**
 * Бере `qty` з коробок `from` по черзі (у заданому порядку). Повертає нові
 * коробки стану без порожніх і скільки вдалося взяти (не більше, ніж є).
 */
function takeFromBoxes(boxes: Box[], from: Box[], qty: number): { boxes: Box[]; taken: number } {
  const take = new Map<string, number>()
  let left = qty
  for (const b of from) {
    if (left <= 0) break
    const t = Math.min(left, b.qty)
    take.set(b.id, t)
    left -= t
  }
  return {
    boxes: boxes.map((b) => (take.has(b.id) ? { ...b, qty: b.qty - take.get(b.id)! } : b)).filter((b) => b.qty > 0),
    taken: qty - left,
  }
}

/** Партії, у яких не лишилось жодної коробки, зникають (як раніше партія з qty 0). */
function dropEmptyLots(lots: Lot[], boxes: Box[]): Lot[] {
  const withBoxes = new Set(boxes.map((b) => b.lotId))
  return lots.filter((l) => withBoxes.has(l.id))
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
      // Код її коробки вже зайнятий (вручну в таблиці) — як і Apps Script, не створюємо.
      if (action.lotId && state.boxes.some((b) => b.id === firstBoxId(action.lotId!))) return state
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
        producedAt,
        expiresAt: expiryFor(product, producedAt),
        milkLitres: action.milkLitres,
      }
      // Поки що вся нова партія — одна коробка; поділ на кілька — у 2b.2.
      const box: Box = { id: firstBoxId(lot.id), lotId: lot.id, locationId: location.id, qty: action.qty }
      return {
        ...state,
        lots: [...state.lots, lot],
        boxes: [...state.boxes, box],
        log: [...state.log, { at: now(), text: `Prodotto lotto ${lot.code}: ${product.name} ${action.qty} ${product.unit} → ${location.name}` }],
      }
    }
    case 'ship': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      if (!lot) return state
      const { boxes, taken } = takeFromBoxes(state.boxes, state.boxes.filter((b) => b.lotId === lot.id), action.qty)
      return {
        ...state,
        lots: dropEmptyLots(state.lots, boxes),
        boxes,
        log: [...state.log, { at: now(), text: `Uscita ${taken} dal lotto ${lot.code}` }],
      }
    }
    case 'move': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      const to = state.locations.find((l) => l.id === action.locationId)
      if (!lot || !to) return state
      return {
        ...state,
        // Уся партія переїжджає разом з усіма коробками; окрема коробка — moveBox (2b.2).
        boxes: state.boxes.map((b) => (b.lotId === lot.id ? { ...b, locationId: to.id } : b)),
        log: [...state.log, { at: now(), text: `Lotto ${lot.code} spostato in ${to.name}` }],
      }
    }
    case 'orderStatus': {
      const order = state.orders.find((o) => o.id === action.orderId)
      if (!order || order.status === action.status) return state
      // «Spedito» остаточний: товар уже списано. Повернення — окрема дія (reso, етап 5).
      if (order.status === 'spedito') return state
      let lots = state.lots
      let boxes = state.boxes
      const log = [...state.log]
      if (action.status === 'spedito') {
        // Списуємо зі складу за принципом FEFO: спершу коробки партій, що
        // раніше спливають (для Montasio — найстаріші форми).
        const fefo = [...state.lots].sort((a, b) => (a.expiresAt ?? a.producedAt).localeCompare(b.expiresAt ?? b.producedAt))
        for (const line of order.lines) {
          const from = fefo
            .filter((l) => l.productId === line.productId)
            .flatMap((l) => boxes.filter((b) => b.lotId === l.id))
          boxes = takeFromBoxes(boxes, from, line.qty).boxes
        }
        lots = dropEmptyLots(lots, boxes)
        log.push({ at: now(), text: `Spedito ordine ${order.id} a ${order.client}` })
      }
      return {
        ...state,
        lots,
        boxes,
        log,
        orders: state.orders.map((o) => (o.id === action.orderId ? { ...o, status: action.status } : o)),
      }
    }
    case 'reset':
      return createSeed()
  }
}
