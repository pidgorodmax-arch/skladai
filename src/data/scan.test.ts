// Тести сканера (2b.4): що знаходимо за QR і за ручним введенням.

import { describe, expect, it } from 'vitest'
import { parseQr, qrPayload } from './labels'
import { manualSearch, resolveScan } from './selectors'
import { makeState } from './testState'

describe('resolveScan — QR → коробка чи стелаж', () => {
  it('QR коробки з етикетки → коробка з продуктом, лотом і місцем', () => {
    const target = parseQr(qrPayload('https://esempio.github.io/skladai/', { kind: 'collo', id: 'MZ-1-1' }))!
    const found = resolveScan(makeState(), target)
    expect(found?.kind).toBe('collo')
    if (found?.kind !== 'collo') return
    expect([found.label.product.name, found.label.lot.code, found.label.box.qty, found.label.location?.id]).toEqual(['Mozzarella', 'L-1206-MZ', 20, 'C'])
  })

  it('QR стелажа → стелаж і всі коробки на ньому за FEFO (найближчий термін першим)', () => {
    const found = resolveScan(makeState(), { kind: 'posizione', id: 'C' })
    expect(found?.kind).toBe('posizione')
    if (found?.kind !== 'posizione') return
    expect(found.location.name).toBe('Cella 1 · ripiano 1')
    // MZ-1 спливає 19.06, MZ-2 — 21.06, YB-1 — 22.06
    expect(found.boxes.map((b) => b.box.id)).toEqual(['MZ-1-1', 'MZ-2-1', 'YB-1-1'])
  })

  it('коробки вже немає (порожня зникла) або невідомий стелаж — null', () => {
    expect(resolveScan(makeState(), { kind: 'collo', id: 'MZ-9-1' })).toBeNull()
    expect(resolveScan(makeState(), { kind: 'posizione', id: 'Z' })).toBeNull()
  })
})

/** Тестовий склад зі стелажами «Scaffale A3» і «Cella 3»: на A3 — частина моцарели. */
function withA3() {
  const state = makeState()
  state.locations.push(
    { id: 'A3', name: 'Scaffale A3', zoneId: 'stag', kind: 'aging', capacity: 100, x: 1, z: 4, w: 3, d: 1, h: 2 },
    { id: 'C3', name: 'Cella 3', zoneId: 'c1', kind: 'cold', capacity: 50, x: 13, z: 4, w: 4, d: 1, h: 2 },
  )
  state.boxes.push({ id: 'MZ-2-2', lotId: 'MZ-2', locationId: 'A3', qty: 5 }, { id: 'YB-1-2', lotId: 'YB-1', locationId: 'A3', qty: 10 })
  return state
}

describe('manualSearch — ручний резерв', () => {
  it('частина коду лоту з етикетки — без «L-», дефісів, пробілів і регістру', () => {
    for (const q of ['1206-MZ', '1206mz', 'l 1206 mz', 'L-1206-MZ']) {
      expect(manualSearch(makeState(), q).boxes.map((b) => b.box.id), q).toEqual(['MZ-1-1'])
    }
  })

  it('спільна частина дає всі збіги за FEFO: «MZ» — спершу L-1206 (19.06), потім L-1406 (21.06)', () => {
    expect(manualSearch(makeState(), 'mz').boxes.map((b) => b.lot.code)).toEqual(['L-1206-MZ', 'L-1406-MZ'])
  })

  it('назва стелажа «A3» → сам стелаж і коробки на ньому за FEFO; «Cella 3» не підходить', () => {
    for (const q of ['A3', 'a3', 'scaffale a3', 'Scaffale A3']) {
      const found = manualSearch(withA3(), q)
      expect(found.places.map((p) => p.id), q).toEqual(['A3'])
      expect(found.boxes.map((b) => [b.box.id, b.location?.name]), q).toEqual([['MZ-2-2', 'Scaffale A3'], ['YB-1-2', 'Scaffale A3']])
    }
  })

  it('у рядку є все для списку: продукт, кількість, collo i/N, стелаж', () => {
    const [first] = manualSearch(withA3(), 'A3').boxes
    expect([first.product.name, first.box.qty, first.index, first.count, first.location?.name]).toEqual(['Mozzarella', 5, 2, 2, 'Scaffale A3'])
  })

  it('однолітерний id стелажа знаходиться точно («A»), але не як частина назв', () => {
    const found = manualSearch(makeState(), 'a')
    expect(found.places.map((p) => p.id)).toEqual(['A'])
    expect(found.boxes.map((b) => b.box.id)).toEqual(['MO-OLD-1', 'MO-NEW-1'])
  })

  it('стелаж — за назвою з початку слова або точним id; машини не пропонуються', () => {
    expect(manualSearch(makeState(), 'scaffale b').places.map((p) => p.id)).toEqual(['B'])
    expect(manualSearch(makeState(), 'cella').places.map((p) => p.id)).toEqual(['C'])
    expect(manualSearch(makeState(), 'ripiano 1').places.map((p) => p.id)).toEqual(['C'])
    expect(manualSearch(makeState(), 'caldaia').places).toEqual([])
  })

  it('одна літера, що не є id стелажа, — нічого (щоб не показувати весь склад)', () => {
    expect(manualSearch(makeState(), 'm')).toEqual({ boxes: [], places: [] })
    expect(manualSearch(makeState(), '  ')).toEqual({ boxes: [], places: [] })
  })
})
