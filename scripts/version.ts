// Runs after `changeset version`: carries package.json's new version into the
// Python package, the generated modules and python/uv.lock, so that the npm and
// PyPI releases cut from one tag share one version.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url).pathname
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string }
// Only plain releases: a prerelease's npm spelling (1.0.0-next.0) is not PEP 440's (1.0.0rc0).
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a plain release version: ${version}`)
const pyproject = `${root}python/pyproject.toml`
const text = readFileSync(pyproject, 'utf8')
if (!/^version = "[^"]*"$/m.test(text)) throw new Error('python/pyproject.toml has no version line')
writeFileSync(pyproject, text.replace(/^version = "[^"]*"$/m, `version = "${version}"`))
execFileSync(process.execPath, ['scripts/generate.ts'], { cwd: root, stdio: 'inherit' })
execFileSync('uv', ['lock', '--quiet'], { cwd: `${root}python`, stdio: 'inherit' })
console.log(`version ${version}: package.json, python/pyproject.toml, the generated modules and python/uv.lock`)
