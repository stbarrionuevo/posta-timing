// Traduce filas de audit_log a frases para el juez / la organización.
// ctx: { swimmerName(id), teamLabel(id) }

const STATUS = {
  draft: 'Borrador',
  ready: 'Listo para largar',
  running: 'En curso',
  paused: 'En pausa',
  finished: 'Finalizado',
}

const CONFIG_LABELS = {
  name: 'nombre',
  venue: 'sede',
  event_date: 'fecha',
  pool_length_m: 'largo de pileta',
  duration_seconds: 'duración',
  min_lap_seconds: 'anti doble toque',
  partial_lap_policy: 'pasada incompleta',
  is_public: 'marcador público',
  auto_rotate: 'rotación automática',
}

const ADJUSTMENT = { penalty: 'Penalización', partial_lap: 'Pasada incompleta', manual: 'Ajuste manual' }

const REJECT_TEXT = {
  TOO_SOON: 'Doble toque rechazado',
  AFTER_END: 'Toque rechazado: después del final o durante la pausa',
  BEFORE_START: 'Toque rechazado: antes del inicio',
  FUTURE_TIMESTAMP: 'Toque rechazado: reloj del dispositivo desfasado',
  EVENT_NOT_STARTED: 'Toque rechazado: el evento no había empezado',
  SWIMMER_NOT_IN_TEAM: 'Toque rechazado: nadador de otro equipo',
}

// Categorías para filtrar el historial.
export const CATEGORIES = [
  { key: 'all', label: 'Todo' },
  { key: 'rejects', label: 'Rechazos' },
  { key: 'corrections', label: 'Correcciones' },
  { key: 'clock', label: 'Reloj' },
  { key: 'roster', label: 'Roster' },
  { key: 'devices', label: 'Dispositivos' },
  { key: 'laps', label: 'Pasadas' },
]

const meters = (m) => `${Number(m) > 0 ? '+' : ''}${Number(m)} m`

export function describeAudit(entry, ctx) {
  const { action, entity, before: b, after: a } = entry
  const swimmer = (id) => ctx.swimmerName(id)
  const team = (id) => ctx.teamLabel(id)

  if (action === 'lap_rejected') {
    const code = /^([A-Z_]+):/.exec(entry.reason || '')?.[1]
    return {
      category: 'rejects',
      tone: 'danger',
      title: REJECT_TEXT[code] ?? 'Toque rechazado',
      detail: `${team(a?.team_id)} · ${swimmer(a?.swimmer_id)}`,
    }
  }
  if (action === 'lane_ready') {
    return { category: 'devices', tone: 'info', title: `${team(a?.team_id)}: carril listo`, detail: `Dispositivo ${a?.device_id}` }
  }
  if (action === 'lane_device_joined') {
    return {
      category: 'devices',
      tone: 'warn',
      title: `${team(a?.team_id)}: se conectó un dispositivo con el evento en curso`,
      detail: `Dispositivo ${a?.device_id}`,
    }
  }

  if (entity === 'events') {
    if (action === 'insert') return { category: 'clock', tone: 'info', title: 'Evento creado' }
    if (action === 'update' && b?.status !== a?.status) {
      return {
        category: 'clock',
        tone: a?.status === 'paused' ? 'warn' : 'info',
        title: `Evento: ${STATUS[b?.status] ?? b?.status} → ${STATUS[a?.status] ?? a?.status}`,
      }
    }
    const changed = Object.keys(CONFIG_LABELS).filter((k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]))
    return {
      category: 'clock',
      tone: 'info',
      title: 'Configuración modificada',
      detail: changed.map((k) => CONFIG_LABELS[k]).join(', ') || undefined,
    }
  }

  if (entity === 'laps') {
    if (action === 'insert') {
      return a?.source === 'judge'
        ? { category: 'corrections', tone: 'warn', title: 'Pasada agregada por el juez', detail: `${team(a.team_id)} · ${swimmer(a.swimmer_id)}` }
        : { category: 'laps', tone: 'muted', title: 'Pasada', detail: `${team(a?.team_id)} · ${swimmer(a?.swimmer_id)}` }
    }
    if (action === 'update') {
      if (b?.status === 'valid' && a?.status === 'void') {
        return { category: 'corrections', tone: 'danger', title: 'Pasada anulada', detail: `${team(a.team_id)} · ${swimmer(a.swimmer_id)}` }
      }
      if (b?.status === 'void' && a?.status === 'valid') {
        return { category: 'corrections', tone: 'warn', title: 'Pasada restaurada', detail: `${team(a.team_id)} · ${swimmer(a.swimmer_id)}` }
      }
      if (b?.swimmer_id !== a?.swimmer_id) {
        return {
          category: 'corrections',
          tone: 'warn',
          title: 'Pasada reasignada',
          detail: `${team(a.team_id)} · ${swimmer(b.swimmer_id)} → ${swimmer(a.swimmer_id)}`,
        }
      }
    }
    return { category: 'corrections', tone: 'warn', title: 'Pasada modificada' }
  }

  if (entity === 'team_adjustments') {
    const row = action === 'delete' ? b : a
    return {
      category: 'corrections',
      tone: action === 'delete' ? 'warn' : 'danger',
      title: `${action === 'delete' ? 'Se quitó: ' : ''}${ADJUSTMENT[row?.kind] ?? 'Ajuste'} ${meters(row?.meters)}`,
      detail: team(row?.team_id),
    }
  }

  if (entity === 'teams') {
    const row = action === 'delete' ? b : a
    if (action === 'update' && b?.active_swimmer_id !== a?.active_swimmer_id) {
      return {
        category: 'roster',
        tone: 'info',
        title: `${team(a.id)}: cambio de nadador`,
        detail: `${b.active_swimmer_id ? swimmer(b.active_swimmer_id) : 'nadie'} → ${a.active_swimmer_id ? swimmer(a.active_swimmer_id) : 'nadie'}`,
      }
    }
    const verb = { insert: 'creado', update: 'modificado', delete: 'eliminado' }[action]
    return { category: 'roster', tone: 'info', title: `Equipo ${row?.name} (carril ${row?.lane_number}) ${verb}` }
  }

  if (entity === 'swimmers') {
    const row = action === 'delete' ? b : a
    if (action === 'insert') {
      return {
        category: 'roster',
        tone: row?.added_after_lock ? 'warn' : 'info',
        title: `${row?.added_after_lock ? 'Alta tardía' : 'Alta'}: ${row?.name}`,
        detail: team(row?.team_id),
      }
    }
    if (action === 'update' && b?.is_active !== a?.is_active) {
      return { category: 'roster', tone: 'warn', title: `${a.is_active ? 'Reincorporación' : 'Baja'}: ${a.name}`, detail: team(a.team_id) }
    }
    return {
      category: 'roster',
      tone: 'info',
      title: `${action === 'delete' ? 'Se quitó a' : 'Nadador modificado:'} ${row?.name}`,
      detail: team(row?.team_id),
    }
  }

  if (entity === 'memberships') {
    return { category: 'roster', tone: 'info', title: 'Permisos de usuario modificados' }
  }

  return { category: 'all', tone: 'info', title: `${entity} ${action}` }
}
