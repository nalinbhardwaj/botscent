// The page half's performance, measured (plan 8.7): start-up, work per input,
// idle activity, DOM churn, a day left open, and Core Web Vitals, each against
// the same page without the library. Prints a table, checks test/perf/budgets.json
// and exits 1 when a gated budget is exceeded.
//
//   npm run perf                      measure, print, check
//   npm run perf -- --json out.json   also write every sample
//   npm run perf -- --quick           fewer runs, for trying a change (still checks)
//   npm run perf -- --no-engines      skip the Firefox and WebKit record
//
// Run `npm run build` first: it measures dist/botscent.js.
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch } from 'node:os'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
import { serve } from '../browser/server.ts'
import { ARGS, calibrate, churn, cold, day, input, load, type Churn, type Input, type Load } from './chromium.ts'
import { engineStartup } from './engines.ts'
import { idle } from './idle.ts'
import { PAGES, routePages, type PageName } from './pages.ts'

type Budget = { max?: number; min?: number; equals?: number; target?: number; gate?: boolean; why: string }
type Budgets = {
  reference: { machine: string; calibrationMs: number; rate: number }
  budgets: Record<string, Budget>
}
type Row = { id: string; label: string; unit: string; without?: string; value: number; spread?: string; note?: string }

const argv = process.argv.slice(2)
const quick = argv.includes('--quick')
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : undefined
const engines = !argv.includes('--no-engines')
const N = quick
  ? { loads: 5, inputs: 2, churn: 1, cold: 2, engines: 5 }
  : { loads: 11, inputs: 5, churn: 2, cold: 5, engines: 9 }

const budgets = JSON.parse(readFileSync(new URL('./budgets.json', import.meta.url), 'utf8')) as Budgets

// Statistics: medians, with the interquartile range as the spread.
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)
const quantile = (xs: number[], q: number) => {
  const s = sorted(xs)
  if (!s.length) return NaN
  const i = (s.length - 1) * q
  return s[Math.floor(i)]! + (s[Math.ceil(i)]! - s[Math.floor(i)]!) * (i - Math.floor(i))
}
const median = (xs: number[]) => quantile(xs, 0.5)
const iqr = (xs: number[], digits = 2) => `${quantile(xs, 0.25).toFixed(digits)}–${quantile(xs, 0.75).toFixed(digits)}`
const log = (line: string) => process.stderr.write(`${line}\n`)

const server = await serve()
routePages(server)
const rows: Row[] = []
const samples: Record<string, unknown> = {}
const started = Date.now()
let version = ''

