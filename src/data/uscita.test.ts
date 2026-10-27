// Тести «Uscita rapida», «Rimanenze» і «Scorta minima» (етап 2c).
// Замовлень і клієнтів тут немає: товар просто виходить у Ordine / Spaccio / Scarto.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { morningBrief } from './brief'
import { COLUMNS, TOKEN, loadScript, toSheets, type Script } from './fakeAppsScript'
import { migrate } from './migrate'
import { reducer, type Action } from './reducer'
import { fefoHint, lotQty, rimanenze } from './selectors'
import { TEST_NOW, TEST_TODAY, makeState } from './testState'
import { STATE_VERSION, type AppState } from './types'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TEST_NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))

/** MZ-1 (спливає 19.06): дві коробки — 12 на C і 8 на B. */
function split(): AppState {
  const state = makeState()
  state.boxes = state.boxes.flatMap((b) =>
    b.lotId === 'MZ-1' ? [{ ...b, qty: 12 }, { id: 'MZ-1-2', lotId: 'MZ-1', locationId: 'B', qty: 8 }] : [b],
  )
  return state
}

describe('uscita — з відсканованої коробки', () => {
  it('зменшує коробку, пише запис з лотом і призначенням, журнал італійською', () => {
    const next = reducer(makeState(), { type: 'uscita', boxId: 'MZ-2-1', qty: 5, dest: 'spaccio' })
    expect(next.boxes.find((b) => b.id === 'MZ-2-1')!.qty).toBe(10)
    expect(next.uscite).toEqual([{ boxId: 'MZ-2-1', lotId: 'MZ-2', productId: 'mozzarella', qty: 5, dest: 'spaccio', at: '2026-06-15T14:00' }])
    expect(next.log.at(-1)!.text).toBe('Uscita 5 kg Mozzarella dal lotto L-1406-MZ → Spaccio')
    // замовлень і клієнтів не створює
    expect(next.orders).toEqual(makeState().orders)
    expect(next.picks).toEqual([])
  })

  it('не можна взяти більше, ніж у коробці; нуль, невідома коробка чи призначення — без змін', () => {
    const state = makeState()
    expect(reducer(state, { type: 'uscita', boxId: 'MZ-2-1', qty: 16, dest: 'ordine' })).toBe(state)
    expect(reducer(state, { type: 'uscita', boxId: 'MZ-2-1', qty: 0, dest: 'ordine' })).toBe(state)
    expect(reducer(state, { type: 'uscita', boxId: 'немає', qty: 1, dest: 'ordine' })).toBe(state)
    expect(reducer(state, { type: 'uscita', boxId: 'MZ-2-1', qty: 1, dest: 'regalo' } as unknown as Action)).toBe(state)
    expect(reducer(state, { type: 'uscita', boxId: 'MZ-2-1', qty: 1, dest: 'toString' } as unknown as Action)).toBe(state)
  })

  it('уся коробка — коробка й порожня партія зникають, лот лишається в записі', () => {
    const next = reducer(makeState(), { type: 'uscita', boxId: 'MZ-2-1', qty: 15, dest: 'scarto' })
    expect(next.lots.some((l) => l.id === 'MZ-2')).toBe(false)
    expect(next.uscite[0]).toMatchObject({ lotId: 'MZ-2', dest: 'scarto' })
  })
})

describe('uscita — за продуктом (FEFO)', () => {
  it('бере спершу з партії, що раніше спливає, через кілька коробок; запис на кожну коробку', () => {
    // MZ-1 (19.06): 12 + 8, далі MZ-2 (21.06). Беремо 25 → 12, 8, 5.
    const next = reducer(split(), { type: 'uscita', productId: 'mozzarella', qty: 25, dest: 'ordine' })
    expect(next.uscite.map((u) => [u.boxId, u.qty])).toEqual([['MZ-1-1', 12], ['MZ-1-2', 8], ['MZ-2-1', 5]])
    expect(lotQty(next, 'MZ-2')).toBe(10)
    expect(next.log.slice(-3).map((e) => e.text)).toEqual([
      'Uscita 12 kg Mozzarella dal lotto L-1206-MZ → Ordine',
      'Uscita 8 kg Mozzarella dal lotto L-1206-MZ → Ordine',
      'Uscita 5 kg Mozzarella dal lotto L-1406-MZ → Ordine',
    ])
  })

  it('не можна взяти більше, ніж є на складі; невідомий продукт — без змін', () => {
    const state = makeState()
    expect(reducer(state, { type: 'uscita', productId: 'mozzarella', qty: 36, dest: 'ordine' })).toBe(state)
    expect(reducer(state, { type: 'uscita', productId: 'brie', qty: 1, dest: 'ordine' })).toBe(state)
  })
})

describe('fefoHint — підказка, якщо взяли не найстарішу', () => {
  it('коробка пізнішої партії → підказує коробку, що спливає раніше', () => {
    expect(fefoHint(makeState(), 'MZ-2-1')?.box.id).toBe('MZ-1-1')
  })

  it('найстаріша партія (або друга коробка тієї ж партії) — підказки немає', () => {
    expect(fefoHint(makeState(), 'MZ-1-1')).toBeNull()
    expect(fefoHint(split(), 'MZ-1-2')).toBeNull()
    expect(fefoHint(makeState(), 'немає')).toBeNull()
  })
})

