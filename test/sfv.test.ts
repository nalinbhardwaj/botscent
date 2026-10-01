// RFC 9651 conformance against the HTTP working group's published test suite
// (test/fixtures/sfv, from github.com/httpwg/structured-field-tests; see its LICENSE.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import {
  parseDictionary,
  parseItem,
  parseList,
  serializeMember,
  serializeParams,
  type BareItem,
  type Member,
  type Params,
} from '../src/server/sfv.ts'

type Case = {
  name: string
  raw: string[]
  header_type: 'item' | 'list' | 'dictionary'
  expected?: unknown
  must_fail?: boolean
  can_fail?: boolean
  canonical?: string[]
}

function base32(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  while (out.length % 8) out += '='
  return out
}

const bare = (b: BareItem): unknown => {
  switch (b.t) {
    case 'tok':
      return { __type: 'token', value: b.v }
    case 'bin':
      return { __type: 'binary', value: base32(b.v) }
    case 'date':
      return { __type: 'date', value: b.v }
    case 'dstr':
      return { __type: 'displaystring', value: b.v }
    default:
      return b.v
  }
}
const params = (p: Params) => [...p].map(([k, v]) => [k, bare(v)])
const member = (m: Member): unknown =>
  'list' in m
    ? [m.list.map((i) => [bare(i.item), params(i.params)]), params(m.params)]
    : [bare(m.item), params(m.params)]

const serializeDictionary = (d: Map<string, Member>) =>
  [...d]
    .map(([k, m]) =>
      !('list' in m) && m.item.t === 'bool' && m.item.v ? k + serializeParams(m.params) : `${k}=${serializeMember(m)}`,
    )
    .join(', ')

const dir = new URL('./fixtures/sfv/', import.meta.url)
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  test(`structured fields: ${file}`, () => {
    const cases = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Case[]
    let checked = 0
    for (const c of cases) {
      const input = c.raw.join(', ')
      let parsed: unknown
      let serialized: string
      try {
        if (c.header_type === 'dictionary') {
          const d = parseDictionary(input)
          parsed = [...d].map(([k, m]) => [k, member(m)])
          serialized = serializeDictionary(d)
        } else if (c.header_type === 'list') {
          const l = parseList(input)
          parsed = l.map(member)
          serialized = l.map(serializeMember).join(', ')
        } else {
          const i = parseItem(input)
          parsed = member(i)
          serialized = serializeMember(i)
        }
      } catch (error) {
        if (c.must_fail || c.can_fail) continue
        assert.fail(`${c.name}: ${JSON.stringify(input)} threw ${error}`)
      }
      assert.ok(!c.must_fail, `${c.name}: ${JSON.stringify(input)} must fail`)
      assert.deepEqual(parsed, c.expected, c.name)
      if (c.canonical) assert.equal(serialized, c.canonical.join(', '), `${c.name}: canonical form`)
      checked++
    }
    assert.ok(checked > 0 || cases.every((c) => c.must_fail))
  })
}
