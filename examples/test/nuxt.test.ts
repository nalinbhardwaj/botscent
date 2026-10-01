// The Nuxt module in Chromium: one line in nuxt.config starts the page half in a
// client plugin and auto-imports useBotscent(); the prerendered home page stays
// static and hydrates without a mismatch; the headers carrier reaches a Nitro
// route, where the application joins the report with the request's own evidence.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'

const ORIGIN = 'http://127.0.0.1:3200'
const APP = new URL('../nuxt/', import.meta.url).pathname
const PERSON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const HUMAN = { type: 'human', reasons: [] }
let server: ChildProcess
const browsers: Browser[] = []

before(async () => {
  if (
    await fetch(ORIGIN).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`${ORIGIN} is already in use`)
  server = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: APP,
    env: { ...process.env, PORT: '3200', HOST: '127.0.0.1' },
    stdio: 'ignore',
    detached: true,
  })
  for (
    let i = 0;
    !(await fetch(ORIGIN).then(
      () => true,
      () => false,
    ));
    i++
  ) {
    if (i > 100) throw new Error('the Nuxt example did not start')
    await new Promise((r) => setTimeout(r, 100))
  }
})
after(async () => {
  for (const browser of browsers) await browser.close()
  try {
    process.kill(-server.pid!, 'SIGTERM')
  } catch {}
})

// A browser that is automated (navigator.webdriver) or looks like a person's.
async function visit(automated: boolean) {
  const browser = await chromium.launch(automated ? {} : { args: ['--disable-blink-features=AutomationControlled'] })
  browsers.push(browser)
  const page = await (await browser.newContext({ userAgent: PERSON_UA })).newPage()
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(String(e)))
  await page.goto(`${ORIGIN}/`)
  // The client plugin has run once observation has started.
  await page.waitForFunction(() => (globalThis as any)[Symbol.for('botscent')]?.diagnostics().started === true)
  return { page, problems }
}
const shown = (page: Page, id: string) =>
  page.evaluate((i) => JSON.parse(document.getElementById(i)!.textContent || 'null'), id)
async function send(page: Page) {
  const request = page.waitForRequest(`${ORIGIN}/api/visit`)
  await page.click('#send')
  await page.waitForFunction(() => document.getElementById('answer')!.textContent !== '')
  return { headers: (await request).headers(), answer: await shown(page, 'answer') }
}

test('the home page was prerendered with the server value, and is served as built', async () => {
  const built = readFileSync(`${APP}.output/public/index.html`, 'utf8')
  assert.match(built, /<pre id="verdict">\{&quot;type&quot;:&quot;human&quot;,&quot;reasons&quot;:\[\]\}<\/pre>/)
  assert.equal(await (await fetch(`${ORIGIN}/`)).text(), built)
})

test('an automated browser: the hydrated page follows the verdict, and the report reaches a Nitro route', async () => {
  const { page, problems } = await visit(true)
  await page.waitForFunction(() => JSON.parse(document.getElementById('verdict')!.textContent!).type === 'agent')
  assert.deepEqual(await shown(page, 'verdict'), { type: 'agent', reasons: ['browser.webdriver-flag'] })
  const { headers, answer } = await send(page)
  // A page's report carries no time; only the Server-Timing entry does.
  assert.equal(headers['botscent-report'], '1;;;browser.webdriver-flag')
  const reported = { type: 'agent', reasons: ['page.browser.webdriver-flag'] }
  assert.deepEqual(answer, { request: HUMAN, report: reported, combined: reported })
  assert.deepEqual(problems, [], 'no hydration mismatch, no error')
})

test("a person's visit: human on both halves, and the request carries no report", async () => {
  const { page, problems } = await visit(false)
  // Past the later pass at 1.5 s.
  await page.waitForTimeout(2000)
  assert.deepEqual(await shown(page, 'verdict'), HUMAN)
  const { headers, answer } = await send(page)
  assert.equal(headers['botscent-report'], undefined)
  assert.deepEqual(answer, { request: HUMAN, report: null, combined: HUMAN })
  assert.deepEqual(problems, [])
})
