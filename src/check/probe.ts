// check's observations (plan 8.17): the page requested as check itself and then
// anonymously, the page in a local Chrome driven over the DevTools protocol (which
// sets the webdriver flag, as any automation does), and the project on disk.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { Browser, Fetched, Project, Proxy } from './evaluate.ts'

const READ = [
  'server-timing',
  'cache-control',
  'age',
  'cf-cache-status',
  'x-vercel-cache',
  'x-cache',
  'x-cache-status',
  'x-nextjs-cache',
  'x-vercel-id',
  'x-nf-request-id',
  'cf-ray',
  'cf-mitigated',
  'x-amz-cf-id',
  'fly-request-id',
  'x-powered-by',
  'server',
  'content-type',
  'content-security-policy',
]

const MARKERS: [string, RegExp][] = [
  ['next', /\/_next\/|__NEXT_DATA__|self\.__next_f/],
  ['nuxt', /\/_nuxt\/|__NUXT__|id="__nuxt"/],
  ['astro', /<astro-island|data-astro-|\/_astro\//],
  ['sveltekit', /__sveltekit|\/_app\/immutable\//],
]

const describe = (error: unknown): string => {
  const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (e?.name === 'TimeoutError') return 'no answer within 15 s'
  return e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(error)
}

/** Requests the page as a navigation would, with the given user agent ('' for none). */
export async function request(url: string, userAgent: string): Promise<Fetched> {
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    const headers: Record<string, string> = {}
    for (const name of READ) {
      const value = response.headers.get(name)
      if (value !== null) headers[name] = value
    }
    let html = ''
    if (/html/i.test(headers['content-type'] ?? '')) html = (await response.text()).slice(0, 2_000_000)
    else await response.body?.cancel()
    const scripts: string[] = []
    for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi))
      try {
        scripts.push(new URL(m[1]!, response.url).href)
      } catch {}
    const markers = MARKERS.filter(([, re]) => re.test(html)).map(([name]) => name)
    return { status: response.status, headers, scripts, markers }
  } catch (error) {
    return { error: describe(error) }
  }
}

/** A Chrome, Chromium or Edge to drive: the given path, CHROME_PATH, an installed browser, or Playwright's. */
export function findChrome(explicit?: string): string | null {
  return chromeCandidates(process.platform, process.env, homedir(), explicit).find((p) => existsSync(p)) ?? null
}

/** Where findChrome looks, in order, for one platform. */
export function chromeCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
  explicit?: string,
): string[] {
  const candidates: (string | undefined)[] = [explicit, env['CHROME_PATH']]
  if (platform === 'darwin') {
    for (const app of ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'])
      candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`)
  } else if (platform === 'win32') {
    for (const base of [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']])
      if (base)
        candidates.push(
          join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        )
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'])
      candidates.push(`/usr/bin/${name}`)
  }
  const cache =
    env['PLAYWRIGHT_BROWSERS_PATH'] ??
    (platform === 'darwin'
      ? join(home, 'Library', 'Caches', 'ms-playwright')
      : platform === 'win32'
        ? join(env['LOCALAPPDATA'] ?? home, 'ms-playwright')
        : join(home, '.cache', 'ms-playwright'))
  try {
    for (const dir of readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse())
      for (const path of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux64/chrome',
        'chrome-linux/chrome',
        'chrome-win64/chrome.exe',
        'chrome-win/chrome.exe',
      ])
        candidates.push(join(cache, dir, path))
  } catch {}
  return candidates.filter((p): p is string => !!p)
}

/** Rejects with what was being waited for, rather than hanging. */
function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s waiting for ${what}`)), ms)
    }),
  ])
}

type Message = {
  id?: number
  method?: string
  params?: any
  sessionId?: string
  result?: any
  error?: { message: string }
}

// What the page half shows of itself, read in the page after the later pass.
const READ_PAGE = `(() => {
  const instance = globalThis[Symbol.for('botscent')]
  const navigation = performance.getEntriesByType('navigation')[0]
  return {
    instance: instance ? { diagnostics: instance.diagnostics(), verdict: instance.verdict() } : null,
    entries: navigation && navigation.serverTiming
      ? navigation.serverTiming.filter((e) => e.name === 'botscent').map((e) => e.description)
      : [],
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
  }
})()`

