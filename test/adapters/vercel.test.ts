// The Vercel middleware as the platform calls it: continue (x-middleware-next) with
// the transport's headers, or the existing middleware's own response, decorated.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import middleware, { withBotscent } from '../../src/adapters/vercel.ts'

const AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
const request = (ua: string) =>
  new Request('https://example.com/', { headers: { 'sec-fetch-dest': 'document', 'user-agent': ua } })

test('continues for everyone; an agent navigation carries the entry and no-store', async () => {
  const person = (await middleware(request('Mozilla/5.0 Chrome/141')))!
  assert.equal(person.headers.get('x-middleware-next'), '1')
  assert.equal(person.headers.get('server-timing'), null)
  const agent = (await middleware(request(AGENT)))!
  assert.equal(agent.headers.get('x-middleware-next'), '1')
  assert.match(agent.headers.get('server-timing')!, /^botscent;desc="1;chatgpt-user;\d+;ua\.declared-agent-token"$/)
  assert.equal(agent.headers.get('cache-control'), 'no-store')
})

test("an existing middleware's response (a redirect) is kept and decorated", async () => {
  const wrapped = withBotscent(() => Response.redirect('https://example.com/login', 307))
  const r = (await wrapped(request(AGENT)))!
  assert.equal(r.status, 307)
  assert.equal(r.headers.get('location'), 'https://example.com/login')
  assert.match(r.headers.get('server-timing')!, /botscent;desc=/)
})

test('withBotscent(options) without existing middleware; options after an existing one', async () => {
  const off = (await withBotscent({ transport: 'never' })(request(AGENT)))!
  assert.equal(off.headers.get('x-middleware-next'), '1')
  assert.equal(off.headers.get('server-timing'), null)
  const both = (await withBotscent(() => new Response('ok'), { transport: 'never' })(request(AGENT)))!
  assert.equal(await both.text(), 'ok')
  assert.equal(both.headers.get('server-timing'), null)
})
