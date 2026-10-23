import { Link } from 'react-router-dom'
import { morningBrief } from '../data/brief'
import {
  agingSummary,
  daysUntil,
  expiringLots,
  fmtDate,
  fmtNum,
  locationMap,
  openOrders,
  orderCoverage,
  productMap,
  productionPlan,
  stockValue,
} from '../data/selectors'
import { useStore } from '../data/useStore'

function dueChip(iso: string | null, todo: number, today: Date) {
  if (todo <= 0) return <span className="chip ok">Coperto</span>
  if (!iso) return <span className="chip info">—</span>
  const d = daysUntil(iso, today)
  const cls = d <= 2 ? 'bad' : d <= 4 ? 'warn' : 'info'
  return <span className={`chip ${cls}`}>entro {fmtDate(iso)}</span>
}

export default function Dashboard() {
  const { state, today } = useStore()
  const pm = productMap(state)
  const lm = locationMap(state)
  const plan = productionPlan(state, today)
  const expiring = expiringLots(state, today, 7)
  const orders = openOrders(state, today, 14)
  const aging = agingSummary(state, today)
  const agingTotal = aging.fresco + aging.mezzano + aging.stagionato
  const brief = morningBrief(state, today)
  const todayLabel = today.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Buongiorno. Ecco la situazione di oggi.</h1>
          <div className="muted" style={{ marginTop: 4, textTransform: 'capitalize' }}>{todayLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/ordini" className="btn">Ordini</Link>
          <Link to="/registra" className="btn primary">Registra produzione</Link>
        </div>
      </div>

      <section className="kpis" aria-label="Indicatori">
        <div className="card">
          <div className="kpi-label">Valore magazzino</div>
          <div className="kpi-value">€ {fmtNum(stockValue(state))}</div>
          <div className="muted" style={{ fontSize: 13 }}>a prezzo di vendita</div>
        </div>
        <div className="card">
          <div className="kpi-label">Lotti in scadenza (7 giorni)</div>
          <div className="kpi-value">{expiring.length}</div>
          <div style={{ fontSize: 13, color: 'var(--warn-fg)', fontWeight: 600 }}>
            {expiringLots(state, today, 3).length} entro 3 giorni
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Ordini aperti</div>
          <div className="kpi-value">{orders.length}</div>
          <div className="muted" style={{ fontSize: 13 }}>prossimi 14 giorni</div>
        </div>
        <div className="card">
          <div className="kpi-label">Forme in stagionatura</div>
          <div className="kpi-value">{fmtNum(agingTotal)}</div>
          <div className="muted" style={{ fontSize: 13 }}>Montasio DOP</div>
        </div>
      </section>

      <div className="row">
        <section className="card wide" aria-labelledby="h-plan">
          <div className="card-head">
            <h2 id="h-plan">Da produrre questa settimana</h2>
            <span className="muted" style={{ fontSize: 14 }}>Ordini a 7 giorni meno magazzino</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Prodotto</th>
                  <th scope="col" className="num">Ordinato</th>
                  <th scope="col" className="num">In magazzino</th>
                  <th scope="col" className="num">Da produrre</th>
                  <th scope="col">Quando</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((r) => (
                  <tr key={r.product.id}>
                    <td style={{ fontWeight: 500 }}>{r.product.name}</td>
                    <td className="num">{fmtNum(r.ordered)} {r.product.unit}</td>
                    <td className="num">{fmtNum(r.stock)} {r.product.unit}</td>
                    <td className="num">{r.todo > 0 ? `${fmtNum(r.todo)} ${r.product.unit}` : '0'}</td>
                    <td>{dueChip(r.firstDue, r.todo, today)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card dark side" aria-labelledby="h-brief">
          <h2 id="h-brief">Assistente · brief del mattino</h2>
          <ul className="brief">
            {brief.map((b, i) => (
              <li key={i}>
                <span className={`dot ${b.level}`} aria-hidden="true" />
                <span>
                  {b.text}{' '}
                  {b.locationId && (
                    <Link to={`/magazzino?sel=${b.locationId}`} style={{ color: 'var(--mint)' }}>
                      Vedi in 3D
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div style={{ fontSize: 12, color: '#a9b5ae', borderTop: '1px solid #36423b', paddingTop: 10 }}>
            Brief calcolato dai dati in tempo reale. Prossimo passo: domande libere con Claude.
          </div>
        </section>
      </div>

      <div className="row">
        <section className="card side" aria-labelledby="h-aging" style={{ flexBasis: 480 }}>
          <div className="card-head">
            <h2 id="h-aging">Stagionatura Montasio</h2>
            <Link to="/magazzino" style={{ fontSize: 14 }}>Apri mappa 3D</Link>
          </div>
          {(['fresco', 'mezzano', 'stagionato'] as const).map((k) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{k}</span>
                <span className="mono">{fmtNum(aging[k])} forme</span>
              </div>
              <div className="bar">
                <div style={{ width: `${agingTotal ? (aging[k] / agingTotal) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </section>

        <section className="card side" aria-labelledby="h-exp">
          <div className="card-head">
            <h2 id="h-exp">Lotti in scadenza</h2>
          </div>
          {expiring.length === 0 && <div className="muted">Nessun lotto in scadenza nei prossimi 7 giorni.</div>}
          <div>
            {expiring.map((l) => {
              const d = daysUntil(l.expiresAt!, today)
              const cls = d <= 3 ? 'bad' : 'warn'
              return (
                <div className="list-row" key={l.id}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>
                      {pm[l.productId].name} · {fmtNum(l.qty)} {pm[l.productId].unit}
                    </div>
                    <div className="mono muted" style={{ fontSize: 13 }}>
                      {l.code} · {lm[l.locationId]?.name}
                    </div>
                  </div>
                  <span className={`chip ${cls}`}>{d <= 0 ? 'oggi' : `${d} gg`}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="card side" aria-labelledby="h-orders">
          <div className="card-head">
            <h2 id="h-orders">Prossime consegne</h2>
            <Link to="/ordini" style={{ fontSize: 14 }}>Tutti</Link>
          </div>
          <div>
            {orders.slice(0, 5).map((o) => {
              const covered = orderCoverage(state, o.id)
              return (
                <div className="list-row" key={o.id}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{o.client}</div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {o.lines.map((ln) => `${pm[ln.productId].name} ${ln.qty}`).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className="mono" style={{ fontSize: 13 }}>{fmtDate(o.due)}</span>
                    <span className={`chip ${covered ? 'ok' : 'bad'}`}>{covered ? 'Merce pronta' : 'Manca prodotto'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="h-log">
        <div className="card-head">
          <h2 id="h-log">Registro attività e HACCP</h2>
          <span className="muted" style={{ fontSize: 14 }}>Ogni movimento viene registrato automaticamente</span>
        </div>
        <div>
          {[...state.log].reverse().slice(0, 6).map((e, i) => (
            <div className="list-row" key={i}>
              <span>{e.text}</span>
              <span className="mono muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{e.at.replace('T', ' ')}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
