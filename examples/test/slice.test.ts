// The vertical slice (plan section 10, step 4): five hard cases through the
// packaged library, a Next.js app (proxy.ts, instrumentation-client, the React
// hook) and a FastAPI backend behind it, in a real browser.
// Run from the repository root after packing: npm run test:examples
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { sharedCache } from './cache.ts'

const NEXT = 'http://localhost:3100'
// Playwright's headless Chromium declares HeadlessChrome, which the server half rightly reports;
// a person here is an ordinary Chrome user agent.
const PERSON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const AGENT_UA = `${PERSON_UA}; compatible; ChatGPT-User/1.0; +https://openai.com/bot`
const examples = new URL('../', import.meta.url).pathname
const servers: ChildProcess[] = []
let browser: Browser

async function ready(url: string, init?: RequestInit) {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(url, init)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  throw new Error(`${url} did not start`)
}

before(async () => {
  for (const url of [NEXT, 'http://127.0.0.1:8000'])
    if (
      await fetch(url).then(
        () => true,
        () => false,
      )
    )
      throw new Error(`${url} is already in use; stop the old server first`)
  // Each server in its own process group, so that cleanup ends it and everything it started.
  const start = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) =>
    servers.push(spawn(command, args, { cwd, env, stdio: 'ignore', detached: true }))
  start(
    `${examples}fastapi/.venv/bin/uvicorn`,
    ['app:app', '--host', '127.0.0.1', '--port', '8000', '--log-level', 'warning'],
    `${examples}fastapi`,
  )
  start(`${examples}next/node_modules/.bin/next`, ['start', '-p', '3100'], `${examples}next`, {
    ...process.env,
    BOTSCENT_EXAMPLE_TRANSPORT: 'always',
  })
  await ready('http://127.0.0.1:8000/checkout', { method: 'POST' })
  await ready(NEXT)
  browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] }) // no webdriver flag: evidence comes only from what each case adds
})
after(async () => {
  await browser?.close()
  for (const s of servers)
    try {
      process.kill(-s.pid!, 'SIGTERM')
    } catch {}
})

type Verdict = { type: string; agent_name?: string; reasons: string[] }
async function visit(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.getElementById('verdict') !== null)
  return page
}
const verdictOf = (page: Page): Promise<Verdict> =>
  page.evaluate(() => JSON.parse(document.getElementById('verdict')!.textContent!))
const transportOf = (page: Page) =>
  page.evaluate(
    () =>
      (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).serverTiming.filter(
        (e) => e.name === 'botscent',
      ).length,
  )

