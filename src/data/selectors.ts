// Розрахунки, спільні для всіх екранів. Чисті функції: отримують стан —
// повертають цифри. Їх же читатиме AI-агент.

import type { AppState, Location, Lot, Product } from './types'

const DAY = 24 * 60 * 60 * 1000

export function today(): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

export function daysBetween(fromIso: string, to: Date = today()): number {
  return Math.round((to.getTime() - new Date(fromIso + 'T00:00:00Z').getTime()) / DAY)
}

export function daysUntil(iso: string): number {
  return -daysBetween(iso)
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

export function lotsAt(state: AppState, locationId: string): Lot[] {
  return state.lots.filter((l) => l.locationId === locationId)
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
export function avgAgeDays(state: AppState, locationId: string): number | null {
  const lots = lotsAt(state, locationId)
  const total = lots.reduce((s, l) => s + l.qty, 0)
  if (!total) return null
  return Math.round(lots.reduce((s, l) => s + l.qty * daysBetween(l.producedAt), 0) / total)
}

/** Найближчий термін придатності на місці зберігання (днів), або null. */
export function firstExpiryDays(state: AppState, locationId: string): number | null {
  const days = lotsAt(state, locationId)
    .filter((l) => l.expiresAt)
    .map((l) => daysUntil(l.expiresAt!))
  return days.length ? Math.min(...days) : null
}

export function stockByProduct(state: AppState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of state.lots) out[l.productId] = (out[l.productId] ?? 0) + l.qty
  return out
}

export function openOrders(state: AppState, withinDays = 7) {
  return state.orders
    .filter((o) => o.status !== 'spedito' && daysUntil(o.due) <= withinDays)
    .sort((a, b) => a.due.localeCompare(b.due))
}

export interface PlanRow {
  product: Product
  ordered: number
  stock: number
  todo: number
  firstDue: string | null
}

/** Що виробити: підтверджені замовлення на 7 днів мінус склад. */
export function productionPlan(state: AppState): PlanRow[] {
  const stock = stockByProduct(state)
  const ordered: Record<string, number> = {}
  const firstDue: Record<string, string> = {}
  for (const o of openOrders(state)) {
    for (const line of o.lines) {
      ordered[line.productId] = (ordered[line.productId] ?? 0) + line.qty
      if (!firstDue[line.productId] || o.due < firstDue[line.productId]) firstDue[line.productId] = o.due
    }
  }
  return state.products
    .filter((p) => ordered[p.id])
    .map((p) => ({
      product: p,
      ordered: ordered[p.id],
      stock: stock[p.id] ?? 0,
      todo: Math.max(0, ordered[p.id] - (stock[p.id] ?? 0)),
      firstDue: firstDue[p.id] ?? null,
    }))
    .sort((a, b) => b.todo - a.todo)
}

export function expiringLots(state: AppState, withinDays = 7) {
  return state.lots
    .filter((l) => l.expiresAt && daysUntil(l.expiresAt) <= withinDays)
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''))
}

export function stockValue(state: AppState): number {
  const pm = productMap(state)
  return state.lots.reduce((s, l) => s + l.qty * (pm[l.productId]?.pricePerUnit ?? 0), 0)
}

export function agingSummary(state: AppState) {
  const out: Record<AgeClass, number> = { fresco: 0, mezzano: 0, stagionato: 0 }
  for (const l of state.lots) {
    if (l.productId !== 'montasio') continue
    out[ageClass(daysBetween(l.producedAt))] += l.qty
  }
  return out
}

/** Чи вистачає складу, щоб закрити замовлення (для статусу в таблиці). */
export function orderCoverage(state: AppState, orderId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId)
  if (!order) return false
  const stock = stockByProduct(state)
  return order.lines.every((line) => (stock[line.productId] ?? 0) >= line.qty)
}
