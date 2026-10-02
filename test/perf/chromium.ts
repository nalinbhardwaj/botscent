// Measurements in Chromium through Playwright and the DevTools protocol, each
// on the same page with and without the library, at the calibrated CPU rate.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { TestServer } from '../browser/server.ts'
import { COUNT_QUERIES, RECORD_MUTATIONS, path, type PageName } from './pages.ts'
import { dispatches, library, mainThread, parse, scripting, tasks, timerFires, type TraceEvent } from './trace.ts'

export const LIBRARY_URL = '/botscent.js'
/** Chromium as a person's browser: navigator.webdriver false, so the library takes the path it takes for people. */
export const ARGS: string[] = ['--disable-blink-features=AutomationControlled']
export const CATEGORIES: string[] = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'toplevel',
  'v8.execute',
  'loading',
]
const LONG_TASK_MS = 50

export type Env = { browser: Browser; server: TestServer; rate: number }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const ms = (us: number) => us / 1000

/** A fixed workload of the kind the library does (object and descriptor work, function source reads,
 * DOM building and an attribute query), timed on its first run in a fresh document. */
const CALIBRATION = `(() => {
  const t0 = performance.now()
  let s = 0
  for (let i = 0; i < 12000; i++) {
    const o = { a: i, b: 'x' + i, c: [i, i + 1] }
    s += JSON.stringify(o).length + Object.keys(Object.getOwnPropertyDescriptors(o)).length
  }
  const root = document.createElement('div')
  for (let i = 0; i < 6000; i++) {
    const el = document.createElement('span')
    el.setAttribute('data-i', String(i))
    el.textContent = 'x'
    root.appendChild(el)
  }
  s += root.querySelectorAll('[data-i$="7"]').length
  for (let i = 0; i < 900; i++) s += Function.prototype.toString.call(Array.prototype.map).length
  window.__sink = s
  return performance.now() - t0
})()`

/** The calibration workload's median time, unthrottled, over fresh documents. */
export async function calibrate(server: TestServer, runs = 9): Promise<number[]> {
  const browser = await chromium.launch({ args: ARGS })
  const out: number[] = []
  try {
    for (let i = 0; i < runs + 1; i++) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto(server.origin + path('article', false))
      const t = await page.evaluate(CALIBRATION)
      if (i > 0) out.push(t as number) // the first document in a new browser pays process start-up
      await context.close()
    }
  } finally {
    await browser.close()
  }
  return out
}

async function fresh(env: Env, init: string[] = []): Promise<{ context: BrowserContext; page: Page }> {
  const context = await env.browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: env.rate })
  for (const script of init) await page.addInitScript(script)
  return { context, page }
}

async function traced<T>(env: Env, page: Page, body: () => Promise<T>): Promise<{ result: T; events: TraceEvent[] }> {
  await env.browser.startTracing(page, { categories: CATEGORIES })
  try {
    const result = await body()
    return { result, events: parse(await env.browser.stopTracing()) }
  } catch (error) {
    await env.browser.stopTracing().catch(() => {})
    throw error
  }
}

/** Largest and first contentful paint, cumulative layout shift and the page's own counters. */
const VITALS = `new Promise((resolve) => {
  const lcp = performance.getEntriesByType('largest-contentful-paint')
  let cls = 0
  new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value }).observe({ type: 'layout-shift', buffered: true })
  new PerformanceObserver((list) => {
    const entries = list.getEntries()
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    setTimeout(() => resolve({ lcp: entries.at(-1)?.startTime ?? null, fcp: fcp ? fcp.startTime : null, cls, mutations: window.__mutations }), 0)
  }).observe({ type: 'largest-contentful-paint', buffered: true })
})`

export type Load = {
  page: PageName
  library: boolean
  /** The library's EvaluateScript self time: compile, module evaluation and the synchronous start(). */
  startup: number | null
  /** Library time in the first second after it started (promise probes, observer callbacks). */
  firstSecond: number | null
  /** The task that ran the library's script, and whether the library's share made it a long task. */
  task: number | null
  induced: boolean
  longTasks: number
  lcp: number | null
  fcp: number | null
  cls: number
  mutations: number
  requests: string[]
  renderBlocking: string | null
}

