import { PGlite } from '@electric-sql/pglite'
process.on('unhandledRejection', (e) => { console.log('UNCAUGHT:', e.message, e.where ?? ''); process.exit(1) })
import { readFileSync } from 'node:fs'

const schema = readFileSync(
  new URL('../schema.sql', import.meta.url), 'utf8').replace('create extension if not exists "pgcrypto";', '')

const db = new PGlite()
let failures = 0
const ok = (name) => console.log('  OK  ', name)
const fail = (name, msg) => { failures++; console.log('  FAIL', name, '->', msg) }

// --- Stub mínimo de Supabase ---
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create publication supabase_realtime;
`)
try { await db.exec(schema) } catch (e) { console.log("SCHEMA ERROR:", e.message, e.where ?? "", "pos", e.position); process.exit(1) }
console.log('schema aplicado')

const U = {
  admin: '00000000-0000-0000-0000-00000000000a',
  judge: '00000000-0000-0000-0000-00000000000b',
  op: '00000000-0000-0000-0000-00000000000c',
  op2: '00000000-0000-0000-0000-00000000000d',
  other: '00000000-0000-0000-0000-00000000000e',
}
await db.exec(`
  insert into auth.users (id, email) values ${Object.entries(U).map(([k, u]) => `('${u}', '${k}@club.test')`).join(',')};
  insert into organizations (id, name, slug) values
    ('10000000-0000-0000-0000-000000000001', 'Club A', 'club-a'),
    ('10000000-0000-0000-0000-000000000002', 'Club B', 'club-b');
  insert into memberships values
    ('10000000-0000-0000-0000-000000000001', '${U.admin}', 'admin', 'Admin', now()),
    ('10000000-0000-0000-0000-000000000001', '${U.judge}', 'judge', 'Juez', now()),
    ('10000000-0000-0000-0000-000000000001', '${U.op}', 'operator', 'Op 1', now()),
    ('10000000-0000-0000-0000-000000000001', '${U.op2}', 'operator', 'Op 2', now()),
    ('10000000-0000-0000-0000-000000000002', '${U.other}', 'admin', 'Otro', now());
`)

async function as(user, sql, params) {
  await db.exec('reset role')
  if (user === 'anon' || user === 'service_role') {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role ${user}`)
  } else {
    await db.exec(`select set_config('request.jwt.claim.sub', '${U[user]}', false); set role authenticated`)
  }
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role')
  }
}
async function expectOk(name, user, sql, params) {
  try { const r = await as(user, sql, params); ok(name); return r }
  catch (e) { fail(name, e.message); return null }
}
async function expectErr(name, user, sql, pattern, params) {
  try { await as(user, sql, params); fail(name, 'no falló') }
  catch (e) { pattern.test(e.message) ? ok(`${name} [${e.message.split('\n')[0].slice(0, 70)}]`) : fail(name, e.message) }
}
const su = (sql, p) => db.query(sql, p)

// --- Armado del evento ---
console.log('\nArmado')
const ev = (await expectOk('juez crea evento', 'judge', `
  insert into events (organization_id, name, event_date, pool_length_m, duration_seconds, min_lap_seconds)
  values ('10000000-0000-0000-0000-000000000001', 'Postas 30 min', '2026-10-10', 25, 1800, 8)
  returning id`)).rows[0].id
await expectErr('operador no puede crear evento', 'op', `
  insert into events (organization_id, name, event_date, duration_seconds)
  values ('10000000-0000-0000-0000-000000000001', 'x', '2026-10-10', 60)`, /row-level security|permission/)
await expectErr('otra organización no puede crear en Club A', 'other', `
  insert into events (organization_id, name, event_date, duration_seconds)
  values ('10000000-0000-0000-0000-000000000001', 'x', '2026-10-10', 60)`, /row-level security/)

const t1 = (await expectOk('juez crea equipo 1', 'judge',
  `insert into teams (event_id, name, lane_number, organization_id)
   values ($1, 'Tiburones', 1, '10000000-0000-0000-0000-000000000002') returning id, organization_id`, [ev])).rows[0]
