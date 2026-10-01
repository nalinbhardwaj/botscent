'use client'
// botscent/react: the page half in React. useBotscent re-renders when the
// verdict (or the selected part of it) changes; <Botscent /> starts observation
// in apps that have no instrumentation-client entry; <BotscentField /> opts the
// surrounding POST form in to carrying the report.
import { createElement, useEffect, useSyncExternalStore, type ReactElement } from 'react'
import { HUMAN, type Verdict } from '../core/verdict.ts'
import { start, subscribe, verdict, type StartOptions } from '../index.ts'

export { isVerified, headers, diagnostics, type Verdict } from '../index.ts'

const subscribeAll = (onChange: () => void) => subscribe(onChange)

/** The verdict, or select(verdict). Selectors must return a part of the verdict or a primitive,
 * so that an unchanged verdict gives an unchanged value. The server and the first hydration
 * render see { type: 'human', reasons: [] }. */
export function useBotscent(): Verdict
export function useBotscent<T>(select: (verdict: Verdict) => T): T
export function useBotscent<T>(select?: (verdict: Verdict) => T): T | Verdict {
  // The selection is the snapshot React compares, so a component re-renders only when it changes.
  const pick = select ?? ((v: Verdict) => v)
  return useSyncExternalStore(
    subscribeAll,
    () => pick(verdict()),
    () => pick(HUMAN),
  )
}

/** Starts observation when it mounts, for apps without instrumentation-client. Renders nothing. */
export function Botscent(props: StartOptions = {}): null {
  const debug = props.debug
  useEffect(() => {
    start({ debug })
  }, [debug])
  return null
}

/** Opts the surrounding form in to carrying the report on POST submissions to the same origin.
 * Renders a disabled hidden input, which forms never submit; the entry is added when the form is serialised. */
export function BotscentField(): ReactElement {
  return createElement('input', { type: 'hidden', disabled: true, 'data-botscent-field': '' })
}
