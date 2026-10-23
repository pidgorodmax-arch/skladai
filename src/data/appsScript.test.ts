// Тест-«договір» між застосунком і Apps Script (apps-script/Code.gs).
//
// Скрипт працює в Google, а не тут, тому підставляємо фальшиві SpreadsheetApp,
// Utilities тощо: «таблиця» — це масиви рядків. Потім проганяємо ОДНАКОВІ дії
// через reducer застосунку і через doPost скрипта й перевіряємо, що doGet
// повертає той самий стан. Так логіка в двох місцях не розійдеться.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import codeGs from '../../apps-script/Code.gs?raw'
import sheetsMd from '../../docs/sheets.md?raw'
import { reducer, type Action } from './reducer'
import { TEST_NOW, makeState } from './testState'
import { romeDate, romeDateTime } from './time'
import type { AppState } from './types'

type Cell = string | number | Date
type Columns = Record<string, [string, string, string][]>

/** Фальшива вкладка: values[0] — заголовок, далі рядки. */
class FakeSheet {
  values: Cell[][]
  constructor(values: Cell[][]) {
    this.values = values
  }
  getDataRange() {
    return { getValues: () => this.values.map((r) => [...r]) }
  }
  appendRow(row: Cell[]) {
    this.values.push([...row])
  }
  getRange(row: number, col: number) {
    return {
      setValue: (v: Cell) => {
        this.values[row - 1][col - 1] = v
      },
    }
  }
  deleteRow(row: number) {
    this.values.splice(row - 1, 1)
  }
}

interface Script {
  doGet(e: unknown): { text: string }
  doPost(e: unknown): { text: string }
  COLUMNS: Columns
}

const TOKEN = 'segreto-di-prova'

/** Завантажує Code.gs з фальшивими сервісами Google. */
function loadScript(sheets: Record<string, FakeSheet>, token: string | null = TOKEN): Script {
  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => sheets[n] ?? null }) },
    Utilities: {
      formatDate(date: Date, tz: string, pattern: string) {
        expect(tz).toBe('Europe/Rome')
        if (pattern === 'yyyy-MM-dd') return romeDate(date)
        if (pattern === "yyyy-MM-dd'T'HH:mm") return romeDateTime(date)
        throw new Error('formato non previsto: ' + pattern)
      },
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => (k === 'TOKEN' ? token : null) }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ text, setMimeType: () => ({ text }) }),
    },
  }
  const factory = new Function(...Object.keys(services), `${codeGs}\nreturn { doGet, doPost, COLUMNS }`)
  return factory(...Object.values(services)) as Script
}

/** Стан застосунку → вкладки таблиці, як описано в docs/sheets.md. */
function toSheets(state: AppState, columns: Columns): Record<string, FakeSheet> {
  const cell = (v: unknown): Cell => (v === undefined || v === null ? '' : (v as Cell))
  const table = (name: string, records: Record<string, unknown>[]) =>
    new FakeSheet([columns[name].map((c) => c[0]), ...records.map((r) => columns[name].map((c) => cell(r[c[1]])))])
  const orderRows = state.orders.flatMap((o) => o.lines.map((l) => ({ ...o, productId: l.productId, qty: l.qty })))
  const rec = <T extends object>(xs: T[]) => xs as unknown as Record<string, unknown>[]
  return {
    Prodotti: table('Prodotti', rec(state.products)),
    Zone: table('Zone', rec(state.zones)),
    Posizioni: table('Posizioni', rec(state.locations)),
    Lotti: table('Lotti', rec(state.lots)),
    Ordini: table('Ordini', rec(orderRows)),
    Registro: table('Registro', rec(state.log)),
  }
}

