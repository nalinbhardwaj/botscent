// botscent/vue: the page half in Vue 3. `app.use(Botscent)` starts observation in
// the browser; `useBotscent()` is a read-only ref that follows the verdict, or the
// part a selector picks. In a component it starts from the server's value
// ({ type: 'human', reasons: [] }) and updates after mount, so hydration matches.
import {
  getCurrentInstance,
  getCurrentScope,
  onMounted,
  onScopeDispose,
  readonly,
  shallowRef,
  type Plugin,
  type Ref,
} from 'vue'
import { HUMAN, type Verdict } from '../core/verdict.ts'
import { start, subscribe, verdict, type StartOptions } from '../index.ts'

export type { Verdict } from '../core/verdict.ts'

/** `app.use(Botscent)` or `app.use(Botscent, { debug: true })`. */
export const Botscent: Plugin<[StartOptions?]> = {
  install(_app, options) {
    if (typeof window !== 'undefined') start(options)
  },
}

export function useBotscent(): Readonly<Ref<Verdict>>
export function useBotscent<T>(select: (verdict: Verdict) => T): Readonly<Ref<T>>
export function useBotscent<T>(select?: (verdict: Verdict) => T): Readonly<Ref<T | Verdict>> {
  const pick = (select ?? ((v: Verdict) => v)) as (verdict: Verdict) => T | Verdict
  const state = shallowRef<T | Verdict>(pick(HUMAN))
  const follow = () => {
    state.value = pick(verdict())
    const stop = subscribe((v) => {
      const next = pick(v)
      if (!Object.is(next, state.value)) state.value = next
    })
    if (getCurrentScope()) onScopeDispose(stop)
  }
  if (getCurrentInstance()) onMounted(follow)
  else follow()
  return readonly(state) as Readonly<Ref<T | Verdict>>
}
