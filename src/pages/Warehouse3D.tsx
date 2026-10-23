import { Edges, Html, OrbitControls, useCursor } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Vector3 } from 'three'
import {
  ageClass,
  avgAgeDays,
  daysBetween,
  daysUntil,
  firstExpiryDays,
  fmtDate,
  fmtNum,
  lotStock,
  lotsAt,
  occupancy,
  type LotStock,
  productMap,
  usedSpace,
} from '../data/selectors'
import { useStore } from '../data/useStore'
import type { AppState, Location, Lot, Zone } from '../data/types'

type Mode = 'occ' | 'age' | 'exp'

const CENTER: [number, number, number] = [14, 0, 10]

// ---------- кольори (ті самі шкали, що й у макеті) ----------
const NEUTRAL = '#d5dbd7'
function occColor(p: number) {
  if (p >= 90) return '#b5540a'
  if (p >= 75) return '#2f8460'
  if (p >= 50) return '#7db898'
  return '#cfe6d8'
}
const AGE_COLOR = { fresco: '#cfe0f2', mezzano: '#6c9ccf', stagionato: '#1d4f8a' } as const
function expColor(days: number) {
  if (days <= 3) return '#c2410c'
  if (days <= 7) return '#f6cfa8'
  return '#e8edea'
}

const LEGENDS: Record<Mode, { title: string; items: [string, string][] }> = {
  occ: { title: 'Occupazione', items: [['#cfe6d8', 'sotto 50%'], ['#7db898', '50–75%'], ['#2f8460', '75–90%'], ['#b5540a', '90% e oltre']] },
  age: { title: 'Età delle forme', items: [[AGE_COLOR.fresco, 'fresco · fino a 5 mesi'], [AGE_COLOR.mezzano, 'mezzano · 5–10 mesi'], [AGE_COLOR.stagionato, 'stagionato · oltre 10 mesi'], [NEUTRAL, 'non applicabile']] },
  exp: { title: 'Scadenza del lotto', items: [['#c2410c', 'entro 3 giorni'], ['#f6cfa8', '4–7 giorni'], ['#e8edea', 'oltre 7 giorni'], [NEUTRAL, 'non applicabile']] },
}

/** Розкладає партії по «слотах» стелажа пропорційно до місця, яке вони займають. */
function fillSlots(state: AppState, loc: Location, slots: number): LotStock[] {
  const pm = productMap(state)
  const lots = [...lotsAt(state, loc.id)].sort((a, b) => a.producedAt.localeCompare(b.producedAt))
  const out: LotStock[] = []
  for (const lot of lots) {
    const n = Math.round(((lot.qty * (pm[lot.productId]?.spacePerUnit ?? 1)) / loc.capacity) * slots)
    for (let i = 0; i < n && out.length < slots; i++) out.push(lot)
  }
  return out
}

function slotColor(state: AppState, loc: Location, lot: Lot, mode: Mode, today: Date): string {
  if (mode === 'occ') return occColor(occupancy(state, loc))
  if (mode === 'age') return lot.productId === 'montasio' ? AGE_COLOR[ageClass(daysBetween(lot.producedAt, today))] : NEUTRAL
  return lot.expiresAt ? expColor(daysUntil(lot.expiresAt, today)) : NEUTRAL
}

// ---------- 3D-об'єкти ----------

interface ObjProps {
  loc: Location
  state: AppState
  today: Date
  mode: Mode
  selected: boolean
  dimmed: boolean
  onSelect: (id: string) => void
}

function useHover() {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  return {
    hovered,
    bind: {
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        setHovered(true)
      },
      onPointerOut: () => setHovered(false),
    },
  }
}