try {
  // Calibration: the throttling rate that makes this machine the reference machine at its rate.
  log('calibrating')
  const calibration = await calibrate(server, quick ? 5 : 9)
  const calibrationMs = median(calibration)
  const rate = Math.min(20, Math.max(1, (budgets.reference.rate * budgets.reference.calibrationMs) / calibrationMs))
  samples.calibration = calibration
  rows.push({
    id: 'calibration.ms',
    label: 'calibration workload, unthrottled',
    unit: 'ms',
    value: calibrationMs,
    spread: iqr(calibration),
    note: `reference ${budgets.reference.calibrationMs} ms; CPU throttled ${rate.toFixed(2)}x`,
  })

  const browser = await chromium.launch({ args: ARGS })
  version = browser.version()
  const env = { browser, server, rate }
  try {
    // Page loads: start-up attribution, paint and layout, requests. Interleaved, alternating which goes first.
    log(`page loads (${N.loads} per page and variant)`)
    await load(env, 'article', true) // warm the browser's processes
    const loads: Load[] = []
    for (let i = 0; i < N.loads; i++)
      for (const page of PAGES)
        for (const lib of i % 2 ? [true, false] : [false, true]) loads.push(await load(env, page, lib))
    samples.loads = loads
    for (const page of PAGES) {
      const w = loads.filter((l) => l.page === page && l.library)
      const wo = loads.filter((l) => l.page === page && !l.library)
      const startup = w.map((l) => l.startup!)
      rows.push({
        id: `startup.${page}.ms`,
        label: `${page}: start-up (script + start())`,
        unit: 'ms',
        value: median(startup),
        spread: iqr(startup),
      })
      const first = w.map((l) => l.firstSecond!)
      rows.push({
        id: `firstSecond.${page}.ms`,
        label: `${page}: library time in the next second`,
        unit: 'ms',
        value: median(first),
        spread: iqr(first),
      })
      const task = w.map((l) => l.task!)
      rows.push({
        id: `startup.${page}.task`,
        label: `${page}: the task that runs it`,
        unit: 'ms',
        value: median(task),
        spread: iqr(task, 1),
      })
      rows.push({
        id: `startup.${page}.longTasks`,
        label: `${page}: loads where the library makes a long task`,
        unit: 'loads',
        value: w.filter((l) => l.induced).length,
        note: `of ${w.length}; long tasks per load ${median(wo.map((l) => l.longTasks))} without, ${median(w.map((l) => l.longTasks))} with`,
      })
      for (const metric of ['lcp', 'fcp'] as const) {
        const a = wo.map((l) => l[metric]!)
        const b = w.map((l) => l[metric]!)
        rows.push({
          id: `${metric}.${page}.added`,
          label: `${page}: ${metric.toUpperCase()} added`,
          unit: 'ms',
          without: `${median(a).toFixed(0)} → ${median(b).toFixed(0)}`,
          value: median(b) - median(a),
          spread: `${iqr(a, 0)} / ${iqr(b, 0)}`,
        })
      }
      rows.push({
        id: `cls.${page}.added`,
        label: `${page}: CLS added (worst load)`,
        unit: '',
        without: `${Math.max(...wo.map((l) => l.cls))}`,
        value: Math.max(...w.map((l) => l.cls)) - Math.max(...wo.map((l) => l.cls)),
      })
    }
    const art = loads.filter((l) => l.page === 'article')
    const mutations =
      new Set(art.filter((l) => l.library).map((l) => l.mutations)).size === 1 &&
      new Set(art.filter((l) => !l.library).map((l) => l.mutations)).size === 1
    rows.push({
      id: 'dom.article.writes',
      label: 'article: DOM changes added, less the script element',
      unit: 'nodes',
      value: mutations ? art.find((l) => l.library)!.mutations - art.find((l) => !l.library)!.mutations - 1 : NaN,
      note: mutations ? 'every load identical' : 'counts varied between loads',
    })
    const extra = loads
      .filter((l) => l.library)
      .flatMap((l) => l.requests.filter((r) => !/^\/(article|feed|botscent\.js|hero\.svg)$/.test(r)))
    rows.push({
      id: 'network.requests',
      label: 'requests the library made (all loads)',
      unit: '',
      value: extra.length,
      note: extra.slice(0, 3).join(' '),
    })
    const blocking = new Set(loads.filter((l) => l.library).map((l) => l.renderBlocking))
    rows.push({
      id: 'render.blocking',
      label: 'script tag render-blocking',
      unit: 'loads',
      value: loads.filter((l) => l.library && l.renderBlocking !== 'non_blocking').length,
      note: [...blocking].join(' '),
    })

    // Input: a scripted visit per run.
    log(`input (${N.inputs} visits per page and variant)`)
    const inputs: Input[] = []
    for (let i = 0; i < N.inputs; i++)
      for (const page of PAGES)
        for (const lib of i % 2 ? [true, false] : [false, true]) inputs.push(await input(env, page, lib))
    samples.inputs = inputs
    for (const page of PAGES) {
      const w = inputs.filter((x) => x.page === page && x.library)
      const wo = inputs.filter((x) => x.page === page && !x.library)
      const per = w.flatMap((x) => Object.values(x.perEvent).flat())
      rows.push({
        id: `input.${page}.median`,
        label: `${page}: library time per trusted input`,
        unit: 'ms',
        value: median(per),
        spread: iqr(per, 3),
        note: `${per.length} events`,
      })
      rows.push({
        id: `input.${page}.p95`,
        label: `${page}: same, 95th percentile`,
        unit: 'ms',
        value: quantile(per, 0.95),
        note: `max ${Math.max(...per).toFixed(2)}`,
      })
      const clicks = w.flatMap((x) => x.pageClick)
      rows.push({
        id: `input.${page}.pageClick`,
        label: `${page}: the page's own click handling, for scale`,
        unit: 'ms',
        value: median(clicks),
        spread: iqr(clicks),
      })
      const a = wo.map((x) => x.inp)
      const b = w.map((x) => x.inp)
      rows.push({
        id: `inp.${page}.added`,
        label: `${page}: INP added`,
        unit: 'ms',
        without: `${median(a)} → ${median(b)}`,
        value: median(b) - median(a),
        spread: `${iqr(a, 0)} / ${iqr(b, 0)}`,
      })
    }

    // DOM churn on the feed page.
    log(`DOM churn (${N.churn} × 10 s per variant)`)
    const churns: Churn[] = []
    for (let i = 0; i < N.churn; i++) for (const lib of [false, true]) churns.push(await churn(env, lib, 10))
    samples.churn = churns
    const cw = churns.filter((c) => c.library)
    const perSecond = (f: (c: Churn) => number) => median(cw.map((c) => f(c) / c.seconds))
    rows.push({
      id: 'churn.ms',
      label: 'feed churn: library time per second',
      unit: 'ms/s',
      value: perSecond((c) => c.observerMs + c.timerMs),
      spread: iqr(cw.map((c) => (c.observerMs + c.timerMs) / c.seconds)),
    })
    rows.push({
      id: 'churn.observer',
      label: 'feed churn: observer callbacks per second',
      unit: '/s',
      value: perSecond((c) => c.observerCalls),
      note: `${perSecond((c) => c.observerMs).toFixed(2)} ms/s`,
    })
    rows.push({
      id: 'churn.timers',
      label: 'feed churn: timer runs per second (debounce 250 ms)',
      unit: '/s',
      value: perSecond((c) => c.timerFires),
      note: `${median(cw.map((c) => c.timerMs / Math.max(1, c.timerFires))).toFixed(3)} ms each`,
    })
    rows.push({
      id: 'churn.pageMs',
      label: "feed churn: the page's own script time per second, for scale",
      unit: 'ms/s',
      without: `${median(churns.filter((c) => !c.library).map((c) => c.pageMs / c.seconds)).toFixed(2)} →`,
      value: perSecond((c) => c.pageMs),
    })

    // A day left open.
    log('a simulated day')
    const days = [await day(env, false), await day(env, true)]
    samples.days = days
    const [d0, d1] = days as [(typeof days)[0], (typeof days)[0]]
    rows.push({
      id: 'day.callbacks',
      label: 'idle day: interval callbacks',
      unit: '',
      value: d1.callbacks,
      note: `${d1.queries} DOM queries`,
    })
    rows.push({
      id: 'day.retained',
      label: 'heap the library holds at rest',
      unit: 'KB',
      value: (d1.heap[0]! - d0.heap[0]!) / 1024,
    })
    rows.push({
      id: 'day.firstDays',
      label: 'idle days 1–2: heap growth added',
      unit: 'KB',
      value: (d1.heap[2]! - d1.heap[0]! - (d0.heap[2]! - d0.heap[0]!)) / 1024,
    })
    rows.push({
      id: 'day.steady',
      label: 'idle day 4: heap growth added',
      unit: 'KB',
      value: (d1.heap[4]! - d1.heap[3]! - (d0.heap[4]! - d0.heap[3]!)) / 1024,
    })
    rows.push({
      id: 'day.listeners',
      label: 'idle days: listeners added or lost',
      unit: '',
      value: Math.max(...d1.listeners) - Math.min(...d1.listeners),
      note: `${d1.listeners[0]} on document`,
    })
  } finally {
    await browser.close()
  }

  // Idle, visible then hidden, over raw CDP.
  log('idle: 30 s visible, 30 s hidden')
  const still = await idle(server, rate, 30)
  samples.idle = still
  for (const phase of ['visible', 'hidden'] as const) {
    const p = still[phase]
    rows.push({
      id: `idle.${phase}.timers`,
      label: `idle ${phase} 30 s: timer callbacks`,
      unit: '',
      value: p.timerFires,
      note: `${p.visibility}; ${p.otherCalls} other callbacks`,
    })
    rows.push({
      id: `idle.${phase}.ms`,
      label: `idle ${phase} 30 s: library time`,
      unit: 'ms',
      value: p.libraryMs,
      note: `slowest callback ${Math.max(0, ...p.calls).toFixed(3)}`,
    })
    rows.push({
      id: `idle.${phase}.perCall`,
      label: `idle ${phase}: library time per callback (median)`,
      unit: 'ms',
      value: median(p.calls),
      spread: iqr(p.calls, 3),
    })
    rows.push({ id: `idle.${phase}.queries`, label: `idle ${phase} 30 s: DOM queries`, unit: '', value: p.queries })
  }
  rows.push({
    id: 'idle.requests',
    label: 'idle 60 s: requests after load',
    unit: '',
    value: still.requests.filter((r) => !/^\/(article|botscent\.js|hero\.svg)$/.test(r)).length,
  })
  rows.push({
    id: 'idle.storage',
    label: 'storage written (local, session, cookie, IndexedDB, Cache)',
    unit: '',
    value: still.storage.reduce((a, b) => a + b, 0),
  })

  log(`cold start (${N.cold} browser launches)`)
  const colds: number[] = []
  for (let i = 0; i < N.cold; i++) colds.push((await cold(server, rate))!)
  samples.cold = colds
  rows.push({
    id: 'startup.cold.ms',
    label: "article: start-up, a new browser's first document",
    unit: 'ms',
    value: median(colds),
    spread: iqr(colds),
  })

  if (engines) {
    log(`engines (${N.engines} loads each, unthrottled)`)
    const e = await engineStartup(server, N.engines)
    samples.engines = e
    for (const [name, xs] of Object.entries(e))
      rows.push({
        id: `engine.${name}.ms`,
        label: `${name}: start-up, unthrottled (record only)`,
        unit: 'ms',
        value: median(xs),
        spread: iqr(xs, 1),
      })
  }
  const gz = gzipSync(readFileSync(new URL('../../dist/botscent.js', import.meta.url)), { level: 9 }).length
  rows.push({ id: 'size.gzip', label: 'dist/botscent.js gzipped (gated by scripts/size.ts)', unit: 'B', value: gz })
} finally {
  await server.close()
}

