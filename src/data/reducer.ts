// Reducer — єдине місце, де змінюється стан: (стан, дія) → новий стан.
// Його викликає StoreProvider через dispatch; ті самі дії згодом
// застосовуватиме DataSource (Google Sheets) і AI-агент.

import { createSeed, expiryFor, firstBoxId, lotCode, nextBoxId, withSuffix } from './seed'
import { DEST_LABEL, fefoBoxesOf } from './selectors'
import { romeDate, romeDateTime } from './time'
import type { AppState, Box, Destinazione, Lot, OrderStatus, Pick, Uscita } from './types'

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
  // from — стелаж, з якого діяти (картка стелажа в 3D): лише коробки партії
  // на ньому. Без from — усі коробки партії.
  | { type: 'ship'; lotId: string; qty: number; code?: string; from?: string }
  | { type: 'move'; lotId: string; locationId: string; code?: string; from?: string }
  // Нова коробка: qty відділяємо від коробки fromBoxId (тієї ж партії) і
  // ставимо на стелаж locationId. boxId — код етикетки нової коробки
  // (ставить stamp, без мережі); повтор із тим самим boxId нічого не робить.
  | { type: 'placeBox'; fromBoxId: string; qty: number; locationId: string; boxId?: string }
  | { type: 'moveBox'; boxId: string; locationId: string }
  // Збирання: працівник відсканував коробку й узяв qty під замовлення.
  | { type: 'pick'; orderId: string; boxId: string; qty: number }
  // Uscita rapida (2c.1): товар виходить у dest без замовлення в SkladAI.
  // boxId — з відсканованої коробки (не більше, ніж у ній); без boxId —
  // за продуктом productId, система бере за FEFO з кількох коробок.
  | { type: 'uscita'; dest: Destinazione; qty: number; boxId?: string; productId?: string }
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
  if (stamped.type === 'register' && !stamped.lotId) return { ...stamped, lotId: newId() }
  if (stamped.type === 'placeBox' && !stamped.boxId) return { ...stamped, boxId: newId() }
  return stamped
}

/**
 * Бере `qty` з коробок `from` по черзі (у заданому порядку). Повертає нові
 * коробки стану без порожніх, скільки вдалося взяти (не більше, ніж є) і
 * скільки з якої коробки (`parts`, для записів Pick).
 */
function takeFromBoxes(boxes: Box[], from: Box[], qty: number): { boxes: Box[]; taken: number; parts: { box: Box; qty: number }[] } {
  const take = new Map<string, number>()
  const parts: { box: Box; qty: number }[] = []
  let left = qty
  for (const b of from) {
    if (left <= 0) break
    const t = Math.min(left, b.qty)
    if (t <= 0) continue
    take.set(b.id, t)
    parts.push({ box: b, qty: t })
    left -= t
  }
  return {
    boxes: boxes.map((b) => (take.has(b.id) ? { ...b, qty: b.qty - take.get(b.id)! } : b)).filter((b) => b.qty > 0),
    taken: qty - left,
    parts,
  }
}