t1.organization_id === '10000000-0000-0000-0000-000000000001'
  ? ok('organization_id del equipo se corrige desde el evento') : fail('org del equipo', t1.organization_id)
const t2 = (await as('judge', `insert into teams (event_id, name, lane_number) values ($1, 'Delfines', 2) returning id`, [ev])).rows[0]

await expectErr('mark_event_ready con equipo vacío', 'judge', `select mark_event_ready($1)`, /EMPTY_TEAM/, [ev])
const sw = {}
for (const [team, names] of [[t1.id, ['Ana', 'Beto']], [t2.id, ['Caro', 'Dani']]]) {
  for (const [i, n] of names.entries()) {
    sw[n] = (await as('judge', `insert into swimmers (team_id, name, relay_order) values ($1, $2, $3) returning id`, [team, n, i + 1])).rows[0].id
  }
}
// Alta de último momento ANTES de arrancar: permitido sin trámite.
sw.Eva = (await expectOk('alta de nadador antes de iniciar (roster abierto)', 'judge',
  `insert into swimmers (team_id, name, relay_order) values ($1, 'Eva', 3) returning id`, [t1.id])).rows[0].id

await expectErr('set_lane_ready con evento en draft', 'op', `select set_lane_ready($1, 'tablet-1')`, /INVALID_STATUS/, [t1.id])
await expectErr('latido con evento en borrador', 'op', `select lane_heartbeat($1, 'tablet-1')`, /INVALID_STATUS/, [t1.id])
await expectOk('mark_event_ready', 'judge', `select mark_event_ready($1)`, [ev])
await expectOk('operador 1 marca carril listo', 'op', `select set_lane_ready($1, 'tablet-1')`, [t1.id])

// --- Error (b): nadie arranca el reloj local; el juez arranca y ve quién no confirmó ---
console.log('\nInicio')
await expectErr('iniciar con carril 2 sin confirmar', 'judge', `select start_event($1)`, /LANES_NOT_READY: carril 2/, [ev])
await expectErr('operador no puede iniciar', 'op', `select start_event($1, true)`, /FORBIDDEN/, [ev])
await expectErr('operador no puede tocar status directo', 'op', `update events set status = 'running' where id = $1`, /permission denied/, [ev])
await expectErr('juez tampoco puede tocar started_at directo', 'judge', `update events set started_at = now() where id = $1`, /permission denied/, [ev])
await expectOk('juez fuerza inicio', 'judge', `select start_event($1, true)`, [ev])
const startAudit = (await su(`select reason from audit_log where entity = 'events' and after->>'status' = 'running'`)).rows[0]
;/forzado.*carril 2/.test(startAudit?.reason) ? ok(`auditoría del inicio: "${startAudit.reason}"`) : fail('audit inicio', JSON.stringify(startAudit))
const act = (await su(`select name, active_swimmer_id from teams order by lane_number`)).rows
act.every((r) => r.active_swimmer_id) ? ok('cada equipo arranca con nadador activo (orden 1)') : fail('activo', JSON.stringify(act))

// Dispositivo de respaldo que se suma con el evento en curso.
await expectOk('latido crea sesión de respaldo en carril 2', 'op2', `select lane_heartbeat($1, 'celu-respaldo')`, [t2.id])
const backup = (await su(`select ready_at, user_id from lane_sessions where device_id = 'celu-respaldo'`)).rows[0]
backup && backup.ready_at === null && backup.user_id === U.op2 ? ok('sesión de respaldo sin "listo" y con su operador') : fail('respaldo', JSON.stringify(backup))
await expectOk('segundo latido actualiza la misma sesión', 'op2', `select lane_heartbeat($1, 'celu-respaldo')`, [t2.id])
const nSessions = (await su(`select count(*)::int c from lane_sessions where device_id = 'celu-respaldo'`)).rows[0].c
nSessions === 1 ? ok('no duplica sesiones') : fail('sesiones', nSessions)
const joined = (await su(`select count(*)::int c from audit_log where action = 'lane_device_joined'`)).rows[0].c
joined === 1 ? ok('alta de dispositivo en curso queda en auditoría (una vez)') : fail('joined audit', joined)
await expectErr('otra organización no manda latidos', 'other', `select lane_heartbeat($1, 'x')`, /FORBIDDEN/, [t2.id])

