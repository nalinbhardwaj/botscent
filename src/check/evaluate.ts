// check (plan 8.17): what was observed about a site, turned into one line per
// check. Pure, so that every outcome is tested from recorded observations. A
// remote check often cannot tell a correct omission from a missing install, so
// each line gives the observation first and then a qualified cause.
import type { Verdict } from '../core/verdict.ts'
import { decode } from '../core/wire.ts'
import { ourEntries } from '../server/timing.ts'

export type Outcome = 'pass' | 'fail' | 'unknown' | 'skipped'
export type Check = { id: string; outcome: Outcome; observed: string; cause?: string; fix?: string }

/** One HTTP response: the headers check reads (lower-case names) and hints from the HTML. */
export type Page = { status: number; headers: Record<string, string>; scripts: string[]; markers: string[] }
export type Fetched = Page | { error: string }

export type Diagnostics = {
  version: string
  started: boolean
  startedAt: number | null
  probes: Record<string, string>
  transport: string
}
export type Browser =
  | { skipped: string }
  | { error: string }
  | {
      chrome: string
      instance: { diagnostics: Diagnostics; verdict: Verdict } | null
      /** The descs of the botscent entries the browser received with the document. */
      entries: string[]
      /** Console errors and uncaught exceptions. */
      problems: string[]
      /** Content Security Policy violations. */
      blocked: string[]
      scripts: string[]
    }

export type Proxy = { file: string; state: 'new' | 'wrapped' | 'replaced' | 'unchanged' }
export type Project =
  | { skipped: string }
  | { root: string; botscent: string | null; frameworks: string[]; imports: string[]; proxy: Proxy | null }

export type Observations = {
  url: string
  /** When check sent its own request, in ms since the epoch. */
  sentAt: number
  /** The page requested as check itself, with its own user-agent token. */
  self: Fetched
  /** The same page requested right after, with an empty user agent: no agent evidence. */
  anonymous: Fetched
  /** The origin requested directly (--origin), as check itself. */
  origin?: Fetched
  browser: Browser
  project: Project
}

// The page's own acceptance window for an entry (contract item 32).
const FRESH_BEFORE_MS = 10_000
const FRESH_AFTER_MS = 120_000

const failed = (f: Fetched): f is { error: string } => 'error' in f
const entriesOf = (f: Fetched) => (failed(f) ? [] : ourEntries(f.headers['server-timing'] ?? null))

/** Evidence that a shared cache served the response, or null. */
export function cacheHit(headers: Record<string, string>): string | null {
  if (Number(headers['age']) > 0) return `Age: ${headers['age']}`
  for (const name of ['cf-cache-status', 'x-vercel-cache', 'x-cache', 'x-cache-status', 'x-nextjs-cache']) {
    const value = headers[name]
    if (value && /\b(hit|stale|prerender|revalidated|updating)\b/i.test(value)) return `${name}: ${value}`
  }
  return null
}

const PLATFORMS: [string, (h: Record<string, string>) => boolean][] = [
  ['Vercel', (h) => 'x-vercel-id' in h],
  ['Netlify', (h) => 'x-nf-request-id' in h],
  ['Cloudflare', (h) => 'cf-ray' in h],
  ['CloudFront', (h) => 'x-amz-cf-id' in h],
  ['Fly.io', (h) => 'fly-request-id' in h],
]
const FRAMEWORKS: [string, (h: Record<string, string>, markers: string[]) => boolean][] = [
  ['Next.js', (h, m) => /next\.js/i.test(h['x-powered-by'] ?? '') || m.includes('next')],
  ['Nuxt', (_, m) => m.includes('nuxt')],
  ['Astro', (_, m) => m.includes('astro')],
  ['SvelteKit', (_, m) => m.includes('sveltekit')],
  ['Express', (h) => /express/i.test(h['x-powered-by'] ?? '')],
  ['uvicorn', (h) => /uvicorn/i.test(h['server'] ?? '')],
  ['Werkzeug (Flask)', (h) => /werkzeug/i.test(h['server'] ?? '')],
  ['Django', (h) => /wsgiserver/i.test(h['server'] ?? '')],
]

