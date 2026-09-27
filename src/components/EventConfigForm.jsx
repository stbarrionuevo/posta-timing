import { useState } from 'react'
import { friendlyError } from '../lib/errors'

const POLICIES = [
  { value: 'ignore', label: 'No cuenta' },
  { value: 'proportional', label: 'Suma sus metros' },
  { value: 'tiebreak_only', label: 'Solo para desempatar' },
]

export function eventToForm(event) {
  return {
    name: event?.name ?? '',
    venue: event?.venue ?? '',
    event_date: event?.event_date ?? new Date().toISOString().slice(0, 10),
    pool_length_m: event?.pool_length_m ?? 25,
    duration_minutes: event ? event.duration_seconds / 60 : 30,
    min_lap_seconds: event?.min_lap_seconds ?? 8,
    partial_lap_policy: event?.partial_lap_policy ?? 'ignore',
    is_public: event?.is_public ?? false,
    auto_rotate: event?.auto_rotate ?? true,
  }
}

function formToPatch(form) {
  return {
    name: form.name.trim(),
    venue: form.venue.trim() || null,
    event_date: form.event_date,
    pool_length_m: Number(form.pool_length_m),
    duration_seconds: Math.round(Number(form.duration_minutes) * 60),
    min_lap_seconds: Number(form.min_lap_seconds),
    partial_lap_policy: form.partial_lap_policy,
    is_public: form.is_public,
    auto_rotate: form.auto_rotate,
  }
}

export default function EventConfigForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => eventToForm(initial))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const valid = form.name.trim() && Number(form.duration_minutes) > 0 && form.event_date

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(formToPatch(form))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Nombre del evento</span>
        <input className="input" value={form.name} onChange={set('name')} required />
      </label>
      <div className="form__row">
        <label className="field">
          <span className="field__label">Fecha</span>
          <input className="input" type="date" value={form.event_date} onChange={set('event_date')} required />
        </label>
        <label className="field">
          <span className="field__label">Sede</span>
          <input className="input" value={form.venue} onChange={set('venue')} />
        </label>
      </div>
      <div className="form__row">
        <label className="field">
          <span className="field__label">Largo de pileta</span>
          <select className="input" value={form.pool_length_m} onChange={set('pool_length_m')}>
            <option value={25}>25 m</option>
            <option value={50}>50 m</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Duración (minutos)</span>
          <input className="input" type="number" min="1" step="1" value={form.duration_minutes} onChange={set('duration_minutes')} required />
        </label>
      </div>
      <div className="form__row">
        <label className="field">
          <span className="field__label">Anti doble toque (segundos)</span>
          <input className="input" type="number" min="0" step="1" value={form.min_lap_seconds} onChange={set('min_lap_seconds')} />
        </label>
        <label className="field">
          <span className="field__label">Pasada incompleta al final</span>
          <select className="input" value={form.partial_lap_policy} onChange={set('partial_lap_policy')}>
            {POLICIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={form.auto_rotate} onChange={set('auto_rotate')} />
        Rotación automática: después de cada pasada entra el siguiente nadador del orden
      </label>
      <label className="check">
        <input type="checkbox" checked={form.is_public} onChange={set('is_public')} />
        Marcador público (visible sin iniciar sesión)
      </label>
      {error && <div className="alert alert--danger">{friendlyError(error)}</div>}
      <div className="form__actions">
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancelar</button>
        )}
        <button className="btn btn--primary" disabled={!valid || busy}>
          {busy ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
