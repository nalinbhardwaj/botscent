// The Astro integration in Chromium: one line installs both halves; on-demand pages
// get the server verdict in Astro.locals and, with the transport on, in the page;
// prerendered pages get the page half alone.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser } from 'playwright'

const ORIGIN = 'http://127.0.0.1:4321'
const PERSON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const AGENT_UA = `${PERSON_UA}; compatible; ChatGPT-User/1.0; +https://openai.com/bot`
let server: ChildProcess
let browser: Browser

before(async () => {
  if (
    await fetch(ORIGIN).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`${ORIGIN} is already in use`)
  server = spawn(process.execPath, ['dist/server/entry.mjs'], {
    cwd: new URL('../astro/', import.meta.url).pathname,
    env: { ...process.env, PORT: '4321', HOST: '127.0.0.1' },
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
    if (i > 100) throw new Error('the Astro example did not start')
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })
})
after(async () => {
  await browser?.close()
  try {
    process.kill(-server.pid!, 'SIGTERM')
  } catch {}
})

const shown = (page: import('playwright').Page, id: string) =>
  page.evaluate((i) => JSON.parse(document.getElementById(i)!.textContent!), id)

test('on demand: the server verdict in Astro.locals and, through Server-Timing, in the page', async () => {
  const context = await browser.newContext({ userAgent: AGENT_UA })
  const page = await context.newPage()
  await page.goto(`${ORIGIN}/ssr`)
  await page.waitForFunction(() => document.getElementById('verdict')!.textContent !== '')
  const expected = { type: 'agent', agent_name: 'chatgpt-user', reasons: ['ua.declared-agent-token'] }
  assert.deepEqual(await shown(page, 'server'), expected)
  assert.deepEqual(await shown(page, 'verdict'), expected)
  await context.close()
})

test('a person sees human on both halves', async () => {
  const context = await browser.newContext({ userAgent: PERSON_UA })
  const page = await context.newPage()
  await page.goto(`${ORIGIN}/ssr`)
  await page.waitForFunction(() => document.getElementById('verdict')!.textContent !== '')
  assert.deepEqual(await shown(page, 'server'), { type: 'human', reasons: [] })
  assert.deepEqual(await shown(page, 'verdict'), { type: 'human', reasons: [] })
  await context.close()
})

test('prerendered: the page half alone, which still sees an extension acting', async () => {
  const context = await browser.newContext({ userAgent: PERSON_UA })
  const page = await context.newPage()
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => document.getElementById('verdict')!.textContent !== '')
  assert.deepEqual(await shown(page, 'verdict'), { type: 'human', reasons: [] })
  await page.evaluate(() => {
    const m = document.createElement('div')
    m.id = 'claude-agent-glow-border'
    document.body.appendChild(m)
  })
  await page.waitForFunction(() => JSON.parse(document.getElementById('verdict')!.textContent!).type === 'agent')
  assert.deepEqual(await shown(page, 'verdict'), {
    type: 'agent',
    agent_name: 'claude-chrome',
    reasons: ['claude.marker.active'],
  })
  await context.close()
})
