// The transport step every server adapter shares (contract section 10). Internal: not
// exported from botscent/server, so the navigation rule and the scrub rules can change
// without a major version.
import type { Verdict } from '../core/verdict.ts'
import { logger, type Debug } from './log.ts'
import { view, type RequestLike } from './request.ts'
import { isNavigation } from './timing.ts'
import { applyTransport, type TransportOutcome } from './transport.ts'

/** Removes any inherited botscent entry from the response's Server-Timing, and, when send
 * is true and the request is an agent's document navigation, writes the entry with
 * Cache-Control: no-store. */
export function transport(
  headers: Headers,
  verdict: Verdict,
  request: RequestLike,
  options: { send: boolean; now?: number; debug?: Debug },
): TransportOutcome {
  let navigation = false
  try {
    const req = view(request)
    navigation = isNavigation(req.header, req.method)
  } catch {}
  return applyTransport(headers, verdict, navigation, options.send, options.now ?? Date.now(), logger(options.debug))
}
