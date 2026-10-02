// The page's joint rules, and the debug note that says why a held signal does not count yet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceOf, R, waiting } from '../src/page/rules.ts'

test('a joint signal alone is no evidence, and the debug note says what it waits for', () => {
  const codex = new Set<string>([R.prompt])
  assert.deepEqual(evidenceOf(codex), [])
  assert.equal(waiting(codex, R.prompt), '; Codex shell 1 of 3, counts at 2')
  codex.add(R.overlay)
  assert.equal(evidenceOf(codex).length, 2)
  assert.equal(waiting(codex, R.overlay), '')
  const instinct = new Set<string>([R.geetest])
  assert.deepEqual(evidenceOf(instinct), [])
  assert.equal(waiting(instinct, R.geetest), `; counts only with ${R.wrappers}`)
  instinct.add(R.wrappers)
  assert.equal(waiting(instinct, R.wrappers), '')
  assert.equal(waiting(new Set([R.webdriver]), R.webdriver), '')
})