// Retrocedo el inicio 5 minutos para simular pasadas.
await su(`update events set started_at = started_at - interval '5 minutes' where id = $1`, [ev])
const base = (await su(`select started_at from events where id = $1`, [ev])).rows[0].started_at
const at = (s) => new Date(base.getTime() + s * 1000).toISOString()

// --- Error (a): alta a último momento con roster cerrado ---
console.log('\nRoster cerrado')
await expectErr('insert directo con evento en curso', 'judge', `insert into swimmers (team_id, name) values ($1, 'Fede')`, /ROSTER_LOCKED/, [t2.id])
await expectErr('renombrar equipo con evento en curso', 'judge', `update teams set name = 'X' where id = $1`, /ROSTER_LOCKED/, [t2.id])
await expectErr('judge_add_swimmer sin motivo', 'judge', `select judge_add_swimmer($1, 'Fede', '')`, /REASON_REQUIRED/, [t2.id])
const fede = await expectOk('judge_add_swimmer con motivo', 'judge', `select * from judge_add_swimmer($1, 'Fede', 'llegó tarde, autorizado por fiscal')`, [t2.id])
fede?.rows[0].added_after_lock === true ? ok('Fede queda marcado added_after_lock') : fail('added_after_lock', JSON.stringify(fede?.rows[0]))
await expectErr('operador no puede usar judge_add_swimmer', 'op', `select judge_add_swimmer($1, 'X', 'x')`, /FORBIDDEN/, [t2.id])

// --- Pasadas ---
console.log('\nPasadas')
const lap = (user, team, swimmer, op, sec) =>
  as(user, `select record_lap($1, $2, $3, $4, 'tablet')::text as r`, [team, swimmer, op, at(sec)]).then((r) => JSON.parse(r.rows[0].r))
const op = (n) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const active = async (teamId) => (await su(`select active_swimmer_id from teams where id = $1`, [teamId])).rows[0].active_swimmer_id
const teamAudits = async () => (await su(`select count(*)::int c from audit_log where entity = 'teams' and action = 'update'`)).rows[0].c
const teamAuditsBefore = await teamAudits()

let r = await lap('op', t1.id, sw.Ana, op(1), 20)
r.result === 'recorded' ? ok('pasada 1 registrada') : fail('pasada 1', JSON.stringify(r))
;(await active(t1.id)) === sw.Beto ? ok('rotación: después de Ana entra Beto') : fail('rotación 1', await active(t1.id))
r = await lap('op', t1.id, sw.Ana, op(1), 20)
r.result === 'duplicate' ? ok('reenvío offline mismo client_op_id -> duplicate') : fail('dup', JSON.stringify(r))
r = await lap('op', t1.id, sw.Ana, op(2), 22)
r.result === 'too_soon' ? ok('doble toque a 2 s -> too_soon') : fail('too_soon', JSON.stringify(r))
const rej = (await su(`select count(*)::int c from audit_log where action = 'lap_rejected'`)).rows[0].c
rej === 1 ? ok('rechazo por doble toque queda en audit_log') : fail('lap_rejected', rej)
await lap('op', t1.id, sw.Beto, op(3), 45)
await lap('op', t1.id, sw.Eva, op(4), 70)
await lap('op2', t2.id, sw.Caro, op(5), 25)
await lap('op2', t2.id, sw.Dani, op(6), 50)
await lap('op2', t2.id, sw.Caro, op(7), 76)
;(await active(t1.id)) === sw.Ana ? ok('rotación: después de Eva (última) vuelve Ana') : fail('rotación wrap', await active(t1.id))
;(await active(t2.id)) === fede?.rows[0].id ? ok('rotación: la alta tardía (sin orden) va al final') : fail('rotación fede', await active(t2.id))
;(await teamAudits()) === teamAuditsBefore ? ok('la rotación automática no llena la auditoría') : fail('audit rotación', await teamAudits())

