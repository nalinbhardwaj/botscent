// The pages the performance harness loads, each with and without the library.
// `article` is a small static page: a hero image (the LCP element), text, a
// search box that filters a list, and a button that adds a row. `feed` is the
// heavier page: about 10,000 nodes, a toast added to and removed from <body>
// on every animation frame (the DOM churn the library's observer watches), and
// text updates deeper in the tree (which it does not watch).
import type { TestServer } from '../browser/server.ts'

export type PageName = 'article' | 'feed'
export const PAGES: PageName[] = ['article', 'feed']

const HERO = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#9333ea"/></linearGradient></defs>
<rect width="1200" height="400" fill="url(#g)"/><circle cx="900" cy="200" r="140" fill="#fff" opacity=".25"/></svg>`

const STYLE = `<style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#222}
header,footer{padding:12px 24px;background:#f3f4f6}
main{max-width:760px;margin:0 auto;padding:0 16px}
.hero{display:block;width:100%;height:auto;aspect-ratio:3/1}
.card{border:1px solid #ddd;border-radius:6px;padding:8px;margin:6px 0}
.card h3{margin:0;font-size:15px}.card p{margin:2px 0;font-size:13px}
.toast{position:fixed;right:12px;bottom:12px;padding:8px;background:#111;color:#fff;border-radius:4px}
li.hidden{display:none}
</style>`

const words = 'the quick brown fox jumps over a lazy dog while agents and people read pages written for both'.split(' ')
const sentence = (i: number, n: number) =>
  Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ')

/** Page script shared by both pages: the button and the search box, with a few milliseconds of real work each. */
const INTERACTIONS = `<script>
document.getElementById('add').addEventListener('click', () => {
  const li = document.createElement('li'); li.textContent = 'row ' + document.querySelectorAll('#list li').length
  document.getElementById('list').prepend(li)
  document.getElementById('count').textContent = String(document.querySelectorAll('#list li').length)
})
document.getElementById('q').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase()
  for (const li of document.querySelectorAll('#list li')) li.classList.toggle('hidden', !li.textContent.includes(q))
})
</script>`

function shell(title: string, head: string, body: string, library: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="icon" href="data:,"><title>${title}</title>${STYLE}${head}
${library ? '<script defer src="/botscent.js"></script>' : ''}</head><body>${body}</body></html>`
}

function controls(): string {
  const items = Array.from({ length: 200 }, (_, i) => `<li>${sentence(i, 4)} ${i}</li>`).join('')
  return `<section><input id="q" placeholder="filter" aria-label="filter"> <button id="add">Add row</button>
<span id="count">200</span><ul id="list">${items}</ul></section>`
}

export function article(library: boolean): string {
  const paragraphs = Array.from({ length: 30 }, (_, i) => `<p>${sentence(i, 40)}.</p>`)
  return shell(
    'article',
    '',
    `<header><nav><a href="#">Home</a> · <a href="#">Docs</a> · <a href="#">Blog</a></nav></header>
<main><img class="hero" src="/hero.svg" width="1200" height="400" alt="">
<h1>An ordinary article</h1>${paragraphs.slice(0, 3).join('')}${controls()}${paragraphs.slice(3).join('')}</main>
<footer>footer</footer>${INTERACTIONS}`,
    library,
  )
}

export function feed(library: boolean): string {
  const cards = Array.from(
    { length: 1400 },
    (_, i) =>
      `<div class="card" id="c${i}"><h3>Item ${i}</h3><p>${sentence(i, 12)}</p><p><span class="t">${i}</span> · <a href="#">reply</a></p></div>`,
  ).join('')
  return shell(
    'feed',
    '',
    `<header>feed</header><main><img class="hero" src="/hero.svg" width="1200" height="400" alt="">
<h1>A busy feed</h1>${controls()}<div id="feed">${cards}</div></main>${INTERACTIONS}
<script>
// Churn directly under <body>, once per frame, and text updates deep in the tree every 100 ms.
let n = 0, toast = null
const frame = () => {
  if (toast) toast.remove()
  toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = 'update ' + n++
  document.body.appendChild(toast)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
setInterval(() => { for (let k = 0; k < 20; k++) document.querySelector('#c' + ((n * 37 + k) % 1400) + ' .t').textContent = String(n) }, 100)
</script>`,
    library,
  )
}

/** Routes /article, /feed (with the library) and /article-none, /feed-none (without), and /hero.svg. */
export function routePages(server: TestServer): void {
  server.route('/hero.svg', { headers: { 'content-type': 'image/svg+xml' }, body: HERO })
  for (const [name, build] of [
    ['article', article],
    ['feed', feed],
  ] as const) {
    server.route(`/${name}`, { body: build(true) })
    server.route(`/${name}-none`, { body: build(false) })
  }
}

export const path = (page: PageName, library: boolean): string => (library ? `/${page}` : `/${page}-none`)

/** Counts the DOM queries the library's markers and overlay reads make, so a test can show that a
 * timer ran without reading the page. Installed before the page's scripts; the pages themselves make
 * none of these calls while idle. */
export const COUNT_QUERIES = `(() => {
  const counts = window.__queries = { n: 0 }
  for (const name of ['getElementById', 'querySelector', 'querySelectorAll']) {
    const original = Document.prototype[name]
    Document.prototype[name] = function (...args) { counts.n++; return original.apply(this, args) }
  }
})()`

/** Counts every DOM change from the start of the document (each node added or removed, each attribute
 * and text change), parsing included, so the counts with and without the library can be compared. */
export const RECORD_MUTATIONS = `(() => {
  window.__mutations = 0
  new MutationObserver((records) => {
    for (const r of records) window.__mutations += r.type === 'childList' ? r.addedNodes.length + r.removedNodes.length : 1
  })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
})()`
