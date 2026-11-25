// node --test test/   (no network, no keys)
import test from 'node:test'
import assert from 'node:assert/strict'
process.env.SETTLE_NO_LLM = '1'; process.env.SETTLE_DATA_DIR = '/tmp/settle-unit'
const { parseRequest, looksLikeRequest } = await import('../server/src/parse.js')
const { intent } = await import('../server/src/voice.js')

test('regex gate ignores chat that is not about money', () => {
  for (const t of ['morning all', 'who is coming at 5?', 'lol 😂', '']) assert.equal(looksLikeRequest(t), false)
})
test('direct request with mention', async () => {
  const p = await parseRequest('@victor_ok you owe me 1.5 TON for dinner', { senderUsername: 'ada' })
  assert.deepEqual([p.payers, p.per_person, p.memo], [['@victor_ok'], 1.5, 'dinner'])
})
test('split including the sender', async () => {
  const p = await parseRequest('split 6 TON between me, @a_user and @b_user', {})
  assert.equal(p.per_person, 2)
})
test('reply target becomes the payer', async () => {
  const p = await parseRequest('send me 2 TON for the tickets', { replyToUsername: 'victor_ok' })
  assert.deepEqual(p.payers, ['@REPLY_TARGET'])
})
test('past payments are not requests', async () => {
  assert.equal(await parseRequest('I paid you 2 TON yesterday @victor_ok', {}), null)
})
test('voice intents', () => {
  assert.deepEqual(intent('Pay half.', 1), { intent: 'pay', amount: 0.5 })
  assert.deepEqual(intent('make it one point five', 2), { intent: 'pay', amount: 1.5 })
  assert.equal(intent('decline', 1).intent, 'decline')
  assert.equal(intent('later', 1).intent, 'later')
  assert.equal(intent('banana', 1).intent, 'unknown')
})