// Deshacer la última pasada devuelve el turno.
r = await lap('op', t1.id, sw.Ana, op(16), 100)
;(await active(t1.id)) === sw.Beto ? ok('pasada de Ana a los 100 s -> turno de Beto') : fail('pre-undo', await active(t1.id))
await expectOk('operador deshace esa pasada', 'op', `select void_lap($1, 'Deshacer desde el carril')`, [r.lap_id])
;(await active(t1.id)) === sw.Ana ? ok('al deshacer, el turno vuelve a Ana') : fail('undo rotación', await active(t1.id))

// Pasada que no es del nadador en el agua (reenvío viejo): no mueve el turno.
r = await lap('op', t1.id, sw.Eva, op(17), 110)
;(await active(t1.id)) === sw.Ana ? ok('pasada de otro nadador no rota el turno') : fail('no-rotación', await active(t1.id))
await as('judge', `select void_lap($1, 'prueba de rotación')`, [r.lap_id])

const expectRejected = async (name, user, args, pattern) => {
  const res = JSON.parse((await as(user, `select record_lap($1, $2, $3, $4)::text as r`, args)).rows[0].r)
  const audited = (await su(`select reason from audit_log where action = 'lap_rejected' and after->>'client_op_id' = $1`, [args[2]])).rows[0]
  res.result === 'rejected' && pattern.test(res.error) && pattern.test(audited?.reason ?? '')
    ? ok(`${name} -> rejected y auditado [${res.error.split(':')[0]}]`)
    : fail(name, JSON.stringify({ res, audited }))
}
await expectRejected('pasada con nadador de otro equipo', 'op', [t1.id, sw.Caro, op(8), at(100)], /SWIMMER_NOT_IN_TEAM/)
await expectRejected('pasada con hora futura', 'op', [t1.id, sw.Ana, op(9), new Date(Date.now() + 60_000).toISOString()], /FUTURE_TIMESTAMP/)
await expectRejected('pasada antes del inicio', 'op', [t1.id, sw.Ana, op(10), at(-5)], /BEFORE_START/)
await expectErr('insert directo en laps', 'op', `insert into laps (event_id, team_id, swimmer_id, organization_id, client_op_id, occurred_at, recorded_by)
  values ($1, $2, $3, '10000000-0000-0000-0000-000000000001', gen_random_uuid(), now(), $4)`, /permission denied/, [ev, t1.id, sw.Ana, U.op])
await expectErr('otra organización no registra pasadas', 'other', `select record_lap($1, $2, $3, $4)`, /FORBIDDEN/, [t1.id, sw.Ana, op(11), at(100)])
await expectErr('cliente no puede escribir auditoría falsa', 'judge', `select write_audit(null, null, 'x', 'x', null, null)`, /permission denied/)

// Deshacer
const lastOp2 = (await su(`select id from laps where client_op_id = $1`, [op(7)])).rows[0].id
await expectErr('operador 1 no deshace pasada del operador 2', 'op', `select void_lap($1, 'deshacer')`, /FORBIDDEN/, [lastOp2])
await expectErr('anular sin motivo', 'judge', `select void_lap($1, ' ')`, /REASON_REQUIRED/, [lastOp2])
await expectOk('operador 2 deshace su última pasada', 'op2', `select void_lap($1, 'deshacer: toque accidental')`, [lastOp2])

// Cambio de nadador activo (trazado en auditoría, no bloqueado por roster)
await expectOk('operador cambia nadador activo', 'op', `select set_active_swimmer($1, $2)`, [t1.id, sw.Beto])
await expectErr('nadador activo de otro equipo', 'op', `select set_active_swimmer($1, $2)`, /SWIMMER_NOT_IN_TEAM/, [t1.id, sw.Caro])

