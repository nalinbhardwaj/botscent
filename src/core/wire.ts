// The wire grammar shared by the Server-Timing entry and the page report
// (contract section 9), and readReport, which turns a report into a verdict.
import { makeVerdict, type Verdict } from './verdict.ts'

export const WIRE_VERSION = '1'
export const WIRE_MAX = 256

const ENTRY =
  /^([0-9]{1,3})(?:\.[0-9]{1,3})?;([a-z0-9-]{0,64});([0-9]{0,15});([a-z0-9._-]{1,80}(?:,[a-z0-9._-]{1,80})*)(?:;[\x21-\x3a\x3c-\x7e]*)*$/
const NAME = /^[a-z0-9-]{1,64}$/
const REASON = /^[a-z0-9._-]{1,80}$/

export type Entry = { name?: string; time?: number; reasons: string[] }

/** The entry for an agent verdict, or null for a person. A name or reason that
 * cannot travel is left out, and reasons are dropped from the end (the weakest)
 * until the entry fits in WIRE_MAX bytes. */
export function encode(verdict: Verdict, time?: number): string | null {
  if (verdict.type !== 'agent') return null
  const name = verdict.agent_name && NAME.test(verdict.agent_name) ? verdict.agent_name : ''
  const stamp =
    typeof time === 'number' && Number.isFinite(time) && time >= 0 ? String(Math.floor(time)).slice(0, 15) : ''
  const head = `${WIRE_VERSION};${name};${stamp};`
  let body = ''
  for (const reason of verdict.reasons) {
    if (!REASON.test(reason)) continue
    const next = body ? `${body},${reason}` : reason
    if (head.length + next.length > WIRE_MAX) break
    body = next
  }
  return body ? head + body : null
}

/** Parses an entry; null for anything malformed, over-long or of another major version. */
export function decode(value: unknown): Entry | null {
  if (typeof value !== 'string' || value.length > WIRE_MAX) return null
  const m = ENTRY.exec(value)
  if (!m || Number(m[1]) !== Number(WIRE_VERSION)) return null
  const entry: Entry = { reasons: [...new Set(m[4]!.split(','))] }
  if (m[2]) entry.name = m[2]
  if (m[3]) entry.time = Number(m[3])
  return entry
}

/** A page report as a verdict whose reasons carry the `page.` prefix, or null.
 * Accepts the wire string (from the header or the form field) or a verdict
 * object passed as an argument, which is held to the same grammar. */
// Typed as the contract states it; the value is still checked, since a report comes from the page.
export function readReport(value: string | Verdict | null | undefined): Verdict | null {
  let entry: Entry | null = null
  if (typeof value === 'string') entry = decode(value)
  else if (value && typeof value === 'object') {
    const v = value as { type?: unknown; agent_name?: unknown; reasons?: unknown }
    if (v.type !== 'agent' || !Array.isArray(v.reasons) || !v.reasons.every((r) => typeof r === 'string')) return null
    if (v.agent_name !== undefined && typeof v.agent_name !== 'string') return null
    const name = v.agent_name as string | undefined
    entry = decode(encode(makeVerdict(v.reasons as string[], name)))
  }
  if (!entry) return null
  return makeVerdict(
    entry.reasons.map((r) => `page.${r}`),
    entry.name,
  )
}
