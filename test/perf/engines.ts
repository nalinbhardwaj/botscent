// Start-up in each engine, for the record (not gated): the built script inserted as an inline script into
// the article page and timed with performance.now(), which includes parsing and compiling it on the main
// thread, unthrottled (only Chromium can throttle). The timer's resolution differs by engine: 0.1 ms in
// Chromium, coarser in Firefox and WebKit, so their medians are rounded accordingly.
import { readFileSync } from 'node:fs'
import { chromium, firefox, webkit, type BrowserType } from 'playwright'
import type { TestServer } from '../browser/server.ts'
import { ARGS } from './chromium.ts'
import { path } from './pages.ts'

const SCRIPT = new URL('../../dist/botscent.js', import.meta.url)

export async function engineStartup(server: TestServer, runs = 9): Promise<Record<string, number[]>> {
  const code = readFileSync(SCRIPT, 'utf8')
  const out: Record<string, number[]> = {}
  for (const [name, type] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ] as [string, BrowserType][]) {
    const browser = await type.launch(name === 'chromium' ? { args: ARGS } : {})
    try {
      const times: number[] = []
      for (let i = 0; i < runs + 1; i++) {
        const context = await browser.newContext()
        const page = await context.newPage()
        await page.goto(server.origin + path('article', false))
        const t = await page.evaluate((code) => {
          const s = document.createElement('script')
          s.textContent = code
          const t0 = performance.now()
          document.head.append(s)
          return performance.now() - t0
        }, code)
        if (i > 0) times.push(t) // the first document in a new browser pays one-time costs
        await context.close()
      }
      out[name] = times
    } finally {
      await browser.close()
    }
  }
  return out
}
