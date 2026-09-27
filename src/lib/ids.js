// crypto.randomUUID solo existe en contextos seguros (https / localhost).
// En la red local del evento (http://192.168...) se arma con getRandomValues.
export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      // Contexto no seguro: sigue abajo.
    }
  }
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const DEVICE_KEY = 'postas:device-id'

// Identifica el dispositivo en lane_sessions y en cada pasada.
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = `dev-${uuid().slice(0, 8)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'dev-sin-storage'
  }
}