/** JSON-копія: прибирає поля зі значенням undefined, як і відповідь скрипта. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))

function get(script: Script, token = TOKEN) {
  return JSON.parse(script.doGet({ parameter: { token } }).text)
}

function post(script: Script, action: unknown, token = TOKEN) {
  return JSON.parse(script.doPost({ postData: { contents: JSON.stringify({ token, action }) } }).text)
}

const COLUMNS = loadScript({}).COLUMNS

function setup(state = makeState()) {
  const sheets = toSheets(state, COLUMNS)
  return { sheets, script: loadScript(sheets) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TEST_NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Apps Script: doGet', () => {
  it('читає таблицю назад у той самий стан', () => {
    const { script } = setup()
    expect(get(script)).toEqual({ ok: true, state: plain(makeState()) })
  })

  it('без правильного токена — помилка, а не дані', () => {
    const { script } = setup()
    expect(get(script, 'sbagliato')).toEqual({ ok: false, error: 'Token non valido' })
    expect(get(loadScript(toSheets(makeState(), COLUMNS), null))).toMatchObject({ ok: false })
  })

  it('порядок колонок неважливий, порожні рядки пропускаються, дробові з комою читаються', () => {
    const { sheets, script } = setup()
    const zone = sheets.Zone.values
    // Переставляємо колонки: x стає першою.
    sheets.Zone.values = zone.map((r) => [r[3], ...r.slice(0, 3), ...r.slice(4)])
    sheets.Zone.values.splice(2, 0, ['', '', '', '', '', '', ''])
    sheets.Prodotti.values[1][COLUMNS.Prodotti.findIndex((c) => c[0] === 'prezzo')] = '95,5'
    const state = get(script).state
    expect(state.zones).toEqual(plain(makeState().zones))
    expect(state.products[0].pricePerUnit).toBe(95.5)
  })

  it('дата, яку Таблиця сама перетворила на Date, читається як «РРРР-ММ-ДД» за Римом', () => {
    const { sheets, script } = setup()
    const col = COLUMNS.Lotti.findIndex((c) => c[0] === 'data_produzione')
    sheets.Lotti.values[1][col] = new Date('2026-05-15T22:00:00Z') // північ 16.05 у Римі
    expect(get(script).state.lots[0].producedAt).toBe('2026-05-16')
  })

  it('бракує колонки або вкладки — зрозуміла помилка італійською', () => {
    const { sheets, script } = setup()
    sheets.Lotti.values[0][0] = 'codice'
    expect(get(script)).toEqual({ ok: false, error: 'Scheda «Lotti»: manca la colonna «id»' })
    const noTab = toSheets(makeState(), COLUMNS)
    delete (noTab as Partial<typeof noTab>).Registro
    expect(get(loadScript(noTab))).toEqual({ ok: false, error: 'Manca la scheda «Registro»' })
  })
})

describe('Apps Script: doPost дає той самий результат, що й reducer', () => {
  // Сценарій дня в цеху: кожна дія застосовується і в застосунку, і в таблиці.
  const day: [string, Action][] = [
    ['нова партія моцарели', { type: 'register', productId: 'mozzarella', qty: 40, locationId: 'C', milkLitres: 410 }],
    ['друга партія того ж дня (суфікс 2)', { type: 'register', productId: 'mozzarella', qty: 5, locationId: 'C' }],
    ['Montasio без терміну', { type: 'register', productId: 'montasio', qty: 12, locationId: 'B' }],
    ['переміщення', { type: 'move', lotId: 'MO-NEW', locationId: 'B' }],
    ['часткове списання', { type: 'ship', lotId: 'YB-1', qty: 30 }],
    ['повне списання — рядок зникає', { type: 'ship', lotId: 'MZ-2', qty: 999 }],
    ['статус без списання', { type: 'orderStatus', orderId: 'O1', status: 'in_preparazione' }],
    ['spedito: FEFO по двох продуктах', { type: 'orderStatus', orderId: 'O5', status: 'spedito' }],
    ['spedito при нестачі — без від\'ємних залишків', { type: 'orderStatus', orderId: 'O1', status: 'spedito' }],
  ]

  it('крок за кроком таблиця = стан застосунку', () => {
    const { script } = setup()
    let state = makeState()
    for (const [name, action] of day) {
      vi.advanceTimersByTime(7 * 60_000)
      state = reducer(state, action)
      expect(post(script, action), name).toEqual({ ok: true })
      expect(get(script).state, name).toEqual(plain(state))
    }
  })

  it('після півночі за Римом — римська дата лоту й час у Registro', () => {
    vi.setSystemTime(new Date('2026-06-15T22:30:00Z'))
    const { script } = setup()
    const action: Action = { type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C' }
    post(script, action)
    const state = get(script).state
    expect(state.lots.at(-1)).toMatchObject({ id: 'L-1606-MZ', producedAt: '2026-06-16', expiresAt: '2026-06-23' })
    expect(state.log.at(-1).at).toBe('2026-06-16T00:30')
    expect(state).toEqual(plain(reducer(makeState(), action)))
  })

  it('«spedito» остаточний: повернути статус не можна, таблиця не змінюється', () => {
    const { script } = setup()
    const before = get(script).state
    expect(post(script, { type: 'orderStatus', orderId: 'O4', status: 'nuovo' })).toEqual({ ok: false, error: 'Ordine O4 già spedito' })
    expect(get(script).state).toEqual(before)
  })

  it('помилкові дії не змінюють таблицю і повертають причину', () => {
    const { script } = setup()
    const before = get(script).state
    const bad: [unknown, string][] = [
      [{ type: 'register', productId: 'nessuno', qty: 1, locationId: 'C' }, 'Prodotto sconosciuto: nessuno'],
      [{ type: 'register', productId: 'mozzarella', qty: 0, locationId: 'C' }, 'Quantità non valida'],
      [{ type: 'ship', lotId: 'YB-1', qty: -5 }, 'Quantità non valida'],
      [{ type: 'ship', lotId: 'YB-1', qty: '3' }, 'Quantità non valida'],
      [{ type: 'register', productId: 'mozzarella', qty: 1, locationId: 'C', milkLitres: '=IMPORTXML("x")' }, 'Litri di latte non validi'],
      [{ type: 'move', lotId: 'MZ-1', locationId: 'Z9' }, 'Posizione sconosciuta: Z9'],
      [{ type: 'orderStatus', orderId: 'O1', status: 'perso' }, 'Stato non valido: perso'],
      [{ type: 'reset' }, 'Azione sconosciuta: reset'],
    ]
    for (const [action, error] of bad) expect(post(script, action)).toEqual({ ok: false, error })
    expect(post(script, { type: 'ship', lotId: 'YB-1', qty: 1 }, 'sbagliato')).toEqual({ ok: false, error: 'Token non valido' })
    expect(get(script).state).toEqual(before)
  })
})

describe('Apps Script і docs/sheets.md', () => {
  /** Колонки вкладки з документа: [назва, обов'язкова, поле]. */
  function documented(tab: string): [string, boolean, string][] {
    const section = sheetsMd.split(`## Вкладка \`${tab}\``)[1].split('\n## ')[0]
    return [...section.matchAll(/^\| `([a-z_]+)` \| (так|ні) \|.*\| `([^`]+)` \|$/gm)].map((m) => [m[1], m[2] === 'так', m[3]])
  }

  it('кожна вкладка в скрипті має ті самі колонки, що в документі', () => {
    for (const [tab, cols] of Object.entries(COLUMNS)) {
      const fromScript = cols.map(([name, field, type]) => [
        name,
        !type.endsWith('?') && !type.endsWith('|null'),
        tab === 'Ordini' && ['productId', 'qty'].includes(field) ? `lines[].${field}` : field,
      ])
      expect(fromScript, tab).toEqual(documented(tab))
    }
  })
})
