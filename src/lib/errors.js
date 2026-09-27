// Las funciones de schema.sql lanzan "CODIGO: detalle". Esto lo traduce a
// algo que el juez entienda en medio del evento.
const MESSAGES = {
  FORBIDDEN: 'No tenés permiso para esta acción.',
  INVALID_STATUS: 'La acción no corresponde al estado actual del evento.',
  NO_TEAMS: 'El evento no tiene equipos cargados.',
  EMPTY_TEAM: 'Hay equipos sin nadadores activos.',
  LANES_NOT_READY: 'Hay carriles que no confirmaron "listo".',
  ROSTER_LOCKED: 'El evento ya empezó: los cambios de roster se hacen con motivo.',
  EVENT_CONFIG_LOCKED: 'La configuración no se puede cambiar con el evento iniciado.',
  REASON_REQUIRED: 'Tenés que indicar un motivo.',
  TIME_OVER: 'El tiempo del evento ya terminó.',
  SWIMMER_NOT_IN_TEAM: 'El nadador no pertenece a ese equipo.',
  OUT_OF_RANGE: 'La hora de la pasada queda fuera del tiempo del evento.',
  LAP_NOT_FOUND: 'La pasada ya no existe.',
  AFTER_END: 'Llegó después del final del evento o durante una pausa.',
  BEFORE_START: 'Es anterior al inicio del evento.',
  FUTURE_TIMESTAMP: 'El reloj del celular está desfasado.',
  EVENT_NOT_STARTED: 'El evento todavía no había empezado.',
  LAST_ADMIN: 'La organización tiene que tener al menos un administrador.',
  ALREADY_MEMBER: 'Ese email ya es parte de la organización.',
  INVALID_EMAIL: 'El email no es válido.',
  WEAK_PASSWORD: 'La contraseña debe tener al menos 8 caracteres.',
  OTHER_ORGANIZATION: 'Ese usuario también pertenece a otra organización: la contraseña la cambia él o el proveedor del sistema.',
  NOT_MEMBER: 'El usuario no pertenece a la organización.',
  FUNCTION_UNAVAILABLE: 'La función de usuarios (admin-users) no está desplegada en Supabase.',
}

export function errorCode(err) {
  const match = /^([A-Z_]+):/.exec(err?.message || '')
  return match ? match[1] : null
}

export function errorDetail(err) {
  const msg = err?.message || ''
  const idx = msg.indexOf(':')
  return idx >= 0 ? msg.slice(idx + 1).trim() : msg
}

export function friendlyError(err) {
  if (!err) return ''
  if (err.code === '23505') return 'Ya existe un registro con ese nombre o número de carril.'
  if (/row-level security|permission denied/i.test(err.message || '')) return MESSAGES.FORBIDDEN
  if (/network|fetch/i.test(err.message || '')) return 'Sin conexión con el servidor.'
  const code = errorCode(err)
  if (code && MESSAGES[code]) {
    const detail = errorDetail(err)
    return code === 'LANES_NOT_READY' ? `${MESSAGES[code]} ${detail}` : MESSAGES[code]
  }
  return err.message || 'Error inesperado.'
}
