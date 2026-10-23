// Тести розрахунків. Селектори отримують «сьогодні» параметром (T), тому
// годинник «заморожувати» не треба: результат залежить лише від даних і дати.

import { describe, expect, it } from 'vitest'
import {
  ageClass,
  agingSummary,
  avgAgeDays,
  daysBetween,
  daysUntil,
  expiringLots,
  firstExpiryDays,
  isoDate,
  lotQty,
  lotStock,
  lotsAt,
  occupancy,
  openOrders,
  orderProgress,
  orderCoverage,
  productionPlan,
  startOfDay,
  stockByProduct,
  stockValue,
  usedSpace,
} from './selectors'
import { TEST_TODAY as T, makeState } from './testState'

function loc(id: string) {
  return makeState().locations.find((l) => l.id === id)!
}

describe('дати', () => {
  it('startOfDay бере календарний день за Римом і повертає північ за UTC', () => {
    // 00:30 і 23:30 за Римом 15.06 (влітку Рим = UTC+2) → той самий день
    expect(startOfDay(new Date('2026-06-14T22:30:00Z'))).toEqual(T)
    expect(startOfDay(new Date('2026-06-15T21:30:00Z'))).toEqual(T)
    // 00:30 16.06 у Римі — уже наступний день, хоча за UTC ще 15.06
    expect(startOfDay(new Date('2026-06-15T22:30:00Z'))).toEqual(new Date('2026-06-16T00:00:00Z'))
    expect(isoDate(T)).toBe('2026-06-15')
  })

  it('daysBetween рахує дні від дати до сьогодні', () => {
    expect(daysBetween('2026-06-15', T)).toBe(0)
    expect(daysBetween('2026-06-05', T)).toBe(10)
    expect(daysBetween('2026-06-01', new Date('2026-06-11T00:00:00Z'))).toBe(10)
  })

  it('daysUntil рахує дні до дати (мінус — уже минула)', () => {
    expect(daysUntil('2026-06-19', T)).toBe(4)
    expect(daysUntil('2026-06-14', T)).toBe(-1)
  })
})

describe('заповненість', () => {
  it('usedSpace враховує місце на одиницю продукту', () => {
    // 20 + 15 кг моцарели + 100 вазочків × 0,15 = 50
    expect(usedSpace(makeState(), 'C')).toBe(50)
  })

  it('occupancy — відсоток від місткості', () => {
    expect(occupancy(makeState(), loc('A'))).toBe(40)
    expect(occupancy(makeState(), loc('C'))).toBe(100)
    expect(occupancy(makeState(), loc('B'))).toBe(0)
  })

  it('occupancy не перевищує 100% навіть при переповненні', () => {
    const state = makeState()
    state.lots.push({ id: 'X', code: 'L-0106-MO', productId: 'montasio', producedAt: '2026-06-01', expiresAt: null })
    state.boxes.push({ id: 'X-1', lotId: 'X', locationId: 'A', qty: 500 })
    expect(occupancy(state, loc('A'))).toBe(100)
  })

  it('occupancy для машин (місткість 0) — 0, без ділення на нуль', () => {
    expect(occupancy(makeState(), loc('K1'))).toBe(0)
  })
})

describe('вік форм (витримка Montasio)', () => {
  it('ageClass: межі 150 і 300 днів', () => {
    expect(ageClass(0)).toBe('fresco')
    expect(ageClass(149)).toBe('fresco')
    expect(ageClass(150)).toBe('mezzano')
    expect(ageClass(299)).toBe('mezzano')
    expect(ageClass(300)).toBe('stagionato')
  })

  it('avgAgeDays зважує вік за кількістю форм', () => {
    // (30 × 365 + 10 × 30) / 40 = 281,25 → 281
    expect(avgAgeDays(makeState(), 'A', T)).toBe(281)
  })

  it('avgAgeDays для порожнього стелажа — null', () => {
    expect(avgAgeDays(makeState(), 'B', T)).toBeNull()
  })

  it('agingSummary рахує лише форми Montasio за класами', () => {
    expect(agingSummary(makeState(), T)).toEqual({ fresco: 10, mezzano: 0, stagionato: 30 })
  })

  it('та сама партія на іншу дату — інший клас витримки (дата — параметр)', () => {
    // Через 120 днів форми MO-NEW (30 днів) стануть mezzano
    expect(agingSummary(makeState(), new Date('2026-10-13T00:00:00Z'))).toEqual({ fresco: 0, mezzano: 10, stagionato: 30 })
  })
})

