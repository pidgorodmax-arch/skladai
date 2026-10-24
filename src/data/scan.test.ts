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

  it('QR стелажа → стелаж і всі коробки на ньому', () => {
    const found = resolveScan(makeState(), { kind: 'posizione', id: 'C' })
    expect(found?.kind).toBe('posizione')
    if (found?.kind !== 'posizione') return
    expect(found.location.name).toBe('Cella 1 · ripiano 1')
    expect(found.boxes.map((b) => b.box.id)).toEqual(['MZ-2-1', 'MZ-1-1', 'YB-1-1'])
  })

  it('коробки вже немає (порожня зникла) або невідомий стелаж — null', () => {
    expect(resolveScan(makeState(), { kind: 'collo', id: 'MZ-9-1' })).toBeNull()
    expect(resolveScan(makeState(), { kind: 'posizione', id: 'Z' })).toBeNull()
  })
})

describe('manualSearch — ручний резерв', () => {
  it('частина коду лоту з етикетки — без «L-», дефісів, пробілів і регістру', () => {
    for (const q of ['1206-MZ', '1206mz', 'l 1206 mz', 'L-1206-MZ']) {
      expect(manualSearch(makeState(), q).boxes.map((b) => b.box.id), q).toEqual(['MZ-1-1'])
    }
  })

  it('спільна частина дає всі збіги: «MZ» — обидві партії моцарели', () => {
    expect(manualSearch(makeState(), 'mz').boxes.map((b) => b.lot.code)).toEqual(['L-1406-MZ', 'L-1206-MZ'])
  })

  it('стелаж — за назвою або точним id; машини не пропонуються', () => {
    expect(manualSearch(makeState(), 'scaffale b').places.map((p) => p.id)).toEqual(['B'])
    expect(manualSearch(makeState(), 'cella').places.map((p) => p.id)).toEqual(['C'])
    expect(manualSearch(makeState(), 'caldaia').places).toEqual([])
  })

  it('менше 2 символів — нічого (щоб не показувати весь склад)', () => {
    expect(manualSearch(makeState(), 'm')).toEqual({ boxes: [], places: [] })
  })
})
