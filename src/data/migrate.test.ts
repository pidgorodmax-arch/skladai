// Тести міграцій: старі або пошкоджені дані не повинні ламати застосунок.

import { describe, expect, it } from 'vitest'
import { fallbackAbbr, isAppState, migrate, runMigrations, type Migration } from './migrate'
import { makeState } from './testState'
import { STATE_VERSION } from './types'

describe('migrate', () => {
  it('дані поточної версії проходять без змін', () => {
    const state = makeState()
    expect(migrate(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('сміття, порожні дані й дані без версії → null (тоді стартуємо з демо)', () => {
    expect(migrate(null)).toBeNull()
    expect(migrate('текст')).toBeNull()
    expect(migrate([])).toBeNull()
    expect(migrate({})).toBeNull()
    const noVersion: Record<string, unknown> = { ...makeState() }
    delete noVersion.version
    expect(migrate(noVersion)).toBeNull()
  })

  it('бракує списку (наприклад, lots) → null, а не падіння екрана', () => {
    const broken: Record<string, unknown> = { ...makeState() }
    delete broken.lots
    expect(migrate(broken)).toBeNull()
  })

  it('дані новішої версії, ніж знає застосунок, → null', () => {
    expect(migrate({ ...makeState(), version: STATE_VERSION + 1 })).toBeNull()
  })
})

describe('v1 → v2: сигла продукту (2.2a)', () => {
  /** Стан у форматі v1: без version 2 і без abbr/code у продуктів. */
  function v1State(): Record<string, unknown> {
    const state = makeState()
    return {
      ...state,
      version: 1,
      // у v1 партія мала лише id (він же код для людей)
      lots: state.lots.map(({ code: _code, ...lot }) => lot),
      products: [
        ...state.products.map(({ id, name, unit, spacePerUnit, shelfLifeDays, pricePerUnit, storage }) => ({
          id, name, unit, spacePerUnit, shelfLifeDays, pricePerUnit, storage,
        })),
        { id: 'stracchino-2', name: 'Stracchino', unit: 'kg', spacePerUnit: 1, shelfLifeDays: 10, pricePerUnit: 8, storage: 'cold' },
      ],
    }
  }

  it('відомі продукти отримують сиглу зі старої таблиці, невідомі — з літер id', () => {
    const migrated = migrate(v1State())!
    expect(migrated.version).toBe(STATE_VERSION)
    expect(migrated.products.map((p) => [p.id, p.abbr, p.code])).toEqual([
      ['montasio', 'MO', undefined],
      ['mozzarella', 'MZ', undefined],
      ['yogurt', 'YB', undefined],
      ['stracchino-2', 'ST', undefined],
    ])
  })

  it('партії, замовлення й журнал не губляться (партія отримує code = старий id)', () => {
    const old = v1State()
    const migrated = migrate(old)!
    expect(migrated.lots).toEqual((old.lots as { id: string }[]).map((l) => ({ ...l, code: l.id })))
    expect(migrated.orders).toEqual(old.orders)
    expect(migrated.log).toEqual(old.log)
  })

  it('id без літер → XX', () => {
    expect(fallbackAbbr('123')).toBe('XX')
    expect(fallbackAbbr('')).toBe('XX')
    expect(fallbackAbbr('c1-latte')).toBe('CL')
  })
})

describe('v2 → v3: внутрішній ID партії і код для людей (2.6)', () => {
  it('старий id стає кодом для людей, сам id не змінюється — посилання не ламаються', () => {
    const state = makeState()
    const v2 = { ...state, version: 2, lots: [{ id: 'L-1506-MZ', productId: 'mozzarella', qty: 5, locationId: 'C', producedAt: '2026-06-15', expiresAt: '2026-06-22' }] }
    const migrated = migrate(v2)!
    expect(migrated.version).toBe(3)
    expect(migrated.lots).toEqual([{ id: 'L-1506-MZ', code: 'L-1506-MZ', productId: 'mozzarella', qty: 5, locationId: 'C', producedAt: '2026-06-15', expiresAt: '2026-06-22' }])
    expect(migrated.products).toEqual(state.products)
  })

  it('партія, що вже має code, не змінюється', () => {
    const state = makeState()
    expect(migrate({ ...state, version: 2 })!.lots).toEqual(state.lots)
  })
})

describe('runMigrations — як працюватиме ланцюжок кроків', () => {
  // Вигаданий приклад: у v2 додали коробки, у v3 — у кожного лоту поле boxIds.
  const steps: Record<number, Migration> = {
    1: (old) => ({ ...old, version: 2, boxes: [] }),
    2: (old) => ({
      ...old,
      version: 3,
      lots: (old.lots as Record<string, unknown>[]).map((lot) => ({ ...lot, boxIds: [] })),
    }),
  }

  it('v1 → v3 крок за кроком, старі дані зберігаються', () => {
    const v1 = { version: 1, lots: [{ id: 'L-1', qty: 5 }] }
    expect(runMigrations(v1, 3, steps)).toEqual({
      version: 3,
      boxes: [],
      lots: [{ id: 'L-1', qty: 5, boxIds: [] }],
    })
  })

  it('дані, що вже на потрібній версії, не чіпає', () => {
    const v3 = { version: 3, boxes: ['B-1'], lots: [] }
    expect(runMigrations(v3, 3, steps)).toBe(v3)
  })

  it('пропущений крок → null', () => {
    expect(runMigrations({ version: 0 }, 3, steps)).toBeNull()
  })

  it('крок, що не збільшує версію, не зациклює застосунок', () => {
    expect(runMigrations({ version: 1 }, 2, { 1: (old) => old })).toBeNull()
  })
})

describe('isAppState', () => {
  it('приймає правильний стан', () => {
    expect(isAppState(makeState())).toBe(true)
  })

  it('відхиляє, якщо список не масив', () => {
    expect(isAppState({ ...makeState(), orders: 'немає' })).toBe(false)
  })
})
