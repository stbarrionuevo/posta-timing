// Edge Function: alta de usuarios y cambio de contraseña para administradores
// de una organización. La lógica y los permisos están en handler.js.
//
// Deploy: ver README ("Usuarios"). Se despliega con --no-verify-jwt
// porque el token se valida acá con auth.getUser (funciona con las claves
// nuevas y las legacy de Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleAction } from './handler.js'

const url = Deno.env.get('SUPABASE_URL')!
// Proyectos con claves legacy exponen SUPABASE_SERVICE_ROLE_KEY; los nuevos,
// SUPABASE_SECRET_KEYS (JSON). Si ninguna está, cargar el secreto a mano.
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const secrets = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secrets) {
    const parsed = JSON.parse(secrets)
    return parsed.default ?? Object.values(parsed)[0]
  }
  throw new Error('Falta la clave de servicio (SUPABASE_SERVICE_ROLE_KEY)')
}

const admin = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function unwrap<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error
  return data
}

const db = {
  membershipsOf: async (userId: string) =>
    unwrap(await admin.from('memberships').select('organization_id, role').eq('user_id', userId)) ?? [],
  findUserIdByEmail: async (email: string) => unwrap(await admin.rpc('auth_user_id_by_email', { p_email: email })),
  createUser: async (email: string, password: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    return data.user.id
  },
  setPassword: async (userId: string, password: string) => {
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) throw error
  },
  audit: async (row: Record<string, unknown>) => unwrap(await admin.from('audit_log').insert(row)),
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' })

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data } = token ? await admin.auth.getUser(token) : { data: { user: null } }
    const body = await req.json().catch(() => null)
    const result = await handleAction(body, data.user?.id ?? null, db)
    return json(result.status, result.body)
  } catch (err) {
    console.error(err)
    return json(500, { error: `SERVER_ERROR: ${(err as Error).message ?? 'error inesperado'}` })
  }
})
