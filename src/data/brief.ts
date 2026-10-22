// Ранковий брифінг. Зараз — правила на чистому коді (демо без інтернету).
// Наступний крок: передавати ті самі цифри в Claude API, як у податковому
// боті, щоб агент писав брифінг сам і відповідав на питання.

import {
  daysUntil,
  expiringLots,
  fmtDate,
  fmtNum,
  occupancy,
  productMap,
  productionPlan,
} from './selectors'
import type { AppState } from './types'

export interface BriefItem {
  level: 'alert' | 'warn' | 'info'
  text: string
  locationId?: string
}

export function morningBrief(state: AppState, today: Date): BriefItem[] {
  const out: BriefItem[] = []
  const pm = productMap(state)

  for (const row of productionPlan(state, today)) {
    if (row.todo <= 0) continue
    const when = row.firstDue ? ` entro ${fmtDate(row.firstDue)}` : ''
    out.push({
      level: daysUntil(row.firstDue ?? '9999-12-31', today) <= 2 ? 'alert' : 'warn',
      text: `${row.product.name}: ordinati ${fmtNum(row.ordered)} ${row.product.unit}, in magazzino ${fmtNum(row.stock)}. Da produrre ${fmtNum(row.todo)} ${row.product.unit}${when}.`,
    })
  }

  const expiring = expiringLots(state, today, 3)
  if (expiring.length) {
    const byProduct = new Map<string, number>()
    for (const l of expiring) byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.qty)
    const parts = [...byProduct].map(([pid, q]) => `${pm[pid].name} ${fmtNum(q)} ${pm[pid].unit}`)
    out.push({
      level: 'alert',
      text: `Scadono entro 3 giorni: ${parts.join(', ')}. Proporli con le prossime consegne o in promozione.`,
      locationId: expiring[0].locationId,
    })
  }

  const racks = state.locations.filter((l) => l.kind === 'aging')
  const full = racks.filter((l) => occupancy(state, l) >= 90)
  const free = [...racks].sort((a, b) => occupancy(state, a) - occupancy(state, b))[0]
  for (const r of full) {
    out.push({
      level: 'warn',
      text: `${r.name} è al ${occupancy(state, r)}%. Spostare alcune forme su ${free.name} (${occupancy(state, free)}% occupato).`,
      locationId: r.id,
    })
  }

  const lastLog = [...state.log].reverse().find((e) => /temperatura/i.test(e.text))
  if (lastLog) out.push({ level: 'info', text: `HACCP: ${lastLog.text} Annotato nel registro.` })

  if (!out.length) out.push({ level: 'info', text: 'Nessuna urgenza oggi. Magazzino e ordini sono in equilibrio.' })
  return out
}
