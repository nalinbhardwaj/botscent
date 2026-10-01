// The Express adapter on a real HTTP server: the verdict on req.botscent, the
// application's behaviour kept, and the transport rules on what it sends.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { botscent } from '../../src/adapters/express.ts'

const AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
const nav = { 'sec-fetch-dest': 'document', 'user-agent': AGENT }
const servers: { close(): void }[] = []

function app(options?: Parameters<typeof botscent>[0]) {
  const a = express()
  a.use(botscent(options))
  a.get('/verdict', (req, res) => res.json((req as typeof req & { botscent: unknown }).botscent))
  a.get('/page', (_req, res) => {
    res.setHeader('Server-Timing', 'db;dur=12, botscent;desc="1;old;1;stale"')
    res.send('<p>page</p>')
  })
  a.get('/write-head', (_req, res) => {
    res.writeHead(200, { 'Server-Timing': 'app;dur=3', 'Content-Type': 'text/html' })
    res.end('<p>page</p>')
  })
  a.get('/redirect', (_req, res) => {
    res.cookie('session', 'abc')
    res.redirect(303, '/elsewhere')
  })
  a.get('/stream', async (_req, res) => {
    res.setHeader('content-type', 'text/plain')
    for (let i = 0; i < 3; i++) {
      res.write(`chunk ${i}\n`)
      await new Promise((r) => setTimeout(r, 150))
    }
    res.end()
  })
  a.post('/echo', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => res.send(req.body))
  a.get('/boom', () => {
    throw new Error("the application's own error")
  })
  a.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).send(`handled: ${error.message}`)
  })
  return a
}

let off = ''
let on = ''
before(async () => {
  for (const [options, set] of [
    [undefined, (url: string) => (off = url)],
    [{ transport: 'always' as const }, (url: string) => (on = url)],
  ] as const) {
    const server = app(options).listen(0)
    await new Promise((r) => server.once('listening', r))
    servers.push(server)
    set(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  }
})
after(() => servers.forEach((s) => s.close()))

test('the request verdict is on req.botscent', async () => {
  assert.deepEqual(
    await (await fetch(`${off}/verdict`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/141' } })).json(),
    { type: 'human', reasons: [] },
  )
  assert.deepEqual(await (await fetch(`${off}/verdict`, { headers: { 'user-agent': AGENT } })).json(), {
    type: 'agent',
    agent_name: 'chatgpt-user',
    reasons: ['ua.declared-agent-token'],
  })
})

test('off by default at the origin; an inherited entry is removed for everyone', async () => {
  for (const headers of [nav, { 'sec-fetch-dest': 'document', 'user-agent': 'Mozilla/5.0 Chrome/141' }]) {
    const r = await fetch(`${off}/page`, { headers })
    assert.equal(r.headers.get('server-timing'), 'db;dur=12')
    assert.equal(r.headers.get('cache-control'), null)
  }
})

test("turned on: one entry after the application's own, with no-store, also through writeHead", async () => {
  for (const [path, own] of [
    ['/page', 'db;dur=12'],
    ['/write-head', 'app;dur=3'],
  ] as const) {
    const r = await fetch(`${on}${path}`, { headers: nav })
    const timing = r.headers.get('server-timing')!
    assert.match(
      timing,
      new RegExp(`^${own.replace(/[;=]/g, '\\$&')}, botscent;desc="1;chatgpt-user;\\d+;ua\\.declared-agent-token"$`),
      timing,
    )
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal(await r.text(), '<p>page</p>')
  }
  const person = await fetch(`${on}/write-head`, {
    headers: { 'sec-fetch-dest': 'document', 'user-agent': 'Mozilla/5.0 Chrome/141' },
  })
  assert.equal(person.headers.get('server-timing'), 'app;dur=3')
  const api = await fetch(`${on}/page`, { headers: { 'sec-fetch-dest': 'empty', 'user-agent': AGENT } })
  assert.equal(api.headers.get('server-timing'), 'db;dur=12')
})

test('status, cookies and redirects are kept', async () => {
  const r = await fetch(`${on}/redirect`, { headers: nav, redirect: 'manual' })
  assert.equal(r.status, 303)
  assert.equal(r.headers.get('location'), '/elsewhere')
  assert.match(r.headers.get('set-cookie') ?? '', /session=abc/)
})

test('streaming stays streaming and request bodies are untouched', async () => {
  const r = await fetch(`${on}/stream`, { headers: nav })
  const reader = r.body!.getReader()
  const arrivals: number[] = []
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    arrivals.push(performance.now())
    text += new TextDecoder().decode(value)
  }
  assert.equal(text, 'chunk 0\nchunk 1\nchunk 2\n')
  assert.ok(arrivals.length >= 3 && arrivals.at(-1)! - arrivals[0]! >= 250, 'chunks arrive as written')
  const body = new Uint8Array(500_000).map((_, i) => (i * 7) % 256)
  const echoed = new Uint8Array(
    await (
      await fetch(`${on}/echo`, {
        method: 'POST',
        body,
        headers: { ...nav, 'content-type': 'application/octet-stream' },
      })
    ).arrayBuffer(),
  )
  assert.deepEqual(echoed, body)
})

test("the application's own errors reach its error handler", async () => {
  const r = await fetch(`${on}/boom`, { headers: nav })
  assert.equal(r.status, 500)
  assert.equal(await r.text(), "handled: the application's own error")
})
