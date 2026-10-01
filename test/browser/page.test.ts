// The page half in real browsers, against the built script (dist/botscent.js).
// Each agent shape is simulated by an init script that runs before the page's
// own scripts, the way an extension's or a hosted browser's code does.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright'
import { launch } from './cdp.ts'
import { html, serve, type TestServer } from './server.ts'

type Verdict = { type: string; agent_name?: string; reasons: string[] }
let server: TestServer
const browsers = new Map<string, Browser>()
const CLEAN = ['--disable-blink-features=AutomationControlled'] // navigator.webdriver false

before(async () => {
  server = await serve()
  server.route('/plain', { body: html() })
  browsers.set('chromium', await chromium.launch())
  browsers.set('chromium-clean', await chromium.launch({ args: CLEAN }))
})
after(async () => {
  for (const b of browsers.values()) await b.close()
  await server.close()
})

async function open(
  which: string,
  path: string,
  init?: string,
): Promise<{ page: Page; errors: string[]; logs: string[] }> {
  const context = await browsers.get(which)!.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  const logs: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => logs.push(m.text()))
  if (init) await page.addInitScript(init)
  await page.goto(server.origin + path)
  await page.waitForFunction(() => (window as { botscent?: unknown }).botscent !== undefined)
  return { page, errors, logs }
}
const verdict = (page: Page) =>
  page.evaluate(() => (window as unknown as { botscent: { verdict(): Verdict } }).botscent.verdict())
const settle = (page: Page, test: string, timeout = 8000) =>
  page.waitForFunction(test, undefined, { timeout, polling: 50 }).then(() => verdict(page))