/** Opens the page in headless Chrome over the DevTools protocol and reads the page half. */
export async function inBrowser(url: string, executable: string): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'botscent-check-'))
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ]
  // Containers and CI runners often forbid the namespaces Chrome's sandbox needs.
  if (process.platform === 'linux' && (process.getuid?.() === 0 || process.env['CI'])) args.unshift('--no-sandbox')
  const chrome = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let socket: WebSocket | undefined
  try {
    let stderr = ''
    const endpoint = await within(
      20_000,
      'Chrome to start',
      new Promise<string>((resolve, reject) => {
        chrome.stderr.on('data', (d) => {
          stderr += String(d)
          const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)
          if (m) resolve(m[1]!)
        })
        chrome.on('error', reject)
        chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}): ${stderr.trim().slice(-300)}`)))
      }),
    )
    const ws = new WebSocket(endpoint)
    socket = ws
    await within(10_000, 'the DevTools connection', new Promise((resolve) => ws.addEventListener('open', resolve)))
    let next = 0
    const pending = new Map<number, (m: Message) => void>()
    const events: ((m: Message) => void)[] = []
    ws.addEventListener('message', (event) => {
      const m = JSON.parse(String(event.data)) as Message
      if (m.id !== undefined) {
        pending.get(m.id)?.(m)
        pending.delete(m.id)
      } else for (const listener of events) listener(m)
    })
    const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
      within(
        15_000,
        method,
        new Promise((resolve, reject) => {
          const id = ++next
          pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
          ws.send(JSON.stringify({ id, method, params, sessionId }))
        }),
      )
    const { product } = await send('Browser.getVersion')
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const problems: string[] = []
    const blocked: string[] = []
    let loaded: () => void = () => {}
    const load = new Promise<void>((resolve) => (loaded = resolve))
    events.push((m) => {
      if (m.sessionId !== sessionId) return
      if (m.method === 'Page.loadEventFired') loaded()
      else if (m.method === 'Runtime.exceptionThrown')
        problems.push(
          m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text,
        )
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        problems.push(
          m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' '),
        )
      else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        const text = String(m.params.entry.text)
        ;(/Content Security Policy/i.test(text) ? blocked : problems).push(text)
      }
    })
    for (const domain of ['Page', 'Runtime', 'Log']) await send(`${domain}.enable`, {}, sessionId)
    await send('Page.navigate', { url }, sessionId)
    await within(20_000, `the page to load`, load)
    // Past the page half's later pass, 1.5 s after it starts.
    await new Promise((r) => setTimeout(r, 2000))
    const { result } = await send('Runtime.evaluate', { expression: READ_PAGE, returnByValue: true }, sessionId)
    return { chrome: product, ...result.value, problems, blocked }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    socket?.close()
    chrome.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }
}

const SKIP = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.vercel',
  '.wrangler',
  '.astro',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
])
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html)$/
// Any quoted specifier: imports, require, and configuration that names an entry (Nuxt's modules: ['botscent/nuxt']).
const IMPORT = /["'](botscent(?:\/[a-z-]+)?)["']/g
const TAG = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\/botscent(?:\.min)?\.js/i

const installed = (root: string, name: string): string | null => {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

/** The project's frameworks, its botscent imports, and whether a proxy was wrapped or replaced. */
export function scanProject(root: string): Project {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return { skipped: `no package.json in ${root}` }
  }
  const declared = { ...pkg.dependencies, ...pkg.devDependencies }
  const frameworks = ['next', 'nuxt', 'astro', '@sveltejs/kit', 'svelte', 'vue', 'react', 'express', 'hono']
    .filter((name) => name in declared)
    .map((name) => `${name} ${installed(root, name) ?? declared[name]}`)
  const found = new Map<string, string[]>()
  let seen = 0
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (seen > 5000) return
      const path = join(dir, name)
      let stat
      try {
        stat = statSync(path)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        // A directory with its own package.json is another project (--project selects it).
        if (!SKIP.has(name) && !name.startsWith('.') && !existsSync(join(path, 'package.json'))) walk(path)
      } else if (SOURCE.test(name) && stat.size < 1_000_000) {
        seen++
        const text = readFileSync(path, 'utf8')
        const entries = new Set([...text.matchAll(IMPORT)].map((m) => m[1]!))
        if (name.endsWith('.html') && TAG.test(text)) entries.add('botscent.js')
        for (const entry of entries) found.set(entry, [...(found.get(entry) ?? []), relative(root, path)])
      }
    }
  }
  walk(root)
  const imports = [...found].map(
    ([entry, files]) =>
      `${entry} in ${files.slice(0, 2).join(', ')}${files.length > 2 ? ` and ${files.length - 2} more` : ''}`,
  )
  return {
    root,
    botscent: installed(root, 'botscent') ?? declared['botscent'] ?? null,
    frameworks,
    imports,
    proxy: proxyState(root),
  }
}

/** A Next.js proxy or Vercel middleware that uses botscent, compared with its committed version. */
function proxyState(root: string): Proxy | null {
  for (const file of ['proxy', 'middleware', 'src/proxy', 'src/middleware'].flatMap((f) => [`${f}.ts`, `${f}.js`])) {
    let now: string
    try {
      now = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    if (!/["']botscent\/(next|vercel)["']/.test(now)) continue
    // withBotscent(existing), also under an alias: import { withBotscent as wrap } ... wrap(existing).
    const names = ['withBotscent', ...[...now.matchAll(/withBotscent\s+as\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!)]
    if (names.some((name) => new RegExp(`(?<![\\w$.])${name.replaceAll('$', '\\$')}\\(\\s*[^\\s)]`).test(now)))
      return { file, state: 'wrapped' }
    let before: string | null = null
    try {
      before = execFileSync('git', ['-C', root, 'show', `HEAD:./${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {}
    if (before === null) return { file, state: 'new' }
    if (before === now || /["']botscent\//.test(before)) return { file, state: 'unchanged' }
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim()
    if (!code(before)) return { file, state: 'new' }
    // Replaced only when nothing is left but botscent's own lines; any other edit is beyond a text scan.
    const rest = code(now)
      .split('\n')
      .filter((line) => line.trim() && !/["']botscent\/(next|vercel)["']/.test(line))
    return { file, state: rest.length ? 'changed' : 'replaced' }
  }
  return null
}
