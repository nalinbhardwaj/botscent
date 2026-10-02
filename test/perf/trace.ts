// Reading a Chrome trace: which main-thread time belongs to the library. Time is
// attributed by script URL: the library's EvaluateScript (compile, run and the
// synchronous start()) and every FunctionCall into its code (timers, observer
// callbacks, listeners), minus any call back into another script from inside it
// (a page listener for the botscent event, say).

export type TraceEvent = {
  name: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  cat?: string
  args?: { name?: string; data?: Record<string, any>; fileName?: string }
}

type Span = { start: number; end: number; event: TraceEvent }

export type Library = {
  /** Every top-level stretch of library work on the main thread, in microseconds since the trace began. */
  spans: { start: number; end: number; self: number; kind: string }[]
}

/** Parses Playwright's or CDP's trace output. */
export function parse(buffer: Buffer | string | TraceEvent[]): TraceEvent[] {
  if (Array.isArray(buffer)) return buffer
  const json = JSON.parse(String(buffer))
  return Array.isArray(json) ? json : json.traceEvents
}

/** The renderer main thread that ran the page at `url` (its EvaluateScript or ParseHTML names it). */
export function mainThread(events: TraceEvent[], url: string): { pid: number; tid: number } {
  const hit = events.find(
    (e) =>
      (e.name === 'ParseHTML' && String(e.args?.data?.url ?? e.args?.['beginData' as 'data']?.url).startsWith(url)) ||
      (e.name === 'EvaluateScript' && String(e.args?.data?.url).startsWith(url)) ||
      (e.name === 'ResourceSendRequest' && String(e.args?.data?.url).startsWith(url)),
  )
  if (hit && hit.name !== 'ResourceSendRequest') return { pid: hit.pid, tid: hit.tid }
  const main = events.find(
    (e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain' && (!hit || e.pid === hit.pid),
  )
  if (!main) throw new Error(`no renderer main thread for ${url}`)
  return { pid: main.pid, tid: main.tid }
}

const scriptUrl = (e: TraceEvent): string => String(e.args?.data?.url ?? e.args?.fileName ?? '')

/** Complete events on one thread, with begin/end pairs folded into spans. */
function spans(events: TraceEvent[], thread: { pid: number; tid: number }, names: Set<string>): Span[] {
  const out: Span[] = []
  const open = new Map<string, TraceEvent[]>()
  for (const e of events) {
    if (e.pid !== thread.pid || e.tid !== thread.tid || !names.has(e.name)) continue
    if (e.ph === 'X') out.push({ start: e.ts, end: e.ts + (e.dur ?? 0), event: e })
    else if (e.ph === 'B') (open.get(e.name) ?? open.set(e.name, []).get(e.name)!).push(e)
    else if (e.ph === 'E') {
      const b = open.get(e.name)?.pop()
      if (b) out.push({ start: b.ts, end: e.ts, event: { ...b, args: { ...b.args, ...e.args } } })
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end)
}

/** The library's main-thread work: each outermost library EvaluateScript or FunctionCall, with its self
 * time (minus calls into other scripts nested inside it). */
export function library(events: TraceEvent[], thread: { pid: number; tid: number }, match: string): Library {
  const all = spans(events, thread, new Set(['EvaluateScript', 'FunctionCall']))
  const out: Library['spans'] = []
  let current: { start: number; end: number; self: number; kind: string } | null = null
  for (const s of all) {
    if (current && s.start >= current.start && s.end <= current.end) {
      // Nested: a call into another script from inside the library's span is not the library's time.
      if (!scriptUrl(s.event).includes(match)) current.self -= s.end - s.start
      continue
    }
    if (!scriptUrl(s.event).includes(match)) continue
    current = { start: s.start, end: s.end, self: s.end - s.start, kind: s.event.name }
    out.push(current)
  }
  return { spans: out }
}

/** All script time on the thread: every outermost EvaluateScript or FunctionCall, whoever's. Subtract the
 * library's self time to get the page's own. */
export function scripting(events: TraceEvent[], thread: { pid: number; tid: number }): number {
  let total = 0
  let end = -Infinity
  for (const s of spans(events, thread, new Set(['EvaluateScript', 'FunctionCall']))) {
    if (s.start < end) continue
    end = s.end
    total += s.end - s.start
  }
  return total
}

/** Top-level tasks on the thread (RunTask), for long-task attribution. */
export function tasks(events: TraceEvent[], thread: { pid: number; tid: number }): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let end = -Infinity
  for (const s of spans(events, thread, new Set(['RunTask', 'ThreadControllerImpl::RunTask']))) {
    if (s.start < end) continue
    end = s.end
    out.push({ start: s.start, end: s.end })
  }
  return out
}

/** Event dispatches on the thread, by type, each with the library's time inside it. */
export function dispatches(
  events: TraceEvent[],
  thread: { pid: number; tid: number },
  lib: Library,
): { type: string; start: number; end: number; library: number }[] {
  const out: { type: string; start: number; end: number; library: number }[] = []
  let end = -Infinity
  for (const s of spans(events, thread, new Set(['EventDispatch']))) {
    if (s.start < end) continue // nested dispatches belong to the outer one
    end = s.end
    const inside = lib.spans.filter((l) => l.start >= s.start && l.end <= s.end)
    out.push({
      type: String(s.event.args?.data?.type),
      start: s.start,
      end: s.end,
      library: inside.reduce((t, l) => t + l.self, 0),
    })
  }
  return out
}

/** Timer callbacks into the library: each TimerFire whose callback is library code. */
export function timerFires(events: TraceEvent[], thread: { pid: number; tid: number }, lib: Library): number {
  let n = 0
  for (const s of spans(events, thread, new Set(['TimerFire'])))
    if (lib.spans.some((l) => l.start >= s.start && l.end <= s.end)) n++
  return n
}
