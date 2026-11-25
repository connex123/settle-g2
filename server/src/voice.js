// Hold-to-speak: raw 16 kHz PCM from the glasses mic -> local Whisper -> intent for the current card.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

let worker, rl, ready, pending = []
function start() {
  if (worker) return ready
  worker = spawn(process.env.PYTHON || 'python3', [new URL('../stt/whisper_worker.py', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] })
  rl = readline.createInterface({ input: worker.stdout })
  ready = new Promise(ok => {
    rl.on('line', l => { let j; try { j = JSON.parse(l) } catch { return } if (j.ready) return ok(); pending.shift()?.(j) })
  })
  worker.on('exit', () => { worker = null; for (const p of pending.splice(0)) p({ error: 'stt exited' }) })
  return ready
}
export const warmUp = () => start().catch(() => {})

function wav(pcm) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

export async function transcribe(pcm) {
  await start()
  const f = path.join(os.tmpdir(), `settle-${process.pid}-${Date.now()}.wav`)
  fs.writeFileSync(f, wav(pcm))
  try {
    return await new Promise((ok, no) => {
      pending.push(j => j.error ? no(new Error(j.error)) : ok(j.text))
      worker.stdin.write(JSON.stringify({ wav: f }) + '\n')
    })
  } finally { fs.rmSync(f, { force: true }) }
}

const WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
// Short phrases only: the card already holds the context, so the user never dictates a whole message.
export function intent(text, asked) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9. ]/g, ' ')} `
  if (/\b(decline|reject|can't|cannot|can not|no way|not now|refuse)\b/.test(t)) return { intent: 'decline' }
  if (/\b(later|skip|snooze|remind)\b/.test(t)) return { intent: 'later' }
  if (/\bhalf\b/.test(t)) return { intent: 'pay', amount: +(asked / 2).toFixed(4) }
  if (/\b(quarter)\b/.test(t)) return { intent: 'pay', amount: +(asked / 4).toFixed(4) }
  const spelled = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, w => WORDS[w]).replace(/(\d) point (\d)/g, '$1.$2')
  const n = spelled.match(/(\d+(?:\.\d+)?)/)
  if (n && /\b(pay|send|give|make it|do)\b/.test(t)) return { intent: 'pay', amount: Number(n[1]) }
  if (/\b(pay|yes|send it|confirm|okay|ok)\b/.test(t)) return { intent: 'pay', amount: asked }
  return { intent: 'unknown' }
}
