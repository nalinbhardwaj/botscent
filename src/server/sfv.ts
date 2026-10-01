// Structured Field Values (RFC 9651): parsing as in section 4.2, and the
// serialisation (section 4.1) that HTTP message signatures need for their
// signature base. A parse failure throws SfError; callers treat it as no evidence.

export class SfError extends Error {}

export type BareItem =
  | { t: 'int' | 'dec' | 'date'; v: number }
  | { t: 'str' | 'tok' | 'dstr'; v: string }
  | { t: 'bin'; v: Uint8Array }
  | { t: 'bool'; v: boolean }
export type Params = Map<string, BareItem>
export type Item = { item: BareItem; params: Params }
export type InnerList = { list: Item[]; params: Params }
export type Member = Item | InnerList
export type Dictionary = Map<string, Member>

class Parser {
  s: string
  i = 0
  constructor(s: string) {
    this.s = s
  }
  peek(): string {
    return this.s[this.i] ?? ''
  }
  fail(why: string): never {
    throw new SfError(`${why} at ${this.i}`)
  }
  sp(): void {
    while (this.s[this.i] === ' ') this.i++
  }
  ows(): void {
    while (this.s[this.i] === ' ' || this.s[this.i] === '\t') this.i++
  }
  done(): boolean {
    return this.i >= this.s.length
  }

  dictionary(): Dictionary {
    const out: Dictionary = new Map()
    while (!this.done()) {
      const key = this.key()
      let member: Member
      if (this.peek() === '=') {
        this.i++
        member = this.memberValue()
      } else member = { item: { t: 'bool', v: true }, params: this.params() }
      out.set(key, member)
      this.ows()
      if (this.done()) return out
      if (this.peek() !== ',') this.fail('expected ,')
      this.i++
      this.ows()
      if (this.done()) this.fail('trailing comma')
    }
    return out
  }

  list(): Member[] {
    const out: Member[] = []
    while (!this.done()) {
      out.push(this.memberValue())
      this.ows()
      if (this.done()) return out
      if (this.peek() !== ',') this.fail('expected ,')
      this.i++
      this.ows()
      if (this.done()) this.fail('trailing comma')
    }
    return out
  }

  memberValue(): Member {
    return this.peek() === '(' ? this.innerList() : this.item()
  }

  innerList(): InnerList {
    this.i++ // (
    const list: Item[] = []
    while (!this.done()) {
      this.sp()
      if (this.peek() === ')') {
        this.i++
        return { list, params: this.params() }
      }
      list.push(this.item())
      const c = this.peek()
      if (c !== ' ' && c !== ')') this.fail('expected space or )')
    }
    this.fail('unterminated inner list')
  }

  item(): Item {
    return { item: this.bareItem(), params: this.params() }
  }

  params(): Params {
    const out: Params = new Map()
    while (this.peek() === ';') {
      this.i++
      this.sp()
      const key = this.key()
      let value: BareItem = { t: 'bool', v: true }
      if (this.peek() === '=') {
        this.i++
        value = this.bareItem()
      }
      out.set(key, value)
    }
    return out
  }

  key(): string {
    const start = this.i
    if (!/[a-z*]/.test(this.peek())) this.fail('key must start with lcalpha or *')
    while (/[a-z0-9_\-.*]/.test(this.peek())) this.i++
    return this.s.slice(start, this.i)
  }

  bareItem(): BareItem {
    const c = this.peek()
    if (c === '-' || (c >= '0' && c <= '9')) return this.number()
    if (c === '"') return { t: 'str', v: this.string() }
    if (/[A-Za-z*]/.test(c)) return this.token()
    if (c === ':') return this.bytes()
    if (c === '?') return this.boolean()
    if (c === '@') return this.date()
    if (c === '%') return this.displayString()
    this.fail('unknown item type')
  }

  number(): BareItem {
    let type: 'int' | 'dec' = 'int'
    let sign = 1
    let num = ''
    if (this.peek() === '-') {
      this.i++
      sign = -1
    }
    if (this.done() || !/[0-9]/.test(this.peek())) this.fail('expected digit')
    while (!this.done()) {
      const c = this.peek()
      if (c >= '0' && c <= '9') num += c
      else if (type === 'int' && c === '.') {
        if (num.length > 12) this.fail('integer part too long')
        num += c
        type = 'dec'
      } else break
      this.i++
      if (type === 'int' && num.length > 15) this.fail('integer too long')
      if (type === 'dec' && num.length > 16) this.fail('decimal too long')
    }
    if (type === 'int') return { t: 'int', v: sign * Number(num) || 0 }
    if (num.endsWith('.')) this.fail('decimal ends with .')
    if (num.length - num.indexOf('.') - 1 > 3) this.fail('too many fractional digits')
    return { t: 'dec', v: sign * Number(num) || 0 }
  }

