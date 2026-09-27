// Lógica de la Edge Function admin-users, sin dependencias de Deno para poder
// probarla con Node (handler.test.js).
//
// Acciones (body JSON):
//   { action: 'ensure_user', organization_id, email, password? }
//       Devuelve el id del usuario con ese email; si no existe lo crea (con
//       email confirmado). A un usuario existente NO se le cambia la contraseña.
//       La membresía la inserta después el admin desde la app (queda auditada).
//   { action: 'set_password', organization_id, user_id, password }
//       Solo si el usuario pertenece únicamente a organizaciones donde quien
//       lo pide es admin (evita tomar cuentas de otra organización).
//
// db: { membershipsOf(userId), findUserIdByEmail(email), createUser(email, password),
//       setPassword(userId, password), audit(row) }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MIN_PASSWORD = 8

const fail = (status, error) => ({ status, body: { error } })
const ok = (body) => ({ status: 200, body })

async function requireAdmin(db, callerId, organizationId) {
  const mine = await db.membershipsOf(callerId)
  return mine.some((m) => m.organization_id === organizationId && m.role === 'admin') ? mine : null
}

export async function handleAction(body, callerId, db) {
  const { action, organization_id: orgId } = body ?? {}
  if (!callerId) return fail(401, 'UNAUTHORIZED: iniciá sesión')
  if (!orgId) return fail(400, 'BAD_REQUEST: falta la organización')

  const callerMemberships = await requireAdmin(db, callerId, orgId)
  if (!callerMemberships) return fail(403, 'FORBIDDEN: solo un administrador de la organización puede hacerlo')

  if (action === 'ensure_user') {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return fail(400, 'INVALID_EMAIL: el email no es válido')

    const existing = await db.findUserIdByEmail(email)
    if (existing) return ok({ user_id: existing, created: false })

    const password = String(body.password ?? '')
    if (password.length < MIN_PASSWORD) {
      return fail(400, `WEAK_PASSWORD: la contraseña debe tener al menos ${MIN_PASSWORD} caracteres`)
    }
    const userId = await db.createUser(email, password)
    await db.audit({
      organization_id: orgId,
      actor_id: callerId,
      action: 'user_created',
      entity: 'users',
      entity_id: userId,
      after: { email },
    })
    return ok({ user_id: userId, created: true })
  }

  if (action === 'set_password') {
    const userId = body.user_id
    const password = String(body.password ?? '')
    if (!userId) return fail(400, 'BAD_REQUEST: falta el usuario')
    if (password.length < MIN_PASSWORD) {
      return fail(400, `WEAK_PASSWORD: la contraseña debe tener al menos ${MIN_PASSWORD} caracteres`)
    }

    const target = await db.membershipsOf(userId)
    if (!target.some((m) => m.organization_id === orgId)) {
      return fail(404, 'NOT_MEMBER: el usuario no pertenece a la organización')
    }
    const adminOf = new Set(callerMemberships.filter((m) => m.role === 'admin').map((m) => m.organization_id))
    if (!target.every((m) => adminOf.has(m.organization_id))) {
      return fail(403, 'OTHER_ORGANIZATION: el usuario también pertenece a otra organización; la contraseña la cambia él o el proveedor')
    }

    await db.setPassword(userId, password)
    await db.audit({
      organization_id: orgId,
      actor_id: callerId,
      action: 'password_reset',
      entity: 'users',
      entity_id: userId,
    })
    return ok({ user_id: userId })
  }

  return fail(400, 'BAD_REQUEST: acción desconocida')
}
