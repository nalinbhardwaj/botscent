// check's decisions (plan 8.17), from observations of the situations it must tell
// apart: an edge install, an origin install with the transport off, a cache that
// replays decorated responses, a stale or doubled entry, a stripped hop, a missing
// page half, and a project whose proxy was replaced rather than wrapped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, exitCode, type Browser, type Check, type Observations, type Page } from '../src/check/evaluate.ts'

const NOW = 1_760_000_000_000
const page = (headers: Record<string, string> = {}, extra: Partial<Page> = {}): Page => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  scripts: [],
  markers: [],
  ...extra,
})
const entry = (name = 'botscent-check', at = NOW + 300, reasons = 'ua.declared-agent-token') =>
  `1;${name};${at};${reasons}`
const timing = (...descs: string[]) => descs.map((d) => `botscent;desc="${d}"`).join(', ')
const PROBES = { navigator: 'ok', keyboard: 'ok', credentials: 'ok', prompt: 'ok', dom: 'ok' }
const browser = (over: Record<string, unknown> = {}, diagnostics: Record<string, unknown> = {}): Browser => ({
  chrome: 'HeadlessChrome/141.0.0.0',
  instance: {
    diagnostics: {
      version: '1.0.0',
      started: true,
      startedAt: 41,
      probes: PROBES,
      transport: 'absent',
      ...diagnostics,
    },
    verdict: { type: 'agent', reasons: ['browser.webdriver-flag'] },
  },
  entries: [],
  problems: [],
  blocked: [],
  scripts: [],
  ...over,
})
const observe = (over: Partial<Observations> = {}): Observations => ({
  url: 'https://shop.example/',
  sentAt: NOW,
  self: page(),
  anonymous: page(),
  browser: browser(),
  project: { skipped: 'not run inside a project' },
  ...over,
})
const outcomes = (checks: Check[]) => Object.fromEntries(checks.map((c) => [c.id, c.outcome]))
const find = (checks: Check[], id: string) => checks.find((c) => c.id === id)!

test('an edge install on Vercel, behind its cache: every check passes', () => {
  const decorated = page({
    'server-timing': timing(entry()),
    'cache-control': 'no-store',
    'x-vercel-id': 'fra1::abc',
    'x-vercel-cache': 'HIT',
    'x-powered-by': 'Next.js',
  })
  const checks = evaluate(
    observe({
      self: decorated,
      anonymous: page({ 'x-vercel-cache': 'HIT', 'cache-control': 'public, max-age=0, must-revalidate' }),
      browser: browser({ entries: ['1;;1760000000500;ua.headless-chrome'] }, { transport: 'received' }),
    }),
  )
  assert.deepEqual(outcomes(checks), {
    reachable: 'pass',
    'server-half': 'pass',
    entry: 'pass',
    'no-store': 'pass',
    person: 'pass',
    cache: 'pass',
    'page-script': 'pass',
    'page-verdict': 'pass',
    transport: 'pass',
    probes: 'pass',
    csp: 'pass',
    script: 'skipped',
    stack: 'pass',
    adapters: 'skipped',
  })
  assert.match(find(checks, 'cache').observed, /decorated after the cache lookup/)
  assert.equal(find(checks, 'stack').observed, 'Next.js; on Vercel')
  assert.equal(exitCode(checks), 0)
})

test('an origin install with the transport off: the server half is unknown, the page half confirms the install', () => {
  const checks = evaluate(observe({ self: page({ 'x-powered-by': 'Express' }) }))
  assert.equal(find(checks, 'server-half').outcome, 'unknown')
  assert.match(find(checks, 'server-half').cause!, /transport is off/)
  assert.equal(find(checks, 'transport').outcome, 'unknown')
  for (const id of ['entry', 'no-store']) assert.equal(find(checks, id).outcome, 'skipped', id)
  assert.equal(exitCode(checks), 0)
})