function reachable(o: Observations): Check {
  const id = 'reachable'
  if (failed(o.self))
    return {
      id,
      outcome: 'fail',
      observed: o.self.error,
      cause: 'the site did not answer',
      fix: 'start the site, or check the URL',
    }
  const { status, headers } = o.self
  if (status === 403 || status === 429 || status === 503)
    if ('cf-mitigated' in headers || /challenge|captcha/i.test(headers['server'] ?? ''))
      return {
        id,
        outcome: 'unknown',
        observed: `${status} from the site's bot protection`,
        cause: "the site's bot protection answered check instead of the page",
        fix: 'run check against a deployment or path without the challenge',
      }
  if (status >= 400)
    return {
      id,
      outcome: 'fail',
      observed: `${status}`,
      cause: 'the page did not load',
      fix: 'check the URL, or start the site',
    }
  return { id, outcome: 'pass', observed: `${status}, ${headers['content-type'] ?? 'no content type'}` }
}

function serverHalf(o: Observations): Check {
  const id = 'server-half'
  if (failed(o.self)) return { id, outcome: 'skipped', observed: 'the page did not load' }
  const ours = entriesOf(o.self)
  if (ours.length === 0) {
    const atOrigin = o.origin && !failed(o.origin) ? entriesOf(o.origin) : []
    if (atOrigin.length > 0)
      return {
        id,
        outcome: 'fail',
        observed: 'the origin sent an entry and the public URL did not',
        cause: 'a hop between the origin and the public URL removes Server-Timing',
        fix: 'let Server-Timing through that proxy or CDN, or use an adapter that runs at the edge',
      }
    return {
      id,
      outcome: 'unknown',
      observed: "no botscent entry on check's own request",
      cause:
        'the server half is not installed, or its transport is off (the default at an origin: Express, Hono on Node, Django, FastAPI, Flask, self-hosted Next.js), or a hop removed Server-Timing',
      fix: 'on Vercel or Cloudflare install botscent/next, botscent/vercel or botscent/workers; at an origin the verdict is still in your code (req.botscent), and the transport stays off unless no shared cache stores your HTML; compare hops with --origin <url>',
    }
  }
  const entry = decode(ours[0])
  if (entry?.name === 'botscent-check')
    return { id, outcome: 'pass', observed: `entry ${ours[0]} on check's own request` }
  return {
    id,
    outcome: 'fail',
    observed: `entry ${ours[0]} on check's own request, which declared botscent-check`,
    cause: 'the entry describes another request: a cache served a stored decorated response',
    fix: 'keep decorated responses out of shared caches (the adapter sets Cache-Control: no-store); see the person and entry checks',
  }
}

function entry(o: Observations): Check {
  const id = 'entry'
  const ours = entriesOf(o.self)
  if (ours.length === 0) return { id, outcome: 'skipped', observed: 'no entry to check' }
  if (ours.length > 1)
    return {
      id,
      outcome: 'fail',
      observed: `${ours.length} botscent entries`,
      cause: 'two adapters each add one, or a cache adds a stored one; the page ignores them all',
      fix: 'keep one server adapter on the path',
    }
  const e = decode(ours[0])
  if (!e || e.time === undefined)
    return {
      id,
      outcome: 'fail',
      observed: `malformed entry ${ours[0]}`,
      cause: 'the entry does not follow the wire grammar',
      fix: 'upgrade botscent on the server; report it with --report if it persists',
    }
  const offset = e.time - o.sentAt
  const seconds = `${offset >= 0 ? '+' : ''}${(offset / 1000).toFixed(1)} s`
  if (offset < -FRESH_BEFORE_MS || offset > FRESH_AFTER_MS)
    return {
      id,
      outcome: 'fail',
      observed: `written ${seconds} from check's request`,
      cause: 'a stale entry: a cache stored a decorated response, or the server clock is far off',
      fix: 'run the adapter in front of the cache and keep Cache-Control: no-store on decorated responses',
    }
  return { id, outcome: 'pass', observed: `fresh (${seconds}) and single` }
}