// Budgets.
type Checked = Row & { budget: string; target: string; ok: boolean | null; met: boolean | null }
const fmt = (n: number) =>
  Number.isInteger(n)
    ? String(n)
    : Math.abs(n) >= 100
      ? n.toFixed(0)
      : Math.abs(n) >= 10
        ? n.toFixed(1)
        : n.toFixed(Math.abs(n) >= 1 ? 2 : 3)
const within = (value: number, b: { max?: number; min?: number; equals?: number }) =>
  !Number.isNaN(value) &&
  (b.max === undefined || value <= b.max) &&
  (b.min === undefined || value >= b.min) &&
  (b.equals === undefined || value === b.equals)
const checked: Checked[] = rows.map((row) => {
  const b = budgets.budgets[row.id]
  const limit = b
    ? b.equals !== undefined
      ? `= ${b.equals}`
      : [b.min !== undefined ? `≥ ${b.min}` : '', b.max !== undefined ? `≤ ${b.max}` : ''].filter(Boolean).join(' ')
    : ''
  return {
    ...row,
    budget: b && b.gate !== false ? limit : b ? `(${limit})` : '',
    target: b?.target !== undefined ? `≤ ${b.target}` : '',
    ok: b && b.gate !== false ? within(row.value, b) : null,
    met: b?.target !== undefined ? within(row.value, { max: b.target }) : null,
  }
})
const missing = Object.keys(budgets.budgets).filter(
  (id) => !rows.some((r) => r.id === id) && !(id.startsWith('engine.') && !engines),
)

