import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { parseTs } from './eventClock'

const SAMPLES = 5
const RESYNC_MS = 60_000
const OFFSET_KEY = 'postas:server-offset'

// Desfase entre el reloj del dispositivo y el del servidor.
// Toma varias muestras y se queda con la de menor ida y vuelta (la más precisa).
export async function measureServerOffset(samples = SAMPLES) {
  let best = null
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now()
    const { data, error } = await supabase.rpc('server_now')
    const t1 = Date.now()
    if (error) throw error
    const rtt = t1 - t0
    const offset = parseTs(data) - (t0 + rtt / 2)
    if (!best || rtt < best.rtt) best = { offset, rtt }
  }
  return best
}

// Último desfase medido: si la página se recarga sin conexión, las pasadas
// siguen llevando hora de servidor.
function readStoredOffset() {
  try {
    const raw = localStorage.getItem(OFFSET_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function storeOffset(value) {
  try {
    localStorage.setItem(OFFSET_KEY, JSON.stringify(value))
  } catch {
    // Solo se pierde la recuperación tras recargar.
  }
}

// Hora del servidor estimada, refrescada cada 250 ms. Se resincroniza cada
// minuto y al recuperar la conexión.
//   synced:    hubo una medición en esta sesión.
//   hasOffset: hay un desfase utilizable (de esta sesión o guardado).
export function useServerClock() {
  const [sync, setSync] = useState(() => {
    const stored = readStoredOffset()
    return { offset: stored?.offset ?? 0, rtt: stored?.rtt ?? null, synced: false, hasOffset: !!stored, error: null }
  })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const result = await measureServerOffset()
        if (cancelled) return
        storeOffset(result)
        setSync({ ...result, synced: true, hasOffset: true, error: null })
      } catch (err) {
        if (!cancelled) setSync((prev) => ({ ...prev, error: err }))
      }
    }
    run()
    const interval = setInterval(run, RESYNC_MS)
    window.addEventListener('online', run)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', run)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  return { serverNow: now + sync.offset, getServerNow: () => Date.now() + sync.offset, ...sync }
}