function noStore(o: Observations): Check {
  const id = 'no-store'
  if (failed(o.self) || entriesOf(o.self).length === 0) return { id, outcome: 'skipped', observed: 'nothing decorated' }
  const cc = o.self.headers['cache-control'] ?? ''
  if (/(^|,)\s*no-store\s*(,|$)/i.test(cc)) return { id, outcome: 'pass', observed: `Cache-Control: ${cc}` }
  return {
    id,
    outcome: 'fail',
    observed: `the decorated response has Cache-Control: ${cc || '(none)'}`,
    cause: "a later layer replaced the adapter's no-store, so a cache may store an agent's entry",
    fix: 'keep Cache-Control: no-store on responses that carry a botscent entry',
  }
}

function person(o: Observations): Check {
  const id = 'person'
  if (failed(o.anonymous)) return { id, outcome: 'unknown', observed: o.anonymous.error }
  const ours = entriesOf(o.anonymous)
  if (ours.length === 0) return { id, outcome: 'pass', observed: 'no entry on a request without agent evidence' }
  return {
    id,
    outcome: 'fail',
    observed: `a request without agent evidence received ${ours.map((d) => `botscent;desc="${d}"`).join(', ')}`,
    cause:
      'a shared cache replays decorated responses, or something decorates every response: people would be reported as agents',
    fix: 'turn the transport off now; then run the adapter in front of the cache and keep no-store on decorated responses',
  }
}

function cache(o: Observations): Check {
  const id = 'cache'
  if (failed(o.anonymous)) return { id, outcome: 'skipped', observed: 'no response to read' }
  const hit = cacheHit(o.anonymous.headers)
  const cc = o.anonymous.headers['cache-control']
  if (!hit)
    return {
      id,
      outcome: 'pass',
      observed: `not served from a shared cache${cc ? ` (Cache-Control: ${cc})` : ''}`,
    }
  if (failed(o.self) || entriesOf(o.self).length === 0)
    return { id, outcome: 'pass', observed: `cached HTML (${hit}), and no entry to leak` }
  if (cacheHit(o.self.headers))
    return { id, outcome: 'pass', observed: `cached HTML (${hit}), decorated after the cache lookup` }
  return {
    id,
    outcome: 'unknown',
    observed: `people get cached HTML (${hit}); check's decorated response bypassed the cache`,
    cause: 'safe only while every cache on the path honours no-store',
    fix: 'prefer an adapter that decorates after the cache lookup (Vercel, Cloudflare Workers), or keep the transport off',
  }
}

function pageScript(o: Observations): Check {
  const id = 'page-script'
  const b = o.browser
  if ('skipped' in b) {
    const tags = failed(o.self) ? [] : o.self.scripts.filter((s) => /botscent/i.test(s))
    return {
      id,
      outcome: 'skipped',
      observed: `${b.skipped}${tags.length ? `; the HTML loads ${tags.join(', ')}` : ''}`,
      fix: 'install Chrome, or pass --chrome <path>',
    }
  }
  if ('error' in b) return { id, outcome: 'unknown', observed: b.error }
  if (!b.instance)
    return {
      id,
      outcome: 'fail',
      observed: `no botscent on the page${b.problems.length ? `; page errors: ${b.problems.slice(0, 3).join(' | ')}` : ''}`,
      cause: 'the page half is not loaded on this page, or a script error stopped it',
      fix: 'import botscent/auto in the client entry (Next.js: instrumentation-client.ts), add <Botscent />, or add <script defer src="/botscent.js"></script>',
    }
  const d = b.instance.diagnostics
  if (!d.started)
    return {
      id,
      outcome: 'fail',
      observed: `botscent ${d.version} is on the page but never started`,
      cause: 'the npm entry was imported without start()',
      fix: "call start() once in the browser, or import 'botscent/auto'",
    }
  return { id, outcome: 'pass', observed: `botscent ${d.version} started ${d.startedAt} ms after navigation` }
}

