// Every page adapter, installed from the packed tarball, in Chromium: React (with
// <Botscent />) and Vue as Vite apps, SvelteKit rendered on the server and then
// hydrated, and the plain script tag. An automated browser is an agent through the
// webdriver flag, and its same-origin request carries the report; a person's visit
// stays human and adds no header.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { chromium, type Browser, type Page } from 'playwright'

const examples = new URL('../', import.meta.url).pathname
const PERSON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const HUMAN = { type: 'human', reasons: [] }
const REPORTED = { type: 'agent', reasons: ['page.browser.webdriver-flag'] }
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const servers: ChildProcess[] = []
const sites: Server[] = []
let automated: Browser
let person: Browser

/** A static site, as a CDN would serve it, with an /api/visit that answers with the report it received. */
async function site(root: string, port: number, files: Record<string, string> = {}): Promise<string> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://x').pathname
    if (path === '/api/visit') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ report: req.headers['botscent-report'] ?? null }))
      return
    }
    const file = files[path] ?? `${root}${path === '/' ? '/index.html' : path}`
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  sites.push(server)
  return `http://127.0.0.1:${port}`
}

/** SvelteKit's Node server, in its own process group. */
async function sveltekit(port: number): Promise<string> {
  const origin = `http://127.0.0.1:${port}`
  servers.push(
    spawn(process.execPath, ['build/index.js'], {
      cwd: `${examples}sveltekit`,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
      stdio: 'ignore',
      detached: true,
    }),
  )
  for (let i = 0; ; i++) {
    if (
      await fetch(origin).then(
        () => true,
        () => false,
      )
    )
      return origin
    if (i > 100) throw new Error('the SvelteKit example did not start')
    await new Promise((r) => setTimeout(r, 100))
  }
}

before(async () => {
  automated = await chromium.launch()
  person = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })
})
after(async () => {
  await automated?.close()
  await person?.close()
  for (const s of sites) s.close()
  for (const s of servers)
    try {
      process.kill(-s.pid!, 'SIGTERM')
    } catch {}
})

async function visit(browser: Browser, origin: string) {
  const page = await (await browser.newContext({ userAgent: PERSON_UA })).newPage()
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`)
  })
  await page.goto(origin)
  await page
    .waitForFunction(() => (globalThis as any)[Symbol.for('botscent')]?.diagnostics().started === true, undefined, {
      timeout: 10_000,
    })
    .catch((error) => {
      throw new Error(`observation never started: ${problems.join('; ') || 'no error on the page'}`, { cause: error })
    })
  return { page, problems }
}
const shown = (page: Page, id: string) =>
  page.evaluate((i) => JSON.parse(document.getElementById(i)!.textContent || 'null'), id)
async function send(page: Page) {
  const request = page.waitForRequest((r) => r.url().endsWith('/api/visit'))
  await page.click('#send')
  await page.waitForFunction(() => document.getElementById('answer')!.textContent !== '')
  return { header: (await request).headers()['botscent-report'], answer: await shown(page, 'answer') }
}

const EXAMPLES: { name: string; start: () => Promise<string>; answer: (reported: boolean) => unknown }[] = [
  {
    name: 'React',
    start: () => site(`${examples}react/dist`, 3404),
    answer: (reported) => ({ report: reported ? '1;;;browser.webdriver-flag' : null }),
  },
  {
    name: 'Vue',
    start: () => site(`${examples}vue/dist`, 3402),
    answer: (reported) => ({ report: reported ? '1;;;browser.webdriver-flag' : null }),
  },
  {
    name: 'SvelteKit',
    start: () => sveltekit(3401),
    answer: (reported) =>
      reported
        ? { request: HUMAN, report: REPORTED, combined: REPORTED }
        : { request: HUMAN, report: null, combined: HUMAN },
  },
  {
    name: 'script tag',
    start: () =>
      site(`${examples}script`, 3403, { '/botscent.js': `${examples}script/node_modules/botscent/dist/botscent.js` }),
    answer: (reported) => ({ report: reported ? '1;;;browser.webdriver-flag' : null }),
  },
]

for (const example of EXAMPLES)
  describe(example.name, () => {
    let origin: string
    before(async () => {
      origin = await example.start()
    })

    test('an automated browser is an agent, and its same-origin request carries the report', async () => {
      const { page, problems } = await visit(automated, origin)
      await page.waitForFunction(() => JSON.parse(document.getElementById('verdict')!.textContent!).type === 'agent')
      assert.deepEqual(await shown(page, 'verdict'), { type: 'agent', reasons: ['browser.webdriver-flag'] })
      const { header, answer } = await send(page)
      assert.equal(header, '1;;;browser.webdriver-flag')
      assert.deepEqual(answer, example.answer(true))
      assert.deepEqual(problems, [], 'no hydration mismatch, no error')
    })

    test("a person's visit stays human and adds no header", async () => {
      const { page, problems } = await visit(person, origin)
      // Past the later pass at 1.5 s.
      await page.waitForTimeout(2000)
      assert.deepEqual(await shown(page, 'verdict'), HUMAN)
      const { header, answer } = await send(page)
      assert.equal(header, undefined)
      assert.deepEqual(answer, example.answer(false))
      assert.deepEqual(problems, [])
    })
  })

test('SvelteKit renders the server value before hydration', async () => {
  const html = await (await fetch('http://127.0.0.1:3401/')).text()
  assert.match(
    html,
    /<pre id="verdict">\{(&quot;|")type(&quot;|"):(&quot;|")human(&quot;|"),(&quot;|")reasons(&quot;|"):\[\]\}<\/pre>/,
  )
})
