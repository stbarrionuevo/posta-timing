import { useState } from 'react'
import Icon from './Icon'
import { ConfirmDialog } from './Modal'
import { friendlyError } from '../lib/errors'
import {
  createSwimmer,
  createTeam,
  deleteSwimmer,
  deleteTeam,
  judgeAddSwimmer,
  judgeSetSwimmerActive,
} from '../services/eventsService'

const nextRelayOrder = (teamSwimmers) =>
  teamSwimmers.reduce((max, s) => Math.max(max, s.relay_order ?? 0), 0) + 1

// Roster abierto (borrador / listo): se edita libremente.
// Roster cerrado (en curso / pausa): solo altas y bajas con motivo, auditadas.
export default function RosterCard({ event, teams, swimmers, onChanged }) {
  const open = event.status === 'draft' || event.status === 'ready'
  const locked = event.status === 'running' || event.status === 'paused'
  const [error, setError] = useState(null)
  const [dialog, setDialog] = useState(null)

  const guard = (fn) => async (...args) => {
    setError(null)
    try {
      await fn(...args)
      await onChanged()
      return true
    } catch (err) {
      setError(err)
      return false
    }
  }

  const nextLane = teams.reduce((max, t) => Math.max(max, t.lane_number), 0) + 1

  return (
    <section className="card">
      <div className="card__head">
        <h2 className="card__title">
          <Icon name="users" /> Roster
        </h2>
        <span className={`pill ${open ? 'pill--ok' : 'pill--muted'}`}>
          <Icon name={open ? 'lock-open' : 'lock'} /> {open ? 'Abierto' : 'Cerrado'}
        </span>
      </div>

      {locked && (
        <p className="hint">
          El evento está en curso. Las altas y bajas requieren motivo y quedan registradas en la auditoría.
        </p>
      )}
      {error && <div className="alert alert--danger">{friendlyError(error)}</div>}

      <div className="roster">
        {teams.map((team) => {
          const teamSwimmers = swimmers.filter((s) => s.team_id === team.id)
          return (
            <div key={team.id} className="roster__team">
              <div className="roster__team-head">
                <span className="lane-chip" style={team.color ? { background: team.color } : undefined}>
                  {team.lane_number}
                </span>
                <span className="strong">{team.name}</span>
                <span className="muted small">{teamSwimmers.filter((s) => s.is_active).length} nadadores</span>
                {open && (
                  <button
                    className="icon-btn"
                    aria-label={`Eliminar ${team.name}`}
                    onClick={() =>
                      setDialog({
                        title: `Eliminar ${team.name}`,
                        message: 'Se eliminan el equipo y sus nadadores.',
                        confirmLabel: 'Eliminar',
                        danger: true,
                        onConfirm: guard(() => deleteTeam(team.id)),
                      })
                    }
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>

              <ol className="roster__swimmers">
                {teamSwimmers.map((s) => (
                  <li key={s.id} className={s.is_active ? '' : 'inactive'}>
                    <span>
                      {s.name}
                      {s.bib_number && <span className="muted small"> #{s.bib_number}</span>}
                      {s.added_after_lock && <span className="tag">alta tardía</span>}
                      {!s.is_active && <span className="tag tag--muted">baja</span>}
                    </span>
                    {open && (
                      <button className="icon-btn" aria-label={`Quitar ${s.name}`} onClick={guard(() => deleteSwimmer(s.id))}>
                        <Icon name="xmark" />
                      </button>
                    )}
                    {locked && (
                      <button
                        className="btn btn--ghost btn--small"
                        onClick={() =>
                          setDialog({
                            title: s.is_active ? `Dar de baja a ${s.name}` : `Reincorporar a ${s.name}`,
                            message: s.is_active
                              ? 'Sus pasadas ya registradas se mantienen.'
                              : 'Vuelve a estar disponible para nadar.',
                            confirmLabel: s.is_active ? 'Dar de baja' : 'Reincorporar',
                            requireReason: true,
                            onConfirm: async (reason) => {
                              await judgeSetSwimmerActive(s.id, !s.is_active, reason)
                              await onChanged()
                            },
                          })
                        }
                      >
                        {s.is_active ? 'Baja' : 'Reincorporar'}
                      </button>
                    )}
                  </li>
                ))}
              </ol>

              {open && (
                <AddSwimmerForm
                  onAdd={guard((data) => createSwimmer(team.id, { ...data, relayOrder: nextRelayOrder(teamSwimmers) }))}
                />
              )}
              {locked && (
                <AddSwimmerForm
                  label="Alta tardía"
                  onAdd={(data) =>
                    setDialog({
                      title: `Alta tardía en ${team.name}`,
                      message: `Agregar a ${data.name} con el evento en curso.`,
                      confirmLabel: 'Agregar',
                      requireReason: true,
                      onConfirm: async (reason) => {
                        await judgeAddSwimmer(team.id, { ...data, relayOrder: nextRelayOrder(teamSwimmers) }, reason)
                        await onChanged()
                      },
                    })
                  }
                />
              )}
            </div>
          )
        })}
      </div>

      {open && <AddTeamForm defaultLane={nextLane} onAdd={guard((data) => createTeam(event.id, data))} />}

      {dialog && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} />}
    </section>
  )
}

function AddSwimmerForm({ onAdd, label = 'Agregar' }) {
  const [name, setName] = useState('')
  const [bibNumber, setBibNumber] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    // onAdd devuelve false si falló: se conserva lo escrito para reintentar.
    if ((await onAdd({ name: name.trim(), bibNumber: bibNumber.trim() })) === false) return
    setName('')
    setBibNumber('')
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <input className="input" placeholder="Nombre del nadador" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input input--short" placeholder="N.º" value={bibNumber} onChange={(e) => setBibNumber(e.target.value)} />
      <button className="btn btn--ghost btn--small" disabled={!name.trim()}>
        <Icon name="user-plus" /> {label}
      </button>
    </form>
  )
}

function AddTeamForm({ defaultLane, onAdd }) {
  const [name, setName] = useState('')
  const [lane, setLane] = useState('')
  const [color, setColor] = useState('#0e5c73')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    if ((await onAdd({ name: name.trim(), laneNumber: Number(lane) || defaultLane, color })) === false) return
    setName('')
    setLane('')
  }

  return (
    <form className="inline-form inline-form--team" onSubmit={handleSubmit}>
      <input className="input" placeholder="Nombre del equipo" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="input input--short"
        type="number"
        min="1"
        placeholder={`Carril ${defaultLane}`}
        value={lane}
        onChange={(e) => setLane(e.target.value)}
      />
      <input className="input input--color" type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color del equipo" />
      <button className="btn btn--primary btn--small" disabled={!name.trim()}>
        <Icon name="plus" /> Equipo
      </button>
    </form>
  )
}
