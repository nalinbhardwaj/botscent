// botscent/express: the server half as Express middleware (Express 4 and 5, and any
// Connect-style framework on Node's http). The request verdict goes on req.botscent.
// An origin cannot see whether a CDN in front of it stores HTML, so the Server-Timing
// transport is off unless the developer turns it on (transport: 'always'); inherited
// botscent entries are removed from every response either way.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Verdict } from '../core/verdict.ts'
import type { Debug } from '../server/log.ts'
import { applyTransport, inspect } from '../server/index.ts'

export { inspect, isVerified, readReport, combine, VERSION, type Verdict } from '../server/index.ts'

export type BotscentExpressOptions = {
  /** 'always' when no shared cache stores this app's HTML; 'never' (the default here) otherwise. */
  transport?: 'always' | 'never'
  debug?: Debug
}

type Request = IncomingMessage & { botscent?: Verdict; originalUrl?: string }
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
        onHeaders(res, () => {
          const headers = new Headers()
          const timing = res.getHeader('server-timing')
          if (timing !== undefined)
            headers.set('server-timing', Array.isArray(timing) ? timing.join(', ') : String(timing))
          const outcome = applyTransport(headers, verdict, request, { send, debug: options.debug })
          if (outcome === 'untouched') return
          const value = headers.get('server-timing')
          if (value === null) res.removeHeader('server-timing')
          else res.setHeader('server-timing', value)
          if (outcome === 'decorated') res.setHeader('cache-control', 'no-store')
        })
        next()
      },
      () => next(),
    )
  }
}

/** Runs listener once, just before the response's headers are written, with every
 * header the application set (including those passed to writeHead) already on res. */
function onHeaders(res: ServerResponse, listener: () => void): void {
  const writeHead = res.writeHead
  let fired = false
  res.writeHead = function (this: ServerResponse, statusCode: number, ...rest: unknown[]) {
    if (!fired) {
      fired = true
      // writeHead(status, [message], [headers]): move the headers onto res first.
      const headers = typeof rest[0] === 'string' ? rest[1] : rest[0]
      if (headers && typeof headers === 'object') {
        if (Array.isArray(headers)) {
          for (let i = 0; i + 1 < headers.length; i += 2) this.setHeader(String(headers[i]), headers[i + 1] as string)
        } else
          for (const [name, value] of Object.entries(headers))
            if (value !== undefined) this.setHeader(name, value as string)
        rest = typeof rest[0] === 'string' ? [rest[0]] : []
      }
      try {
        listener()
      } catch {}
    }
    return (writeHead as (...args: unknown[]) => ServerResponse).call(this, statusCode, ...rest)
  } as ServerResponse['writeHead']
}
