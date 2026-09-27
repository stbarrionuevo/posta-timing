import { useState } from 'react'
import Icon from './Icon'
import { CATEGORIES } from '../lib/auditFormat'

const TONE_ICON = { danger: 'circle-exclamation', warn: 'pen', info: 'circle-info', muted: 'water' }

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return rows.map((r) => r.map(esc).join(',')).join('\r\n')
}

function downloadCsv(filename, rows) {
  // BOM para que Excel abra bien los acentos.
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Historial legible del evento. "Todo" oculta las pasadas normales (son la
// mayoría); se ven con el filtro "Pasadas".
export default function AuditHistory({ event, entries, ctx }) {
  const [category, setCategory] = useState('all')

  const visible = entries.filter((e) =>
    category === 'all' ? e.view.category !== 'laps' : e.view.category === category
  )
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]))
  entries.forEach((e) => {
    counts[e.view.category] = (counts[e.view.category] ?? 0) + 1
    if (e.view.category !== 'laps') counts.all++
  })

  const exportCsv = () =>
    downloadCsv(`auditoria-${event.name.replace(/\W+/g, '-')}-${event.event_date}.csv`, [
      ['Fecha y hora', 'Usuario', 'Qué pasó', 'Detalle', 'Motivo'],
      ...entries
        .slice()
        .reverse()
        .map((e) => [new Date(e.created_at).toLocaleString(), ctx.actorName(e.actor_id), e.view.title, e.view.detail, e.reason]),
    ])

  return (
    <section className="card">
      <div className="card__head">
        <div className="filter-chips">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={`filter-chip ${category === c.key ? 'filter-chip--active' : ''}`}
              onClick={() => setCategory(c.key)}
            >
              {c.label} <span className="muted">{counts[c.key]}</span>
            </button>
          ))}
        </div>
        <button className="btn btn--ghost btn--small" onClick={exportCsv}>
          <Icon name="file-csv" /> Descargar CSV
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="empty">Nada para mostrar con este filtro.</p>
      ) : (
        <ol className="audit-list">
          {visible.map((e) => (
            <li key={e.id} className={`audit-item audit-item--${e.view.tone}`}>
              <Icon name={TONE_ICON[e.view.tone]} className="audit-item__icon" />
              <div className="audit-item__body">
                <div className="audit-item__title">{e.view.title}</div>
                {e.view.detail && <div className="audit-item__detail">{e.view.detail}</div>}
                {e.reason && e.view.category !== 'rejects' && <div className="audit-item__reason">“{e.reason}”</div>}
              </div>
              <div className="audit-item__meta">
                <div>{new Date(e.created_at).toLocaleTimeString()}</div>
                <div className="muted">{ctx.actorName(e.actor_id)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