describe('chromium', () => {
  test('a person: no evidence, no side effects, no errors', async () => {
    const { page, errors } = await open('chromium-clean', '/plain')
    await page.waitForTimeout(300)
    assert.deepEqual(await verdict(page), { type: 'human', reasons: [] })
    const d = await page.evaluate(() => (window as any).botscent.diagnostics())
    assert.equal(d.started, true)
    assert.equal(d.transport, 'absent')
    for (const probe of [
      'navigator',
      'credentials',
      'geetest',
      'prompt',
      'keyboard',
      'overlay',
      'markers',
      'dom',
      'input',
    ])
      assert.equal(d.probes[probe], 'ok', `${probe} ${d.probes[probe]}`)
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [
      0,
      0,
      '',
    ])
    assert.deepEqual(errors, [])
    await page.context().close()
  })

  test('automation: Playwright sets navigator.webdriver', async () => {
    const { page } = await open('chromium', '/plain')
    assert.deepEqual(await verdict(page), { type: 'agent', reasons: ['browser.webdriver-flag'] })
    await page.context().close()
  })

  test('Muse: the credential accessor family', async () => {
    const { page } = await open(
      'chromium-clean',
      '/plain',
      `(() => {
        const accessor = (owner, name) => { const original = owner[name]; Object.defineProperty(owner, name, { get() { return original }, set(v) {}, enumerable: true, configurable: false }) }
        accessor(navigator.credentials, 'get'); accessor(navigator.credentials, 'create')
        for (const name of ['getClientCapabilities', 'isUserVerifyingPlatformAuthenticatorAvailable', 'isConditionalMediationAvailable']) accessor(PublicKeyCredential, name)
      })()`,
    )
    assert.deepEqual(await verdict(page), {
      type: 'agent',
      agent_name: 'muse',
      reasons: ['muse.credentials.accessor-family'],
    })
    await page.context().close()
  })

  test('Instinct: the wrappers alone are nothing; the GeeTest pair three seconds later completes it', async () => {
    const { page } = await open(
      'chromium-clean',
      '/plain',
      `(() => {
        for (const name of ['get', 'create']) {
          const original = navigator.credentials[name].bind(navigator.credentials)
          const wrapper = [function (options) { return original(options) }][0]
          Object.defineProperty(navigator.credentials, name, { value: wrapper, writable: true, configurable: true, enumerable: false })
        }
        setTimeout(() => { for (const name of ['initGeetest', 'initGeetest4']) Object.defineProperty(window, name, { get() {}, set(v) {}, enumerable: false, configurable: true }) }, 3000)
      })()`,
    )
    assert.deepEqual(await verdict(page), { type: 'human', reasons: [] }, 'wrappers alone')
    const v = await settle(page, `window.botscent.verdict().type === 'agent'`)
    assert.deepEqual(v, {
      type: 'agent',
      agent_name: 'instinct',
      reasons: ['instinct.credentials.wrappers', 'instinct.geetest.accessor-pair'],
    })
    await page.context().close()
  })

  test('Codex: prompt and keyboard at start make two of three; the overlay adds the third', async () => {
    const { page } = await open(
      'chromium-clean',
      '/plain',
      `(() => {
        const prompt = new Proxy(window.prompt, { get: (t, k) => (k === 'name' ? '' : Reflect.get(t, k)) })
        Object.defineProperty(window, 'prompt', { value: prompt, writable: true, configurable: true, enumerable: true })
        Object.defineProperty(Navigator.prototype, 'keyboard', { get: () => ({ getLayoutMap: () => Promise.resolve(new Map()) }), configurable: true })
        setTimeout(() => {
          const overlay = document.createElement('div')
          overlay.attachShadow({ mode: 'open' })
          overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
          document.documentElement.appendChild(overlay)
        }, 1000)
      })()`,
    )
    const early = await settle(page, `window.botscent.verdict().type === 'agent'`, 2000)
    assert.deepEqual(early, {
      type: 'agent',
      agent_name: 'codex-browser',
      reasons: ['codex.prompt.anonymous-native', 'codex.keyboard.empty-layout-map'],
    })
    const late = await settle(page, `window.botscent.verdict().reasons.length === 3`, 3000)
    assert.deepEqual(late.reasons, [
      'codex.prompt.anonymous-native',
      'codex.keyboard.empty-layout-map',
      'codex.overlay.shadow-root',
    ])
    await page.context().close()
  })

  test('Codex: one shell signal alone is nothing', async () => {
    const { page } = await open(
      'chromium-clean',
      '/plain',
      `Object.defineProperty(Navigator.prototype, 'keyboard', { get: () => ({ getLayoutMap: () => Promise.resolve(new Map()) }), configurable: true })`,
    )
    await page.waitForTimeout(1800)
    assert.deepEqual(await verdict(page), { type: 'human', reasons: [] })
    await page.context().close()
  })

  test('ChatGPT for Chrome: the badge drawn on the favicon two seconds in, seen through DOM observation', async () => {
    const { page } = await open(
      'chromium-clean',
      '/plain',
      `setTimeout(() => document.querySelector('link[rel~="icon"]').setAttribute('data-codex-favicon-badge', ''), 2000)`,
    )
    const started = Date.now()
    const v = await settle(page, `window.botscent.verdict().type === 'agent'`, 4000)
    assert.deepEqual(v, { type: 'agent', agent_name: 'chatgpt-chrome', reasons: ['chatgpt.badge.active'] })
    assert.ok(Date.now() - started < 3000, 'seen within a second of being drawn, not at the 5 s pass')
    await page.context().close()
  })

  test('Claude for Chrome: the marker comes and goes; the verdict stays (document history)', async () => {
    const { page } = await open(
      'chromium-clean',
      '/plain',
      `setTimeout(() => { const m = document.createElement('div'); m.id = 'claude-agent-glow-border'; document.body.appendChild(m); setTimeout(() => m.remove(), 600) }, 800)`,
    )
    const v = await settle(page, `window.botscent.verdict().type === 'agent'`, 3000)
    assert.deepEqual(v, { type: 'agent', agent_name: 'claude-chrome', reasons: ['claude.marker.active'] })
    await page.waitForTimeout(1000)
    assert.equal(await page.evaluate(() => document.getElementById('claude-agent-glow-border')), null)
    assert.deepEqual(await verdict(page), v, 'monotonic')
    const events = await page.evaluate(() => (window as any).__events)
    assert.deepEqual(events, [v], 'one botscent event, for the one change')
    await page.context().close()
  })
})

