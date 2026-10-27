// Розрахунки, спільні для всіх екранів. Чисті функції: отримують стан —
// повертають цифри. Їх же читатиме AI-агент.
// «Сьогодні» приходить параметром `today` (північ за UTC дня в Римі, див. startOfDay):
// селектори ніколи не дивляться на годинник самі, тож тест чи агент можуть
// порахувати склад на будь-яку дату.

import { romeDate } from './time'
import type { AppState, Box, Location, Lot, Product } from './types'

const DAY = 24 * 60 * 60 * 1000

/**
 * Календарний день моменту `now` за часом Риму → північ цього дня за UTC.
 * Пояс пристрою не впливає: о 00:30 у Римі це вже новий день навіть на
 * телефоні з поясом UTC.
 */
export function startOfDay(now: Date): Date {
  return new Date(romeDate(now) + 'T00:00:00Z')
}

/** Дата `today` як рядок ISO «РРРР-ММ-ДД». */
export function isoDate(today: Date): string {
  return today.toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, to: Date): number {
  return Math.round((to.getTime() - new Date(fromIso + 'T00:00:00Z').getTime()) / DAY)
}

export function daysUntil(iso: string, today: Date): number {
  return -daysBetween(iso, today)
}

export function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function productMap(state: AppState): Record<string, Product> {
  return Object.fromEntries(state.products.map((p) => [p.id, p]))
}

export function locationMap(state: AppState): Record<string, Location> {
  return Object.fromEntries(state.locations.map((l) => [l.id, l]))
}

export type AgeClass = 'fresco' | 'mezzano' | 'stagionato'

/** Класи витримки Montasio: fresco до 5 міс., mezzano 5–10 міс., stagionato понад 10 міс. */
export function ageClass(days: number): AgeClass {
  if (days < 150) return 'fresco'
  if (days < 300) return 'mezzano'
  return 'stagionato'
}

/** Коробки однієї партії (за внутрішнім ID). */
export function boxesOf(state: AppState, lotId: string): Box[] {
  return state.boxes.filter((b) => b.lotId === lotId)
}

/** Залишок партії = сума її коробок. */
export function lotQty(state: AppState, lotId: string): number {
  return boxesOf(state, lotId).reduce((s, b) => s + b.qty, 0)
}

/** Партія на одному стелажі з кількістю — те, що показують екрани. */
export interface LotStock extends Lot {
  locationId: string
  /** Сума коробок цієї партії на цьому стелажі. */
  qty: number
}

/**
 * Склад по партіях і стелажах: один рядок на пару (партія, стелаж), кількість
 * — сума коробок. Порядок — як у state.lots. Партії без коробок не потрапляють.
 */
export function lotStock(state: AppState): LotStock[] {
  const byLot = new Map<string, Map<string, number>>()
  for (const b of state.boxes) {
    const places = byLot.get(b.lotId) ?? new Map<string, number>()
    places.set(b.locationId, (places.get(b.locationId) ?? 0) + b.qty)
    byLot.set(b.lotId, places)
  }
  return state.lots.flatMap((lot) =>
    [...(byLot.get(lot.id) ?? [])].filter(([, qty]) => qty > 0).map(([locationId, qty]) => ({ ...lot, locationId, qty })),
  )
}

export function lotsAt(state: AppState, locationId: string): LotStock[] {
  return lotStock(state).filter((l) => l.locationId === locationId)
}

export function usedSpace(state: AppState, locationId: string): number {
  const pm = productMap(state)
  return lotsAt(state, locationId).reduce((s, l) => s + l.qty * (pm[l.productId]?.spacePerUnit ?? 1), 0)
}

export function occupancy(state: AppState, loc: Location): number {
  if (!loc.capacity) return 0
  return Math.min(100, Math.round((usedSpace(state, loc.id) / loc.capacity) * 100))
}

/** Середній вік (днів) Montasio на стелажі, зважений за кількістю форм. */
export function avgAgeDays(state: AppState, locationId: string, today: Date): number | null {
  const lots = lotsAt(state, locationId)
  const total = lots.reduce((s, l) => s + l.qty, 0)
  if (!total) return null
  return Math.round(lots.reduce((s, l) => s + l.qty * daysBetween(l.producedAt, today), 0) / total)
}

