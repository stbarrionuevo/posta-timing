import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { createEvent, fetchEvents } from '../../services/eventsService'
import { friendlyError } from '../../lib/errors'
import { JUDGE_ROLES } from '../../lib/roles'
import TopBar from '../../components/TopBar'
import StatusBadge from '../../components/StatusBadge'
import EventConfigForm from '../../components/EventConfigForm'
import Icon from '../../components/Icon'

const ORG_KEY = 'postas:org'

function readStoredOrg() {
  try {
    return localStorage.getItem(ORG_KEY)
  } catch {
    return null
  }
}

export default function JudgeEvents() {
  const { memberships, user, signOut } = useAuth()
  const navigate = useNavigate()
  const orgs = memberships.filter((m) => JUDGE_ROLES.includes(m.role))
  const [orgId, setOrgId] = useState(() => {
    const stored = readStoredOrg()
    return orgs.some((o) => o.organizationId === stored) ? stored : orgs[0]?.organizationId
  })
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setEvents(await fetchEvents(orgId))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  function selectOrg(id) {
    setOrgId(id)
    try {
      localStorage.setItem(ORG_KEY, id)
    } catch {
      // Solo es una preferencia.
    }
  }

  const org = orgs.find((o) => o.organizationId === orgId)

  return (
    <>
      <TopBar title="Eventos" subtitle={org?.organizationName}>
        {org?.role === 'admin' && (
          <Link to="/admin/usuarios" className="topbar__action">
            <Icon name="users-gear" /> Usuarios
          </Link>
        )}
        <button className="topbar__action" onClick={signOut} title={user?.email}>
          <Icon name="right-from-bracket" /> Salir
        </button>
      </TopBar>
      <main className="page">
        {orgs.length > 1 && (
          <label className="field">
            <span className="field__label">Organización</span>
            <select className="input" value={orgId} onChange={(e) => selectOrg(e.target.value)}>
              {orgs.map((o) => (
                <option key={o.organizationId} value={o.organizationId}>{o.organizationName}</option>
              ))}
            </select>
          </label>
        )}

        {creating ? (
          <section className="card">
            <h2 className="card__title">Nuevo evento</h2>
            <EventConfigForm
              submitLabel="Crear evento"
              onCancel={() => setCreating(false)}
              onSubmit={async (config) => {
                const created = await createEvent(orgId, config)
                navigate(`/juez/evento/${created.id}`)
              }}
            />
          </section>
        ) : (
          <button className="btn btn--primary btn--big" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nuevo evento
          </button>
        )}

        {error && <div className="alert alert--danger">{friendlyError(error)}</div>}

        <section className="event-list">
          {events === null && !error && <p className="muted">Cargando eventos…</p>}
          {events?.length === 0 && <p className="empty">Todavía no hay eventos.</p>}
          {events?.map((ev) => (
            <Link key={ev.id} to={`/juez/evento/${ev.id}`} className="card event-item">
              <div>
                <div className="strong">{ev.name}</div>
                <div className="muted small">
                  {ev.event_date}
                  {ev.venue && ` · ${ev.venue}`} · {ev.duration_seconds / 60} min · {ev.pool_length_m} m
                </div>
              </div>
              <StatusBadge status={ev.status} />
            </Link>
          ))}
        </section>
      </main>
    </>
  )
}
