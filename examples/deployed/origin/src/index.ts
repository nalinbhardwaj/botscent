// An origin for the plan-4.4 deployment tests, meant to sit behind another cache
// (CloudFront, nginx). Paths ending in always/ force the transport on, as an origin
// adapter with transport 'always'; paths ending in never/ are an origin adapter's
// default. Both pages ask shared caches to keep them for a minute.
import { withBotscent } from 'botscent/workers'

const page = (label: string) =>
  `<!doctype html><meta charset="utf-8"><title>${label}</title><script defer src="/botscent.js"></script><p>${label}`

const serve = (label: string) => async () =>
  new Response(page(label), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=60' },
  })
const always = withBotscent(serve('always'), { transport: 'always' })
const never = withBotscent(serve('never'), { transport: 'never' })

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } }

export default {
  fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/always/')) return always(request, env, ctx)
    if (path.endsWith('/never/')) return never(request, env, ctx)
    return env.ASSETS.fetch(request)
  },
}
