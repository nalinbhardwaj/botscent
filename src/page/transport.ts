// Server to page: the botscent entry in the navigation's Server-Timing (contract section 10).
import type { Evidence } from '../core/verdict.ts'
import { decode } from '../core/wire.ts'

/** The window, in milliseconds around the page's navigation start, for an entry's server time. */
export const FRESH_BEFORE_MS = 10_000
export const FRESH_AFTER_MS = 120_000

export type Transport =
  | { status: 'received'; evidence: Evidence[]; note: string }
  | { status: 'absent' | 'unsupported' | 'rejected'; evidence: []; note: string }

export function readTransport(): Transport {
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  if (!nav || !Array.isArray(nav.serverTiming)) return { status: 'unsupported', evidence: [], note: '' }
  const ours = nav.serverTiming.filter((e) => e.name === 'botscent')
  if (ours.length === 0) return { status: 'absent', evidence: [], note: '' }
  if (ours.length > 1) return { status: 'rejected', evidence: [], note: `${ours.length} entries` }
  const entry = decode(ours[0]!.description)
  if (!entry || entry.time === undefined) return { status: 'rejected', evidence: [], note: 'malformed' }
  const offset = entry.time - performance.timeOrigin
  if (offset < -FRESH_BEFORE_MS || offset > FRESH_AFTER_MS)
    return {
      status: 'rejected',
      evidence: [],
      note: `stale ${Math.round(offset)} ms`,
    }
  const name = entry.name
  const evidence: Evidence[] = entry.reasons.map((reason) =>
    name ? { reason, name, source: 'declaration' } : { reason },
  )
  return {
    status: 'received',
    evidence,
    note: `${name ?? '(unnamed)'} [${entry.reasons}], server time ${offset < 0 ? '' : '+'}${Math.round(offset)} ms from navigation start`,
  }
}
