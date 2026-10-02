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

export type { Verdict } from '../core/verdict.ts'
import type { Debug } from '../server/log.ts'
import { transport } from '../server/adapter.ts'
import { inspect, type CloudflareHints } from '../server/index.ts'
import { mutable, type TransportMode } from '../server/transport.ts'

export type BotscentWorkersOptions = {
  /** Whether an agent's document navigation carries the verdict to the page in Server-Timing.
   * 'auto' (the default) and 'always': on, because a Worker (or a Netlify Edge Function) runs per
   * request in front of the cache. 'never': off; use it when the Worker itself stores HTML with
   * the Cache API. */
  transport?: TransportMode
  /** Log each decision: true for console.debug, or a function that receives each line. */
  debug?: Debug
}
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
      transport(out.headers, verdict, request, {
        send: (options.transport ?? 'auto') !== 'never',
        debug: options.debug,
      })
      return out
    } catch {
      return response
    }
  }
}
