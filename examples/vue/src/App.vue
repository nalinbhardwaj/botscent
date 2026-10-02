<script setup lang="ts">
import { ref } from 'vue'
import { reportHeaders } from 'botscent'
import { useBotscent } from 'botscent/vue'

// A read-only ref that follows the page's verdict.
const verdict = useBotscent()
const answer = ref('')

// The headers carrier: same-origin requests get the page's report when it is an agent.
async function send() {
  const response = await fetch('/api/visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...reportHeaders('/api/visit') },
    body: '{}',
  })
  answer.value = await response.text()
}
</script>

<template>
  <main>
    <h1>Botscent on Vue</h1>
    <pre id="verdict">{{ JSON.stringify(verdict) }}</pre>
    <button id="send" @click="send">Send a request</button>
    <pre id="answer">{{ answer }}</pre>
  </main>
</template>
