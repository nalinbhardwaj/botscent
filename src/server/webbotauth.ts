// Web Bot Auth (draft-ietf-webbotauth-httpsig-protocol-00 over RFC 9421):
// find each signature tagged web-bot-auth, attribute it to the Signature-Agent
// member it covers, and verify it against the keys bundled in the release.
// Never throws: anything unexpected is a signature that did not verify.
import type { SignerKey } from '../generated/server.ts'
import type { Log } from './log.ts'
import type { RequestView } from './request.ts'
import {
  parseDictionary,
  parseItem,
  serializeMember,
  type Dictionary,
  type InnerList,
  type Item,
  type Member,
} from './sfv.ts'

export type Registry = {
  signers: Readonly<Record<string, string>>
  keys: Readonly<Record<string, readonly SignerKey[]>>
  tokens: readonly (readonly [token: string, name: string])[]
}

export type Signature = {
  label: string
  /** The asserted signer: the https origin's host, or null when there is none. */
  host: string | null
  /** The registry name for that host. */
  name: string | undefined
  verified: boolean
  /** "verified", or why it did not verify. */
  why: string
}

const str = (m: Member | undefined): string | null => (m && 'item' in m && m.item.t === 'str' ? m.item.v : null)
const int = (m: Item['params'], key: string): number | null => {
  const v = m.get(key)
  return v && v.t === 'int' ? v.v : null
}
const param = (m: Item['params'], key: string): string | null => {
  const v = m.get(key)
  return v && (v.t === 'str' || v.t === 'tok') ? v.v : null
}

/** The host of a Signature-Agent value when it is an https origin, else null. */
function originHost(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    return url.host
  } catch {
    return null
  }
}

const keyCache = new Map<string, Promise<CryptoKey | null>>()
function importKey(x: string): Promise<CryptoKey | null> {
  let key = keyCache.get(x)
  if (!key) {
    key = Promise.resolve()
      .then(() =>
        globalThis.crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x }, { name: 'Ed25519' }, false, [
          'verify',
        ]),
      )
      .catch(() => null)
    keyCache.set(x, key)
  }
  return key
}

/** The value of one covered component, or an error string. */
function componentValue(req: RequestView, c: Item): string | { error: string } {
  const name = c.item.t === 'str' ? c.item.v : null
  if (name === null) return { error: 'a component identifier is not a string' }
  for (const p of c.params.keys()) if (p !== 'key') return { error: `unsupported component parameter ;${p} on ${name}` }
  const key = param(c.params, 'key')
  if (name.startsWith('@')) {
    if (key !== null) return { error: `;key on derived component ${name}` }
    switch (name) {
      case '@method':
        return req.method
      case '@authority':
        return req.authority ?? { error: 'no authority on the request' }
      case '@scheme':
        return req.url ? req.url.protocol.slice(0, -1) : { error: 'scheme unknown' }
      case '@target-uri':
        return req.url ? req.url.href : { error: 'target URI unknown' }
      case '@path':
        return req.url ? req.url.pathname : req.target ? req.target.split('?')[0]! : { error: 'path unknown' }
      case '@query':
        if (req.url) return req.url.search || '?'
        if (req.target) return req.target.includes('?') ? req.target.slice(req.target.indexOf('?')) : '?'
        return { error: 'query unknown' }
      default:
        return { error: `unsupported derived component ${name}` }
    }
  }
  const field = req.header(name)
  if (field === null) return { error: `covered field ${name} is absent` }
  if (key === null) return field.trim()
  try {
    const member = parseDictionary(field).get(key)
    return member ? serializeMember(member) : { error: `covered member ${name};key="${key}" is absent` }
  } catch {
    return { error: `covered field ${name} is not a dictionary` }
  }
}

export async function verifySignatures(
  req: RequestView,
  nowMs: number,
  registry: Registry,
  log: Log,
): Promise<Signature[]> {
  const inputHeader = req.header('signature-input')
  const signatureHeader = req.header('signature')
  if (inputHeader === null || signatureHeader === null) return []
  let inputs: Dictionary
  let signatures: Dictionary
  try {
    inputs = parseDictionary(inputHeader)
    signatures = parseDictionary(signatureHeader)
  } catch (error) {
    log?.(`signature headers do not parse (${(error as Error).message}): no evidence`)
    return []
  }
  // Signature-Agent: a dictionary, or the legacy bare string (contract section 7).
  const agentHeader = req.header('signature-agent')
  let agents: Dictionary | null = null
  let legacy: string | null = null
  if (agentHeader !== null) {
    try {
      if (agentHeader.trimStart().startsWith('"')) legacy = str(parseItem(agentHeader))
      else agents = parseDictionary(agentHeader)
    } catch {
      log?.('Signature-Agent does not parse')
    }
  }

  const out: Signature[] = []
  for (const [label, member] of inputs) {
    if (!('list' in member) || param(member.params, 'tag') !== 'web-bot-auth') continue
    const result = await one(req, nowMs, registry, label, member, signatures, agents, legacy)
    log?.(
      `signature ${label}: signer ${result.host ?? '(none)'}${result.name ? ` (${result.name})` : ''} ${result.verified ? 'verified' : `declared: ${result.why}`}`,
    )
    out.push(result)
  }
  return out
}