describe('терміни придатності', () => {
  it('firstExpiryDays — найближчий термін на місці', () => {
    expect(firstExpiryDays(makeState(), 'C', T)).toBe(4)
  })

  it('firstExpiryDays — null, якщо на місці лише витримка без терміну', () => {
    expect(firstExpiryDays(makeState(), 'A', T)).toBeNull()
  })

  it('expiringLots: межа включно, сортування від найближчого', () => {
    expect(expiringLots(makeState(), T).map((l) => l.id)).toEqual(['MZ-1', 'MZ-2', 'YB-1'])
    expect(expiringLots(makeState(), T, 5).map((l) => l.id)).toEqual(['MZ-1'])
  })

  it('expiringLots показує й прострочені партії', () => {
    const state = makeState()
    state.lots.push({ id: 'OLD', code: 'L-0106-MZ', productId: 'mozzarella', producedAt: '2026-06-01', expiresAt: '2026-06-08' })
    state.boxes.push({ id: 'OLD-1', lotId: 'OLD', locationId: 'C', qty: 1 })
    expect(expiringLots(state, T)[0].id).toBe('OLD')
  })
})

describe('коробки (2b.1): партія = сума коробок', () => {
  /** MZ-1 (20 кг): коробка 12 кг на C і ще дві на B (5 і 3). */
  function split() {
    const state = makeState()
    state.boxes = state.boxes.flatMap((b) =>
      b.lotId === 'MZ-1'
        ? [{ ...b, qty: 12 }, { id: 'MZ-1-2', lotId: 'MZ-1', locationId: 'B', qty: 5 }, { id: 'MZ-1-3', lotId: 'MZ-1', locationId: 'B', qty: 3 }]
        : [b],
    )
    return state
  }

  it('lotQty — сума всіх коробок партії; без коробок — 0', () => {
    expect(lotQty(split(), 'MZ-1')).toBe(20)
    expect(lotQty(makeState(), 'YB-1')).toBe(100)
    expect(lotQty(makeState(), 'немає')).toBe(0)
  })

  it('lotStock — рядок на пару (партія, стелаж), порядок як у партій', () => {
    const rows = lotStock(split()).filter((l) => l.id === 'MZ-1')
    expect(rows.map((r) => [r.code, r.locationId, r.qty])).toEqual([['L-1206-MZ', 'C', 12], ['L-1206-MZ', 'B', 8]])
    expect(lotStock(makeState()).map((l) => l.id)).toEqual(makeState().lots.map((l) => l.id))
  })

  it('стелаж бачить лише свої коробки; загальний склад продукту не змінюється', () => {
    expect(lotsAt(split(), 'B').map((l) => [l.id, l.qty])).toEqual([['MZ-1', 8]])
    expect(stockByProduct(split())).toEqual(stockByProduct(makeState()))
    expect(stockValue(split())).toBe(stockValue(makeState()))
  })

  it('партія без коробок і коробка без партії не рахуються в залишку', () => {
    const state = makeState()
    state.lots.push({ id: 'EMPTY', code: 'L-0106-MZ', productId: 'mozzarella', producedAt: '2026-06-01', expiresAt: '2026-06-08' })
    state.boxes.push({ id: 'ORPHAN-1', lotId: 'ORPHAN', locationId: 'C', qty: 99 })
    expect(stockByProduct(state)).toEqual(stockByProduct(makeState()))
    expect(expiringLots(state, T).map((l) => l.id)).not.toContain('EMPTY')
  })
})

describe('прогрес збирання (2b.2)', () => {
  it('orderProgress: «зібрано X з Y» по кожному рядку, сумуючи всі Pick', () => {
    const state = makeState()
    state.picks = [
      { orderId: 'O1', productId: 'mozzarella', boxId: 'MZ-1-1', lotId: 'MZ-1', qty: 10, at: '2026-06-15T08:00', method: 'scansionato' },
      { orderId: 'O1', productId: 'mozzarella', boxId: 'MZ-2-1', lotId: 'MZ-2', qty: 5, at: '2026-06-15T08:05', method: 'scansionato' },
      { orderId: 'O2', productId: 'mozzarella', boxId: 'MZ-1-1', lotId: 'MZ-1', qty: 3, at: '2026-06-15T08:10', method: 'scansionato' },
    ]
    expect(orderProgress(state, 'O1')).toEqual([
      { productId: 'mozzarella', ordered: 50, picked: 15 },
      { productId: 'montasio', ordered: 5, picked: 0 },
    ])
    expect(orderProgress(state, 'немає')).toEqual([])
  })
})

