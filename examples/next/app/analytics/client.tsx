'use client'
import { subscribe, verdict } from 'botscent'
import { useEffect } from 'react'

// The document-scoped recipe (plan 5.8): every event carries the verdict as it is when the event
// is sent, and one agent_detected event is sent when agent evidence first appears.
function track(name: string) {
  const v = verdict()
  void fetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({ name, at: Math.round(performance.now()), botscent: v }),
  })
}

export function Analytics() {
  useEffect(() => {
    track('pageview')
    // Detection is monotonic within a document, so the first agent verdict is the moment.
    let sent = verdict().type === 'agent'
    const stop = subscribe((v) => {
      if (v.type !== 'agent' || sent) return
      sent = true
      track('agent_detected')
    })
    const onClick = () => track('click')
    document.addEventListener('click', onClick)
    return () => {
      stop()
      document.removeEventListener('click', onClick)
    }
  }, [])
  return null
}
