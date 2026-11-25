// Settle: Telegram money requests on Even G2. One glance, one tap, paid on TON testnet.
import {
  waitForEvenAppBridge, TextContainerProperty, CreateStartUpPageContainer, RebuildPageContainer,
  TextContainerUpgrade, OsEventTypeList, AudioInputSource, ImageContainerProperty, ImageRawDataUpdate,
} from '@evenrealities/even_hub_sdk'
import { amountImage } from './bigtext'
import * as S from './screens'
import type { Card, Screen } from './screens'

const API = (import.meta.env.VITE_SETTLE_API as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8787'
const log = (...a: unknown[]) => console.log('[settle]', ...a)

type View = 'boot' | 'pair' | 'idle' | 'card' | 'countdown' | 'sending' | 'paid' | 'listening' | 'message'
let view: View = 'boot'
let st: any = null
let idx = 0
let override: number | undefined
let current: Card | null = null
let snoozed = new Set<string>()
let timer: ReturnType<typeof setInterval> | null = null
let sid = ''

const bridge = await waitForEvenAppBridge()

// ---------- rendering ----------
// Layout 'text': header / body (captures input) / footer.
// Layout 'card': same three texts plus one image container that draws the amount in large type
// (the system font has a single size, so big numbers are rendered to pixels).
const box = (id: number, name: string, y: number, h: number, content: string, extra: Partial<TextContainerProperty> = {}) =>
  new TextContainerProperty({ xPosition: 0, yPosition: y, width: 576, height: h, borderWidth: 0, borderColor: 5, paddingLength: 6, containerID: id, containerName: name, content, ...extra })
const texts = (s: Screen) => [
  box(1, 'hdr', 0, 44, s.header, { textColor: 2 }),
  box(2, 'body', 44, 188, s.body, { isEventCapture: 1, textColor: 4 }),
  box(3, 'ftr', 236, 52, s.footer, { textColor: 2, borderWidth: 1, borderColor: 6, borderRadius: 6, paddingLength: 8 }),
]
const IMG = { xPosition: 4, yPosition: 76, width: 288, height: 96, containerID: 4, containerName: 'amount' }
let started = false
let layout: 'text' | 'card' = 'text'
let lastShown: Screen | null = null
let lastImg = ''
let imgBusy: Promise<unknown> = Promise.resolve()
async function show(s: Screen, big?: string) {
  mirror(s, big)
  const want = big ? 'card' : 'text'
  if (!started) {
    const r = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: 3, textObject: texts(s) }))
    started = true; lastShown = s; layout = 'text'; log('page created', r); log('app ready')
    if (!big) return
  }
  if (want !== layout) {
    const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(want === 'card'
      ? { containerTotalNum: 4, textObject: texts(s), imageObject: [new ImageContainerProperty(IMG)] }
      : { containerTotalNum: 3, textObject: texts(s) }))
    layout = want; lastShown = s; lastImg = ''
    if (!ok) log('rebuild failed')
  } else if (lastShown) {
    const parts: [number, string, keyof Screen][] = [[1, 'hdr', 'header'], [2, 'body', 'body'], [3, 'ftr', 'footer']]
    for (const [id, name, k] of parts) if (lastShown[k] !== s[k]) await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: id, containerName: name, content: s[k] }))
    lastShown = s
  }
  if (big && big !== lastImg) {
    lastImg = big
    const data = await amountImage(big, IMG.width, IMG.height)
    imgBusy = imgBusy.then(() => bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: 4, containerName: 'amount', imageData: data }))).then(r => log('image', r)).catch(e => log('image error', String(e)))
    await imgBusy
  }
}

// Phone-side mirror (the WebView is also visible on the phone and in the simulator's web view).
function mirror(s: Screen, big?: string) {
  const el = document.getElementById('mirror')
  if (el) el.textContent = `${s.header}\n${'─'.repeat(40)}\n${big ? '[ ' + big + ' ]\n' : ''}${s.body}\n${'─'.repeat(40)}\n${s.footer}`
}

// ---------- backend ----------
async function api(path: string, body?: unknown) {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  return r.json()
}
async function getSid() {
  let v = (await bridge.getLocalStorage('settle.sid').catch(() => '')) || localStorage.getItem('settle.sid') || ''
  if (v) { const s = await api(`/api/state?sid=${v}`).catch(() => null); if (s && !s.error) return v }
  v = (await api('/api/session', {})).sid
  localStorage.setItem('settle.sid', v); await bridge.setLocalStorage('settle.sid', v).catch(() => {})
  return v
}

const queue = (): Card[] => (st?.queue || []).filter((c: Card) => !snoozed.has(c.id) && c.status !== 'paying')

function render() {
  if (!st) return
  if (!st.paired) { view = 'pair'; return show(S.pairing(st.code, st.bot)) }
  if (['countdown', 'sending', 'paid', 'listening', 'message'].includes(view)) return
  const q = queue()
  if (view === 'card' && current) {
    const fresh = q.find(c => c.id === current!.id)
    if (fresh) { current = fresh; idx = q.indexOf(fresh); return show(S.request(fresh, idx, q.length, override), S.big(override ?? fresh.amount)) }
  }
  if (q.length) { idx = Math.min(idx, q.length - 1); current = q[idx]; view = 'card'; override = undefined; return show(S.request(current, idx, q.length), S.big(current.amount)) }
  view = 'idle'; current = null
  return show(S.idle(st.me, st.balance, st.last, 0))
}

