import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { expiryFor, isoDay, lotCode } from '../data/seed'
import { fmtDate, fmtNum, occupancy, productionPlan } from '../data/selectors'
import { useStore } from '../data/store'
import type { AppState } from '../data/types'

/** Пропонує місце: туди, де вже лежить цей продукт і є найбільше вільного місця. */
function suggestPlace(state: AppState, productId: string): string {
  const product = state.products.find((p) => p.id === productId)!
  const places = state.locations.filter((l) => l.kind === product.storage)
  const withProduct = places.filter((l) => state.lots.some((x) => x.locationId === l.id && x.productId === productId))
  const pool = withProduct.length ? withProduct : places
  return [...pool].sort((a, b) => occupancy(state, a) - occupancy(state, b))[0]?.id ?? ''
}

export default function Register() {
  const { state, dispatch } = useStore()
  const [productId, setProductId] = useState('mozzarella')
  const [qty, setQty] = useState('48')
  const [milk, setMilk] = useState('490')
  const product = state.products.find((p) => p.id === productId)!
  const places = state.locations.filter((l) => l.kind === product.storage)
  const [locationId, setLocationId] = useState(() => suggestPlace(state, productId))
  const [saved, setSaved] = useState<{ lot: string; loc: string } | null>(null)

  const loc = places.find((p) => p.id === locationId) ?? places[0]
  const qtyNum = Number(qty.replace(',', '.')) || 0
  const milkNum = Number(milk.replace(',', '.')) || 0
  const producedAt = isoDay(0)
  const nextLot = lotCode(product.id, producedAt, state.lots.map((l) => l.id))
  const expiry = expiryFor(product, producedAt)
  const yieldPct = product.unit === 'kg' && milkNum > 0 ? (qtyNum / milkNum) * 100 : null
  const planRow = productionPlan(state).find((r) => r.product.id === product.id)
  const remaining = planRow ? Math.max(0, planRow.todo - qtyNum) : null
  const spaceAfter = loc ? Math.round(((occupancy(state, loc) / 100) * loc.capacity + qtyNum * product.spacePerUnit) / loc.capacity * 100) : 0

  function changeProduct(id: string) {
    setProductId(id)
    setLocationId(suggestPlace(state, id))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!loc || qtyNum <= 0) return
    dispatch({ type: 'register', productId, qty: qtyNum, locationId: loc.id, milkLitres: milkNum || undefined })
    setSaved({ lot: nextLot, loc: loc.id })
    setQty('')
    setMilk('')
  }

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(null), 8000)
    return () => clearTimeout(t)
  }, [saved])

  return (
    <main className="phone-page">
      <div>
        <div className="muted" style={{ fontSize: 13 }}>Reparto produzione · da telefono</div>
        <h1 style={{ fontSize: 24 }}>Registra produzione</h1>
      </div>

      {planRow && planRow.todo > 0 && (
        <div className="card dark" style={{ gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--mint)', fontWeight: 600 }}>Assistente</div>
          <div>
            {product.name}: da produrre {fmtNum(planRow.todo)} {product.unit}
            {planRow.firstDue ? ` entro ${fmtDate(planRow.firstDue)}` : ''}.
            {remaining != null && qtyNum > 0 && ` Con questa cotta ne restano ${fmtNum(remaining)}.`}
          </div>
        </div>
      )}

      <form className="card" onSubmit={submit} style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="r-prod">Prodotto</label>
          <select id="r-prod" value={productId} onChange={(e) => changeProduct(e.target.value)}>
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <div className="field">
            <label htmlFor="r-qty">Quantità ({product.unit})</label>
            <input id="r-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="mono" />
          </div>
          <div className="field">
            <label htmlFor="r-milk">Latte usato (L)</label>
            <input id="r-milk" inputMode="decimal" value={milk} onChange={(e) => setMilk(e.target.value)} className="mono" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="r-loc">Dove lo metto</label>
          <select id="r-loc" value={loc?.id} onChange={(e) => setLocationId(e.target.value)}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {occupancy(state, p)}% occupato
              </option>
            ))}
          </select>
        </div>

        <div className="summary-grid">
          <span className="muted">Lotto</span><span>{nextLot}</span>
          <span className="muted">Scadenza</span><span>{expiry ? fmtDate(expiry) : 'stagionatura'}</span>
          <span className="muted">Resa</span><span>{yieldPct != null ? `${fmtNum(yieldPct, 1)} %` : '—'}</span>
          <span className="muted">Occupazione dopo</span>
          <span style={{ color: spaceAfter > 100 ? 'var(--bad-fg)' : undefined }}>{Math.min(spaceAfter, 999)}%</span>
        </div>
        {spaceAfter > 100 && (
          <div className="chip bad" style={{ whiteSpace: 'normal' }}>Non c'è abbastanza spazio: scegli un altro ripiano.</div>
        )}

        <button type="submit" className="btn primary" style={{ minHeight: 52, fontSize: 16 }} disabled={qtyNum <= 0 || spaceAfter > 100}>
          Salva lotto
        </button>
      </form>

      {saved && (
        <div className="toast" role="status">
          <span>Lotto {saved.lot} salvato</span>
          <Link to={`/magazzino?sel=${saved.loc}`}>Vedi in 3D</Link>
          <Link to="/">Cruscotto</Link>
        </div>
      )}
    </main>
  )
}
