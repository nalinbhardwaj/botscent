// botscent/vercel: the server half as Vercel Routing Middleware, for projects
// that are not Next.js (Next.js uses botscent/next). In middleware.ts at the root:
//
//   export { default } from 'botscent/vercel'
//   // or: export default withBotscent(existingMiddleware)
//
// Routing Middleware runs per request in front of Vercel's cache, so the
// Server-Timing transport is on by default. Continuing is a response carrying
// x-middleware-next, whose other headers Vercel adds to the final response.
import type { Debug } from '../server/log.ts'
import { transport } from '../server/adapter.ts'
import { inspect } from '../server/index.ts'
import { mutable, type TransportMode } from '../server/transport.ts'

export type BotscentVercelOptions = {
  /** Whether an agent's document navigation carries the verdict to the page in Server-Timing.
   * 'auto' (the default) and 'always': on, because Routing Middleware runs per request in front of
   * Vercel's cache. 'never': off. */
  transport?: TransportMode
  /** Log each decision: true for console.debug, or a function that receives each line. */
  debug?: Debug
}
type Result = Response | null | undefined | void
export type VercelMiddleware = (request: Request, context?: unknown) => Result | Promise<Result>

const next = (): Response => new Response(null, { headers: { 'x-middleware-next': '1' } })

/** Wraps existing middleware, or none: `withBotscent(existing, options)`, or `withBotscent(options)`. */
export function withBotscent(existing?: VercelMiddleware, options?: BotscentVercelOptions): VercelMiddleware
export function withBotscent(options: BotscentVercelOptions): VercelMiddleware
export function withBotscent(
  first?: VercelMiddleware | BotscentVercelOptions,
  second: BotscentVercelOptions = {},
): VercelMiddleware {
  const existing = typeof first === 'function' ? first : undefined
  const options = typeof first === 'function' || first === undefined ? second : first
  return async (request, context) => {
    const response = (existing ? await existing(request, context) : undefined) ?? next()
    try {
      const verdict = await inspect(request, { debug: options.debug })
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

const middleware: VercelMiddleware = withBotscent()
export default middleware
