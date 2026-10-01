// botscent/server: the server half.
import type { Verdict } from '../core/verdict.ts'
import { KEYS, SIGNERS, TOKENS } from '../generated/server.ts'
import { inspectWith, type InspectOptions } from './inspect.ts'
import { logger, type Debug } from './log.ts'
import { view, type RequestLike } from './request.ts'
import { isNavigation as navigation } from './timing.ts'
import { applyTransport as apply, type TransportOutcome } from './transport.ts'

export { combine, isVerified, type Reason, type Verdict } from '../core/verdict.ts'
export { readReport } from '../core/wire.ts'
export { VERSION } from '../generated/core.ts'
export type { CloudflareHints, InspectOptions } from './inspect.ts'
export type { RequestLike } from './request.ts'
export type { TransportMode, TransportOutcome } from './transport.ts'

/** What this request itself declared: its signatures, its user agent and the
 * platform's verified-bot field. Reads no body and no page report; never throws. */
export function inspect(request: RequestLike, options?: InspectOptions): Promise<Verdict> {
  return inspectWith({ signers: SIGNERS, keys: KEYS, tokens: TOKENS }, request, options)
}

/** Whether a request is a document navigation (Sec-Fetch-Dest: document, or a GET that accepts HTML). */
export function isNavigation(request: RequestLike): boolean {
  try {
    const req = view(request)
    return navigation(req.header, req.method)
  } catch {
    return false
  }
}

/** The transport step for adapters (contract section 10): removes any inherited botscent
 * entry from the response's Server-Timing, and, when send is true and the request is an
 * agent's document navigation, writes the entry with Cache-Control: no-store. */
export function applyTransport(
  headers: Headers,
  verdict: Verdict,
  request: RequestLike,
  options: { send: boolean; now?: number; debug?: Debug },
): TransportOutcome {
  return apply(headers, verdict, isNavigation(request), options.send, options.now ?? Date.now(), logger(options.debug))
}
