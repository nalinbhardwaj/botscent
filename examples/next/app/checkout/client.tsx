'use client'
import { reportHeaders } from 'botscent'
import { useState } from 'react'

export function Checkout() {
  const [result, setResult] = useState('')
  async function send(url: string) {
    const response = await fetch(url, { method: 'POST', headers: { ...reportHeaders(url) }, body: 'cart=1' })
    setResult(await response.text())
  }
  return (
    <>
      <button id="next-api" onClick={() => send('/api/checkout')}>
        Check out (Next route)
      </button>
      <button id="python-api" onClick={() => send('/py/checkout')}>
        Check out (Python backend)
      </button>
      <pre id="result">{result}</pre>
      <form id="form" method="post" action="/py/form" data-botscent-field>
        <input name="cart" defaultValue="1" />
        <button id="submit">Submit form</button>
      </form>
    </>
  )
}
