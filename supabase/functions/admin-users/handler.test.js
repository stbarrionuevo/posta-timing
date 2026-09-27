import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleAction } from './handler.js'

const A = 'org-a'
const B = 'org-b'

// Base falsa: memberships + usuarios + auditoría en memoria.
function fakeDb() {
  const memberships = [
    { user_id: 'admin-a', organization_id: A, role: 'admin' },
    { user_id: 'judge-a', organization_id: A, role: 'judge' },
    { user_id: 'op-a', organization_id: A, role: 'operator' },
    { user_id: 'admin-b', organization_id: B, role: 'admin' },
    { user_id: 'shared', organization_id: A, role: 'operator' },
    { user_id: 'shared', organization_id: B, role: 'admin' },
  ]
  const users = new Map([['op@a.com', 'op-a'], ['shared@x.com', 'shared']])
  const passwords = new Map()
  const audits = []
  return {
    passwords,
    audits,
    users,
    membershipsOf: async (id) => memberships.filter((m) => m.user_id === id),
    findUserIdByEmail: async (email) => users.get(email) ?? null,
    createUser: async (email, password) => {
      const id = `new-${users.size}`
      users.set(email, id)
      passwords.set(id, password)
      return id
    },
    setPassword: async (id, password) => passwords.set(id, password),
    audit: async (row) => audits.push(row),
  }
}

test('sin sesión: 401', async () => {
  const r = await handleAction({ action: 'ensure_user', organization_id: A }, null, fakeDb())
  assert.equal(r.status, 401)
})

test('solo admins de esa organización', async () => {
  const db = fakeDb()
  for (const caller of ['judge-a', 'op-a', 'admin-b']) {
    const r = await handleAction({ action: 'ensure_user', organization_id: A, email: 'x@y.com', password: '12345678' }, caller, db)
    assert.equal(r.status, 403, caller)
  }
  assert.equal(db.users.size, 2)
})

test('crea un usuario nuevo y lo audita con el admin como autor', async () => {
  const db = fakeDb()
  const r = await handleAction({ action: 'ensure_user', organization_id: A, email: ' Nuevo@Club.com ', password: 'secreta123' }, 'admin-a', db)
  assert.equal(r.status, 200)
  assert.equal(r.body.created, true)
  assert.equal(db.users.get('nuevo@club.com'), r.body.user_id)
  assert.deepEqual([db.audits[0].actor_id, db.audits[0].action], ['admin-a', 'user_created'])
})

test('usuario existente: devuelve su id y NO toca la contraseña', async () => {
  const db = fakeDb()
  const r = await handleAction({ action: 'ensure_user', organization_id: A, email: 'shared@x.com', password: 'otraclave99' }, 'admin-a', db)
  assert.deepEqual(r.body, { user_id: 'shared', created: false })
  assert.equal(db.passwords.size, 0)
  assert.equal(db.audits.length, 0)
})

test('valida email y contraseña', async () => {
  const db = fakeDb()
  assert.match((await handleAction({ action: 'ensure_user', organization_id: A, email: 'no-es-mail', password: '12345678' }, 'admin-a', db)).body.error, /INVALID_EMAIL/)
  assert.match((await handleAction({ action: 'ensure_user', organization_id: A, email: 'a@b.com', password: 'corta' }, 'admin-a', db)).body.error, /WEAK_PASSWORD/)
})

test('cambia la contraseña de un miembro propio', async () => {
  const db = fakeDb()
  const r = await handleAction({ action: 'set_password', organization_id: A, user_id: 'op-a', password: 'nueva1234' }, 'admin-a', db)
  assert.equal(r.status, 200)
  assert.equal(db.passwords.get('op-a'), 'nueva1234')
  assert.equal(db.audits[0].action, 'password_reset')
})

test('no toma cuentas que también son de otra organización', async () => {
  const db = fakeDb()
  const r = await handleAction({ action: 'set_password', organization_id: A, user_id: 'shared', password: 'nueva1234' }, 'admin-a', db)
  assert.equal(r.status, 403)
  assert.match(r.body.error, /OTHER_ORGANIZATION/)
  assert.equal(db.passwords.size, 0)
})

test('no cambia contraseñas de quien no es miembro', async () => {
  const db = fakeDb()
  const r = await handleAction({ action: 'set_password', organization_id: A, user_id: 'admin-b', password: 'nueva1234' }, 'admin-a', db)
  assert.equal(r.status, 404)
})

test('acción desconocida', async () => {
  const r = await handleAction({ action: 'borrar_todo', organization_id: A }, 'admin-a', fakeDb())
  assert.equal(r.status, 400)
})
