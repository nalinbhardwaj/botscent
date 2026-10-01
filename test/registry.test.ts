import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
const { reasons } = read('registry/reasons.json') as { reasons: { id: string; half: string; names: string | null }[] }
const { names } = read('registry/names.json') as { names: Record<string, { display: string; kind: string }> }
const { signers } = read('registry/signers.json') as { signers: Record<string, string> }
const { tokens } = read('registry/tokens.json') as { tokens: { token: string; name: string }[] }
const page = read('registry/page.json') as {
  user_agent_prefixes: Record<string, string>
  platforms: Record<string, string>
}
const keys = read('registry/keys.json') as {
  directories: Record<string, { kty: string; crv: string; x: string; kid?: string }[]>
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const KINDS = ['computer-use-agent', 'fetcher', 'crawler', 'previewer', 'automation', 'client']

test('reason ids are unique and fit the wire grammar', () => {
  const ids = reasons.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const r of reasons) {
    assert.match(r.id, /^[a-z0-9._-]{1,80}$/, r.id)
    assert.ok(['request', 'page'].includes(r.half), r.id)
    assert.ok(
      r.names === null || ['signer', 'token', 'page-declaration'].includes(r.names) || r.names in names,
      `${r.id} names ${r.names}`,
    )
  }
})

test('every name is well formed, has a kind, and is reachable from some source', () => {
  const referenced = new Set([
    ...Object.values(signers),
    ...tokens.map((t) => t.name),
    ...Object.values(page.user_agent_prefixes),
    ...Object.values(page.platforms),
    ...reasons.map((r) => r.names).filter((n): n is string => n !== null && n in names),
  ])
  for (const [name, entry] of Object.entries(names)) {
    assert.match(name, NAME, name)
    assert.ok(name.length <= 64, name)
    assert.ok(KINDS.includes(entry.kind), `${name}: kind ${entry.kind}`)
    assert.ok(entry.display, `${name}: display name`)
    assert.ok(referenced.has(name), `${name} is produced by no source`)
  }
  for (const name of referenced) assert.ok(name in names, `${name} is referenced but not in names.json`)
})

test('tokens are unique and contain no boundary character', () => {
  const list = tokens.map((t) => t.token)
  assert.equal(new Set(list).size, list.length)
  for (const token of list) assert.match(token, /^[^\s/;(),+]+$/, token)
})

test('every signer has a bundled directory of Ed25519 keys', () => {
  assert.deepEqual(Object.keys(keys.directories).sort(), Object.keys(signers).sort())
  for (const [host, list] of Object.entries(keys.directories)) {
    assert.ok(list.length > 0, host)
    for (const key of list) {
      assert.equal(key.kty, 'OKP', host)
      assert.equal(key.crv, 'Ed25519', host)
      assert.equal(Buffer.from(key.x, 'base64url').length, 32, `${host}: x is 32 bytes`)
    }
  }
})

test('generated modules are current', () => {
  execFileSync(process.execPath, [new URL('../scripts/generate.ts', import.meta.url).pathname, '--check'], {
    stdio: 'pipe',
  })
})
