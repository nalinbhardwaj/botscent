// The server half as Astro middleware, added by botscent/astro.
import config from 'virtual:botscent/astro-config'
import type { Verdict } from '../core/verdict.ts'
import { transport } from '../server/adapter.ts'
import { inspect } from '../server/index.ts'
import { mutable } from '../server/transport.ts'

type Context = { request: Request; isPrerendered?: boolean; locals: Record<string, unknown> }

export async function onRequest(context: Context, next: () => Promise<Response>): Promise<Response> {
  // A prerendered page is built once, with no visitor's request to inspect.
  if (context.isPrerendered) return next()
  let verdict: Verdict | null = null
  try {
    verdict = await inspect(context.request, { debug: config.debug })
    context.locals.botscent = verdict
  } catch {}
  const response = await next()
  if (!verdict) return response
  try {
    const out = mutable(response)
    transport(out.headers, verdict, context.request, { send: config.transport === 'always', debug: config.debug })
    return out
  } catch {
    return response
  }
}
