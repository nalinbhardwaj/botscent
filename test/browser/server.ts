// A local server for the browser tests: serves the built script, pages whose
// headers each test sets, and an echo endpoint that records form posts.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'

export type Route = { headers?: Record<string, string | string[]>; body: string }

export type TestServer = {
  origin: string
  route(path: string, route: Route): void
  posted: { path: string; body: string; contentType: string }[]
  requests: string[]
  close(): Promise<void>
}

const SCRIPT = new URL('../../dist/botscent.js', import.meta.url)

export function html({
  head = '',
  body = '',
  debug = true,
}: { head?: string; body?: string; debug?: boolean } = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>test</title>
<script>window.__events = []; addEventListener('botscent', (e) => __events.push(e.detail))</script>
${head}<script defer src="/botscent.js"${debug ? ' data-debug' : ''}></script></head><body>${body}</body></html>`
}

export async function serve(): Promise<TestServer> {
  const routes = new Map<string, Route>()
  const posted: TestServer['posted'] = []
  const requests: string[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    requests.push(`${req.method} ${url.pathname}`)
    if (url.pathname === '/botscent.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(readFileSync(SCRIPT))
      return
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        posted.push({
          path: url.pathname,
          body: Buffer.concat(chunks).toString(),
          contentType: String(req.headers['content-type'] ?? ''),
        })
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<!doctype html><title>posted</title>posted')
      })
      return
    }
    const route = routes.get(url.pathname)
    if (!route) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...route.headers })
    res.end(route.body)
  })
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://localhost:${port}`,
    route: (path, route) => routes.set(path, route),
    posted,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
