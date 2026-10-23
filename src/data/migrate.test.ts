// Тести міграцій: старі або пошкоджені дані не повинні ламати застосунок.

import { describe, expect, it } from 'vitest'
import { fallbackAbbr, isAppState, migrate, runMigrations, type Migration } from './migrate'
import { lotStock } from './selectors'
import { makeState } from './testState'
import { STATE_VERSION } from './types'

/**
 * Стан у форматі v3 (до 2b.1): кількість і стелаж у самій партії, без коробок.
 * Саме такий стан і досі віддає Apps Script.
 */
function v3State(): Record<string, unknown> {
  const { boxes: _boxes, picks: _picks, ...state } = makeState()
  return {
    ...state,
    version: 3,
    lots: lotStock(makeState()).map(({ id, code, productId, qty, locationId, producedAt, expiresAt }) => ({
      id, code, productId, qty, locationId, producedAt, expiresAt,
    })),
  }
}

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
      ...v3State(),
      version: 1,
      // у v1 партія мала лише id (він же код для людей)
      lots: (v3State().lots as Record<string, unknown>[]).map(({ code: _code, ...lot }) => lot),
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
    type OldLot = { id: string; qty: number; locationId: string }
    expect(migrated.lots).toEqual((old.lots as OldLot[]).map(({ qty: _q, locationId: _l, ...l }) => ({ ...l, code: l.id })))
    expect(lotStock(migrated).map((l) => [l.id, l.qty, l.locationId])).toEqual((old.lots as OldLot[]).map((l) => [l.id, l.qty, l.locationId]))
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
    const migrated = runMigrations(v2, 3)!
    expect(migrated.version).toBe(3)
    expect(migrated.lots).toEqual([{ id: 'L-1506-MZ', code: 'L-1506-MZ', productId: 'mozzarella', qty: 5, locationId: 'C', producedAt: '2026-06-15', expiresAt: '2026-06-22' }])
    expect(migrated.products).toEqual(state.products)
  })

  it('партія, що вже має code, не змінюється', () => {
    const state = v3State()
    expect(runMigrations({ ...state, version: 2 }, 3)!.lots).toEqual(state.lots)
  })
})

describe('v3 → v4: коробки (2b.1)', () => {
  it('кожна стара партія стає однією коробкою `<id>-1` з тією ж кількістю на тому ж стелажі', () => {
    const migrated = migrate(v3State())!
    expect(migrated.version).toBe(STATE_VERSION)
    expect(migrated.boxes).toEqual([
      { id: 'MO-NEW-1', lotId: 'MO-NEW', locationId: 'A', qty: 10 },
      { id: 'MO-OLD-1', lotId: 'MO-OLD', locationId: 'A', qty: 30 },
      { id: 'MZ-2-1', lotId: 'MZ-2', locationId: 'C', qty: 15 },
      { id: 'MZ-1-1', lotId: 'MZ-1', locationId: 'C', qty: 20 },
      { id: 'YB-1-1', lotId: 'YB-1', locationId: 'C', qty: 100 },
    ])
    expect(migrated.picks).toEqual([])
    // у самій партії кількості й місця більше немає
    expect(migrated.lots.every((l) => !('qty' in l) && !('locationId' in l))).toBe(true)
  })

  it('залишок кожної партії після міграції = її колишня кількість (нічого не загубилось)', () => {
    const old = v3State()
    const migrated = migrate(old)!
    expect(lotStock(migrated).map((l) => [l.id, l.locationId, l.qty])).toEqual(
      (old.lots as { id: string; locationId: string; qty: number }[]).map((l) => [l.id, l.locationId, l.qty]),
    )
    expect(migrated).toEqual(makeState())
  })

  it('партія з нульовою чи зіпсованою кількістю не дає коробки', () => {
    const old = v3State()
    const lots = old.lots as Record<string, unknown>[]
    lots[0] = { ...lots[0], qty: 0 }
    lots[1] = { ...lots[1], qty: 'molto' }
    const migrated = migrate(old)!
    expect(migrated.boxes.map((b) => b.lotId)).toEqual(['MZ-2', 'MZ-1', 'YB-1'])
  })

  it('без списку партій — null, а не падіння', () => {
    const { lots: _lots, ...broken } = v3State()
    expect(migrate(broken)).toBeNull()
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
