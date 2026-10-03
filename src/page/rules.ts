// The page half's rules on the admission list (plan 5.9): pure predicates over
// the shapes in shapes.ts, ported from rules/v1 in the research engine, and the
// evidence they give. No DOM access here.
import type { Evidence } from '../core/verdict.ts'
import type { ElementShape, GlobalShape, MethodShape, SourceShape } from './shapes.ts'

export const R = {
  webdriver: 'browser.webdriver-flag',
  declared: 'ua.page-declared-engine',
  muse: 'muse.credentials.accessor-family',
  wrappers: 'instinct.credentials.wrappers',
  geetest: 'instinct.geetest.accessor-pair',
  prompt: 'codex.prompt.anonymous-native',
  keyboard: 'codex.keyboard.empty-layout-map',
  overlay: 'codex.overlay.shadow-root',
  badge: 'chatgpt.badge.active',
  claude: 'claude.marker.active',
  focus: 'hidden.input.focus-emulated',
  pointerdown: 'hidden.input.trusted-pointerdown',
} as const

/** The five credential methods: navigator.credentials get and create, and three PublicKeyCredential statics. */
export type Credentials = [
  get: MethodShape,
  create: MethodShape,
  caps: MethodShape,
  uvpaa: MethodShape,
  cma: MethodShape,
]

/** Muse's cloud browser replaces all five with own, enumerable, non-configurable accessors. */
export const isMuse = (c: Credentials): boolean =>
  c.every(
    (s) => s.status === 'ok' && s.own && s.accessor && s.configurable === false && s.enumerable && s.getter && s.setter,
  )

/** Instinct wraps get and create in anonymous one-argument functions and leaves the statics native. */
export function isInstinctWrappers(c: Credentials): boolean {
  const wrapped = (s: MethodShape) =>
    s.status === 'ok' &&
    !!s.own &&
    !!s.configurable &&
    !!s.writable &&
    !s.accessor &&
    s.function?.name === '' &&
    s.function.length === 1 &&
    s.function.nativeLike === false
  return wrapped(c[0]) && wrapped(c[1]) && c.slice(2).every((s) => s.function?.nativeLike === true)
}

/** Instinct defines both GeeTest initialisers as own, configurable, non-enumerable accessor pairs. */
export const isGeetestPair = (a: GlobalShape, b: GlobalShape): boolean =>
  [a, b].every((g) => g.present && g.own && g.getter && g.setter && g.enumerable === false && g.configurable)

/** The Codex in-app browser's window.prompt: an anonymous native function whose source is 29 characters. */
export const isCodexPrompt = (s: SourceShape | null): boolean =>
  !!s && s.fnName === '' && s.nativeLike === true && s.sourceLength === 29 && s.fnLength === 0

/** The Codex overlay: a positioned element under <html>, not a known marker, with an open shadow root,
 * z-index 2147483647 and pointer-events none. */
export const isCodexOverlay = (e: ElementShape): boolean =>
  !e.idKnown &&
  e.openShadowRoot &&
  e.parent === 'html' &&
  (e.position === 'fixed' || e.position === 'absolute' || e.position === 'sticky') &&
  e.zIndex === '2147483647' &&
  e.pointerEvents === 'none'

const NAMES: Partial<Record<string, string>> = {
  [R.muse]: 'muse',
  [R.wrappers]: 'instinct',
  [R.geetest]: 'instinct',
  [R.prompt]: 'codex-browser',
  [R.keyboard]: 'codex-browser',
  [R.overlay]: 'codex-browser',
  [R.badge]: 'chatgpt-chrome',
  [R.claude]: 'claude-chrome',
}

/** Evidence from the rules that have held at any time in this document, with
 * the joint rules applied: Instinct needs both its signals, Codex two of three. */
export function evidenceOf(held: ReadonlySet<string>, declaredName?: string): Evidence[] {
  const out: Evidence[] = []
  const shape = (reason: string) => out.push({ reason, name: NAMES[reason]!, source: 'shape' })
  if (held.has(R.webdriver)) out.push({ reason: R.webdriver })
  if (held.has(R.declared))
    out.push(declaredName ? { reason: R.declared, name: declaredName, source: 'declaration' } : { reason: R.declared })
  if (held.has(R.muse)) shape(R.muse)
  if (held.has(R.wrappers) && held.has(R.geetest)) {
    shape(R.wrappers)
    shape(R.geetest)
  }
  const codex = [R.prompt, R.keyboard, R.overlay].filter((r) => held.has(r))
  if (codex.length >= 2) codex.forEach(shape)
  if (held.has(R.badge)) shape(R.badge)
  if (held.has(R.claude)) shape(R.claude)
  if (held.has(R.focus)) out.push({ reason: R.focus })
  if (held.has(R.pointerdown)) out.push({ reason: R.pointerdown })
  return out
}

/** For debug output: why a signal of a joint rule, just held, does not count yet; '' otherwise. */
export function waiting(held: ReadonlySet<string>, reason: string): string {
  const pair: string[] = [R.wrappers, R.geetest]
  if (pair.includes(reason) && !pair.every((r) => held.has(r)))
    return `; counts only with ${pair.find((r) => r !== reason)}`
  const codex: string[] = [R.prompt, R.keyboard, R.overlay]
  const n = codex.filter((r) => held.has(r)).length
  return codex.includes(reason) && n < 2 ? `; Codex shell ${n} of 3, counts at 2` : ''
}