/** Скільки вже зібрано (усіма способами) під рядок замовлення з цим продуктом. */
function picked(picks: Pick[], orderId: string, productId: string): number {
  return picks.filter((p) => p.orderId === orderId && p.productId === productId).reduce((s, p) => s + p.qty, 0)
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
      const from = state.boxes.filter((b) => b.lotId === lot.id && (!action.from || b.locationId === action.from))
      const { boxes, taken } = takeFromBoxes(state.boxes, from, action.qty)
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
        // Переїжджають усі коробки партії (або лише ті, що на стелажі from);
        // одна коробка — moveBox.
        boxes: state.boxes.map((b) => (b.lotId === lot.id && (!action.from || b.locationId === action.from) ? { ...b, locationId: to.id } : b)),
        log: [...state.log, { at: now(), text: `Lotto ${lot.code} spostato in ${to.name}` }],
      }
    }
    case 'placeBox': {
      // Коробка з цим кодом уже є (повтор тієї самої дії) — другу не створюємо.
      // Перевіряємо першим: вихідна коробка могла вже спорожніти.
      if (action.boxId && state.boxes.some((b) => b.id === action.boxId)) return state
      const from = state.boxes.find((b) => b.id === action.fromBoxId)
      const to = state.locations.find((l) => l.id === action.locationId)
      // Не можна відділити більше, ніж є в коробці.
      if (!from || !to || !(action.qty > 0) || action.qty > from.qty) return state
      const lot = state.lots.find((l) => l.id === from.lotId)
      const product = state.products.find((p) => p.id === lot?.productId)
      if (!lot || !product) return state
      const box: Box = {
        id: action.boxId ?? nextBoxId(lot.id, state.boxes.map((b) => b.id)),
        lotId: lot.id,
        locationId: to.id,
        qty: action.qty,
      }
      const boxes = [...state.boxes.map((b) => (b.id === from.id ? { ...b, qty: b.qty - action.qty } : b)).filter((b) => b.qty > 0), box]
      return {
        ...state,
        boxes,
        log: [...state.log, { at: now(), text: `Nuovo collo dal lotto ${lot.code}: ${product.name} ${action.qty} ${product.unit} → ${to.name}` }],
      }
    }
    case 'moveBox': {
      const box = state.boxes.find((b) => b.id === action.boxId)
      const to = state.locations.find((l) => l.id === action.locationId)
      if (!box || !to || box.locationId === to.id) return state
      const lot = state.lots.find((l) => l.id === box.lotId)
      return {
        ...state,
        boxes: state.boxes.map((b) => (b.id === box.id ? { ...b, locationId: to.id } : b)),
        log: [...state.log, { at: now(), text: `Collo del lotto ${lot?.code ?? box.lotId} (${box.qty}) spostato in ${to.name}` }],
      }
    }
    case 'pick': {
      const order = state.orders.find((o) => o.id === action.orderId)
      const box = state.boxes.find((b) => b.id === action.boxId)
      if (!order || !box || order.status === 'spedito') return state
      const lot = state.lots.find((l) => l.id === box.lotId)
      const product = state.products.find((p) => p.id === lot?.productId)
      // Коробка має бути з продуктом, який є в замовленні; не більше, ніж у коробці.
      // Більше, ніж замовлено в рядку, — можна: вага упаковок «плаває» (10,3 кг на 10).
      // Зайве видно в orderProgress (picked > ordered).
      if (!lot || !product || !order.lines.some((l) => l.productId === product.id)) return state
      if (!(action.qty > 0) || action.qty > box.qty) return state
      const boxes = state.boxes.map((b) => (b.id === box.id ? { ...b, qty: b.qty - action.qty } : b)).filter((b) => b.qty > 0)
      const pick: Pick = { orderId: order.id, productId: product.id, boxId: box.id, lotId: lot.id, qty: action.qty, at: now(), method: 'scansionato' }
      return {
        ...state,
        lots: dropEmptyLots(state.lots, boxes),
        boxes,
        picks: [...state.picks, pick],
        // Почали збирати — замовлення вже «in preparazione».
        orders: order.status === 'nuovo' ? state.orders.map((o) => (o.id === order.id ? { ...o, status: 'in_preparazione' } : o)) : state.orders,
        log: [...state.log, { at: now(), text: `Prelievo ${action.qty} ${product.unit} ${product.name} dal lotto ${lot.code} per ordine ${order.id}` }],
      }
    }
    case 'uscita': {
      if (!(action.dest in DEST_LABEL) || !(action.qty > 0)) return state
      const box = action.boxId ? state.boxes.find((b) => b.id === action.boxId) : undefined
      if (action.boxId && !box) return state
      const productId = box ? state.lots.find((l) => l.id === box.lotId)?.productId : action.productId
      const product = state.products.find((p) => p.id === productId)
      if (!product) return state
      const from = box ? [box] : fefoBoxesOf(state, product.id)
      // Не можна взяти більше, ніж є (у коробці або в усіх коробках продукту).
      if (action.qty > from.reduce((s, b) => s + b.qty, 0)) return state
      const taken = takeFromBoxes(state.boxes, from, action.qty)
      const lots = new Map(state.lots.map((l) => [l.id, l]))
      const uscite: Uscita[] = taken.parts.map((p) => ({
        boxId: p.box.id, lotId: p.box.lotId, productId: product.id, qty: p.qty, dest: action.dest, at: now(),
      }))
      return {
        ...state,
        lots: dropEmptyLots(state.lots, taken.boxes),
        boxes: taken.boxes,
        uscite: [...state.uscite, ...uscite],
        log: [
          ...state.log,
          ...uscite.map((u) => ({
            at: u.at,
            text: `Uscita ${u.qty} ${product.unit} ${product.name} dal lotto ${lots.get(u.lotId)?.code ?? u.lotId} → ${DEST_LABEL[u.dest]}`,
          })),
        ],
      }
    }
    case 'orderStatus': {
      const order = state.orders.find((o) => o.id === action.orderId)
      if (!order || order.status === action.status) return state
      // «Spedito» остаточний: товар уже списано. Повернення — окрема дія (reso, етап 5).
      if (order.status === 'spedito') return state
      let lots = state.lots
      let boxes = state.boxes
      const picks = [...state.picks]
      const log = [...state.log]
      if (action.status === 'spedito') {
        // Те, що вже зібрано сканером, уже списано з коробок. Решту рядка
        // система добирає сама за FEFO — спершу коробки партій, що раніше
        // спливають (для Montasio — найстаріші форми), — і позначає «automatico».
        for (const line of order.lines) {
          const left = line.qty - picked(state.picks, order.id, line.productId)
          if (left <= 0) continue
          const from = fefoBoxesOf({ ...state, boxes }, line.productId)
          const taken = takeFromBoxes(boxes, from, left)
          boxes = taken.boxes
          for (const part of taken.parts) {
            picks.push({ orderId: order.id, productId: line.productId, boxId: part.box.id, lotId: part.box.lotId, qty: part.qty, at: now(), method: 'automatico' })
          }
        }
        lots = dropEmptyLots(lots, boxes)
        log.push({ at: now(), text: `Spedito ordine ${order.id} a ${order.client}` })
      }
      return {
        ...state,
        lots,
        boxes,
        picks,
        log,
        orders: state.orders.map((o) => (o.id === action.orderId ? { ...o, status: action.status } : o)),
      }
    }
    case 'reset':
      return createSeed()
  }
}
