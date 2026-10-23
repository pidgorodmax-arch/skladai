// Тести офлайн-черги. «Мережу» вмикаємо й вимикаємо у фальшивому fetch,
// за ним — справжній apps-script/Code.gs на таблиці в пам'яті.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLUMNS, TOKEN, loadScript, toSheets, type FakeSheet } from './fakeAppsScript'
import type { KeyValueStorage } from './persist'
import { CACHE_KEY, QUEUE_KEY, createQueuedSource } from './queuedSource'
import { reducer, stamp, type Action } from './reducer'
import { createSheetsSource, type FetchLike } from './sheetsSource'
import { TEST_NOW, makeState } from './testState'
import type { AppState } from './types'

const URL_EXEC = 'https://script.google.com/macros/s/prova/exec'

function memoryStorage(): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {}
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

/** Таблиця Google за «мережею», яку можна вимкнути. */
function fakeGoogle(state = makeState()) {
  const sheets = toSheets(state, COLUMNS)
  const script = loadScript(sheets)
  const net = { online: true, posts: 0, failNextResponse: false }
  const fetchFn: FetchLike = async (url, init) => {
    if (!net.online) throw new TypeError('Failed to fetch')
    if (init?.method === 'POST') {
      net.posts++
      const out = script.doPost({ postData: { contents: String(init.body) } })
      // Таблиця дію виконала, але відповідь до телефона не дійшла.
      if (net.failNextResponse) {
        net.failNextResponse = false
        throw new TypeError('Failed to fetch')
      }
      return { ok: true, status: 200, json: async () => JSON.parse(out.text) }
    }
    const out = script.doGet({ parameter: { token: new URL(url).searchParams.get('token') ?? '' } })
    return { ok: true, status: 200, json: async () => JSON.parse(out.text) }
  }
  return { sheets, net, fetchFn }
}

function makeSource(fetchFn: FetchLike, storage: KeyValueStorage, url = URL_EXEC) {
  return createQueuedSource(createSheetsSource({ url, token: TOKEN }, fetchFn), url, storage)
}

