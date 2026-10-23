// Міграції стану: як прочитати дані, збережені старішою версією застосунку.
//
// Навіщо: у клієнта в браузері (а згодом у таблиці) лежать дані у форматі,
// з яким працювала версія застосунку на момент запису. Коли ми додаємо поле
// (наприклад, коробки в етапі 2b), старі дані цього поля не мають — і без
// міграції екран упаде на `undefined`. Міграція по кроках дописує нове поле
// зі значенням за замовчуванням: v1 → v2 → v3 … до STATE_VERSION.

import { STATE_VERSION, type AppState } from './types'

/** Будь-які збережені дані з номером версії. */
export type VersionedData = { version: number } & Record<string, unknown>

/** Один крок: дані версії N → дані версії N + 1. */
export type Migration = (old: VersionedData) => VersionedData

/**
 * Кроки міграції. Ключ — версія, З ЯКОЇ переходимо: MIGRATIONS[1] робить v1 → v2.
 * Поки формат ще не змінювався, кроків немає. Приклад майбутнього кроку:
 *   1: (old) => ({ ...old, version: 2, boxes: [] }),
 */
export const MIGRATIONS: Record<number, Migration> = {}

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

const LISTS = ['products', 'zones', 'locations', 'lots', 'orders', 'log'] as const

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
