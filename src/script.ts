// The script build: <script defer src="/botscent.js" data-debug>. Starts itself
// and exposes the page API at window.botscent.
import { diagnostics, headers, isVerified, start, subscribe, verdict, VERSION } from './index.ts'

const tag = document.currentScript
start({ debug: !!tag && tag.hasAttribute('data-debug') })
;(window as unknown as { botscent?: unknown }).botscent = {
  verdict,
  subscribe,
  headers,
  diagnostics,
  isVerified,
  start,
  VERSION,
}
