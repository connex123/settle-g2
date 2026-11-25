// End-to-end check against the fake Telegram API: pair -> group request -> card -> pay on TON testnet -> receipt.
import crypto from 'node:crypto'
const API = process.env.API || 'http://localhost:8787', TG = process.env.TG || 'http://localhost:8081', TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'fake:token'
const PAYEE = process.env.PAYEE_ADDR
const j = async (u, b) => (await fetch(u, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {})).json()
const victor = { id: 1001, first_name: 'Victor', username: 'victor_ok' }, ada = { id: 1002, first_name: 'Ada', username: 'ada_l' }
function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAE', user: JSON.stringify(user) })
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  p.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex')); return p.toString()
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const { sid } = await j(`${API}/api/session`, {})
let st = await j(`${API}/api/state?sid=${sid}`); console.log('glasses shows code', st.code)
console.log('pair:', (await j(`${API}/api/mini/pair`, { initData: initData(victor), code: st.code })).ok)
await j(`${TG}/say`, { from: victor, text: 'hey all' })
await j(`${TG}/say`, { from: ada, text: `/wallet ${PAYEE}` })
const t0 = Date.now()
await j(`${TG}/say`, { from: ada, text: process.env.MSG || '@victor_ok you owe me 0.05 TON for the suya last night 🙏' })
for (let i = 0; i < 40; i++) { st = await j(`${API}/api/state?sid=${sid}`); if (st.queue?.length) break; await sleep(250) }
console.log('card after', Date.now() - t0, 'ms:', JSON.stringify(st.queue?.[0]))
if (process.env.NO_PAY) process.exit(0)
const r = await j(`${API}/api/requests/${st.queue[0].id}/pay`, { sid })
console.log('pay:', r.ok, r.error || r.card.tx.url)
await sleep(500)
const log = await j(`${TG}/log`); console.log('group last:', log.at(-1).text.replace(/\n/g, ' | '))