// Ajustes
await expectOk('penalización -25 m', 'judge', `select add_team_adjustment($1, 'penalty', -25, 'salida anticipada')`, [t2.id])
await expectErr('penalización positiva no permitida', 'judge', `select add_team_adjustment($1, 'penalty', 25, 'x')`, /check constraint/, [t2.id])
await expectErr('operador no aplica penalizaciones', 'op', `select add_team_adjustment($1, 'penalty', -25, 'x')`, /FORBIDDEN/, [t2.id])

// --- Correcciones del juez ---
console.log('\nCorrecciones')
await expectErr('agregar pasada sin motivo', 'judge', `select judge_add_lap($1, $2, $3, '')`, /REASON_REQUIRED/, [t1.id, sw.Beto, at(90)])
await expectErr('operador no agrega pasadas a mano', 'op', `select judge_add_lap($1, $2, $3, 'x')`, /FORBIDDEN/, [t1.id, sw.Beto, at(90)])
await expectErr('pasada manual fuera del tiempo', 'judge', `select judge_add_lap($1, $2, $3, 'x')`, /OUT_OF_RANGE/, [t1.id, sw.Beto, at(-10)])
const added = (await expectOk('juez agrega pasada olvidada', 'judge', `select * from judge_add_lap($1, $2, $3, 'toque olvidado, confirmado por veedor')`, [t1.id, sw.Beto, at(90)]))?.rows[0]
added?.source === 'judge' ? ok('la pasada manual queda marcada source=judge') : fail('source', JSON.stringify(added))
await expectOk('juez reasigna la pasada a Eva', 'judge', `select judge_reassign_lap($1, $2, 'era Eva, no Beto')`, [added.id, sw.Eva])
;(await su(`select swimmer_id from laps where id = $1`, [added.id])).rows[0].swimmer_id === sw.Eva ? ok('pasada reasignada') : fail('reasignar', '')
await expectErr('reasignar a nadador de otro equipo', 'judge', `select judge_reassign_lap($1, $2, 'x')`, /SWIMMER_NOT_IN_TEAM/, [added.id, sw.Caro])
await expectErr('operador no restaura pasadas', 'op2', `select judge_restore_lap($1, 'x')`, /FORBIDDEN/, [lastOp2])
await expectOk('juez restaura la pasada anulada de Caro', 'judge', `select judge_restore_lap($1, 'el deshacer fue un error')`, [lastOp2])
const penalty = (await su(`select id from team_adjustments where team_id = $1`, [t2.id])).rows[0].id
await expectErr('quitar penalización sin motivo', 'judge', `select judge_remove_adjustment($1, ' ')`, /REASON_REQUIRED/, [penalty])
await expectOk('juez quita la penalización', 'judge', `select judge_remove_adjustment($1, 'la salida fue válida (video)')`, [penalty])
const removedAud = (await su(`select reason, before->>'meters' as m from audit_log where entity = 'team_adjustments' and action = 'delete'`)).rows[0]
removedAud?.reason === 'la salida fue válida (video)' && removedAud.m === '-25' ? ok('la penalización quitada queda en el historial con motivo') : fail('remove adj audit', JSON.stringify(removedAud))
const reassignAud = (await su(`select before->>'swimmer_id' b, after->>'swimmer_id' a, reason from audit_log where entity = 'laps' and action = 'update' and reason = 'era Eva, no Beto'`)).rows[0]
const manualSplit = (await as('judge', `select source, synced_late from v_lap_splits where lap_id = $1`, [added.id])).rows[0]
manualSplit?.source === 'judge' && manualSplit.synced_late === false
  ? ok('v_lap_splits: pasada manual con source=judge y sin "llegó tarde"') : fail('split manual', JSON.stringify(manualSplit))
reassignAud?.b === sw.Beto && reassignAud.a === sw.Eva ? ok('la reasignación guarda antes/después') : fail('reassign audit', JSON.stringify(reassignAud))