function Rack({ loc, state, today, mode, selected, dimmed, onSelect }: ObjProps) {
  const { hovered, bind } = useHover()
  const levels = 4
  const aging = loc.kind === 'aging'
  const perRow = aging ? 5 : 4
  const rows = 2
  const slots = levels * perRow * rows
  const filled = fillSlots(state, loc, slots)
  const levelH = loc.h / levels
  const opacity = dimmed ? 0.15 : 1
  const frame = selected ? '#17201b' : hovered ? '#3e4a43' : '#8a958f'
  const cx = loc.x + loc.w / 2
  const cz = loc.z + loc.d / 2

  const items = filled.map((lot, i) => {
    const level = Math.floor(i / (perRow * rows))
    const inLevel = i % (perRow * rows)
    const row = Math.floor(inLevel / perRow)
    const col = inLevel % perRow
    const x = -loc.w / 2 + (loc.w / perRow) * (col + 0.5)
    const z = -loc.d / 2 + (loc.d / rows) * (row + 0.5)
    const y = level * levelH + 0.06
    const color = slotColor(state, loc, lot, mode, today)
    return aging ? (
      <mesh key={i} position={[x, y + 0.09, z]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.16, 24]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.7} />
      </mesh>
    ) : (
      <mesh key={i} position={[x, y + 0.14, z]} castShadow>
        <boxGeometry args={[loc.w / perRow - 0.12, 0.28, loc.d / rows - 0.1]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.8} />
      </mesh>
    )
  })

  return (
    <group
      position={[cx, 0, cz]}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(loc.id)
      }}
      {...bind}
    >
      {/* стійки */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[(sx * loc.w) / 2, loc.h / 2, (sz * loc.d) / 2]}>
            <boxGeometry args={[0.06, loc.h, 0.06]} />
            <meshStandardMaterial color={frame} transparent opacity={opacity} />
          </mesh>
        )),
      )}
      {/* полиці */}
      {Array.from({ length: levels }, (_, l) => (
        <mesh key={l} position={[0, l * levelH + 0.03, 0]} receiveShadow>
          <boxGeometry args={[loc.w, 0.05, loc.d]} />
          <meshStandardMaterial color={aging ? '#c8a97e' : '#b9c3be'} transparent opacity={opacity * 0.9} />
        </mesh>
      ))}
      {items}
      {/* невидима «оболонка», щоб легко клікати по всьому стелажу */}
      <mesh position={[0, loc.h / 2, 0]}>
        <boxGeometry args={[loc.w + 0.2, loc.h, loc.d + 0.2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        {(selected || hovered) && <Edges color={selected ? '#17201b' : '#56615a'} />}
      </mesh>
      {(selected || hovered) && (
        <Html position={[0, loc.h + 0.5, 0]} center zIndexRange={[20, 0]}>
          <div className="tag3d">
            {loc.name} · {occupancy(state, loc)}%
          </div>
        </Html>
      )}
    </group>
  )
}

function Machine({ loc, selected, dimmed, onSelect }: ObjProps) {
  const { hovered, bind } = useHover()
  const isVat = loc.id.startsWith('K')
  const busy = loc.status === 'In uso'
  const opacity = dimmed ? 0.15 : 1
  return (
    <group
      position={[loc.x + loc.w / 2, 0, loc.z + loc.d / 2]}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(loc.id)
      }}
      {...bind}
    >
      {isVat ? (
        <mesh position={[0, loc.h / 2, 0]} castShadow>
          <cylinderGeometry args={[loc.w / 2, loc.w / 2.3, loc.h, 32]} />
          <meshStandardMaterial color="#c9d0cc" metalness={0.15} roughness={0.45} transparent opacity={opacity} />
          {(selected || hovered) && <Edges color="#17201b" />}
        </mesh>
      ) : (
        <mesh position={[0, loc.h / 2, 0]} castShadow>
          <boxGeometry args={[loc.w, loc.h, loc.d]} />
          <meshStandardMaterial color="#c9d0cc" metalness={0.15} roughness={0.45} transparent opacity={opacity} />
          {(selected || hovered) && <Edges color="#17201b" />}
        </mesh>
      )}
      {/* індикатор стану */}
      <mesh position={[0, loc.h + 0.15, 0]}>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color={busy ? '#2f8460' : '#d29a3a'} emissive={busy ? '#2f8460' : '#d29a3a'} emissiveIntensity={0.5} />
      </mesh>
      {(selected || hovered) && (
        <Html position={[0, loc.h + 0.7, 0]} center zIndexRange={[20, 0]}>
          <div className="tag3d">{loc.name} · {loc.status}</div>
        </Html>
      )}
    </group>
  )
}

