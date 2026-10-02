// check's observations without a browser: the project scan against real git
// repositories (a proxy replaced, wrapped, new or unchanged; nested projects left
// alone) and the two requests against a local server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromeCandidates, request, scanProject } from '../src/check/probe.ts'

function project(files: Record<string, string>, committed: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'botscent-project-'))
  const write = (all: Record<string, string>) => {
    for (const [path, text] of Object.entries(all)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), text)
    }
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  write({ 'package.json': JSON.stringify({ dependencies: { next: '16.3.8', botscent: '^1.0.0' } }), ...committed })
  git('add', '-A')
  git('commit', '-q', '-m', 'before')
  write(files)
  return root
}
const AUTH = `import { NextResponse } from 'next/server'\nexport function proxy(request) {\n  if (!request.cookies.has('session')) return NextResponse.redirect(new URL('/login', request.url))\n}\n`

test("an agent replaced the application's own proxy: replaced", () => {
  const root = project({ 'proxy.ts': "export { proxy } from 'botscent/next'\n" }, { 'proxy.ts': AUTH })
  const p = scanProject(root)
  assert.ok(!('skipped' in p))
  assert.deepEqual(p.proxy, { file: 'proxy.ts', state: 'replaced' })
  assert.deepEqual(p.imports, ['botscent/next in proxy.ts'])
  assert.deepEqual(p.frameworks, ['next 16.3.8'])
})

test('wrapped, new and unchanged proxies', () => {
  const wrapped = `import { withBotscent } from 'botscent/next'\nimport { auth } from './auth'\nexport const proxy = withBotscent(auth)\n`
  const w = scanProject(project({ 'src/middleware.ts': wrapped }, { 'src/middleware.ts': AUTH }))
  assert.ok(!('skipped' in w))
  assert.deepEqual(w.proxy, { file: 'src/middleware.ts', state: 'wrapped' })
  const n = scanProject(project({ 'proxy.ts': "export { proxy } from 'botscent/next'\n" }))
  assert.ok(!('skipped' in n))
  assert.deepEqual(n.proxy, { file: 'proxy.ts', state: 'new' })
  const same = "export { default } from 'botscent/vercel'\n"
  const u = scanProject(project({}, { 'middleware.ts': same }))
  assert.ok(!('skipped' in u))
  assert.deepEqual(u.proxy, { file: 'middleware.ts', state: 'unchanged' })
})

test('a wrap under another name is a wrap; an edit a scan cannot judge is changed, not replaced', () => {
  const alias = `import { withBotscent as wrap } from 'botscent/next'\nimport { auth } from './auth'\nexport const proxy = wrap(auth)\n`
  const a = scanProject(project({ 'proxy.ts': alias }, { 'proxy.ts': AUTH }))
  assert.ok(!('skipped' in a))
  assert.deepEqual(a.proxy, { file: 'proxy.ts', state: 'wrapped' })
  const moved = `import { proxy as botscent } from 'botscent/next'\nimport { gate } from './gate'\nexport async function proxy(r) {\n  return (await gate(r)) ?? botscent(r)\n}\n`
  const m = scanProject(project({ 'proxy.ts': moved }, { 'proxy.ts': AUTH }))
  assert.ok(!('skipped' in m))
  assert.deepEqual(m.proxy, { file: 'proxy.ts', state: 'changed' })
})

test("Nuxt's documented install, modules: ['botscent/nuxt'], is found", () => {
  const root = project({ 'nuxt.config.ts': "export default defineNuxtConfig({ modules: ['botscent/nuxt'] })\n" })
  const p = scanProject(root)
  assert.ok(!('skipped' in p))
  assert.deepEqual(p.imports, ['botscent/nuxt in nuxt.config.ts'])
})

test('imports are grouped by entry; a script tag counts; nested projects are left to --project', () => {
  const root = project({
    'app/a.tsx': "import { useBotscent } from 'botscent/react'",
    'app/b.tsx': "import { useBotscent } from 'botscent/react'",
    'app/c.tsx': "import { headers } from 'botscent'\nimport { useBotscent } from 'botscent/react'",
    'public/index.html': '<script defer src="/botscent.js"></script>',
    'packages/other/package.json': '{}',
    'packages/other/index.ts': "import 'botscent/auto'",
    'node_modules/x/index.js': "import 'botscent/auto'",
  })
  const p = scanProject(root)
  assert.ok(!('skipped' in p))
  assert.deepEqual(p.imports.sort(), [
    'botscent in app/c.tsx',
    'botscent.js in public/index.html',
    'botscent/react in app/a.tsx, app/b.tsx and 1 more',
  ])
  assert.deepEqual(scanProject(join(root, 'missing')), { skipped: `no package.json in ${join(root, 'missing')}` })
})

test("the two requests: check's own token, then an empty user agent, both as navigations", async () => {
  const seen: IncomingHttpHeaders[] = []
  const server = createServer((req, res) => {
    seen.push(req.headers)
    res.writeHead(200, {
      'content-type': 'text/html',
      'server-timing': 'app;dur=1, botscent;desc="1;botscent-check;1;ua.declared-agent-token"',
      'set-cookie': 'session=secret',
      'x-vercel-cache': 'MISS',
    })
    res.end(
      '<script src="/_next/static/a.js"></script><script defer src="https://cdn.example/botscent.js?v=1"></script>',
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/shop?ref=1`
  try {
    const own = await request(url, 'botscent-check/1.0.0')
    await request(url, '')
    assert.ok(!('error' in own))
    assert.equal(own.headers['server-timing'], 'app;dur=1, botscent;desc="1;botscent-check;1;ua.declared-agent-token"')
    assert.equal(own.headers['set-cookie'], undefined, 'cookies are never read')
    assert.equal(own.headers['x-vercel-cache'], 'MISS')
    assert.deepEqual(own.scripts, [
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/_next/static/a.js`,
      'https://cdn.example/botscent.js?v=1',
    ])
    assert.deepEqual(own.markers, ['next'])
    assert.equal(seen[0]!['user-agent'], 'botscent-check/1.0.0')
    assert.equal(seen[1]!['user-agent'], '', 'no agent evidence, and not the default "node" token')
    for (const h of seen) assert.equal(h['sec-fetch-dest'], 'document')
  } finally {
    server.close()
  }
  // A port that was opened and closed without a connection: nothing answers there.
  const closed = createServer()
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
  const port = (closed.address() as AddressInfo).port
  await new Promise((resolve) => closed.close(resolve))
  assert.deepEqual(await request(`http://127.0.0.1:${port}/`, ''), { error: 'ECONNREFUSED' })
})

test("browser discovery looks in each platform's own places", () => {
  const none = '/nonexistent-playwright-cache'
  const linux = chromeCandidates('linux', { PLAYWRIGHT_BROWSERS_PATH: none }, '/home/u')
  assert.ok(linux.includes('/usr/bin/chromium'), linux.join('\n'))
  assert.ok(linux.includes('/usr/bin/google-chrome'))
  const win = chromeCandidates(
    'win32',
    { PROGRAMFILES: 'C:\\Program Files', PLAYWRIGHT_BROWSERS_PATH: none },
    'C:\\Users\\u',
  )
  assert.ok(win.some((p) => p.endsWith('chrome.exe')))
  assert.ok(!win.some((p) => p.startsWith('/usr/bin/')))
  const mac = chromeCandidates('darwin', { PLAYWRIGHT_BROWSERS_PATH: none }, '/Users/u', '/x/chrome')
  assert.equal(mac[0], '/x/chrome')
  assert.ok(mac.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
})
