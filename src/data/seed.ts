// Демо-дані для невеликої сироварні у Фріулі. Дати рахуються відносно
// сьогоднішнього дня (за Римом), тому демо завжди виглядає «свіжим».
// Усе тут вигадане: коди ART-000N, ціни, клієнти (репозиторій публічний).

import { startOfDay } from './selectors'
import { STATE_VERSION, type AppState, type Box, type Lot, type Product, type Unit } from './types'

const DAY = 24 * 60 * 60 * 1000

/** День через `offsetDays` від `from` (за замовчуванням — сьогодні в Римі), «РРРР-ММ-ДД». */
export function isoDay(offsetDays: number, from = startOfDay(new Date())): string {
  const d = new Date(from.getTime() + offsetDays * DAY)
  return d.toISOString().slice(0, 10)
}

const products: Product[] = [
  { id: 'montasio', code: 'ART-0007', abbr: 'MO', name: 'Montasio DOP', unit: 'forme', spacePerUnit: 1, shelfLifeDays: null, pricePerUnit: 95, storage: 'aging' },
  { id: 'mozzarella', code: 'ART-0001', abbr: 'MZ', name: 'Mozzarella', unit: 'kg', spacePerUnit: 1, shelfLifeDays: 7, pricePerUnit: 9.5, yieldPerLitre: 0.098, storage: 'cold' },
  { id: 'ricotta', code: 'ART-0003', abbr: 'RI', name: 'Ricotta', unit: 'kg', spacePerUnit: 1, shelfLifeDays: 5, pricePerUnit: 7, storage: 'cold' },
  { id: 'yogurt', code: 'ART-0005', abbr: 'YB', name: 'Yogurt bianco', unit: 'vasetti', spacePerUnit: 0.15, shelfLifeDays: 21, pricePerUnit: 0.9, storage: 'cold' },
  { id: 'kefir', code: 'ART-0006', abbr: 'KF', name: 'Kefir', unit: 'L', spacePerUnit: 1, shelfLifeDays: 14, pricePerUnit: 3.2, storage: 'cold' },
  { id: 'burro', code: 'ART-0004', abbr: 'BU', name: 'Burro', unit: 'kg', spacePerUnit: 1, shelfLifeDays: 40, pricePerUnit: 11, storage: 'cold' },
  { id: 'latte', code: 'ART-0002', abbr: 'LT', name: 'Latte fresco', unit: 'L', spacePerUnit: 1, shelfLifeDays: 4, pricePerUnit: 1.6, storage: 'cold' },
]

/** `base`, а якщо він уже зайнятий — `base2`, `base3`, … */
export function withSuffix(base: string, existing: string[]): string {
  let value = base
  let n = 2
  while (existing.includes(value)) value = `${base}${n++}`
  return value
}

/** Код лоту: «L-ДДММ-сигла», за повтору того ж дня — суфікс 2, 3, … */
export function lotCode(abbr: string, producedAt: string, existing: string[]): string {
  const [, mm, dd] = producedAt.split('-')
  return withSuffix(`L-${dd}${mm}-${abbr || 'XX'}`, existing)
}

/**
 * Код першої коробки партії: `<id партії>-1`. ID партії унікальний (його
 * дає телефон), тож і код коробки унікальний без мережі. Так само міграція
 * v3→v4 називає коробку старої партії — тому повторне завантаження з
 * таблиці дає ті самі коди.
 */
export function firstBoxId(lotId: string): string {
  return `${lotId}-1`
}

export function expiryFor(product: Product, producedAt: string): string | null {
  if (product.shelfLifeDays == null) return null
  const d = new Date(producedAt + 'T00:00:00Z')
  return isoDay(product.shelfLifeDays, d)
}

/**
 * Демо: скільки одиниць у повній коробці. Форми Montasio лежать на стелажі
 * без коробок — уся партія на стелажі рахується одним «колло».
 */
const BOX_SIZE: Record<Unit, number> = { kg: 10, L: 20, vasetti: 48, pz: 24, forme: Infinity }

/** Партія → повні коробки й остання з рештою. */
function splitIntoBoxes(lotId: string, locationId: string, qty: number, unit: Unit): Box[] {
  const size = BOX_SIZE[unit]
  const out: Box[] = []
  for (let left = qty, n = 1; left > 0; left -= size, n++) {
    out.push({ id: n === 1 ? firstBoxId(lotId) : `${lotId}-${n}`, lotId, locationId, qty: Math.min(size, left) })
  }
  return out
}

