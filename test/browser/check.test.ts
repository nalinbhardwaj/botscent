// check's browser observation over the raw DevTools protocol, against the built
// script: what the page half reports under automation, the entry the document
// carried, a page without the page half, a policy that blocks the script, and
// page errors.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { inBrowser } from '../../src/check/probe.ts'
import { html, serve, type TestServer } from './server.ts'

let server: TestServer
const CHROME = chromium.executablePath()

before(async () => {
  server = await serve()
})
after(async () => {
  await server.close()
})

test('under automation: the page half started, its verdict, and the entry the document carried', async () => {
  server.route('/fresh', {
    headers: { 'server-timing': `botscent;desc="1;chatgpt-user;${Date.now()};ua.declared-agent-token"` },
    body: html({ debug: false }),
  })
  const b = await inBrowser(`${server.origin}/fresh`, CHROME)
  assert.ok('instance' in b && b.instance, JSON.stringify(b))
  assert.match(b.chrome, /Chrome|Chromium/)
  assert.equal(b.instance.diagnostics.started, true)
  assert.equal(b.instance.diagnostics.transport, 'received')
  assert.deepEqual(b.instance.verdict, {
    type: 'agent',
    agent_name: 'chatgpt-user',
    reasons: ['ua.declared-agent-token', 'browser.webdriver-flag'],
  })
  assert.equal(b.entries.length, 1)
  assert.match(b.entries[0]!, /^1;chatgpt-user;\d+;ua\.declared-agent-token$/)
  assert.deepEqual(b.scripts, [`${server.origin}/botscent.js`])
  assert.deepEqual(b.problems, [])
  assert.deepEqual(b.blocked, [])
})

test('a page without the page half', async () => {
  server.route('/bare', {
    body: '<!doctype html><title>bare</title><link rel="icon" href="data:,"><p>nothing here</p>',
  })
  const b = await inBrowser(`${server.origin}/bare`, CHROME)
  assert.ok('instance' in b, JSON.stringify(b))
  assert.equal(b.instance, null)
  assert.deepEqual(b.problems, [])
})

test('a Content Security Policy that blocks the script', async () => {
  server.route('/csp', {
    headers: { 'content-security-policy': "script-src 'none'" },
    body: '<!doctype html><title>csp</title><link rel="icon" href="data:,"><script defer src="/botscent.js"></script>',
  })
  const b = await inBrowser(`${server.origin}/csp`, CHROME)
  assert.ok('instance' in b, JSON.stringify(b))
  assert.equal(b.instance, null)
  assert.equal(b.blocked.length, 1, JSON.stringify(b.blocked))
  assert.match(b.blocked[0]!, /Content Security Policy/)
})

test('page errors are reported', async () => {
  server.route('/throws', {
    body: '<!doctype html><title>throws</title><link rel="icon" href="data:,"><script>throw new Error("boom")</script>',
  })
  const b = await inBrowser(`${server.origin}/throws`, CHROME)
  assert.ok('problems' in b, JSON.stringify(b))
  assert.deepEqual(b.problems, ['Error: boom'])
})

test('a browser that cannot start is an observation, not a crash', async () => {
  const b = await inBrowser(`${server.origin}/bare`, '/nonexistent/chrome')
  assert.ok('error' in b)
  assert.match(b.error, /ENOENT/)
})
