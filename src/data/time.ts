// Дата й час за Італією (Europe/Rome), незалежно від часового поясу пристрою.
//
// Навіщо: журнал HACCP, дата виробництва партії й «сьогодні» на дашборді
// мають збігатися з годинником у цеху. Телефон чи сервер (Apps Script,
// AI-агент) можуть жити в іншому поясі — тому пояс задаємо явно.

export const TIME_ZONE = 'Europe/Rome'

const romeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Момент `now` → «РРРР-ММ-ДДTгг:хх» за часом Риму. */
export function romeDateTime(now: Date): string {
  const p = Object.fromEntries(romeParts.formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Момент `now` → календарний день у Римі, «РРРР-ММ-ДД». */
export function romeDate(now: Date): string {
  return romeDateTime(now).slice(0, 10)
}
