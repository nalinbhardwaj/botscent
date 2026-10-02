// The server half on Netlify Edge Functions, with the Workers adapter as it is: an edge
// function, like a Worker, runs per request in front of Netlify's cache.
import { withBotscent } from 'botscent/workers'
import type { Context } from '@netlify/edge-functions'

const run = withBotscent<Context>((_request, context) => context.next())

const AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'

export default (request: Request, context: Context) => {
  // Test only: /as-agent/ lets a real browser (Safari, Samsung Internet) see an agent's entry.
  if (new URL(request.url).pathname.startsWith('/as-agent/')) {
    const headers = new Headers(request.headers)
    headers.set('user-agent', AGENT)
    request = new Request(request, { headers })
  }
  return run(request, context, { waitUntil: (p: Promise<unknown>) => context.waitUntil(p) })
}