test('a cache that stores decorated responses: the person check fails, and the install is broken', () => {
  const stored = timing(entry())
  const checks = evaluate(
    observe({
      self: page({ 'server-timing': stored, 'cache-control': 'no-store' }),
      anonymous: page({ 'server-timing': stored, age: '12' }),
    }),
  )
  assert.equal(find(checks, 'person').outcome, 'fail')
  assert.match(find(checks, 'person').observed, /without agent evidence received botscent;desc="1;botscent-check;/)
  assert.equal(find(checks, 'cache').outcome, 'unknown')
  assert.equal(exitCode(checks), 1)
})

test("another visitor's stale entry on check's own request fails as foreign and stale", () => {
  const old = entry('chatgpt-user', NOW - 3_600_000)
  const checks = evaluate(observe({ self: page({ 'server-timing': timing(old), 'cache-control': 'no-store' }) }))
  assert.equal(find(checks, 'server-half').outcome, 'fail')
  assert.match(find(checks, 'server-half').cause!, /another request/)
  assert.equal(find(checks, 'entry').outcome, 'fail')
  assert.match(find(checks, 'entry').observed, /-3600\.0 s/)
})

test('two entries fail, in the response and in the page', () => {
  const two = timing(entry(), entry())
  const checks = evaluate(
    observe({
      self: page({ 'server-timing': two, 'cache-control': 'no-store' }),
      browser: browser({ entries: [entry(), entry()] }, { transport: 'rejected' }),
    }),
  )
  assert.equal(find(checks, 'entry').outcome, 'fail')
  assert.equal(find(checks, 'transport').outcome, 'fail')
  assert.match(find(checks, 'transport').cause!, /more than one/)
})

test('a decorated response without no-store fails', () => {
  const checks = evaluate(
    observe({ self: page({ 'server-timing': timing(entry()), 'cache-control': 'public, s-maxage=60' }) }),
  )
  assert.equal(find(checks, 'no-store').outcome, 'fail')
})

test('a stripping hop is named only when both sides were observed', () => {
  const origin = page({ 'server-timing': timing(entry()), 'cache-control': 'no-store' })
  const both = evaluate(observe({ origin }))
  assert.equal(find(both, 'server-half').outcome, 'fail')
  assert.match(find(both, 'server-half').cause!, /removes Server-Timing/)
  assert.equal(find(evaluate(observe()), 'server-half').outcome, 'unknown')
})

test("the server sent check an entry, and the browser's document had none: the transport fails", () => {
  const checks = evaluate(observe({ self: page({ 'server-timing': timing(entry()), 'cache-control': 'no-store' }) }))
  assert.equal(find(checks, 'transport').outcome, 'fail')
})

test('without a browser, the page checks are skipped and the HTML hint is kept', () => {
  const checks = evaluate(
    observe({
      self: page({}, { scripts: ['https://shop.example/botscent.js'] }),
      browser: { skipped: 'no Chrome found' },
    }),
  )
  for (const id of ['page-script', 'page-verdict', 'transport', 'probes', 'csp'])
    assert.equal(find(checks, id).outcome, 'skipped', id)
  assert.match(
    find(checks, 'page-script').observed,
    /no Chrome found; the HTML loads https:\/\/shop\.example\/botscent\.js/,
  )
  assert.equal(find(checks, 'script').outcome, 'pass')
  assert.equal(exitCode(checks), 2, 'nothing confirmed: neither half')
})

test('a missing, unstarted or blind page half fails', () => {
  const missing = evaluate(
    observe({ browser: browser({ instance: null, problems: ['ReferenceError: x is not defined'] }) }),
  )
  assert.equal(find(missing, 'page-script').outcome, 'fail')
  assert.match(find(missing, 'page-script').observed, /ReferenceError/)
  assert.equal(exitCode(missing), 1)
  const idle = evaluate(observe({ browser: browser({}, { started: false }) }))
  assert.equal(find(idle, 'page-script').outcome, 'fail')
  const blind = browser()
  if ('instance' in blind && blind.instance) blind.instance.verdict = { type: 'human', reasons: [] }
  assert.equal(find(evaluate(observe({ browser: blind })), 'page-verdict').outcome, 'fail')
  const broken = evaluate(observe({ browser: browser({}, { probes: { ...PROBES, keyboard: 'failed' } }) }))
  assert.equal(find(broken, 'probes').outcome, 'fail')
  assert.equal(find(broken, 'probes').observed, 'failed: keyboard')
})

test('a policy that blocks the script fails; a script from another origin is a risk, not a failure', () => {
  const blocked = evaluate(
    observe({
      self: page({ 'content-security-policy': "script-src 'self'" }),
      browser: browser({
        instance: null,
        blocked: ["Refused to load the script 'https://cdn.example/botscent.js' because it violates script-src 'self'"],
      }),
    }),
  )
  assert.equal(find(blocked, 'csp').outcome, 'fail')
  const cdn = evaluate(
    observe({ browser: browser({ scripts: ['https://cdn.example/npm/botscent/dist/botscent.js'] }) }),
  )
  assert.equal(find(cdn, 'script').outcome, 'unknown')
  assert.match(find(cdn, 'script').observed, /cdn\.example/)
})

test('Server-Timing reaches pages only in secure contexts', () => {
  const checks = evaluate(
    observe({ url: 'http://192.168.1.20:3000/', browser: browser({}, { transport: 'unsupported' }) }),
  )
  assert.equal(find(checks, 'transport').outcome, 'unknown')
})

test('a project: imports found, a wrapped proxy passes, a replaced one fails, none fails', () => {
  const project = (
    proxy: { file: string; state: 'new' | 'wrapped' | 'replaced' | 'unchanged' } | null,
    imports = ['botscent/next in proxy.ts'],
  ) => ({
    root: '/app',
    botscent: '1.0.0',
    frameworks: ['next 16.3.8'],
    imports,
    proxy,
  })
  assert.equal(
    find(evaluate(observe({ project: project({ file: 'proxy.ts', state: 'wrapped' }) })), 'adapters').outcome,
    'pass',
  )
  const replaced = find(
    evaluate(observe({ project: project({ file: 'middleware.ts', state: 'replaced' }) })),
    'adapters',
  )
  assert.equal(replaced.outcome, 'fail')
  assert.match(replaced.fix!, /withBotscent\(existing\) in middleware\.ts/)
  assert.equal(find(evaluate(observe({ project: project(null, []) })), 'adapters').outcome, 'fail')
})

test('reachability: bot protection is unknown, an error page or no answer fails', () => {
  const challenged = evaluate(observe({ self: page({ 'cf-mitigated': 'challenge' }, { status: 403 }) }))
  assert.equal(find(challenged, 'reachable').outcome, 'unknown')
  assert.equal(find(evaluate(observe({ self: page({}, { status: 404 }) })), 'reachable').outcome, 'fail')
  const down = evaluate(observe({ self: { error: 'connect ECONNREFUSED 127.0.0.1:3000' } }))
  assert.equal(find(down, 'reachable').outcome, 'fail')
  assert.equal(find(down, 'server-half').outcome, 'skipped')
})
