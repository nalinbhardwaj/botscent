// Acquisition (plan 4.8 and 5.9): what is read, and when. Reads at start, again
// in later passes, on DOM changes where agents draw, on trusted input, and in a
// slow sample while the page is visible. Every reader is guarded; a failure is
// a probe status and no evidence.
import { PAGE_PLATFORMS, PAGE_USER_AGENT_PREFIXES } from '../generated/page.ts'
import {
  GROK_COMPUTER,
  R,
  isCodexOverlay,
  isCodexPrompt,
  isGeetestPair,
  isInstinctWrappers,
  isMuse,
  type Credentials,
} from './rules.ts'
import { CLAUDE_ACTIVE, computerProfile, elementShape, globalShape, methodShape, sourceShape } from './shapes.ts'

export type ProbeStatus = 'pending' | 'ok' | 'unsupported' | 'failed'

export type Sink = {
  hold(reason: string): void
  declare(name: string): void
  status(probe: string, status: ProbeStatus): void
}

const LATER_PASSES_MS = [1500, 5000]
const SLOW_SAMPLE_MS = 5000

/** Starts observation; returns a function that removes every listener, observer and timer. */
export function observe(sink: Sink): () => void {
  const run = (probe: string, read: () => boolean | void) => {
    try {
      sink.status(probe, read() === false ? 'unsupported' : 'ok')
    } catch {
      sink.status(probe, 'failed')
    }
  }

  const navigatorDeclarations = () =>
    run('navigator', () => {
      if (navigator.webdriver === true) sink.hold(R.webdriver)
      const ua = navigator.userAgent
      for (const [prefix, name] of Object.entries(PAGE_USER_AGENT_PREFIXES)) if (ua.startsWith(prefix)) declare(name)
      const platform = PAGE_PLATFORMS[navigator.platform]
      if (platform) declare(platform)
    })
  const declare = (name: string) => {
    sink.declare(name)
    sink.hold(R.declared)
  }

  const credentials = () =>
    run('credentials', () => {
      const container = navigator.credentials
      const key = (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
      if (!container || !key) return false
      const shapes: Credentials = [
        methodShape(container, 'get'),
        methodShape(container, 'create'),
        methodShape(key, 'getClientCapabilities'),
        methodShape(key, 'isUserVerifyingPlatformAuthenticatorAvailable'),
        methodShape(key, 'isConditionalMediationAvailable'),
      ]
      if (isMuse(shapes)) sink.hold(R.muse)
      if (isInstinctWrappers(shapes)) sink.hold(R.wrappers)
    })

  const geetest = () =>
    run('geetest', () => {
      if (isGeetestPair(globalShape('initGeetest'), globalShape('initGeetest4'))) sink.hold(R.geetest)
    })

  const prompt = () =>
    run('prompt', () => {
      if (isCodexPrompt(sourceShape(window, 'prompt'))) sink.hold(R.prompt)
    })

  // Only a page whose screen already matches asks for the device list: no work for anyone else.
  const computer = () =>
    run('computer', () => {
      if (computerProfile() !== GROK_COMPUTER) return
      if (!navigator.mediaDevices) return false
      navigator.mediaDevices.enumerateDevices().then(
        (list) => {
          if (!list.length) sink.hold(R.grok)
        },
        () => sink.status('computer', 'failed'),
      )
    })

  const keyboard = () =>
    run('keyboard', () => {
      const kb = (navigator as { keyboard?: { getLayoutMap?: () => Promise<{ size: number }> } }).keyboard
      if (typeof kb?.getLayoutMap !== 'function') return false
      kb.getLayoutMap().then(
        (map) => {
          if (map && map.size === 0) sink.hold(R.keyboard)
        },
        () => sink.status('keyboard', 'failed'),
      )
    })

  const overlay = () =>
    run('overlay', () => {
      for (const el of Array.from(document.documentElement.children))
        if (el.nodeName !== 'HEAD' && el.nodeName !== 'BODY' && el.shadowRoot && isCodexOverlay(elementShape(el)))
          sink.hold(R.overlay)
    })

  const markers = () =>
    run('markers', () => {
      if (
        document.querySelector('[data-codex-favicon-badge]') ||
        Array.from(document.querySelectorAll('link[rel~="icon"]')).some((l) =>
          (l.getAttribute('href') ?? '').includes('data-codex-favicon-badge'),
        )
      )
        sink.hold(R.badge)
      for (const id of CLAUDE_ACTIVE)
        if (document.getElementById(id)) {
          sink.hold(R.claude)
          break
        }
    })

  const pass = () => {
    credentials()
    geetest()
    prompt()
    overlay()
    markers()
  }

  // At start.
  navigatorDeclarations()
  computer()
  keyboard()
  pass()

  const timers: ReturnType<typeof setTimeout>[] = LATER_PASSES_MS.map((ms) => setTimeout(pass, ms))
  const slow = setInterval(() => {
    if (document.visibilityState === 'visible') {
      overlay()
      markers()
    }
  }, SLOW_SAMPLE_MS)

  // DOM observation where agents draw: <html>'s and <body>'s children, and the favicon in <head>.
  let pending: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    if (pending === undefined)
      pending = setTimeout(() => {
        pending = undefined
        overlay()
        markers()
      }, 250)
  }
  let observer: MutationObserver | undefined
  const watched = new Set<Node>()
  const watch = () => {
    if (!observer) return
    const targets: [Node | null, MutationObserverInit][] = [
      [document.documentElement, { childList: true }],
      [document.body, { childList: true }],
      [
        document.head,
        { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-codex-favicon-badge'] },
      ],
    ]
    for (const [node, options] of targets) {
      if (node && !watched.has(node)) {
        watched.add(node)
        observer.observe(node, options)
      }
    }
  }
  try {
    observer = new MutationObserver(() => {
      watch() // <body> and <head> may arrive after start
      soon()
    })
    watch()
    sink.status('dom', 'ok')
  } catch {
    sink.status('dom', 'failed')
  }

  // Trusted input: hidden-document input, and a marker read at the moment of input.
  let lastSample = -Infinity
  const onInput = (event: Event) => {
    if (!event.isTrusted) return
    if (document.visibilityState === 'hidden') {
      if (event.type === 'pointerdown') sink.hold(R.pointerdown)
      if (document.hasFocus()) sink.hold(R.focus)
    }
    const now = performance.now()
    if ((event.type === 'pointerdown' || event.type === 'keydown') && now - lastSample >= 300) {
      lastSample = now
      markers()
    }
  }
  const types = ['pointerdown', 'keydown', 'wheel', 'input']
  for (const type of types) document.addEventListener(type, onInput, { capture: true, passive: true })
  sink.status('input', 'ok')

  return () => {
    timers.forEach(clearTimeout)
    clearInterval(slow)
    if (pending !== undefined) clearTimeout(pending)
    observer?.disconnect()
    for (const type of types) document.removeEventListener(type, onInput, { capture: true })
  }
}
