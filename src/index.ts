// botscent: the page half. Importing it does nothing; start() begins observation.
import { HUMAN, type Verdict } from './core/verdict.ts'
import { reportHeaders } from './page/carriers.ts'
import { instance, type Diagnostics, type StartOptions } from './page/instance.ts'

export { isVerified, type Reason, type Verdict } from './core/verdict.ts'
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

/** Calls listener after every change of the verdict; with a selector first, after every change
 * of select(verdict), compared with Object.is. Not called on subscription. Returns unsubscribe.
 * The selector comes first so that TypeScript infers the selected type for the listener. */
export function subscribe(listener: (verdict: Verdict) => void): () => void
export function subscribe<T>(
  select: (verdict: Verdict) => T,
  listener: (selected: T, verdict: Verdict) => void,
): () => void
export function subscribe<T>(
  first: ((verdict: Verdict) => void) | ((verdict: Verdict) => T),
  second?: (selected: T, verdict: Verdict) => void,
): () => void {
  const page = instance()
  if (!page) return () => {}
  const select = second ? (first as (verdict: Verdict) => T) : (v: Verdict) => v as T
  const listener = second ?? (first as (selected: T, verdict: Verdict) => void)
  let last = select(page.verdict())
  return page.subscribe((v) => {
    const next = select(v)
    if (Object.is(next, last)) return
    last = next
    listener(next, v)
  })
}

/** One Botscent-Report header for a same-origin request once agent evidence has been observed; {} otherwise. */
export function headers(url: string | URL): Record<string, string> {
  return instance() ? reportHeaders(verdict(), url) : {}
}

/** Lifecycle, probe and transport status; never observed values. */
export function diagnostics(): Diagnostics {
  return (
    instance()?.diagnostics() ?? { version: '', started: false, startedAt: null, probes: {}, transport: 'unsupported' }
  )
}
