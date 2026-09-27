import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { addMember, listMembers, removeMember, setMemberPassword, updateMember } from '../../services/usersService'
import { friendlyError } from '../../lib/errors'
import { generatePassword } from '../../lib/password'
import TopBar from '../../components/TopBar'
import Icon from '../../components/Icon'
import { ConfirmDialog } from '../../components/Modal'

const ROLES = [
  { value: 'operator', label: 'Operador', help: 'Marca pasadas en un carril.' },
  { value: 'judge', label: 'Juez', help: 'Crea y maneja eventos, corrige y ve la auditoría.' },
  { value: 'admin', label: 'Administrador', help: 'Todo lo del juez, más los usuarios.' },
]
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]))
const ROLE_PLURAL = { operator: ['operador', 'operadores'], judge: ['juez', 'jueces'], admin: ['administrador', 'administradores'] }
const loginUrl = () => `${window.location.origin}${window.location.pathname}#/login`

function formatLastSignIn(ts) {
  if (!ts) return 'Nunca'
  return new Date(ts).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

// Datos para pasarle a la persona (copiar y mandar por WhatsApp, o imprimir).
function Credentials({ credentials, onClose }) {
  const [copied, setCopied] = useState(false)
  const text = `Postas — acceso\nIngresá en: ${loginUrl()}\nUsuario: ${credentials.email}\nContraseña: ${credentials.password}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      window.prompt('Copiá los datos:', text)
    }
  }
  return (
    <section className="card credentials">
      <div className="card__head">
        <h2 className="card__title">
          <Icon name="key" /> Datos de acceso de {credentials.name || credentials.email}
        </h2>
        <button className="icon-btn icon-btn--plain" onClick={onClose} aria-label="Cerrar">
          <Icon name="xmark" />
        </button>
      </div>
      <pre className="credentials__text">{text}</pre>
      <p className="hint">La contraseña no se vuelve a mostrar. Si se pierde, generá una nueva desde la lista.</p>
      <button className="btn btn--primary btn--small" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copiado' : 'Copiar datos'}
      </button>
    </section>
  )
}

function NewUserForm({ organizationId, onCreated }) {
  const [form, setForm] = useState(() => ({ name: '', email: '', role: 'operator', password: generatePassword() }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { created } = await addMember(organizationId, {
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        displayName: form.name.trim(),
      })
      onCreated({ created, name: form.name.trim(), email: form.email.trim().toLowerCase(), password: form.password })
      setForm((f) => ({ ...f, name: '', email: '', password: generatePassword() }))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">
        <Icon name="user-plus" /> Nuevo usuario
      </h2>
      <form className="form" onSubmit={handleSubmit}>
        <div className="form__row">
          <label className="field">
            <span className="field__label">Nombre (como aparece en el historial)</span>
            <input className="input" value={form.name} onChange={set('name')} placeholder="Ej.: Laura - carril 3" required />
          </label>
          <label className="field">
            <span className="field__label">Email (es el usuario para ingresar)</span>
            <input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="off" />
          </label>
        </div>
        <div className="form__row">
          <label className="field">
            <span className="field__label">Rol</span>
            <select className="input" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label} — {r.help}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Contraseña inicial</span>
            <span className="input-with-btn">
              <input className="input input--mono" value={form.password} onChange={set('password')} minLength={8} required autoComplete="new-password" />
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))} aria-label="Generar otra">
                <Icon name="rotate" />
              </button>
            </span>
          </label>
        </div>
        <p className="hint">
          Si el email ya tiene cuenta (por ejemplo, de otra organización), se suma a esta con su contraseña actual.
        </p>
        {error && <div className="alert alert--danger">{friendlyError(error)}</div>}
        <div className="form__actions">
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default function AdminUsers() {
  const { memberships, user } = useAuth()
  const adminOrgs = memberships.filter((m) => m.role === 'admin')
  const [orgId, setOrgId] = useState(adminOrgs[0]?.organizationId)
  const [members, setMembers] = useState(null)
  const [error, setError] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [credentials, setCredentials] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      setMembers(await listMembers(orgId))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  const run = (fn) => async (...args) => {
    await fn(...args)
    await load()
  }

  const onCreated = async ({ created, name, email, password }) => {
    await load()
    if (created) {
      setCredentials({ name, email, password })
      setNotice(null)
    } else {
      setCredentials(null)
      setNotice(`${email} ya tenía cuenta: se sumó a la organización y sigue usando su contraseña actual.`)
    }
  }

  const org = adminOrgs.find((o) => o.organizationId === orgId)
  const counts = (members ?? []).reduce((acc, m) => ({ ...acc, [m.role]: (acc[m.role] ?? 0) + 1 }), {})

  return (
    <>
      <TopBar title="Usuarios" subtitle={org?.organizationName} backTo="/juez" />
      <main className="page">
        {adminOrgs.length > 1 && (
          <label className="field">
            <span className="field__label">Organización</span>
            <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {adminOrgs.map((o) => (
                <option key={o.organizationId} value={o.organizationId}>{o.organizationName}</option>
              ))}
            </select>
          </label>
        )}

        {credentials && <Credentials credentials={credentials} onClose={() => setCredentials(null)} />}
        {notice && <div className="alert alert--warning">{notice}</div>}

        <NewUserForm key={orgId} organizationId={orgId} onCreated={onCreated} />

        <section className="card">
          <div className="card__head">
            <h2 className="card__title">
              <Icon name="users" /> Miembros
            </h2>
            {members && (
              <span className="muted small">
                {ROLES.map((r) => `${counts[r.value] ?? 0} ${ROLE_PLURAL[r.value][(counts[r.value] ?? 0) === 1 ? 0 : 1]}`).join(' · ')}
              </span>
            )}
          </div>
          {error && <div className="alert alert--danger">{friendlyError(error)}</div>}
          {members === null && !error ? (
            <p className="muted">Cargando…</p>
          ) : (
            <div className="table-wrap">
              <table className="table members">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Rol</th>
                    <th>Último ingreso</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(members ?? []).map((m) => {
                    const isMe = m.user_id === user?.id
                    return (
                      <tr key={m.user_id}>
                        <td>
                          <div className="strong">
                            {m.display_name || <span className="muted">Sin nombre</span>}
                            {isMe && <span className="tag tag--muted">vos</span>}
                          </div>
                          <div className="muted small">{m.email}</div>
                        </td>
                        <td>
                          <select
                            className="input input--compact"
                            value={m.role}
                            aria-label={`Rol de ${m.display_name || m.email}`}
                            onChange={(e) => {
                              const role = e.target.value
                              setDialog({
                                title: 'Cambiar rol',
                                message: `${m.display_name || m.email}: ${ROLE_LABEL[m.role]} → ${ROLE_LABEL[role]}.${isMe ? ' Es tu propio usuario: podés perder el acceso a esta pantalla.' : ''}`,
                                confirmLabel: 'Cambiar',
                                danger: isMe,
                                onConfirm: run(() => updateMember(orgId, m.user_id, { role })),
                              })
                            }}
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="small">{formatLastSignIn(m.last_sign_in_at)}</td>
                        <td className="actions-cell">
                          <button
                            className="btn btn--ghost btn--small"
                            onClick={() =>
                              setDialog({
                                title: 'Cambiar nombre',
                                confirmLabel: 'Guardar',
                                initialValues: { name: m.display_name ?? '' },
                                isValid: (v) => v.name.trim().length > 0,
                                renderFields: ({ values, setValue }) => (
                                  <label className="field">
                                    <span className="field__label">Nombre</span>
                                    <input className="input" value={values.name} onChange={(e) => setValue('name', e.target.value)} autoFocus />
                                  </label>
                                ),
                                onConfirm: run((_, v) => updateMember(orgId, m.user_id, { display_name: v.name.trim() })),
                              })
                            }
                          >
                            <Icon name="pen" />
                          </button>
                          <button
                            className="btn btn--ghost btn--small"
                            onClick={() =>
                              setDialog({
                                title: `Nueva contraseña para ${m.display_name || m.email}`,
                                message: 'La contraseña actual deja de funcionar.',
                                confirmLabel: 'Cambiar contraseña',
                                initialValues: { password: generatePassword() },
                                isValid: (v) => v.password.length >= 8,
                                renderFields: ({ values, setValue }) => (
                                  <label className="field">
                                    <span className="field__label">Contraseña nueva</span>
                                    <input className="input input--mono" value={values.password} onChange={(e) => setValue('password', e.target.value)} />
                                  </label>
                                ),
                                onConfirm: async (_, v) => {
                                  await setMemberPassword(orgId, m.user_id, v.password)
                                  setCredentials({ name: m.display_name, email: m.email, password: v.password })
                                },
                              })
                            }
                          >
                            <Icon name="key" />
                          </button>
                          <button
                            className="btn btn--ghost btn--small btn--danger-text"
                            onClick={() =>
                              setDialog({
                                title: `Quitar a ${m.display_name || m.email}`,
                                message: isMe
                                  ? 'Es tu propio usuario: vas a perder el acceso a esta organización.'
                                  : 'Deja de tener acceso a esta organización. Su historial se conserva.',
                                confirmLabel: 'Quitar',
                                danger: true,
                                onConfirm: run(() => removeMember(orgId, m.user_id)),
                              })
                            }
                          >
                            <Icon name="user-minus" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      {dialog && <ConfirmDialog key={dialog.title} {...dialog} onClose={() => setDialog(null)} />}
    </>
  )
}
