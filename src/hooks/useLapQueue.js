import { useCallback, useEffect, useState } from 'react'
import { lapQueue, voidLap } from '../services/lanesService'
import { uuid } from '../lib/ids'

const RETRY_MS = 3_000
export const UNDO_WINDOW_MS = 30_000

const forTeam = (items, teamId) => items.filter((i) => i.teamId === teamId)

// Toques del operador: cola local → servidor, con feedback del último toque.
export function useLapQueue(teamId, onFlushed) {
  const [pending, setPending] = useState(() => forTeam(lapQueue.list(), teamId))
  const [rejected, setRejected] = useState(() => forTeam(lapQueue.rejected(), teamId))
  const [lastTap, setLastTap] = useState(null)

  const refresh = useCallback(() => {
    setPending(forTeam(lapQueue.list(), teamId))
    setRejected(forTeam(lapQueue.rejected(), teamId))
  }, [teamId])

  const flush = useCallback(async () => {
    const results = await lapQueue.flush()
    refresh()
    if (results.length === 0) return results
    setLastTap((tap) => {
      const match = tap && results.find((r) => r.item.clientOpId === tap.clientOpId)
      return match ? { ...tap, outcome: match.outcome, lapId: match.lapId, error: match.error } : tap
    })
    onFlushed?.(results)
    return results
  }, [refresh, onFlushed])

  useEffect(() => {
    const id = setInterval(() => {
      if (lapQueue.list().length > 0) flush()
    }, RETRY_MS)
    window.addEventListener('online', flush)
    flush()
    return () => {
      clearInterval(id)
      window.removeEventListener('online', flush)
    }
  }, [flush])

  const tap = useCallback(
    ({ eventId, swimmer, occurredAt, deviceId }) => {
      const item = {
        clientOpId: uuid(),
        eventId,
        teamId,
        swimmerId: swimmer.id,
        occurredAt: new Date(occurredAt).toISOString(),
        deviceId,
      }
      lapQueue.enqueue(item)
      setLastTap({ ...item, swimmerName: swimmer.name, tappedAt: Date.now(), outcome: 'pending' })
      refresh()
      flush()
    },
    [teamId, refresh, flush]
  )

  // Deshacer: si el toque no salió se quita de la cola; si ya está en el
  // servidor se anula (el servidor exige que sea propio y de hace < 30 s).
  const undo = useCallback(
    async (target) => {
      if (lapQueue.remove(target.clientOpId)) {
        refresh()
      } else if (target.lapId && (target.outcome === 'recorded' || target.outcome === 'duplicate')) {
        // En too_soon, lapId es la pasada ANTERIOR que bloqueó el toque: no se anula.
        await voidLap(target.lapId, 'Deshacer desde el carril')
        onFlushed?.([])
      }
      setLastTap((tap) => (tap?.clientOpId === target.clientOpId ? { ...tap, outcome: 'undone' } : tap))
    },
    [refresh, onFlushed]
  )

  const clearRejected = useCallback(() => {
    lapQueue.clearRejected()
    refresh()
  }, [refresh])

  return { pending, rejected, lastTap, tap, undo, clearRejected }
}
