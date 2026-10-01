// The README's generated sections (the reasons and the coverage tables, from the
// registry) and a check that every code block in it imports only entries and names
// the package exports, in TypeScript and in Python. Run with --check to fail when
// a section is stale or a name does not exist, instead of writing.
import { readFileSync, writeFileSync } from 'node:fs'
import { format, resolveConfig } from 'prettier'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const check = process.argv.includes('--check')
const problems: string[] = []

type Reason = { id: string; half: string; names: string | null; summary: string }
type Name = { display: string; vendor: string; kind: string; sources: string[] }
const { reasons } = JSON.parse(read('registry/reasons.json')) as { reasons: Reason[] }
const { names } = JSON.parse(read('registry/names.json')) as { names: Record<string, Name | string> }

const cell = (s: string) => s.replaceAll('|', '\\|')

function reasonsTable(): string {
  const rows = reasons.map(
    (r) => `| \`${r.id}\` | ${r.half} | ${r.names ? `yes, ${r.names}` : 'no'} | ${cell(r.summary)} |`,
  )
  return [
    'Reasons, strongest first. A reason that names gives `agent_name` when every naming source agrees.',
    '',
    '| Reason | Half | Names | What it means |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

/** A registry source ('token X', 'signer host', 'page <reason>' ...) in words. */
function source(s: string): string {
  const [kind, ...rest] = s.split(' ')
  const value = rest.join(' ')
  if (kind === 'token') return `user agent \`${value}\``
  if (kind === 'signer') return `signature from \`${value}\``
  if (kind === 'page' && value.startsWith('user agent ')) return `page: user agent \`${value.slice(11)}\``
  if (kind === 'page' && value.startsWith('platform ')) return `page: platform \`${value.slice(9)}\``
  if (kind === 'page') return `page: ${value.replace(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g, (id) => `\`${id}\``)}`
  return s
}

const KINDS: [string, string][] = [
  ['computer-use-agent', 'Agents that operate a browser'],
  ['automation', 'Browser automation'],
  ['fetcher', 'Fetchers acting for a user'],
  ['previewer', 'Link previewers'],
  ['crawler', 'Crawlers'],
  ['client', 'HTTP clients and tools'],
]

function coverageTable(): string {
  const entries = Object.entries(names).filter((e): e is [string, Name] => typeof e[1] === 'object')
  const out = [
    `Named agents: ${entries.length}, from [the registry](registry/names.json). Software the registry does not name, such as a browser under automation, is still reported as an agent, without a name.`,
  ]
  for (const [kind, title] of KINDS) {
    const group = entries.filter(([, n]) => n.kind === kind).sort(([, a], [, b]) => a.display.localeCompare(b.display))
    if (group.length === 0) continue
    const rows = group.map(
      ([id, n]) =>
        `| ${cell(n.display)} | ${cell(n.vendor) || '—'} | \`${id}\` | ${n.sources.map(source).join('; ')} |`,
    )
    const table = ['| Agent | Vendor | `agent_name` | Evidence |', '| --- | --- | --- | --- |', ...rows].join('\n')
    out.push(
      kind === 'computer-use-agent' || kind === 'automation'
        ? `**${title}**\n\n${table}`
        : `<details><summary>${title} (${group.length})</summary>\n\n${table}\n\n</details>`,
    )
  }
  const unknown = entries.filter(([, n]) => !KINDS.some(([k]) => k === n.kind))
  if (unknown.length)
    problems.push(`names with a kind the README does not list: ${unknown.map(([id]) => id).join(', ')}`)
  return out.join('\n\n')
}

function fill(text: string, section: string, body: string): string {
  const re = new RegExp(`(<!-- generated:${section} -->\\n)[\\s\\S]*?(<!-- /generated -->)`)
  if (!re.test(text)) problems.push(`README.md has no generated:${section} section`)
  return text.replace(re, `$1\n${body}\n\n$2`)
}

// What each npm entry exports, read from its source file.
const ENTRIES: Record<string, string> = {
  botscent: 'src/index.ts',
  'botscent/auto': 'src/auto.ts',
  'botscent/server': 'src/server/index.ts',
}
for (const name of ['next', 'react', 'vue', 'svelte', 'nuxt', 'astro', 'express', 'hono', 'workers', 'vercel'])
  ENTRIES[`botscent/${name}`] = `src/adapters/${name}.ts`
