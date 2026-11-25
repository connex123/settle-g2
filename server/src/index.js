// Settle backend: HTTP API for the G2 app and the Telegram Mini App, plus the Telegram poller.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { db, changed, onChange, newSession, newPairCode, redeemPairCode, session, displayName, spentToday, addSpent, rememberUser } from './store.js'
import { startPolling, postReceipt, postDecline, verifyInitData, botInfo } from './telegram.js'
import { sendTon, balanceTon, walletAddress, explorerTx, short, normalizeAddress } from './ton.js'
import { llmUsage } from './parse.js'
import { transcribe, intent, warmUp } from './voice.js'

let version = 1
onChange(() => { version++; for (const w of waiters.splice(0)) w() })
const waiters = []

const MINIAPP_DIR = path.resolve(new URL('../../miniapp/', import.meta.url).pathname)
const APP_DIST = path.resolve(new URL('../../app/dist/', import.meta.url).pathname)

let cachedBalance = { v: null, at: 0 }
async function balance() {
  if (Date.now() - cachedBalance.at > 10_000) { try { cachedBalance = { v: await balanceTon(), at: Date.now() } } catch {} }
  return cachedBalance.v
}

function card(r) {
  return {
    id: r.id, chat: r.chatTitle, payee: displayName(r.payeeId), amount: r.amount, memo: r.memo,
    to: short(db().wallets[r.payeeId] || ''), hasAddress: !!db().wallets[r.payeeId],
    ageSec: Math.round((Date.now() - r.createdAt) / 1000), status: r.status, error: r.error || null,
    tx: r.txHash ? { hash: r.txHash.slice(0, 8), url: explorerTx(r.txHash) } : null,
  }
}

async function stateFor(sid) {
  const s = session(sid)
  if (!s) return { error: 'unknown session' }
  if (!s.tgUserId) {
    let code = Object.entries(db().pairCodes).find(([, v]) => v.sid === sid && v.exp > Date.now() + 60_000)?.[0]
    if (!code) code = newPairCode(sid)
    return { paired: false, code, bot: botInfo?.username || null, version }
  }
  const mine = db().requests.filter(r => r.payerId === s.tgUserId)
  const queue = mine.filter(r => ['pending', 'paying', 'failed'].includes(r.status)).sort((a, b) => a.createdAt - b.createdAt).map(card)
  const last = mine.filter(r => r.status === 'paid').sort((a, b) => b.paidAt - a.paidAt)[0]
  return {
    paired: true, me: displayName(s.tgUserId), queue, last: last ? card(last) : null,
    balance: await balance(), wallet: short(await walletAddress()), network: config.network,
    caps: { perPayment: config.maxPerPaymentTon, perDay: config.maxPerDayTon, spentToday: +spentToday(s.tgUserId).toFixed(4) },
    version,
  }
}

async function pay(sid, rid, amountOverride) {
  const s = session(sid)
  const r = db().requests.find(x => x.id === rid)
  if (!s?.tgUserId || !r || r.payerId !== s.tgUserId) return { ok: false, error: 'not your request' }
  if (!['pending', 'failed'].includes(r.status)) return { ok: false, error: `already ${r.status}` }
  const to = db().wallets[r.payeeId]
  if (!to) return { ok: false, error: 'payee has no address yet' }
  const amount = amountOverride > 0 ? Math.round(amountOverride * 1e4) / 1e4 : r.amount
  if (amount > config.maxPerPaymentTon) return { ok: false, error: `over ${config.maxPerPaymentTon} TON limit` }
  if (spentToday(s.tgUserId) + amount > config.maxPerDayTon) return { ok: false, error: 'daily limit reached' }
  const bal = await balanceTon().catch(() => null)
  if (bal !== null && bal < amount + 0.02) return { ok: false, error: 'wallet balance too low' }
  r.amount = amount; r.status = 'paying'; r.error = null; changed()
  try {
    const comment = `Settle${r.memo ? ': ' + r.memo : ''}`.slice(0, 120)
    const tx = await sendTon(to, amount, comment)
    r.status = 'paid'; r.txHash = tx.hash; r.paidAt = Date.now(); addSpent(s.tgUserId, amount)
    cachedBalance.at = 0
    changed()
    postReceipt(r, explorerTx(tx.hash)).catch(e => console.log('[tg] receipt', e.message))
    return { ok: true, card: card(r) }
  } catch (e) {
    r.status = 'failed'; r.error = String(e.message).slice(0, 80); changed()
    return { ok: false, error: r.error }
  }
}

