// Тести reducer: для кожної дії перевіряємо, що стан змінюється правильно,
// а некоректна дія повертає той самий стан без змін.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reducer, stamp } from './reducer'
import { TEST_NOW, makeState } from './testState'
import { STATE_VERSION, type AppState } from './types'

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
      id: 'L-1506-MZ', // без lotId (дія не з телефона) ID = код
      code: 'L-1506-MZ',
      productId: 'mozzarella',
      qty: 40,
      locationId: 'C',
      producedAt: '2026-06-15',
      expiresAt: '2026-06-22', // + 7 днів
      milkLitres: 410,
    })
    // TEST_NOW = 12:00 UTC → у журналі 14:00 за Римом (літній час, UTC+2)
    expect(next.log.at(-1)).toEqual({ at: '2026-06-15T14:00', text: 'Prodotto lotto L-1506-MZ: Mozzarella 40 kg → Cella 1 · ripiano 1' })
  })

  // Тести працюють у поясі UTC (vite.config.ts), тож «пристрій» тут не в Римі.
  it('після півночі за Римом партія й журнал отримують римську дату, а не дату пристрою', () => {
    vi.setSystemTime(new Date('2026-06-15T22:30:00Z')) // у Римі вже 16.06, 00:30
    const next = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' })
    expect(next.lots.at(-1)).toMatchObject({ code: 'L-1606-MZ', producedAt: '2026-06-16', expiresAt: '2026-06-23' })
    expect(next.log.at(-1)!.at).toBe('2026-06-16T00:30')
  })

  it('дія з at (час на телефоні) — дата партії й журнал беруться з нього', () => {
    vi.setSystemTime(new Date('2026-06-16T06:00:00Z'))
    const next = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C', at: '2026-06-15T23:50' })
    expect(next.lots.at(-1)).toMatchObject({ code: 'L-1506-MZ', producedAt: '2026-06-15', expiresAt: '2026-06-22' })
    expect(next.log.at(-1)!.at).toBe('2026-06-15T23:50')
  })

  it('stamp ставить час за Римом', () => {
    expect(stamp({ type: 'reset' }, new Date('2026-06-15T22:30:00Z'), 'a1')).toEqual({ type: 'reset', at: '2026-06-16T00:30', id: 'a1' })
    const ids = new Set([stamp({ type: 'reset' }).id, stamp({ type: 'reset' }).id])
    expect(ids.size).toBe(2)
  })

  it('взимку журнал теж за Римом (UTC+1)', () => {
    vi.setSystemTime(new Date('2026-01-15T22:30:00Z'))
    const next = reducer(makeState(), { type: 'move', lotId: makeState().lots[0].id, locationId: 'B' })
    expect(next.log.at(-1)!.at).toBe('2026-01-15T23:30')
  })

  it('партія отримує ID від телефона (lotId) і код, який людина бачила на екрані', () => {
    const next = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C', lotId: 'tel-1', code: 'L-1506-MZ' })
    expect(next.lots.at(-1)).toMatchObject({ id: 'tel-1', code: 'L-1506-MZ' })
  })

  it('повтор register з тим самим ID партії нічого не змінює', () => {
    const action = { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C', lotId: 'tel-1' } as const
    const once = reducer(makeState(), action)
    expect(reducer(once, action)).toBe(once)
  })

  it('код, уже зайнятий іншою партією, — наступний вільний; некоректний код ігнорується', () => {
    const once = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C', lotId: 'a', code: 'L-1506-MZ' })
    const twice = reducer(once, { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C', lotId: 'b', code: 'L-1506-MZ' })
    expect(twice.lots.slice(-2).map((l) => [l.id, l.code])).toEqual([['a', 'L-1506-MZ'], ['b', 'L-1506-MZ2']])
    const odd = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C', code: '=SUM(A1)' })
    expect(odd.lots.at(-1)!.code).toBe('L-1506-MZ')
  })

  it('stamp дає новій партії внутрішній ID, інші дії не чіпає', () => {
    const reg = stamp({ type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' })
    expect(reg.type === 'register' && reg.lotId).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
    expect(stamp({ type: 'ship', lotId: 'x', qty: 1 })).toMatchObject({ type: 'ship', lotId: 'x' })
  })

  it('списання й переміщення шукають партію лише за ID, не за кодом', () => {
    const state = makeState()
    expect(reducer(state, { type: 'ship', lotId: 'L-1206-MZ', qty: 1 })).toBe(state) // це код, не ID
    expect(reducer(state, { type: 'ship', lotId: 'MZ-1', qty: 1, code: 'L-0106-YB' }).lots.find((l) => l.id === 'MZ-1')!.qty).toBe(19)
  })

  it('код лоту бере сиглу з продукту (її можна змінити в таблиці)', () => {
    const state = makeState()
    state.products = state.products.map((p) => (p.id === 'mozzarella' ? { ...p, abbr: 'MOZ' } : p))
    const next = reducer(state, { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' })
    expect(next.lots.at(-1)!.code).toBe('L-1506-MOZ')
  })

  it('Montasio отримує термін null (витримка)', () => {
    const next = reducer(makeState(), { type: 'register', productId: 'montasio', qty: 12, locationId: 'B' })
    expect(next.lots.at(-1)!.expiresAt).toBeNull()
  })

  it('друга партія того ж дня отримує інший код', () => {
    const once = reducer(makeState(), { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' })
    const twice = reducer(once, { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' })
    expect(twice.lots.slice(-2).map((l) => l.code)).toEqual(['L-1506-MZ', 'L-1506-MZ2'])
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
    expect(next.log.at(-1)!.text).toBe('Uscita 5 dal lotto L-1206-MZ')
  })

  it('не списує більше, ніж є, і прибирає порожню партію', () => {
    const next = reducer(makeState(), { type: 'ship', lotId: 'MZ-1', qty: 999 })
    expect(qtyOf(next, 'MZ-1')).toBeUndefined()
    expect(next.log.at(-1)!.text).toBe('Uscita 20 dal lotto L-1206-MZ')
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
    expect(next.log.at(-1)!.text).toBe('Lotto L-1506-MO spostato in Scaffale B')
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
    expect(next.version).toBe(STATE_VERSION)
    expect(next.lots.length).toBeGreaterThan(5)
    expect(next.orders.length).toBeGreaterThan(0)
  })

  it('у демо кожен продукт має вигаданий код ART-… і власну сиглу', () => {
    const { products, lots } = reducer(makeState(), { type: 'reset' })
    for (const p of products) expect(p.code).toMatch(/^ART-\d{4}$/)
    const abbrs = products.map((p) => p.abbr)
    expect(new Set(abbrs).size).toBe(abbrs.length)
    // коди лотів демо побудовані із сигл
    for (const lot of lots) {
      const abbr = products.find((p) => p.id === lot.productId)!.abbr
      expect(lot.id).toMatch(new RegExp(`^L-\\d{4}-${abbr}\\d*$`))
    }
  })
})
