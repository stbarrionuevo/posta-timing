import { useState } from 'react'
import Icon from './Icon'
import QrCode from './QrCode'
import { resultsUrl, scoreboardUrl } from '../lib/links'

function CopyLink({ label, url }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copiá el link:', url)
    }
  }
  return (
    <div className="share-link">
      <a href={url} target="_blank" rel="noreferrer" className="btn btn--ghost btn--small">
        <Icon name="arrow-up-right-from-square" /> {label}
      </a>
      <button className="icon-btn icon-btn--plain" onClick={copy} aria-label={`Copiar link de ${label}`}>
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </div>
  )
}

// Links del marcador (TV/proyector) y de resultados (celulares del público).
export default function ShareCard({ event }) {
  return (
    <section className="card">
      <div className="card__head">
        <h2 className="card__title">
          <Icon name="tv" /> Marcador y resultados
        </h2>
      </div>
      {!event.is_public && (
        <p className="hint">
          El evento no es público: solo lo ven usuarios de la organización con sesión iniciada. Activá "Marcador
          público" en Configuración para compartirlo.
        </p>
      )}
      <div className="share">
        <div className="share__links">
          <CopyLink label="Marcador (TV)" url={scoreboardUrl(event.id)} />
          <CopyLink label="Resultados" url={resultsUrl(event.id)} />
        </div>
        {event.is_public && (
          <div className="share__qr">
            <QrCode value={resultsUrl(event.id)} size={96} />
            <span className="muted small">QR de resultados</span>
          </div>
        )}
      </div>
    </section>
  )
}