function decline(sid, rid) {
  const s = session(sid)
  const r = db().requests.find(x => x.id === rid)
  if (!s?.tgUserId || !r || r.payerId !== s.tgUserId || !['pending', 'failed'].includes(r.status)) return { ok: false }
  r.status = 'declined'; changed()
  postDecline(r).catch(() => {})
  return { ok: true }
}

// ---- Mini App helpers ----
function miniMe(user) {
  const sessions = Object.entries(db().sessions).filter(([, s]) => s.tgUserId === user.id)
  const reqs = db().requests.filter(r => r.payerId === user.id || r.payeeId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8)
  return {
    user: { id: user.id, name: displayName(user.id) }, wallet: db().wallets[user.id] || null,
    glassesPaired: sessions.length, caps: { perPayment: config.maxPerPaymentTon, perDay: config.maxPerDayTon, spentToday: spentToday(user.id) },
    recent: reqs.map(r => ({ ...card(r), direction: r.payerId === user.id ? 'out' : 'in', other: displayName(r.payerId === user.id ? r.payeeId : r.payerId) })),
  }
}

// ---- HTTP ----
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(body)) }
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
const readBody = req => new Promise(ok => { let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy() }); req.on('end', () => { try { ok(JSON.parse(b || '{}')) } catch { ok({}) } }) })
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }
function serveStatic(res, dir, rel) {
  const p = path.resolve(dir, '.' + path.normalize('/' + (rel || 'index.html')))
  if (!p.startsWith(dir)) return json(res, 403, {})
  fs.readFile(p, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' })
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', ...cors }); res.end(data)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, bot: botInfo?.username || null, network: config.network, llm: llmUsage() })
    if (p === '/api/session' && req.method === 'POST') return json(res, 200, { sid: newSession() })
    if (p === '/api/state') {
      const sid = url.searchParams.get('sid')
      const since = Number(url.searchParams.get('v') || 0)
      if (since && since === version) await new Promise(ok => { waiters.push(ok); setTimeout(ok, 20000) })
      return json(res, 200, await stateFor(sid))
    }
    let m
    if ((m = p.match(/^\/api\/requests\/(\w+)\/(pay|decline)$/)) && req.method === 'POST') {
      const b = await readBody(req)
      return json(res, 200, m[2] === 'pay' ? await pay(b.sid, m[1], Number(b.amount) || 0) : decline(b.sid, m[1]))
    }
    if (p === '/api/voice' && req.method === 'POST') {
      const b = await readBody(req)
      const s = session(b.sid), r = db().requests.find(x => x.id === b.id)
      if (!s?.tgUserId || !r || r.payerId !== s.tgUserId) return json(res, 403, { ok: false })
      const pcm = Buffer.from(String(b.pcm || ''), 'base64')
      if (pcm.length < 3200) return json(res, 200, { ok: true, intent: 'unknown', text: '' })
      const text = await transcribe(pcm).catch(e => { console.log('[stt]', e.message); return '' })
      return json(res, 200, { ok: true, text, ...intent(text, r.amount) })
    }
    if (p.startsWith('/api/mini/') && req.method === 'POST') {
      const b = await readBody(req)
      const user = verifyInitData(b.initData)
      if (!user) return json(res, 401, { error: 'Open this page from the Settle bot in Telegram.' })
      rememberUser(user)
      if (p === '/api/mini/me') return json(res, 200, miniMe(user))
      if (p === '/api/mini/pair') {
        const sid = redeemPairCode(b.code, user)
        return json(res, sid ? 200 : 400, sid ? { ok: true, ...miniMe(user) } : { error: 'Code not found or expired. Check the code on your glasses.' })
      }
      if (p === '/api/mini/wallet') {
        try { db().wallets[user.id] = normalizeAddress(b.address); changed(); return json(res, 200, { ok: true, ...miniMe(user) }) }
        catch { return json(res, 400, { error: 'Not a valid TON address.' }) }
      }
    }
    if (p === '/miniapp' ) { res.writeHead(302, { location: '/miniapp/' }); return res.end() }
    if (p.startsWith('/miniapp/')) return serveStatic(res, MINIAPP_DIR, p.slice('/miniapp/'.length))
    if (p.startsWith('/app/')) return serveStatic(res, APP_DIST, p.slice('/app/'.length))
    return json(res, 404, { error: 'not found' })
  } catch (e) { console.log('[http]', e); return json(res, 500, { error: 'server error' }) }
})

server.listen(config.port, '0.0.0.0', async () => {
  console.log(`[settle] http://localhost:${config.port}  network=${config.network}  wallet=${await walletAddress().catch(() => '?')}`)
  startPolling().catch(e => console.log('[tg] start failed:', e.message))
  if (process.env.SETTLE_STT !== '0') warmUp()
})