describe('the vertical slice', { timeout: 60_000 }, () => {
  test('1. a cached page keeps its navigation evidence and never replays it to a person', async () => {
    const agent = await browser.newContext({ userAgent: AGENT_UA })
    const person = await browser.newContext({ userAgent: PERSON_UA })
    // Next serves / from its own full-route cache; the proxy decorates each response after that lookup.
    const a = await visit(agent, `${NEXT}/`)
    assert.deepEqual(await verdictOf(a), {
      type: 'agent',
      agent_name: 'chatgpt-user',
      reasons: ['ua.declared-agent-token'],
    })
    const p = await visit(person, `${NEXT}/`)
    assert.deepEqual(await verdictOf(p), { type: 'human', reasons: [] })
    assert.equal(await transportOf(p), 0, 'no entry reaches the person')

    // A shared cache in front of the app: the decorated agent response is never stored (no-store);
    // a person's response is, and the agent that comes after gets that undecorated copy: its
    // request evidence goes missing, which is the safe way to fail.
    const cdn = await sharedCache(NEXT)
    try {
      await visit(agent, `${cdn.origin}/`)
      await visit(person, `${cdn.origin}/`)
      const later = await visit(person, `${cdn.origin}/`)
      assert.deepEqual(await verdictOf(later), { type: 'human', reasons: [] })
      const lateAgent = await visit(agent, `${cdn.origin}/`)
      assert.deepEqual(await verdictOf(lateAgent), { type: 'human', reasons: [] }, 'missing, never wrong')
      assert.deepEqual(
        cdn.log.filter((l) => l.split(' ')[1] === '/').map((l) => l.split(' ')[0]),
        ['PASS', 'STORE', 'HIT', 'HIT'],
        'the document: the agent passes uncached, the person is stored, then served from the cache',
      )
      for (const stored of cdn.store.values())
        assert.doesNotMatch(String(stored.headers['server-timing'] ?? ''), /botscent/)
    } finally {
      // The pages first, so that no request of theirs is still passing through the cache.
      await agent.close()
      await person.close()
      await cdn.close()
    }
  })

  test('2 and 4. an extension agent starts late, a person takes the tab back; analytics keep what each event saw', async () => {
    const context = await browser.newContext({ userAgent: PERSON_UA })
    const since = ((await (await fetch(`${NEXT}/api/events`)).json()) as unknown[]).length
    const page = await visit(context, `${NEXT}/analytics`)
    await page.waitForTimeout(800)
    // The extension draws its marker while its agent acts, and removes it when the turn ends.
    await page.evaluate(() => {
      const m = document.createElement('div')
      m.id = 'claude-agent-glow-border'
      document.body.appendChild(m)
      setTimeout(() => m.remove(), 1500)
    })
    await page.waitForFunction(() => JSON.parse(document.getElementById('verdict')!.textContent!).type === 'agent')
    await page.waitForTimeout(2000)
    // The person clicks after the marker is gone: the document has shown agent evidence, and says so.
    await page.click('#action')
    await page.waitForTimeout(300)
    assert.deepEqual(await verdictOf(page), {
      type: 'agent',
      agent_name: 'claude-chrome',
      reasons: ['claude.marker.active'],
    })
    const events = (await page.evaluate(() => fetch('/api/events').then((r) => r.json()))).slice(since) as {
      name: string
      botscent: Verdict
    }[]
    assert.deepEqual(
      events.map((e) => [e.name, e.botscent.type]),
      [
        ['pageview', 'human'],
        ['agent_detected', 'agent'],
        ['click', 'agent'],
      ],
      'the pageview keeps the verdict it was sent with; later events carry the document history',
    )
    await context.close()
  })

  test('3. a React frontend sends an explicit report to a Python backend, and the backend keeps the two apart', async () => {
    const context = await browser.newContext({ userAgent: PERSON_UA })
    const page = await visit(context, `${NEXT}/checkout`)
    const result = async (button: string) => {
      await page.evaluate(() => (document.getElementById('result')!.textContent = ''))
      await page.click(button)
      await page.waitForFunction(() => document.getElementById('result')!.textContent !== '')
      return JSON.parse((await page.textContent('#result'))!)
    }
    const before = await result('#python-api')
    assert.deepEqual(
      before,
      { request: { type: 'human', reasons: [] }, report: null, combined: { type: 'human', reasons: [] } },
      'a person sends nothing',
    )
    await page.evaluate(() => {
      const m = document.createElement('div')
      m.id = 'claude-agent-stop-button'
      document.body.appendChild(m)
    })
    await page.waitForFunction(() => JSON.parse(document.getElementById('verdict')!.textContent!).type === 'agent')
    const after = await result('#python-api')
    assert.deepEqual(after.request, { type: 'human', reasons: [] }, "the request's own evidence")
    assert.deepEqual(after.report, {
      type: 'agent',
      agent_name: 'claude-chrome',
      reasons: ['page.claude.marker.active'],
    })
    assert.deepEqual(after.combined, {
      type: 'agent',
      agent_name: 'claude-chrome',
      reasons: ['page.claude.marker.active'],
    })
    // The same through a native form post, serialised at submission.
    await Promise.all([page.waitForURL('**/py/form'), page.click('#submit')])
    const posted = JSON.parse((await page.textContent('#posted'))!)
    assert.deepEqual(posted.fields, ['botscent', 'cart'])
    assert.equal(posted.report.agent_name, 'claude-chrome')
    await context.close()
  })

  test('5. streaming responses and multipart uploads pass through untouched, on agent navigations too', async () => {
    const context = await browser.newContext({ userAgent: AGENT_UA })
    const page = await visit(context, `${NEXT}/checkout`)
    const timings = await page.evaluate(async () => {
      const response = await fetch('/api/stream')
      const reader = response.body!.getReader()
      const arrivals: number[] = []
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        arrivals.push(performance.now())
        text += new TextDecoder().decode(value)
      }
      return { text, gaps: arrivals.slice(1).map((t, i) => Math.round(t - arrivals[i]!)) }
    })
    assert.equal(timings.text, 'chunk 0\nchunk 1\nchunk 2\n')
    assert.ok(
      timings.gaps.length === 2 && timings.gaps.every((g) => g >= 120),
      `chunks arrive as written, not buffered: ${timings.gaps}`,
    )
    const upload = await page.evaluate(async () => {
      const bytes = new Uint8Array(300_000).map((_, i) => (i * 31) % 256)
      const form = new FormData()
      form.append('name', 'blob')
      form.append('file', new Blob([bytes]), 'blob.bin')
      return (await fetch('/py/upload', { method: 'POST', body: form })).json()
    })
    assert.equal(upload.size, 300_000)
    assert.equal(upload.first, '001f3e5d')
    assert.equal(upload.verdict.agent_name, 'chatgpt-user', "the backend's own request verdict")
    await context.close()
  })
})
