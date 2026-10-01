// The verdict and the one decision every half shares: from a set of evidence to
// { type, agent_name?, reasons }. Pure; no I/O, no globals.
import { REASONS, type KnownReason } from '../generated/core.ts'

export type Reason = KnownReason | (string & {})

export type Verdict = {
  readonly type: 'agent' | 'human'
  readonly agent_name?: string
  readonly reasons: readonly Reason[]
}

/** One observation that counts as agent evidence. `name` is set only by an
 * identity-grade source, whose class decides precedence (contract section 4). */
export type Evidence = {
  reason: Reason
  name?: string
  source?: 'declaration' | 'shape'
}

export const HUMAN: Verdict = Object.freeze({ type: 'human', reasons: Object.freeze([]) as readonly Reason[] })

const RANK = new Map<string, number>(REASONS.map((id, i) => [id, i]))

/** Reasons in catalogue order; reasons this version does not know keep their
 * relative order after the known ones. Duplicates are dropped. */
export function ordered(reasons: Iterable<Reason>): Reason[] {
  const seen = new Set<string>()
  const known: Reason[] = []
  const unknown: Reason[] = []
  for (const r of reasons) {
    if (seen.has(r)) continue
    seen.add(r)
    ;(RANK.has(r) ? known : unknown).push(r)
  }
  known.sort((a, b) => RANK.get(a)! - RANK.get(b)!)
  return [...known, ...unknown]
}

export type Naming = { name?: string; why: string }

/** The naming rule: declarations first, and only when they all agree; product
 * shapes only when no declaration names; generic evidence never names. */
export function nameOf(evidence: Iterable<Evidence>): Naming {
  const declared = new Set<string>()
  const shaped = new Set<string>()
  for (const e of evidence) {
    if (!e.name) continue
    if (e.source === 'declaration') declared.add(e.name)
    else if (e.source === 'shape') shaped.add(e.name)
  }
  const pick = (names: Set<string>, kind: string): Naming => {
    const list = [...names].sort()
    return list.length === 1
      ? { name: list[0]!, why: `${kind} ${list[0]}` }
      : { why: `${kind}s disagree: ${list.join(', ')}` }
  }
  if (declared.size) return pick(declared, 'declaration')
  if (shaped.size) return pick(shaped, 'shape')
  return { why: 'no identity-grade evidence' }
}

export function makeVerdict(reasons: readonly Reason[], name?: string): Verdict {
  if (reasons.length === 0) return HUMAN
  const frozen = Object.freeze([...reasons])
  // Key order matters for byte-identical JSON across languages: type, agent_name, reasons.
  return Object.freeze(name ? { type: 'agent', agent_name: name, reasons: frozen } : { type: 'agent', reasons: frozen })
}

export function decide(evidence: readonly Evidence[]): Verdict {
  if (evidence.length === 0) return HUMAN
  return makeVerdict(ordered(evidence.map((e) => e.reason)), nameOf(evidence).name)
}

/** True exactly when the request itself was verified: by a Web Bot Auth
 * signature against a bundled key, or by the hosting platform. A reason with
 * the `page.` prefix never counts. */
export function isVerified(verdict: Verdict | null | undefined): boolean {
  if (!verdict || !Array.isArray(verdict.reasons)) return false
  return (
    verdict.reasons.includes('signer.web-bot-auth.verified') || verdict.reasons.includes('signer.edge-verified-bot')
  )
}

/** Adds a page report's evidence to the request's. The report's reasons
 * already carry the `page.` prefix (readReport adds it). */
export function combine(request: Verdict, report: Verdict | null | undefined): Verdict {
  if (!report || report.reasons.length === 0) return request
  const reasons: Reason[] = [...request.reasons]
  for (const r of report.reasons) if (!reasons.includes(r)) reasons.push(r)
  return makeVerdict(reasons, request.agent_name ?? report.agent_name)
}
