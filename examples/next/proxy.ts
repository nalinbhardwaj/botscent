// The server half. Self-hosted, the proxy sends the request's verdict to the page only when told
// that no shared cache stores the HTML; the example's tests run without one.
import { withBotscent } from 'botscent/next'

export const proxy = withBotscent({
  transport: process.env.BOTSCENT_EXAMPLE_TRANSPORT === 'always' ? 'always' : 'auto',
  debug: process.env.BOTSCENT_DEBUG === '1',
})
