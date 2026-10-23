// Модель даних SkladAI. Усі екрани (дашборд, 3D-карта, телефон) читають
// і змінюють ОДНІ й ті самі дані — у цьому суть «однієї системи».

/** pz — штуки (фасовані артикули: упаковки, вазочки). */
export type Unit = 'kg' | 'L' | 'vasetti' | 'forme' | 'pz'

export interface Product {
  id: string
  /** Код артикула в програмі обліку клієнта (колонка `codice`); у демо — вигаданий. */
  code?: string
  /** Сигла для коду лоту: `MZ` → `L-2310-MZ` (колонка `sigla`). */
  abbr: string
  name: string
  unit: Unit
  /** Скільки «місць» на полиці займає одна одиниця (кг, л, вазочок, форма). */
  spacePerUnit: number
  /** Термін придатності в днях; null — продукт витримується (Montasio). */
  shelfLifeDays: number | null
  /** Ціна продажу за одиницю, € — для вартості складу. */
  pricePerUnit: number
  /** Вихід продукту з літра молока (0.098 = 9,8%), якщо застосовно. */
  yieldPerLitre?: number
  /** Тип місця, де продукт зберігається. */
  storage: 'aging' | 'cold'
}

export type LocationKind = 'aging' | 'cold' | 'machine' | 'dock'

export interface Location {
  id: string
  name: string
  zoneId: string
  kind: LocationKind
  /** Місткість у «місцях» (див. Product.spacePerUnit). */
  capacity: number
  /** Позиція на плані цеху, метри. x — праворуч, z — углиб. */
  x: number
  z: number
  /** Розмір, метри: ширина, глибина, висота. */
  w: number
  d: number
  h: number
  /** Для машин: поточний статус і нотатка. */
  status?: string
  note?: string
}

export interface Zone {
  id: string
  name: string
  temperature?: string
  x: number
  z: number
  w: number
  d: number
}

export interface Lot {
  id: string
  productId: string
  qty: number
  locationId: string
  producedAt: string // ISO-дата
  expiresAt: string | null
  milkLitres?: number
}

export interface OrderLine {
  productId: string
  qty: number
}

export type OrderStatus = 'nuovo' | 'in_preparazione' | 'spedito'

export interface Order {
  id: string
  client: string
  channel: 'WhatsApp' | 'Email' | 'Telefono'
  lines: OrderLine[]
  due: string // ISO-дата
  status: OrderStatus
}

/**
 * Версія формату даних. Збільшуй її, коли змінюєш AppState так, що старі
 * збережені дані вже не підходять, і додай крок у MIGRATIONS (migrate.ts).
 */
export const STATE_VERSION = 2

export interface AppState {
  version: typeof STATE_VERSION
  products: Product[]
  zones: Zone[]
  locations: Location[]
  lots: Lot[]
  orders: Order[]
  /** Журнал подій — основа для звітів HACCP і для AI-агента. */
  log: { at: string; text: string }[]
}
