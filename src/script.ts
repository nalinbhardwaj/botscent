// The script build: <script defer src="/botscent.js" data-debug>. Exposes the page
// API at window.botscent, then starts itself.
import { diagnostics, headers, isVerified, start, subscribe, verdict, VERSION } from './index.ts'

const tag = document.currentScript
// Published before start(), whose first verdict event can come at once: a listener
// added before this script loaded may call window.botscent from that event.
;(window as unknown as { botscent?: unknown }).botscent = {
  verdict,
  subscribe,
  headers,
  diagnostics,
  isVerified,
  start,
  VERSION,
}
start({ debug: !!tag && tag.hasAttribute('data-debug') })