/** Найближчий термін придатності на місці зберігання (днів), або null. */
export function firstExpiryDays(state: AppState, locationId: string, today: Date): number | null {
  const days = lotsAt(state, locationId)
    .filter((l) => l.expiresAt)
    .map((l) => daysUntil(l.expiresAt!, today))
  return days.length ? Math.min(...days) : null
}

export function stockByProduct(state: AppState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of lotStock(state)) out[l.productId] = (out[l.productId] ?? 0) + l.qty
  return out
}

export function openOrders(state: AppState, today: Date, withinDays = 7) {
  return state.orders
    .filter((o) => o.status !== 'spedito' && daysUntil(o.due, today) <= withinDays)
    .sort((a, b) => a.due.localeCompare(b.due))
}

export interface PlanRow {
  product: Product
  ordered: number
  /** Уже зібрано під ці замовлення: воно вже не на складі, але й робити його не треба. */
  picked: number
  stock: number
  todo: number
  firstDue: string | null
}

/** Що виробити: підтверджені замовлення на 7 днів мінус склад. */
export function productionPlan(state: AppState, today: Date): PlanRow[] {
  const stock = stockByProduct(state)
  const ordered: Record<string, number> = {}
  const picked: Record<string, number> = {}
  const firstDue: Record<string, string> = {}
  for (const o of openOrders(state, today)) {
    for (const line of o.lines) {
      ordered[line.productId] = (ordered[line.productId] ?? 0) + line.qty
      // Зібране понад рядок (вага «плаває») не зменшує потребу інших замовлень.
      picked[line.productId] = (picked[line.productId] ?? 0) + Math.min(line.qty, pickedQty(state, o.id, line.productId))
      if (!firstDue[line.productId] || o.due < firstDue[line.productId]) firstDue[line.productId] = o.due
    }
  }
  return state.products
    .filter((p) => ordered[p.id])
    .map((p) => ({
      product: p,
      ordered: ordered[p.id],
      picked: picked[p.id] ?? 0,
      stock: stock[p.id] ?? 0,
      todo: Math.max(0, ordered[p.id] - (picked[p.id] ?? 0) - (stock[p.id] ?? 0)),
      firstDue: firstDue[p.id] ?? null,
    }))
    .sort((a, b) => b.todo - a.todo)
}

export function expiringLots(state: AppState, today: Date, withinDays = 7): LotStock[] {
  return lotStock(state)
    .filter((l) => l.expiresAt && daysUntil(l.expiresAt, today) <= withinDays)
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''))
}

export function stockValue(state: AppState): number {
  const pm = productMap(state)
  return lotStock(state).reduce((s, l) => s + l.qty * (pm[l.productId]?.pricePerUnit ?? 0), 0)
}

export function agingSummary(state: AppState, today: Date) {
  const out: Record<AgeClass, number> = { fresco: 0, mezzano: 0, stagionato: 0 }
  for (const l of lotStock(state)) {
    if (l.productId !== 'montasio') continue
    out[ageClass(daysBetween(l.producedAt, today))] += l.qty
  }
  return out
}

/** Усе, що друкується на етикетці коробки (2b.3). */
export interface BoxLabel {
  box: Box
  lot: Lot
  product: Product
  location: Location | undefined
  /** Номер коробки в партії й скільки їх усього: «collo 2/5». */
  index: number
  count: number
}

/** Етикетки коробок у порядку state.boxes; коробки без партії чи продукту пропускаються. */
export function boxLabels(state: AppState): BoxLabel[] {
  const pm = productMap(state)
  const lm = locationMap(state)
  const lots = new Map(state.lots.map((l) => [l.id, l]))
  // Коробки кожної партії — один прохід, а не фільтр на кожну коробку.
  const byLot = new Map<string, Box[]>()
  for (const b of state.boxes) {
    const list = byLot.get(b.lotId) ?? []
    list.push(b)
    byLot.set(b.lotId, list)
  }
  return state.boxes.flatMap((box) => {
    const lot = lots.get(box.lotId)
    const product = lot && pm[lot.productId]
    if (!lot || !product) return []
    const siblings = byLot.get(lot.id)!
    return [{ box, lot, product, location: lm[box.locationId], index: siblings.indexOf(box) + 1, count: siblings.length }]
  })
}