describe('chromium: transport', () => {
  const entry = (offsetMs: number, name = 'chatgpt', reasons = 'signer.web-bot-auth.verified') =>
    `botscent;desc="1;${name};${Date.now() + offsetMs};${reasons}"`
  const at = (path: string, serverTiming: string | string[]) => {
    server.route(path, { headers: { 'server-timing': serverTiming }, body: html() })
    return path
  }
  const transport = (page: Page) => page.evaluate(() => (window as any).botscent.diagnostics().transport)

  test('a fresh entry gives the request verdict at start, name and reasons', async () => {
    const { page, logs } = await open('chromium-clean', at('/fresh', ['db;dur=12', entry(0)]))
    assert.deepEqual(await verdict(page), {
      type: 'agent',
      agent_name: 'chatgpt',
      reasons: ['signer.web-bot-auth.verified'],
    })
    assert.equal(await transport(page), 'received')
    assert.ok(
      logs.some((l) =>
        /^\[botscent\] transport received: chatgpt \[signer\.web-bot-auth\.verified\], server time [+-]\d+ ms from navigation start$/.test(
          l,
        ),
      ),
      logs.join('\n'),
    )
    await page.context().close()
  })

  test('the request name and the page evidence combine; ranks order the reasons', async () => {
    const { page } = await open(
      'chromium',
      at('/fresh-automation', entry(0, 'cloudflare-browser-run', 'signer.web-bot-auth.verified,ua.headless-chrome')),
    )
    assert.deepEqual(await verdict(page), {
      type: 'agent',
      agent_name: 'cloudflare-browser-run',
      reasons: ['signer.web-bot-auth.verified', 'browser.webdriver-flag', 'ua.headless-chrome'],
    })
    await page.context().close()
  })

  for (const [name, value, status] of [
    ['an entry from a minute ago', entry(-60_000), 'rejected'],
    ['an entry three minutes ahead', entry(180_000), 'rejected'],
    ['two botscent entries', [entry(0), entry(0, 'manus')], 'rejected'],
    ['a malformed entry', 'botscent;desc="1;chatgpt;;"', 'rejected'],
    ['an entry with an unknown major version', 'botscent;desc="2;chatgpt;1;x"', 'rejected'],
    ["another tool's entries only", 'cdn-cache;desc=HIT, edge;dur=2', 'absent'],
  ] as const) {
    test(`${name}: ignored (${status})`, async () => {
      const { page } = await open('chromium-clean', at(`/t-${name.replace(/\W+/g, '-')}`, value as string | string[]))
      assert.deepEqual(await verdict(page), { type: 'human', reasons: [] })
      assert.equal(await transport(page), status)
      await page.context().close()
    })
  }
})

describe('chromium: input to a hidden document', () => {
  test('a trusted click dispatched over CDP to a background tab, as an MCP server or extension debugger does', async () => {
    const cdp = await launch()
    try {
      const agentTab = await cdp.tab(server.origin + '/plain')
      const personTab = await cdp.tab(server.origin + '/plain')
      await cdp.activate(personTab)
      await new Promise((r) => setTimeout(r, 300))
      assert.equal(await agentTab.evaluate('document.visibilityState'), 'hidden')
      assert.deepEqual(
        await agentTab.evaluate('botscent.verdict()'),
        { type: 'human', reasons: [] },
        'nothing before the click',
      )
      await cdp.click(agentTab, 10, 10)
      await new Promise((r) => setTimeout(r, 100))
      assert.deepEqual(await agentTab.evaluate('botscent.verdict()'), {
        type: 'agent',
        reasons: ['hidden.input.focus-emulated', 'hidden.input.trusted-pointerdown'],
      })
      assert.deepEqual(
        await personTab.evaluate('botscent.verdict()'),
        { type: 'human', reasons: [] },
        'the tab in front is unaffected',
      )
    } finally {
      cdp.close()
    }
  })
})

