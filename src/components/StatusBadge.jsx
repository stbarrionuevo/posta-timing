const LABELS = {
  draft: 'Borrador',
  ready: 'Listo para largar',
  running: 'En curso',
  paused: 'En pausa',
  finished: 'Finalizado',
}

export default function StatusBadge({ status }) {
  return <span className={`badge badge--${status}`}>{LABELS[status] ?? status}</span>
}
