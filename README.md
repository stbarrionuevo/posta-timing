# postas-timing

Cronometraje de postas americanas: varios equipos nadan durante X minutos, cada
pasada suma metros y gana el que más metros hace. Registra el parcial de cada
nadador por pasada.

## Relación con swim-timing

`../swim-timing` (torneo escolar) es un producto vendido con soporte por 12
meses y **no se modifica**. Este proyecto es independiente:

- Carpeta y repositorio propios.
- **Proyecto de Supabase propio.** No correr `supabase/schema.sql` en la base
  del torneo escolar.
- Se reutilizan patrones de swim-timing copiándolos, no importándolos:
  cola offline (`src/lib/offlineQueue.js`), suscripción Realtime
  (`subscribeToChanges` en `resultsService.js`), exportes con jspdf.

## Base de datos

`supabase/schema.sql` se corre una vez en el SQL Editor de un proyecto de
Supabase nuevo.

| Pieza | Qué hace |
| --- | --- |
| `organizations`, `memberships` | Clientes y usuarios con rol `admin` / `judge` / `operator` |
| `events` | Largo de pileta, duración, anti doble toque, reloj (`started_at`, pausas) |
| `teams`, `swimmers` | Roster; se cierra al iniciar el evento |
| `lane_sessions` | Dispositivo por carril, "Carril listo", latido |
| `laps` | Una fila por toque. Nunca se borra: se anula con motivo |
| `team_adjustments` | Pasada incompleta, penalizaciones, correcciones |
| `audit_log` | Quién, qué, cuándo y por qué. Append-only |
| `v_team_standings`, `v_lap_splits`, `v_swimmer_stats` | Posiciones, parciales y resumen por nadador (calculados) |

Todas las escrituras sensibles pasan por funciones (`supabase.rpc(...)`):
`start_event`, `pause_event`, `resume_event`, `finish_event`, `set_lane_ready`,
`lane_heartbeat`, `set_active_swimmer`, `record_lap`, `void_lap`,
`add_team_adjustment`, `judge_add_swimmer`, `judge_set_swimmer_active`.

### Reloj

El reloj vive en el servidor. El cliente llama a `server_now()` para calcular
el desfase de su reloj y manda cada toque con `occurred_at` ya corregido, más
un `client_op_id` generado en el dispositivo (reenviar desde la cola offline
no duplica la pasada).

## Puesta en marcha

1. En el proyecto de Supabase nuevo, correr `supabase/schema.sql` en el SQL Editor.
2. Crear el primer usuario (Authentication > Users) y correr `supabase/bootstrap.sql`
   con los datos de la organización.
3. `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. `npm install`, `npm run check:supabase` (verifica el esquema sin mostrar
   credenciales) y `npm run dev`.

## Panel del juez (`#/juez`)

- Lista de eventos de la organización y alta de eventos.
- Reloj único: confirmar roster → iniciar (avisa qué carriles no confirmaron
  "listo"; forzar el inicio queda auditado) → pausar con motivo → reanudar →
  finalizar. Señal sonora al iniciar, pausar y cumplirse el tiempo.
- Tablero de carriles en vivo: posición, metros, nadador en el agua y alertas
  (sin dispositivo, sin señal, sin primera pasada al minuto, carril trabado).
  Umbrales en `src/lib/laneAlerts.js`.
- Roster: libre hasta iniciar; después, altas tardías y bajas con motivo.

El reloj se dibuja con la hora del servidor (`src/lib/serverClock.js`), no la
del dispositivo del juez.

## Pantalla del operador (`#/carril`)

- Elegir evento y carril. El celular queda registrado en el carril con un
  latido cada 5 s (el juez ve "sin señal" si se corta). Un celular de respaldo
  se puede sumar con el evento en curso.
- "CARRIL LISTO" antes de largar. Botón PASADA gigante, bloqueado si no hay
  nadador en el agua, si el reloj no está corriendo o si el reloj del celular
  no se sincronizó nunca con el servidor.
- Rotación automática (por defecto, configurable por evento): cada pasada
  registrada pasa el turno al siguiente nadador del orden de relevo; al llegar
  al último vuelve al primero. "Deshacer" devuelve el turno. Se puede
  saltear o elegir otro nadador a mano. La regla vive en el servidor
  (`next_swimmer`) y el celular la replica (`src/lib/swimmerOrder.js`) para
  seguir rotando sin señal.
- Cada toque entra a una cola en el celular (`src/lib/lapQueue.js`) y se envía
  con la hora del servidor del momento del toque; sin señal se acumula y se
  envía al volver. Los toques rechazados quedan visibles en "No registradas".
