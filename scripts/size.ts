// The page half's size, gzipped (plan 8.7): the standalone script, which holds
// everything a page loads. Fails when it grows past its budget.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const BUDGETS: Record<string, number> = { 'dist/botscent.js': 10_000 }
const dist = new URL('../dist/', import.meta.url)
const gz = (bytes: Buffer) => gzipSync(bytes, { level: 9 }).length
let over = 0
for (const [file, budget] of Object.entries(BUDGETS)) {
  const bytes = readFileSync(new URL(file.replace('dist/', ''), dist))
  const size = gz(bytes)
  console.log(`${file}: ${bytes.length} bytes, ${size} gzipped (budget ${budget})`)
  if (size > budget) over++
}
// The README states the script's size to the nearest whole KB of 1,024 bytes ("about 5 KB gzipped"); keep it true.
const script = gz(readFileSync(new URL('botscent.js', dist)))
const expected = String(Math.round(script / 1024))
const stated = /about (\d+) KB gzipped/.exec(readFileSync(new URL('../README.md', import.meta.url), 'utf8'))
if (stated?.[1] !== expected) {
  console.error(`README: say "about ${expected} KB gzipped" (the script is ${script} bytes)`)
  over++
}
if (over) process.exit(1)
