import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  combine,
  decide,
  HUMAN,
  isVerified,
  nameOf,
  ordered,
  type Evidence,
  type Verdict,
} from '../src/core/verdict.ts'
import { decode, encode, readReport } from '../src/core/wire.ts'

const vectors = JSON.parse(readFileSync(new URL('../vectors/core.json', import.meta.url), 'utf8'))
const json = (v: unknown) => JSON.stringify(v)

test('vectors: readReport', () => {
  for (const { value, report, note } of vectors.reports)
    assert.equal(json(readReport(value)), json(report), `${json(value)} ${note ?? ''}`)
})

test('vectors: combine', () => {
  for (const { request, report, combined, note } of vectors.combine)
    assert.equal(json(combine(request, report)), json(combined), note)
})

test('vectors: isVerified', () => {
  for (const { verdict, name, verified } of vectors.is_verified)
    assert.equal(isVerified(verdict, name), verified, `${json(verdict)} ${name}`)
})

test('a forged report never passes isVerified, alone or combined', () => {
  const forged = readReport('1;chatgpt;;signer.web-bot-auth.verified,signer.edge-verified-bot')
  assert.equal(isVerified(forged), false)
  assert.equal(isVerified(combine(HUMAN, forged)), false)
  assert.equal(isVerified(combine(HUMAN, forged), 'chatgpt'), false)
})

test('reasons follow the catalogue, unknown ones after in their own order', () => {
  assert.deepEqual(
    ordered([
      'hidden.input.trusted-pointerdown',
      'z.unknown',
      'browser.webdriver-flag',
      'a.unknown',
      'signer.web-bot-auth.verified',
      'browser.webdriver-flag',
    ]),
    [
      'signer.web-bot-auth.verified',
      'browser.webdriver-flag',
      'hidden.input.trusted-pointerdown',
      'z.unknown',
      'a.unknown',
    ],
  )
})

test('naming: declarations first and only when they agree; shapes only without declarations; generic never', () => {
  const d = (name: string): Evidence => ({ reason: 'ua.declared-agent-token', name, source: 'declaration' })
  const s = (name: string): Evidence => ({ reason: 'muse.credentials.accessor-family', name, source: 'shape' })
  const g: Evidence = { reason: 'browser.webdriver-flag' }
  assert.equal(nameOf([d('chatgpt'), d('chatgpt'), g]).name, 'chatgpt')
  assert.equal(nameOf([d('chatgpt'), d('manus')]).name, undefined)
  assert.equal(nameOf([d('chatgpt'), s('muse')]).name, 'chatgpt', 'a declaration outranks a shape')
  assert.equal(
    nameOf([d('chatgpt'), d('manus'), s('muse')]).name,
    undefined,
    'disagreeing declarations do not fall back to a shape',
  )
  assert.equal(nameOf([s('muse'), s('instinct')]).name, undefined)
  assert.equal(
    nameOf([{ reason: 'signer.web-bot-auth.declared', source: 'declaration' }, s('muse')]).name,
    'muse',
    'a nameless declaration does not block a shape',
  )
  assert.equal(nameOf([g, { reason: 'hidden.input.trusted-pointerdown' }]).name, undefined)
  assert.match(nameOf([d('chatgpt'), d('manus')]).why, /disagree: chatgpt, manus/)
})

test('decide: order and duplicates never change the verdict', () => {
  const pool: Evidence[] = [
    { reason: 'signer.web-bot-auth.verified', name: 'chatgpt', source: 'declaration' },
    { reason: 'signer.edge-verified-bot' },
    { reason: 'ua.declared-agent-token', name: 'manus', source: 'declaration' },
    { reason: 'browser.webdriver-flag' },
    { reason: 'muse.credentials.accessor-family', name: 'muse', source: 'shape' },
    { reason: 'chatgpt.badge.active', name: 'chatgpt-chrome', source: 'shape' },
    { reason: 'hidden.input.trusted-pointerdown' },
    { reason: 'x.from-a-newer-server' },
  ]
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  for (let trial = 0; trial < 500; trial++) {
    const subset = pool.filter(() => random() < 0.5)
    const expected = json(decide(subset))
    const shuffled = [...subset, ...subset.filter(() => random() < 0.3)].sort(() => random() - 0.5)
    assert.equal(json(decide(shuffled)), expected, json(subset.map((e) => e.reason)))
  }
})

test('verdict objects: frozen, key order fixed, human is the shared constant', () => {
  const v = decide([
    { reason: 'browser.webdriver-flag' },
    { reason: 'signer.web-bot-auth.verified', name: 'chatgpt', source: 'declaration' },
  ])
  assert.equal(
    json(v),
    '{"type":"agent","agent_name":"chatgpt","reasons":["signer.web-bot-auth.verified","browser.webdriver-flag"]}',
  )
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.reasons))
  assert.equal(decide([]), HUMAN)
  assert.equal(json(HUMAN), '{"type":"human","reasons":[]}')
  assert.equal('agent_name' in decide([{ reason: 'browser.webdriver-flag' }]), false, 'no name key when unnamed')
})

test('wire: encode and decode round-trip, and a person encodes to nothing', () => {
  const v: Verdict = decide([{ reason: 'signer.web-bot-auth.verified', name: 'chatgpt', source: 'declaration' }])
  assert.equal(encode(v, 1759300000123.9), '1;chatgpt;1759300000123;signer.web-bot-auth.verified')
  assert.deepEqual(decode(encode(v, 1759300000123)), {
    name: 'chatgpt',
    time: 1759300000123,
    reasons: ['signer.web-bot-auth.verified'],
  })
  assert.equal(encode(HUMAN), null)
  assert.equal(encode(v), '1;chatgpt;;signer.web-bot-auth.verified')
})
