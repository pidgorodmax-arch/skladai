// Rimanenze (2c.2–2c.3): залишок кожного продукту, вилучене сьогодні й за
// 7 днів окремо в Ordine / Spaccio / Scarto і попередження про scorta minima.
// Сторінка лише показує дані (селектор rimanenze).

import { Link } from 'react-router-dom'
import { DEST_LABEL, DESTINAZIONI, fmtNum, rimanenze, type PerDest } from '../data/selectors'
import { useStore } from '../data/useStore'

const num = (n: number) => fmtNum(n, Number.isInteger(n) ? 0 : 1)

function Row({ label, values }: { label: string; values: PerDest }) {
  return (
    <tr>
      <th scope="row" style={{ color: 'var(--ink-2)' }}>{label}</th>
      {DESTINAZIONI.map((d) => (
        <td key={d} className="num">{values[d] ? num(values[d]) : '—'}</td>
      ))}
    </tr>
  )
}

export default function Rimanenze() {
  const { state, today } = useStore()
  const rows = rimanenze(state, today)
  const below = rows.filter((r) => r.below).length

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Rimanenze</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Quanto c'è in magazzino e quanto è uscito oggi e negli ultimi 7 giorni.
            {below > 0 && ` ${below} ${below === 1 ? 'prodotto è' : 'prodotti sono'} sotto la scorta minima.`}
          </div>
        </div>
        <Link to="/uscita" className="btn primary">Uscita rapida</Link>
      </div>

      <div className="rim-grid">
        {rows.map((r) => (
          <section key={r.product.id} className="card" aria-label={r.product.name}>
            <div className="card-head">
              <h2>{r.product.name}</h2>
              <span className="kpi-value" style={{ fontSize: 24 }}>{num(r.stock)} {r.product.unit}</span>
            </div>
            {r.minStock != null && (
              r.below
                ? <span className="chip bad" style={{ alignSelf: 'flex-start' }}>Sotto scorta · minimo {num(r.minStock)} {r.product.unit}</span>
                : <span className="muted" style={{ fontSize: 14 }}>Scorta minima {num(r.minStock)} {r.product.unit}</span>
            )}
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Uscite ({r.product.unit})</th>
                  {DESTINAZIONI.map((d) => <th key={d} className="num">{DEST_LABEL[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                <Row label="Oggi" values={r.oggi} />
                <Row label="7 giorni" values={r.settimana} />
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </main>
  )
}
