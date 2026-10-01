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

/** Calls listener after every change of the verdict, or of select(verdict) when a selector is given. */
export function subscribe<T = Verdict>(
  listener: (selected: T, verdict: Verdict) => void,
  select?: (verdict: Verdict) => T,
): () => void {
  const page = instance()
  if (!page) return () => {}
  const pick = select ?? ((v: Verdict) => v as T)
  let last = pick(page.verdict())
  return page.subscribe((v) => {
    const next = pick(v)
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