function Pallet({ loc, state, selected, dimmed, onSelect }: ObjProps) {
  const { hovered, bind } = useHover()
  const preparing = state.orders.filter((o) => o.status === 'in_preparazione').length
  const crates = Math.min(6, preparing * 2)
  const opacity = dimmed ? 0.15 : 1
  return (
    <group
      position={[loc.x + loc.w / 2, 0, loc.z + loc.d / 2]}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(loc.id)
      }}
      {...bind}
    >
      <mesh position={[0, 0.07, 0]}>
        <boxGeometry args={[loc.w, 0.14, loc.d]} />
        <meshStandardMaterial color="#c8a97e" transparent opacity={opacity} />
        {(selected || hovered) && <Edges color="#17201b" />}
      </mesh>
      {Array.from({ length: crates }, (_, i) => (
        <mesh key={i} position={[((i % 2) - 0.5) * 0.55, 0.3 + Math.floor(i / 2) * 0.3, 0]}>
          <boxGeometry args={[0.5, 0.28, loc.d - 0.1]} />
          <meshStandardMaterial color="#e9d9c0" transparent opacity={opacity} />
        </mesh>
      ))}
      {(selected || hovered) && (
        <Html position={[0, 1.6, 0]} center zIndexRange={[20, 0]}>
          <div className="tag3d">{loc.name}</div>
        </Html>
      )}
    </group>
  )
}

function ZoneFloor({ zone }: { zone: Zone }) {
  const tint = zone.id.startsWith('c') ? '#e3ecf7' : zone.id === 'stag' ? '#f4ede2' : zone.id === 'prod' ? '#eef1ef' : '#f5efe6'
  return (
    <group position={[zone.x + zone.w / 2, 0.01, zone.z + zone.d / 2]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[zone.w, zone.d]} />
        <meshStandardMaterial color={tint} />
        <Edges color="#9aa6a0" />
      </mesh>
      <Html position={[-zone.w / 2 + 0.3, 0.05, -zone.d / 2 + 0.4]} zIndexRange={[10, 0]}>
        <div className="label3d">
          {zone.name}
          {zone.temperature ? ` · ${zone.temperature}` : ''}
        </div>
      </Html>
    </group>
  )
}

function CameraRig({ view }: { view: '3d' | 'top' }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    if (view === 'top') camera.position.set(CENTER[0], 34, CENTER[2] + 0.01)
    else camera.position.set(CENTER[0] - 14, 20, CENTER[2] + 22)
    const c = controls as unknown as { target: Vector3; update: () => void } | null
    c?.target.set(...CENTER)
    c?.update()
  }, [view, camera, controls])
  return null
}

// ---------- сторінка ----------