async function one(
  req: RequestView,
  nowMs: number,
  registry: Registry,
  label: string,
  input: InnerList,
  signatures: Dictionary,
  agents: Dictionary | null,
  legacy: string | null,
): Promise<Signature> {
  // Attribution: the Signature-Agent member this signature covers; for naming
  // alone, the member under its own label (or the only member) when it covers none.
  const covered = input.list.find((c) => c.item.t === 'str' && c.item.v === 'signature-agent')
  const coveredKey = covered ? param(covered.params, 'key') : null
  let agentValue: string | null = null
  let agentMember: Member | undefined
  if (legacy !== null) agentValue = legacy
  else if (agents) {
    agentMember =
      coveredKey !== null
        ? agents.get(coveredKey)
        : (agents.get(label) ?? (agents.size === 1 ? [...agents.values()][0] : undefined))
    const type = agentMember && 'item' in agentMember ? agentMember.params.get('type') : undefined
    if (!type || (type.t === 'tok' && type.v === 'directory')) agentValue = str(agentMember)
  }
  const host = originHost(agentValue)
  const name = host ? registry.signers[host] : undefined
  const fail = (why: string): Signature => ({ label, host, name, verified: false, why })

  try {
    if (!host) return fail('no https Signature-Agent origin for this signature')
    const keys = registry.keys[host]
    if (!keys) return fail('signer not in the bundled registry')
    const components = input.list.map((c) => (c.item.t === 'str' ? c.item.v : ''))
    if (!components.includes('@authority') && !components.includes('@target-uri'))
      return fail('covers neither @authority nor @target-uri')
    if (!covered) return fail('Signature-Agent is not covered')
    if (legacy === null && coveredKey === null && agents && agents.size !== 1)
      return fail('Signature-Agent is covered whole but has several members')
    const keyid = param(input.params, 'keyid')
    const created = int(input.params, 'created')
    const expires = int(input.params, 'expires')
    const alg = param(input.params, 'alg')
    if (alg !== null && alg !== 'ed25519') return fail(`alg ${alg} is not ed25519`)
    if (keyid === null || created === null || expires === null) return fail('keyid, created or expires is missing')
    const key = keys.find((k) => k.thumbprint === keyid || k.kid === keyid)
    if (!key) return fail(`keyid ${keyid} is not in the bundled directory`)
    const now = nowMs / 1000
    if (now < created || now > expires)
      return fail(
        `outside its window: created ${Math.round(now - created)} s ago, expires ${Math.round(expires - now)} s from now`,
      )
    if ((key.nbf !== null && created < key.nbf) || (key.exp !== null && created > key.exp))
      return fail('the key was not valid when the signature was created')
    const value = signatures.get(label)
    if (!value || !('item' in value) || value.item.t !== 'bin') return fail('no Signature member for this label')
    const bytes = value.item.v
    if (bytes.length !== 64) return fail('the signature is not 64 bytes')

    const lines: string[] = []
    for (const c of input.list) {
      const v = componentValue(req, c)
      if (typeof v !== 'string') return fail(v.error)
      lines.push(`${serializeMember(c)}: ${v}`)
    }
    lines.push(`"@signature-params": ${serializeMember(input)}`)
    const cryptoKey = await importKey(key.x)
    if (!cryptoKey) return fail('Ed25519 is not available in this runtime')
    const ok = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      cryptoKey,
      bytes as Uint8Array<ArrayBuffer>,
      new TextEncoder().encode(lines.join('\n')),
    )
    return ok
      ? { label, host, name, verified: true, why: 'verified' }
      : fail(`the signature does not verify over ${components.join(', ')}`)
  } catch (error) {
    return fail(`verification failed: ${(error as Error)?.message ?? error}`)
  }
}
