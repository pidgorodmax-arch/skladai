// Єдине місце в інтерфейсі, яке дивиться на годинник. Повертає «сьогодні»
// (день за часом Риму, див. startOfDay) і оновлюється, коли настає нова доба —
// планшет у цеху може бути відкритий цілу ніч.

import { useEffect, useState } from 'react'
import { startOfDay } from './selectors'

export function useToday(): Date {
  const [today, setToday] = useState(() => startOfDay(new Date()))
  useEffect(() => {
    const id = setInterval(() => {
      const next = startOfDay(new Date())
      setToday((prev) => (prev.getTime() === next.getTime() ? prev : next))
    }, 60_000)
    return () => clearInterval(id)
  }, [])
  return today
}
