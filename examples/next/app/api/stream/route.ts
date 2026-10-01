// A streaming response, to show the proxy passes it through unchanged.
export async function GET() {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 3; i++) {
        controller.enqueue(encoder.encode(`chunk ${i}\n`))
        await new Promise((r) => setTimeout(r, 200))
      }
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/plain', 'server-timing': 'app;dur=1' } })
}
