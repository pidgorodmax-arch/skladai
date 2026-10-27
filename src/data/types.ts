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
  /** Scorta minima: нижче цього залишку — попередження (колонка `scorta_minima`). */
  minStock?: number
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

/**
 * Партія (lotto): що, коли й скільки молока. Кількості й місця в самій
 * партії немає — вона лежить у коробках (Box), і її залишок = сума коробок
 * (селектори lotQty, lotStock у selectors.ts).
 */
export interface Lot {
  /**
   * Внутрішній унікальний ID: створює телефон у момент запису, без мережі.
   * Списання й переміщення посилаються лише на нього. Людям не показується.
   */
  id: string
  /**
   * Код партії для людей і етикеток: `L-ДДММ-сигла` (`L-2310-MZ`). Якщо два
   * телефони офлайн дали однаковий код, таблиця додає суфікс (`…MZ2`).
   */
  code: string
  productId: string
  producedAt: string // ISO-дата
  expiresAt: string | null
  milkLitres?: number
}

/**
 * Коробка (collo): частина однієї партії на конкретному стелажі. Саме її
 * працівник сканує й бере під замовлення. Порожня коробка зникає зі стану.
 */
export interface Box {
  /** Код етикетки (QR). Перша коробка партії — `<id партії>-1` (див. firstBoxId). */
  id: string
  lotId: string
  locationId: string
  qty: number
}

/**
 * Як узяли товар під замовлення:
 *   scansionato — працівник відсканував коробку й ввів кількість (pick);
 *   automatico  — решту добрала система за FEFO під час «spedito».
 */
export type PickMethod = 'scansionato' | 'automatico'

/** Куди пішов товар з «Uscita rapida» (2c.1): під замовлення з Mexal, у spaccio чи в брак. */
export type Destinazione = 'ordine' | 'spaccio' | 'scarto'

/**
 * Вихід товару з коробки (2c.1) — без замовлень і клієнтів у SkladAI
 * (замовлення ведуть у Mexal). Лот зберігаємо для простежуваності HACCP.
 */
export interface Uscita {
  boxId: string
  lotId: string
  productId: string
  qty: number
  dest: Destinazione
  at: string // «РРРР-ММ-ДДTгг:хх» за Римом
}

/** Взято з коробки під замовлення (збирання, етап 2b.2). Основа простежуваності. */
export interface Pick {
  orderId: string
  productId: string
  boxId: string
  /** Партія коробки: порожня коробка зникає, а лот для HACCP має лишитись. */
  lotId: string
  qty: number
  at: string // «РРРР-ММ-ДДTгг:хх» за Римом
  method: PickMethod
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
export const STATE_VERSION = 6

export interface AppState {
  version: typeof STATE_VERSION
  products: Product[]
  zones: Zone[]
  locations: Location[]
  lots: Lot[]
  /** Коробки — тут живуть кількість і місце кожної партії. */
  boxes: Box[]
  /** Що й з якої коробки взяли під замовлення. */
  picks: Pick[]
  /** Виходи товару з «Uscita rapida»: Ordine / Spaccio / Scarto. */
  uscite: Uscita[]
  orders: Order[]
  /** Журнал подій — основа для звітів HACCP і для AI-агента. */
  log: { at: string; text: string }[]
}
