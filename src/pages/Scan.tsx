// Сканер у телефоні (2b.4): QR коробки чи стелажа → що це і що з ним зробити.
// Сюди ж веде QR з етикетки, відкритий звичайною камерою (`#/scan?collo=…`).
// Зміни — лише через dispatch: без інтернету вони чекають в офлайн-черзі.

import { useCallback, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseQr, type ScanTarget } from '../data/labels'
import { fmtDate, fmtNum, manualSearch, resolveScan, type BoxLabel } from '../data/selectors'
import { useStore } from '../data/useStore'
import QrCamera from './QrCamera'

function qty(l: BoxLabel): string {
  return `${fmtNum(l.box.qty, Number.isInteger(l.box.qty) ? 0 : 1)} ${l.product.unit}`
}

/**
 * Великий рядок-кнопка коробки (зручно в рукавичках): у списку стелажа й у
 * ручному пошуку. Зверху — продукт і кількість, нижче — collo i/N і стелаж,
 * ще нижче — термін і лот (список уже відсортований за FEFO).
 */
function BoxButton({ label, onPick }: { label: BoxLabel; onPick: () => void }) {
  const { lot } = label
  return (
    <button type="button" className="scan-item big" onClick={onPick}>
      <span className="scan-item-top">
        <strong>{label.product.name}</strong>
        <span className="mono">{qty(label)}</span>
      </span>
      <span>
        Collo {label.index}/{label.count} · {label.location?.name ?? '—'}
      </span>
      <span className="muted mono" style={{ fontSize: 14 }}>
        {lot.expiresAt ? `scad. ${fmtDate(lot.expiresAt)}` : `prod. ${fmtDate(lot.producedAt)}`} · {lot.code}
      </span>
    </button>
  )
}

