// Тести етикеток: QR справді читається (декодуємо його бібліотекою jsQR,
// як це зробив би телефон) і веде на ту саму коробку чи стелаж.

import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import { appBaseUrl, parseQr, qrModules, qrPath, qrPayload } from './labels'
import { boxLabels } from './selectors'
import { makeState } from './testState'

const BASE = 'https://esempio.github.io/skladai/'

/** Матриця QR → «фото» RGBA з білою рамкою, яке читає jsQR. */
function decode(modules: boolean[][], scale = 4, quiet = 4): string | null {
  const size = (modules.length + quiet * 2) * scale
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  modules.forEach((row, r) =>
    row.forEach((on, c) => {
      if (!on) return
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4
          data[i] = data[i + 1] = data[i + 2] = 0
        }
    }),
  )
  return jsQR(data, size, size)?.data ?? null
}

describe('QR етикетки', () => {
  it('QR коробки з довгим кодом (ID від телефона) читається і веде на ту саму коробку', () => {
    const id = '3f2c9a1e-7b4d-4e0a-9c55-0d1e2f3a4b5c-1'
    const text = qrPayload(BASE, { kind: 'collo', id })
    expect(text).toBe(`${BASE}#/scan?collo=${id}`)
    const read = decode(qrModules(text))
    expect(read).toBe(text)
    expect(parseQr(read!)).toEqual({ kind: 'collo', id })
  })

  it('QR стелажа читається; символи в id не ламають посилання', () => {
    const id = 'C1-1 / ripiano'
    const text = qrPayload(BASE, { kind: 'posizione', id })
    expect(parseQr(decode(qrModules(text))!)).toEqual({ kind: 'posizione', id })
  })

  it('parseQr: етикетка з іншої адреси застосунку теж читається; чужий QR — null', () => {
    expect(parseQr('http://localhost:5173/#/scan?collo=L-2310-MZ-2')).toEqual({ kind: 'collo', id: 'L-2310-MZ-2' })
    expect(parseQr('https://example.com/prodotto?id=5')).toBeNull()
    expect(parseQr('8001234567890')).toBeNull() // штрихкод EAN з ваг — не наша етикетка
    expect(parseQr(`${BASE}#/scan?collo=`)).toBeNull()
  })

  it('appBaseUrl відкидає #… і бере адресу, з якої відкрили застосунок', () => {
    expect(appBaseUrl({ origin: 'https://esempio.github.io', pathname: '/skladai/' })).toBe(BASE)
  })

  it('qrPath малює по квадрату на кожен чорний модуль', () => {
    const modules = qrModules('x')
    const black = modules.flat().filter(Boolean).length
    expect(qrPath(modules).match(/M/g)!.length).toBe(black)
  })
})

describe('boxLabels — що на етикетці коробки', () => {
  it('продукт, лот, кількість, місце і номер коробки в партії', () => {
    const state = makeState()
    state.boxes.push({ id: 'MZ-1-2', lotId: 'MZ-1', locationId: 'B', qty: 5 })
    const labels = boxLabels(state)
    const mz1 = labels.filter((l) => l.lot.id === 'MZ-1')
    expect(mz1.map((l) => [l.box.id, l.product.name, l.lot.code, l.box.qty, l.location?.name, l.index, l.count])).toEqual([
      ['MZ-1-1', 'Mozzarella', 'L-1206-MZ', 20, 'Cella 1 · ripiano 1', 1, 2],
      ['MZ-1-2', 'Mozzarella', 'L-1206-MZ', 5, 'Scaffale B', 2, 2],
    ])
    expect(mz1[0].lot.expiresAt).toBe('2026-06-19')
  })

  it('коробка без партії не друкується', () => {
    const state = makeState()
    state.boxes.push({ id: 'ORFANO-1', lotId: 'ORFANO', locationId: 'A', qty: 1 })
    expect(boxLabels(state).map((l) => l.box.id)).not.toContain('ORFANO-1')
  })
})
