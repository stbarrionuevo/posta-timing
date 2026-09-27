import { useParams } from 'react-router-dom'
import { useEventLive } from '../../hooks/useEventLive'
import { sortByRelayOrder } from '../../lib/swimmerOrder'
import { sheetBoxes } from '../../lib/checklist'
import { formatDate } from '../../lib/format'
import { friendlyError } from '../../lib/errors'
import TopBar from '../../components/TopBar'
import Icon from '../../components/Icon'

// Planilla de respaldo por carril: el veedor tacha una casilla por pasada y
// anota el número de orden del nadador. Sirve si falla la tecnología y como
// evidencia ante un reclamo.
export default function PaperSheets() {
  const { eventId } = useParams()
  const live = useEventLive(eventId)

  if (!live.loaded) {
    return (
      <main className="page">
        {live.error ? <div className="alert alert--danger">{friendlyError(live.error)}</div> : <p className="muted">Cargando…</p>}
      </main>
    )
  }

  const { event, teams, swimmers } = live
  const boxes = sheetBoxes(event)

  return (
    <>
      <div className="no-print">
        <TopBar title="Planillas de papel" subtitle={event.name} backTo={`/juez/evento/${eventId}/checklist`}>
          <button className="topbar__action" onClick={() => window.print()}>
            <Icon name="print" /> Imprimir
          </button>
        </TopBar>
        <main className="page">
          <p className="hint">
            Se imprime una hoja por carril. Imprimilas después de cerrar el roster para que figuren todos los nadadores.
          </p>
        </main>
      </div>

      <div className="sheets">
        {teams.map((team) => {
          const teamSwimmers = sortByRelayOrder(swimmers.filter((s) => s.team_id === team.id && s.is_active))
          return (
            <section key={team.id} className="sheet">
              <header className="sheet__head">
                <div>
                  <div className="sheet__event">{event.name}</div>
                  <div className="sheet__meta">
                    {[formatDate(event.event_date), event.venue, `${event.duration_seconds / 60} min`, `pileta ${event.pool_length_m} m`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="sheet__lane">
                  <span>Carril</span>
                  <strong>{team.lane_number}</strong>
                </div>
              </header>
              <h2 className="sheet__team">{team.name}</h2>

              <div className="sheet__swimmers">
                <span className="sheet__label">Orden:</span>
                {teamSwimmers.map((s, i) => (
                  <span key={s.id} className="sheet__swimmer">
                    <strong>{s.relay_order ?? i + 1}</strong> {s.name}
                  </span>
                ))}
              </div>
              <p className="sheet__instructions">
                Por cada pasada completa, tachá la casilla que sigue y anotá el número de orden del nadador. Si hay una
                duda, marcala con un círculo y avisale al juez.
              </p>

              <div className="sheet__grid">
                {Array.from({ length: boxes }, (_, i) => (
                  <div key={i} className="sheet__box">
                    <span>{i + 1}</span>
                  </div>
                ))}
              </div>

              <footer className="sheet__foot">
                <div>Total de pasadas: ________</div>
                <div>Veedor: ______________________</div>
                <div>Firma: ________________</div>
              </footer>
            </section>
          )
        })}
      </div>
    </>
  )
}
