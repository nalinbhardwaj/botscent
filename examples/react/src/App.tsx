import { useState } from 'react'
import { headers, useBotscent } from 'botscent/react'

export function App() {
  // Re-renders whenever the page's verdict changes.
  const verdict = useBotscent()
  const [answer, setAnswer] = useState('')

  // The headers carrier: same-origin requests get the page's report when it is an agent.
  async function send() {
    const response = await fetch('/api/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers('/api/visit') },
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