const header = ['metric', 'unit', 'without → with', 'value', 'spread (IQR)', 'budget', 'ok', 'plan target', 'note']
const table = checked.map((r) => [
  r.label,
  r.unit,
  r.without ?? '',
  fmt(r.value),
  r.spread ?? '',
  r.budget,
  r.ok === null ? '' : r.ok ? 'ok' : 'OVER',
  r.target ? `${r.target} ${r.met ? 'met' : 'not met'}` : '',
  r.note ?? '',
])
const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i]!.length)))
const line = (cells: string[]) =>
  cells
    .map((c, i) => c.padEnd(widths[i]!))
    .join('  ')
    .trimEnd()
const machine = `${cpus()[0]?.model ?? 'unknown CPU'}, ${platform()} ${arch()}, ${cpus().length} cores; Chromium ${version}`
console.log(`\nbotscent page half, measured (${machine}; ${((Date.now() - started) / 1000).toFixed(0)} s)\n`)
console.log(line(header))
console.log(widths.map((w) => '-'.repeat(w)).join('  '))
for (const r of table) console.log(line(r))
const over = checked.filter((r) => r.ok === false)
const unmet = checked.filter((r) => r.met === false)
console.log('')
for (const id of missing) console.log(`budget ${id} has no measurement`)
for (const r of unmet)
  console.log(
    `plan target not met: ${r.label}: ${fmt(r.value)} ${r.unit} (target ${r.target}); ${budgets.budgets[r.id]!.why}`,
  )
for (const r of over) console.log(`OVER BUDGET: ${r.label}: ${fmt(r.value)} ${r.unit}, budget ${r.budget}`)
console.log(over.length || missing.length ? `\n${over.length + missing.length} budget(s) failed` : '\nall budgets met')

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ machine, quick, rows: checked, samples }, null, 2))
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `### botscent page half, measured`,
    '',
    machine,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...table.map((r) => `| ${r.map((c) => c.replaceAll('|', '\\|')).join(' | ')} |`),
    '',
  ].join('\n')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
}
process.exit(over.length || missing.length ? 1 : 0)