async function poll() {
  for (;;) {
    try { st = await api(`/api/state?sid=${sid}&v=${st?.version || 0}`); await render() }
    catch (e) { log('poll error', String(e)); await new Promise(r => setTimeout(r, 2000)) }
  }
}

// ---------- actions ----------
function startCountdown() {
  if (!current || !current.hasAddress) return
  const c = current, amount = override ?? c.amount
  let secs = 3
  view = 'countdown'; show(S.countdown(c, amount, secs), S.big(amount))
  timer = setInterval(async () => {
    secs--
    if (secs > 0) return void show(S.countdown(c, amount, secs), S.big(amount))
    clearInterval(timer!); timer = null
    view = 'sending'; show(S.sending(c, amount))
    const r = await api(`/api/requests/${c.id}/pay`, { sid, amount }).catch(e => ({ ok: false, error: String(e) }))
    if (r.ok) { current = r.card; view = 'paid'; show(S.paid(r.card)) }
    else { view = 'message'; show(S.message('not sent', `Payment not sent:\n${r.error}`)) }
  }, 1000)
}
function cancelCountdown() { if (timer) clearInterval(timer); timer = null; view = 'card'; render() }
function back() { view = 'idle'; override = undefined; render() }

// ---------- voice: hold to speak ----------
let pcm: Uint8Array[] = []
let listenTick: ReturnType<typeof setInterval> | null = null
async function startListening() {
  if (view !== 'card' || !current) return
  pcm = []; view = 'listening'; let s = 0; show(S.listening(0))
  listenTick = setInterval(() => show(S.listening(++s)), 1000)
  await bridge.audioControl(true, AudioInputSource.Glasses).catch(() => bridge.audioControl(true, AudioInputSource.Phone))
}
async function stopListening() {
  if (view !== 'listening') return
  if (listenTick) clearInterval(listenTick)
  await bridge.audioControl(false).catch(() => {})
  const c = current!
  const total = pcm.reduce((n, b) => n + b.length, 0)
  const all = new Uint8Array(total); let o = 0; for (const b of pcm) { all.set(b, o); o += b.length }
  view = 'message'; show(S.message('voice', 'Thinking…', ''))
  let bin = ''; for (let i = 0; i < all.length; i += 0x8000) bin += String.fromCharCode(...all.subarray(i, i + 0x8000))
  const r = await api('/api/voice', { sid, id: c.id, pcm: btoa(bin) }).catch(() => ({ ok: false }))
  log('voice', JSON.stringify(r))
  view = 'card'
  if (r.intent === 'pay' && r.amount > 0) { override = r.amount; current = c; await show(S.request(c, idx, queue().length, override), S.big(override)); return startCountdown() }
  if (r.intent === 'decline') { await api(`/api/requests/${c.id}/decline`, { sid }); view = 'message'; return show(S.message('declined', `Told ${c.payee} you can't pay now.`)) }
  if (r.intent === 'later') { snoozed.add(c.id); return back() }
  view = 'message'; show(S.message('voice', r.text ? `Heard: "${S.clip(r.text, 60)}"\nTry "pay half", "pay 2" or "decline".` : 'Did not catch that.'))
}

// ---------- input ----------
const typeOf = (e?: { eventType?: OsEventTypeList }) => (e ? e.eventType ?? OsEventTypeList.CLICK_EVENT : null)
bridge.onEvenHubEvent(event => {
  if (event.audioEvent) { if (view === 'listening') pcm.push(event.audioEvent.audioPcm); return }
  const sys = typeOf(event.sysEvent), txt = typeOf(event.textEvent)
  if (sys === OsEventTypeList.LONG_PRESS_EVENT) return void startListening()
  if (sys === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return void stopListening()
  if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) return void render()
  if (sys === OsEventTypeList.SYSTEM_EXIT_EVENT || sys === OsEventTypeList.ABNORMAL_EXIT_EVENT || sys === OsEventTypeList.IMU_DATA_REPORT || sys === OsEventTypeList.FOREGROUND_EXIT_EVENT) return
  const t = txt ?? sys
  if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (view === 'countdown') return cancelCountdown()
    if (view === 'card' && current) { snoozed.add(current.id); return back() }
    if (view === 'idle' || view === 'pair') return void bridge.shutDownPageContainer(1)
    return back()
  }
  if (t === OsEventTypeList.CLICK_EVENT) {
    if (view === 'card') return startCountdown()
    if (view === 'idle' && queue().length) { snoozed.clear(); view = 'card'; return void render() }
    if (view === 'paid' || view === 'message') return back()
    return
  }
  if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT || t === OsEventTypeList.SCROLL_TOP_EVENT) {
    if (view !== 'card') return
    const q = queue(); if (q.length < 2) return
    idx = (idx + (t === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 1 : q.length - 1)) % q.length
    current = q[idx]; override = undefined; show(S.request(current, idx, q.length), S.big(current.amount))
  }
})

// ---------- boot ----------
await show(S.message('starting', 'Connecting…', ''))
view = 'boot'
try { sid = await getSid(); log('session ok') } catch (e) { await show(S.message('offline', `Can't reach the Settle server.\n${API}`, 'retrying…')); log('boot error', String(e)) }
while (!sid) { await new Promise(r => setTimeout(r, 3000)); try { sid = await getSid() } catch {} }
poll()
