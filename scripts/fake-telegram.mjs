// Local stand-in for the Telegram Bot API, for tests and offline dev only.
// Implements the handful of methods Settle uses, plus a tiny chat view (GET /) and POST /say to post as a user.
// Run: node scripts/fake-telegram.mjs  (port 8081), then start the server with TELEGRAM_API_BASE=http://localhost:8081 TELEGRAM_BOT_TOKEN=fake:token
import http from 'node:http'
const PORT = Number(process.env.FAKE_TG_PORT || 8081)
const bot = { id: 999, is_bot: true, first_name: 'Settle', username: 'SettleG2Bot' }
const chat = { id: -100123, type: 'supergroup', title: process.env.FAKE_TG_CHAT || 'Lagos Flat' }
const log = []; const updates = []; let uid = 1, mid = 1; const waiters = []
const push = u => { updates.push({ update_id: uid++, ...u }); waiters.splice(0).forEach(w => w()) }
const send = (res, body) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) }
const body = req => new Promise(ok => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { ok(JSON.parse(b || '{}')) } catch { ok({}) } }) })
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); return res.end() }
  if (url.pathname === '/say') {
    const b = await body(req)
    const msg = { message_id: mid++, date: Math.floor(Date.now() / 1000), chat: b.private ? { id: b.from.id, type: 'private' } : chat, from: { is_bot: false, ...b.from }, text: b.text }
    if (b.reply_to) msg.reply_to_message = log.find(m => m.message_id === b.reply_to)
    if (!b.private) log.push(msg)
    push({ message: msg }); return send(res, { ok: true, result: msg })
  }
  if (url.pathname === '/log') return send(res, log)
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<meta charset=utf-8><title>${chat.title}</title><body style="font:16px system-ui;background:#0e1621;color:#fff;margin:0"><h3 style="background:#17212b;margin:0;padding:12px">${chat.title} <small style="color:#7d8b99">· local test chat</small></h3><div id=l style="padding:10px"></div><script>setInterval(async()=>{const l=await (await fetch('/log')).json();document.getElementById('l').innerHTML=l.map(m=>'<div style="margin:6px 0;padding:8px 12px;border-radius:12px;max-width:70%;background:'+(m.from.is_bot?'#2b5278':'#182533')+'"><b style="color:#6ab3f3">'+(m.from.first_name)+'</b>'+(m.reaction?' '+m.reaction:'')+'<br>'+m.text.replace(/</g,'&lt;').replace(/\\n/g,'<br>')+(m.reply_markup?'<br><span style="color:#6ab3f3">['+m.reply_markup.inline_keyboard[0][0].text+']</span>':'')+'</div>').join('');scrollTo(0,1e9)},500)</script>`) }
  const m = url.pathname.match(/^\/bot[^/]+\/(\w+)$/)
  if (!m) { res.writeHead(404); return res.end() }
  const p = await body(req)
  switch (m[1]) {
    case 'getMe': return send(res, { ok: true, result: bot })
    case 'getUpdates': {
      const off = p.offset || 0
      const pending = () => updates.filter(u => u.update_id >= off)
      if (!pending().length) await new Promise(ok => { waiters.push(ok); setTimeout(ok, Math.min(25, p.timeout || 0) * 1000) })
      return send(res, { ok: true, result: pending() })
    }
    case 'sendMessage': {
      const msg = { message_id: mid++, date: Math.floor(Date.now() / 1000), chat: { id: p.chat_id }, from: bot, text: p.text, reply_markup: p.reply_markup }
      if (p.chat_id === chat.id) log.push(msg)
      console.log('[bot]', p.chat_id, p.text.split('\n')[0]); return send(res, { ok: true, result: msg })
    }
    case 'setMessageReaction': { const t = log.find(x => x.message_id === p.message_id); if (t) t.reaction = p.reaction?.[0]?.emoji; return send(res, { ok: true, result: true }) }
    default: return send(res, { ok: true, result: true })
  }
}).listen(PORT, () => console.log(`fake telegram on :${PORT}`))
