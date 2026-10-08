// The output-change report a release carries (plan 8.3): what this tree changes,
// against the last release tag, in the outputs anyone can see. The vectors pin
// every verdict the implementations give on their cases, so a changed verdict is a
// changed vector; the registry decides every name, token, signer and key. The
// maintainers' replay of recorded sessions is a separate step before a release.
//
//   node scripts/output-change.ts [--since <tag>]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url).pathname
const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const arg = process.argv.indexOf('--since')
let since: string | null = arg > 0 ? process.argv[arg + 1]! : null
// The last release before this commit: a tag on this commit is the release being made, not its base.
if (!since)
  try {
    const here = git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean)
    since = git('describe', '--tags', '--abbrev=0', '--match', 'v*', ...here.flatMap((t) => ['--exclude', t]))
  } catch {}

const now = (path: string) => JSON.parse(readFileSync(`${root}${path}`, 'utf8'))
const then = (path: string) => {
  try {
    return JSON.parse(git('show', `${since}:${path}`))
  } catch {
    return null
  }
}

type Verdict = { type: string; agent_name?: string; reasons: string[] }
const show = (v: Verdict | null | undefined) =>
  !v ? '(none)' : `${v.type}${v.agent_name ? ` ${v.agent_name}` : ''} [${v.reasons.join(', ')}]`
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const list = (items: string[]) => items.map((i) => `\`${i}\``).join(', ')
const lines: string[] = []

const vectorsHash = createHash('sha256')
for (const file of ['vectors/requests.json', 'vectors/core.json']) vectorsHash.update(readFileSync(`${root}${file}`))
const hash = vectorsHash.digest('hex')

if (!since) {
  const names = Object.keys(now('registry/names.json').names).length
  const tokens = now('registry/tokens.json').tokens.length
  const keys = now('registry/keys.json').directories as Record<string, unknown[]>
  const cases = now('vectors/requests.json').cases.length
  lines.push(
    '## Output changes',
    '',
    `First release: ${names} names, ${tokens} user-agent tokens, ${Object.keys(keys).length} signers with ${Object.values(keys).flat().length} keys, and ${cases} request vectors.`,
  )
} else {
  lines.push(
    `## Output changes since ${since}`,
    '',
    'Coverage: what the request vectors and the registry pin. A changed page predicate or server rule that no vector exercises does not show here; the maintainers replay their recorded agent and person sessions before each release, which covers the page half.',
    '',
  )
  // Vectors: every case whose verdict moved, and cases added or removed.
  const before = new Map<string, Verdict>(
    ((then('vectors/requests.json')?.cases ?? []) as { name: string; verdict: Verdict }[]).map((c) => [
      c.name,
      c.verdict,
    ]),
  )
  const after = new Map<string, Verdict>(
    (now('vectors/requests.json').cases as { name: string; verdict: Verdict }[]).map((c) => [c.name, c.verdict]),
  )
  const moved = [...after].filter(([name, v]) => before.has(name) && !same(before.get(name), v))
  const added = [...after.keys()].filter((name) => !before.has(name))
  const removed = [...before.keys()].filter((name) => !after.has(name))
  if (moved.length) {
    lines.push(
      `**Verdicts changed** on ${moved.length} request vector${moved.length > 1 ? 's' : ''}:`,
      '',
      '| Case | Before | After |',
      '| --- | --- | --- |',
    )
    for (const [name, v] of moved) lines.push(`| ${name} | ${show(before.get(name))} | ${show(v)} |`)
    lines.push('')
  } else lines.push('No request vector changed its verdict.', '')
  if (added.length) lines.push(`New request vectors: ${added.length}.`)
  if (removed.length) lines.push(`Removed request vectors: ${removed.join('; ')}.`)
  if (!same(then('vectors/core.json'), now('vectors/core.json')))
    lines.push('The report, combine and isVerified vectors changed.')
  // The registry: names, tokens, signers, keys, page declarations, reasons.
  const diff = (title: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    const add = Object.keys(b).filter((k) => !(k in a))
    const del = Object.keys(a).filter((k) => !(k in b))
    const chg = Object.keys(b).filter((k) => k in a && !same(a[k], b[k]))
    const parts = [
      add.length ? `added ${list(add)}` : '',
      del.length ? `removed ${list(del)}` : '',
      chg.length ? `changed ${list(chg)}` : '',
    ].filter(Boolean)
    if (parts.length) lines.push(`- ${title}: ${parts.join('; ')}`)
  }
  const tokens = (t: { tokens: { token: string }[] } | null) =>
    Object.fromEntries((t?.tokens ?? []).map((x) => [x.token, x]))
  const keys = (k: { directories: Record<string, { x: string }[]> } | null) =>
    Object.fromEntries(
      Object.entries(k?.directories ?? {}).flatMap(([host, list]) =>
        list.map((key) => [`${host} ${key.x.slice(0, 12)}…`, key]),
      ),
    )
  const reasons = (r: { reasons: { id: string }[] } | null) =>
    Object.fromEntries((r?.reasons ?? []).map((x, i) => [x.id, { ...x, rank: i }]))
  const page = (p: Record<string, Record<string, string>> | null) => ({
    ...p?.['user_agent_prefixes'],
    ...p?.['user_agent_tokens'],
    ...p?.['platforms'],
  })
  const registry = lines.length
  lines.push('', '**Registry**', '')
  diff('names', then('registry/names.json')?.names ?? {}, now('registry/names.json').names)
  diff('user-agent tokens', tokens(then('registry/tokens.json')), tokens(now('registry/tokens.json')))
  diff('signers', then('registry/signers.json')?.signers ?? {}, now('registry/signers.json').signers)
  diff('signer keys', keys(then('registry/keys.json')), keys(now('registry/keys.json')))
  diff('page declarations', page(then('registry/page.json')), page(now('registry/page.json')))
  diff('reasons', reasons(then('registry/reasons.json')), reasons(now('registry/reasons.json')))
  if (lines.length === registry + 3) lines.push('No registry change.')
}
lines.push(
  '',
  `Vectors sha256: \`${hash}\` (vectors/requests.json, vectors/core.json), the same for the npm and PyPI packages of this release.`,
)
console.log(lines.join('\n'))
