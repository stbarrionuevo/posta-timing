import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'

export default function Login() {
  const { session, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (session) return <Navigate to={location.state?.from || '/'} replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch {
      setError('Email o contraseña incorrectos.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="card login__card" onSubmit={handleSubmit}>
        <h1 className="login__title">
          <Icon name="stopwatch" /> Postas
        </h1>
        <p className="muted">Ingresá con la cuenta que te dio la organización.</p>
        <label className="field">
          <span className="field__label">Email</span>
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Contraseña</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert alert--danger">{error}</div>}
        <button className="btn btn--primary btn--big" disabled={busy}>
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
        <Link to="/ayuda" className="muted small login__help">
          <Icon name="book" /> Manual de uso
        </Link>
      </form>
    </main>
  )
}