// --- Auditoría inmutable ---
console.log('\nAuditoría')
await expectErr('juez no puede borrar audit_log', 'judge', `delete from audit_log`, /permission denied/)
try { await su(`delete from audit_log`); fail('audit delete su', 'no falló') } catch { ok('audit_log no se puede borrar ni como dueño') }
const aud = (await as('op', `select count(*)::int c from audit_log`)).rows[0].c
aud === 0 ? ok('operador no ve la auditoría') : fail('audit visible op', aud)
const audJ = (await as('judge', `select count(*)::int c from audit_log`)).rows[0].c
audJ > 0 ? ok(`juez ve ${audJ} entradas de auditoría`) : fail('audit juez', audJ)
const voidAud = (await su(`select reason from audit_log where entity = 'laps' and after->>'status' = 'void' and reason like 'deshacer:%'`)).rows[0]
voidAud?.reason === 'deshacer: toque accidental' ? ok('la anulación guarda el motivo en auditoría') : fail('void audit', JSON.stringify(voidAud))

// --- Vistas ---
console.log('\nResultados')
const st = (await as('judge', `select team_name, laps, total_meters::int, position::int from v_team_standings where event_id = $1 order by position`, [ev])).rows
console.table(st)
st[0]?.team_name === 'Tiburones' && st[0].total_meters === 100 && st[1].total_meters === 75
  ? ok('posiciones tras correcciones: Tiburones 100 m, Delfines 75 m') : fail('standings', JSON.stringify(st))
const sp = (await as('judge', `select t.name as team, s.name as swimmer, lap_number::int, swimmer_lap_number::int, split_seconds::numeric(6,1)::text as split, cumulative_meters::int
  from v_lap_splits v join teams t on t.id = v.team_id join swimmers s on s.id = v.swimmer_id where v.event_id = $1 order by t.lane_number, lap_number`, [ev])).rows
console.table(sp)
sp.find((x) => x.swimmer === 'Beto')?.split === '25.0' ? ok('parcial de Beto = 25.0 s') : fail('split', JSON.stringify(sp))
const ss = (await as('judge', `select name, laps::int, meters::int, best_split_seconds::numeric(6,1)::text as best from v_swimmer_stats where event_id = $1 order by team_id, relay_order`, [ev])).rows
console.table(ss)

// --- Público ---
console.log('\nPúblico')
let pub = (await as('anon', `select count(*)::int c from v_team_standings`)).rows[0].c
pub === 0 ? ok('anónimo no ve evento privado') : fail('anon privado', pub)
await as('judge', `update events set is_public = true where id = $1`, [ev])
pub = (await as('anon', `select count(*)::int c from v_team_standings`)).rows[0].c
pub === 2 ? ok('anónimo ve el marcador del evento público') : fail('anon público', pub)
const othAud = (await as('other', `select count(*)::int c from audit_log where event_id = $1`, [ev])).rows[0].c
othAud === 0 ? ok('otra organización no ve auditoría ajena') : fail('other audit', othAud)
await expectErr('anónimo no registra pasadas', 'anon', `select record_lap($1, $2, $3, now())`, /permission denied/, [t1.id, sw.Ana, op(12)])

// --- Reloj: pausa, fin, config ---
console.log('\nReloj')
await expectErr('cambiar duración con evento en curso', 'judge', `update events set duration_seconds = 60 where id = $1`, /EVENT_CONFIG_LOCKED/, [ev])
await expectOk('pausa', 'judge', `select pause_event($1, 'nadador descompuesto')`, [ev])
await expectRejected('pasada durante la pausa', 'op', [t1.id, sw.Beto, op(13), new Date(Date.now() + 1000).toISOString()], /AFTER_END/)
r = await lap('op', t1.id, sw.Beto, op(14), 120) // toque previo a la pausa que llega tarde (offline)
r.result === 'recorded' ? ok('pasada previa a la pausa llega por cola offline y se acepta') : fail('offline antes pausa', JSON.stringify(r))
await expectOk('reanudar', 'judge', `select resume_event($1)`, [ev])
const ps = (await su(`select paused_seconds::float p from events where id = $1`, [ev])).rows[0].p
ps >= 0 ? ok(`paused_seconds acumulado = ${ps.toFixed(3)}`) : fail('paused', ps)
await expectOk('finalizar', 'judge', `select finish_event($1)`, [ev])
await expectRejected('pasada después del final', 'op', [t1.id, sw.Beto, op(15), new Date(Date.now() + 1000).toISOString()], /AFTER_END/)
const late = (await as('judge', `select synced_late from v_lap_splits where lap_id = (select id from laps where client_op_id = $1)`, [op(14)])).rows[0]
late?.synced_late ? ok('la pasada que llegó tarde queda marcada synced_late para revisión') : fail('synced_late', JSON.stringify(late))
const del = await as('admin', `delete from events where id = $1`, [ev])
del.affectedRows === 0 ? ok('admin no puede borrar un evento finalizado (0 filas)') : fail('delete finished', del.affectedRows)
const fedes = (await su(`select count(*)::int c from swimmers where name = 'Fede'`)).rows[0].c
fedes === 1 ? ok('judge_add_swimmer inserta una sola vez') : fail('fede', fedes)

