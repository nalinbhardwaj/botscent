// botscent/next: the server half as a Next.js proxy (proxy.ts in Next 16,
// middleware.ts before it). It inspects each request and, on Vercel, where the
// proxy runs per request in front of the cache, carries an agent's verdict to
// the page in Server-Timing. Self-hosted, the proxy cannot see whether a CDN
// stores the HTML, so it sends the entry only when told to (transport: 'always').
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server.js'
import type { Debug } from '../server/log.ts'
import { transport } from '../server/adapter.ts'
import { inspect } from '../server/index.ts'
import { mutable, type TransportMode } from '../server/transport.ts'

export type { TransportMode } from '../server/transport.ts'

type Result = Response | NextResponse | null | undefined | void
export type NextProxy = (request: NextRequest, event: NextFetchEvent) => Result | Promise<Result>

export type BotscentNextOptions = {
  /** Whether an agent's document navigation carries the verdict to the page in Server-Timing.
   * 'auto' (the default): on Vercel only, where the proxy runs per request in front of the cache;
   * off when self-hosted, because the proxy cannot see a CDN in front of it. 'always': the
   * developer states that no shared cache stores the HTML. 'never': off. */
  transport?: TransportMode
  /** Log each decision: true for console.debug, or a function that receives each line. */
  debug?: Debug
}

const onVercel = (): boolean => {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VERCEL === '1'
  } catch {
    return false
  }
}

/** Wraps an existing proxy, or none: its response is kept, and only Server-Timing and, for agents,
 * Cache-Control change. `withBotscent(existing, options)`, or `withBotscent(options)` without one. */
export function withBotscent(existing?: NextProxy, options?: BotscentNextOptions): NextProxy
export function withBotscent(options: BotscentNextOptions): NextProxy
export function withBotscent(first?: NextProxy | BotscentNextOptions, second: BotscentNextOptions = {}): NextProxy {
  const existing = typeof first === 'function' ? first : undefined
  const options = typeof first === 'function' || first === undefined ? second : first
  return async (request, event) => {
    const response = (existing ? await existing(request, event) : undefined) ?? NextResponse.next()
    try {
      const verdict = await inspect(request, { debug: options.debug })
      const mode = options.transport ?? 'auto'
      const send = mode === 'always' || (mode === 'auto' && onVercel())
      const out = mutable(response)
      transport(out.headers, verdict, request, { send, debug: options.debug })
      return out
    } catch {
      return response
    }
  }
}

/** The proxy on its own, for apps that have none: `export { proxy } from 'botscent/next'` in
 * proxy.ts, or `export { proxy as middleware } from 'botscent/next'` in middleware.ts before
 * Next.js 16. */
export const proxy: NextProxy = withBotscent()