describe('chromium: carriers', () => {
  const agentPage = () => open('chromium', '/plain') // webdriver: agent evidence observed

  test('headers(url): only for agents, only to the page origin', async () => {
    const { page } = await agentPage()
    const out = await page.evaluate(() => {
      const b = (window as any).botscent
      return [
        b.headers('/api/checkout'),
        b.headers(location.origin + '/x'),
        b.headers('https://example.com/api'),
        b.headers('//example.com/x'),
        b.headers('http://[::1'),
      ]
    })
    assert.deepEqual(out[0], { 'Botscent-Report': '1;;;browser.webdriver-flag' })
    assert.deepEqual(out[1], { 'Botscent-Report': '1;;;browser.webdriver-flag' })
    assert.deepEqual(out.slice(2), [{}, {}, {}])
    await page.context().close()
    const person = await open('chromium-clean', '/plain')
    assert.deepEqual(await person.page.evaluate(() => (window as any).botscent.headers('/api')), {})
    await person.page.context().close()
  })

  const form = (attrs: string, extra = '') =>
    `<form id="f" ${attrs}><input name="q" value="1">${extra}<button id="go">go</button><button id="get" formmethod="get">get</button><button id="away" formaction="https://example.com/post">away</button></form>`

  test('the form field: POST forms to the same origin, at serialisation, for every way of submitting', async () => {
    server.route('/form', { body: html({ body: form('method="post" action="/echo" data-botscent-field') }) })
    const { page } = await open('chromium', '/form')
    const viaFormData = await page.evaluate(() => [...new FormData(document.getElementById('f') as HTMLFormElement)])
    assert.deepEqual(viaFormData, [
      ['q', '1'],
      ['botscent', '1;;;browser.webdriver-flag'],
    ])
    const before = server.posted.length
    await Promise.all([page.waitForURL('**/echo'), page.click('#go')])
    assert.equal(server.posted.at(-1)!.body, 'q=1&botscent=1%3B%3B%3Bbrowser.webdriver-flag')
    await page.goto(server.origin + '/form')
    await page.waitForFunction(() => (window as any).botscent !== undefined)
    await Promise.all([
      page.waitForURL('**/echo'),
      page.evaluate(() => (document.getElementById('f') as HTMLFormElement).submit()),
    ])
    assert.match(server.posted.at(-1)!.body, /botscent=/, 'form.submit()')
    await page.goto(server.origin + '/form')
    await page.waitForFunction(() => (window as any).botscent !== undefined)
    await Promise.all([
      page.waitForURL('**/echo'),
      page.evaluate(() => (document.getElementById('f') as HTMLFormElement).requestSubmit()),
    ])
    assert.match(server.posted.at(-1)!.body, /botscent=/, 'requestSubmit()')
    assert.equal(server.posted.length, before + 3)
    await page.context().close()
  })

  test('the form field: never on GET, never cross-origin, never without opting in, never for a person', async () => {
    server.route('/form-get', { body: html({ body: form('method="get" action="/plain" data-botscent-field') }) })
    server.route('/form-plain', { body: html({ body: form('method="post" action="/echo"') }) })
    server.route('/form-cross', {
      body: html({ body: form('method="post" action="https://example.com/x" data-botscent-field') }),
    })
    server.route('/form-marked', {
      body: html({ body: form('method="post" action="/echo"', '<input type="hidden" disabled data-botscent-field>') }),
    })
    const { page } = await open('chromium', '/form-get')
    const fields = async (path: string) => {
      await page.goto(server.origin + path)
      await page.waitForFunction(() => (window as any).botscent !== undefined)
      return page.evaluate(() => [...new FormData(document.getElementById('f') as HTMLFormElement)].map(([k]) => k))
    }
    assert.deepEqual(await fields('/form-get'), ['q'], 'GET form')
    assert.deepEqual(await fields('/form-plain'), ['q'], 'not opted in')
    assert.deepEqual(await fields('/form-cross'), ['q'], 'cross-origin action')
    assert.deepEqual(await fields('/form-marked'), ['q', 'botscent'], 'opted in by a marker element inside the form')
    server.route('/form-post', { body: html({ body: form('method="post" action="/echo" data-botscent-field') }) })
    await page.goto(server.origin + '/form-post')
    await page.waitForFunction(() => (window as any).botscent !== undefined)
    await Promise.all([page.waitForURL((url) => url.pathname === '/echo'), page.click('#get')])
    assert.equal(new URL(page.url()).search, '?q=1', 'a submitter with formmethod=get puts nothing in the URL')
    await page.context().close()
    const person = await open('chromium-clean', '/form-post')
    assert.deepEqual(
      await person.page.evaluate(() =>
        [...new FormData(document.getElementById('f') as HTMLFormElement)].map(([k]) => k),
      ),
      ['q'],
    )
    await person.page.context().close()
  })
})

