import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEventLive } from '../../hooks/useEventLive'
import { fetchCorrectionsData } from '../../services/correctionsService'
import { friendlyError } from '../../lib/errors'
import { describeAudit } from '../../lib/auditFormat'
import { sortByRelayOrder } from '../../lib/swimmerOrder'
import TopBar from '../../components/TopBar'
import StatusBadge from '../../components/StatusBadge'
import LapsCorrections from '../../components/LapsCorrections'
import AuditHistory from '../../components/AuditHistory'

export default function JudgeCorrections() {
  const { eventId } = useParams()
  const live = useEventLive(eventId)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('laps')
  const orgId = live.event?.organization_id

  // Cada recarga del bundle en vivo (cambios en pasadas, ajustes, roster)
  // trae de nuevo pasadas, ajustes y auditoría.
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    fetchCorrectionsData(eventId, orgId)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((err) => !cancelled && setError(err))
    return () => {
      cancelled = true
    }
  }, [eventId, orgId, live.loadedFrom])

  const ctx = useMemo(() => {
    if (!live.loaded) return null
    const swimmerById = new Map(live.swimmers.map((s) => [s.id, s]))
    const teamById = new Map(live.teams.map((t) => [t.id, t]))
    const memberById = new Map((data?.members ?? []).map((m) => [m.user_id, m]))
    return {
      swimmerName: (id) => swimmerById.get(id)?.name ?? '—',
      teamLabel: (id) => {
        const t = teamById.get(id)
        return t ? `Carril ${t.lane_number} · ${t.name}` : '—'
      },
      actorName: (id) => (id ? memberById.get(id)?.display_name || 'Usuario sin nombre' : 'Sistema'),
      teamSwimmers: (teamId) => sortByRelayOrder(live.swimmers.filter((s) => s.team_id === teamId)),
    }
  }, [live.loaded, live.swimmers, live.teams, data?.members])

  if (!live.loaded || !ctx) {
    return (
      <>
        <TopBar title="Correcciones" backTo={`/juez/evento/${eventId}`} />
        <main className="page">
          {live.error ? <div className="alert alert--danger">{friendlyError(live.error)}</div> : <p className="muted">Cargando…</p>}
        </main>
      </>
    )
  }

  const { event } = live
  const entries = data ? data.audit.map((entry) => ({ ...entry, view: describeAudit(entry, ctx) })) : null
  const rejectedCount = entries?.filter((e) => e.view.category === 'rejects').length ?? 0

  return (
    <>
      <TopBar title={`Correcciones · ${event.name}`} subtitle={event.event_date} backTo={`/juez/evento/${eventId}`} liveStatus={live.liveStatus}>
        <StatusBadge status={event.status} />
      </TopBar>
      <main className="page page--wide">
        {error && <div className="alert alert--danger">{friendlyError(error)}</div>}

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'laps'} className={`tab ${tab === 'laps' ? 'tab--active' : ''}`} onClick={() => setTab('laps')}>
            Pasadas y ajustes
          </button>
          <button role="tab" aria-selected={tab === 'history'} className={`tab ${tab === 'history' ? 'tab--active' : ''}`} onClick={() => setTab('history')}>
            Historial
            {rejectedCount > 0 && <span className="pill pill--danger">{rejectedCount} rechazos</span>}
          </button>
        </div>

        {!data ? (
          <p className="muted">Cargando pasadas y auditoría…</p>
        ) : tab === 'laps' ? (
          <LapsCorrections live={live} data={data} ctx={ctx} onChanged={live.reload} />
        ) : (
          <AuditHistory event={event} entries={entries} ctx={ctx} />
        )}
      </main>
    </>
  )
}
