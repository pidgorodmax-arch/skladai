// Тести демо-джерела: воно має поводитися так само, як застосунок до 2.1 —
// дані лежать у сховищі браузера й переживають перезапуск.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, type KeyValueStorage } from './persist'
import { createDemoSource } from './source'
import { TEST_NOW, makeState } from './testState'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TEST_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = { ...initial }
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('createDemoSource', () => {
  it('порожнє сховище → демо-дані', async () => {
    const state = await createDemoSource(memoryStorage()).load()
    expect(state.lots.length).toBeGreaterThan(0)
  })

  it('після load() стан одразу записаний у сховище (як до 2.1)', async () => {
    const storage = memoryStorage()
    const state = await createDemoSource(storage).load()
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(state)
  })

  it('читає збережений стан', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(makeState()) })
    expect(await createDemoSource(storage).load()).toEqual(makeState())
  })

  it('дія зберігається і видна після «перезапуску» застосунку', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(makeState()) })
    const source = createDemoSource(storage)
    await source.load()
    await source.apply({ type: 'ship', lotId: 'MZ-1', qty: 5 })
    await source.apply({ type: 'move', lotId: 'MO-OLD', locationId: 'B' })

    const reloaded = await createDemoSource(storage).load()
    expect(reloaded.lots.find((l) => l.id === 'MZ-1')?.qty).toBe(15)
    expect(reloaded.lots.find((l) => l.id === 'MO-OLD')?.locationId).toBe('B')
    expect(reloaded.log.map((e) => e.text)).toEqual(['Uscita 5 dal lotto MZ-1', 'Lotto MO-OLD spostato in Scaffale B'])
  })

  it('apply без load теж працює (бере стан зі сховища)', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(makeState()) })
    await createDemoSource(storage).apply({ type: 'ship', lotId: 'MZ-1', qty: 20 })
    const reloaded = await createDemoSource(storage).load()
    expect(reloaded.lots.some((l) => l.id === 'MZ-1')).toBe(false)
  })

  it('reset повертає й зберігає демо-дані', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(makeState()) })
    const source = createDemoSource(storage)
    await source.load()
    await source.apply({ type: 'reset' })
    const reloaded = await createDemoSource(storage).load()
    expect(reloaded.lots.length).toBeGreaterThan(makeState().lots.length)
    expect(reloaded.orders.some((o) => o.id === 'ORD-1042')).toBe(true)
  })
})
