// The server half around a Cloudflare Worker's fetch handler. A Worker runs per
// request in front of any cache, so the request's verdict reaches the page in
// Server-Timing by default (transport: 'never' if the Worker stores HTML with the Cache API).
import { withBotscent } from 'botscent/workers'

export default {
  // The handler gets the request's verdict as a fourth argument. The stale botscent
  // entry stands in for one a cache might replay; the wrapper removes it.
  fetch: withBotscent(async (request, _env, _ctx, verdict) => {
    const bytes = (await request.arrayBuffer()).byteLength
    return Response.json(
      { verdict, bytes },
      { headers: { 'Server-Timing': 'botscent;desc="1;chatgpt;1;signer.web-bot-auth.verified", app;dur=1' } },
    )
  }),
}
