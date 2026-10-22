import { fmtDate, fmtNum, orderCoverage, productMap } from '../data/selectors'
import { useStore } from '../data/store'
import type { OrderStatus } from '../data/types'

const STATUS_LABEL: Record<OrderStatus, string> = {
  nuovo: 'Nuovo',
  in_preparazione: 'In preparazione',
  spedito: 'Spedito',
}
const NEXT: Record<OrderStatus, OrderStatus | null> = {
  nuovo: 'in_preparazione',
  in_preparazione: 'spedito',
  spedito: null,
}
const NEXT_LABEL: Record<OrderStatus, string> = {
  nuovo: 'Inizia preparazione',
  in_preparazione: 'Segna spedito',
  spedito: '',
}

export default function Orders() {
  const { state, dispatch } = useStore()
  const pm = productMap(state)
  const orders = [...state.orders].sort((a, b) => a.due.localeCompare(b.due))

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Ordini clienti</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Quando un ordine viene spedito, il magazzino si aggiorna da solo (prima i lotti che scadono prima).
          </div>
        </div>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Prodotti</th>
                <th scope="col">Canale</th>
                <th scope="col">Consegna</th>
                <th scope="col">Stato</th>
                <th scope="col"><span className="muted">Azione</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const covered = orderCoverage(state, o.id)
                const next = NEXT[o.status]
                const chip =
                  o.status === 'spedito' ? 'ok' : covered ? 'info' : 'bad'
                return (
                  <tr key={o.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{o.client}</div>
                      <div className="mono muted" style={{ fontSize: 12 }}>{o.id}</div>
                    </td>
                    <td>{o.lines.map((ln) => `${pm[ln.productId].name} ${fmtNum(ln.qty)} ${pm[ln.productId].unit}`).join(' · ')}</td>
                    <td className="muted">{o.channel}</td>
                    <td className="mono">{fmtDate(o.due)}</td>
                    <td>
                      <span className={`chip ${chip}`}>
                        {STATUS_LABEL[o.status]}
                        {o.status !== 'spedito' && !covered ? ' · manca prodotto' : ''}
                      </span>
                    </td>
                    <td>
                      {next && (
                        <button
                          type="button"
                          className={`btn small${next === 'spedito' ? ' primary' : ''}`}
                          disabled={next === 'spedito' && !covered}
                          title={next === 'spedito' && !covered ? 'Prima va prodotta la merce mancante' : undefined}
                          onClick={() => dispatch({ type: 'orderStatus', orderId: o.id, status: next })}
                        >
                          {NEXT_LABEL[o.status]}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
