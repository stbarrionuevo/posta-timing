// La app usa HashRouter: los links compartibles llevan "#/...".
const base = () => `${window.location.origin}${window.location.pathname}`

export const scoreboardUrl = (eventId) => `${base()}#/marcador/${eventId}`
export const resultsUrl = (eventId) => `${base()}#/resultados/${eventId}`
