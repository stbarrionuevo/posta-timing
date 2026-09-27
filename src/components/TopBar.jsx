import { useNavigate } from 'react-router-dom'
import Icon from './Icon'

const LIVE = {
  connected: { label: 'En vivo', className: 'live-dot--ok' },
  connecting: { label: 'Conectando…', className: 'live-dot--wait' },
  error: { label: 'Sin conexión en vivo', className: 'live-dot--bad' },
}

export default function TopBar({ title, subtitle, backTo, liveStatus, children }) {
  const navigate = useNavigate()
  const live = liveStatus && (LIVE[liveStatus] || LIVE.connecting)
  return (
    <header className="topbar">
      {backTo && (
        <button className="topbar__back" onClick={() => navigate(backTo)} aria-label="Volver">
          <Icon name="arrow-left" />
        </button>
      )}
      <div className="topbar__text">
        <div className="topbar__title">{title}</div>
        {subtitle && <div className="topbar__subtitle">{subtitle}</div>}
      </div>
      {live && (
        <span className="live">
          <span className={`live-dot ${live.className}`} />
          {live.label}
        </span>
      )}
      {children}
    </header>
  )
}
