import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEventLive } from '../../hooks/useEventLive'
import { fetchResultsExtras } from '../../services/resultsService'
import { buildResults, searchSwimmers } from '../../lib/results'
import { formatDate, formatMeters, formatRaceTime, formatSplit } from '../../lib/format'
import { exportResultsCsv, exportResultsPdf } from '../../lib/exportResults'
import { scoreboardUrl } from '../../lib/links'
import StatusBadge from '../../components/StatusBadge'
import Icon from '../../components/Icon'

const MIN_INTERVAL_MS = 5_000

export default function Results() {
  const { eventId } = useParams()
  const live = useEventLive(eventId, { minIntervalMs: MIN_INTERVAL_MS })
  const [extras, setExtras] = useState(null)
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!live.loadedFrom) return
    let cancelled = false
    fetchResultsExtras(eventId)
      .then((d) => !cancelled && setExtras(d))
      .catch(() => {
        // Si falla, se reintenta con la próxima recarga del bundle.
      })
    return () => {
      cancelled = true
    }
  }, [eventId, live.loadedFrom])

  const results = useMemo(
    () =>
      live.loaded && extras
        ? buildResults({ teams: live.teams, swimmers: live.swimmers, standings: live.standings, ...extras })
        : null,
    [live.loaded, live.teams, live.swimmers, live.standings, extras]
  )

  if (!live.loaded) {
    return (
      <main className="page">
        {live.error ? (
          <div className="card">
            <h1 className="card__title">Resultados no disponibles</h1>
            <p>El evento no existe o la organización no publicó sus resultados.</p>
          </div>
        ) : (
          <p className="muted">Cargando resultados…</p>
        )}
      </main>
    )
  }

  const { event } = live
  const found = results ? searchSwimmers(results, query) : []
  const provisional = event.status !== 'finished'

  const download = async (kind) => {
    setExporting(true)
    try {
      if (kind === 'pdf') await exportResultsPdf(event, results)
      else exportResultsCsv(event, results)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="results-page">
      <header className="results-hero">
        <div className="results-hero__inner">
          <div>
            <h1>{event.name}</h1>
            <div className="results-hero__sub">
              {[formatDate(event.event_date), event.venue, `${event.duration_seconds / 60} min`, `pileta ${event.pool_length_m} m`]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <StatusBadge status={event.status} />
        </div>
      </header>

      <main className="page">
        {provisional && (
          <div className="alert alert--warning">
            {event.status === 'running' || event.status === 'paused' ? (
              <>
                <Icon name="circle-dot" /> Evento en curso: los resultados se actualizan solos y son provisorios.{' '}
                <a href={scoreboardUrl(event.id)}>Ver marcador en vivo</a>
              </>
            ) : (
              'El evento todavía no empezó.'
            )}
          </div>
        )}

        <div className="results-tools">
          <label className="search">
            <Icon name="magnifying-glass" />
            <input
              className="input"
              type="search"
              placeholder="Buscar nadador por nombre o número"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="results-tools__downloads">
            <button className="btn btn--ghost btn--small" disabled={!results || exporting} onClick={() => download('pdf')}>
              <Icon name="file-pdf" /> PDF
            </button>
            <button className="btn btn--ghost btn--small" disabled={!results || exporting} onClick={() => download('csv')}>
              <Icon name="file-csv" /> CSV
            </button>
          </div>
        </div>

        {!results ? (
          <p className="muted">Cargando parciales…</p>
        ) : query.trim() ? (
          <SearchResults found={found} event={event} />
        ) : (
          <Standings results={results} event={event} />
        )}

        <p className="muted small results-foot">
          (M) pasada agregada por el juez. El tiempo de carrera se cuenta desde la largada e incluye pausas.
        </p>
        <Link to="/" className="muted small">Ingreso para organizadores</Link>
      </main>
    </div>
  )
}

function Standings({ results, event }) {
  const started = !!event.started_at
  return (
    <ol className="standings">
      {results.map((r) => (
        <li key={r.team.id}>
          <details className="card standing">
            <summary className="standing__summary">
              <span className="standing__pos">{started && r.standing?.position ? `${r.standing.position}°` : ''}</span>
              <span className="lane-chip" style={r.team.color ? { background: r.team.color } : undefined}>
                {r.team.lane_number}
              </span>
              <span className="standing__name">{r.team.name}</span>
              <span className="standing__laps muted">{r.standing?.laps ?? 0} pasadas</span>
              <span className="standing__meters">{formatMeters(r.standing?.total_meters)}</span>
              <Icon name="chevron-down" className="standing__chevron" />
            </summary>
            <TeamDetail result={r} event={event} />
          </details>
        </li>
      ))}
    </ol>
  )
}

function TeamDetail({ result, event }) {
  const adj = Number(result.standing?.penalty_meters ?? 0) + Number(result.standing?.manual_meters ?? 0)
  return (
    <div className="standing__detail">
      {adj !== 0 && <p className="hint">Incluye penalizaciones y ajustes del juez: {formatMeters(adj)}.</p>}
      <div className="table-wrap">
        <table className="table table--compact">
          <thead>
            <tr>
              <th>Nadador</th>
              <th className="num">Pas.</th>
              <th className="num hide-narrow">Metros</th>
              <th className="num">Mejor</th>
              <th className="num">Prom.</th>
            </tr>
          </thead>
          <tbody>
            {result.swimmers.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {!s.is_active && <span className="tag tag--muted">baja</span>}
                </td>
                <td className="num">{s.laps}</td>
                <td className="num hide-narrow">{formatMeters(s.meters)}</td>
                <td className="num">{formatSplit(s.bestSplit)}</td>
                <td className="num">{formatSplit(s.avgSplit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.laps.length > 0 && (
        <details className="laps-detail">
          <summary>Ver las {result.laps.length} pasadas</summary>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nadador</th>
                  <th className="num">Tiempo</th>
                  <th className="num">Parcial</th>
                  <th className="num">Acum.</th>
                </tr>
              </thead>
              <tbody>
                {result.laps.map((l) => (
                  <tr key={l.id}>
                    <td className="strong">
                      {l.number}
                      {l.manual && <span className="muted"> (M)</span>}
                    </td>
                    <td>{l.swimmerName}</td>
                    <td className="num">{formatRaceTime(l.occurredAt, event.started_at)}</td>
                    <td className="num">{formatSplit(l.split)}</td>
                    <td className="num">{formatMeters(l.cumulativeMeters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

function SearchResults({ found, event }) {
  if (found.length === 0) return <p className="empty">No se encontró ningún nadador.</p>
  return (
    <div className="swimmer-results">
      {found.map(({ swimmer, result }) => {
        const laps = result.laps.filter((l) => l.swimmerId === swimmer.id)
        return (
          <section key={swimmer.id} className="card">
            <div className="card__head">
              <div>
                <h2 className="card__title">{swimmer.name}</h2>
                <div className="muted small">
                  {result.team.name} · carril {result.team.lane_number}
                  {result.standing?.position ? ` · equipo ${result.standing.position}°` : ''}
                </div>
              </div>
            </div>
            <div className="swimmer-stats">
              <div><strong>{swimmer.laps}</strong><span>pasadas</span></div>
              <div><strong>{formatMeters(swimmer.meters)}</strong><span>nadados</span></div>
              <div><strong>{formatSplit(swimmer.bestSplit)}</strong><span>mejor parcial</span></div>
              <div><strong>{formatSplit(swimmer.avgSplit)}</strong><span>promedio</span></div>
            </div>
            {laps.length > 0 && (
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th>Pasada del equipo</th>
                    <th className="num">Tiempo</th>
                    <th className="num">Parcial</th>
                  </tr>
                </thead>
                <tbody>
                  {laps.map((l) => (
                    <tr key={l.id}>
                      <td>#{l.number}{l.manual && <span className="muted"> (M)</span>}</td>
                      <td className="num">{formatRaceTime(l.occurredAt, event.started_at)}</td>
                      <td className="num">{formatSplit(l.split)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
    </div>
  )
}