describe('rimanenze — залишок і вилучене по призначеннях', () => {
  function withExits(): AppState {
    const state = makeState()
    state.uscite = [
      { boxId: 'x', lotId: 'MZ-1', productId: 'mozzarella', qty: 4, dest: 'ordine', at: '2026-06-15T08:00' }, // сьогодні
      { boxId: 'x', lotId: 'MZ-1', productId: 'mozzarella', qty: 2, dest: 'scarto', at: '2026-06-15T09:00' }, // сьогодні
      { boxId: 'x', lotId: 'MZ-1', productId: 'mozzarella', qty: 6, dest: 'spaccio', at: '2026-06-09T10:00' }, // 6 днів тому — ще в тижні
      { boxId: 'x', lotId: 'MZ-1', productId: 'mozzarella', qty: 9, dest: 'ordine', at: '2026-06-08T10:00' }, // 7 днів тому — поза
      { boxId: 'x', lotId: 'YB-1', productId: 'yogurt', qty: 10, dest: 'spaccio', at: '2026-06-14T10:00' },
    ]
    return state
  }

  it('сьогодні й останні 7 днів окремо в Ordine, Spaccio, Scarto', () => {
    const mz = rimanenze(withExits(), TEST_TODAY).find((r) => r.product.id === 'mozzarella')!
    expect(mz.oggi).toEqual({ ordine: 4, spaccio: 0, scarto: 2 })
    expect(mz.settimana).toEqual({ ordine: 4, spaccio: 6, scarto: 2 })
    const yb = rimanenze(withExits(), TEST_TODAY).find((r) => r.product.id === 'yogurt')!
    expect([yb.oggi.spaccio, yb.settimana.spaccio]).toEqual([0, 10])
  })

  it('залишок — сума коробок; нижче scorta minima — позначка', () => {
    const rows = rimanenze(makeState(), TEST_TODAY)
    expect(rows.map((r) => [r.product.id, r.stock, r.minStock, r.below])).toEqual([
      ['montasio', 40, null, false],
      ['mozzarella', 35, 50, true],
      ['yogurt', 100, null, false],
    ])
  })

  it('ранковий брифінг попереджає про продукт нижче мінімуму', () => {
    const texts = morningBrief(makeState(), TEST_TODAY).map((b) => b.text)
    expect(texts).toContain('Mozzarella: in magazzino 35 kg, sotto la scorta minima di 50 kg.')
  })
})

describe('міграція v5 → v6', () => {
  it('додає порожній список виходів; решта без змін', () => {
    const { uscite: _u, ...v5 } = { ...makeState(), version: 5 }
    expect(migrate(v5)).toEqual(makeState())
    expect(STATE_VERSION).toBe(6)
  })
})

describe('Apps Script: uscita = reducer', () => {
  function get(script: Script) {
    return JSON.parse(script.doGet({ parameter: { token: TOKEN } }).text)
  }
  function post(script: Script, action: unknown) {
    return JSON.parse(script.doPost({ postData: { contents: JSON.stringify({ token: TOKEN, action }) } }).text)
  }

  it('з коробки й за продуктом (FEFO) таблиця = стан застосунку; вкладка Uscite створюється сама', () => {
    const sheets = toSheets(split(), COLUMNS)
    delete (sheets as Partial<typeof sheets>).Uscite
    const script = loadScript(sheets)
    expect(get(script).state.uscite).toEqual([])
    let state = split()
    const actions: Action[] = [
      { type: 'uscita', boxId: 'MZ-2-1', qty: 5, dest: 'spaccio' },
      { type: 'uscita', productId: 'mozzarella', qty: 22, dest: 'ordine' },
      { type: 'uscita', productId: 'montasio', qty: 2, dest: 'scarto' },
    ]
    for (const action of actions) {
      state = reducer(state, action)
      expect(post(script, action)).toEqual({ ok: true })
      expect(get(script).state).toEqual(plain(state))
    }
    expect(sheets.Uscite.values[0]).toEqual(['collo', 'lotto', 'prodotto', 'quantita', 'destinazione', 'data_ora'])
  })

  it('scorta_minima читається з Prodotti', () => {
    const script = loadScript(toSheets(makeState(), COLUMNS))
    expect(get(script).state.products.find((p: { id: string }) => p.id === 'mozzarella').minStock).toBe(50)
  })

  it('неможливий вихід відхиляється зрозумілою помилкою, таблиця не змінюється', () => {
    const script = loadScript(toSheets(makeState(), COLUMNS))
    const before = get(script).state
    const bad: [unknown, string][] = [
      [{ type: 'uscita', boxId: 'MZ-2-1', qty: 16, dest: 'ordine' }, 'Disponibili solo 15 kg'],
      [{ type: 'uscita', productId: 'mozzarella', qty: 36, dest: 'ordine' }, 'Disponibili solo 35 kg'],
      [{ type: 'uscita', boxId: 'MZ-2-1', qty: 1, dest: 'regalo' }, 'Destinazione non valida: regalo'],
      [{ type: 'uscita', boxId: 'MZ-2-1', qty: 1, dest: 'toString' }, 'Destinazione non valida: toString'],
      [{ type: 'uscita', boxId: 'nessuno', qty: 1, dest: 'ordine' }, 'Collo sconosciuto: nessuno'],
      [{ type: 'uscita', productId: 'brie', qty: 1, dest: 'ordine' }, 'Prodotto sconosciuto: brie'],
    ]
    for (const [action, error] of bad) expect(post(script, action)).toEqual({ ok: false, error, code: 'rejected' })
    expect(get(script).state).toEqual(before)
  })
})