/** Що знайшли за сканом (2b.4): коробку з її етикеткою або стелаж з коробками на ньому. */
export type ScanResult =
  | { kind: 'collo'; label: BoxLabel }
  | { kind: 'posizione'; location: Location; boxes: BoxLabel[] }

/** Відсканований код → коробка чи стелаж зі стану; невідомий код — null. */
export function resolveScan(state: AppState, target: { kind: 'collo' | 'posizione'; id: string }): ScanResult | null {
  if (target.kind === 'collo') {
    const label = boxLabels(state).find((l) => l.box.id === target.id)
    return label ? { kind: 'collo', label } : null
  }
  const location = state.locations.find((l) => l.id === target.id)
  return location ? { kind: 'posizione', location, boxes: byExpiry(boxLabels(state).filter((l) => l.box.locationId === location.id)) } : null
}

/** FEFO: спершу коробки, що раніше спливають (для витримки — найстаріші); стабільно. */
function byExpiry(labels: BoxLabel[]): BoxLabel[] {
  return [...labels].sort((a, b) => (a.lot.expiresAt ?? a.lot.producedAt).localeCompare(b.lot.expiresAt ?? b.lot.producedAt))
}

/** Для пошуку: великі літери, без пробілів, крапок і дефісів («l 2310 mz» = «L-2310-MZ»). */
function searchKey(text: string): string {
  return text.toUpperCase().replace(/[\s.\-·/]/g, '')
}

/**
 * Чи підходить стелаж під запит: id з початку («C1» → C1-1, C1-2) або назва з
 * початку будь-якого слова («A3», «scaffale a3», «ripiano 1»). З початку
 * слова — щоб «A3» не знаходив «Cella 3» (CELLA3 містить A3 усередині).
 */
function placeMatches(place: Location, q: string): boolean {
  if (searchKey(place.id).startsWith(q)) return true
  const words = place.name.split(/[\s.\-·/]+/).filter(Boolean)
  return words.some((_, i) => searchKey(words.slice(i).join('')).startsWith(q))
}

/**
 * Ручний резерв сканера. Запит — частина коду лоту з етикетки («2310MZ») або
 * назва чи id стелажа («A3»). Повертає коробки (за лотом або ті, що стоять на
 * знайдених стелажах) за FEFO — найближчий термін першим — і самі стелажі
 * (відкрити порожній чи завершити «Sposta» без QR). Коротше 2 символів —
 * лише точний id стелажа.
 */
export function manualSearch(state: AppState, query: string, limit = 20): { boxes: BoxLabel[]; places: Location[]; more: number } {
  const q = searchKey(query)
  if (!q) return { boxes: [], places: [], more: 0 }
  const places = state.locations.filter((l) => l.kind !== 'machine' && (q.length >= 2 ? placeMatches(l, q) : searchKey(l.id) === q))
  const placeIds = new Set(places.map((p) => p.id))
  const boxes = boxLabels(state).filter((l) => placeIds.has(l.box.locationId) || (q.length >= 2 && searchKey(l.lot.code).includes(q)))
  // more — скільки коробок не влізло в список (тоді краще відкрити сам стелаж).
  return { boxes: byExpiry(boxes).slice(0, limit), places: places.slice(0, limit), more: Math.max(0, boxes.length - limit) }
}

/** Скільки зібрано під рядок замовлення (сканером і автоматично). */
export function pickedQty(state: AppState, orderId: string, productId: string): number {
  return state.picks.filter((p) => p.orderId === orderId && p.productId === productId).reduce((s, p) => s + p.qty, 0)
}

export interface PickProgress {
  productId: string
  ordered: number
  picked: number
}

/** Прогрес збирання замовлення: по рядку «зібрано X з Y». */
export function orderProgress(state: AppState, orderId: string): PickProgress[] {
  const order = state.orders.find((o) => o.id === orderId)
  if (!order) return []
  return order.lines.map((line) => ({ productId: line.productId, ordered: line.qty, picked: pickedQty(state, order.id, line.productId) }))
}

/** Чи вистачає складу, щоб закрити замовлення (для статусу в таблиці). */
export function orderCoverage(state: AppState, orderId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId)
  if (!order) return false
  const stock = stockByProduct(state)
  // Зібране вже списано зі складу — порівнюємо склад лише з незібраною рештою.
  return order.lines.every((line) => (stock[line.productId] ?? 0) >= line.qty - pickedQty(state, order.id, line.productId))
}