/** One page load: start-up attribution from the trace, and the paint and layout metrics from the page. */
export async function load(env: Env, name: PageName, withLibrary: boolean): Promise<Load> {
  const { context, page } = await fresh(env, [RECORD_MUTATIONS])
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url().replace(env.server.origin, '')))
  try {
    const url = env.server.origin + path(name, withLibrary)
    const { result: vitals, events } = await traced(env, page, async () => {
      await page.goto(url, { waitUntil: 'load' })
      await sleep(1000)
      return (await page.evaluate(VITALS)) as { lcp: number | null; fcp: number | null; cls: number; mutations: number }
    })
    const thread = mainThread(events, url)
    const lib = library(events, thread, LIBRARY_URL)
    const evaluate = lib.spans.find((s) => s.kind === 'EvaluateScript')
    const all = tasks(events, thread)
    const container = evaluate ? all.find((t) => t.start <= evaluate.start && t.end >= evaluate.end) : undefined
    const libraryInTask = container
      ? lib.spans.filter((s) => s.start >= container.start && s.end <= container.end).reduce((t, s) => t + s.self, 0)
      : 0
    const taskMs = container ? ms(container.end - container.start) : null
    const request = events.find(
      (e) => e.name === 'ResourceSendRequest' && String(e.args?.data?.url).endsWith(LIBRARY_URL),
    )
    return {
      page: name,
      library: withLibrary,
      startup: evaluate ? ms(evaluate.self) : null,
      firstSecond: evaluate
        ? ms(
            lib.spans
              .filter((s) => s !== evaluate && s.start >= evaluate.end && s.start < evaluate.end + 1_000_000)
              .reduce((t, s) => t + s.self, 0),
          )
        : null,
      task: taskMs,
      induced: taskMs !== null && taskMs > LONG_TASK_MS && taskMs - ms(libraryInTask) <= LONG_TASK_MS,
      longTasks: all.filter((t) => t.end - t.start > LONG_TASK_MS * 1000).length,
      ...vitals,
      requests,
      renderBlocking: request ? String(request.args?.data?.renderBlocking ?? 'unknown') : null,
    }
  } finally {
    await context.close()
  }
}

/** Event Timing for every interaction, from the document's start. */
const EVENT_TIMING = `window.__interactions = new Map()
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.interactionId) __interactions.set(e.interactionId, Math.max(__interactions.get(e.interactionId) ?? 0, e.duration))
}).observe({ type: 'event', durationThreshold: 16, buffered: true })`

export type Input = {
  page: PageName
  library: boolean
  /** The worst interaction (INP for fewer than 50 interactions), and how many were long enough to report. */
  inp: number
  interactions: number
  /** Library time inside each trusted input dispatch, by event type, in milliseconds. */
  perEvent: Record<string, number[]>
  /** The page's own handler time per click on the button, for scale. */
  pageClick: number[]
}

/** A scripted visit: clicks on a button, typing into a search box, wheel scrolling and clicks on text. */
export async function input(env: Env, name: PageName, withLibrary: boolean): Promise<Input> {
  const { context, page } = await fresh(env, [EVENT_TIMING])
  try {
    const url = env.server.origin + path(name, withLibrary)
    await page.goto(url, { waitUntil: 'load' })
    await sleep(500)
    const { result: timing, events } = await traced(env, page, async () => {
      for (let i = 0; i < 8; i++) {
        await page.click('#add')
        await sleep(150)
      }
      await page.click('#q')
      await page.keyboard.type('fox jumps', { delay: 100 })
      await page.mouse.move(400, 400)
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 300)
        await sleep(100)
      }
      for (let i = 0; i < 4; i++) {
        await page.mouse.click(300 + i * 20, 300)
        await sleep(150)
      }
      await sleep(400)
      return (await page.evaluate(() => {
        const m = (window as unknown as { __interactions: Map<number, number> }).__interactions
        return { inp: Math.max(0, ...m.values()), interactions: m.size }
      })) as { inp: number; interactions: number }
    })
    const thread = mainThread(events, url)
    const lib = library(events, thread, LIBRARY_URL)
    const perEvent: Record<string, number[]> = {}
    const pageClick: number[] = []
    for (const d of dispatches(events, thread, lib)) {
      if (['pointerdown', 'keydown', 'input', 'wheel'].includes(d.type)) (perEvent[d.type] ??= []).push(ms(d.library))
      if (d.type === 'click') pageClick.push(ms(d.end - d.start - d.library))
    }
    return { page: name, library: withLibrary, ...timing, perEvent, pageClick }
  } finally {
    await context.close()
  }
}

