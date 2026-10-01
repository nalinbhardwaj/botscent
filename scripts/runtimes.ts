// The request vectors on Cloudflare's runtime (workerd, through Miniflare): bundles
// test/runtime/worker.ts and asks it to run every vector. Deno and Bun run
// test/runtime/run.ts directly.
import { Miniflare } from 'miniflare'
import { build } from 'tsdown'

const root = new URL('../', import.meta.url).pathname
await build({
  entry: { worker: `${root}test/runtime/worker.ts` },
  outDir: `${root}.size/runtime`,
  format: 'esm',
  platform: 'neutral',
  dts: false,
  logLevel: 'silent',
  config: false,
})
const mf = new Miniflare({
  modules: true,
  scriptPath: `${root}.size/runtime/worker.js`,
  compatibilityDate: '2026-07-01',
})
try {
  const response = await mf.dispatchFetch('https://example.com/')
  const { cases, failures } = (await response.json()) as { cases: number; failures: string[] }
  console.log(`workerd: ${cases - failures.length} of ${cases} request vectors agree`)
  for (const f of failures) console.log(`  ${f}`)
  if (failures.length) process.exitCode = 1
} finally {
  await mf.dispose()
}
