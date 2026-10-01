// The server half on Hono, deployed as a Cloudflare Worker. On Workers the request's
// verdict reaches the page in Server-Timing by default; on an origin it does not.
import { Hono } from 'hono'
import { botscent } from 'botscent/hono'

// Chained, so that c.get('botscent') is typed.
const app = new Hono().use(botscent())

// The stale botscent entry stands in for one a cache might replay; the middleware
// removes it from every response.
app.all('/verdict', async (c) => {
  const bytes = (await c.req.arrayBuffer()).byteLength
  c.header('Server-Timing', 'botscent;desc="1;chatgpt;1;signer.web-bot-auth.verified", app;dur=1')
  return c.json({ verdict: c.get('botscent'), bytes })
})

export default app