describe('chromium: lifecycle and failure', () => {
  test('a second copy of the script and repeated start() share one instance', async () => {
    server.route('/twice', { body: html({ head: '<script defer src="/botscent.js?copy=2"></script>' }) })
    const { page } = await open('chromium', '/twice')
    await page.waitForTimeout(300)
    const out = await page.evaluate(() => {
      const b = (window as any).botscent
      const stop = b.start()
      return {
        same: typeof stop === 'function',
        events: (window as any).__events.length,
        instance: typeof (globalThis as any)[Symbol.for('botscent')],
      }
    })
    assert.deepEqual(out, { same: true, events: 1, instance: 'object' })
    await page.context().close()
  })

  test('hostile getters: every probe that throws is a failed status, the page sees no error', async () => {
    const { page, errors } = await open(
      'chromium',
      '/plain',
      `(() => {
        const boom = () => { throw new Error('boom') }
        Object.defineProperty(Navigator.prototype, 'credentials', { get: boom, configurable: true })
        Object.defineProperty(Navigator.prototype, 'keyboard', { get: boom, configurable: true })
        Object.defineProperty(window, 'prompt', { get: boom, configurable: true })
        Document.prototype.getElementById = boom
      })()`,
    )
    await page.waitForTimeout(300)
    const d = await page.evaluate(() => (window as any).botscent.diagnostics())
    for (const probe of ['credentials', 'keyboard', 'markers']) assert.equal(d.probes[probe], 'failed', probe)
    assert.equal(d.probes.prompt, 'ok', "descriptors are read without invoking the page's getter")
    assert.equal(d.probes.navigator, 'ok')
    assert.deepEqual(
      await verdict(page),
      { type: 'agent', reasons: ['browser.webdriver-flag'] },
      'what can be read still counts',
    )
    assert.deepEqual(errors, [])
    await page.context().close()
  })

  test('listeners are passive and capture; no network request of its own; subscribe with a selector', async () => {
    server.route('/watch', { body: html() })
    const { page } = await open(
      'chromium-clean',
      '/watch',
      `window.__listeners = []; const add = EventTarget.prototype.addEventListener;
       EventTarget.prototype.addEventListener = function (type, fn, options) { if (this === document) __listeners.push([type, options && options.passive === true, options === true || !!(options && options.capture)]); return add.call(this, type, fn, options) }`,
    )
    const listeners = await page.evaluate(() => (window as any).__listeners)
    for (const type of ['pointerdown', 'keydown', 'wheel', 'input'])
      assert.deepEqual(
        listeners.find((l: unknown[]) => l[0] === type),
        [type, true, true],
        type,
      )
    const ours = server.requests.filter((r) => !r.startsWith('GET /watch') && !r.startsWith('GET /botscent.js'))
    assert.deepEqual(
      ours.filter((r) => r.includes('watch')),
      [],
    )
    const calls = await page.evaluate(async () => {
      const b = (window as any).botscent
      const seen: string[] = []
      b.subscribe(
        (v: { type: string }) => v.type,
        (type: string) => seen.push(type),
      )
      const m = document.createElement('div')
      m.id = 'claude-agent-glow-border'
      document.body.appendChild(m)
      await new Promise((r) => setTimeout(r, 600))
      return seen
    })
    assert.deepEqual(calls, ['agent'], 'called once, when the selected value changed')
    await page.context().close()
  })
})

