import { useState } from 'react'
import Icon from './Icon'
import { ConfirmDialog } from './Modal'
import { parseTs } from '../lib/eventClock'
import { suggestLapTime } from '../lib/manualLap'
import { formatRaceTime } from '../lib/format'
import {
  addAdjustment,
  addLapAsJudge,
  reassignLap,
  removeAdjustment,
  restoreLap,
  voidLapAsJudge,
} from '../services/correctionsService'

const ADJUSTMENT_KINDS = [
  { value: 'penalty', label: 'Penalización (resta metros)' },
  { value: 'partial_lap', label: 'Pasada incompleta al final' },
  { value: 'manual', label: 'Ajuste manual (+/−)' },
]
const KIND_LABEL = { penalty: 'Penalización', partial_lap: 'Pasada incompleta', manual: 'Ajuste manual' }

const raceTime = formatRaceTime

function SwimmerSelect({ swimmers, value, onChange }) {
  return (
    <label className="field">
      <span className="field__label">Nadador</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Elegí un nadador</option>
        {swimmers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.relay_order ? `${s.relay_order}. ` : ''}
            {s.name}
            {s.is_active ? '' : ' (baja)'}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function LapsCorrections({ live, data, ctx, onChanged }) {
  const { event, teams, standings } = live
  const [teamId, setTeamId] = useState(teams[0]?.id)
  const [dialog, setDialog] = useState(null)
  const team = teams.find((t) => t.id === teamId)

  if (!team) return <p className="empty">El evento no tiene equipos.</p>

  const standing = standings.find((s) => s.team_id === teamId)
  const splitByLap = new Map(data.splits.map((s) => [s.lap_id, s]))
  const teamLaps = data.laps.filter((l) => l.team_id === teamId)
  const validLaps = teamLaps.filter((l) => l.status === 'valid')
  const adjustments = data.adjustments.filter((a) => a.team_id === teamId)
  const swimmers = ctx.teamSwimmers(teamId)
  const started = !!event.started_at

  const act = (fn) => async (...args) => {
    await fn(...args)
    await onChanged()
  }

  const openAddLap = () => {
    const endMs =
      event.status === 'finished' ? parseTs(event.finished_at)
      : event.status === 'paused' ? parseTs(event.paused_at)
      : parseTs(event.started_at) + (event.duration_seconds + Number(event.paused_seconds)) * 1000
    const limitMs = Math.min(Date.now(), endMs)
    const startedMs = parseTs(event.started_at)
    const timeFor = (after) => suggestLapTime(validLaps, after, startedMs, limitMs)
    setDialog({
      title: `Agregar pasada olvidada · ${ctx.teamLabel(teamId)}`,
      message: 'Para un toque que el operador no marcó. Queda registrada como pasada manual del juez.',
      confirmLabel: 'Agregar pasada',
      requireReason: true,
      reasonLabel: 'Motivo (ej.: confirmado por el veedor del carril)',
      initialValues: { after: validLaps.length, swimmerId: null },
      isValid: (v) => !!v.swimmerId,
      renderFields: ({ values, setValue }) => (
        <>
          <label className="field">
            <span className="field__label">¿Dónde falta la pasada?</span>
            <select className="input" value={values.after} onChange={(e) => setValue('after', Number(e.target.value))}>
              <option value={0}>Antes de la primera pasada</option>
              {validLaps.map((l, i) => (
                <option key={l.id} value={i + 1}>
                  Después de la pasada #{i + 1} ({ctx.swimmerName(l.swimmer_id)}, {raceTime(l.occurred_at, event.started_at)})
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Hora que se registra: {raceTime(new Date(timeFor(values.after)).toISOString(), event.started_at)} de carrera
            (punto medio entre las pasadas vecinas).
          </p>
          <SwimmerSelect swimmers={swimmers} value={values.swimmerId} onChange={(id) => setValue('swimmerId', id)} />
        </>
      ),
      onConfirm: act((reason, v) => addLapAsJudge(teamId, v.swimmerId, new Date(timeFor(v.after)).toISOString(), reason)),
    })
  }

  const openAdjustment = () =>
    setDialog({
      title: `Penalización o ajuste · ${ctx.teamLabel(teamId)}`,
      confirmLabel: 'Aplicar',
      requireReason: true,
      initialValues: { kind: 'penalty', meters: String(event.pool_length_m) },
      isValid: (v) => Number(v.meters) !== 0 && !Number.isNaN(Number(v.meters)),
      renderFields: ({ values, setValue }) => (
        <>
          <label className="field">
            <span className="field__label">Tipo</span>
            <select className="input" value={values.kind} onChange={(e) => setValue('kind', e.target.value)}>
              {ADJUSTMENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">
              Metros {values.kind === 'penalty' ? '(se restan)' : values.kind === 'manual' ? '(negativo para restar)' : ''}
            </span>
            <input className="input" type="number" step="0.5" value={values.meters} onChange={(e) => setValue('meters', e.target.value)} />
          </label>
        </>
      ),
      onConfirm: act((reason, v) => {
        const m = Number(v.meters)
        const meters = v.kind === 'penalty' ? -Math.abs(m) : v.kind === 'partial_lap' ? Math.abs(m) : m
        return addAdjustment(teamId, v.kind, meters, reason)
      }),
    })

  return (
    <div className="corrections">
      <div className="team-chips">
        {teams.map((t) => {
          const st = standings.find((s) => s.team_id === t.id)
          return (
            <button key={t.id} className={`team-chip ${t.id === teamId ? 'team-chip--active' : ''}`} onClick={() => setTeamId(t.id)}>
              <span className="lane-chip" style={t.color ? { background: t.color } : undefined}>{t.lane_number}</span>
              <span>
                <span className="strong">{t.name}</span>
                <span className="muted small"> {Number(st?.total_meters ?? 0)} m</span>
              </span>
            </button>
          )
        })}
      </div>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">
            {ctx.teamLabel(teamId)} · {standing?.laps ?? 0} pasadas · {Number(standing?.total_meters ?? 0)} m
          </h2>
          <div className="card__actions">
            <button className="btn btn--primary btn--small" disabled={!started || swimmers.length === 0} onClick={openAddLap}>
              <Icon name="plus" /> Pasada olvidada
            </button>
            <button className="btn btn--ghost btn--small" disabled={!started} onClick={openAdjustment}>
              <Icon name="scale-balanced" /> Penalización / ajuste
            </button>
          </div>
        </div>

        {teamLaps.length === 0 ? (
          <p className="empty">Sin pasadas registradas.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nadador</th>
                  <th className="num">Tiempo</th>
                  <th className="num">Parcial</th>
                  <th>Origen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {teamLaps.map((l) => {
                  const split = splitByLap.get(l.id)
                  const isVoid = l.status === 'void'
                  return (
                    <tr key={l.id} className={isVoid ? 'row--void' : ''}>
                      <td className="strong">{isVoid ? '—' : split?.lap_number}</td>
                      <td>
                        {ctx.swimmerName(l.swimmer_id)}
                        {isVoid && <div className="lane-alert lane-alert--danger">Anulada: {l.void_reason}</div>}
                      </td>
                      <td className="num">{raceTime(l.occurred_at, event.started_at)}</td>
                      <td className="num">{split ? `${Number(split.split_seconds).toFixed(1)} s` : ''}</td>
                      <td>
                        {l.source === 'judge' ? (
                          <span className="tag">manual</span>
                        ) : (
                          <span className="muted small">{ctx.actorName(l.recorded_by)}</span>
                        )}
                        {split?.synced_late && <span className="tag tag--muted">llegó tarde</span>}
                      </td>
                      <td className="actions-cell">
                        {isVoid ? (
                          <button
                            className="btn btn--ghost btn--small"
                            onClick={() =>
                              setDialog({
                                title: 'Restaurar pasada',
                                message: `Vuelve a contar la pasada de ${ctx.swimmerName(l.swimmer_id)}.`,
                                confirmLabel: 'Restaurar',
                                requireReason: true,
                                onConfirm: act((reason) => restoreLap(l.id, reason)),
                              })
                            }
                          >
                            Restaurar
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn btn--ghost btn--small"
                              onClick={() =>
                                setDialog({
                                  title: `Reasignar pasada #${split?.lap_number}`,
                                  message: `Hoy figura como de ${ctx.swimmerName(l.swimmer_id)}.`,
                                  confirmLabel: 'Reasignar',
                                  requireReason: true,
                                  initialValues: { swimmerId: null },
                                  isValid: (v) => v.swimmerId && v.swimmerId !== l.swimmer_id,
                                  renderFields: ({ values, setValue }) => (
                                    <SwimmerSelect swimmers={swimmers} value={values.swimmerId} onChange={(id) => setValue('swimmerId', id)} />
                                  ),
                                  onConfirm: act((reason, v) => reassignLap(l.id, v.swimmerId, reason)),
                                })
                              }
                            >
                              Reasignar
                            </button>
                            <button
                              className="btn btn--ghost btn--small btn--danger-text"
                              onClick={() =>
                                setDialog({
                                  title: `Anular pasada #${split?.lap_number}`,
                                  message: `Deja de contar la pasada de ${ctx.swimmerName(l.swimmer_id)}. Se puede restaurar.`,
                                  confirmLabel: 'Anular',
                                  danger: true,
                                  requireReason: true,
                                  onConfirm: act((reason) => voidLapAsJudge(l.id, reason)),
                                })
                              }
                            >
                              Anular
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adjustments.length > 0 && (
        <section className="card">
          <h2 className="card__title">Penalizaciones y ajustes</h2>
          <ul className="adjustments">
            {adjustments.map((a) => (
              <li key={a.id}>
                <span>
                  <span className="strong">{KIND_LABEL[a.kind]} {Number(a.meters) > 0 ? '+' : ''}{Number(a.meters)} m</span>
                  <span className="muted small"> · {a.reason} · {ctx.actorName(a.created_by)}</span>
                </span>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    setDialog({
                      title: 'Quitar ajuste',
                      message: `${KIND_LABEL[a.kind]} ${Number(a.meters)} m. Queda en el historial.`,
                      confirmLabel: 'Quitar',
                      requireReason: true,
                      onConfirm: act((reason) => removeAdjustment(a.id, reason)),
                    })
                  }
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog && <ConfirmDialog key={dialog.title} {...dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}
