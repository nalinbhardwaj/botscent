// The transport rules applied to a response (contract section 10), shared by
// every adapter that sees a Fetch Response: remove any inherited botscent entry,
// and on an agent navigation write one entry together with Cache-Control: no-store.
import type { Verdict } from '../core/verdict.ts'
import type { Log } from './log.ts'
import { hasOurEntry, scrubServerTiming, serverTimingEntry } from './timing.ts'

/** 'auto': send where the adapter knows it runs after the shared cache; 'always'; 'never'. */
export type TransportMode = 'auto' | 'always' | 'never'

export type TransportOutcome = 'decorated' | 'scrubbed' | 'untouched'

/** Applies the rules to headers in place; returns what it did. */
export function applyTransport(
  headers: Headers,
  verdict: Verdict,
  navigation: boolean,
  send: boolean,
  nowMs: number,
  log: Log = null,
): TransportOutcome {
  let outcome: TransportOutcome = 'untouched'
  let kept = headers.get('server-timing')
  if (hasOurEntry(kept)) {
    kept = scrubServerTiming(kept)
    if (kept === null) headers.delete('server-timing')
    else headers.set('server-timing', kept)
    outcome = 'scrubbed'
    log?.('transport: removed an inherited botscent entry')
  }
  if (send && navigation && verdict.type === 'agent') {
    const entry = serverTimingEntry(verdict, nowMs)
    if (entry) {
      headers.set('server-timing', kept ? `${kept}, ${entry}` : entry)
      headers.set('cache-control', 'no-store')
      log?.(`transport: wrote ${entry} with Cache-Control: no-store`)
      return 'decorated'
    }
  }
  if (outcome === 'untouched')
    log?.(
      `transport: nothing written (${!send ? 'transport off here' : !navigation ? 'not a document navigation' : 'no agent evidence'})`,
    )
  return outcome
}

/** The response with headers that can be changed: a copy when the original's are immutable. */
export function mutable(response: Response): Response {
  try {
    response.headers.set('x-botscent-probe', '1')
    response.headers.delete('x-botscent-probe')
    return response
  } catch {
    return new Response(response.body, response)
  }
}
