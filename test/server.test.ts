import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TOKENS } from '../src/generated/server.ts'
import { inspectWith } from '../src/server/inspect.ts'
import { inspect } from '../src/server/index.ts'
import { hasOurEntry, isNavigation, scrubServerTiming, serverTimingEntry } from '../src/server/timing.ts'
import { matchTokens } from '../src/server/tokens.ts'
import { decide } from '../src/core/verdict.ts'

const vectors = JSON.parse(readFileSync(new URL('../vectors/requests.json', import.meta.url), 'utf8'))
const registry = { ...vectors.registry, tokens: TOKENS }

test('vectors: inspect, with Fetch Headers and with a Node-style header object', async () => {
  for (const c of vectors.cases) {
    const headers = new Headers()
    const record: Record<string, string | string[]> = {}
    for (const [name, value] of c.headers as [string, string][]) {
      headers.append(name, value)
      const key = name.toLowerCase()
      record[key] = key in record ? [record[key]!, value].flat() : value
    }
    const options = { now: c.now, cf: c.cf }
    const expected = JSON.stringify(c.verdict)
    const lines: string[] = []
    const fromHeaders = await inspectWith(
      registry,
      { headers, method: c.method ?? 'GET' },
      { ...options, debug: (l) => lines.push(l) },
    )
    assert.equal(JSON.stringify(fromHeaders), expected, `${c.name}\n${lines.join('\n')}`)
    const fromRecord = await inspectWith(registry, { headers: record, method: c.method ?? 'GET' }, options)
    assert.equal(JSON.stringify(fromRecord), expected, `${c.name} (header object)`)
  }
})

test('inspect never throws, whatever it is given', async () => {
  for (const input of [
    null,
    undefined,
    42,
    'GET /',
    {},
    { headers: null },
    {
      headers: {
        get: () => {
          throw new Error('boom')
        },
      },
    },
  ]) {
    const v = await inspect(input as never)
    assert.equal(v.type, 'human', String(input))
  }
})

test('debug output says why a signature did not verify', async () => {
  const c = vectors.cases.find((x: { name: string }) => x.name === 'unknown keyid')
  const lines: string[] = []
  await inspectWith(registry, { headers: new Headers(c.headers) }, { now: c.now, debug: (l) => lines.push(l) })
  assert.ok(
    lines.some((l) =>
      /signature sig1: signer signature-agent.test \(test-signer\) declared: keyid not-a-bundled-key is not in the bundled directory/.test(
        l,
      ),
    ),
    lines.join('\n'),
  )
  assert.ok(lines.every((l) => l.startsWith('[botscent] ')))
  assert.ok(lines.at(-1)!.includes('verdict agent test-signer [signer.web-bot-auth.declared]'))
})

test('tokens match only as whole tokens', () => {
  const t = [
    ['Devin', 'devin', 'token'],
    ['curl', 'curl', 'token'],
  ] as const
  assert.deepEqual(
    matchTokens('curl/8.7.1', t).map((m) => m.name),
    ['curl'],
  )
  assert.deepEqual(
    matchTokens('Mozilla/5.0 (compatible; Devin/1.0)', t).map((m) => m.name),
    ['devin'],
  )
  assert.deepEqual(matchTokens('curly/1.0 xcurl/1 Devinx', t), [])
  assert.deepEqual(
    matchTokens('a curl', t).map((m) => m.name),
    ['curl'],
    'at the end of the value',
  )
  assert.deepEqual(
    matchTokens('curlcurl curl/1', t).map((m) => m.name),
    ['curl'],
    'a later occurrence still counts',
  )
})

test("navigations: fetch metadata first, then a browser's GET that accepts HTML", () => {
  const h = (o: Record<string, string>) => (n: string) => o[n] ?? null
  const html = 'text/html,application/xhtml+xml,*/*;q=0.8'
  const browser =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'
  assert.equal(isNavigation(h({ 'sec-fetch-dest': 'document' }), 'GET'), true)
  assert.equal(isNavigation(h({ 'sec-fetch-dest': 'document' }), 'POST'), true, 'a form submission navigates too')
  assert.equal(isNavigation(h({ 'sec-fetch-dest': 'document', 'user-agent': '' }), 'GET'), true, 'metadata decides')
  assert.equal(isNavigation(h({ 'sec-fetch-dest': 'empty', accept: 'text/html' }), 'GET'), false)
  assert.equal(isNavigation(h({ 'sec-fetch-dest': 'iframe' }), 'GET'), false)
  // Without fetch metadata: Kitesurf's navigations, and browsers too old to send it.
  assert.equal(isNavigation(h({ accept: html, 'user-agent': browser }), 'GET'), true)
  assert.equal(
    isNavigation(
      h({ accept: html, 'user-agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' }),
      'GET',
    ),
    false,
    'a link previewer never runs the page half',
  )
  assert.equal(isNavigation(h({ accept: html, 'user-agent': 'curl/8.7.1' }), 'GET'), false, 'an HTTP client')
  assert.equal(isNavigation(h({ accept: html }), 'GET'), false, 'no user agent')
  assert.equal(isNavigation(h({ accept: '*/*', 'user-agent': browser }), 'GET'), false)
  assert.equal(isNavigation(h({ accept: 'text/x-component', 'user-agent': browser }), 'GET'), false, 'an RSC request')
  assert.equal(isNavigation(h({ accept: 'text/html', 'user-agent': browser }), 'POST'), false)
})

test('Server-Timing: scrub every botscent entry, keep everything else as written', () => {
  assert.equal(
    scrubServerTiming('db;dur=53, botscent;desc="1;chatgpt;1;x", app;desc="a, b; c";dur=1'),
    'db;dur=53, app;desc="a, b; c";dur=1',
  )
  assert.equal(scrubServerTiming('BotScent;desc="1;x;;y"'), null)
  assert.equal(scrubServerTiming('botscent'), null)
  assert.equal(scrubServerTiming('cdn-cache;desc=HIT, edge;dur=2'), 'cdn-cache;desc=HIT, edge;dur=2')
  assert.equal(
    scrubServerTiming('a;desc="quote \\" and, comma", botscent;desc="1;;;x"'),
    'a;desc="quote \\" and, comma"',
  )
  assert.equal(scrubServerTiming('botscentx;dur=1'), 'botscentx;dur=1', 'only the exact metric name')
  assert.equal(scrubServerTiming(null), null)
  assert.equal(hasOurEntry('a, botscent;desc="1;;;x"'), true)
  assert.equal(hasOurEntry('a;desc="botscent;desc=x"'), false, 'inside a quoted description is not an entry')
  const v = decide([{ reason: 'signer.web-bot-auth.verified', name: 'chatgpt', source: 'declaration' }])
  assert.equal(
    serverTimingEntry(v, 1759300000123),
    'botscent;desc="1;chatgpt;1759300000123;signer.web-bot-auth.verified"',
  )
  assert.equal(serverTimingEntry(decide([]), 1), null)
})