for (const [engine, type] of [
  ['webkit', webkit],
  ['firefox', firefox],
] as [string, BrowserType][]) {
  describe(engine, () => {
    before(async () => {
      browsers.set(engine, await type.launch())
    })

    test('a person-shaped page load: no errors; what this engine lacks is unsupported, not failed', async () => {
      const { page, errors } = await open(engine, '/plain')
      await page.waitForTimeout(300)
      const d = await page.evaluate(() => (window as any).botscent.diagnostics())
      for (const [probe, status] of Object.entries(d.probes)) assert.notEqual(status, 'failed', `${probe}`)
      const v = await verdict(page)
      // Playwright's WebKit and Firefox report navigator.webdriver too; that is the only reason allowed here.
      assert.ok(
        v.reasons.every((r) => r === 'browser.webdriver-flag'),
        JSON.stringify(v),
      )
      assert.deepEqual(errors, [])
      await page.context().close()
    })

    test('transport: a fresh entry is received, a stale one rejected', async () => {
      server.route(`/${engine}-fresh`, {
        headers: {
          'server-timing': `botscent;desc="1;manus;${Date.now()};signer.web-bot-auth.verified,ua.declared-agent-token"`,
        },
        body: html(),
      })
      server.route(`/${engine}-stale`, {
        headers: { 'server-timing': `botscent;desc="1;manus;${Date.now() - 60_000};signer.web-bot-auth.verified"` },
        body: html(),
      })
      const fresh = await open(engine, `/${engine}-fresh`)
      const v = await verdict(fresh.page)
      assert.equal(v.agent_name, 'manus')
      assert.deepEqual(v.reasons.slice(0, 2), ['signer.web-bot-auth.verified', 'ua.declared-agent-token'])
      assert.equal(await fresh.page.evaluate(() => (window as any).botscent.diagnostics().transport), 'received')
      await fresh.page.context().close()
      const stale = await open(engine, `/${engine}-stale`)
      assert.equal(await stale.page.evaluate(() => (window as any).botscent.diagnostics().transport), 'rejected')
      assert.equal((await verdict(stale.page)).agent_name, undefined)
      await stale.page.context().close()
    })

    test('DOM observation: the Claude marker is seen within a second', async () => {
      const { page } = await open(
        engine,
        '/plain',
        `setTimeout(() => { const m = document.createElement('div'); m.id = 'claude-agent-stop-button'; document.body.appendChild(m) }, 500)`,
      )
      const v = await settle(page, `window.botscent.verdict().reasons.includes('claude.marker.active')`, 2000)
      assert.equal(v.agent_name, 'claude-chrome')
      await page.context().close()
    })

    test('the form field rides a POST to the same origin', async () => {
      server.route(`/${engine}-form`, {
        body: html({
          body: '<form id="f" method="post" action="/echo" data-botscent-field><input name="q" value="1"><button id="go">go</button></form>',
        }),
      })
      const { page } = await open(
        engine,
        `/${engine}-form`,
        `setTimeout(() => { const m = document.createElement('div'); m.id = 'claude-agent-stop-button'; document.body.appendChild(m) }, 100)`,
      )
      await settle(page, `window.botscent.verdict().reasons.includes('claude.marker.active')`, 2000)
      await Promise.all([page.waitForURL((url) => url.pathname === '/echo'), page.click('#go')])
      assert.match(server.posted.at(-1)!.body, /^q=1&botscent=1%3Bclaude-chrome%3B%3B/)
      await page.context().close()
    })
  })
}
