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
  occupancy,
  openOrders,
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
    state.lots.push({ id: 'X', productId: 'montasio', qty: 500, locationId: 'A', producedAt: '2026-06-01', expiresAt: null })
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
    state.lots.push({ id: 'OLD', productId: 'mozzarella', qty: 1, locationId: 'C', producedAt: '2026-06-01', expiresAt: '2026-06-08' })
    expect(expiringLots(state, T)[0].id).toBe('OLD')
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
