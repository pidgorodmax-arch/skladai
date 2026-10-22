// Єдине сховище стану для всіх екранів.
// Зараз дані живуть у браузері (localStorage). Наступний крок — замінити
// loadState/saveState на Google Sheets (Sistema Latteria) або PostgreSQL:
// екрани при цьому не зміняться, бо працюють лише через цей модуль.

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { createSeed, expiryFor, isoDay, lotCode } from './seed'
import type { AppState, Lot, OrderStatus } from './types'

const STORAGE_KEY = 'skladai:v1'

export type Action =
  | { type: 'register'; productId: string; qty: number; locationId: string; milkLitres?: number }
  | { type: 'ship'; lotId: string; qty: number }
  | { type: 'move'; lotId: string; locationId: string }
  | { type: 'orderStatus'; orderId: string; status: OrderStatus }
  | { type: 'reset' }

function now(): string {
  return new Date().toISOString().slice(0, 16)
}

// Експортуємо для тестів: reducer — чиста функція (стан + дія → новий стан).
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'register': {
      const product = state.products.find((p) => p.id === action.productId)
      const location = state.locations.find((l) => l.id === action.locationId)
      if (!product || !location || action.qty <= 0) return state
      const producedAt = isoDay(0)
      const lot: Lot = {
        id: lotCode(product.id, producedAt, state.lots.map((l) => l.id)),
        productId: product.id,
        qty: action.qty,
        locationId: location.id,
        producedAt,
        expiresAt: expiryFor(product, producedAt),
        milkLitres: action.milkLitres,
      }
      return {
        ...state,
        lots: [...state.lots, lot],
        log: [...state.log, { at: now(), text: `Prodotto lotto ${lot.id}: ${product.name} ${action.qty} ${product.unit} → ${location.name}` }],
      }
    }
    case 'ship': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      if (!lot) return state
      const qty = Math.min(action.qty, lot.qty)
      const lots = state.lots
        .map((l) => (l.id === lot.id ? { ...l, qty: l.qty - qty } : l))
        .filter((l) => l.qty > 0)
      return { ...state, lots, log: [...state.log, { at: now(), text: `Uscita ${qty} dal lotto ${lot.id}` }] }
    }
    case 'move': {
      const lot = state.lots.find((l) => l.id === action.lotId)
      const to = state.locations.find((l) => l.id === action.locationId)
      if (!lot || !to) return state
      return {
        ...state,
        lots: state.lots.map((l) => (l.id === lot.id ? { ...l, locationId: to.id } : l)),
        log: [...state.log, { at: now(), text: `Lotto ${lot.id} spostato in ${to.name}` }],
      }
    }
    case 'orderStatus': {
      const order = state.orders.find((o) => o.id === action.orderId)
      if (!order || order.status === action.status) return state
      // «Spedito» остаточний: товар уже списано. Повернення — окрема дія (reso, етап 5).
      if (order.status === 'spedito') return state
      let lots = state.lots
      const log = [...state.log]
      if (action.status === 'spedito') {
        // Списуємо зі складу за принципом FEFO: спершу те, що раніше спливає
        // (для Montasio — найстаріші форми).
        for (const line of order.lines) {
          let left = line.qty
          const candidates = lots
            .filter((l) => l.productId === line.productId)
            .sort((a, b) => (a.expiresAt ?? a.producedAt).localeCompare(b.expiresAt ?? b.producedAt))
          for (const c of candidates) {
            if (left <= 0) break
            const take = Math.min(left, c.qty)
            left -= take
            lots = lots.map((l) => (l.id === c.id ? { ...l, qty: l.qty - take } : l))
          }
        }
        lots = lots.filter((l) => l.qty > 0)
        log.push({ at: now(), text: `Spedito ordine ${order.id} a ${order.client}` })
      }
      return {
        ...state,
        lots,
        log,
        orders: state.orders.map((o) => (o.id === action.orderId ? { ...o, status: action.status } : o)),
      }
    }
    case 'reset':
      return createSeed()
  }
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed.version === 1) return parsed
    }
  } catch {
    // приватний режим або пошкоджені дані — починаємо з демо
  }
  return createSeed()
}

function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // без збереження демо все одно працює
  }
}

const Ctx = createContext<{ state: AppState; dispatch: (a: Action) => void } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  useEffect(() => saveState(state), [state])
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