export default function Warehouse3D() {
  const { state, dispatch, today } = useStore()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>('occ')
  const [view, setView] = useState<'3d' | 'top'>('3d')
  const [filter, setFilter] = useState<string>('tutti')
  const [shipping, setShipping] = useState<{ lotId: string; qty: string } | null>(null)
  const pm = productMap(state)

  const selectedId = params.get('sel') ?? 'D'
  const selected = state.locations.find((l) => l.id === selectedId) ?? state.locations[0]
  const zone = state.zones.find((z) => z.id === selected.zoneId)
  const select = (id: string) => {
    setShipping(null)
    setParams({ sel: id }, { replace: true })
  }

  const containing = useMemo(() => {
    if (filter === 'tutti') return null
    return new Set(lotStock(state).filter((l) => l.productId === filter).map((l) => l.locationId))
  }, [state, filter])

  const selLots = lotsAt(state, selected.id).sort((a, b) => (a.expiresAt ?? a.producedAt).localeCompare(b.expiresAt ?? b.producedAt))
  const moveTargets = state.locations.filter((l) => l.kind === selected.kind && l.id !== selected.id)
  const avgAge = selected.kind === 'aging' ? avgAgeDays(state, selected.id, today) : null
  const firstExp = selected.kind === 'cold' ? firstExpiryDays(state, selected.id, today) : null

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Magazzino 3D</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Trascina per ruotare, rotella o due dita per lo zoom. Clicca uno scaffale, una cella o un macchinario.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Colora per">
            {(['occ', 'age', 'exp'] as Mode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'occ' ? 'Occupazione' : m === 'age' ? 'Età forme' : 'Scadenze'}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setView(view === '3d' ? 'top' : '3d')}>
            {view === '3d' ? 'Vista pianta' : 'Vista 3D'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 14, marginRight: 4 }}>Prodotto:</span>
        <button type="button" className="pill" aria-pressed={filter === 'tutti'} onClick={() => setFilter('tutti')}>Tutti</button>
        {state.products.map((p) => (
          <button key={p.id} type="button" className="pill" aria-pressed={filter === p.id} onClick={() => setFilter(p.id)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="wh-layout">
        <div className="wh-stage">
          <Canvas shadows camera={{ position: [CENTER[0] - 14, 20, CENTER[2] + 22], fov: 40 }} onPointerMissed={() => setShipping(null)}>
            <color attach="background" args={['#e6ebe8']} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[20, 30, 10]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CENTER[0], -0.01, CENTER[2]]} receiveShadow>
              <planeGeometry args={[34, 24]} />
              <meshStandardMaterial color="#fbfcfb" />
            </mesh>
            <gridHelper args={[34, 34, '#dfe5e1', '#edf1ee']} position={[CENTER[0], 0.005, CENTER[2]]} />
            {state.zones.map((z) => (
              <ZoneFloor key={z.id} zone={z} />
            ))}
            {state.locations.map((loc) => {
              const props: ObjProps = {
                loc,
                state,
                today,
                mode,
                selected: loc.id === selected.id,
                dimmed: containing ? !containing.has(loc.id) : false,
                onSelect: select,
              }
              if (loc.kind === 'machine') return <Machine key={loc.id} {...props} />
              if (loc.kind === 'dock') return <Pallet key={loc.id} {...props} />
              return <Rack key={loc.id} {...props} />
            })}
            <OrbitControls makeDefault target={CENTER} maxPolarAngle={Math.PI / 2.15} minDistance={8} maxDistance={60} />
            <CameraRig view={view} />
          </Canvas>
          <div className="legend" aria-label="Legenda">
            <strong style={{ fontSize: 12 }}>{LEGENDS[mode].title}</strong>
            {LEGENDS[mode].items.map(([c, l]) => (
              <span key={l}>
                <span className="sw" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        </div>

        <aside className="card wh-panel" aria-label="Dettaglio">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>
              {zone?.name}
              {zone?.temperature ? ` · ${zone.temperature}` : ''}
            </div>
            <h2 style={{ fontSize: 22 }}>{selected.name}</h2>
          </div>

          {selected.kind === 'machine' ? (
            <div className="list-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <span className={`chip ${selected.status === 'In uso' ? 'ok' : 'warn'}`}>{selected.status}</span>
              <span>{selected.note}</span>
            </div>
          ) : selected.kind === 'dock' ? (
            <div>
              {state.orders
                .filter((o) => o.status === 'in_preparazione')
                .map((o) => (
                  <div className="list-row" key={o.id}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{o.client}</div>
                      <div className="muted" style={{ fontSize: 13 }}>{o.lines.map((l) => `${pm[l.productId].name} ${l.qty}`).join(' · ')}</div>
                    </div>
                    <span className="mono">{fmtDate(o.due)}</span>
                  </div>
                ))}
              <Link to="/ordini" className="btn small" style={{ marginTop: 10 }}>Gestisci ordini</Link>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <div style={{ background: 'var(--ground)', borderRadius: 8, padding: '10px 12px' }}>
                  <div className="muted" style={{ fontSize: 12 }}>Occupazione</div>
                  <div className="mono" style={{ fontSize: 18 }}>{occupancy(state, selected)}%</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {fmtNum(usedSpace(state, selected.id))} / {selected.capacity} posti
                  </div>
                </div>
                <div style={{ background: 'var(--ground)', borderRadius: 8, padding: '10px 12px' }}>
                  <div className="muted" style={{ fontSize: 12 }}>{selected.kind === 'aging' ? 'Età media' : 'Prima scadenza'}</div>
                  <div className="mono" style={{ fontSize: 18 }}>
                    {selected.kind === 'aging'
                      ? avgAge != null ? `${Math.round(avgAge / 30)} mesi` : '—'
                      : firstExp != null ? `${firstExp} gg` : '—'}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {selected.kind === 'aging' && avgAge != null ? ageClass(avgAge) : ' '}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Lotti</div>
                {selLots.length === 0 && <div className="muted" style={{ padding: '10px 0' }}>Vuoto</div>}
                {selLots.map((lot) => (
                  <div className="list-row" key={lot.id} style={{ flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: '1 1 150px' }}>
                      <div style={{ fontWeight: 500 }}>
                        {pm[lot.productId].name} · {fmtNum(lot.qty)} {pm[lot.productId].unit}
                      </div>
                      <div className="mono muted" style={{ fontSize: 12 }}>
                        {lot.code} ·{' '}
                        {lot.expiresAt
                          ? `scade ${fmtDate(lot.expiresAt)}`
                          : `${Math.round(daysBetween(lot.producedAt, today) / 30)} mesi`}
                      </div>
                    </div>
                    {shipping?.lotId === lot.id ? (
                      <form
                        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                        onSubmit={(e) => {
                          e.preventDefault()
                          const q = Number(shipping.qty.replace(',', '.'))
                          if (q > 0) dispatch({ type: 'ship', lotId: lot.id, qty: q, code: lot.code })
                          setShipping(null)
                        }}
                      >
                        <label className="muted" htmlFor={`q-${lot.id}`} style={{ fontSize: 12 }}>Quantità</label>
                        <input
                          id={`q-${lot.id}`}
                          className="mono"
                          inputMode="decimal"
                          autoFocus
                          value={shipping.qty}
                          onChange={(e) => setShipping({ lotId: lot.id, qty: e.target.value })}
                          style={{ width: 64, minHeight: 36, borderRadius: 6, border: '1px solid var(--field)', padding: '0 8px' }}
                        />
                        <button type="submit" className="btn small primary">OK</button>
                      </form>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <label className="sr-only" htmlFor={`m-${lot.id}`}>Sposta {lot.code}</label>
                        <select
                          id={`m-${lot.id}`}
                          value=""
                          onChange={(e) => e.target.value && dispatch({ type: 'move', lotId: lot.id, locationId: e.target.value, code: lot.code })}
                          style={{ minHeight: 36, borderRadius: 8, border: '1px solid var(--field)', background: 'var(--card)', padding: '0 6px', fontSize: 14, maxWidth: 110 }}
                        >
                          <option value="">Sposta…</option>
                          {moveTargets.map((t) => (
                            <option key={t.id} value={t.id}>{t.name} ({occupancy(state, t)}%)</option>
                          ))}
                        </select>
                        <button type="button" className="btn small" onClick={() => setShipping({ lotId: lot.id, qty: String(lot.qty) })}>
                          Uscita
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 'auto' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Tutte le posizioni</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {state.locations.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="pill"
                  aria-pressed={l.id === selected.id}
                  onClick={() => select(l.id)}
                  style={{ minWidth: 44 }}
                >
                  {l.id}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
