// Фальшивий Apps Script для тестів: справжній apps-script/Code.gs, але
// замість сервісів Google — «таблиця» в пам'яті (масиви рядків).
// Використовують appsScript.test.ts і sheetsSource.test.ts.

import codeGs from '../../apps-script/Code.gs?raw'
import { lotStock } from './selectors'
import { romeDate, romeDateTime } from './time'
import type { AppState } from './types'

export type Cell = string | number | Date
export type Columns = Record<string, [string, string, string][]>

/** Фальшива вкладка: values[0] — заголовок, далі рядки. */
export class FakeSheet {
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
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    return {
      setValue: (v: Cell) => {
        this.values[row - 1][col - 1] = v
      },
      setValues: (vs: Cell[][]) => {
        if (vs.length !== numRows || vs.some((r) => r.length !== numCols)) throw new Error('setValues: dimensioni diverse')
        vs.forEach((r, i) => {
          this.values[row - 1 + i] ??= []
          r.forEach((v, j) => (this.values[row - 1 + i][col - 1 + j] = v))
        })
      },
    }
  }
  deleteRow(row: number) {
    this.values.splice(row - 1, 1)
  }
}

export interface Script {
  doGet(e: unknown): { text: string }
  doPost(e: unknown): { text: string }
  COLUMNS: Columns
}

export const TOKEN = 'segreto-di-prova'

/** Завантажує Code.gs з фальшивими сервісами Google. */
export function loadScript(sheets: Record<string, FakeSheet>, token: string | null = TOKEN): Script {
  const services = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n: string) => sheets[n] ?? null,
        insertSheet: (n: string) => {
          if (sheets[n]) throw new Error('scheda già presente: ' + n)
          sheets[n] = new FakeSheet([])
          return sheets[n]
        },
      }),
    },
    Utilities: {
      formatDate(date: Date, tz: string, pattern: string) {
        if (tz !== 'Europe/Rome') throw new Error('fuso orario non previsto: ' + tz)
        if (pattern === 'yyyy-MM-dd') return romeDate(date)
        if (pattern === "yyyy-MM-dd'T'HH:mm") return romeDateTime(date)
        throw new Error('formato non previsto: ' + pattern)
      },
    },
    // Пам'ять виконаних дій (у Google — CacheService, 6 годин).
    CacheService: (() => {
      const done = new Map<string, string>()
      return { getScriptCache: () => ({ get: (k: string) => done.get(k) ?? null, put: (k: string, v: string) => void done.set(k, v) }) }
    })(),
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
export function toSheets(state: AppState, columns: Columns): Record<string, FakeSheet> {
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
    Colli: table('Colli', rec(state.boxes)),
    Prelievi: table('Prelievi', rec(state.picks)),
    Uscite: table('Uscite', rec(state.uscite)),
    Ordini: table('Ordini', rec(orderRows)),
    Registro: table('Registro', rec(state.log)),
  }
}

/**
 * Стара таблиця (до 2b.1a): без вкладки Colli, кількість і стелаж — у рядку
 * Lotti (на одну партію — один стелаж).
 */
export function toLegacySheets(state: AppState, columns: Columns): Record<string, FakeSheet> {
  const { Colli: _colli, Prelievi: _prelievi, Uscite: _uscite, ...sheets } = toSheets(state, columns)
  const lotti: Columns = { Lotti: [...columns.Lotti, ['quantita', 'qty', 'num'], ['posizione', 'locationId', 'text']] }
  return { ...sheets, Lotti: toSheets({ ...state, lots: lotStock(state) }, { ...columns, ...lotti }).Lotti }
}

/** Колонки вкладок так, як їх знає скрипт. */
export const COLUMNS = loadScript({}).COLUMNS
