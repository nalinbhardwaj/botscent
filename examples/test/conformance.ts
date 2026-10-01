// The checks every server example must pass (plan 4.6), shared by the local runs
// (servers.test.ts) and the deployed ones (deployed.test.ts). The route answers with
// the request verdict as its framework exposes it and the number of body bytes the
// application read, and sets a stale botscent entry beside its own app entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

export const PERSON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
export const AGENT_UA = `${PERSON_UA}; compatible; ChatGPT-User/1.0; +https://openai.com/bot`
export const HUMAN = { type: 'human', reasons: [] }
export const navigation = (ua: string) => ({ 'user-agent': ua, 'sec-fetch-dest': 'document', accept: 'text/html' })

/** A request signed for chatgpt.com under a fresh key, which no release holds: declared, never verified. */
export function signedFor(authority: string): Record<string, string> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const x = publicKey.export({ format: 'jwk' }).x!
  const keyid = createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest('base64url')
  const now = Math.floor(Date.now() / 1000)
  const params = `("@authority" "signature-agent";key="sig1");created=${now};keyid="${keyid}";alg="ed25519";expires=${now + 60};tag="web-bot-auth"`
  const base = `"@authority": ${authority}\n"signature-agent";key="sig1": "https://chatgpt.com"\n"@signature-params": ${params}`
  return {
    'user-agent': PERSON_UA,
    'signature-agent': 'sig1="https://chatgpt.com"',
    'signature-input': `sig1=${params}`,
    signature: `sig1=:${sign(null, Buffer.from(base), privateKey).toString('base64')}:`,
  }
}

export type Send = (init: RequestInit) => Promise<Response>

/** Registers the four checks; `send` is read when each test runs, after the example started. */
export function serverChecks(send: () => Send, example: { transport: boolean; authority: string }) {
  test("a person's navigation is human; the stale entry is removed and the application's own kept", async () => {
    const r = await send()({ headers: navigation(PERSON_UA) })
    assert.equal(r.status, 200)
    assert.deepEqual((await r.json()).verdict, HUMAN)
    assert.equal(r.headers.get('server-timing'), 'app;dur=1')
    assert.notEqual(r.headers.get('cache-control'), 'no-store')
  })

  test(`an agent's navigation: the verdict, and the transport ${example.transport ? 'on' : 'off'} by default`, async () => {
    const r = await send()({ headers: navigation(AGENT_UA) })
    const verdict = { type: 'agent', agent_name: 'chatgpt-user', reasons: ['ua.declared-agent-token'] }
    assert.deepEqual((await r.json()).verdict, verdict)
    const timing = r.headers.get('server-timing')!
    if (example.transport) {
      const m = /^app;dur=1, botscent;desc="1;chatgpt-user;(\d+);ua\.declared-agent-token"$/.exec(timing)
      assert.ok(m, timing)
      assert.ok(Math.abs(Number(m[1]) - Date.now()) < 60_000, 'the entry carries the receipt time')
      assert.equal(r.headers.get('cache-control'), 'no-store')
    } else {
      assert.equal(timing, 'app;dur=1')
      assert.notEqual(r.headers.get('cache-control'), 'no-store')
    }
  })

  test("a signature under a key the release does not hold is declared, under its signer's name", async () => {
    const r = await send()({ headers: signedFor(example.authority) })
    assert.deepEqual((await r.json()).verdict, {
      type: 'agent',
      agent_name: 'chatgpt',
      reasons: ['signer.web-bot-auth.declared'],
    })
  })

  test('the application reads the request body as sent', async () => {
    const body = randomBytes(65536)
    const r = await send()({
      method: 'POST',
      headers: { 'user-agent': PERSON_UA, 'content-type': 'application/octet-stream' },
      body,
    })
    assert.deepEqual(await r.json(), { verdict: HUMAN, bytes: body.length })
  })
}
