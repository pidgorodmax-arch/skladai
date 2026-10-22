// Тести читання/запису стану. Замість справжнього localStorage — простий
// об'єкт у пам'яті з тими самими методами.

import { describe, expect, it } from 'vitest'
import { BACKUP_KEY, STORAGE_KEY, loadState, saveState, type KeyValueStorage } from './persist'
import { makeState } from './testState'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  const storage: KeyValueStorage = {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
  return { storage, data }
}

describe('loadState', () => {
  it('порожнє сховище → демо-дані', () => {
    const state = loadState(memoryStorage().storage)
    expect(state.lots.length).toBeGreaterThan(0)
  })

  it('збережений стан читається назад без змін', () => {
    const { storage } = memoryStorage()
    saveState(storage, makeState())
    expect(loadState(storage)).toEqual(makeState())
  })

  it('пошкоджений JSON → демо-дані, а сирі дані — у резервну копію', () => {
    const { storage, data } = memoryStorage({ [STORAGE_KEY]: '{"version":1,"lots":[' })
    const state = loadState(storage)
    expect(state.products.length).toBeGreaterThan(0)
    expect(data[BACKUP_KEY]).toBe('{"version":1,"lots":[')
  })

  it('дані, які не вдалося мігрувати, теж зберігаються в резервну копію', () => {
    const raw = JSON.stringify({ ...makeState(), version: 99 })
    const { storage, data } = memoryStorage({ [STORAGE_KEY]: raw })
    loadState(storage)
    expect(data[BACKUP_KEY]).toBe(raw)
  })

  it('сховище заблоковане (приватний режим) → демо-дані без помилки', () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(loadState(blocked).lots.length).toBeGreaterThan(0)
    expect(() => saveState(blocked, makeState())).not.toThrow()
  })
})
