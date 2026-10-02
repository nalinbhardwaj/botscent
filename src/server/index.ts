// botscent/server: the server half.
import type { Verdict } from '../core/verdict.ts'
import { KEYS, SIGNERS, TOKENS } from '../generated/server.ts'
import { inspectWith, type InspectOptions } from './inspect.ts'
import type { RequestLike } from './request.ts'

export { combine, isVerified, type AgentName, type Reason, type Verdict } from '../core/verdict.ts'
export { readReport } from '../core/wire.ts'
export { VERSION } from '../generated/core.ts'
export type { CloudflareHints, InspectOptions } from './inspect.ts'
export type { RequestLike } from './request.ts'
export type { TransportMode } from './transport.ts'

/** What this request itself declared: its signatures, its user agent and the
 * platform's verified-bot field. Reads no body and no page report; never throws. */
export function inspect(request: RequestLike, options?: InspectOptions): Promise<Verdict> {
  return inspectWith({ signers: SIGNERS, keys: KEYS, tokens: TOKENS }, request, options)
}
