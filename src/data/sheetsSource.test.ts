// Тести джерела «Google Таблиця». fetch підміняємо: GET/POST ідуть просто в
// справжній apps-script/Code.gs, що працює на таблиці в пам'яті. Тож це
// наскрізна перевірка: застосунок → HTTP → скрипт → таблиця → назад.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLUMNS, TOKEN, loadScript, toSheets, type FakeSheet } from './fakeAppsScript'
import { reducer } from './reducer'
import { lotQty } from './selectors'
import { createSheetsSource, SheetsError, testConnection, type FetchLike, type SheetsErrorCode } from './sheetsSource'
import { TEST_NOW, makeState } from './testState'

const URL_EXEC = 'https://script.google.com/macros/s/prova/exec'

type Call = { url: string; init?: RequestInit }

/** fetch, що передає запити у фальшивий Apps Script і записує їх. */
function fakeGoogle(state = makeState()) {
  const sheets = toSheets(state, COLUMNS)
  const script = loadScript(sheets)
  const calls: Call[] = []
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const out =
      init?.method === 'POST'
        ? script.doPost({ postData: { contents: String(init.body) } })
        : script.doGet({ parameter: { token: new URL(url).searchParams.get('token') ?? '' } })
    return { ok: true, status: 200, json: async () => JSON.parse(out.text) }
  }
  return { sheets, calls, fetchFn }
}

const settings = { url: URL_EXEC, token: TOKEN }

/** Значення клітинки останнього рядка вкладки за назвою колонки. */
function lastRow(sheet: FakeSheet, column: string) {
  return sheet.values.at(-1)![sheet.values[0].indexOf(column)]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TEST_NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('SheetsSource: load', () => {
  it('читає таблицю в стан застосунку', async () => {
    const { fetchFn, calls } = fakeGoogle()
    expect(await createSheetsSource(settings, fetchFn).load()).toEqual(JSON.parse(JSON.stringify(makeState())))
    expect(calls[0].url).toBe(`${URL_EXEC}?token=${TOKEN}`)
  })

  it('зміна, зроблена прямо в таблиці, видна після нового завантаження', async () => {
    const { fetchFn, sheets } = fakeGoogle()
    const source = createSheetsSource(settings, fetchFn)
    await source.load()
    sheets.Lotti.values[1][COLUMNS.Lotti.findIndex((c) => c[0] === 'quantita')] = 7
    expect(lotQty(await source.load(), 'MO-NEW')).toBe(7)
  })

  it('неправильний токен → зрозуміла помилка', async () => {
    const { fetchFn } = fakeGoogle()
    await expect(createSheetsSource({ ...settings, token: 'sbagliato' }, fetchFn).load()).rejects.toEqual(new SheetsError('Token non valido', 'auth'))
  })

  it('немає мережі, помилка HTTP, сторінка замість JSON, чужий формат — помилки італійською', async () => {
    const reply = (r: Awaited<ReturnType<FetchLike>>): FetchLike => async () => r
    const cases: [FetchLike, string, SheetsErrorCode][] = [
      [async () => Promise.reject(new TypeError('Failed to fetch')), 'Tabella non raggiungibile: controlla la connessione', 'network'],
      [reply({ ok: false, status: 500, json: async () => ({}) }), 'La tabella ha risposto con errore 500', 'network'],
      [reply({ ok: false, status: 404, json: async () => ({}) }), 'La tabella ha risposto con errore 404', 'config'],
      [reply({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('<html>')) }), "Risposta non valida: controlla l'indirizzo dello script", 'network'],
      [reply({ ok: true, status: 200, json: async () => ({ ok: true, state: { version: 2, lots: [] } }) }), 'I dati della tabella non sono nel formato previsto', 'config'],
      [reply({ ok: true, status: 200, json: async () => ({ ok: false, error: 'Lock timeout' }) }), 'Lock timeout', 'error'],
    ]
    for (const [fetchFn, message, code] of cases) {
      const err = await createSheetsSource(settings, fetchFn).load().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SheetsError)
      expect(err).toMatchObject({ message, code })
    }
  })

  it('testConnection рахує записи в таблиці', async () => {
    const { fetchFn } = fakeGoogle()
    expect(await testConnection(settings, fetchFn)).toEqual({ products: 3, lots: 5, orders: 5 })
  })
})

describe('SheetsSource: apply', () => {
  it('нова партія з телефона з\'являється в таблиці, з тим самим кодом лоту, що на екрані', async () => {
    const { fetchFn, sheets, calls } = fakeGoogle()
    const source = createSheetsSource(settings, fetchFn)
    const action = { type: 'register', productId: 'mozzarella', qty: 40, locationId: 'C' } as const
    await source.apply(action)

    const post = calls.at(-1)!
    expect(post.init?.method).toBe('POST')
    expect(post.init?.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' })
    expect(JSON.parse(String(post.init?.body))).toEqual({ token: TOKEN, action })

    const onScreen = reducer(makeState(), action).lots.at(-1)!
    expect(lastRow(sheets.Lotti, 'id')).toBe(onScreen.id)
    expect(lastRow(sheets.Registro, 'evento')).toBe(`Prodotto lotto ${onScreen.id}: Mozzarella 40 kg → Cella 1 · ripiano 1`)
    expect(await source.load()).toEqual(JSON.parse(JSON.stringify(reducer(makeState(), action))))
  })

  it('відмова таблиці → помилка з причиною', async () => {
    const { fetchFn } = fakeGoogle()
    await expect(createSheetsSource(settings, fetchFn).apply({ type: 'move', lotId: 'MZ-1', locationId: 'Z9' })).rejects.toEqual(
      new SheetsError('Posizione sconosciuta: Z9', 'rejected'),
    )
  })

  it('«Ripristina dati demo» з таблицею недоступне і нічого не відправляє', async () => {
    const { fetchFn, calls } = fakeGoogle()
    await expect(createSheetsSource(settings, fetchFn).apply({ type: 'reset' })).rejects.toBeInstanceOf(SheetsError)
    expect(calls).toHaveLength(0)
  })

  it('дії йдуть у таблицю строго по черзі, навіть якщо перша довго відповідає', async () => {
    const order: string[] = []
    let releaseFirst = () => {}
    const fetchFn: FetchLike = async (_url, init) => {
      const { action } = JSON.parse(String(init?.body))
      if (action.lotId === 'first') await new Promise<void>((r) => (releaseFirst = r))
      order.push(action.lotId)
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    const source = createSheetsSource(settings, fetchFn)
    const a = source.apply({ type: 'ship', lotId: 'first', qty: 1 })
    const b = source.apply({ type: 'ship', lotId: 'second', qty: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual([]) // друга чекає на першу
    releaseFirst()
    await Promise.all([a, b])
    expect(order).toEqual(['first', 'second'])
  })

  it('помилка однієї дії не блокує наступні', async () => {
    const { fetchFn } = fakeGoogle()
    const source = createSheetsSource(settings, fetchFn)
    const bad = source.apply({ type: 'ship', lotId: 'nessuno', qty: 1 })
    const good = source.apply({ type: 'ship', lotId: 'YB-1', qty: 1 })
    await expect(bad).rejects.toEqual(new SheetsError('Lotto sconosciuto: nessuno', 'rejected'))
    await expect(good).resolves.toBeUndefined()
  })
})
