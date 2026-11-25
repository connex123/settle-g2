// Live test helper: when a real request card appears on the simulator, screenshot it, wait, tap (the user's tap), and log the outcome.
// Caps how many payments it will confirm (default 2). Testnet only (server enforces).
import fs from 'node:fs'
const SIM = 'http://127.0.0.1:9898', OUT = process.env.OUT || '/home/box/bounty/dorahacks/even-realities/run/live-shots', MAX = Number(process.env.MAX_PAYS || 2)
fs.mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = async n => fs.writeFileSync(`${OUT}/${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${n}.png`, Buffer.from(await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer()))
const input = a => fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: a }) })
let pays = 0, seen = 0, paired = false
for (;;) {
  const log = fs.readFileSync('/tmp/sim.log', 'utf8')
  if (!paired && log.includes('All settled')) { paired = true; console.log(new Date().toISOString(), 'paired'); await shot('paired') }
  const n = (log.match(/asks you to pay/g) || []).length
  if (n > seen && pays < MAX) {
    seen = n; await sleep(2500); await shot('card'); await sleep(4000)
    if (fs.readFileSync('/tmp/sim.log', 'utf8').includes('waiting for their TON address')) { console.log('card waiting for payee address'); continue }
    await input('click'); await sleep(1200); await shot('countdown'); pays++
    for (let i = 0; i < 40; i++) { await sleep(1000); if (fs.readFileSync('/tmp/sim.log', 'utf8').split('Receipt posted').length - 1 >= pays) break }
    await shot('paid'); console.log(new Date().toISOString(), 'paid', pays)
    await sleep(3000); await input('click')
  }
  await sleep(1000)
}