  string(): string {
    this.i++ // "
    let out = ''
    while (!this.done()) {
      const c = this.s[this.i++]!
      if (c === '\\') {
        if (this.done()) this.fail('dangling escape')
        const next = this.s[this.i++]!
        if (next !== '"' && next !== '\\') this.fail('bad escape')
        out += next
      } else if (c === '"') return out
      else if (c < ' ' || c > '~') this.fail('bad string character')
      else out += c
    }
    this.fail('unterminated string')
  }

  token(): BareItem {
    const start = this.i
    this.i++
    while (/[!#$%&'*+\-.^_`|~0-9A-Za-z:/]/.test(this.peek())) this.i++
    return { t: 'tok', v: this.s.slice(start, this.i) }
  }

  bytes(): BareItem {
    this.i++ // :
    const end = this.s.indexOf(':', this.i)
    if (end < 0) this.fail('unterminated byte sequence')
    const b64 = this.s.slice(this.i, end)
    this.i = end + 1
    if (!/^[A-Za-z0-9+/=]*$/.test(b64)) this.fail('bad base64')
    return { t: 'bin', v: base64Decode(b64) ?? this.fail('bad base64') }
  }

  boolean(): BareItem {
    this.i++ // ?
    const c = this.s[this.i++]
    if (c === '1') return { t: 'bool', v: true }
    if (c === '0') return { t: 'bool', v: false }
    this.fail('bad boolean')
  }

  date(): BareItem {
    this.i++ // @
    const n = this.number()
    if (n.t !== 'int') this.fail('date must be an integer')
    return { t: 'date', v: n.v }
  }

  displayString(): BareItem {
    this.i++ // %
    if (this.s[this.i++] !== '"') this.fail('expected "')
    const bytes: number[] = []
    while (!this.done()) {
      const c = this.s[this.i++]!
      if (c < ' ' || c > '~') this.fail('bad display string character')
      if (c === '%') {
        const hex = this.s.slice(this.i, this.i + 2)
        if (!/^[0-9a-f]{2}$/.test(hex)) this.fail('bad percent escape')
        bytes.push(parseInt(hex, 16))
        this.i += 2
      } else if (c === '"') {
        try {
          return { t: 'dstr', v: new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)) }
        } catch {
          this.fail('display string is not UTF-8')
        }
      } else bytes.push(c.charCodeAt(0))
    }
    this.fail('unterminated display string')
  }
}

function parseWith<T>(input: string, run: (p: Parser) => T): T {
  const p = new Parser(input.replace(/^ +/, '').replace(/ +$/, ''))
  const out = run(p)
  p.sp()
  if (!p.done()) p.fail('trailing characters')
  return out
}

export const parseDictionary = (input: string): Dictionary => parseWith(input, (p) => p.dictionary())
export const parseList = (input: string): Member[] => parseWith(input, (p) => p.list())
export const parseItem = (input: string): Item => parseWith(input, (p) => p.item())

/** Standard or unpadded base64 to bytes; null when the input cannot be base64. */
export function base64Decode(b64: string): Uint8Array | null {
  const body = b64.replace(/=+$/, '')
  if (/[^A-Za-z0-9+/]/.test(body) || body.length % 4 === 1) return null
  try {
    const bin = atob(body + '='.repeat((4 - (body.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function serializeBareItem(b: BareItem): string {
  switch (b.t) {
    case 'int':
      return String(b.v)
    case 'dec': {
      const s = (Math.round(b.v * 1000) / 1000).toString()
      return s.includes('.') ? s : `${s}.0`
    }
    case 'str':
      return `"${b.v.replace(/[\\"]/g, (c) => `\\${c}`)}"`
    case 'tok':
      return b.v
    case 'bin':
      return `:${base64Encode(b.v)}:`
    case 'bool':
      return b.v ? '?1' : '?0'
    case 'date':
      return `@${b.v}`
    case 'dstr': {
      let out = '%"'
      for (const byte of new TextEncoder().encode(b.v)) {
        const c = String.fromCharCode(byte)
        out +=
          byte === 0x25 || byte === 0x22 || byte < 0x20 || byte > 0x7e ? `%${byte.toString(16).padStart(2, '0')}` : c
      }
      return `${out}"`
    }
  }
}

export function serializeParams(params: Params): string {
  let out = ''
  for (const [key, value] of params)
    out += value.t === 'bool' && value.v ? `;${key}` : `;${key}=${serializeBareItem(value)}`
  return out
}

export function serializeMember(m: Member): string {
  if ('list' in m) return `(${m.list.map(serializeMember).join(' ')})${serializeParams(m.params)}`
  return serializeBareItem(m.item) + serializeParams(m.params)
}
