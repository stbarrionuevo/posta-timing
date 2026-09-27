// Verifica que el proyecto de Supabase del .env tenga el esquema de postas.
// Uso: npm run check:supabase   (no imprime las credenciales)
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY en .env')
  process.exit(1)
}

const supabase = createClient(url, key)
let failed = false
const check = async (label, fn) => {
  try {
    await fn()
    console.log(`  OK    ${label}`)
  } catch (err) {
    failed = true
    console.log(`  FALLA ${label}: ${err.message}`)
  }
}
const unwrap = ({ error }) => { if (error) throw error }

await check('server_now() responde', async () => {
  const t0 = Date.now()
  const { data, error } = await supabase.rpc('server_now')
  if (error) throw error
  const skew = Date.parse(data.replace(/(\.\d{3})\d+/, '$1')) - (t0 + (Date.now() - t0) / 2)
  console.log(`        desfase de este equipo con el servidor: ${Math.round(skew)} ms`)
})
for (const table of ['organizations', 'events', 'teams', 'swimmers', 'laps', 'lane_sessions', 'v_team_standings', 'v_lap_splits']) {
  await check(`existe ${table}`, async () => unwrap(await supabase.from(table).select('*').limit(0)))
}
await check('un anónimo no puede iniciar eventos', async () => {
  const { error } = await supabase.rpc('start_event', { p_event: '00000000-0000-0000-0000-000000000000' })
  if (!error) throw new Error('start_event respondió sin error')
  if (!/permission denied/i.test(error.message)) throw new Error(`error inesperado: ${error.message}`)
})

console.log(failed ? '\nHay problemas: ¿corriste supabase/schema.sql en este proyecto?' : '\nEsquema OK')
process.exit(failed ? 1 : 0)
