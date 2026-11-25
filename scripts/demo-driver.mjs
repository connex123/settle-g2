// Plays the demo story against the running stack and writes caption timings for the video.
// Group side: fake Telegram (FAKE=1, default) or a real group where people type (FAKE=0: the script waits for cards instead).
import crypto from 'node:crypto'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
const API = 'http://localhost:8787', TG = 'http://localhost:8081', SIM = 'http://127.0.0.1:9898'
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'fake:token', PAYEE = process.env.PAYEE_ADDR, CAP = process.env.CAPTIONS || '/tmp/demo-captions.json'
const t0 = Number(process.env.T0 || Date.now())
const caps = []
const cap = (text, dur = 5) => { caps.push({ start: (Date.now() - t0) / 1000, dur, text }); fs.writeFileSync(CAP, JSON.stringify(caps, null, 1)) }
const j = async (u, b) => (await fetch(u, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {})).json()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const input = a => fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: a }) })
const victor = { id: 1001, first_name: 'Victor', username: 'victor_ok' }, ada = { id: 1002, first_name: 'Ada', username: 'ada_l' }, tunde = { id: 1003, first_name: 'Tunde', username: 'tunde_b' }
function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) })
  const c = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  p.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(c).digest('hex')); return p.toString()
}
const say = (from, text, extra = {}) => j(`${TG}/say`, { from, text, ...extra })
const simLog = () => fs.readFileSync('/tmp/sim.log', 'utf8')
async function until(pred, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await sleep(300) } return false }
const lastBot = async () => (await j(`${TG}/log`)).filter(m => m.from.is_bot).at(-1)?.text || ''

cap('Settle: money requests from your Telegram groups, paid from your Even G2 glasses', 6)
await sleep(6000)
cap('Pair once: the glasses show a code, you enter it in the Settle Mini App in Telegram', 5)
await sleep(3500)
const code = simLog().match(/Enter this code:\\n\\n\s*(\d{3}) (\d{3})/g).pop().match(/(\d{3}) (\d{3})/).slice(1).join('')
await j(`${API}/api/mini/pair`, { initData: initData(victor), code })
await sleep(3000)
await say(tunde, 'Light don go again 😩 generator on')
await say(ada, `/wallet ${PAYEE}`); await sleep(1200)
await say(tunde, `/wallet ${PAYEE}`); await sleep(1500)
await say(victor, 'Thanks for sorting the suya Ada 🙌'); await sleep(2000)
cap('Ada asks in the group. Settle reads it and puts one card on your glasses', 6)
await say(ada, '@victor_ok you owe me 0.05 TON for the suya last night 🙏')
await until(() => simLog().includes('asks you to pay'))
await sleep(4500)
cap('One tap to pay. Three seconds to change your mind (double-tap cancels)', 5)
await input('click'); await sleep(3200)
cap('Sent on TON testnet. The receipt is posted back as a reply, with the explorer link', 7)
await until(async () => (await lastBot()).includes('paid 0.05'), 40000)
await sleep(4000)
await input('click'); await sleep(2000)
cap('Splits work too: Settle works out your share', 5)
await say(tunde, 'Diesel was 0.12 TON. Split between me, @victor_ok and @ada_l pls')
await until(() => simLog().includes('Tunde asks you to pay'))
await sleep(4000)
cap('Hold the temple and speak: "pay half"', 6)
await input('long_press'); await sleep(1500)
execSync('paplay --device=speakers ' + (process.env.VOICE_WAV || '/tmp/v1.wav')); await sleep(900)
await input('long_press_release')
await sleep(4500)
cap('Settle heard "pay half": 0.02 TON, with the same 3 s to cancel', 6)
await until(async () => (await lastBot()).includes('0.02'), 40000)
cap('Paid. Nothing ever pays without your tap or your voice', 6)
await sleep(4000)
await input('click'); await sleep(2500)
cap('All settled. Testnet only, per-payment and daily limits, no message text stored', 6)
await sleep(6500)
fs.writeFileSync(CAP, JSON.stringify(caps, null, 1))
console.log('done', (Date.now() - t0) / 1000, 's')
