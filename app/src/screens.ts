// Pure screen model: state -> three text blocks sized for the 576x288 G2 canvas.
// Kept free of SDK calls so it can be unit-tested (see test/screens.test.mjs).

export type Card = {
  id: string; chat: string; payee: string; amount: number; memo: string; to: string
  hasAddress: boolean; ageSec: number; status: string; error: string | null
  tx: { hash: string; url: string } | null
}
export type Screen = { header: string; body: string; footer: string }

const fmt = (n: number | null | undefined) => n == null ? '…' : (Math.round(n * 1000) / 1000).toString()
export const ago = (s: number) => s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export const big = (n: number | undefined) => fmt(n ?? 0)

export function pairing(code: string | undefined, bot: string | null): Screen {
  const c = code ? `${code.slice(0, 3)} ${code.slice(3)}` : '··· ···'
  return {
    header: 'SETTLE  ·  pair with Telegram',
    body: `Open ${bot ? '@' + bot : 'the Settle bot'} in Telegram\nand tap  Open Settle.\n\nEnter this code:\n\n        ${c}`,
    footer: 'Code refreshes every 10 min',
  }
}

export function idle(me: string, balance: number | null, last: Card | null, queued: number): Screen {
  const lastLine = last ? `Last: paid ${clip(last.payee, 14)} ${fmt(last.amount)} TON · ${ago(last.ageSec)}` : 'Waiting for requests from your groups'
  return {
    header: `SETTLE  ·  ${clip(me, 18)}  ·  testnet`,
    body: queued ? `${queued} request${queued > 1 ? 's' : ''} waiting\n\n▶ tap to review` : `●  All settled\n\n${lastLine}`,
    footer: `Wallet ${fmt(balance)} TON${queued ? '   ·   tap review' : ''}   ·   double-tap exit`,
  }
}

export function request(c: Card, idx: number, total: number, amountOverride?: number): Screen {
  const amt = amountOverride ?? c.amount
  const memo = c.memo ? `for ${clip(c.memo, 22)}` : ''
  const changed = amountOverride != null && amountOverride !== c.amount ? `  (asked ${fmt(c.amount)})` : ''
  const warn = !c.hasAddress ? '\n! waiting for their TON address'
    : c.status === 'failed' ? `\n! ${clip(c.error || 'failed', 40)} · tap to retry` : ''
  return {
    header: `${clip(c.chat.toUpperCase(), 22)}  ·  ${clip(c.payee, 14)}  ·  ${ago(c.ageSec)}${total > 1 ? `   ${idx + 1}/${total}` : ''}`,
    body: `${clip(c.payee, 18)} asks you to pay${changed}\n\n\n\n\n${[memo, c.to ? 'to ' + c.to : ''].filter(Boolean).join('   ·   ')}${warn}`,
    footer: c.hasAddress ? 'tap pay  ·  hold speak  ·  swipe next  ·  2×tap later' : 'swipe next  ·  2×tap later',
  }
}

export function countdown(c: Card, amount: number, secs: number): Screen {
  const bar = '━━━━━━'.repeat(3 - secs) + '──────'.repeat(secs)
  return {
    header: `${clip(c.chat.toUpperCase(), 22)}  ·  ${clip(c.payee, 14)}`,
    body: `Paying ${clip(c.payee, 16)} in ${secs}…\n\n\n\n\n${bar}`,
    footer: 'double-tap to cancel',
  }
}

export function sending(c: Card, amount: number): Screen {
  return { header: 'SETTLE  ·  TON testnet', body: `Sending ${fmt(amount)} TON\nto ${clip(c.payee, 18)}  ${c.to}\n\n…`, footer: 'usually 5–10 s' }
}

export function paid(c: Card): Screen {
  return {
    header: 'SETTLE  ·  paid',
    body: `●  Paid ${clip(c.payee, 16)}  ${fmt(c.amount)} TON\n\nReceipt posted in ${clip(c.chat, 20)}\ntx ${c.tx?.hash || ''}`,
    footer: 'tap continue',
  }
}

export function listening(seconds: number): Screen {
  return { header: 'SETTLE  ·  listening', body: `●  Speak now\n\n"pay half"  ·  "pay 2"  ·  "decline"\n\n${'━━'.repeat(Math.min(seconds, 12))}`, footer: 'release to finish' }
}

export function message(title: string, text: string, footer = 'tap continue'): Screen {
  return { header: `SETTLE  ·  ${title}`, body: text, footer }
}
