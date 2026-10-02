// The vertical slice as one command: pack both packages, install the example apps
// from those artifacts (never from source), build them, and run the browser tests.
import { execFileSync } from 'node:child_process'
import { copyFileSync, readdirSync, rmSync } from 'node:fs'

const root = new URL('../', import.meta.url).pathname
const run = (command: string, args: string[], cwd = root, env: Record<string, string> = {}) => {
  console.log(`$ (${cwd.replace(root, '') || '.'}) ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

run('npm', ['pack', '--silent', '--pack-destination', 'examples'])
const tarball = readdirSync(`${root}examples`).find((f) => /^botscent-.*\.tgz$/.test(f))!
copyFileSync(`${root}examples/${tarball}`, `${root}examples/botscent.tgz`)
rmSync(`${root}examples/${tarball}`)
rmSync(`${root}python/dist`, { recursive: true, force: true })
run('uv', ['build', '-q'], `${root}python`)
const wheel = readdirSync(`${root}python/dist`).find((f) => f.endsWith('.whl'))!

const install = (example: string) =>
  run('npm', ['install', '--no-audit', '--no-fund', '--force', '../botscent.tgz'], `${root}examples/${example}`)
// The minimal quickstarts, type-checked as a consumer sees them: the packed types against the framework's own.
const quickstart = (example: string, files: string[]) =>
  run(
    `${root}node_modules/.bin/tsc`,
    [
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'nodenext',
      '--target',
      'es2022',
      ...files,
    ],
    `${root}examples/${example}`,
  )
install('next')
quickstart('next', ['quickstart/proxy.ts', 'quickstart/middleware.ts', 'quickstart/instrumentation-client.ts'])
run('node_modules/.bin/next', ['build'], `${root}examples/next`)
install('astro')
quickstart('astro', ['quickstart.config.ts'])
run('node_modules/.bin/astro', ['build'], `${root}examples/astro`, { BOTSCENT_EXAMPLE_TRANSPORT: 'always' })
install('nuxt')
run('node_modules/.bin/nuxt', ['build'], `${root}examples/nuxt`, { NUXT_TELEMETRY_DISABLED: '1' })
install('sveltekit')
run('node_modules/.bin/vite', ['build'], `${root}examples/sveltekit`)
install('vue')
run('node_modules/.bin/vite', ['build'], `${root}examples/vue`)
install('react')
run('node_modules/.bin/vite', ['build'], `${root}examples/react`)
for (const example of ['express', 'hono', 'workers', 'vercel', 'script']) install(example)
// Each Python example gets its own environment with the built wheel.
for (const [example, packages] of [
  ['fastapi', ['fastapi', 'uvicorn', 'python-multipart']],
  ['django', ['django']],
  ['flask', ['flask']],
] as const) {
  run('uv', ['venv', '-q', '--allow-existing', '.venv'], `${root}examples/${example}`)
  run(
    'uv',
    [
      'pip',
      'install',
      '-q',
      '--python',
      '.venv/bin/python',
      '--reinstall-package',
      'botscent',
      ...packages,
      `../../python/dist/${wheel}`,
    ],
    `${root}examples/${example}`,
  )
}
run(process.execPath, [
  '--test',
  '--test-reporter=spec',
  '--test-timeout=90000',
  'examples/test/slice.test.ts',
  'examples/test/astro.test.ts',
  'examples/test/nuxt.test.ts',
  'examples/test/servers.test.ts',
  'examples/test/pages.test.ts',
  'examples/test/check.test.ts',
])
