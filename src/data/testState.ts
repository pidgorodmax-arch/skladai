// Маленький, передбачуваний стан для тестів. Демо-дані з seed.ts рахуються
// від сьогоднішньої дати й часто змінюються, тому тести на них не спираються.
// Усі дати тут — відносно «сьогодні» = TEST_NOW (15 червня 2026).

import { STATE_VERSION, type AppState } from './types'

/** Полудень за UTC — щоб «сьогодні» було 15.06 у будь-якому часовому поясі Європи. */
export const TEST_NOW = new Date('2026-06-15T12:00:00Z')
/** Те саме «сьогодні» у форматі, який приймають селектори (див. startOfDay). */
export const TEST_TODAY = new Date('2026-06-15T00:00:00Z')

export function makeState(): AppState {
  return {
    version: STATE_VERSION,
    products: [
      { id: 'montasio', code: 'ART-0007', abbr: 'MO', name: 'Montasio DOP', unit: 'forme', spacePerUnit: 1, shelfLifeDays: null, pricePerUnit: 95, storage: 'aging' },
      { id: 'mozzarella', code: 'ART-0001', abbr: 'MZ', name: 'Mozzarella', unit: 'kg', spacePerUnit: 1, shelfLifeDays: 7, pricePerUnit: 9.5, storage: 'cold' },
      { id: 'yogurt', code: 'ART-0005', abbr: 'YB', name: 'Yogurt bianco', unit: 'vasetti', spacePerUnit: 0.15, shelfLifeDays: 21, pricePerUnit: 0.9, storage: 'cold' },
    ],
    zones: [
      { id: 'stag', name: 'Stagionatura', x: 0, z: 0, w: 10, d: 10 },
      { id: 'c1', name: 'Cella 1', x: 12, z: 0, w: 6, d: 6 },
    ],
    locations: [
      { id: 'A', name: 'Scaffale A', zoneId: 'stag', kind: 'aging', capacity: 100, x: 1, z: 1, w: 3, d: 1, h: 2 },
      { id: 'B', name: 'Scaffale B', zoneId: 'stag', kind: 'aging', capacity: 100, x: 5, z: 1, w: 3, d: 1, h: 2 },
      { id: 'C', name: 'Cella 1 · ripiano 1', zoneId: 'c1', kind: 'cold', capacity: 50, x: 13, z: 1, w: 4, d: 1, h: 2 },
      { id: 'K1', name: 'Caldaia 1', zoneId: 'stag', kind: 'machine', capacity: 0, x: 1, z: 8, w: 2, d: 2, h: 1 },
    ],
    // id (внутрішній) навмисно не збігається з code (для людей): тести
    // ловлять, якщо десь їх переплутали.
    // Порядок у масиві навмисно «неправильний» (новіші партії першими),
    // щоб тест FEFO перевіряв сортування, а не порядок запису.
    lots: [
      { id: 'MO-NEW', code: 'L-1605-MO', productId: 'montasio', qty: 10, locationId: 'A', producedAt: '2026-05-16', expiresAt: null }, // 30 днів
      { id: 'MO-OLD', code: 'L-1506-MO', productId: 'montasio', qty: 30, locationId: 'A', producedAt: '2025-06-15', expiresAt: null }, // 365 днів
      { id: 'MZ-2', code: 'L-1406-MZ', productId: 'mozzarella', qty: 15, locationId: 'C', producedAt: '2026-06-14', expiresAt: '2026-06-21' }, // спливає за 6 днів
      { id: 'MZ-1', code: 'L-1206-MZ', productId: 'mozzarella', qty: 20, locationId: 'C', producedAt: '2026-06-12', expiresAt: '2026-06-19' }, // спливає за 4 дні
      { id: 'YB-1', code: 'L-0106-YB', productId: 'yogurt', qty: 100, locationId: 'C', producedAt: '2026-06-01', expiresAt: '2026-06-22' }, // спливає за 7 днів
    ],
    orders: [
      { id: 'O1', client: 'Alimentari Rossi', channel: 'WhatsApp', lines: [{ productId: 'mozzarella', qty: 50 }, { productId: 'montasio', qty: 5 }], due: '2026-06-17', status: 'nuovo' },
      { id: 'O2', client: 'Bar Centrale', channel: 'Telefono', lines: [{ productId: 'mozzarella', qty: 10 }], due: '2026-06-16', status: 'in_preparazione' },
      // Поза горизонтом 7 днів
      { id: 'O3', client: 'Mensa scolastica', channel: 'Email', lines: [{ productId: 'yogurt', qty: 500 }], due: '2026-06-30', status: 'nuovo' },
      // Уже відвантажене — не враховується
      { id: 'O4', client: 'Supermercato Bassi', channel: 'Email', lines: [{ productId: 'montasio', qty: 100 }], due: '2026-06-16', status: 'spedito' },
      { id: 'O5', client: 'Agriturismo Il Colle', channel: 'Telefono', lines: [{ productId: 'montasio', qty: 35 }, { productId: 'mozzarella', qty: 25 }], due: '2026-06-18', status: 'in_preparazione' },
    ],
    log: [],
  }
}