export default function Scan() {
  const { state, dispatch } = useStore()
  const [params, setParams] = useSearchParams()
  const [camera, setCamera] = useState(false)
  const [query, setQuery] = useState('')
  const [moving, setMoving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Що зараз відкрито — у посиланні: так працює і QR з камери телефона, і «назад».
  const target: ScanTarget | null = params.get('collo')
    ? { kind: 'collo', id: params.get('collo')! }
    : params.get('pos')
      ? { kind: 'posizione', id: params.get('pos')! }
      : null
  const result = target ? resolveScan(state, target) : null
  const show = useCallback(
    (t: ScanTarget) => setParams(t.kind === 'collo' ? { collo: t.id } : { pos: t.id }, { replace: true }),
    [setParams],
  )

  const movingFrom = state.boxes.find((b) => b.id === moving)?.locationId

  const moveTo = (locationId: string) => {
    const to = state.locations.find((l) => l.id === locationId)
    if (!moving || !to) return
    if (to.id === movingFrom) return setMessage(`Il collo è già in ${to.name}`)
    dispatch({ type: 'moveBox', boxId: moving, locationId: to.id })
    setMessage(`Collo spostato in ${to.name}`)
    setMoving(null)
    show({ kind: 'collo', id: moving })
  }

  const onTarget = (t: ScanTarget) => {
    setQuery('')
    // Чекаємо стелаж для переміщення — скан стелажа завершує переміщення.
    if (moving && t.kind === 'posizione') return moveTo(t.id)
    // Відкрили іншу коробку — незавершене переміщення попередньої скасовуємо.
    if (moving && t.id !== moving) setMoving(null)
    setMessage(null)
    show(t)
  }

  const onCode = (text: string) => {
    const t = parseQr(text)
    if (!t) return setMessage('Codice non riconosciuto: non è un’etichetta SkladAI')
    onTarget(t)
  }

  const found = manualSearch(state, query)
  const places = state.locations.filter((l) => l.kind !== 'machine')

  return (
    <main className="phone-page">
      <h1 style={{ fontSize: 24 }}>Scansiona</h1>

      <button type="button" className={`btn ${camera ? '' : 'primary'}`} onClick={() => setCamera((on) => !on)}>
        {camera ? 'Ferma la fotocamera' : 'Avvia la fotocamera'}
      </button>
      {camera && <QrCamera onCode={onCode} />}

      {message && <div className="chip info" role="status" style={{ whiteSpace: 'normal', padding: '10px 14px', fontSize: 15 }}>{message}</div>}

      {moving && (
        <section className="card" aria-label="Sposta collo">
          <strong>Dove lo metti? Scansiona lo scaffale oppure sceglilo:</strong>
          <div className="field">
            <label htmlFor="scan-move">Scaffale</label>
            <select id="scan-move" value="" onChange={(e) => e.target.value && moveTo(e.target.value)}>
              <option value="">Scegli…</option>
              {places.filter((p) => p.id !== movingFrom).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={() => setMoving(null)}>Annulla</button>
        </section>
      )}

      {target && !result && (
        <section className="card">
          <strong>{target.kind === 'collo' ? 'Collo non trovato' : 'Scaffale non trovato'}</strong>
          <span className="muted">
            {target.kind === 'collo' ? 'Forse è già vuoto o spedito. ' : ''}Codice: <span className="mono">{target.id}</span>
          </span>
        </section>
      )}

      {result?.kind === 'collo' && (
        <section className="card" aria-label="Collo">
          <div className="muted" style={{ fontSize: 13 }}>Collo {result.label.index}/{result.label.count}</div>
          <h2 style={{ fontSize: 22 }}>{result.label.product.name}</h2>
          <div className="summary-grid">
            <span>Quantità</span><span>{qty(result.label)}</span>
            <span>Lotto</span><span>{result.label.lot.code}</span>
            <span>{result.label.lot.expiresAt ? 'Scadenza' : 'Prodotto il'}</span>
            <span>{fmtDate(result.label.lot.expiresAt ?? result.label.lot.producedAt)}</span>
            <span>Posizione</span><span>{result.label.location?.name ?? '—'}</span>
          </div>
          {!moving && (
            <button type="button" className="btn primary" onClick={() => { setMoving(result.label.box.id); setMessage(null) }}>
              Sposta su un altro scaffale
            </button>
          )}
          {!moving && (
            <Link className="btn" to={`/uscita?collo=${encodeURIComponent(result.label.box.id)}`}>
              Uscita (Ordine / Spaccio / Scarto)
            </Link>
          )}
        </section>
      )}

      {result?.kind === 'posizione' && (
        <section className="card" aria-label="Scaffale">
          <h2 style={{ fontSize: 22 }}>{result.location.name}</h2>
          <div className="muted">{result.boxes.length ? `${result.boxes.length} colli` : 'Vuoto'}</div>
          {result.boxes.map((l) => (
            <BoxButton key={l.box.id} label={l} onPick={() => onTarget({ kind: 'collo', id: l.box.id })} />
          ))}
        </section>
      )}

      <section className="card" aria-label="Inserimento manuale">
        <div className="field">
          <label htmlFor="scan-manual">Il QR non si legge? Scrivi il lotto o lo scaffale</label>
          <input
            id="scan-manual"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="es. 2310-MZ o A3"
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        {found.places.map((p) => (
          <button key={p.id} type="button" className="scan-item" onClick={() => onTarget({ kind: 'posizione', id: p.id })}>
            <strong>{p.name}</strong>
            <span className="muted" style={{ fontSize: 14 }}>{moving ? 'Sposta qui il collo' : 'Apri lo scaffale'}</span>
          </button>
        ))}
        {found.boxes.map((l) => (
          <BoxButton key={l.box.id} label={l} onPick={() => onTarget({ kind: 'collo', id: l.box.id })} />
        ))}
        {found.more > 0 && (
          <div className="muted">Altri {found.more} colli: scrivi di più o apri lo scaffale per vederli tutti.</div>
        )}
        {query.trim() && !found.boxes.length && !found.places.length && <div className="muted">Nessun risultato</div>}
      </section>
    </main>
  )
}
