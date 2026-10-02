// botscent/svelte: the page half as a Svelte store (Svelte 4 and 5, SvelteKit).
// `$botscent` follows the verdict; start observation once with
// `import 'botscent/auto'` (in SvelteKit, in src/hooks.client.ts). The first browser
// value arrives a microtask after the first subscription, so hydration sees the
// server's value ({ type: 'human', reasons: [] }).
import { readable, type Readable } from 'svelte/store'
import { HUMAN, type Verdict } from '../core/verdict.ts'
import { subscribe, verdict } from '../index.ts'

export type { Verdict } from '../core/verdict.ts'

export const botscent: Readable<Verdict> = readable<Verdict>(HUMAN, (set) => {
  if (typeof window === 'undefined') return
  let stopped = false
  queueMicrotask(() => {
    if (!stopped) set(verdict())
  })
  const stop = subscribe(set)
  return () => {
    stopped = true
    stop()
  }
})
