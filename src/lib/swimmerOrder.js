// Orden de relevo. Tiene que coincidir con next_swimmer() de schema.sql:
// relay_order (sin orden al final), created_at, id.
function compare(a, b) {
  const ra = a.relay_order ?? Infinity
  const rb = b.relay_order ?? Infinity
  if (ra !== rb) return ra - rb
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortByRelayOrder(swimmers) {
  return [...swimmers].sort(compare)
}

// Siguiente nadador activo después de currentId (vuelve al primero al final).
// Si currentId no está entre los activos, arranca por el primero.
export function nextSwimmerId(swimmers, currentId) {
  const active = sortByRelayOrder(swimmers.filter((s) => s.is_active))
  if (active.length === 0) return null
  const idx = active.findIndex((s) => s.id === currentId)
  return active[(idx + 1) % active.length].id
}

// Nadador que el operador ve "en el agua".
//   serverActiveId: el de la base (teams.active_swimmer_id).
//   cursor: último cambio local { swimmerId, at } (toque con rotación o
//           elección manual) todavía no reflejado en una lectura del servidor.
//   loadedFrom: cuándo arrancó la lectura que trajo serverActiveId.
//   hasPending: quedan toques sin enviar.
export function displayedActiveId({ serverActiveId, cursor, loadedFrom, hasPending }) {
  if (cursor && (hasPending || cursor.at >= loadedFrom)) return cursor.swimmerId
  return serverActiveId
}
