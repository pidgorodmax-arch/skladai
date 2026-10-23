// Тести часу за Римом. Тести працюють у поясі UTC (vite.config.ts), тож
// збіг із римським часом доводить, що пояс пристрою не впливає.

import { describe, expect, it } from 'vitest'
import { romeDate, romeDateTime } from './time'

describe('час за Римом', () => {
  it('пристрій справді не в Римі (інакше тести нічого не доводять)', () => {
    expect(new Date('2026-06-15T22:30:00Z').getHours()).toBe(22)
  })

  it('влітку Рим = UTC+2', () => {
    expect(romeDateTime(new Date('2026-06-15T12:00:00Z'))).toBe('2026-06-15T14:00')
  })

  it('взимку Рим = UTC+1', () => {
    expect(romeDateTime(new Date('2026-01-15T12:00:00Z'))).toBe('2026-01-15T13:00')
  })

  it('після півночі в Римі — уже новий день, хоча за UTC ще вчора', () => {
    expect(romeDateTime(new Date('2026-06-15T22:30:00Z'))).toBe('2026-06-16T00:30')
    expect(romeDate(new Date('2026-06-15T22:30:00Z'))).toBe('2026-06-16')
    expect(romeDate(new Date('2026-12-31T23:10:00Z'))).toBe('2027-01-01')
  })

  it('перехід на літній час (29.03.2026, 02:00 → 03:00)', () => {
    expect(romeDateTime(new Date('2026-03-29T00:59:00Z'))).toBe('2026-03-29T01:59')
    expect(romeDateTime(new Date('2026-03-29T01:00:00Z'))).toBe('2026-03-29T03:00')
  })
})
