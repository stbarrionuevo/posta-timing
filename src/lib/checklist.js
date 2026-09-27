import { parseTs } from './eventClock.js'
import { SIGNAL_TIMEOUT_MS } from './laneAlerts.js'

const MAX_RTT_MS = 500

const lanesText = (teams) => teams.map((t) => `carril ${t.lane_number}`).join(', ')

// Chequeos que el sistema puede verificar solo, a partir de los datos en vivo.
// status: ok | warn | fail | pending (todavía no se puede verificar).
export function evaluateChecklist({ event, teams, swimmers, laneSessions, members, sync, nowMs }) {
  const items = []
  const add = (id, label, status, detail) => items.push({ id, label, status, detail })
  const activeByTeam = (t) => swimmers.filter((s) => s.team_id === t.id && s.is_active)

  // Equipos y nadadores
  if (teams.length === 0) add('teams', 'Equipos cargados', 'fail', 'No hay equipos.')
  else add('teams', 'Equipos cargados', teams.length === 1 ? 'warn' : 'ok', teams.length === 1 ? 'Hay un solo equipo.' : `${teams.length} equipos.`)

  const empty = teams.filter((t) => activeByTeam(t).length === 0)
  add(
    'swimmers',
    'Todos los equipos tienen nadadores',
    teams.length === 0 ? 'pending' : empty.length ? 'fail' : 'ok',
    empty.length ? `Sin nadadores: ${lanesText(empty)}.` : `${swimmers.filter((s) => s.is_active).length} nadadores en total.`
  )

  const unordered = teams.filter((t) => activeByTeam(t).some((s) => s.relay_order == null))
  add(
    'relay_order',
    'Orden de relevo definido',
    unordered.length ? 'warn' : teams.length ? 'ok' : 'pending',
    unordered.length
      ? `Hay nadadores sin número de orden (${lanesText(unordered)}): la rotación automática los pone al final.`
      : event.auto_rotate
        ? 'La rotación automática sigue este orden.'
        : 'Rotación manual.'
  )

  // Personas
  const operators = members.filter((m) => m.role === 'operator').length
  add(
    'operators',
    'Un operador por carril',
    operators >= teams.length && teams.length > 0 ? 'ok' : 'warn',
    `${operators} usuario${operators === 1 ? '' : 's'} operador${operators === 1 ? '' : 'es'} para ${teams.length} carril${teams.length === 1 ? '' : 'es'}` +
      (operators < teams.length ? '. Los jueces también pueden operar un carril.' : '.')
  )

  // Estado del evento
  add(
    'roster',
    'Roster confirmado',
    event.status === 'draft' ? 'warn' : 'ok',
    event.status === 'draft' ? 'Confirmalo en el panel: habilita "Carril listo" en los celulares.' : 'Confirmado.'
  )

  // Dispositivos (se puede verificar recién con el roster confirmado)
  if (event.status === 'draft') {
    add('devices', 'Un celular conectado en cada carril', 'pending', 'Se verifica al confirmar el roster.')
    add('ready', 'Todos los carriles marcaron "listo"', 'pending', 'Se verifica al confirmar el roster.')
  } else if (event.status === 'finished') {
    add('devices', 'Un celular conectado en cada carril', 'ok', 'Evento finalizado.')
    add('ready', 'Todos los carriles marcaron "listo"', 'ok', 'Evento finalizado.')
  } else {
    const disconnected = teams.filter(
      (t) => !laneSessions.some((s) => s.team_id === t.id && nowMs - parseTs(s.last_seen_at) <= SIGNAL_TIMEOUT_MS)
    )
    add(
      'devices',
      'Un celular conectado en cada carril',
      disconnected.length ? 'fail' : 'ok',
      disconnected.length ? `Sin celular conectado: ${lanesText(disconnected)}.` : 'Todos los carriles con señal.'
    )
    const notReady = teams.filter((t) => !laneSessions.some((s) => s.team_id === t.id && s.ready_at))
    add(
      'ready',
      'Todos los carriles marcaron "listo"',
      event.status !== 'ready' ? 'ok' : notReady.length ? 'warn' : 'ok',
      event.status !== 'ready' ? 'El evento ya empezó.' : notReady.length ? `Faltan: ${lanesText(notReady)}.` : 'Todos listos.'
    )
  }

  // Reloj del juez
  if (sync.error) add('clock', 'Reloj sincronizado con el servidor', 'fail', 'No hay conexión con el servidor.')
  else if (!sync.synced) add('clock', 'Reloj sincronizado con el servidor', 'pending', 'Sincronizando…')
  else
    add(
      'clock',
      'Reloj sincronizado con el servidor',
      sync.rtt > MAX_RTT_MS ? 'warn' : 'ok',
      sync.rtt > MAX_RTT_MS
        ? `La red responde lento (${Math.round(sync.rtt)} ms). Revisá el WiFi antes de largar.`
        : Number.isFinite(sync.rtt)
          ? `Precisión ±${Math.round(sync.rtt / 2)} ms.`
          : 'Sincronizado.'
    )

  add(
    'public',
    'Marcador público',
    'ok',
    event.is_public ? 'Activado: el marcador y los resultados se ven sin iniciar sesión.' : 'Desactivado: solo lo ve la organización.'
  )

  return items
}

// Chequeos que hace una persona. Se agrupan por momento.
export const MANUAL_ITEMS = [
  {
    group: 'Días antes',
    items: [
      ['rules', 'Reglas cerradas con la organización: qué cuenta como pasada, cambios de nadador, penalizaciones, pasada incompleta y desempate.'],
      ['rules_shared', 'Reglas comunicadas a los equipos participantes.'],
      ['users', 'Usuarios creados: un operador por carril, jueces y al menos un usuario de respaldo.'],
      ['test_event', 'Evento de prueba de 2 minutos corrido con los mismos celulares y la misma red.'],
    ],
  },
  {
    group: 'Equipamiento',
    items: [
      ['router', 'Router WiFi propio del evento encendido (no depender de la red del predio).'],
      ['signal', 'Señal probada en ambos extremos de la pileta y en la mesa del juez.'],
      ['charge', 'Celulares cargados (más de 80 %) y una batería externa por carril.'],
      ['phones', 'Celulares con brillo alto, sonido activado y bloqueo automático desactivado, en funda.'],
      ['backup_phone', 'Un celular de respaldo cargado y con sesión iniciada como operador.'],
      ['screen', 'TV o proyector con el marcador abierto en pantalla completa.'],
    ],
  },
  {
    group: 'Personas',
    items: [
      ['briefing', 'Charla de 5 minutos con los operadores usando la tarjeta del operador del manual.'],
      ['paper', 'Planilla de papel impresa en cada carril, con un veedor que marca en paralelo.'],
      ['swimmers_order', 'Cada equipo conoce su orden de relevo (coincide con el cargado).'],
    ],
  },
  {
    group: 'Al terminar',
    items: [
      ['partial', 'Metros de la pasada incompleta cargados, si la regla del evento los cuenta.'],
      ['review', 'Historial revisado: rechazos, "llegó tarde" y correcciones, contra las planillas de papel.'],
      ['exports', 'PDF de resultados y CSV de auditoría descargados y guardados.'],
    ],
  },
]

// Casillas de la planilla de papel: suficientes para el equipo más rápido
// (~0,6 s por metro = 15 s por largo de 25 m), redondeado a filas de 10.
export function sheetBoxes(event) {
  const estimate = event.duration_seconds / (event.pool_length_m * 0.6)
  return Math.min(300, Math.max(40, Math.ceil(estimate / 10) * 10))
}
