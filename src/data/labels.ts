// Етикетки з QR (2b.3): що закодовано в QR і як його прочитати назад.
//
// У QR — посилання на застосунок: `<адреса застосунку>#/scan?collo=<код>`
// (або `?pos=<id стелажа>`). Звичайна камера телефона відкриє SkladAI, а
// сканер у застосунку (2b.4) розбере те саме посилання функцією parseQr.
// Адреса береться з того місця, звідки відкрили сторінку етикеток, тож QR
// працює і на GitHub Pages, і на будь-якому іншому хостингу.

import QRCode from 'qrcode'

export type ScanTarget = { kind: 'collo'; id: string } | { kind: 'posizione'; id: string }

const PARAM: Record<ScanTarget['kind'], string> = { collo: 'collo', posizione: 'pos' }

/** Адреса застосунку без `#…` — те, що стоїть перед `#/scan`. */
export function appBaseUrl(location: { origin: string; pathname: string }): string {
  return location.origin + location.pathname
}

/** Текст QR для коробки чи стелажа. */
export function qrPayload(baseUrl: string, target: ScanTarget): string {
  return `${baseUrl}#/scan?${PARAM[target.kind]}=${encodeURIComponent(target.id)}`
}

/**
 * Текст із QR → що відсканували. Приймає посилання з будь-якою адресою
 * застосунку (етикетку могли надрукувати з іншого хостингу). Чужий QR — null.
 */
export function parseQr(text: string): ScanTarget | null {
  const hash = text.indexOf('#/scan?')
  if (hash === -1) return null
  const params = new URLSearchParams(text.slice(hash + '#/scan?'.length))
  for (const kind of ['collo', 'posizione'] as const) {
    const id = params.get(PARAM[kind])?.trim()
    if (id) return { kind, id }
  }
  return null
}

/** Квадратна матриця QR: modules[рядок][стовпець] = true — чорний модуль. */
export function qrModules(text: string): boolean[][] {
  // Рівень M: витримує ~15% пошкоджень (подряпана етикетка в цеху).
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const size = modules.size
  return Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => Boolean(modules.get(r, c))))
}

/** SVG-шлях QR (один квадрат 1×1 на кожен чорний модуль) для viewBox `0 0 size size`. */
export function qrPath(modules: boolean[][]): string {
  const parts: string[] = []
  modules.forEach((row, r) => row.forEach((on, c) => on && parts.push(`M${c} ${r}h1v1h-1z`)))
  return parts.join('')
}
