// Drives the real app in the simulator through the whole flow, using the fake Telegram API for the group side.
// Saves glasses screenshots to $OUT (default /tmp/settle-shots). Needs: fake-telegram, server, sim-headless.sh running.
import crypto from 'node:crypto'
import fs from 'node:fs'
const API = 'http://localhost:8787', TG = 'http://localhost:8081', SIM = 'http://127.0.0.1:9898'
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'fake:token', OUT = process.env.OUT || '/tmp/settle-shots'
const PAYEE = process.env.PAYEE_ADDR, STEP = Number(process.env.STEP_MS || 1500)
fs.mkdirSync(OUT, { recursive: true })
const j = async (u, b) => (await fetch(u, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {})).json()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const input = a => fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: a }) })
let n = 0
const shot = async name => { const b = Buffer.from(await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer()); fs.writeFileSync(`${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, b) }
const victor = { id: 1001, first_name: 'Victor', username: 'victor_ok' }, ada = { id: 1002, first_name: 'Ada', username: 'ada_l' }, tunde = { id: 1003, first_name: 'Tunde', username: 'tunde_b' }
function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) })
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  p.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex')); return p.toString()
}
const console_ = async () => (await j(`${SIM}/api/console`)).entries.map(e => e.message).join('\n')
await sleep(1000); await shot('pair')
const code = fs.readFileSync('/tmp/sim.log', 'utf8').match(/Enter this code:\\n\\n\s*(\d{3}) (\d{3})/g)?.pop()?.match(/(\d{3}) (\d{3})/).slice(1).join('')
console.log('code on glasses', code)
console.log('pair', (await j(`${API}/api/mini/pair`, { initData: initData(victor), code })).ok)
await sleep(STEP); await shot('idle')
for (const u of [victor, tunde]) await j(`${TG}/say`, { from: u, text: 'morning 👋' })
await j(`${TG}/say`, { from: ada, text: `/wallet ${PAYEE}` })
await j(`${TG}/say`, { from: ada, text: process.env.MSG || '@victor_ok you owe me 0.05 TON for the suya last night 🙏' })
await sleep(STEP + 1500); await shot('card')
await input('click'); await sleep(1100); await shot('countdown')
await sleep(2500); await shot('sending')
for (let i = 0; i < 30; i++) { await sleep(1000); if ((await console_()).includes('') && fs.readFileSync('/tmp/sim.log', 'utf8').includes('Receipt posted')) break }
await sleep(500); await shot('paid')
const log = await j(`${TG}/log`); console.log('group:', log.at(-1).text.replace(/\n/g, ' | '))
await input('click'); await sleep(STEP); await shot('idle-after')
