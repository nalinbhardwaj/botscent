// A site whose service worker answers navigations cache-first (plan 4.4), behind the
// Express adapter with the transport forced on: what a page served from the worker's
// cache does with the botscent entry stored with it.
import express from '../../express/node_modules/express/index.js'
import { botscent } from '../../express/node_modules/botscent/dist/express.js'
import { readFileSync } from 'node:fs'

const script = readFileSync(new URL('../../express/node_modules/botscent/dist/botscent.js', import.meta.url))
const SW = `
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return
  e.respondWith(caches.open('pages').then(async (cache) => {
    const hit = await cache.match(e.request)
    if (hit) return hit
    const response = await fetch(e.request)
    await cache.put(e.request, response.clone())
    return response
  }))
})`

export function start(port = 0) {
  const app = express()
  app.use(botscent({ transport: 'always' }))
  app.get('/botscent.js', (_req, res) => res.type('js').send(script))
  app.get('/sw.js', (_req, res) => res.type('js').send(SW))
  app.get('/', (_req, res) =>
    res
      .type('html')
      .send(
        `<!doctype html><title>sw</title><script defer src="/botscent.js"></script><script>navigator.serviceWorker.register('/sw.js')</script>`,
      ),
  )
  return new Promise((resolve) => {
    const server = app.listen(port, 'localhost', () => resolve(server))
  })
}
