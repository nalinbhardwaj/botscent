<script lang="ts">
  import { headers } from 'botscent'
  import { botscent } from 'botscent/svelte'

  // $botscent renders the server's value ({ type: 'human', reasons: [] }) and follows
  // the page's verdict after hydration.
  let answer = $state('')

  // The headers carrier: same-origin requests get the page's report when it is an agent.
  async function send() {
    const response = await fetch('/api/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers('/api/visit') },
      body: '{}',
    })
    answer = JSON.stringify(await response.json())
  }
</script>

<main>
  <h1>Botscent on SvelteKit</h1>
  <pre id="verdict">{JSON.stringify($botscent)}</pre>
  <button id="send" onclick={send}>Send a request</button>
  <pre id="answer">{answer}</pre>
</main>
