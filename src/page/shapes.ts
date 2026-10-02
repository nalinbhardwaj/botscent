// Readers: the raw shapes the page half observes, in the same form the
// benchmark's collector recorded them, so the predicates in rules.ts can be
// checked against stored recordings. Each reader may throw; the caller records
// the failure as a probe status and treats it as no evidence.

const NATIVE = /\{\s*\[native code\]\s*\}/
const fnToString = Function.prototype.toString

export type FunctionShape = { name: string | null; length: number | null; nativeLike: boolean }

/** A property descriptor's shape, found on the owner or up to three prototypes above it. */
export type MethodShape = {
  status: 'ok' | 'unsupported'
  own?: boolean
  configurable?: boolean
  enumerable?: boolean
  writable?: boolean | null
  accessor?: boolean
  getter?: boolean
  setter?: boolean
  function?: FunctionShape | null
}

export function methodShape(owner: unknown, name: string): MethodShape {
  let target = owner as object | null
  for (let depth = 0; target && depth < 4; depth++, target = Object.getPrototypeOf(target)) {
    const d = Object.getOwnPropertyDescriptor(target, name)
    if (!d) continue
    const fn = d.value
    return {
      status: 'ok',
      own: depth === 0,
      configurable: d.configurable,
      enumerable: d.enumerable,
      writable: typeof d.writable === 'boolean' ? d.writable : null,
      accessor: !('value' in d),
      getter: typeof d.get === 'function',
      setter: typeof d.set === 'function',
      function:
        typeof fn === 'function'
          ? {
              name: typeof fn.name === 'string' ? fn.name : null,
              length: typeof fn.length === 'number' ? fn.length : null,
              nativeLike: NATIVE.test(fnToString.call(fn)),
            }
          : null,
    }
  }
  return { status: 'unsupported' }
}

/** A global's own descriptor on window. */
export type GlobalShape = {
  present: boolean
  own: boolean
  accessor?: boolean
  enumerable?: boolean
  configurable?: boolean
  getter?: boolean
  setter?: boolean
}

export function globalShape(name: string): GlobalShape {
  const d = Object.getOwnPropertyDescriptor(window, name)
  if (!d) return { present: name in window, own: false }
  return {
    present: true,
    own: true,
    accessor: !('value' in d),
    enumerable: d.enumerable,
    configurable: d.configurable,
    getter: typeof d.get === 'function',
    setter: typeof d.set === 'function',
  }
}

/** An own function property's source shape (the collector's integrity target). */
export type SourceShape = {
  fnName: string | null
  nativeLike: boolean | null
  sourceLength: number | null
  fnLength: number | null
}

export function sourceShape(owner: object, key: string): SourceShape | null {
  const d = Object.getOwnPropertyDescriptor(owner, key)
  if (!d) return null
  const fn = 'value' in d ? d.value : d.get
  if (typeof fn !== 'function') return { fnName: null, nativeLike: null, sourceLength: null, fnLength: null }
  const text = fnToString.call(fn)
  return { fnName: String(fn.name), nativeLike: NATIVE.test(text), sourceLength: text.length, fnLength: fn.length }
}

/** A top-level element's shape, as the collector's foreign-DOM records hold it. */
export type ElementShape = {
  idKnown: boolean
  openShadowRoot: boolean
  parent: 'html' | 'body' | 'head'
  position: string | null
  zIndex: string | null
  pointerEvents: string | null
}

/** Claude for Chrome's markers while its agent acts (the research engine's active set). */
export const CLAUDE_ACTIVE: readonly string[] = [
  'claude-agent-glow-border',
  'claude-agent-glow-border-inner',
  'claude-agent-stop-container',
  'claude-agent-stop-button',
  'claude-phantom-cursor',
  'claude-static-indicator-container',
]

/** Every element id of a known agent marker, active or lingering. */
export const MARKER_IDS: readonly string[] = [
  ...CLAUDE_ACTIVE,
  'claude-agent-animation-styles',
  'codex-agent-overlay-root',
]

export function elementShape(el: Element): ElementShape {
  const style = getComputedStyle(el)
  const parent = el.parentNode?.nodeName
  return {
    idKnown: !!el.id && MARKER_IDS.includes(el.id),
    openShadowRoot: !!el.shadowRoot,
    parent: parent === 'BODY' ? 'body' : parent === 'HEAD' ? 'head' : 'html',
    position: style.position,
    zIndex: style.zIndex,
    pointerEvents: style.pointerEvents,
  }
}

/** The screen (size, available area and its origin), the window (size and position) and the pixel ratio,
 * joined into one comparable string. availLeft and availTop are not in every engine; missing, they leave a
 * gap no profile matches. */
export function screenProfile(): string {
  const s = screen as Screen & { availLeft?: number; availTop?: number }
  return [
    s.width,
    s.height,
    s.availWidth,
    s.availHeight,
    s.availLeft,
    s.availTop,
    outerWidth,
    outerHeight,
    screenX,
    screenY,
    devicePixelRatio,
  ].join()
}

/** The screen profile and the time zone. The first Intl.DateTimeFormat in a document costs milliseconds
 * (the time zone data is loaded then), so callers compare screenProfile() first. */
export function computerProfile(): string {
  return `${screenProfile()},${Intl.DateTimeFormat().resolvedOptions().timeZone}`
}
