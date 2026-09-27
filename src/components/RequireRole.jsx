import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RequireRole({ roles, deniedText, children }) {
  const { session, memberships, loading, error, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <main className="page"><p className="muted">Cargando…</p></main>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  if (error || !memberships.some((m) => roles.includes(m.role))) {
    return (
      <main className="page">
        <div className="card">
          <h1 className="card__title">Sin acceso</h1>
          <p>{error ? 'No se pudieron cargar tus permisos.' : deniedText}</p>
          <button className="btn btn--ghost" onClick={signOut}>Cerrar sesión</button>
        </div>
      </main>
    )
  }

  return children
}
