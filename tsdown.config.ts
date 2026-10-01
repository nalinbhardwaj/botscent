import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      auto: 'src/auto.ts',
      server: 'src/server/index.ts',
      next: 'src/adapters/next.ts',
      react: 'src/adapters/react.ts',
    },
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    dts: true,
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
