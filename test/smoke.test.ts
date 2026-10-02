import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VERSION } from '../src/index.ts'

test('VERSION is the package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, pkg.version)
})

test('botscent/names.json: every registry name, with display name, vendor and kind only', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['./names.json'], './dist/names.json')
  const shipped = JSON.parse(readFileSync(new URL('../src/generated/names.json', import.meta.url), 'utf8'))
  const { names } = JSON.parse(readFileSync(new URL('../registry/names.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(shipped), Object.keys(names))
  for (const value of Object.values(shipped))
    assert.deepEqual(Object.keys(value as object), ['display', 'vendor', 'kind'])
})

test('the page entry and the script build expose exactly the reviewed surface', async () => {
  const page = await import('../src/index.ts')
  assert.deepEqual(Object.keys(page).sort(), [
    'VERSION',
    'diagnostics',
    'reportHeaders',
    'start',
    'subscribe',
    'verdict',
  ])
  const server = await import('../src/server/index.ts')
  assert.deepEqual(Object.keys(server).sort(), ['VERSION', 'combine', 'inspect', 'isVerified', 'readReport'])
})

test('one version, spelled for npm and for PyPI', async () => {
  const { pep440 } = await import('../scripts/pep440.ts')
  assert.equal(pep440('1.0.0'), '1.0.0')
  assert.equal(pep440('1.0.0-rc.0'), '1.0.0rc0')
  assert.equal(pep440('2.1.0-beta.3'), '2.1.0b3')
  assert.equal(pep440('2.1.0-alpha.1'), '2.1.0a1')
  assert.throws(() => pep440('1.0.0-next.0'))
})
