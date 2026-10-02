// Idle activity, visible and hidden. Playwright keeps every page visible, so this
// drives Chromium over the raw DevTools protocol (as test/browser/cdp.ts does):
// two tabs in one window, and activating the second hides the first.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { TestServer } from '../browser/server.ts'
import { CATEGORIES, LIBRARY_URL } from './chromium.ts'
import { COUNT_QUERIES, path } from './pages.ts'
import { library, mainThread, timerFires, type TraceEvent } from './trace.ts'

export type Phase = {
  seconds: number
  visibility: string
  /** Library callbacks in the phase: timers, and anything else (observer or promise callbacks). */
  timerFires: number
  otherCalls: number
  libraryMs: number
  /** Each callback's time, in order. The first callback after a page is hidden can include a garbage
   * collection the browser schedules for backgrounded pages, so the median is the steady cost. */
  calls: number[]
  /** DOM queries made in the phase (the article page makes none of its own while idle). */
  queries: number
}

export type Idle = { visible: Phase; hidden: Phase; requests: string[]; storage: number[] }

type Message = {
  id?: number
  method?: string
  params?: any
  sessionId?: string
  result?: any
  error?: { message: string }
}

function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms)
    }),
  ])
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Visible for `seconds` from navigation, then hidden for `seconds`. */
export async function idle(server: TestServer, rate: number, seconds = 30): Promise<Idle> {
  const profile = mkdtempSync(join(tmpdir(), 'botscent-perf-'))
  const args = [
    '--headless=new',
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]
  if (process.platform === 'linux') args.unshift('--no-sandbox')
  const chrome = spawn(chromium.executablePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    let stderr = ''
    const ws = await within(
      15_000,
      'Chromium to start',
      new Promise<string>((resolve, reject) => {
        chrome.stderr!.on('data', (d) => {
          stderr += String(d)
          const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d))
          if (m) resolve(m[1]!)
        })
        chrome.on('exit', (code) => reject(new Error(`chromium exited (${code}): ${stderr.slice(-500)}`)))
      }),
    )
    const socket = new WebSocket(ws)
    await within(10_000, 'the DevTools socket', new Promise((resolve) => socket.addEventListener('open', resolve)))
    let next = 0
    const pending = new Map<number, (m: Message) => void>()
    const listeners: ((m: Message) => void)[] = []
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(String(event.data)) as Message
      if (m.id !== undefined) {
        pending.get(m.id)?.(m)
        pending.delete(m.id)
      } else for (const l of listeners) l(m)
    })
    const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
      within(
        30_000,
        method,
        new Promise((resolve, reject) => {
          const id = ++next
          pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
          socket.send(JSON.stringify({ id, method, params, sessionId }))
        }),
      )
    const once = (method: string, sessionId?: string) =>
      new Promise<Message>((resolve) => {
        const l = (m: Message) => {
          if (m.method === method && (sessionId === undefined || m.sessionId === sessionId)) {
            listeners.splice(listeners.indexOf(l), 1)
            resolve(m)
          }
        }
        listeners.push(l)
      })

    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: false })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const evaluate = async <T>(expression: string): Promise<T> =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result
        .value as T
    const requests: string[] = []
    listeners.push((m) => {
      if (m.method === 'Network.requestWillBeSent' && m.sessionId === sessionId)
        requests.push(String(m.params.request.url).replace(server.origin, ''))
    })
    await send('Page.enable', {}, sessionId)
    await send('Network.enable', {}, sessionId)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_QUERIES }, sessionId)
    await send('Emulation.setCPUThrottlingRate', { rate }, sessionId)

    const events: TraceEvent[] = []
    listeners.push((m) => {
      if (m.method === 'Tracing.dataCollected') events.push(...m.params.value)
    })
    await send('Tracing.start', { traceConfig: { includedCategories: CATEGORIES }, transferMode: 'ReportEvents' })

    const url = server.origin + path('article', true)
    const loaded = once('Page.loadEventFired', sessionId)
    const t0 = Date.now()
    await send('Page.navigate', { url }, sessionId)
    await within(15_000, 'the load event', loaded)
    const atLoad = await evaluate<number>('__queries.n') // start() has run: the script is deferred
    await sleep(seconds * 1000 - (Date.now() - t0))
    const visible = {
      visibility: await evaluate<string>('document.visibilityState'),
      queries: (await evaluate<number>('__queries.n')) - atLoad,
    }
    await evaluate(`console.timeStamp('botscent-perf-hidden')`)

    const other = await send('Target.createTarget', { url: 'about:blank', newWindow: false })
    await send('Target.activateTarget', { targetId: other.targetId })
    await sleep(500)
    const hiddenVisibility = await evaluate<string>('document.visibilityState')
    const q0 = await evaluate<number>('__queries.n')
    await evaluate(`console.timeStamp('botscent-perf-hidden-start')`)
    await sleep(seconds * 1000)
    const q1 = await evaluate<number>('__queries.n')
    const stillHidden = await evaluate<string>('document.visibilityState')
    const storage = await evaluate<number[]>(`(async () => [
      localStorage.length, sessionStorage.length, document.cookie.length,
      (await indexedDB.databases()).length, (await caches.keys()).length])()`)

    const complete = once('Tracing.tracingComplete')
    await send('Tracing.end')
    await within(30_000, 'the trace', complete)
    socket.close()

    const thread = mainThread(events, url)
    const lib = library(events, thread, LIBRARY_URL)
    const mark = (name: string) =>
      events.find((e) => e.name === 'TimeStamp' && e.args?.data?.message === name)?.ts ??
      (() => {
        throw new Error(`no ${name} mark in the trace`)
      })()
    const boundary = mark('botscent-perf-hidden')
    const hiddenStart = mark('botscent-perf-hidden-start')
    const last = Math.max(
      ...events.filter((e) => e.pid === thread.pid && e.tid === thread.tid).map((e) => e.ts + (e.dur ?? 0)),
    )
    const phase = (from: number, to: number, visibility: string, queries: number): Phase => {
      const spans = lib.spans.filter((s) => s.start >= from && s.start < to)
      const timers = timerFires(
        events.filter((e) => e.ts >= from && e.ts < to),
        thread,
        { spans },
      )
      return {
        seconds: (Math.min(to, last) - from) / 1e6,
        visibility,
        timerFires: timers,
        otherCalls: spans.filter((s) => s.kind === 'FunctionCall').length - timers,
        libraryMs: spans.reduce((t, s) => t + s.self, 0) / 1000,
        calls: spans.map((s) => s.self / 1000),
        queries,
      }
    }
    const started = lib.spans.find((s) => s.kind === 'EvaluateScript')
    if (!started) throw new Error('the library did not run')
    return {
      // From the end of start-up: the later passes, the slow sample, and nothing else.
      visible: phase(started.end, boundary, visible.visibility, visible.queries),
      hidden: phase(hiddenStart, Infinity, stillHidden === hiddenVisibility ? hiddenVisibility : 'changed', q1 - q0),
      requests,
      storage,
    }
  } finally {
    chrome.kill()
    await new Promise((resolve) => (chrome.exitCode !== null ? resolve(null) : chrome.once('exit', resolve)))
    rmSync(profile, { recursive: true, force: true })
  }
}
