// Tiny JSON-file store. Holds pairing sessions, payee wallet addresses and payment requests.
// Message text is not stored: only the parsed fields needed to show a card and post a receipt.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

const file = path.join(config.dataDir, 'state.json')
const empty = () => ({ sessions: {}, pairCodes: {}, wallets: {}, users: {}, requests: [], spent: {} })
let state = empty()
try { state = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) } } catch {}

let timer = null
export function save() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 1))
    fs.renameSync(file + '.tmp', file)
  }, 50)
}
export const db = () => state
export const id = (n = 8) => crypto.randomBytes(n).toString('hex')

const listeners = new Set()
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function changed() { save(); for (const fn of listeners) { try { fn() } catch {} } }

// --- users (Telegram user id -> username / name) ---
export function rememberUser(u) {
  if (!u?.id) return
  const prev = state.users[u.id] || {}
  state.users[u.id] = { ...prev, id: u.id, username: u.username || prev.username || '', name: [u.first_name, u.last_name].filter(Boolean).join(' ') || prev.name || '' }
}
export function userByUsername(name) {
  const n = name.replace(/^@/, '').toLowerCase()
  return Object.values(state.users).find(u => (u.username || '').toLowerCase() === n)
}
export function displayName(uid) { const u = state.users[uid]; return u ? (u.name || '@' + u.username) : 'someone' }

// --- pairing ---
export function newSession() {
  const sid = id(16)
  state.sessions[sid] = { createdAt: Date.now(), tgUserId: null }
  return sid
}
export function newPairCode(sid) {
  for (const [c, v] of Object.entries(state.pairCodes)) if (v.sid === sid || v.exp < Date.now()) delete state.pairCodes[c]
  let code
  do { code = String(crypto.randomInt(0, 1e6)).padStart(6, '0') } while (state.pairCodes[code])
  state.pairCodes[code] = { sid, exp: Date.now() + 10 * 60_000 }
  save()
  return code
}
export function redeemPairCode(code, tgUser) {
  const c = String(code || '').replace(/\D/g, '')
  const entry = state.pairCodes[c]
  if (!entry || entry.exp < Date.now()) return null
  delete state.pairCodes[c]
  const s = state.sessions[entry.sid]
  if (!s) return null
  rememberUser(tgUser)
  s.tgUserId = tgUser.id
  s.pairedAt = Date.now()
  changed()
  return entry.sid
}
export const session = sid => (sid && state.sessions[sid]) || null

// --- spend caps (testnet, but the rails are real) ---
export function spentToday(uid) {
  const k = `${uid}:${new Date().toISOString().slice(0, 10)}`
  return state.spent[k] || 0
}
export function addSpent(uid, ton) {
  const k = `${uid}:${new Date().toISOString().slice(0, 10)}`
  state.spent[k] = (state.spent[k] || 0) + ton
}
