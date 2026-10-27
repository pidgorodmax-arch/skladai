// Uscita rapida (2c.1): товар виходить зі складу без замовлення в SkladAI
// (замовлення ведуть у Mexal). Скан коробки або вибір продукту → кількість →
// куди: Ordine / Spaccio / Scarto. Зміна — лише через dispatch (офлайн — у черзі).

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseQr } from '../data/labels'
import { DEST_LABEL, DESTINAZIONI, boxLabels, fefoBoxesOf, fefoHint, fmtDate, fmtNum, productMap } from '../data/selectors'
import { useStore } from '../data/useStore'
import type { Destinazione } from '../data/types'
import QrCamera from './QrCamera'

const num = (n: number) => fmtNum(n, Number.isInteger(n) ? 0 : 1)

export default function Uscita() {
  const { state, dispatch } = useStore()
  const [params, setParams] = useSearchParams()
  const [camera, setCamera] = useState(false)
  const [qty, setQty] = useState('')
  const [dest, setDest] = useState<Destinazione | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const pm = productMap(state)

  // Звідки беремо — у посиланні: сюди веде й кнопка «Uscita» з картки сканера.
  const boxId = params.get('collo')
  const productId = params.get('prodotto')
  const label = boxId ? boxLabels(state).find((l) => l.box.id === boxId) : undefined
  const product = label?.product ?? (productId ? pm[productId] : undefined)
  const fefo = product && !label ? fefoBoxesOf(state, product.id) : []
  const available = label ? label.box.qty : fefo.reduce((s, b) => s + b.qty, 0)
  const firstOut = fefo[0] && boxLabels(state).find((l) => l.box.id === fefo[0].id)
  const hint = label ? fefoHint(state, label.box.id) : null

  const qtyNum = Number(qty.replace(',', '.'))
  const tooMuch = qtyNum > available
  const ready = Boolean(product) && qtyNum > 0 && !tooMuch && dest !== null

  const onCode = (text: string) => {
    const t = parseQr(text)
    if (!t) return setMessage('Codice non riconosciuto: non è un’etichetta SkladAI')
    if (t.kind !== 'collo') return setMessage('Questo è uno scaffale: inquadra l’etichetta del collo')
    setMessage(null)
    setParams({ collo: t.id }, { replace: true })
  }

  const confirm = () => {
    if (!ready || !product || !dest) return
    dispatch(label ? { type: 'uscita', boxId: label.box.id, qty: qtyNum, dest } : { type: 'uscita', productId: product.id, qty: qtyNum, dest })
    setMessage(`Registrato: ${num(qtyNum)} ${product.unit} ${product.name} → ${DEST_LABEL[dest]}`)
    setQty('')
    setDest(null)
    setParams({}, { replace: true })
  }

  return (
    <main className="phone-page">
      <h1 style={{ fontSize: 24 }}>Uscita rapida</h1>

      {message && <div className="chip info" role="status" style={{ whiteSpace: 'normal', padding: '10px 14px', fontSize: 15 }}>{message}</div>}

      <section className="card" aria-label="Cosa esce">
        <button type="button" className={`btn ${camera ? '' : 'primary'}`} onClick={() => setCamera((on) => !on)}>
          {camera ? 'Ferma la fotocamera' : 'Scansiona il collo'}
        </button>
        {camera && <QrCamera onCode={onCode} />}
        <div className="field">
          <label htmlFor="usc-prodotto">Oppure scegli il prodotto (si prende prima ciò che scade prima)</label>
          <select
            id="usc-prodotto"
            value={label ? '' : productId ?? ''}
            onChange={(e) => setParams(e.target.value ? { prodotto: e.target.value } : {}, { replace: true })}
          >
            <option value="">Scegli…</option>
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </section>

      {boxId && !label && (
        <section className="card">
          <strong>Collo non trovato</strong>
          <span className="muted">Forse è già vuoto. Codice: <span className="mono">{boxId}</span></span>
        </section>
      )}

      {label && (
        <section className="card" aria-label="Collo">
          <div className="muted" style={{ fontSize: 13 }}>Collo {label.index}/{label.count} · {label.location?.name ?? '—'}</div>
          <div className="scan-item-top">
            <strong>{label.product.name}</strong>
            <span className="mono">{num(label.box.qty)} {label.product.unit}</span>
          </div>
          <span className="muted mono">
            Lotto {label.lot.code} · {label.lot.expiresAt ? `scad. ${fmtDate(label.lot.expiresAt)}` : `prod. ${fmtDate(label.lot.producedAt)}`}
          </span>
          {hint && (
            <div className="chip warn" role="status" style={{ whiteSpace: 'normal', padding: '10px 14px', fontSize: 15 }}>
              C'è un collo che scade prima: lotto {hint.lot.code}
              {hint.lot.expiresAt ? ` (scad. ${fmtDate(hint.lot.expiresAt)})` : ''} su {hint.location?.name ?? '—'}.
              <button type="button" className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => setParams({ collo: hint.box.id }, { replace: true })}>
                Usa quello
              </button>
            </div>
          )}
        </section>
      )}

      {product && !label && (
        <section className="card" aria-label="Prodotto">
          <div className="scan-item-top">
            <strong>{product.name}</strong>
            <span className="mono">{num(available)} {product.unit}</span>
          </div>
          <span className="muted">
            {firstOut
              ? `Prima esce il lotto ${firstOut.lot.code}${firstOut.lot.expiresAt ? ` (scad. ${fmtDate(firstOut.lot.expiresAt)})` : ''} da ${firstOut.location?.name ?? '—'}`
              : 'Niente in magazzino'}
          </span>
        </section>
      )}

      {product && available > 0 && (
        <section className="card" aria-label="Quantità e destinazione">
          <div className="field">
            <label htmlFor="usc-qty">Quantità ({product.unit})</label>
            <input id="usc-qty" className="mono" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          {tooMuch && <div className="chip bad" role="alert" style={{ whiteSpace: 'normal' }}>Ci sono solo {num(available)} {product.unit}</div>}
          <div className="dest-row" role="group" aria-label="Destinazione">
            {DESTINAZIONI.map((d) => (
              <button key={d} type="button" className="dest-btn" aria-pressed={dest === d} onClick={() => setDest(d)}>
                {DEST_LABEL[d]}
              </button>
            ))}
          </div>
          <button type="button" className="btn primary" style={{ minHeight: 56, fontSize: 17 }} disabled={!ready} onClick={confirm}>
            Conferma uscita
          </button>
        </section>
      )}
    </main>
  )
}
