import { useState } from 'react'
import { reportHeaders } from 'botscent'
import { useBotscent } from 'botscent/react'

export function App() {
  // Re-renders whenever the page's verdict changes.
  const verdict = useBotscent()
  const [answer, setAnswer] = useState('')

  // The report carrier: same-origin requests get the page's report when it is an agent.
  async function send() {
    const response = await fetch('/api/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...reportHeaders('/api/visit') },
      body: '{}',
    })
    setAnswer(await response.text())
  }

  return (
    <main>
      <h1>Botscent on React</h1>
      <pre id="verdict">{JSON.stringify(verdict)}</pre>
      <button id="send" onClick={send}>
        Send a request
      </button>
      <pre id="answer">{answer}</pre>
    </main>
  )
}
