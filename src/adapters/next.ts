// botscent/next: the server half as a Next.js proxy (proxy.ts in Next 16,
// middleware.ts before it). It inspects each request and, on Vercel, where the
// proxy runs per request in front of the cache, carries an agent's verdict to
// the page in Server-Timing. Self-hosted, the proxy cannot see whether a CDN
// stores the HTML, so it sends the entry only when told to (transport: 'always').
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server.js'
import type { Debug } from '../server/log.ts'
import { applyTransport, inspect } from '../server/index.ts'
import { mutable, type TransportMode } from '../server/transport.ts'

export type { TransportMode } from '../server/transport.ts'
export { inspect, isVerified, readReport, combine, VERSION, type Verdict } from '../server/index.ts'

type Result = Response | NextResponse | null | undefined | void
export type NextProxy = (request: NextRequest, event: NextFetchEvent) => Result | Promise<Result>

export type BotscentNextOptions = {
  /** Where the page gets the request's verdict: 'auto' (on Vercel only), 'always', or 'never'. */
  transport?: TransportMode
  debug?: Debug
}

const onVercel = (): boolean => {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VERCEL === '1'
  } catch {
    return false
  }
}

/** Wraps an existing proxy (or none): its response is kept, and only Server-Timing and, for agents, Cache-Control change. */
export function withBotscent(existing?: NextProxy, options: BotscentNextOptions = {}): NextProxy {
  return async (request, event) => {
    const response = (existing ? await existing(request, event) : undefined) ?? NextResponse.next()
    try {
      const verdict = await inspect(request, { debug: options.debug })
      const mode = options.transport ?? 'auto'
      const send = mode === 'always' || (mode === 'auto' && onVercel())
      const out = mutable(response)
      applyTransport(out.headers, verdict, request, { send, debug: options.debug })
      return out
    } catch {
      return response
    }
  }
}

/** The proxy on its own, for apps that have none: `export { proxy } from 'botscent/next'`. */
export const proxy: NextProxy = withBotscent()
/** The same, under the name Next.js used before version 16. */
export const middleware: NextProxy = proxy