const lotIds = (sheet: FakeSheet) => sheet.values.slice(1).map((r) => r[0])
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TEST_NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('офлайн-черга', () => {
  it('без мережі партія записується в чергу на телефоні; з мережею — потрапляє в таблицю', async () => {
    const { sheets, net, fetchFn } = fakeGoogle()
    const storage = memoryStorage()
    const source = makeSource(fetchFn, storage)
    await source.load()

    net.online = false
    const action = stamp({ type: 'register', productId: 'mozzarella', qty: 40, locationId: 'C' })
    await source.apply(action)
    await source.sync.flush()
    expect(source.sync.status()).toMatchObject({ pending: 1, offline: true, error: null })
    expect(JSON.parse(storage.data[QUEUE_KEY]).value).toEqual([action])
    expect(lotIds(sheets.Lotti)).not.toContain('L-1506-MZ')

    net.online = true
    await source.sync.flush()
    expect(source.sync.status()).toMatchObject({ pending: 0, offline: false, syncing: false })
    expect(lotIds(sheets.Lotti)).toContain('L-1506-MZ')
    expect(JSON.parse(storage.data[QUEUE_KEY]).value).toEqual([])
  })

  it('партія, записана офлайн о 23:50, у таблиці — з датою й часом запису, а не відправки', async () => {
    const { sheets, net, fetchFn } = fakeGoogle()
    const source = makeSource(fetchFn, memoryStorage())
    await source.load()
    net.online = false
    await source.apply(stamp({ type: 'register', productId: 'mozzarella', qty: 5, locationId: 'C' }, new Date('2026-06-15T21:50:00Z')))
    vi.setSystemTime(new Date('2026-06-16T06:00:00Z')) // ранок, мережа повернулась
    net.online = true
    await source.sync.flush()
    const row = sheets.Lotti.values.at(-1)!
    expect(row.slice(0, 1)).toEqual(['L-1506-MZ'])
    expect(row[COLUMNS.Lotti.findIndex((c) => c[0] === 'data_produzione')]).toBe('2026-06-15')
    expect(sheets.Registro.values.at(-1)![0]).toBe('2026-06-15T23:50')
  })

  it('черга переживає закриття застосунку; відкриття без мережі — з останньої копії таблиці', async () => {
    const { sheets, net, fetchFn } = fakeGoogle()
    const storage = memoryStorage()
    const first = makeSource(fetchFn, storage)
    const loaded = await first.load()
    net.online = false
    const action = stamp({ type: 'ship', lotId: 'YB-1', qty: 30 })
    await first.apply(action)
    await first.sync.flush()

    // «Перезапуск» без мережі: та сама копія + невідправлена дія поверх.
    const second = makeSource(fetchFn, storage)
    expect(await second.load()).toEqual(reducer(loaded, action))
    expect(second.sync.status()).toMatchObject({ pending: 1, offline: true })

    // Мережа повернулась — під час запуску черга відправляється.
    net.online = true
    const third = makeSource(fetchFn, storage)
    const fresh = await third.load()
    expect(fresh.lots.find((l) => l.id === 'YB-1')!.qty).toBe(70)
    expect(third.sync.status().pending).toBe(0)
    expect(sheets.Registro.values.at(-1)![1]).toBe('Uscita 30 dal lotto YB-1')
  })

  it('відкрили без мережі з порожньою чергою → мережа повернулась → позначка зникає, дані свіжі', async () => {
    const { sheets, net, fetchFn } = fakeGoogle()
    const storage = memoryStorage()
    await makeSource(fetchFn, storage).load() // копія таблиці є
    net.online = false
    const source = makeSource(fetchFn, storage)
    await source.load()
    expect(source.sync.status()).toMatchObject({ pending: 0, offline: true })
    const seen: AppState[] = []
    source.sync.onFreshState((s) => seen.push(s))
    // Поки телефон був офлайн, у таблиці змінили кількість.
    sheets.Lotti.values[1][COLUMNS.Lotti.findIndex((c) => c[0] === 'quantita')] = 4
    await source.sync.flush()
    expect(source.sync.status().offline).toBe(true) // мережі ще немає
    net.online = true
    await source.sync.flush()
    expect(source.sync.status()).toMatchObject({ pending: 0, offline: false })
    expect(seen.at(-1)!.lots[0].qty).toBe(4)
  })

  it('онлайн без черги flush нічого не відправляє й не читає', async () => {
    const { net, fetchFn } = fakeGoogle()
    let calls = 0
    const counting: FetchLike = (u, i) => (calls++, fetchFn(u, i))
    const source = makeSource(counting, memoryStorage())
    await source.load()
    calls = 0
    await source.sync.flush()
    expect(calls).toBe(0)
    expect(net.posts).toBe(0)
  })

  it('таблиця зайнята (error) — не «немає мережі», а окреме повідомлення; дія чекає', async () => {
    const busy: FetchLike = async (_u, init) => ({
      ok: true,
      status: 200,
      json: async () => (init?.method === 'POST' ? { ok: false, error: 'Lock timeout', code: 'error' } : {}),
    })
    const source = makeSource(busy, memoryStorage())
    await source.apply(stamp({ type: 'ship', lotId: 'YB-1', qty: 1 }))
    await source.sync.flush()
    expect(source.sync.status()).toMatchObject({ pending: 1, offline: false, error: 'Tabella occupata, nuovo tentativo a breve (Lock timeout)' })
  })

  it('без мережі й без копії (перший запуск) — помилка, а не порожній склад', async () => {
    const { net, fetchFn } = fakeGoogle()
    net.online = false
    await expect(makeSource(fetchFn, memoryStorage()).load()).rejects.toMatchObject({ code: 'network' })
  })

  it('черга й копія іншої таблиці не змішуються', async () => {
    const { net, fetchFn } = fakeGoogle()
    const storage = memoryStorage()
    const a = makeSource(fetchFn, storage)
    await a.load()
    net.online = false
    await a.apply(stamp({ type: 'ship', lotId: 'YB-1', qty: 1 }))
    await a.sync.flush()
    const other = makeSource(fetchFn, storage, 'https://script.google.com/macros/s/altra/exec')
    expect(other.sync.status().pending).toBe(0)
    await expect(other.load()).rejects.toMatchObject({ code: 'network' })
    expect(JSON.parse(storage.data[CACHE_KEY]).owner).toBe(URL_EXEC)
  })

  it('дії йдуть у таблицю в тому порядку, в якому їх зробили', async () => {
    const { sheets, net, fetchFn } = fakeGoogle()
    const source = makeSource(fetchFn, memoryStorage())
    await source.load()
    net.online = false
    const actions: Action[] = [
      stamp({ type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' }),
      stamp({ type: 'register', productId: 'mozzarella', qty: 2, locationId: 'C' }),
      stamp({ type: 'move', lotId: 'L-1506-MZ2', locationId: 'A' }),
    ]
    for (const a of actions) await source.apply(a)
    net.online = true
    await source.sync.flush()
    const expected = actions.reduce(reducer, makeState())
    expect(lotIds(sheets.Lotti)).toEqual(expected.lots.map((l) => l.id))
    expect(sheets.Lotti.values.at(-1)![COLUMNS.Lotti.findIndex((c) => c[0] === 'posizione')]).toBe('A')
  })

  it('відповідь загубилась після запису — повтор не дублює партію', async () => {
    const { sheets, net, fetchFn } = fakeGoogle()
    const source = makeSource(fetchFn, memoryStorage())
    await source.load()
    net.failNextResponse = true
    await source.apply(stamp({ type: 'register', productId: 'mozzarella', qty: 3, locationId: 'C' }))
    // Перша спроба: таблиця записала, телефон відповіді не отримав → повтор.
    await source.sync.flush()
    expect(net.posts).toBe(2)
    expect(lotIds(sheets.Lotti).filter((id) => String(id).startsWith('L-1506-MZ'))).toEqual(['L-1506-MZ'])
    expect(source.sync.status().pending).toBe(0)
  })

  it('відхилену дію прибираємо з черги й показуємо причину; наступні йдуть далі', async () => {
    const { sheets, fetchFn } = fakeGoogle()
    const source = makeSource(fetchFn, memoryStorage())
    await source.load()
    await source.apply(stamp({ type: 'ship', lotId: 'nessuno', qty: 1 }))
    await source.apply(stamp({ type: 'ship', lotId: 'YB-1', qty: 1 }))
    await source.sync.flush()
    expect(source.sync.status()).toMatchObject({ pending: 0, error: 'Uscita dal lotto nessuno non salvato: Lotto sconosciuto: nessuno' })
    expect(sheets.Registro.values.at(-1)![1]).toBe('Uscita 1 dal lotto YB-1')
    source.sync.clearError()
    expect(source.sync.status().error).toBeNull()
  })

  it('неправильний токен: дії лишаються в черзі, причина видна', async () => {
    const { fetchFn } = fakeGoogle()
    const storage = memoryStorage()
    const source = createQueuedSource(createSheetsSource({ url: URL_EXEC, token: 'vecchio' }, fetchFn), URL_EXEC, storage)
    await source.apply(stamp({ type: 'ship', lotId: 'YB-1', qty: 1 }))
    await source.sync.flush()
    expect(source.sync.status()).toMatchObject({ pending: 1, offline: false, error: 'Token non valido' })
  })

  it('після синхронізації екран отримує свіжий стан таблиці (зі змінами інших телефонів)', async () => {
    const { sheets, fetchFn } = fakeGoogle()
    const source = makeSource(fetchFn, memoryStorage())
    await source.load()
    const seen: AppState[] = []
    source.sync.onFreshState((s) => seen.push(s))
    // Інший телефон змінив кількість прямо в таблиці.
    sheets.Lotti.values[1][COLUMNS.Lotti.findIndex((c) => c[0] === 'quantita')] = 9
    const action = stamp({ type: 'move', lotId: 'MZ-1', locationId: 'A' })
    await source.apply(action)
    await source.sync.flush()
    const expected = reducer(makeState(), action)
    expected.lots[0] = { ...expected.lots[0], qty: 9 }
    expect(seen.at(-1)).toEqual(plain(expected))
  })

  it('«Ripristina dati demo» з таблицею недоступне', async () => {
    const { fetchFn } = fakeGoogle()
    await expect(makeSource(fetchFn, memoryStorage()).apply({ type: 'reset' })).rejects.toMatchObject({ code: 'rejected' })
  })
})