export type Churn = {
  library: boolean
  seconds: number
  /** Library time in the window, split into observer callbacks and timers. */
  observerCalls: number
  observerMs: number
  timerFires: number
  timerMs: number
  pageMs: number
}

/** The feed page's churn for `seconds`, starting two seconds after load (past the start-up reads). */
export async function churn(env: Env, withLibrary: boolean, seconds = 10): Promise<Churn> {
  const { context, page } = await fresh(env)
  try {
    const url = env.server.origin + path('feed', withLibrary)
    await page.goto(url, { waitUntil: 'load' })
    await sleep(2000)
    const { events } = await traced(env, page, () => sleep(seconds * 1000))
    const thread = mainThread(events, url)
    const lib = library(events, thread, LIBRARY_URL)
    const timers = new Set<(typeof lib.spans)[number]>()
    for (const e of events)
      if (e.name === 'TimerFire' && e.pid === thread.pid && e.tid === thread.tid && e.ph === 'X')
        for (const s of lib.spans) if (s.start >= e.ts && s.end <= e.ts + (e.dur ?? 0)) timers.add(s)
    const observer = lib.spans.filter((s) => !timers.has(s))
    const sum = (list: Iterable<{ self: number }>) => ms([...list].reduce((t, s) => t + s.self, 0))
    return {
      library: withLibrary,
      seconds,
      observerCalls: observer.length,
      observerMs: sum(observer),
      timerFires: timerFires(events, thread, lib),
      timerMs: sum(timers),
      pageMs: ms(scripting(events, thread)) - sum(lib.spans),
    }
  } finally {
    await context.close()
  }
}

export type Day = {
  library: boolean
  /** Heap after a collection at the start and after each simulated day. */
  heap: number[]
  listeners: number[]
  /** Interval callbacks run per simulated day, and DOM queries they made. */
  callbacks: number
  queries: number
}

/** Records every interval the page sets, so a simulated day can run each callback as often as it would
 * fire in 24 hours, synchronously, without waiting a day or faking the clock for the whole page. */
const RECORD_INTERVALS = `(() => {
  window.__intervals = []
  const set = window.setInterval
  window.setInterval = function (fn, ms, ...rest) { __intervals.push([fn, ms]); return set.call(this, fn, ms, ...rest) }
})()`

/** Four simulated days on an idle, visible page: each interval callback runs as often as it would fire in
 * 24 hours, then the heap (after a collection) and the document's listeners are read. The first days
 * include the JIT tiering up; growth from day three to day four is the steady state. */
export async function day(env: Env, withLibrary: boolean): Promise<Day> {
  const { context, page } = await fresh(env, [COUNT_QUERIES, RECORD_INTERVALS])
  try {
    await page.goto(env.server.origin + path('article', withLibrary), { waitUntil: 'load' })
    await sleep(5500) // past the later passes, which are one-shot timers
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const snapshot = async () => {
      await cdp.send('HeapProfiler.collectGarbage')
      const { usedSize } = await cdp.send('Runtime.getHeapUsage')
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' })
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! })
      return { heap: usedSize, listeners: listeners.length }
    }
    const simulate = () =>
      page.evaluate(() => {
        const w = window as unknown as { __intervals: [() => void, number][]; __queries: { n: number } }
        const q0 = w.__queries.n
        let callbacks = 0
        for (const [fn, every] of w.__intervals)
          for (let i = 0; i < Math.floor((24 * 3600 * 1000) / every); i++, callbacks++) fn()
        return { callbacks, queries: w.__queries.n - q0 }
      })
    const snapshots = [await snapshot()]
    let first: { callbacks: number; queries: number } | undefined
    for (let d = 0; d < 4; d++) {
      const run = await simulate()
      first ??= run
      snapshots.push(await snapshot())
    }
    return {
      library: withLibrary,
      heap: snapshots.map((s) => s.heap),
      listeners: snapshots.map((s) => s.listeners),
      ...first!,
    }
  } finally {
    await context.close()
  }
}

/** Start-up in the first document of a newly launched browser, where the renderer's first use of the
 * time zone database and other one-time costs fall on the library if it is first to need them. */
export async function cold(server: TestServer, rate: number): Promise<number | null> {
  const browser = await chromium.launch({ args: ARGS })
  try {
    const result = await load({ browser, server, rate }, 'article', true)
    return result.startup
  } finally {
    await browser.close()
  }
}
