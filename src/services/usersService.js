import { supabase } from '../lib/supabaseClient'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// Llama a la Edge Function admin-users y trae el "CODIGO: detalle" del cuerpo
// de la respuesta cuando falla.
async function callAdminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return data
  let message = error.message
  try {
    const payload = await error.context?.json()
    if (payload?.error) message = payload.error
  } catch {
    // Sin cuerpo JSON: la función no respondió.
  }
  if (/Failed to send a request|Failed to fetch|not found/i.test(message)) {
    message = 'FUNCTION_UNAVAILABLE: la función admin-users no está desplegada o no responde'
  }
  throw new Error(message)
}

export async function listMembers(organizationId) {
  return unwrap(await supabase.rpc('list_org_members', { p_org: organizationId }))
}

// Alta: 1) la función crea el usuario (o encuentra el existente);
// 2) el admin inserta la membresía, que queda auditada con su nombre.
export async function addMember(organizationId, { email, password, role, displayName }) {
  const { user_id: userId, created } = await callAdminUsers({
    action: 'ensure_user',
    organization_id: organizationId,
    email,
    password,
  })
  const { error } = await supabase
    .from('memberships')
    .insert({ organization_id: organizationId, user_id: userId, role, display_name: displayName || null })
  if (error) {
    if (error.code === '23505') throw new Error('ALREADY_MEMBER: ese email ya es parte de la organización')
    throw error
  }
  return { userId, created }
}

export async function updateMember(organizationId, userId, patch) {
  unwrap(
    await supabase.from('memberships').update(patch).eq('organization_id', organizationId).eq('user_id', userId)
  )
}

export async function removeMember(organizationId, userId) {
  unwrap(await supabase.from('memberships').delete().eq('organization_id', organizationId).eq('user_id', userId))
}

export async function setMemberPassword(organizationId, userId, password) {
  return callAdminUsers({ action: 'set_password', organization_id: organizationId, user_id: userId, password })
}
