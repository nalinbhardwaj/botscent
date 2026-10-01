// The shared request vectors through inspect, on whatever runtime imports this:
// returns one line per mismatch, so a runtime that lacks Ed25519 or differs in
// any parsing shows up as a list of failing cases.
import vectors from '../../vectors/requests.json' with { type: 'json' }
import { TOKENS } from '../../src/generated/server.ts'
import { inspectWith } from '../../src/server/inspect.ts'

export async function runVectors(): Promise<{ cases: number; failures: string[] }> {
  const registry = { ...(vectors.registry as object), tokens: TOKENS } as Parameters<typeof inspectWith>[0]
  const failures: string[] = []
  for (const c of vectors.cases as {
    name: string
    headers: [string, string][]
    method?: string
    now?: number
    cf?: object
    verdict: unknown
  }[]) {
    const verdict = await inspectWith(
      registry,
      { headers: new Headers(c.headers), method: c.method ?? 'GET' },
      { now: c.now, cf: c.cf },
    )
    if (JSON.stringify(verdict) !== JSON.stringify(c.verdict))
      failures.push(`${c.name}: got ${JSON.stringify(verdict)}`)
  }
  return { cases: vectors.cases.length, failures }
}