export function createSeed(): AppState {
  const lots: Lot[] = []
  const boxes: Box[] = []
  const add = (productId: string, qty: number, locationId: string, producedDaysAgo: number) => {
    const product = products.find((p) => p.id === productId)!
    const producedAt = isoDay(-producedDaysAgo)
    const code = lotCode(product.abbr, producedAt, lots.map((l) => l.code))
    lots.push({
      id: code, // демо: сталий ID; нові партії отримують ID від телефона (stamp)
      code,
      productId,
      producedAt,
      expiresAt: expiryFor(product, producedAt),
    })
    boxes.push(...splitIntoBoxes(code, locationId, qty, product.unit))
  }

  // Витримка Montasio
  add('montasio', 96, 'A', 180)
  add('montasio', 14, 'A', 90)
  add('montasio', 88, 'B', 60)
  add('montasio', 6, 'B', 35)
  add('montasio', 70, 'C', 365)
  add('montasio', 7, 'C', 395)
  add('montasio', 104, 'D', 150)
  add('montasio', 10, 'D', 210)
  add('montasio', 48, 'E', 21)
  add('montasio', 26, 'F', 420)
  // Холодильні камери
  add('yogurt', 410, 'C1-1', 9)
  add('yogurt', 96, 'C1-1', 15)
  add('latte', 120, 'C1-1', 0)
  add('kefir', 60, 'C1-2', 7)
  add('burro', 72, 'C1-2', 18)
  add('mozzarella', 71, 'C2-1', 1)
  add('mozzarella', 24, 'C2-1', 3)
  add('ricotta', 12, 'C2-2', 2)
  add('ricotta', 8, 'C2-2', 2)

  return {
    version: STATE_VERSION,
    products,
    zones: [
      { id: 'stag', name: 'Stagionatura', temperature: '12,5 °C · 85% UR', x: 0, z: 0, w: 14, d: 10 },
      { id: 'c1', name: 'Cella 1', temperature: '3,2 °C', x: 16, z: 0, w: 12, d: 6 },
      { id: 'c2', name: 'Cella 2', temperature: '4,1 °C', x: 16, z: 7, w: 12, d: 6 },
      { id: 'prod', name: 'Produzione', x: 0, z: 12, w: 14, d: 8 },
      { id: 'dock', name: 'Banchina di carico', x: 16, z: 15, w: 12, d: 5 },
    ],
    locations: [
      { id: 'A', name: 'Scaffale A', zoneId: 'stag', kind: 'aging', capacity: 120, x: 1, z: 2, w: 3.2, d: 1, h: 2.4 },
      { id: 'B', name: 'Scaffale B', zoneId: 'stag', kind: 'aging', capacity: 120, x: 5.4, z: 2, w: 3.2, d: 1, h: 2.4 },
      { id: 'C', name: 'Scaffale C', zoneId: 'stag', kind: 'aging', capacity: 120, x: 9.8, z: 2, w: 3.2, d: 1, h: 2.4 },
      { id: 'D', name: 'Scaffale D', zoneId: 'stag', kind: 'aging', capacity: 120, x: 1, z: 6, w: 3.2, d: 1, h: 2.4 },
      { id: 'E', name: 'Scaffale E', zoneId: 'stag', kind: 'aging', capacity: 120, x: 5.4, z: 6, w: 3.2, d: 1, h: 2.4 },
      { id: 'F', name: 'Scaffale F', zoneId: 'stag', kind: 'aging', capacity: 120, x: 9.8, z: 6, w: 3.2, d: 1, h: 2.4 },
      { id: 'C1-1', name: 'Cella 1 · ripiano 1', zoneId: 'c1', kind: 'cold', capacity: 220, x: 17, z: 1.5, w: 4.5, d: 1.2, h: 2 },
      { id: 'C1-2', name: 'Cella 1 · ripiano 2', zoneId: 'c1', kind: 'cold', capacity: 240, x: 23, z: 1.5, w: 4.5, d: 1.2, h: 2 },
      { id: 'C2-1', name: 'Cella 2 · ripiano 1', zoneId: 'c2', kind: 'cold', capacity: 160, x: 17, z: 8.5, w: 4.5, d: 1.2, h: 2 },
      { id: 'C2-2', name: 'Cella 2 · ripiano 2', zoneId: 'c2', kind: 'cold', capacity: 60, x: 23, z: 8.5, w: 4.5, d: 1.2, h: 2 },
      { id: 'K1', name: 'Caldaia 1', zoneId: 'prod', kind: 'machine', capacity: 0, x: 1.5, z: 14, w: 2.4, d: 2.4, h: 1.4, status: 'In uso', note: 'Cotta mozzarella da 490 L, fine prevista alle 11:40' },
      { id: 'K2', name: 'Caldaia 2', zoneId: 'prod', kind: 'machine', capacity: 0, x: 5.2, z: 14, w: 2.4, d: 2.4, h: 1.4, status: 'Libera', note: 'Lavata alle 09:00, pronta per la ricotta' },
      { id: 'FL', name: 'Banco filatura', zoneId: 'prod', kind: 'machine', capacity: 0, x: 9, z: 14.5, w: 3.5, d: 1.4, h: 1, status: 'In attesa', note: 'Prossima filatura alle 11:45, 2 operatori' },
      { id: 'P1', name: 'Pallet spedizioni', zoneId: 'dock', kind: 'dock', capacity: 400, x: 18, z: 16.5, w: 1.2, d: 1, h: 0.9 },
    ],
    lots,
    boxes,
    picks: [],
    orders: [
      { id: 'ORD-1042', client: 'Alimentari Rossi', channel: 'WhatsApp', lines: [{ productId: 'mozzarella', qty: 40 }, { productId: 'ricotta', qty: 15 }], due: isoDay(2), status: 'in_preparazione' },
      { id: 'ORD-1043', client: 'Agriturismo Il Colle', channel: 'Telefono', lines: [{ productId: 'montasio', qty: 6 }], due: isoDay(2), status: 'in_preparazione' },
      { id: 'ORD-1044', client: 'Bar Centrale', channel: 'WhatsApp', lines: [{ productId: 'latte', qty: 60 }, { productId: 'yogurt', qty: 48 }], due: isoDay(3), status: 'nuovo' },
      { id: 'ORD-1045', client: 'Mensa scolastica', channel: 'Email', lines: [{ productId: 'yogurt', qty: 220 }, { productId: 'latte', qty: 300 }], due: isoDay(5), status: 'nuovo' },
      { id: 'ORD-1046', client: 'Supermercato Bassi', channel: 'Email', lines: [{ productId: 'burro', qty: 30 }, { productId: 'kefir', qty: 80 }, { productId: 'mozzarella', qty: 140 }], due: isoDay(6), status: 'nuovo' },
    ],
    log: [
      { at: isoDay(0) + 'T03:10', text: 'Cella 2: temperatura 5,8 °C per 20 minuti, poi rientrata.' },
      { at: isoDay(0) + 'T06:30', text: 'Registro temperature celle completato.' },
    ],
  }
}
