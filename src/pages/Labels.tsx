// Друк етикеток з QR для коробок і стелажів (2b.3). Сторінка лише показує
// дані (boxLabels) і друкує їх через вікно друку браузера — без dispatch.

import { useMemo, useState, type CSSProperties } from 'react'
import { appBaseUrl, qrModules, qrPath, qrPayload, type ScanTarget } from '../data/labels'
import { boxLabels, fmtNum, type BoxLabel } from '../data/selectors'
import { useStore } from '../data/useStore'
import type { Location } from '../data/types'

type FormatId = 'a4' | 't62' | 't100'

/** Формати друку: розмір однієї етикетки (мм) і сторінки для @page. */
const FORMATS: Record<FormatId, { name: string; page: string; w: number; h: number; sheet: boolean }> = {
  a4: { name: 'Foglio A4 · 3×8 (70×37 mm)', page: 'A4', w: 70, h: 37, sheet: true },
  t62: { name: 'Stampante termica 62×40 mm', page: '62mm 40mm', w: 62, h: 40, sheet: false },
  t100: { name: 'Stampante termica 100×50 mm', page: '100mm 50mm', w: 100, h: 50, sheet: false },
}

/** «РРРР-ММ-ДД» → «ДД/ММ/РРРР» (на етикетці — повна дата). */
function fullDate(iso: string): string {
  return iso.split('-').reverse().join('/')
}

function Qr({ text, size }: { text: string; size: string }) {
  const modules = useMemo(() => qrModules(text), [text])
  const n = modules.length
  // Біла рамка в 4 модулі навколо — без неї телефон гірше читає QR.
  return (
    // Розмір — через style: атрибут width не розуміє calc().
    <svg viewBox={`-4 -4 ${n + 8} ${n + 8}`} style={{ width: size, height: size }} shapeRendering="crispEdges" role="img" aria-label="Codice QR">
      <rect x={-4} y={-4} width={n + 8} height={n + 8} fill="#fff" />
      <path d={qrPath(modules)} fill="#000" />
    </svg>
  )
}

function BoxLabelView({ label, base }: { label: BoxLabel; base: string }) {
  const { box, lot, product, location, index, count } = label
  const target: ScanTarget = { kind: 'collo', id: box.id }
  return (
    <div className="label">
      <Qr text={qrPayload(base, target)} size="calc(var(--h) - 4mm)" />
      <div className="label-text">
        <strong className="label-title">{product.name}</strong>
        <span className="mono">Lotto {lot.code}</span>
        <span className="label-qty mono">{fmtNum(box.qty, Number.isInteger(box.qty) ? 0 : 1)} {product.unit}</span>
        <span>{lot.expiresAt ? `Scad. ${fullDate(lot.expiresAt)}` : `Prod. ${fullDate(lot.producedAt)}`}</span>
        <span className="label-small">Collo {index}/{count}{location ? ` · ${location.name}` : ''}</span>
      </div>
    </div>
  )
}

function PlaceLabelView({ place, zone, base }: { place: Location; zone: string; base: string }) {
  return (
    <div className="label">
      <Qr text={qrPayload(base, { kind: 'posizione', id: place.id })} size="calc(var(--h) - 4mm)" />
      <div className="label-text">
        <strong className="label-title label-place">{place.name}</strong>
        <span>{zone}</span>
        <span className="label-small mono">{place.id}</span>
      </div>
    </div>
  )
}

export default function Labels() {
  const { state } = useStore()
  const [kind, setKind] = useState<'colli' | 'scaffali'>('colli')
  const [format, setFormat] = useState<FormatId>('a4')
  const [place, setPlace] = useState('tutte')
  // Зняті галочки: нові коробки (і зміна фільтра) за замовчуванням вибрані.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const base = appBaseUrl(window.location)
  const f = FORMATS[format]

  const places = state.locations.filter((l) => l.kind !== 'machine')
  const zoneName = (id: string) => state.zones.find((z) => z.id === id)?.name ?? ''
  const boxes = boxLabels(state).filter((l) => place === 'tutte' || l.box.locationId === place)
  const ids = kind === 'colli' ? boxes.map((l) => l.box.id) : places.map((p) => p.id)
  const chosen = ids.filter((id) => !excluded.has(id))

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const setAll = (on: boolean) => setExcluded(on ? new Set() : new Set(ids))

  return (
    <main className="page">
      {/* Розмір сторінки для друку — лише поки відкрита ця сторінка. */}
      <style>{`@page { size: ${f.page}; margin: 0; }`}</style>

      <div className="page-head no-print">
        <div>
          <h1>Etichette QR</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Stampa le etichette dei colli e degli scaffali. Il QR si legge con la fotocamera del telefono.
          </div>
        </div>
      </div>

      <section className="card no-print">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="seg" role="group" aria-label="Tipo di etichetta">
            <button type="button" aria-pressed={kind === 'colli'} onClick={() => setKind('colli')}>Colli</button>
            <button type="button" aria-pressed={kind === 'scaffali'} onClick={() => setKind('scaffali')}>Scaffali</button>
          </div>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="lbl-format">Formato</label>
            <select id="lbl-format" value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
              {Object.entries(FORMATS).map(([id, fmt]) => (
                <option key={id} value={id}>{fmt.name}</option>
              ))}
            </select>
          </div>
          {kind === 'colli' && (
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="lbl-place">Posizione</label>
              <select id="lbl-place" value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="tutte">Tutte</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn primary" disabled={!chosen.length} onClick={() => window.print()}>
            Stampa {chosen.length} {chosen.length === 1 ? 'etichetta' : 'etichette'}
          </button>
          <button type="button" className="btn" onClick={() => setAll(true)}>Seleziona tutte</button>
          <button type="button" className="btn" onClick={() => setAll(false)}>Nessuna</button>
        </div>

        <div className="label-picks">
          {kind === 'colli'
            ? boxes.map((l) => (
                <label key={l.box.id} className="label-pick">
                  <input type="checkbox" checked={!excluded.has(l.box.id)} onChange={() => toggle(l.box.id)} />
                  <span>
                    {l.product.name} · {fmtNum(l.box.qty, Number.isInteger(l.box.qty) ? 0 : 1)} {l.product.unit}
                    <span className="muted mono" style={{ fontSize: 13 }}> {l.lot.code} · {l.index}/{l.count}</span>
                  </span>
                </label>
              ))
            : places.map((p) => (
                <label key={p.id} className="label-pick">
                  <input type="checkbox" checked={!excluded.has(p.id)} onChange={() => toggle(p.id)} />
                  <span>{p.name} <span className="muted" style={{ fontSize: 13 }}>{zoneName(p.zoneId)}</span></span>
                </label>
              ))}
          {kind === 'colli' && boxes.length === 0 && <div className="muted">Nessun collo in questa posizione.</div>}
        </div>
      </section>

      <h2 className="no-print" style={{ fontSize: 18 }}>Anteprima</h2>
      <div
        className={`label-sheet ${f.sheet ? 'a4' : 'thermal'}`}
        style={{ '--w': `${f.w}mm`, '--h': `${f.h}mm` } as CSSProperties}
      >
        {kind === 'colli'
          ? boxes.filter((l) => !excluded.has(l.box.id)).map((l) => <BoxLabelView key={l.box.id} label={l} base={base} />)
          : places.filter((p) => !excluded.has(p.id)).map((p) => <PlaceLabelView key={p.id} place={p} zone={zoneName(p.zoneId)} base={base} />)}
      </div>
    </main>
  )
}
