// botscent/express: the server half as Express middleware (Express 4 and 5, and any
// Connect-style framework on Node's http). The request verdict goes on req.botscent.
// An origin cannot see whether a CDN in front of it stores HTML, so the Server-Timing
// transport is off unless the developer turns it on (transport: 'always'); inherited
// botscent entries are removed from every response either way.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Verdict } from '../core/verdict.ts'

export type { Verdict } from '../core/verdict.ts'
import type { Debug } from '../server/log.ts'
import { transport } from '../server/adapter.ts'
import { inspect } from '../server/index.ts'

export type BotscentExpressOptions = {
  /** Whether an agent's document navigation carries the verdict to the page in Server-Timing.
   * 'never' (the default): an origin cannot see whether a CDN in front of it stores HTML.
   * 'always': the developer states that no shared cache stores it. */
  transport?: 'always' | 'never'
  debug?: Debug
}

type Request = IncomingMessage & { botscent?: Verdict; originalUrl?: string }

// req.botscent on Express's own Request type, wherever @types/express is installed.
declare global {
  namespace Express {
    interface Request {
      /** The request half's verdict, set by botscent() before any handler runs. */
      botscent?: Verdict
    }
  }
}
type Next = (error?: unknown) => void

/** Express middleware: `app.use(botscent())`, then `req.botscent` in any handler. */
export function botscent(
  options: BotscentExpressOptions = {},
): (req: Request, res: ServerResponse, next: Next) => void {
  const send = options.transport === 'always'
  return (req, res, next) => {
    const request = { headers: req.headers, method: req.method, url: req.originalUrl ?? req.url }
    inspect(request, { debug: options.debug }).then(
      (verdict) => {
        req.botscent = verdict
        onHeaders(res, (given) => {
          // Server-Timing as set on res and as passed to writeHead; every other header is left as it is.
          const values: string[] = []
          const timing = res.getHeader('server-timing')
          if (timing !== undefined) values.push(...[timing].flat().map(String))
          const pairs = rawPairs(given)
          for (const [name, value] of pairs ?? Object.entries(given ?? {}))
            if (name.toLowerCase() === 'server-timing' && value !== undefined)
              values.push(...[value].flat().map(String))
          const headers = new Headers()
          if (values.length) headers.set('server-timing', values.join(', '))
          const outcome = transport(headers, verdict, request, { send, debug: options.debug })
          if (outcome === 'untouched') return given
          const value = headers.get('server-timing')
          const set: [string, string][] = []
          if (value !== null) set.push(['server-timing', value])
          if (outcome === 'decorated') set.push(['cache-control', 'no-store'])
          const owned = new Set(['server-timing', ...set.map(([name]) => name)])
          for (const name of owned) res.removeHeader(name)
          if (pairs) {
            const kept = pairs.filter(([name]) => !owned.has(name.toLowerCase()))
            return [...kept, ...set].flat()
          }
          if (!given) {
            for (const [name, v] of set) res.setHeader(name, v)
            return given
          }
          const kept = Object.fromEntries(Object.entries(given).filter(([name]) => !owned.has(name.toLowerCase())))
          return { ...kept, ...Object.fromEntries(set) }
        })
        next()
      },
      () => next(),
    )
  }
}

type HeadersArgument = Record<string, unknown> | unknown[] | undefined

/** writeHead's raw forms, [name, value, name, value, ...] or [[name, value], ...], as pairs;
 * null for an object. Node accepts the flat form back for either. */
function rawPairs(given: HeadersArgument): [string, unknown][] | null {
  if (!Array.isArray(given)) return null
  if (Array.isArray(given[0])) return (given as unknown[][]).map(([name, value]) => [String(name), value])
  const pairs: [string, unknown][] = []
  for (let i = 0; i + 1 < given.length; i += 2) pairs.push([String(given[i]), given[i + 1]])
  return pairs
}

/** Runs listener once, just before the response's headers are written, with the headers argument
 * of writeHead (if any); its result replaces that argument. Node itself merges the argument with
 * the headers already on res, with its own rules for repeated names, so nothing here copies
 * headers between the two. */
function onHeaders(res: ServerResponse, listener: (given: HeadersArgument) => HeadersArgument): void {
  const writeHead = res.writeHead
  let fired = false
  res.writeHead = function (this: ServerResponse, statusCode: number, ...rest: unknown[]) {
    if (!fired) {
      fired = true
      // writeHead(status, [message], [headers])
      const at = typeof rest[0] === 'string' ? 1 : 0
      const given = rest[at]
      try {
        const next = listener(given && typeof given === 'object' ? (given as HeadersArgument) : undefined)
        if (next !== given && next !== undefined) rest[at] = next
      } catch {}
    }
    return (writeHead as (...args: unknown[]) => ServerResponse).call(this, statusCode, ...rest)
  } as ServerResponse['writeHead']
}
