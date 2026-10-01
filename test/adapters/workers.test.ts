// The Workers adapter as a Worker runtime calls it: the verdict reaches the handler,
// Cloudflare's request.cf counts, and the transport is on unless turned off.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withBotscent } from '../../src/adapters/workers.ts'

const ctx = { waitUntil() {} }
const page = (headers: Record<string, string>, cf?: object) => {
  const request = new Request('https://example.com/', { headers: { 'sec-fetch-dest': 'document', ...headers } })
  if (cf) Object.defineProperty(request, 'cf', { value: cf })
  return request
}

test('the handler receives the verdict; agents get the entry by default, people do not', async () => {
  const seen: unknown[] = []
  const fetch = withBotscent((_request, _env, _ctx, verdict) => {
    seen.push(verdict)
    // fetch() responses have immutable headers; the adapter copies when it must.
    return new Response('<p>hi</p>', { headers: { 'content-type': 'text/html', 'server-timing': 'origin;dur=4' } })
  })
  const person = await fetch(page({ 'user-agent': 'Mozilla/5.0 Chrome/141' }), {}, ctx)
  assert.equal(person.headers.get('server-timing'), 'origin;dur=4')
  const verified = await fetch(
    page({ 'user-agent': 'Mozilla/5.0 Chrome/141' }, { verifiedBotCategory: 'AI Assistant' }),
    {},
    ctx,
  )
  assert.match(
    verified.headers.get('server-timing')!,
    /^origin;dur=4, botscent;desc="1;;\d+;signer\.edge-verified-bot"$/,
  )
  assert.equal(verified.headers.get('cache-control'), 'no-store')
  assert.equal(await verified.text(), '<p>hi</p>')
  assert.deepEqual(seen, [
    { type: 'human', reasons: [] },
    { type: 'agent', reasons: ['signer.edge-verified-bot'] },
  ])
})

test("transport: 'never' for a Worker that caches HTML", async () => {
  const fetch = withBotscent(
    () => new Response('x', { headers: { 'server-timing': 'botscent;desc="1;old;1;stale", a;dur=1' } }),
    { transport: 'never' },
  )
  const r = await fetch(page({ 'user-agent': 'curl/8.7.1' }), {}, ctx)
  assert.equal(r.headers.get('server-timing'), 'a;dur=1', 'inherited entries are still removed')
  assert.equal(r.headers.get('cache-control'), null)
})

test("the handler's own errors propagate", async () => {
  const fetch = withBotscent(() => {
    throw new Error('handler error')
  })
  await assert.rejects(fetch(page({}), {}, ctx), /handler error/)
})
