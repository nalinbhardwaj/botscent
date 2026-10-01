// botscent/hono: the server half as Hono middleware. The request verdict is
// c.get('botscent'). On Cloudflare Workers, where a Worker runs per request in
// front of any cache, the Server-Timing transport is on by default and Cloudflare's
// request.cf is read; elsewhere Hono is an origin that cannot see a CDN in front of
// it, so the transport is off unless turned on. A Worker that stores HTML with the
// Cache API should set transport: 'never'.
import type { MiddlewareHandler } from 'hono'
import type { Verdict } from '../core/verdict.ts'
import type { Debug } from '../server/log.ts'
import { applyTransport, inspect, type CloudflareHints } from '../server/index.ts'
import { mutable, type TransportMode } from '../server/transport.ts'

export { inspect, isVerified, readReport, combine, VERSION, type Verdict } from '../server/index.ts'

export type BotscentHonoOptions = { transport?: TransportMode; debug?: Debug }

const onWorkers = (): boolean => {
  try {
    return globalThis.navigator?.userAgent === 'Cloudflare-Workers'
  } catch {
    return false
  }
}

/** `app.use(botscent())`, then `c.get('botscent')`. */
export function botscent(options: BotscentHonoOptions = {}): MiddlewareHandler<{ Variables: { botscent: Verdict } }> {
  return async (c, next) => {
    const request = c.req.raw
    const cf = (request as Request & { cf?: CloudflareHints }).cf
    let verdict: Verdict | null = null
    try {
      verdict = await inspect(request, { cf, debug: options.debug })
      c.set('botscent', verdict)
    } catch {}
    await next()
    if (!verdict) return
    try {
      const mode = options.transport ?? 'auto'
      const send = mode === 'always' || (mode === 'auto' && onWorkers())
      const response = mutable(c.res)
      applyTransport(response.headers, verdict, request, { send, debug: options.debug })
      if (response !== c.res) {
        // Hono's c.res setter copies the previous response's headers onto a new one,
        // which would undo the change: clear it first so the copy is taken as it is.
        c.res = undefined
        c.res = response
      }
    } catch {}
  }
}
