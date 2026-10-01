// The vertical slice as one command: pack both packages, install the example apps
// from those artifacts (never from source), build them, and run the browser tests.
import { execFileSync } from 'node:child_process'
import { copyFileSync, readdirSync, rmSync } from 'node:fs'

const root = new URL('../', import.meta.url).pathname
const run = (command: string, args: string[], cwd = root) => {
  console.log(`$ (${cwd.replace(root, '') || '.'}) ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

run('npm', ['pack', '--silent', '--pack-destination', 'examples'])
const tarball = readdirSync(`${root}examples`).find((f) => /^botscent-.*\.tgz$/.test(f))!
copyFileSync(`${root}examples/${tarball}`, `${root}examples/botscent.tgz`)
rmSync(`${root}examples/${tarball}`)
rmSync(`${root}python/dist`, { recursive: true, force: true })
run('uv', ['build', '-q'], `${root}python`)
const wheel = readdirSync(`${root}python/dist`).find((f) => f.endsWith('.whl'))!

run('npm', ['install', '--no-audit', '--no-fund', '--force', '../botscent.tgz'], `${root}examples/next`)
run('node_modules/.bin/next', ['build'], `${root}examples/next`)
run('uv', ['venv', '-q', '--allow-existing', '.venv'], `${root}examples/fastapi`)
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
    'fastapi',
    'uvicorn',
    'python-multipart',
    `../../python/dist/${wheel}`,
  ],
  `${root}examples/fastapi`,
)
run(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=90000', 'examples/test/slice.test.ts'])
