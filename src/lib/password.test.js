import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePassword } from './password.js'

test('contraseña legible, con guion y sin caracteres confusos', () => {
  for (let i = 0; i < 200; i++) {
    const p = generatePassword()
    assert.match(p, /^[a-zA-Z2-9]{5}-[a-zA-Z2-9]{5}$/)
    assert.doesNotMatch(p, /[0O1lI]/)
  }
})

test('no se repiten', () => {
  const set = new Set(Array.from({ length: 500 }, () => generatePassword()))
  assert.equal(set.size, 500)
})
