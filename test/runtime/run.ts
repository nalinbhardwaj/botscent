// Deno and Bun: deno run --allow-read test/runtime/run.ts ; bun test/runtime/run.ts
import { runVectors } from './vectors.ts'

const runtime =
  'Deno' in globalThis
    ? `deno ${(globalThis as any).Deno.version.deno}`
    : 'Bun' in globalThis
      ? `bun ${(globalThis as any).Bun.version}`
      : `node ${process.version}`
const { cases, failures } = await runVectors()
console.log(`${runtime}: ${cases - failures.length} of ${cases} request vectors agree`)
for (const f of failures) console.log(`  ${f}`)
if (failures.length) throw new Error('vectors failed')
