// The scheduled key watch (plan 4.7): fetches every signer's published key
// directory and compares it with registry/keys.json. Keys added, removed or with a
// changed validity are a change; an expiry that only rolls forward with time
// (a directory that always answers "now plus seven days") is not, and is reported
// as rolling. With --write, a change is written and the modules regenerated; the
// workflow then opens a pull request with this script's summary as its body.
//
//   node scripts/keys.ts [--write]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type Key = {
  kty?: string
  crv?: string
  x: string
  kid?: string
  nbf?: number
  exp?: number
  rolling_expiry_s?: number
}
type Keys = { $comment: string; fetched_at: string; directories: Record<string, Key[]> }

const root = new URL('../', import.meta.url).pathname
const write = process.argv.includes('--write')
const registry = JSON.parse(readFileSync(`${root}registry/keys.json`, 'utf8')) as Keys
const { signers } = JSON.parse(readFileSync(`${root}registry/signers.json`, 'utf8')) as {
  signers: Record<string, string>
}
const fetchedAt = Date.parse(registry.fetched_at) / 1000
const now = Date.now() / 1000
const lines: string[] = []
let changed = false
const live: Record<string, Key[]> = {}

for (const host of Object.keys(signers)) {
  const url = `https://${host}/.well-known/http-message-signatures-directory`
  let keys: Key[]
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/http-message-signatures-directory+json, application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { keys?: Key[] }
    keys = (body.keys ?? [])
      .filter((k) => k.kty === 'OKP' && k.crv === 'Ed25519' && typeof k.x === 'string')
      .map(({ kty, crv, x, kid, nbf, exp }) => ({
        kty,
        crv,
        x,
        ...(kid ? { kid } : {}),
        ...(nbf ? { nbf } : {}),
        ...(exp ? { exp } : {}),
      }))
  } catch (error) {
    // An unreachable directory is reported, never taken as the signer removing its keys.
    lines.push(`- \`${host}\`: could not fetch (${error instanceof Error ? error.message : error}); kept as it is`)
    live[host] = registry.directories[host] ?? []
    continue
  }
  const before = registry.directories[host] ?? []
  const added = keys.filter((k) => !before.some((b) => b.x === k.x))
  const removed = before.filter((b) => !keys.some((k) => k.x === b.x))
  for (const k of added)
    lines.push(
      `- \`${host}\`: new key \`${k.kid ?? k.x}\`${k.exp ? `, valid to ${new Date(k.exp * 1000).toISOString()}` : ''}`,
    )
  for (const k of removed) lines.push(`- \`${host}\`: key \`${k.kid ?? k.x}\` no longer published`)
  changed ||= added.length > 0 || removed.length > 0
  const merged: Key[] = []
  for (const k of keys) {
    const b = before.find((x) => x.x === k.x)
    const id = `\`${host}\`: key \`${k.kid ?? k.x}\``
    // The same lifetime counted from this fetch: the directory's expiry rolls forward.
    const rolls = (lifetime: number) => k.exp !== undefined && Math.abs(k.exp - now - lifetime) < 600
    if (!b) {
      merged.push(k)
      continue
    }
    if (b.rolling_expiry_s !== undefined) {
      if (rolls(b.rolling_expiry_s) && b.nbf === k.nbf) {
        lines.push(
          `- ${id} keeps its rolling expiry (fetch time plus ${Math.round(b.rolling_expiry_s / 86400)} days), bundled without one`,
        )
        merged.push(b)
      } else {
        lines.push(`- ${id}: its expiry no longer rolls (nbf ${k.nbf ?? '-'}, exp ${k.exp ?? '-'})`)
        merged.push(k)
        changed = true
      }
      continue
    }
    if (b.exp !== undefined && k.exp !== undefined && b.exp !== k.exp && rolls(b.exp - fetchedAt)) {
      // First seen rolling: bundle the key without the expiry, and record the lifetime it rolls by.
      const { exp: _, ...rest } = k
      merged.push({ ...rest, rolling_expiry_s: Math.round(k.exp - now) })
      lines.push(
        `- ${id}: its expiry rolls (fetch time plus ${Math.round((k.exp - now) / 86400)} days); bundled without it from now on`,
      )
      changed = true
      continue
    }
    if (b.nbf !== k.nbf || b.exp !== k.exp) {
      lines.push(
        `- ${id} validity changed (nbf ${b.nbf ?? '-'} → ${k.nbf ?? '-'}, exp ${b.exp ?? '-'} → ${k.exp ?? '-'})`,
      )
      changed = true
      merged.push(k)
    } else merged.push(b)
  }
  live[host] = merged
}

console.log(changed ? '## Signer keys changed\n' : '## Signer keys unchanged\n')
if (lines.length) console.log(lines.join('\n'))
if (changed && write) {
  writeFileSync(
    `${root}registry/keys.json`,
    `${JSON.stringify({ ...registry, fetched_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), directories: live }, null, 2)}\n`,
  )
  execFileSync(process.execPath, ['scripts/generate.ts'], { cwd: root, stdio: 'inherit' })
  console.log('\nregistry/keys.json written and the modules regenerated.')
}
