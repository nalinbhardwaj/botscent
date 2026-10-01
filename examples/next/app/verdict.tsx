'use client'
import { useBotscent } from 'botscent/react'

/** Shows this document's verdict; re-renders when it changes. */
export function VerdictView() {
  const verdict = useBotscent()
  return <pre id="verdict">{JSON.stringify(verdict)}</pre>
}
