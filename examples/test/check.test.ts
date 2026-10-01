// npx botscent check, as the packed package installs it, against running examples:
// a Next.js install with the transport on passes everything; the same app behind a
// cache that stores every response fails the person check; a page-only Nuxt app is
// installed, with the server half unknown rather than failed.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { sharedCache } from './cache.ts'

const examples = new URL('../', import.meta.url).pathname
const servers: ChildProcess[] = []
const closers: (() => Promise<void>)[] = []

async function start(dir: string, command: string, args: string[], port: number, env: Record<string, string> = {}) {
  const origin = `http://localhost:${port}`
  if (
    await fetch(origin).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`${origin} is already in use`)
  servers.push(
    spawn(command, args, {
      cwd: `${examples}${dir}`,
      env: { ...process.env, PORT: String(port), ...env },
      stdio: 'ignore',
      detached: true,
    }),
  )
  for (let i = 0; ; i++) {
    if (
      await fetch(origin).then(
        () => true,
        () => false,
      )
    )
      return origin
    if (i > 120) throw new Error(`${dir} did not start`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

type Result = { exit: number; checks: { id: string; outcome: string; observed: string }[] }
/** Runs the installed bin, as `npx botscent check` would, and reads its JSON. */
function check(dir: string, ...args: string[]): Promise<Result> {
  return new Promise((resolve, reject) =>
    execFile(
      `${examples}${dir}/node_modules/.bin/botscent`,
      ['check', ...args, '--json'],
      { cwd: `${examples}${dir}`, timeout: 60_000 },
      (error, stdout, stderr) => {
        try {
          const out = JSON.parse(stdout)
          resolve({ exit: error ? (error.code as number) : 0, checks: out.checks })
        } catch {
          reject(new Error(`no JSON from check: ${stderr || stdout}`))
        }
      },
    ),
  )
}
const outcome = (r: Result, id: string) => r.checks.find((c) => c.id === id)!.outcome

let next: string
let nuxt: string
before(async () => {
  ;[next, nuxt] = await Promise.all([
    start('next', `${examples}next/node_modules/.bin/next`, ['start', '-p', '3106'], 3106, {
      BOTSCENT_EXAMPLE_TRANSPORT: 'always',
    }),
    start('nuxt', process.execPath, ['.output/server/index.mjs'], 3206, { HOST: '127.0.0.1' }),
  ])
})
after(async () => {
  for (const close of closers) await close()
  for (const s of servers)
    try {
      process.kill(-s.pid!, 'SIGTERM')
    } catch {}
})

test('Next.js with the transport on: installed, every check passes', async () => {
  const r = await check('next', `${next}/`)
  const failing = r.checks.filter((c) => c.outcome !== 'pass' && c.outcome !== 'skipped')
  assert.deepEqual(failing, [])
  for (const id of [
    'server-half',
    'entry',
    'no-store',
    'person',
    'page-script',
    'page-verdict',
    'transport',
    'adapters',
  ])
    assert.equal(outcome(r, id), 'pass', id)
  assert.equal(r.exit, 0)
})

test('behind a cache that stores every response, the person check fails and the install is broken', async () => {
  const cdn = await sharedCache(next, { storeEverything: true })
  closers.push(cdn.close)
  const r = await check('next', `${cdn.origin}/`, '--no-browser')
  assert.equal(outcome(r, 'person'), 'fail')
  assert.match(r.checks.find((c) => c.id === 'person')!.observed, /received botscent;desc="1;botscent-check;/)
  assert.equal(r.exit, 1)
})

test('a page-only Nuxt app: installed; the server half is unknown, not failed', async () => {
  const r = await check('nuxt', `${nuxt}/`)
  assert.equal(outcome(r, 'server-half'), 'unknown')
  assert.equal(outcome(r, 'page-script'), 'pass')
  assert.equal(outcome(r, 'page-verdict'), 'pass')
  assert.equal(outcome(r, 'adapters'), 'pass')
  assert.equal(r.exit, 0)
})
