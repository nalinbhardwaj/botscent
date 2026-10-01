// The Hono adapter through app.request: the verdict on c.get('botscent'), the
// application's responses kept, and the transport rules, including on an immutable
// response (a fetch passthrough) and on Cloudflare Workers, where it defaults on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { botscent } from '../../src/adapters/hono.ts'

const AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
const nav = { 'sec-fetch-dest': 'document', 'user-agent': AGENT }

function app(options?: Parameters<typeof botscent>[0]) {
  const a = new Hono<{ Variables: { botscent: unknown } }>()
  a.use(botscent(options))
  a.get('/verdict', (c) => c.json(c.get('botscent')))
  a.get('/page', (c) => {
    c.header('Server-Timing', 'db;dur=12, botscent;desc="1;old;1;stale"')
    c.header('Set-Cookie', 'session=abc')
    return c.html('<p>page</p>')
  })
  a.get('/passthrough', () => {
    // An immutable response, as fetch() returns.
    const r = Response.json({ ok: true }, { headers: { 'server-timing': 'origin;dur=5' } })
    return new Proxy(r, {
      get(target, key) {
        if (key === 'headers') {
          const frozen = new Headers(target.headers)
          for (const m of ['set', 'append', 'delete'] as const)
            (frozen as unknown as Record<string, unknown>)[m] = () => {
              throw new TypeError('immutable')
            }
          return frozen
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  })
  a.get('/redirect', (c) => c.redirect('/elsewhere', 303))
  a.get('/boom', () => {
    throw new Error("the application's own error")
  })
  a.onError((error, c) => c.text(`handled: ${error.message}`, 500))
  return a
}

test('the request verdict is c.get("botscent")', async () => {
  const r = await app().request('/verdict', { headers: { 'user-agent': AGENT } })
  assert.deepEqual(await r.json(), { type: 'agent', agent_name: 'chatgpt-user', reasons: ['ua.declared-agent-token'] })
})

test('off by default on Node; the inherited entry is removed, cookies kept', async () => {
  const r = await app().request('/page', { headers: nav })
  assert.equal(r.headers.get('server-timing'), 'db;dur=12')
  assert.equal(r.headers.get('cache-control'), null)
  assert.equal(r.headers.get('set-cookie'), 'session=abc')
  assert.equal(await r.text(), '<p>page</p>')
})

test("turned on: one entry after the application's own, no-store; immutable responses too", async () => {
  const on = app({ transport: 'always' })
  const page = await on.request('/page', { headers: nav })
  assert.match(
    page.headers.get('server-timing')!,
    /^db;dur=12, botscent;desc="1;chatgpt-user;\d+;ua\.declared-agent-token"$/,
  )
  assert.equal(page.headers.get('cache-control'), 'no-store')
  const passthrough = await on.request('/passthrough', { headers: nav })
  assert.match(passthrough.headers.get('server-timing')!, /^origin;dur=5, botscent;desc="1;chatgpt-user;/)
  assert.deepEqual(await passthrough.json(), { ok: true })
  const person = await on.request('/page', {
    headers: { 'sec-fetch-dest': 'document', 'user-agent': 'Mozilla/5.0 Chrome/141' },
  })
  assert.equal(person.headers.get('server-timing'), 'db;dur=12')
})

test('on Cloudflare Workers the transport is on by default and request.cf is read', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Cloudflare-Workers' }, configurable: true })
  try {
    const request = new Request('https://example.com/page', {
      headers: { 'sec-fetch-dest': 'document', 'user-agent': 'Mozilla/5.0 Chrome/141' },
    })
    Object.defineProperty(request, 'cf', { value: { verifiedBotCategory: 'Search Engine Crawler' } })
    const r = await app().request(request)
    assert.match(r.headers.get('server-timing')!, /botscent;desc="1;;\d+;signer\.edge-verified-bot"$/)
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved)
  }
})

test("redirects and the application's own errors are kept", async () => {
  const on = app({ transport: 'always' })
  const r = await on.request('/redirect', { headers: nav })
  assert.equal(r.status, 303)
  assert.equal(r.headers.get('location'), '/elsewhere')
  const boom = await on.request('/boom', { headers: nav })
  assert.equal(boom.status, 500)
  assert.equal(await boom.text(), "handled: the application's own error")
})
