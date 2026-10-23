import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { useStore } from './data/useStore'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Register from './pages/Register'

// 3D-сцена важка (Three.js) — вантажимо її лише коли відкривають карту.
const Warehouse3D = lazy(() => import('./pages/Warehouse3D'))

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="7" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d="M8 19h14M8 14h14M8 9h8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function App() {
  const { dispatch } = useStore()
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined)

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <Logo />
            SkladAI
            <small>Caseificio demo · Friuli</small>
          </NavLink>
          <nav className="nav" aria-label="Sezioni">
            <NavLink to="/" end className={link}>Cruscotto</NavLink>
            <NavLink to="/magazzino" className={link}>Magazzino 3D</NavLink>
            <NavLink to="/ordini" className={link}>Ordini</NavLink>
            <NavLink to="/registra" className={link}>Registra</NavLink>
          </nav>
        </div>
      </header>

      <Suspense fallback={<div className="page muted">Caricamento della mappa 3D…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/magazzino" element={<Warehouse3D />} />
          <Route path="/ordini" element={<Orders />} />
          <Route path="/registra" element={<Register />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </Suspense>

      <footer className="app-foot">
        <span>Prototipo SkladAI · dati di esempio salvati in questo browser</span>
        <button type="button" className="btn small" onClick={() => dispatch({ type: 'reset' })}>
          Ripristina dati demo
        </button>
      </footer>
    </>
  )
}
