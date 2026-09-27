import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEventLive } from '../../hooks/useEventLive'
import { useServerClock } from '../../lib/serverClock'
import { evaluateChecklist, MANUAL_ITEMS } from '../../lib/checklist'
import { fetchMembers } from '../../services/eventsService'
import { friendlyError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import TopBar from '../../components/TopBar'
import StatusBadge from '../../components/StatusBadge'
import Icon from '../../components/Icon'

const STATUS_ICON = { ok: 'circle-check', warn: 'triangle-exclamation', fail: 'circle-xmark', pending: 'hourglass-half' }

// Los tildes manuales viven en este navegador (una conveniencia por evento).
const storageKey = (eventId) => `postas:checklist:${eventId}`
function readChecked(eventId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(eventId)) || '{}')
  } catch {
    return {}
  }
}

export default function JudgeChecklist() {
  const { eventId } = useParams()
  const live = useEventLive(eventId)
  const sync = useServerClock()
  const [members, setMembers] = useState([])
  const [checked, setChecked] = useState(() => readChecked(eventId))
  const orgId = live.event?.organization_id

  useEffect(() => {
    if (!orgId) return
    fetchMembers(orgId).then(setMembers).catch(() => setMembers([]))
  }, [orgId])

  const toggle = (id) =>
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem(storageKey(eventId), JSON.stringify(next))
      } catch {
        // Sin storage: el tilde dura mientras la página esté abierta.
      }
      return next
    })

  if (!live.loaded) {
    return (
      <>
        <TopBar title="Checklist" backTo={`/juez/evento/${eventId}`} />
        <main className="page">
          {live.error ? <div className="alert alert--danger">{friendlyError(live.error)}</div> : <p className="muted">Cargando…</p>}
        </main>
      </>
    )
  }

  const { event } = live
  const auto = evaluateChecklist({ ...live, members, sync, nowMs: sync.serverNow })
  const autoOk = auto.filter((i) => i.status === 'ok').length
  const blocking = auto.filter((i) => i.status === 'fail')
  const manualIds = MANUAL_ITEMS.flatMap((g) => g.items.map(([id]) => id))
  const manualOk = manualIds.filter((id) => checked[id]).length
  const allDone = autoOk === auto.length && manualOk === manualIds.length

  return (
    <>
      <TopBar title={`Checklist · ${event.name}`} subtitle={formatDate(event.event_date)} backTo={`/juez/evento/${eventId}`} liveStatus={live.liveStatus}>
        <StatusBadge status={event.status} />
      </TopBar>
      <main className="page">
        <section className={`card checklist-summary ${allDone ? 'checklist-summary--done' : blocking.length ? 'checklist-summary--fail' : ''}`}>
          <div>
            <div className="checklist-summary__title">
              {allDone ? '¡Todo listo para largar!' : blocking.length ? `${blocking.length} problema${blocking.length === 1 ? '' : 's'} para resolver` : 'Revisá los pendientes'}
            </div>
            <div className="muted small">
              Automáticos {autoOk}/{auto.length} · Manuales {manualOk}/{manualIds.length}
            </div>
          </div>
          <div className="checklist-summary__actions no-print">
            <Link className="btn btn--ghost btn--small" to={`/juez/evento/${eventId}/planillas`}>
              <Icon name="print" /> Planillas de papel
            </Link>
            <Link className="btn btn--ghost btn--small" to="/ayuda">
              <Icon name="book" /> Manual
            </Link>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">
            <Icon name="robot" /> Lo verifica el sistema
          </h2>
          <p className="hint">Se actualiza solo con lo que pasa en los carriles.</p>
          <ul className="checklist">
            {auto.map((item) => (
              <li key={item.id} className={`check-item check-item--${item.status}`}>
                <Icon name={STATUS_ICON[item.status]} className="check-item__icon" />
                <div>
                  <div className="check-item__label">{item.label}</div>
                  {item.detail && <div className="check-item__detail">{item.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {MANUAL_ITEMS.map((group) => (
          <section key={group.group} className="card">
            <h2 className="card__title">{group.group}</h2>
            <ul className="checklist">
              {group.items.map(([id, label]) => (
                <li key={id}>
                  <label className={`check-item check-item--manual ${checked[id] ? 'check-item--ok' : ''}`}>
                    <input type="checkbox" checked={!!checked[id]} onChange={() => toggle(id)} />
                    <span className="check-item__label">{label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="muted small">
          Los tildes manuales se guardan en este navegador. Para imprimir el checklist usá la opción de imprimir del navegador.
        </p>
      </main>
    </>
  )
}
