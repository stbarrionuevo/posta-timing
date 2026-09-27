import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

async function fetchMemberships(userId) {
  const { data, error } = await supabase
    .from('memberships')
    .select('organization_id, role, display_name, organizations(name)')
    .eq('user_id', userId)
  if (error) throw error
  return data.map((m) => ({
    organizationId: m.organization_id,
    organizationName: m.organizations?.name ?? '',
    role: m.role,
    displayName: m.display_name,
  }))
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setMemberships([])
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) return
    setLoading(true)
    fetchMemberships(userId)
      .then((rows) => {
        setMemberships(rows)
        setError(null)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [userId])

  const signIn = useCallback(async (email, password) => {
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) throw err
  }, [])

  const signOut = useCallback(() => supabase.auth.signOut(), [])

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, memberships, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
