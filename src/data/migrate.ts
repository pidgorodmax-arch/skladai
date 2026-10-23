// Міграції стану: як прочитати дані, збережені старішою версією застосунку.
//
// Навіщо: у клієнта в браузері (а згодом у таблиці) лежать дані у форматі,
// з яким працювала версія застосунку на момент запису. Коли ми додаємо поле
// (наприклад, коробки в етапі 2b), старі дані цього поля не мають — і без
// міграції екран упаде на `undefined`. Міграція по кроках дописує нове поле
// зі значенням за замовчуванням: v1 → v2 → v3 … до STATE_VERSION.

import { firstBoxId } from './seed'
import { STATE_VERSION, type AppState, type Box } from './types'

/** Будь-які збережені дані з номером версії. */
export type VersionedData = { version: number } & Record<string, unknown>

/** Один крок: дані версії N → дані версії N + 1. */
export type Migration = (old: VersionedData) => VersionedData

/** Сигли, які до v2 були зашиті в коді (seed.ts), — для старих збережених даних. */
const LEGACY_ABBR: Record<string, string> = {
  montasio: 'MO', mozzarella: 'MZ', ricotta: 'RI', yogurt: 'YB', kefir: 'KF', burro: 'BU', latte: 'LT',
}

/** Сигла для продукту без неї: зі старої таблиці, інакше перші дві літери `id`, інакше XX. */
export function fallbackAbbr(productId: string): string {
  return LEGACY_ABBR[productId] ?? (productId.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'XX')
}

/**
 * Кроки міграції. Ключ — версія, З ЯКОЇ переходимо: MIGRATIONS[1] робить v1 → v2.
 */
export const MIGRATIONS: Record<number, Migration> = {
  // v2 (2.2a): у продукту з'явились `abbr` (сигла для коду лоту) і
  // необов'язковий `code`. Старим продуктам дописуємо сиглу; `code` лишається
  // порожнім, нових продуктів міграція не додає.
  1: (old) => ({
    ...old,
    version: 2,
    products: Array.isArray(old.products)
      ? old.products.map((p: unknown) =>
          isRecord(p) && typeof p.abbr !== 'string' ? { ...p, abbr: fallbackAbbr(String(p.id ?? '')) } : p,
        )
      : old.products,
  }),
  // v3 (2.6): у партії внутрішній ID (`id`) і окремий код для людей (`code`).
  // Старі партії мали лише код у `id` — він і стає `code`, а `id` лишається
  // тим самим, тож усі посилання на партії не змінюються.
  2: (old) => ({
    ...old,
    version: 3,
    lots: Array.isArray(old.lots)
      ? old.lots.map((l: unknown) => (isRecord(l) && typeof l.code !== 'string' ? { ...l, code: String(l.id ?? '') } : l))
      : old.lots,
  }),
  // v4 (2b.1): кількість і місце переїхали з партії в коробки. Кожна стара
  // партія стає однією коробкою `<id>-1` з тією ж кількістю на тому ж
  // стелажі; у самій партії ці поля прибираємо. Збирань (picks) ще не було.
  // Цей же крок перетворює дані з Google Таблиці: Apps Script поки віддає v3.
  3: (old) => {
    const lots = Array.isArray(old.lots) ? old.lots : []
    const boxes: Box[] = []
    const cleaned = lots.map((l: unknown) => {
      if (!isRecord(l)) return l
      const { qty, locationId, ...lot } = l
      const amount = Number(qty)
      if (amount > 0) boxes.push({ id: firstBoxId(String(lot.id ?? '')), lotId: String(lot.id ?? ''), locationId: String(locationId ?? ''), qty: amount })
      return lot
    })
    return { ...old, version: 4, lots: Array.isArray(old.lots) ? cleaned : old.lots, boxes, picks: [] }
  },
}

/** Застосовує кроки по черзі до версії `target`. null — якщо дійти не можна. */
export function runMigrations(data: VersionedData, target: number, steps: Record<number, Migration> = MIGRATIONS): VersionedData | null {
  let current = data
  while (current.version < target) {
    const step = steps[current.version]
    if (!step) return null
    const next = step(current)
    // Захист від помилки в кроці, що не збільшує версію (інакше — вічний цикл).
    if (next.version <= current.version) return null
    current = next
  }
  // Дані новішої версії, ніж знає цей застосунок, — не вгадуємо.
  return current.version === target ? current : null
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

const LISTS = ['products', 'zones', 'locations', 'lots', 'boxes', 'picks', 'orders', 'log'] as const

/** Базова перевірка форми: правильна версія і всі списки на місці. */
export function isAppState(x: unknown): x is AppState {
  return isRecord(x) && x.version === STATE_VERSION && LISTS.every((key) => Array.isArray(x[key]))
}

/**
 * Будь-які прочитані дані → AppState поточної версії або null, якщо їх
 * неможливо безпечно використати (тоді застосунок стартує з демо).
 */
export function migrate(raw: unknown): AppState | null {
  if (!isRecord(raw) || typeof raw.version !== 'number') return null
  const migrated = runMigrations({ ...raw, version: raw.version }, STATE_VERSION)
  return isAppState(migrated) ? migrated : null
}
