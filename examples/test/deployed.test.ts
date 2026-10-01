// The deployed checks (plan 4.4), against real platforms. Each target comes from the
// environment, and what is not set is skipped:
//   BOTSCENT_DEPLOYED_SERVER        a deployed server example's origin (it answers /verdict), transport on
//   BOTSCENT_DEPLOYED_PAGES         page URLs behind an adapter that decorates after the cache lookup
//   BOTSCENT_DEPLOYED_CACHED_PAGES  page URLs behind a cache in front of the adapter (Workers Cache)
// Comma-separated where there are several. Every page must also pass the packed `botscent check`.
//   BOTSCENT_DEPLOYED_PAGES=https://… node --test examples/test/deployed.test.ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { AGENT_UA, navigation, serverChecks } from './conformance.ts'

const list = (name: string) =>
  (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const server = process.env['BOTSCENT_DEPLOYED_SERVER']
const examples = new URL('../', import.meta.url).pathname

async function ask(url: string, ua: string) {
  const r = await fetch(url, { headers: navigation(ua) })
  await r.body?.cancel()
  const m = /botscent;desc="([^"]*)"/.exec(r.headers.get('server-timing') ?? '')
  return { entry: m?.[1] ?? null, cacheControl: r.headers.get('cache-control'), all: r.headers.get('server-timing') }
}
const fresh = (entry: string | null) => {
  const m = /^1;chatgpt-user;(\d+);ua\.declared-agent-token$/.exec(entry ?? '')
  return !!m && Math.abs(Number(m[1]) - Date.now()) < 60_000
}

/** The packed bin, as `npx botscent check` runs it. */
function check(url: string): Promise<{ exit: number; checks: { id: string; outcome: string }[] }> {
  return new Promise((resolve, reject) =>
    execFile(
      `${examples}next/node_modules/.bin/botscent`,
      ['check', url, '--json'],
      { timeout: 90_000 },
      (error, stdout, stderr) => {
        try {
          resolve({ exit: error ? (error.code as number) : 0, ...JSON.parse(stdout) })
        } catch {
          reject(new Error(`no JSON from check: ${stderr || stdout}`))
        }
      },
    ),
  )
}

describe('a deployed server example', { skip: !server && 'BOTSCENT_DEPLOYED_SERVER is not set' }, () => {
  serverChecks(() => (init) => fetch(`${server}/verdict`, init), {
    transport: true,
    authority: server ? new URL(server).host : '',
  })
})

for (const url of list('BOTSCENT_DEPLOYED_PAGES'))
  describe(`decorated after the cache lookup: ${url}`, () => {
    test('every agent navigation gets its own fresh entry and no-store, cache hits included; a person none', async () => {
      const first = await ask(url, AGENT_UA)
      await new Promise((r) => setTimeout(r, 1100))
      const second = await ask(url, AGENT_UA)
      const person = await ask(url, '')
      for (const r of [first, second]) {
        assert.ok(fresh(r.entry), `entry ${r.entry}`)
        assert.equal(r.cacheControl, 'no-store')
      }
      assert.notEqual(first.entry, second.entry, 'a new entry for each request')
      assert.equal(person.entry, null, `a person received ${person.all}`)
    })
    test('npx botscent check: installed, every check passing or skipped', async () => {
      const r = await check(url)
      assert.deepEqual(
        r.checks.filter((c) => c.outcome !== 'pass' && c.outcome !== 'skipped'),
        [],
      )
      assert.equal(r.exit, 0)
    })
  })

for (const url of list('BOTSCENT_DEPLOYED_CACHED_PAGES'))
  describe(`behind a cache in front of the adapter: ${url}`, () => {
    test("an agent gets a fresh entry or none, never another visitor's; a person never gets one", async () => {
      for (let i = 0; i < 3; i++) {
        const agent = await ask(url, AGENT_UA)
        assert.ok(agent.entry === null || fresh(agent.entry), `entry ${agent.entry}`)
        const person = await ask(url, '')
        assert.equal(person.entry, null, `a person received ${person.all}`)
      }
    })
    test('npx botscent check: installed, and nothing fails', async () => {
      const r = await check(url)
      assert.deepEqual(
        r.checks.filter((c) => c.outcome === 'fail'),
        [],
      )
      assert.equal(r.exit, 0)
    })
  })
