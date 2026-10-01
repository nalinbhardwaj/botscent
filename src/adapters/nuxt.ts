// botscent/nuxt: the page half as a Nuxt module (Nuxt 3 and 4).
//
//   export default defineNuxtConfig({ modules: ['botscent/nuxt'] })
//
// A client-only plugin starts observation, and botscent/vue's useBotscent() is
// available in components without an import. Server routes call inspect() from
// botscent/server with event.node.req, as an Express handler would; on Vercel or
// Cloudflare, botscent/vercel or botscent/workers in front of the app carries the
// request's verdict to the page. The module is a plain function rather than
// @nuxt/kit's defineNuxtModule, so the package keeps no dependencies.

export type BotscentNuxtOptions = { debug?: boolean }

type Nuxt = {
  options: { buildDir: string; plugins: unknown[]; build: { templates: unknown[] } }
  hook(name: 'imports:extend', fn: (imports: { name: string; from: string }[]) => void): void
}

const PLUGIN = 'botscent.client.mjs'

export default function botscent(options: BotscentNuxtOptions, nuxt: Nuxt): void {
  // The plugin is generated so that the options are part of the build, not of every page's payload.
  const settings = JSON.stringify({ debug: options?.debug === true })
  nuxt.options.build.templates.push({
    filename: PLUGIN,
    getContents: () =>
      `import { start } from 'botscent'\nexport default function botscent() {\n  start(${settings})\n}\n`,
  })
  // Nuxt keeps its paths with forward slashes on every platform.
  nuxt.options.plugins.unshift({ src: `${nuxt.options.buildDir}/${PLUGIN}`, mode: 'client' })
  nuxt.hook('imports:extend', (imports) => {
    imports.push({ name: 'useBotscent', from: 'botscent/vue' })
  })
}
