// botscent/astro: both halves as one Astro integration.
//
//   import botscent from 'botscent/astro'
//   export default defineConfig({ integrations: [botscent()] })
//
// Every page loads the page half. On-demand rendered routes also run the server
// half as middleware: the verdict is Astro.locals.botscent. Astro's server output
// runs at the origin, which cannot see a CDN in front of it, so the Server-Timing
// transport is off unless set to 'always' here.
import type { AstroIntegration } from 'astro'
import type { Debug } from '../server/log.ts'

export type BotscentAstroOptions = { transport?: 'always' | 'never'; debug?: Debug }

const CONFIG = 'virtual:botscent/astro-config'

export default function botscent(options: BotscentAstroOptions = {}): AstroIntegration {
  return {
    name: 'botscent',
    hooks: {
      'astro:config:setup': ({ injectScript, addMiddleware, updateConfig }) => {
        injectScript('page', "import 'botscent/auto';")
        addMiddleware({ entrypoint: new URL('./astro-middleware.js', import.meta.url), order: 'pre' })
        // The middleware reads these options from a virtual module the app's Vite provides.
        const config = { transport: options.transport ?? 'never', debug: options.debug === true }
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'botscent-astro-config',
                resolveId: (id: string) => (id === CONFIG ? `\0${CONFIG}` : undefined),
                load: (id: string) => (id === `\0${CONFIG}` ? `export default ${JSON.stringify(config)}` : undefined),
              },
            ],
          },
        })
      },
    },
  }
}
