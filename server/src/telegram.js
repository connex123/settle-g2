// Telegram Bot API: long polling, group message -> payment request, receipts back to the group.
import crypto from 'node:crypto'
import { config } from './config.js'
import { db, id, changed, rememberUser, userByUsername, displayName, redeemPairCode } from './store.js'
import { parseRequest } from './parse.js'
import { normalizeAddress, short } from './ton.js'

const base = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '')
export let botInfo = null

export async function tg(method, params = {}) {
  const r = await fetch(`${base}/bot${config.botToken}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000),
  })
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))
  if (!j.ok) throw new Error(`${method}: ${j.description}`)
  return j.result
}

// Group members we have seen, per chat (bots only see members who post or are mentioned).
function seen(chatId, uid) {
  const s = db()
  s.chatMembers ||= {}
  const list = (s.chatMembers[chatId] ||= [])
  if (!list.includes(uid)) list.push(uid)
}

function resolvePayers(p, msg) {
  const out = new Set()
  for (const tag of p.payers) {
    if (tag === '@REPLY_TARGET' && msg.reply_to_message?.from) out.add(msg.reply_to_message.from.id)
    else if (tag === '@ALL') for (const uid of db().chatMembers?.[msg.chat.id] || []) out.add(uid)
    else { const u = userByUsername(tag); if (u) out.add(u.id) }
  }
  out.delete(msg.from.id)
  for (const uid of [...out]) if (db().users[uid]?.isBot) out.delete(uid)
  return [...out]
}

async function onGroupText(msg) {
  const text = msg.text || msg.caption || ''
  const p = await parseRequest(text, {
    senderUsername: msg.from.username, replyToUsername: msg.reply_to_message?.from?.username,
  })
  if (!p) return
  const payers = resolvePayers(p, msg)
  if (!payers.length) return
  const payeeAddr = db().wallets[msg.from.id]
  const created = []
  for (const payerId of payers) {
    const r = {
      id: id(6), chatId: msg.chat.id, chatTitle: msg.chat.title || 'Group', messageId: msg.message_id,
      payeeId: msg.from.id, payerId, amount: p.per_person, memo: p.memo, parsedBy: p.source,
      status: 'pending', createdAt: Date.now(),
    }
    db().requests.push(r); created.push(r)
  }
  changed()
  tg('setMessageReaction', { chat_id: msg.chat.id, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👀' }] }).catch(() => {})
  if (!payeeAddr) {
    await tg('sendMessage', {
      chat_id: msg.chat.id, reply_parameters: { message_id: msg.message_id },
      text: `${displayName(msg.from.id)}, I need your TON testnet address to route this. Send /wallet <address> here or set it in the Settle app.`,
    }).catch(() => {})
  }
  return created
}

async function onCommand(msg, cmd, arg) {
  const chat = msg.chat.id
  if (cmd === '/wallet') {
    if (!arg) {
      const a = db().wallets[msg.from.id]
      return tg('sendMessage', { chat_id: chat, text: a ? `Your payout address: ${a}` : 'Send /wallet <your TON testnet address>' })
    }
    try {
      const a = normalizeAddress(arg)
      db().wallets[msg.from.id] = a; changed()
      // Requests made before the address was known can now be paid.
      return tg('sendMessage', { chat_id: chat, reply_parameters: { message_id: msg.message_id }, text: `Saved. Payments to ${displayName(msg.from.id)} go to ${short(a)} (testnet).` })
    } catch { return tg('sendMessage', { chat_id: chat, text: 'That is not a valid TON address.' }) }
  }
  if (cmd === '/pair') {
    if (msg.chat.type !== 'private') return tg('sendMessage', { chat_id: chat, text: 'Send /pair <code> to me in a private chat.' })
    const sid = redeemPairCode(arg, msg.from)
    return tg('sendMessage', { chat_id: chat, text: sid ? 'Glasses paired. Requests that name you will show up on your G2.' : 'Code not found or expired. Check the code on your glasses.' })
  }
  if (cmd === '/start' || cmd === '/help' || cmd === '/settle') {
    const kb = miniAppUrl() && msg.chat.type === 'private'
      ? { reply_markup: { keyboard: [[{ text: 'Open Settle', web_app: { url: miniAppUrl(msg.from.id) } }]], resize_keyboard: true } } : {}
    return tg('sendMessage', {
      chat_id: chat,
      text: 'Settle puts money requests from your Telegram groups on your Even G2 glasses. One glance, one tap, paid on TON (testnet), receipt posted back here.\n\n' +
        '1. Open Settle on the glasses and pair with the code it shows: tap Open Settle below, or send /pair <code>.\n2. Add me to a group and ask: "@friend you owe me 1.5 TON for dinner".\n3. Set where you get paid: /wallet <TON testnet address>',
      ...kb,
    })
  }
}

// Mini App URL. A static copy (GitHub Pages) works with no inbound HTTPS: it returns data via WebApp.sendData.
export function miniAppUrl(uid) {
  const base = config.miniAppUrl || (config.publicUrl ? `${config.publicUrl}/miniapp/` : '')
  if (!base || uid == null) return base
  const me = { w: db().wallets[uid] || '', p: config.maxPerPaymentTon, d: config.maxPerDayTon,
    r: db().requests.filter(r => r.payerId === uid || r.payeeId === uid).slice(-5).reverse()
      .map(r => [r.payerId === uid ? 'out' : 'in', displayName(r.payerId === uid ? r.payeeId : r.payerId), r.amount, r.memo, r.status]),
    g: Object.values(db().sessions).some(s => s.tgUserId === uid) }
  return `${base}#s=${encodeURIComponent(Buffer.from(JSON.stringify(me)).toString('base64url'))}`
}

async function onWebAppData(msg) {
  let d; try { d = JSON.parse(msg.web_app_data.data) } catch { return }
  const chat = msg.chat.id
  const out = []
  if (d.code) out.push(redeemPairCode(d.code, msg.from) ? 'Glasses paired ✓' : 'Pairing code not found or expired.')
  if (d.address) {
    try { db().wallets[msg.from.id] = normalizeAddress(d.address); changed(); out.push(`Payout address saved: ${short(db().wallets[msg.from.id])} (testnet) ✓`) }
    catch { out.push('That is not a valid TON address.') }
  }
  if (out.length) return tg('sendMessage', { chat_id: chat, text: out.join('\n'), reply_markup: { keyboard: [[{ text: 'Open Settle', web_app: { url: miniAppUrl(msg.from.id) } }]], resize_keyboard: true } })
}

export async function handleUpdate(u) {
  if (u.my_chat_member) {
    const c = u.my_chat_member.chat, st = u.my_chat_member.new_chat_member?.status
    db().chats ||= {}; db().chats[c.id] = { title: c.title || '', type: c.type, status: st, at: Date.now() }; changed()
    console.log(`[tg] bot ${st} in ${c.type} "${c.title || ''}"`)
    return
  }
  const msg = u.message
  if (!msg?.from) return
  rememberUser(msg.from)
  db().users[msg.from.id].isBot = !!msg.from.is_bot
  if (msg.reply_to_message?.from) rememberUser(msg.reply_to_message.from)
  for (const e of msg.entities || []) if (e.type === 'text_mention' && e.user) rememberUser(e.user)
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup'
  if (isGroup) { seen(msg.chat.id, msg.from.id); db().chats ||= {}; db().chats[msg.chat.id] ||= { title: msg.chat.title, type: msg.chat.type, status: 'member', at: Date.now() } }
  if (msg.web_app_data) return onWebAppData(msg)
  const text = msg.text || ''
  const m = text.match(/^(\/[a-z_]+)(?:@\w+)?\s*(.*)$/is)
  if (m) return onCommand(msg, m[1].toLowerCase(), m[2].trim())
  if (isGroup) return onGroupText(msg)
}

export async function postReceipt(r, txUrl) {
  const memo = r.memo ? ` for ${r.memo}` : ''
  return tg('sendMessage', {
    chat_id: r.chatId, reply_parameters: { message_id: r.messageId, allow_sending_without_reply: true },
    text: `✅ ${displayName(r.payerId)} paid ${r.amount} TON to ${displayName(r.payeeId)}${memo}.\nSent from Even G2 glasses · TON testnet`,
    reply_markup: { inline_keyboard: [[{ text: 'View on Tonviewer', url: txUrl }]] },
  })
}
export async function postDecline(r) {
  return tg('sendMessage', {
    chat_id: r.chatId, reply_parameters: { message_id: r.messageId, allow_sending_without_reply: true },
    text: `↩️ ${displayName(r.payerId)} can't pay this one right now.`,
  })
}

export async function startPolling() {
  if (!config.botToken) { console.log('[tg] no bot token, Telegram disabled'); return }
  botInfo = await tg('getMe')
  console.log(`[tg] polling as @${botInfo.username}`)
  if (miniAppUrl()) tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Settle', web_app: { url: miniAppUrl() } } }).catch(e => console.log('[tg] menu', e.message))
  tg('setMyCommands', { commands: [
    { command: 'start', description: 'What Settle does + open the Mini App' },
    { command: 'pair', description: 'Pair your glasses: /pair 123456' },
    { command: 'wallet', description: 'Set where you get paid: /wallet <TON testnet address>' },
  ] }).catch(() => {})
  tg('setMyDescription', { description: 'Settle puts money requests from your Telegram groups on your Even G2 glasses. One glance, one tap, paid on TON (testnet), receipt posted back to the group.' }).catch(() => {})
  let offset = 0
  for (;;) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'my_chat_member'] })
      for (const u of ups) { offset = u.update_id + 1; await handleUpdate(u).catch(e => console.log('[tg] handler', e.message)) }
    } catch (e) { console.log('[tg] poll', e.message); await new Promise(r => setTimeout(r, 3000)) }
  }
}

// Mini App auth: validate Telegram WebApp initData (HMAC-SHA256 with the bot token).
export function verifyInitData(initData, maxAgeSec = 24 * 3600) {
  if (!initData || !config.botToken) return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash'); params.delete('hash')
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest()
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex')
  if (!hash || calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > maxAgeSec) return null
  try { return JSON.parse(params.get('user')) } catch { return null }
}
