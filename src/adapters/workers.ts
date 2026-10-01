// botscent/workers: the server half around a Cloudflare Worker's fetch handler.
//
//   export default { fetch: withBotscent((request, env, ctx, verdict) => ...) }
//
// The handler receives the request's verdict as a fourth argument. A Worker runs per
// request in front of any cache, so the Server-Timing transport is on by default. With
// Workers Cache in front of the Worker it stays safe: a decorated response carries
// no-store, which that cache honours (measured: BYPASS), so a cached page reaches an
// agent without an entry rather than with another visitor's.
import type { Verdict } from '../core/verdict.ts'
import type { Debug } from '../server/log.ts'
import { applyTransport, inspect, type CloudflareHints } from '../server/index.ts'
import { mutable, type TransportMode } from '../server/transport.ts'

export { inspect, isVerified, readReport, combine, VERSION, type Verdict } from '../server/index.ts'

export type BotscentWorkersOptions = { transport?: TransportMode; debug?: Debug }
type Context = { waitUntil(promise: Promise<unknown>): void; passThroughOnException?(): void }
export type FetchWithVerdict<Env> = (
  request: Request,
  env: Env,
  ctx: Context,
  verdict: Verdict,
) => Response | Promise<Response>

export function withBotscent<Env = unknown>(
  handler: FetchWithVerdict<Env>,
  options: BotscentWorkersOptions = {},
): (request: Request, env: Env, ctx: Context) => Promise<Response> {
  return async (request, env, ctx) => {
    const cf = (request as Request & { cf?: CloudflareHints }).cf
    const verdict = await inspect(request, { cf, debug: options.debug })
    const response = await handler(request, env, ctx, verdict)
    try {
      const out = mutable(response)
      applyTransport(out.headers, verdict, request, {
        send: (options.transport ?? 'auto') !== 'never',
        debug: options.debug,
      })
      return out
    } catch {
      return response
    }
  }
}
