// Contraseña inicial fácil de dictar o copiar en la pileta: sin caracteres
// que se confunden (0/O, 1/l/I) y con guion en el medio. ~57 bits.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generatePassword(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  const half = Math.floor(length / 2)
  return `${chars.slice(0, half).join('')}-${chars.slice(half).join('')}`
}
