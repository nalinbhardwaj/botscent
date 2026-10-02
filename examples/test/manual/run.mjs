// node examples/test/manual/run.mjs [chromium|firefox|webkit] [--stale]: one browser profile; an agent's visit fills the
// worker's cache, then later navigations come from it.
import * as engines from 'playwright'
import { start } from './server.mjs'

const AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
const server = await start()
const origin = `http://localhost:${server.address().port}/`
const engine = ['chromium', 'firefox', 'webkit'].find((e) => process.argv.includes(e)) ?? 'chromium'
const browser = await engines[engine].launch()
console.log(engine)
const context = await browser.newContext({ userAgent: AGENT })
const page = await context.newPage()
const read = () =>
  page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    return {
      fromWorker: nav.workerStart > 0,
      transferSize: nav.transferSize,
      entries: nav.serverTiming.filter((e) => e.name === 'botscent').map((e) => e.description),
      transport: window.botscent.diagnostics().transport,
    }
  })
const visit = async (label) => {
  await page.goto(origin)
  await page.waitForFunction(() => window.botscent?.diagnostics().started)
  console.log(label, JSON.stringify(await read()))
}
await visit('1 network, agent:')
await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
await visit('2 worker cache, at once:')
if (process.argv.includes('--stale')) {
  await new Promise((r) => setTimeout(r, 125_000))
  await visit('3 worker cache, after 125 s:')
}
await browser.close()
server.close()