function pageVerdict(o: Observations): Check {
  const id = 'page-verdict'
  const b = o.browser
  if (!('instance' in b) || !b.instance) return { id, outcome: 'skipped', observed: 'no page half to ask' }
  const v = b.instance.verdict
  const shown = `${v.type}${v.agent_name ? ` (${v.agent_name})` : ''} [${v.reasons.join(', ')}]`
  if (v.type === 'agent' && v.reasons.includes('browser.webdriver-flag'))
    return { id, outcome: 'pass', observed: `${shown} under automation, as expected` }
  return {
    id,
    outcome: 'fail',
    observed: `${shown} under automation`,
    cause: `the webdriver probe did not fire (probe status: ${b.instance.diagnostics.probes['navigator'] ?? 'none'})`,
    fix: 'run check with --report and open an issue with the report',
  }
}

function transport(o: Observations, server: Check): Check {
  const id = 'transport'
  const b = o.browser
  if (!('instance' in b) || !b.instance) return { id, outcome: 'skipped', observed: 'no page half to ask' }
  const status = b.instance.diagnostics.transport
  if (status === 'received')
    return { id, outcome: 'pass', observed: `the page received ${b.entries[0] ?? 'the entry'}` }
  if (status === 'unsupported')
    return {
      id,
      outcome: 'unknown',
      observed: 'the browser exposes no Server-Timing to this page',
      cause: 'Server-Timing reaches pages only in secure contexts (https, or localhost)',
      fix: 'check the https deployment',
    }
  if (status === 'rejected')
    return {
      id,
      outcome: 'fail',
      observed: `the page rejected ${b.entries.length === 1 ? b.entries[0] : `${b.entries.length} entries`}`,
      cause: b.entries.length > 1 ? 'more than one botscent entry' : 'a stale or malformed entry',
      fix: 'see the entry and person checks',
    }
  if (server.outcome === 'pass')
    return {
      id,
      outcome: 'fail',
      observed: "the server sent check an entry, and the browser's document had none",
      cause: "the browser's navigation took another path: a cache, or a hop that removes Server-Timing",
      fix: 'compare with --origin <url>, and check which cache answered the browser',
    }
  return { id, outcome: 'unknown', observed: 'no entry reached the page', cause: 'see the server-half check' }
}

function probes(o: Observations): Check {
  const id = 'probes'
  const b = o.browser
  if (!('instance' in b) || !b.instance) return { id, outcome: 'skipped', observed: 'no page half to ask' }
  const all = Object.entries(b.instance.diagnostics.probes)
  const bad = all.filter(([, s]) => s === 'failed').map(([p]) => p)
  if (bad.length)
    return {
      id,
      outcome: 'fail',
      observed: `failed: ${bad.join(', ')}`,
      cause: 'a script on the page broke a browser API a probe reads',
      fix: 'run check with --report and open an issue with the report',
    }
  const unsupported = all.filter(([, s]) => s === 'unsupported').map(([p]) => p)
  return {
    id,
    outcome: 'pass',
    observed: `${all.length} ok${unsupported.length ? `, unsupported here: ${unsupported.join(', ')}` : ''}`,
  }
}

function csp(o: Observations): Check {
  const id = 'csp'
  const b = o.browser
  const header = failed(o.self) ? undefined : o.self.headers['content-security-policy']
  if ('blocked' in b && b.blocked.length)
    return {
      id,
      outcome: 'fail',
      observed: b.blocked[0]!,
      cause: "the site's Content Security Policy blocked a script",
      fix: "allow the script's origin in script-src, or serve botscent.js from your own origin",
    }
  if (!('blocked' in b))
    return { id, outcome: 'skipped', observed: header ? 'a policy is set; no browser to test it' : 'no policy' }
  return { id, outcome: 'pass', observed: header ? 'a policy is set, and nothing was blocked' : 'no policy' }
}

