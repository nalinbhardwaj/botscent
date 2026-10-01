import node from '@astrojs/node'
import botscent from 'botscent/astro'
import { defineConfig } from 'astro/config'

// Both halves in one line. The example's tests run with no CDN in front, so the
// server half may send the request's verdict to the page.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [botscent({ transport: process.env.BOTSCENT_EXAMPLE_TRANSPORT === 'always' ? 'always' : 'never' })],
})
