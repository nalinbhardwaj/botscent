// The one running instance per page (contract section 11): the evidence held
// so far, the current snapshot, subscribers, diagnostics and debug output.
// Published at globalThis[Symbol.for('botscent')] so that a second copy of the
// library on the page uses it rather than starting its own.
import { decide, HUMAN, type Evidence, type Verdict } from '../core/verdict.ts'
import { VERSION } from '../generated/core.ts'
import { installFormField } from './carriers.ts'
import { observe, type ProbeStatus } from './observe.ts'
import { evidenceOf } from './rules.ts'
import { readTransport } from './transport.ts'

export type Diagnostics = {
  version: string
  started: boolean
  startedAt: number | null
  probes: Record<string, ProbeStatus>
  transport: 'pending' | 'received' | 'absent' | 'unsupported' | 'rejected'
}

export type StartOptions = { debug?: boolean | undefined }

/** The surface copies of the library share; kept small so that versions interoperate. */
export type Instance = {
  version: string
  verdict(): Verdict
  subscribe(listener: (verdict: Verdict) => void): () => void
  diagnostics(): Diagnostics
  start(options?: StartOptions): () => void
}

const KEY = Symbol.for('botscent')

/** The page's instance, created on first use; null where there is no document (server rendering). */
export function instance(): Instance | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  const g = globalThis as { [KEY]?: Instance }
  return (g[KEY] ??= create())
}

const sameReasons = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((r, i) => r === b[i])

function create(): Instance {
  const held = new Set<string>()
  let declaredName: string | undefined
  let transported: Evidence[] = []
  let snapshot: Verdict = HUMAN
  let stopObserving: (() => void) | null = null
  let log: ((line: string) => void) | null = null
  const listeners = new Set<(verdict: Verdict) => void>()
  const diag: Diagnostics = { version: VERSION, started: false, startedAt: null, probes: {}, transport: 'pending' }
  const ms = () => Math.round(performance.now())

  function recompute() {
    const evidence = [...transported, ...evidenceOf(held, declaredName)]
    const next = decide(evidence)
    if (
      next.type === snapshot.type &&
      next.agent_name === snapshot.agent_name &&
      sameReasons(next.reasons, snapshot.reasons)
    )
      return
    // Keep the previous reasons array when only the name changed, so selectors on reasons stay stable.
    snapshot = sameReasons(next.reasons, snapshot.reasons)
      ? Object.freeze({ ...next, reasons: snapshot.reasons })
      : next
    log?.(
      `verdict ${snapshot.type} ${snapshot.agent_name ?? '(unnamed)'} [${snapshot.reasons.join(', ')}] at ${ms()} ms`,
    )
    for (const listener of [...listeners])
      try {
        listener(snapshot)
      } catch {}
    try {
      window.dispatchEvent(new CustomEvent('botscent', { detail: snapshot }))
    } catch {}
  }

  function start(options: StartOptions = {}): () => void {
    if (options.debug && !log) log = (line) => console.debug(`[botscent] ${line}`)
    if (stopObserving) return stop
    diag.started = true
    diag.startedAt = ms()
    log?.(`started ${VERSION} at ${diag.startedAt} ms`)
    try {
      const t = readTransport()
      diag.transport = t.status
      transported = t.evidence
      log?.(`transport ${t.status}: ${t.note}`)
    } catch {
      diag.transport = 'unsupported'
    }
    const stopForm = installFormField(() => snapshot)
    let stopObserve: () => void = () => {}
    try {
      stopObserve = observe({
        hold(reason) {
          if (held.has(reason)) return
          held.add(reason)
          log?.(`held ${reason} at ${ms()} ms`)
          recompute()
        },
        declare(name) {
          declaredName ??= name
        },
        status(probe, status) {
          if (status !== 'ok' && diag.probes[probe] !== status) log?.(`probe ${probe}: ${status}`)
          diag.probes[probe] = status
        },
      })
    } catch {
      diag.probes.observe = 'failed'
    }
    stopObserving = () => {
      stopObserve()
      stopForm()
    }
    recompute()
    return stop
  }

  function stop() {
    stopObserving?.()
    stopObserving = null
    diag.started = false
    log?.('stopped; evidence kept')
  }

  return {
    version: VERSION,
    verdict: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    diagnostics: () => ({ ...diag, probes: { ...diag.probes } }),
    start,
  }
}
