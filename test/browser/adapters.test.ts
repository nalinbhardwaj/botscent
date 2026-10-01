// The Vue and Svelte page adapters in Chromium: bundled from source into tiny apps,
// loaded on a page, then shown agent evidence (an extension's marker).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { build } from 'tsdown'
import { serve, type TestServer } from './server.ts'

const root = new URL('../../', import.meta.url).pathname
let server: TestServer
let browser: Browser

before(async () => {
  for (const name of ['vue', 'svelte'])
    await build({
      entry: { [name]: `${root}test/browser/apps/${name === 'vue' ? 'vue-app' : 'svelte-store'}.ts` },
      outDir: `${root}.size/apps`,
      format: 'iife',
      platform: 'browser',
      dts: false,
      logLevel: 'silent',
      config: false,
      clean: false,
      define: {
        'process.env.NODE_ENV': '"production"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      },
      noExternal: [/.*/],
      outputOptions: { entryFileNames: '[name].js' },
    })
  server = await serve()
  for (const name of ['vue', 'svelte'])
    server.route(`/${name}`, {
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script>${readFileSync(`${root}.size/apps/${name}.js`, 'utf8').replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    })
  browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })
})
after(async () => {
  await browser?.close()
  await server?.close()
})

const marker = () => {
  const m = document.createElement('div')
  m.id = 'claude-agent-glow-border'
  document.body.appendChild(m)
}

test('Vue: the plugin starts observation, the refs follow, and a selector re-renders only when its part changes', async () => {
  const page = await browser.newPage()
  await page.goto(`${server.origin}/vue`)
  await page.waitForSelector('#verdict')
  const counts = () => page.evaluate(() => ({ ...(window as any).__counts }))
  assert.equal(
    (await counts()).first,
    JSON.stringify({ type: 'human', reasons: [] }),
    'the first render is the server value',
  )
  await page.evaluate(marker)
  await page.waitForFunction(() => document.getElementById('type')!.textContent === 'agent')
  const afterAgent = await counts()
  // A second product's marker: new reasons and no name, the same type.
  await page.evaluate(() => {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.setAttribute('data-codex-favicon-badge', '')
    document.head.appendChild(link)
  })
  await page.waitForFunction(() => JSON.parse(document.getElementById('verdict')!.textContent!).reasons.length === 2)
  await page.waitForTimeout(100)
  const afterReasons = await counts()
  assert.equal(afterReasons.type, afterAgent.type, 'the type-only component did not re-render')
  assert.equal(afterReasons.full, afterAgent.full + 1, 'the full component re-rendered once')
  assert.deepEqual(JSON.parse((await page.textContent('#verdict'))!), {
    type: 'agent',
    reasons: ['chatgpt.badge.active', 'claude.marker.active'],
  })
  await page.close()
})

test('Svelte: the store starts from the server value and follows the verdict', async () => {
  const page = await browser.newPage()
  await page.goto(`${server.origin}/svelte`)
  await page.waitForFunction(() => (window as any).__values?.length >= 1)
  const first = await page.evaluate(() => (window as any).__values[0])
  assert.deepEqual(first, { type: 'human', reasons: [] }, 'the first value, synchronously, is the server value')
  await page.evaluate(marker)
  await page.waitForFunction(() => (window as any).__values.at(-1).type === 'agent')
  assert.deepEqual(await page.evaluate(() => (window as any).__values.at(-1)), {
    type: 'agent',
    agent_name: 'claude-chrome',
    reasons: ['claude.marker.active'],
  })
  await page.close()
})
