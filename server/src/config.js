// Runtime config. Secrets are read from files outside the repo (never committed, never logged).
import fs from 'node:fs'
import path from 'node:path'

const SECRETS = process.env.SETTLE_SECRETS_DIR || '/home/box/secrets'
const readSecret = (name, envName) => {
  if (process.env[envName]) return process.env[envName].trim()
  const p = path.join(SECRETS, name)
  try { return fs.readFileSync(p, 'utf8').trim() } catch { return '' }
}

export const config = {
  port: Number(process.env.PORT || 8787),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''), // HTTPS origin for the Mini App
  botToken: readSecret('settle-telegram-bot.token', 'TELEGRAM_BOT_TOKEN'),
  tonMnemonic: readSecret('settle-ton-testnet.mnemonic', 'TON_MNEMONIC'),
  toncenterKey: readSecret('settle-toncenter.key', 'TONCENTER_API_KEY'),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  parserModel: process.env.SETTLE_PARSER_MODEL || 'claude-haiku-4-5',
  // Safety rails: testnet only, small per-payment and daily caps.
  network: 'testnet',
  maxPerPaymentTon: Number(process.env.SETTLE_MAX_PER_PAYMENT || 2),
  maxPerDayTon: Number(process.env.SETTLE_MAX_PER_DAY || 5),
  demoMode: process.env.SETTLE_DEMO === '1', // enables /api/demo/* (local fake group messages)
  dataDir: process.env.SETTLE_DATA_DIR || new URL('../data/', import.meta.url).pathname,
}
