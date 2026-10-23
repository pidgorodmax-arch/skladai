// Фальшивий Apps Script для тестів: справжній apps-script/Code.gs, але
// замість сервісів Google — «таблиця» в пам'яті (масиви рядків).
// Використовують appsScript.test.ts і sheetsSource.test.ts.

import codeGs from '../../apps-script/Code.gs?raw'
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

export interface Script {
  doGet(e: unknown): { text: string }
  doPost(e: unknown): { text: string }
  COLUMNS: Columns
}

export const TOKEN = 'segreto-di-prova'

/** Завантажує Code.gs з фальшивими сервісами Google. */
export function loadScript(sheets: Record<string, FakeSheet>, token: string | null = TOKEN): Script {
  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => sheets[n] ?? null }) },
    Utilities: {
      formatDate(date: Date, tz: string, pattern: string) {
        if (tz !== 'Europe/Rome') throw new Error('fuso orario non previsto: ' + tz)
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
    Ordini: table('Ordini', rec(orderRows)),
    Registro: table('Registro', rec(state.log)),
  }
}

/** JSON-копія: прибирає поля зі значенням undefined, як і відповідь скрипта. */
/** Колонки вкладок так, як їх знає скрипт. */
export const COLUMNS = loadScript({}).COLUMNS