- "Deshacer" la última pasada durante ~27 s. Doble toque: el servidor lo
  rechaza, lo audita y el operador ve el aviso.
- Pantalla siempre encendida (Wake Lock) y vibración al tocar.

Para probar con celulares en la misma red: `npm run dev:lan` y abrir la URL
"Network" que muestra Vite. Wake Lock necesita https; en http la app funciona
igual pero la pantalla puede apagarse.

## Correcciones y auditoría (`#/juez/evento/:id/correcciones`)

Todo con motivo obligatorio y registrado en `audit_log`:

- Agregar una pasada olvidada ("después de la pasada #N"; la hora se toma del
  punto medio entre las vecinas y queda marcada como manual).
- Reasignar una pasada a otro nadador, anularla o restaurarla.
- Penalizaciones, metros de la pasada incompleta y ajustes manuales; se pueden
  quitar (queda en el historial).
- Historial legible con filtros (rechazos, correcciones, reloj, roster,
  dispositivos, pasadas) y descarga en CSV.
- Los toques rechazados (doble toque, fuera de tiempo, reloj desfasado) quedan
  auditados en el servidor: evidencia ante un "no me tomó el tiempo".

## Marcador público y resultados

Sin sesión si el evento tiene "Marcador público" activado; si no, solo para
usuarios de la organización. Links y QR en el panel del juez.

- `#/marcador/:id`: para TV o proyector (se adapta a celular). Posiciones,
  metros, nadador en el agua, cuenta regresiva, podio al finalizar y QR a
  resultados.
- `#/resultados/:id`: posiciones, detalle por equipo (resumen por nadador y
  todas las pasadas con tiempo de carrera y parcial), búsqueda de nadador sin
  acentos, descarga en PDF y CSV. Marca "provisorio" mientras el evento corre.
- Las pantallas públicas releen como mucho cada 2 s (marcador) / 5 s
  (resultados) para no saturar la base con muchos espectadores.

## Manual, checklist y planillas

- `#/ayuda` (sin sesión): tarjeta del operador (para imprimir y dejar en el
  carril), guía del juez, cómo resolver un "no me tomó el tiempo", guía de la
  organización y problemas frecuentes. Enlazado desde el login, la pantalla del
  carril y el selector de carril.
- `#/juez/evento/:id/checklist`: chequeos automáticos con datos en vivo
  (equipos, nadadores, orden de relevo, operadores, roster, celulares
  conectados y listos, reloj, marcador) más ítems manuales (reglas, red,
  batería, planillas, cierre). Los tildes manuales quedan en ese navegador.
- `#/juez/evento/:id/planillas`: planilla de papel por carril (una hoja A4 por
  carril) para el veedor: respaldo si falla la tecnología y evidencia ante
  reclamos.

## Usuarios (`#/admin/usuarios`, solo administradores)

Alta de usuarios con contraseña inicial generada (se muestra una vez para
copiar y mandar), cambio de rol y de nombre, nueva contraseña y baja. Nunca se
puede dejar una organización sin administrador (`protect_last_admin`).

Crear usuarios y cambiar contraseñas necesita la clave de servicio, que no
puede estar en el navegador: lo hace la Edge Function
`supabase/functions/admin-users` (`index.ts` + `handler.js`). La función
verifica que quien llama sea admin de esa organización, y solo cambia la
contraseña de usuarios que pertenecen únicamente a organizaciones donde quien
llama es admin. La membresía la inserta el admin desde la app (queda en la
auditoría con su nombre).

Deploy de la función (una vez, y cada vez que cambie):

- Con el CLI: `npx supabase login`, luego
  `npx supabase functions deploy admin-users --no-verify-jwt --project-ref <ref>`
  desde esta carpeta.
- Desde el panel: Edge Functions → Deploy a new function → nombre
  `admin-users`, pegar `index.ts` y agregar el archivo `handler.js`; en la
  configuración de la función desactivar "Verify JWT" (el token se valida
  dentro de la función).

El primer administrador de cada organización se sigue creando con
`supabase/bootstrap.sql`.

### Migraciones

Bases creadas con una versión anterior de `schema.sql`: correr en orden los
archivos de `supabase/migrations/` que falten.

## Pruebas

```
npm test          # reloj, alertas y cola de pasadas
npm run test:db   # esquema completo en PGlite
```

Corre el esquema en un Postgres en memoria (PGlite) con un stub mínimo de
Supabase (`auth.uid()`, roles `anon` / `authenticated`) y verifica permisos,
roster cerrado, doble toque, reenvíos offline, auditoría y posiciones.
