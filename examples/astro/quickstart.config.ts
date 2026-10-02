// The quickstart exactly as the README gives it, type-checked against the packed package.
import { defineConfig } from 'astro/config'
import botscent from 'botscent/astro'

export default defineConfig({
  integrations: [botscent()],
})
