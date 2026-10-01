import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      auto: 'src/auto.ts',
      server: 'src/server/index.ts',
      next: 'src/adapters/next.ts',
      react: 'src/adapters/react.ts',
      vue: 'src/adapters/vue.ts',
      svelte: 'src/adapters/svelte.ts',
      express: 'src/adapters/express.ts',
      hono: 'src/adapters/hono.ts',
      workers: 'src/adapters/workers.ts',
      vercel: 'src/adapters/vercel.ts',
      astro: 'src/adapters/astro.ts',
      'astro-middleware': 'src/adapters/astro-middleware.ts',
      nuxt: 'src/adapters/nuxt.ts',
    },
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    dts: true,
    // Resolved by the application's Vite build (botscent/astro).
    deps: { neverBundle: [/^virtual:botscent\//] },
  },
  {
    // npx botscent check <url>: Node only, never imported by an application.
    entry: { cli: 'src/check/cli.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    outputOptions: { entryFileNames: '[name].js' },
    clean: false,
  },
  {
    // The standalone script for <script defer src="/botscent.js">.
    entry: { botscent: 'src/script.ts' },
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    dts: false,
    outputOptions: { entryFileNames: '[name].js' },
    clean: false,
  },
])
