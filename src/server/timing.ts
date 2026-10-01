// The Server-Timing transport on the server side (contract section 10): which
// requests are document navigations, removing inherited botscent entries, and
// writing the one entry an agent navigation carries.
import type { Verdict } from '../core/verdict.ts'
import { encode } from '../core/wire.ts'

/** Sec-Fetch-Dest: document, or, from a client without fetch metadata, a GET that accepts HTML. */
export function isNavigation(header: (name: string) => string | null, method: string): boolean {
  const dest = header('sec-fetch-dest')
  if (dest !== null) return dest.trim().toLowerCase() === 'document'
  return method.toUpperCase() === 'GET' && /(^|[\s,;])text\/html(?=$|[\s,;])/i.test(header('accept') ?? '')
}

/** Server-Timing entries, split at commas outside quoted strings. */
function entries(value: string): string[] {
  const out: string[] = []
  let start = 0
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (quoted && c === '\\') i++
    else if (c === '"') quoted = !quoted
    else if (c === ',' && !quoted) {
      out.push(value.slice(start, i))
      start = i + 1
    }
  }
  out.push(value.slice(start))
  return out.map((e) => e.trim()).filter(Boolean)
}

const isOurs = (entry: string) => entry.split(';', 1)[0]!.trim().toLowerCase() === 'botscent'

/** The value without any botscent entry, every other entry kept as written; null when nothing is left. */
export function scrubServerTiming(value: string | null): string | null {
  if (value === null) return null
  const kept = entries(value).filter((e) => !isOurs(e))
  return kept.length ? kept.join(', ') : null
}

/** Whether a Server-Timing value carries a botscent entry. */
export const hasOurEntry = (value: string | null): boolean => value !== null && entries(value).some(isOurs)

/** The desc of every botscent entry in a Server-Timing value, as written (unquoted). */
export function ourEntries(value: string | null): string[] {
  if (value === null) return []
  return entries(value)
    .filter(isOurs)
    .map((entry) => {
      const m = /;\s*desc\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;,\s]*))/i.exec(entry)
      return m ? (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]!) : ''
    })
}

/** The botscent entry for an agent verdict (`botscent;desc="..."`), or null. */
export function serverTimingEntry(verdict: Verdict, nowMs: number): string | null {
  const entry = encode(verdict, nowMs)
  return entry ? `botscent;desc="${entry}"` : null
}
