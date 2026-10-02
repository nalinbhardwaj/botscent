// A person's browser behind a cache that ignores no-store (examples/deployed/cache/nginx.conf
// on 127.0.0.1:8088), right after an agent's visit to the same path. Exits within 90 s.
import { chromium } from 'playwright'

setTimeout(() => {
  console.error('timed out')
  process.exit(2)
}, 90_000).unref()
const UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })
for (const m of ['always', 'never']) {
  const base = `http://127.0.0.1:8088/${m}/`
  const agent = await fetch(`${base}?agent`, {
    headers: { 'user-agent': UA, 'sec-fetch-dest': 'document', accept: 'text/html' },
    signal: AbortSignal.timeout(10_000),
  })
  await agent.text()
  const page = await browser.newPage()
  await page.goto(`${base}?person`, { timeout: 20_000 })
  await page.waitForFunction(() => window.botscent?.diagnostics().started, null, { timeout: 20_000 })
  await page.waitForTimeout(1600)
  const seen = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    verdict: window.botscent.verdict(),
    transport: window.botscent.diagnostics().transport,
  }))
  console.log(m, JSON.stringify(seen))
  await page.close()
}
await browser.close()
