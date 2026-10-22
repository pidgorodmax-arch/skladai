// Тести reducer: для кожної дії перевіряємо, що стан змінюється правильно,
// а некоректна дія повертає той самий стан без змін.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reducer } from './store'
import { TEST_NOW, makeState } from './testState'
import type { AppState } from './types'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TEST_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function qtyOf(state: AppState, lotId: string): number | undefined {
  return state.lots.find((l) => l.id === lotId)?.qty
}

describe('register — нова партія', () => {
  it('додає партію з кодом лоту, терміном і записом у журнал', () => {
    const next = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 40, locationId: 'C', milkLitres: 410 })
    const lot = next.lots.at(-1)!
    expect(lot).toEqual({
      id: 'L-1506-MZ',
      productId: 'mozzarella',
      qty: 40,
      locationId: 'C',
      producedAt: '2026-06-15',
      expiresAt: '2026-06-22', // + 7 днів
      milkLitres: 410,
    })
    expect(next.log.at(-1)).toEqual({ at: '2026-06-15T12:00', text: 'Prodotto lotto L-1506-MZ: Mozzarella 40 kg → Cella 1 · ripiano 1' })
  })

  it('Montasio отримує термін null (витримка)', () => {
    const next = reducer(makeState(), { type: 'register', productId: 'montasio', qty: 12, locationId: 'B' })
    expect(next.lots.at(-1)!.expiresAt).toBeNull()
  })

  it('друга партія того ж дня отримує інший код', () => {
    const once = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' })
    const twice = reducer(once, { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' })
    expect(twice.lots.slice(-2).map((l) => l.id)).toEqual(['L-1506-MZ', 'L-1506-MZ2'])
  })

  it('ігнорує нульову кількість, невідомий продукт або місце', () => {
    const state = makeState()
    expect(reducer(state, { type: 'register', productId: 'mozzarella', qty: 0, locationId: 'C' })).toBe(state)
    expect(reducer(state, { type: 'register', productId: 'brie', qty: 5, locationId: 'C' })).toBe(state)
    expect(reducer(state, { type: 'register', productId: 'mozzarella', qty: 5, locationId: 'Z' })).toBe(state)
  })
})

describe('ship — списання з партії', () => {
  it('зменшує кількість і пише в журнал', () => {
    const next = reducer(makeState(), { type: 'ship', lotId: 'MZ-1', qty: 5 })
    expect(qtyOf(next, 'MZ-1')).toBe(15)
    expect(next.log.at(-1)!.text).toBe('Uscita 5 dal lotto MZ-1')
  })

  it('не списує більше, ніж є, і прибирає порожню партію', () => {
    const next = reducer(makeState(), { type: 'ship', lotId: 'MZ-1', qty: 999 })
    expect(qtyOf(next, 'MZ-1')).toBeUndefined()
    expect(next.log.at(-1)!.text).toBe('Uscita 20 dal lotto MZ-1')
  })

  it('не змінює вихідний стан (незмінність)', () => {
    const state = makeState()
    reducer(state, { type: 'ship', lotId: 'MZ-1', qty: 5 })
    expect(qtyOf(state, 'MZ-1')).toBe(20)
    expect(state.log).toEqual([])
  })

  it('ігнорує невідому партію', () => {
    const state = makeState()
    expect(reducer(state, { type: 'ship', lotId: 'немає', qty: 5 })).toBe(state)
  })
})

describe('move — переміщення партії', () => {
  it('змінює місце і пише в журнал', () => {
    const next = reducer(makeState(), { type: 'move', lotId: 'MO-OLD', locationId: 'B' })
    expect(next.lots.find((l) => l.id === 'MO-OLD')!.locationId).toBe('B')
    expect(next.log.at(-1)!.text).toBe('Lotto MO-OLD spostato in Scaffale B')
  })

  it('ігнорує невідому партію або місце', () => {
    const state = makeState()
    expect(reducer(state, { type: 'move', lotId: 'немає', locationId: 'B' })).toBe(state)
    expect(reducer(state, { type: 'move', lotId: 'MO-OLD', locationId: 'Z' })).toBe(state)
  })
})

