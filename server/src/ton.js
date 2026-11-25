// TON testnet wallet (one demo wallet). Sends a transfer with a comment and resolves the tx hash.
import { TonClient, WalletContractV4, internal, Address, toNano, fromNano, SendMode } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'
import { config } from './config.js'

const endpoint = 'https://testnet.toncenter.com/api/v2/jsonRPC'
const client = new TonClient({ endpoint, apiKey: config.toncenterKey || undefined })
let wallet, keyPair

async function init() {
  if (wallet) return
  if (!config.tonMnemonic) throw new Error('TON testnet mnemonic missing')
  keyPair = await mnemonicToPrivateKey(config.tonMnemonic.split(/\s+/))
  wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function retry(fn, n = 5) {
  for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= n) throw e; await sleep(800 * (i + 1)) } }
}

export async function walletAddress() { await init(); return wallet.address.toString({ testOnly: true, bounceable: false }) }
export async function balanceTon() { await init(); return Number(fromNano(await retry(() => client.getBalance(wallet.address)))) }

export function normalizeAddress(a) {
  const addr = Address.parse(String(a).trim())
  return addr.toString({ testOnly: true, bounceable: false })
}
export const short = a => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : ''
export const explorerTx = h => `https://testnet.tonviewer.com/transaction/${h}`

let queue = Promise.resolve()
// Serialised: one transfer at a time (seqno).
export function sendTon(to, amountTon, comment) {
  const job = queue.then(() => doSend(to, amountTon, comment))
  queue = job.catch(() => {})
  return job
}

async function doSend(to, amountTon, comment) {
  await init()
  const contract = client.open(wallet)
  const seqno = await retry(() => contract.getSeqno())
  const startLt = (await retry(() => client.getTransactions(wallet.address, { limit: 1 })))[0]?.lt?.toString() || '0'
  await retry(() => contract.sendTransfer({
    seqno, secretKey: keyPair.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [internal({ to: Address.parse(to), value: toNano(String(amountTon)), bounce: false, body: comment })],
  }), 2)
  // Wait for the wallet's outgoing transaction to land (usually 5-15 s on testnet).
  for (let i = 0; i < 40; i++) {
    await sleep(1500)
    const txs = await retry(() => client.getTransactions(wallet.address, { limit: 3 })).catch(() => [])
    const tx = txs.find(t => BigInt(t.lt) > BigInt(startLt))
    if (tx) return { hash: tx.hash().toString('hex'), lt: tx.lt.toString(), seqno }
  }
  throw new Error('transfer not confirmed in time')
}