// --- Usuarios de la organización ---
console.log('\nUsuarios')
const ORG_A = '10000000-0000-0000-0000-000000000001'
const ORG_B = '10000000-0000-0000-0000-000000000002'
const list = await expectOk('admin lista miembros con email', 'admin', `select * from list_org_members($1)`, [ORG_A])
list?.rows.some((m) => m.email === 'op@club.test' && m.role === 'operator') ? ok('el listado trae email y rol') : fail('list members', JSON.stringify(list?.rows))
await expectErr('juez no lista usuarios', 'judge', `select * from list_org_members($1)`, /FORBIDDEN/, [ORG_A])
await expectErr('admin de otra org no lista usuarios ajenos', 'other', `select * from list_org_members($1)`, /FORBIDDEN/, [ORG_A])
await expectOk('admin cambia rol de op2 a juez', 'admin', `update memberships set role = 'judge' where organization_id = $1 and user_id = $2`, [ORG_A, U.op2])
await expectErr('admin no puede mover una membresía de usuario', 'admin', `update memberships set user_id = $2 where organization_id = $1 and user_id = $3`, /permission denied/, [ORG_A, U.other, U.op2])
await expectErr('admin no puede degradarse si es el único', 'admin', `update memberships set role = 'judge' where organization_id = $1 and user_id = $2`, /LAST_ADMIN/, [ORG_A, U.admin])
await expectErr('admin no puede borrarse si es el único', 'admin', `delete from memberships where organization_id = $1 and user_id = $2`, /LAST_ADMIN/, [ORG_A, U.admin])
await expectOk('admin suma a un usuario existente a su org', 'admin', `insert into memberships (organization_id, user_id, role, display_name) values ($1, $2, 'operator', 'Invitado')`, [ORG_A, U.other])
await expectErr('admin no suma gente a otra org', 'admin', `insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, /row-level security/, [ORG_B, U.op])
await expectOk('admin quita al invitado', 'admin', `delete from memberships where organization_id = $1 and user_id = $2`, [ORG_A, U.other])
const judgeRole = (await su(`select role from memberships where organization_id = $1 and user_id = $2`, [ORG_A, U.judge])).rows[0].role
judgeRole === 'judge' ? ok('un juez no puede darse rol de admin') : fail('judge escalation', judgeRole)
await expectErr('un usuario común no busca emails', 'admin', `select auth_user_id_by_email('op@club.test')`, /permission denied/)
const byEmail = await expectOk('la Edge Function (service_role) busca por email', 'service_role', `select auth_user_id_by_email(' OP@club.test ') as id`)
byEmail?.rows[0].id === U.op ? ok('búsqueda por email sin mayúsculas ni espacios') : fail('by email', JSON.stringify(byEmail?.rows))
const memberAudit = (await su(`select count(*)::int c from audit_log where entity = 'memberships' and actor_id = $1`, [U.admin])).rows[0].c
memberAudit >= 3 ? ok('los cambios de usuarios quedan auditados con el admin como autor') : fail('member audit', memberAudit)

console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK')
process.exit(failures ? 1 : 0)