describe('orderStatus — статус замовлення', () => {
  it('зміна на «in_preparazione» не чіпає склад', () => {
    const state = makeState()
    const next = reducer(state, { type: 'orderStatus', orderId: 'O1', status: 'in_preparazione' })
    expect(next.orders.find((o) => o.id === 'O1')!.status).toBe('in_preparazione')
    expect(next.lots).toEqual(state.lots)
    expect(next.log).toEqual([])
  })

  it('той самий статус або невідоме замовлення — без змін', () => {
    const state = makeState()
    expect(reducer(state, { type: 'orderStatus', orderId: 'O2', status: 'in_preparazione' })).toBe(state)
    expect(reducer(state, { type: 'orderStatus', orderId: 'немає', status: 'spedito' })).toBe(state)
  })

  it('«spedito» списує за FEFO: спершу партія, що раніше спливає', () => {
    // O2: 10 кг моцарели. MZ-1 спливає 19.06, MZ-2 — 21.06 → беремо з MZ-1.
    const next = reducer(makeState(), { type: 'orderStatus', orderId: 'O2', status: 'spedito' })
    expect(qtyOf(next, 'MZ-1')).toBe(10)
    expect(qtyOf(next, 'MZ-2')).toBe(15)
    expect(next.orders.find((o) => o.id === 'O2')!.status).toBe('spedito')
    expect(next.log.at(-1)!.text).toBe('Spedito ordine O2 a Bar Centrale')
  })

  it('«spedito» для Montasio бере найстаріші форми і переходить на наступну партію', () => {
    // O5: 35 форм Montasio і 25 кг моцарели.
    const next = reducer(makeState(), { type: 'orderStatus', orderId: 'O5', status: 'spedito' })
    expect(qtyOf(next, 'MO-OLD')).toBeUndefined() // 30 найстаріших — повністю
    expect(qtyOf(next, 'MO-NEW')).toBe(5) // решта 5 — з новішої
    expect(qtyOf(next, 'MZ-1')).toBeUndefined() // 20 — повністю
    expect(qtyOf(next, 'MZ-2')).toBe(10) // ще 5 — з наступної
    expect(qtyOf(next, 'YB-1')).toBe(100) // інший продукт не чіпаємо
  })

  it('«spedito» остаточний: статус не можна змінити назад', () => {
    const state = makeState()
    // O4 уже відвантажене
    expect(reducer(state, { type: 'orderStatus', orderId: 'O4', status: 'nuovo' })).toBe(state)
    expect(reducer(state, { type: 'orderStatus', orderId: 'O4', status: 'in_preparazione' })).toBe(state)

    // Повний цикл: відвантажили O2 і спробували повернути в «nuovo» — склад і статус не змінюються
    const shipped = reducer(state, { type: 'orderStatus', orderId: 'O2', status: 'spedito' })
    expect(reducer(shipped, { type: 'orderStatus', orderId: 'O2', status: 'nuovo' })).toBe(shipped)
  })

  it('«spedito» при нестачі списує все наявне, без від\'ємних залишків', () => {
    // O1 хоче 50 кг моцарели, а є лише 35.
    const next = reducer(makeState(), { type: 'orderStatus', orderId: 'O1', status: 'spedito' })
    expect(next.lots.filter((l) => l.productId === 'mozzarella')).toEqual([])
    expect(next.lots.every((l) => l.qty > 0)).toBe(true)
  })
})

describe('reset', () => {
  it('повертає демо-дані', () => {
    const next = reducer(makeState(), { type: 'reset' })
    expect(next.version).toBe(1)
    expect(next.lots.length).toBeGreaterThan(5)
    expect(next.orders.length).toBeGreaterThan(0)
  })
})