const exportsMap = JSON.parse(read('package.json')).exports as Record<string, unknown>

function exported(file: string): Set<string> {
  const text = read(file)
  const out = new Set<string>()
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type)\s+(\w+)/g)) out.add(m[1]!)
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g))
    for (const part of m[1]!.split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()!
        .trim()
      if (name) out.add(name)
    }
  if (/export\s+default\b/.test(text)) out.add('default')
  return out
}

function checkTypeScript(code: string) {
  for (const m of code.matchAll(
    /(?:import|export)\s+(?:type\s+)?(\{[^}]*\}|\w+)?\s*(?:,\s*\{[^}]*\})?\s*from\s+'(botscent(?:\/[\w.-]+)?)'|import\s+'(botscent(?:\/[\w.-]+)?)'/g,
  )) {
    const entry = m[2] ?? m[3]!
    const subpath = entry === 'botscent' ? '.' : `./${entry.slice('botscent/'.length)}`
    if (!(subpath in exportsMap)) {
      problems.push(`README imports ${entry}, which package.json does not export`)
      continue
    }
    const file = ENTRIES[entry]
    if (!file || !m[1]) continue
    const available = exported(file)
    const wanted = m[1].startsWith('{')
      ? m[1]
          .slice(1, -1)
          .split(',')
          .map((p) =>
            p
              .trim()
              .split(/\s+as\s+/)[0]!
              .replace(/^type\s+/, '')
              .trim(),
          )
          .filter(Boolean)
      : ['default']
    for (const name of wanted)
      if (!available.has(name)) problems.push(`README imports ${name} from ${entry}, which does not export it`)
  }
  for (const m of code.matchAll(/\b(withBotscent|inspect|readReport|combine|isVerified|headers|useBotscent)\b/g))
    if (![...Object.values(ENTRIES)].some((f) => exported(f).has(m[1]!)))
      problems.push(`README uses ${m[1]}, which no entry exports`)
}

function checkPython(code: string) {
  const module = (name: string) =>
    read(`python/src/${name.replaceAll('.', '/')}${name === 'botscent' ? '/__init__' : ''}.py`)
  for (const m of code.matchAll(/from\s+(botscent(?:\.\w+)?)\s+import\s+([\w, ]+)/g)) {
    let text: string
    try {
      text = module(m[1]!)
    } catch {
      problems.push(`README imports from ${m[1]}, which does not exist`)
      continue
    }
    for (const name of m[2]!.split(',').map((s) => s.trim()))
      if (!new RegExp(`^(class|def)\\s+${name}\\b|^${name}\\s*=|"${name}"`, 'm').test(text))
        problems.push(`README imports ${name} from ${m[1]}, which does not define it`)
  }
  for (const m of code.matchAll(/"(botscent\.\w+)\.(\w+)"/g)) {
    try {
      if (!new RegExp(`^class\\s+${m[2]}\\b`, 'm').test(module(m[1]!)))
        problems.push(`README names ${m[1]}.${m[2]}, which does not exist`)
    } catch {
      problems.push(`README names ${m[1]}, which does not exist`)
    }
  }
  for (const m of code.matchAll(/\bbotscent\.(\w+)\(/g))
    if (!new RegExp(`"${m[1]}"`).test(module('botscent')))
      problems.push(`README calls botscent.${m[1]}, which is not exported`)
}

let readme = read('README.md')
const before = readme
readme = fill(readme, 'reasons', reasonsTable())
readme = fill(readme, 'coverage', coverageTable())
// Formatted as the repository's prettier would, so that the two never disagree.
const file = new URL('README.md', root).pathname
readme = await format(readme, { ...(await resolveConfig(file)), filepath: file })
for (const m of readme.matchAll(/```(\w+)\n([\s\S]*?)```/g)) {
  if (['ts', 'tsx', 'js'].includes(m[1]!)) checkTypeScript(m[2]!)
  else if (m[1] === 'python') checkPython(m[2]!)
}
if (check && readme !== before) problems.push('README.md generated sections are stale: run node scripts/docs.ts')
if (!check && readme !== before) writeFileSync(new URL('README.md', root), readme)
if (problems.length) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(check ? 'README.md is current' : 'README.md written')