describe('зібране не рахується двічі (2b.2)', () => {
  /** O2 (10 кг моцарели), зібрано повністю: зі складу вже списано 10. */
  function pickedO2() {
    const state = makeState()
    state.boxes = state.boxes.map((b) => (b.id === 'MZ-1-1' ? { ...b, qty: 10 } : b))
    state.picks = [{ orderId: 'O2', productId: 'mozzarella', boxId: 'MZ-1-1', lotId: 'MZ-1', qty: 10, at: '2026-06-15T08:00', method: 'scansionato' }]
    return state
  }

  it('повністю зібране замовлення покрите, навіть якщо складу вже немає', () => {
    const state = pickedO2()
    state.boxes = state.boxes.filter((b) => !b.lotId.startsWith('MZ'))
    expect(orderCoverage(state, 'O2')).toBe(true)
  })

  it('зібране не збільшує «da produrre» у плані', () => {
    const before = productionPlan(makeState(), T).find((r) => r.product.id === 'mozzarella')!
    const after = productionPlan(pickedO2(), T).find((r) => r.product.id === 'mozzarella')!
    expect(after).toMatchObject({ ordered: before.ordered, picked: 10, stock: before.stock - 10, todo: before.todo })
  })

  it('зібране понад рядок не зменшує потребу інших замовлень', () => {
    const state = pickedO2()
    state.picks[0] = { ...state.picks[0], qty: 12 }
    state.boxes = state.boxes.map((b) => (b.id === 'MZ-1-1' ? { ...b, qty: 8 } : b))
    const plan = productionPlan(state, T).find((r) => r.product.id === 'mozzarella')!
    expect(plan.picked).toBe(10)
  })
})

describe('склад і замовлення', () => {
  it('stockByProduct сумує партії за продуктом', () => {
    expect(stockByProduct(makeState())).toEqual({ montasio: 40, mozzarella: 35, yogurt: 100 })
  })

  it('stockValue = кількість × ціна', () => {
    // 40 × 95 + 35 × 9,5 + 100 × 0,9
    expect(stockValue(makeState())).toBeCloseTo(4222.5)
  })

  it('openOrders: без відвантажених і далеких, від найтерміновішого', () => {
    expect(openOrders(makeState(), T).map((o) => o.id)).toEqual(['O2', 'O1', 'O5'])
    expect(openOrders(makeState(), T, 30).map((o) => o.id)).toEqual(['O2', 'O1', 'O5', 'O3'])
  })

  it('orderCoverage: чи вистачає складу на замовлення', () => {
    const state = makeState()
    expect(orderCoverage(state, 'O1')).toBe(false) // моцарели 50 > 35
    expect(orderCoverage(state, 'O2')).toBe(true)
    expect(orderCoverage(state, 'немає')).toBe(false)
  })
})

describe('план виробництва', () => {
  it('замовлено на 7 днів мінус склад, найбільший дефіцит першим', () => {
    const plan = productionPlan(makeState(), T)
    expect(plan.map((r) => ({ id: r.product.id, ordered: r.ordered, stock: r.stock, todo: r.todo, firstDue: r.firstDue }))).toEqual([
      // O1 50 + O2 10 + O5 25 = 85, на складі 35
      { id: 'mozzarella', ordered: 85, stock: 35, todo: 50, firstDue: '2026-06-16' },
      // O1 5 + O5 35 = 40, на складі 40 — виробляти не треба
      { id: 'montasio', ordered: 40, stock: 40, todo: 0, firstDue: '2026-06-17' },
    ])
  })

  it('не включає продукти без замовлень на 7 днів (йогурт — лише в далекому O3)', () => {
    expect(productionPlan(makeState(), T).some((r) => r.product.id === 'yogurt')).toBe(false)
  })

  it('без відкритих замовлень план порожній', () => {
    const state = makeState()
    state.orders = []
    expect(productionPlan(state, T)).toEqual([])
  })
})
