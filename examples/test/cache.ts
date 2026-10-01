// A shared cache in front of the app, as a CDN would be: keyed by URL alone,
// storing what Cache-Control lets a shared cache store, and never storing no-store.
import { createServer, request as forward, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

type Stored = { status: number; headers: IncomingMessage['headers']; body: Buffer }

/** storeEverything: a misconfigured cache that ignores Cache-Control and stores every GET 200. */
export async function sharedCache(upstream: string, { storeEverything = false } = {}) {
  const store = new Map<string, Stored>()
  const log: string[] = []
  const server = createServer((req, res) => {
    const key = req.url ?? '/'
    const hit = req.method === 'GET' ? store.get(key) : undefined
    if (hit) {
      log.push(`HIT ${key}`)
      res.writeHead(hit.status, { ...hit.headers, 'x-cache': 'HIT' })
      res.end(hit.body)
      return
    }
    const target = new URL(key, upstream)
    const out = forward(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
      const chunks: Buffer[] = []
      up.on('data', (c: Buffer) => chunks.push(c))
      up.on('end', () => {
        const body = Buffer.concat(chunks)
        const cc = String(up.headers['cache-control'] ?? '')
        const storable =
          req.method === 'GET' &&
          up.statusCode === 200 &&
          (storeEverything || (/s-maxage|public/.test(cc) && !/no-store|private/.test(cc)))
        if (storable) store.set(key, { status: up.statusCode!, headers: up.headers, body })
        log.push(`${storable ? 'STORE' : 'PASS'} ${key} (${cc || 'no cache-control'})`)
        res.writeHead(up.statusCode ?? 502, { ...up.headers, 'x-cache': 'MISS' })
        res.end(body)
      })
    })
    req.pipe(out)
  })
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))
  return {
    origin: `http://localhost:${(server.address() as AddressInfo).port}`,
    store,
    log,
    // Ends every connection too: server.close() alone waits for a client's open ones.
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
