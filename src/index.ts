// botscent: the page half. Importing it does nothing; start() begins observation.
import { HUMAN, type Verdict } from './core/verdict.ts'
import { reportHeaders as carrier } from './page/carriers.ts'
import { instance, type Diagnostics, type StartOptions } from './page/instance.ts'

export type { AgentName, Reason, Verdict } from './core/verdict.ts'
export { VERSION } from './generated/core.ts'
export type { Diagnostics, StartOptions } from './page/instance.ts'

/** Begins observing this document. Idempotent, across copies of the library too; returns stop. */
export function start(options?: StartOptions): () => void {
  return instance()?.start(options) ?? (() => {})
}

/** The current verdict: whether agent evidence has been observed in this document. */
export function verdict(): Verdict {
  return instance()?.verdict() ?? HUMAN
}

/** Calls listener after every change of the verdict, never on subscription. Returns unsubscribe. */
export function subscribe(listener: (verdict: Verdict) => void): () => void {
  return instance()?.subscribe(listener) ?? (() => {})
}

/** { 'Botscent-Report': entry } for a request to this page's own origin once agent evidence has
 * been observed; {} otherwise. Spread it into a fetch's headers. */
export function reportHeaders(url: string | URL): Record<string, string> {
  return instance() ? carrier(verdict(), url) : {}
}

/** Lifecycle, probe and transport status; never observed values. */
export function diagnostics(): Diagnostics {
  return (
    instance()?.diagnostics() ?? { version: '', started: false, startedAt: null, probes: {}, transport: 'unsupported' }
  )
}