function script(o: Observations): Check {
  const id = 'script'
  const scripts = 'scripts' in o.browser ? o.browser.scripts : failed(o.self) ? [] : o.self.scripts
  const ours = scripts.filter((s) => /\/botscent(\.min)?\.js(\?|#|$)/i.test(s))
  if (ours.length === 0)
    return { id, outcome: 'skipped', observed: 'no botscent.js tag; the page half is bundled, or absent' }
  const site = new URL(o.url).origin
  const foreign = ours.filter((s) => new URL(s, o.url).origin !== site)
  if (foreign.length)
    return {
      id,
      outcome: 'unknown',
      observed: `loaded from ${new URL(foreign[0]!, o.url).origin}`,
      cause: 'scripts from other origins are blocked more often, by policies and by content blockers',
      fix: 'serve node_modules/botscent/dist/botscent.js from your own origin',
    }
  return { id, outcome: 'pass', observed: `served from the site's own origin (${new URL(ours[0]!, o.url).pathname})` }
}

function stack(o: Observations): Check {
  const id = 'stack'
  const found: string[] = []
  if (!failed(o.self)) {
    const { headers, markers } = o.self
    for (const [name, test] of FRAMEWORKS) if (test(headers, markers)) found.push(name)
    for (const [name, test] of PLATFORMS) if (test(headers)) found.push(`on ${name}`)
  }
  if (!('skipped' in o.project) && o.project.frameworks.length)
    found.push(`project: ${o.project.frameworks.join(', ')}`)
  if (found.length === 0) return { id, outcome: 'unknown', observed: 'no framework or platform recognised' }
  return { id, outcome: 'pass', observed: found.join('; ') }
}

function adapters(o: Observations): Check {
  const id = 'adapters'
  const p = o.project
  if ('skipped' in p) return { id, outcome: 'skipped', observed: p.skipped }
  if (p.imports.length === 0)
    return {
      id,
      outcome: 'fail',
      observed: `no botscent import under ${p.root}${p.botscent ? ` (botscent ${p.botscent} is installed)` : ''}`,
      cause: 'the package is not wired into the application',
      fix: 'follow the quickstart for your framework',
    }
  const imports = p.imports.join('; ')
  if (p.proxy?.state === 'replaced')
    return {
      id,
      outcome: 'fail',
      observed: `${imports}; ${p.proxy.file} no longer has the code it had at HEAD`,
      cause: 'an existing proxy or middleware was replaced rather than wrapped',
      fix: `restore it and wrap it: export default withBotscent(existing) in ${p.proxy.file}`,
    }
  return {
    id,
    outcome: 'pass',
    observed: `${imports}${p.proxy ? `; ${p.proxy.file}: ${p.proxy.state}` : ''}`,
  }
}

/** Every check, in the order they are printed. */
export function evaluate(o: Observations): Check[] {
  const reach = reachable(o)
  const server = serverHalf(o)
  return [
    reach,
    server,
    entry(o),
    noStore(o),
    person(o),
    cache(o),
    pageScript(o),
    pageVerdict(o),
    transport(o, server),
    probes(o),
    csp(o),
    script(o),
    stack(o),
    adapters(o),
  ]
}

/** 1: broken (any check failed); 2: unverified (no failure, and neither half confirmed); 0 otherwise. */
export function exitCode(checks: Check[]): 0 | 1 | 2 {
  if (checks.some((c) => c.outcome === 'fail')) return 1
  const confirmed = checks.some((c) => (c.id === 'page-script' || c.id === 'server-half') && c.outcome === 'pass')
  return confirmed ? 0 : 2
}
