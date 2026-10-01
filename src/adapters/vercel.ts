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
import { applyTransport, inspect } from '../server/index.ts'
import { mutable, type TransportMode } from '../server/transport.ts'

export { inspect, isVerified, readReport, combine, VERSION, type Verdict } from '../server/index.ts'

export type BotscentVercelOptions = { transport?: TransportMode; debug?: Debug }
type Result = Response | null | undefined | void
export type VercelMiddleware = (request: Request, context?: unknown) => Result | Promise<Result>

const next = (): Response => new Response(null, { headers: { 'x-middleware-next': '1' } })

export function withBotscent(existing?: VercelMiddleware, options: BotscentVercelOptions = {}): VercelMiddleware {
  return async (request, context) => {
    const response = (existing ? await existing(request, context) : undefined) ?? next()
    try {
      const verdict = await inspect(request, { debug: options.debug })
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

const middleware: VercelMiddleware = withBotscent()
export default middleware
