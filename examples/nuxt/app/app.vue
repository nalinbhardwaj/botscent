<script setup lang="ts">
import { headers } from 'botscent'

// useBotscent() is auto-imported by the module. It renders the server's value
// ({ type: 'human', reasons: [] }) and follows the page's verdict after hydration.
const verdict = useBotscent()
const answer = ref('')

// The headers carrier: same-origin requests get the page's report when it is an agent.
async function send() {
  const response = await fetch('/api/visit', { method: 'POST', headers: headers('/api/visit') })
  answer.value = JSON.stringify(await response.json())
}
</script>

<template>
  <main>
    <h1>Botscent on Nuxt</h1>
    <pre id="verdict">{{ JSON.stringify(verdict) }}</pre>
    <button id="send" @click="send">Send a request</button>
    <pre id="answer">{{ answer }}</pre>
  </main>
</template>
