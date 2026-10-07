[![Botscent — Detect AI agents on your site.](https://raw.githubusercontent.com/nalinbhardwaj/botscent/main/docs/assets/botscent-social.png)](https://botscent.nibnalin.me)

# Botscent

Botscent tells your site if an AI agent is browsing it, and which agent.

[Website](https://botscent.nibnalin.me) · [Docs](https://botscent.nibnalin.me/docs) · [Install with one prompt](#install-with-one-prompt)

- **Names the agent.** Claude for Chrome, ChatGPT's agent, Codex, Muse, Manus, Devin, Grok Bot and [more](#coverage).
- **About 5 KB gzipped.** 0 dependencies. Starts in about 5 ms on a budget phone. [Measured in CI](docs/performance.md).
- **Sends nothing.** No network requests, no cookies, no storage.
- **Reports only.** No blocking. You decide what to do.
- **TypeScript and Python.** Next.js, React, Vue, Nuxt, SvelteKit, Astro, Express, Hono, Cloudflare Workers, Netlify, Vercel, FastAPI, Django and Flask.

When an agent visits: hide ads, change prices, log agents, or simplify pages.

```ts
type Verdict = {
  type: 'agent' | 'human' // 'human': no agent evidence, not proof of a person
  agent_name?: string // when the evidence names the agent, for example 'claude-chrome'
  reasons: Reason[] // reason ids, strongest first. [] for 'human'
}
```

## How it works

Botscent has two halves. Both return the same verdict.

- **The server half** reads the request headers. It checks a [Web Bot Auth](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/) signature, a user-agent token and your host's verified-bot field. It verifies signatures against keys bundled in each release. It calls no service.
- **The page half** watches the page for marks that agents leave: the automation flag, agent cloud browsers, extension markers, and input on a hidden page. After it finds an agent, the page verdict stays `agent`.

The server half finds agents that sign or declare their requests. The page half finds agents inside a person's browser.

## What 1.0 promises

- Botscent finds the agents in [Coverage](#coverage). It names an agent only when the evidence identifies that agent.
- `human` means that Botscent found no agent evidence. It does not prove that a person is there.
- Some evidence shows an agent's surface, not who uses it. A person who works inside the Codex browser, Grok Bot's cloud computer, or a Muse or ChatGPT agent session is reported as that agent.
- The server half names Grok Bot when its traffic leaves Grok's cloud. The page half names Grok Bot when the Grok app sends its traffic through the user's computer, which is the default.
- Botscent does not find automation built to look like a person. It does not manage crawlers or make access decisions.
- Not measured yet: Comet and Windows assistive tools.

## Install with one prompt

Paste this prompt into Claude Code, Cursor, Codex or Copilot:

```text
Install Botscent in this project. Botscent is a small open-source library that tells a site if an AI agent is browsing it, and which agent.

Follow https://botscent.nibnalin.me/install.md: detect this project's framework, install the botscent package, add the page half and the server half where it says, then run `npx botscent check <url>` against the running site.

Run the commands yourself. Re-running any step must not duplicate code. When you are done, list the files you changed and paste what check reported.
```

The agent follows the quickstart below.

## Quickstart

```sh
npm install botscent      # Python server half: pip install botscent
```

Each framework below has a tested app in [`examples/`](examples). After the install, run `npx botscent check <url>` ([Verify](#verify)).

### Next.js

```ts
// instrumentation-client.ts (Next.js 15.3 or later): the page half, before hydration
import 'botscent/auto'
```

Before Next.js 15.3, render `<Botscent />` from `botscent/react` once in the root layout.

```ts
// proxy.ts (Next.js 16 or later): the server half
export { proxy } from 'botscent/next'
```

```ts
// middleware.ts (before Next.js 16): the server half
export { proxy as middleware } from 'botscent/next'
```

If you already have a proxy, wrap it. Do not replace it: `export const proxy = withBotscent(existingProxy)`, with `withBotscent` from `botscent/next`. Before Next.js 16, wrap the middleware the same way.

```tsx
'use client'
import { useBotscent } from 'botscent/react'

export function VerdictView() {
  const verdict = useBotscent() // re-renders when the page verdict changes
  return <pre>{JSON.stringify(verdict)}</pre>
}
```

In a route handler, get the request's own verdict with `await inspect(request)`, from `botscent/server`.

### React, Vue, Nuxt, SvelteKit, Astro

```tsx
// React without Next.js: <Botscent /> starts the page half when it mounts
import { Botscent, useBotscent } from 'botscent/react'
```

```ts
// Vue: the plugin starts the page half. useBotscent() returns a read-only ref
import { Botscent, useBotscent } from 'botscent/vue'
createApp(App).use(Botscent).mount('#app')
```

```ts
// Nuxt: a client plugin. useBotscent() is auto-imported
export default defineNuxtConfig({ modules: ['botscent/nuxt'] })
```

```ts
// SvelteKit: in src/hooks.client.ts. Then read $botscent in any component
import 'botscent/auto'
import { botscent } from 'botscent/svelte'
```

```js
// Astro: both halves. Astro.locals.botscent on on-demand routes
import botscent from 'botscent/astro'
export default defineConfig({ integrations: [botscent()] })
```

SvelteKit and Nuxt have no server adapter. To get the request's own verdict in a route, call `inspect`:

```ts
// SvelteKit: hooks.server.ts or a +server.ts route
import { inspect } from 'botscent/server'
const verdict = await inspect(event.request)
```

```ts
// Nuxt: a Nitro server middleware or route
import { inspect } from 'botscent/server'
const verdict = await inspect(event.node.req)
```

### A plain script tag

```html
<script defer src="/botscent.js"></script>
<!-- Serve node_modules/botscent/dist/botscent.js from your own origin. Add data-debug to log. -->
```

The script has no inline code and no `eval`. With a strict Content Security Policy, allow the script's origin in `script-src` (`'self'` if you serve it). Or put a nonce on the tag and use `'strict-dynamic'`. A bundled import needs no change.

The script adds `window.botscent` (`verdict`, `subscribe`, `reportHeaders`, `diagnostics`, `start`, `VERSION`). It sends a `botscent` event on each verdict change.

### Express, Hono, Cloudflare Workers, Netlify, Vercel

```ts
// Express: req.botscent in every handler
import { botscent } from 'botscent/express'
app.use(botscent())
```

```ts
// Hono: c.get('botscent')
import { botscent } from 'botscent/hono'
const app = new Hono().use(botscent())
```

```ts
// Cloudflare Workers: the verdict is the handler's fourth argument
import { withBotscent } from 'botscent/workers'
export default { fetch: withBotscent(async (request, env, ctx, verdict) => fetch(request)) }
```

```ts
// Netlify Edge Functions: the same adapter, then on to the site
import type { Context } from '@netlify/edge-functions'
import { withBotscent } from 'botscent/workers'
export default withBotscent<Context>((request, context) => context.next())
```

```ts
// Vercel Routing Middleware, for projects that are not Next.js: middleware.ts at the project root
export { default } from 'botscent/vercel'
```

### Python: FastAPI, Starlette, Django, Flask

```python
# FastAPI and Starlette: request.state.botscent
from botscent.asgi import BotscentMiddleware
app.add_middleware(BotscentMiddleware)
```

```python
# Django: request.botscent
MIDDLEWARE = [..., "botscent.django.BotscentMiddleware"]
```

```python
# Flask: flask.g.botscent
from botscent.flask import Botscent
Botscent(app)
```

```python
# Any other framework
import botscent
verdict = botscent.inspect(request)  # a Request, a dict of headers, or anything with .headers
```

## Verify

```sh
npx botscent check https://your-site.example/
```

`check` does three things:

1. It requests the page twice: once with its own user agent, and once with no agent evidence.
2. It opens the page in a local Chrome. Like all automation, that Chrome sets the webdriver flag, so the page half reports an agent.
3. It scans the project in the current directory.

Each check prints `pass`, `fail`, `unknown` or `skipped`, and what it saw. A line that is not a pass also gives the likely cause and the fix. Use `--json` for scripts and agents. Use `--report` for a block to paste into an issue. The exit code is 0 when the install works, 1 when it is broken, and 2 when neither half was confirmed.

## Use the verdict

Start by logging verdicts for a week. Then decide what to change. Each use needs a different verdict:

| To                                                         | Use                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Hide ads, change prices, simplify pages                    | The page verdict: `useBotscent`, `$botscent` or `verdict`                                 |
| Log agents: count visits by agent name                     | The page verdict, sent to your server and joined to the request's own verdict (`combine`) |
| Give an agent access: skip a challenge, raise a rate limit | `isVerified` on the request's own verdict, and nothing else                               |

## From the page to your server

The page half sends nothing on its own. To send the page verdict to your server, add its headers to a same-origin request, or mark a form:

```ts
import { reportHeaders } from 'botscent'
await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json', ...reportHeaders('/api/checkout') }, body })
```

```html
<form method="post" action="/checkout" data-botscent-field>...</form>
```

The form gets a `botscent` field only when the browser submits the form to the same origin: a click, Enter or `requestSubmit()`. `form.submit()` and `new FormData(form)` do not get the field, because their data can go to any server. If your code sends a form with `fetch`, use `reportHeaders(url)`.

On the server, the page report and the request's own verdict stay separate until you join them:

```ts
import { combine, inspect, isVerified, readReport } from 'botscent/server'

const own = await inspect(request) // what the request declared. Use this for access
const report = readReport(request.headers.get('botscent-report')) // what the page reported. Its reasons start with 'page.'
const combined = combine(own, report) // for measurement. Agent wins over human
if (isVerified(own)) {
  // a verified signature, or your host's verified-bot field
}
if (isVerified(own, 'chatgpt')) {
  // a signature verified against ChatGPT's bundled keys
}
```

> **Warning:** Do not use a reason, a bare `agent_name` or a page report for access. Page scripts can forge a report, and anyone can send the headers that produce a name. Use `isVerified`.

To allow one agent, pass its name: `isVerified(own, 'chatgpt')`. Do not write `isVerified(own) && own.agent_name === 'chatgpt'`. That check can pair your host's verification of one bot with a name that another bot only declared.

## The trust model

- Only the request's own verdict (`inspect`) is fit for security decisions. In that verdict, only `isVerified` is fit for access.
- With a name, `isVerified` is true only when that agent's Web Bot Auth signature verified against a key in this release. Without a name, it is also true when your host verified the bot.
- `isVerified` authenticates the operator's servers, not the person or the model in the session. Someone can replay a captured signature to the same host until it expires.
- A name without verification is a declaration or a product shape. Anyone can produce one, so it never grants access.
- The page verdict, a page report and the output of `combine` come from the visitor's browser. Use them to adapt a page and to measure, not for access.
- No verdict says who the person behind an agent is, or who did a particular action.

## How the request's verdict reaches the page

On an agent's page load, a server adapter can add a `Server-Timing: botscent;desc="…"` entry and `Cache-Control: no-store`. The page half reads the entry, so one page sees both halves. Responses to people never carry the entry. The page ignores an entry that is old or repeated.

Each server adapter has a `transport` option:

- The default, `'auto'`, turns the entry on where the adapter runs per request in front of the cache. That is the Next.js proxy on Vercel, Vercel Routing Middleware, Cloudflare Workers, Netlify Edge Functions, and Hono on Cloudflare Workers.
- At an origin (Express, Astro, Hono on Node.js, Django, FastAPI, Flask, self-hosted Next.js), the adapter cannot see if a CDN stores your HTML. The entry stays off.
- `transport: 'always'` (Python: `transport=True`) turns the entry on. Set it only if no shared cache stores your HTML.

> **Warning:** If a shared cache stores your HTML and ignores `Cache-Control: no-store`, a person can get an agent's entry. `npx botscent check` reports this case.

## Reasons

<!-- generated:reasons -->

Reasons, strongest first. A reason that names gives `agent_name` when every naming source agrees.

| Reason                                | Half    | Names                 | What it means                                                                                                                                                                                                                                          |
| ------------------------------------- | ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signer.web-bot-auth.verified`        | request | yes, signer           | A Web Bot Auth signature on the request verified against a key bundled with this release.                                                                                                                                                              |
| `signer.edge-verified-bot`            | request | no                    | The hosting platform verified the request as a known bot (Cloudflare's verified-bot category).                                                                                                                                                         |
| `signer.web-bot-auth.declared`        | request | yes, signer           | The request carries a Web Bot Auth signature that did not verify here: an unknown or expired key, a signature outside its window, or a check that failed.                                                                                              |
| `ua.declared-agent-token`             | request | yes, token            | The user agent contains a token that declares software: an agent, fetcher, crawler, link previewer or HTTP client.                                                                                                                                     |
| `ua.page-declared-engine`             | page    | yes, page-declaration | The page's own navigator declares a hosted browser engine.                                                                                                                                                                                             |
| `browser.webdriver-flag`              | page    | no                    | navigator.webdriver is true: the browser declares that automation controls it.                                                                                                                                                                         |
| `ua.headless-chrome`                  | request | no                    | The user agent declares headless Chrome.                                                                                                                                                                                                               |
| `muse.cloud-browser.password-manager` | page    | yes, muse             | 1Password's accessor family on the credential methods, in Chrome 139 or later on Linux x86_64 rendering WebGL with SwiftShader: Muse's cloud browser.                                                                                                  |
| `instinct.credentials.wrappers`       | page    | yes, instinct         | The credential methods are wrapped the way Instinct's cloud desktop wraps them; counts only together with the GeeTest pair.                                                                                                                            |
| `instinct.geetest.accessor-pair`      | page    | yes, instinct         | The GeeTest initialisers are the accessor pair Instinct installs; counts only together with the credential wrappers.                                                                                                                                   |
| `grok.cloud-computer.environment`     | page    | yes, grok-bot         | Grok Bot's cloud computer: Chrome 139 or later on Linux x86_64 rendering WebGL with SwiftShader, with at least 5 of 6 signs (a 1280x800 screen, the Ubuntu, Droid Sans and Cambria fonts, conditional mediation unavailable, the Google Chrome brand). |
| `codex.prompt.anonymous-native`       | page    | yes, codex-browser    | window.prompt has the Codex in-app browser's shape; counts only with a second Codex shell signal.                                                                                                                                                      |
| `codex.keyboard.empty-layout-map`     | page    | yes, codex-browser    | The keyboard layout map is empty, as in the Codex in-app browser; counts only with a second Codex shell signal.                                                                                                                                        |
| `codex.overlay.shadow-root`           | page    | yes, codex-browser    | The Codex in-app browser's overlay is attached to the document; counts only with a second Codex shell signal.                                                                                                                                          |
| `chatgpt.badge.active`                | page    | yes, chatgpt-chrome   | ChatGPT for Chrome's activity badge was drawn on the page while its agent acted.                                                                                                                                                                       |
| `claude.marker.active`                | page    | yes, claude-chrome    | Claude for Chrome's activity marker was drawn on the page while its agent acted.                                                                                                                                                                       |
| `hidden.input.focus-emulated`         | page    | no                    | Trusted input arrived while the document was hidden yet reported focus, which needs focus emulation.                                                                                                                                                   |
| `hidden.input.trusted-pointerdown`    | page    | no                    | A trusted pointerdown arrived while the document was hidden, which no person can produce.                                                                                                                                                              |

<!-- /generated -->

## Coverage

<!-- generated:coverage -->

Named agents: 100, from [the registry](registry/names.json). Software the registry does not name, such as a browser under automation, is still reported as an agent, without a name.

**Agents that operate a browser**

| Agent                | Vendor                  | `agent_name`     | Evidence                                                                                                     |
| -------------------- | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| ChatGPT              | OpenAI                  | `chatgpt`        | signature from `chatgpt.com`                                                                                 |
| ChatGPT for Chrome   | OpenAI                  | `chatgpt-chrome` | page: `chatgpt.badge.active`                                                                                 |
| Claude for Chrome    | Anthropic               | `claude-chrome`  | page: `claude.marker.active`                                                                                 |
| Codex in-app browser | OpenAI                  | `codex-browser`  | page: two of `codex.prompt.anonymous-native`, `codex.keyboard.empty-layout-map`, `codex.overlay.shadow-root` |
| Devin                | Cognition               | `devin`          | user agent `Devin`                                                                                           |
| Google-Agent         | Google                  | `google-agent`   | user agent `Google-Agent`                                                                                    |
| Grok Bot             | Anysphere               | `grok-bot`       | signature from `cursorusercontent.com`; page: `grok.cloud-computer.environment`                              |
| Instinct             | Spear Street Technology | `instinct`       | page: `instinct.credentials.wrappers` with `instinct.geetest.accessor-pair`                                  |
| Manus                | Manus                   | `manus`          | signature from `api.manus.im`; user agent `Manus-User`                                                       |
| Muse                 | Meta                    | `muse`           | page: `muse.cloud-browser.password-manager`                                                                  |
| Nova Act             | Amazon                  | `agent-novaact`  | user agent `Agent-NovaAct`                                                                                   |

**Browser automation**

| Agent                  | Vendor     | `agent_name`             | Evidence                                                                                                                                      |
| ---------------------- | ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Browser Run | Cloudflare | `cloudflare-browser-run` | signature from `web-bot-auth.cloudflare-browser-rendering-085.workers.dev`; page: user agent `Kitesurf/`; page: platform `Cloudflare Workers` |

<details><summary>Fetchers acting for a user (15)</summary>

| Agent                    | Vendor     | `agent_name`               | Evidence                              |
| ------------------------ | ---------- | -------------------------- | ------------------------------------- |
| Amzn-User                | Amazon     | `amzn-user`                | user agent `Amzn-User`                |
| ChatGPT-User             | OpenAI     | `chatgpt-user`             | user agent `ChatGPT-User`             |
| Claude-User              | Anthropic  | `claude-user`              | user agent `Claude-User`              |
| FeedFetcher-Google       | Google     | `feedfetcher-google`       | user agent `FeedFetcher-Google`       |
| Google-CWS               | Google     | `google-cws`               | user agent `Google-CWS`               |
| Google-GeminiNotebook    | Google     | `google-gemininotebook`    | user agent `Google-GeminiNotebook`    |
| Google-Pinpoint          | Google     | `google-pinpoint`          | user agent `Google-Pinpoint`          |
| Google-Read-Aloud        | Google     | `google-read-aloud`        | user agent `Google-Read-Aloud`        |
| Google-Site-Verification | Google     | `google-site-verification` | user agent `Google-Site-Verification` |
| GoogleProducer           | Google     | `googleproducer`           | user agent `GoogleProducer`           |
| Meta-ExternalFetcher     | Meta       | `meta-externalfetcher`     | user agent `meta-externalfetcher`     |
| MistralAI-User           | Mistral AI | `mistralai-user`           | user agent `MistralAI-User`           |
| Perplexity-User          | Perplexity | `perplexity-user`          | user agent `Perplexity-User`          |
| Slackbot                 | Slack      | `slackbot`                 | user agent `Slackbot`                 |
| YandexUserproxy          | Yandex     | `yandexuserproxy`          | user agent `YandexUserproxy`          |

</details>

<details><summary>Link previewers (6)</summary>

| Agent                            | Vendor    | `agent_name`             | Evidence                            |
| -------------------------------- | --------- | ------------------------ | ----------------------------------- |
| facebookexternalhit link preview | Meta      | `facebookexternalhit`    | user agent `facebookexternalhit`    |
| Google Messages link preview     | Google    | `googlemessages`         | user agent `GoogleMessages`         |
| MicrosoftPreview                 | Microsoft | `microsoftpreview`       | user agent `MicrosoftPreview`       |
| Slack image proxy                | Slack     | `slack-imgproxy`         | user agent `Slack-ImgProxy`         |
| Slack link preview               | Slack     | `slackbot-linkexpanding` | user agent `Slackbot-LinkExpanding` |
| X link preview                   | X         | `twitterbot`             | user agent `Twitterbot`             |

</details>

<details><summary>Crawlers (43)</summary>

| Agent                 | Vendor       | `agent_name`            | Evidence                           |
| --------------------- | ------------ | ----------------------- | ---------------------------------- |
| AdIdxBot              | Microsoft    | `adidxbot`              | user agent `adidxbot`              |
| AdsBot-Google         | Google       | `adsbot-google`         | user agent `AdsBot-Google`         |
| AdsBot-Google Mobile  | Google       | `adsbot-google-mobile`  | user agent `AdsBot-Google-Mobile`  |
| AhrefsBot             | Ahrefs       | `ahrefsbot`             | user agent `AhrefsBot`             |
| AhrefsSiteAudit       | Ahrefs       | `ahrefssiteaudit`       | user agent `AhrefsSiteAudit`       |
| Amazonbot             | Amazon       | `amazonbot`             | user agent `Amazonbot`             |
| Amzn-SearchBot        | Amazon       | `amzn-searchbot`        | user agent `Amzn-SearchBot`        |
| APIs-Google           | Google       | `apis-google`           | user agent `APIs-Google`           |
| Apple Podcasts        | Apple        | `itms`                  | user agent `iTMS`                  |
| Applebot              | Apple        | `applebot`              | user agent `Applebot`              |
| Baiduspider           | Baidu        | `baiduspider`           | user agent `Baiduspider`           |
| Bingbot               | Microsoft    | `bingbot`               | user agent `bingbot`               |
| BingVideoPreview      | Microsoft    | `bingvideopreview`      | user agent `BingVideoPreview`      |
| CCBot                 | Common Crawl | `ccbot`                 | user agent `CCBot`                 |
| Claude-SearchBot      | Anthropic    | `claude-searchbot`      | user agent `Claude-SearchBot`      |
| ClaudeBot             | Anthropic    | `claudebot`             | user agent `ClaudeBot`             |
| DuckAssistBot         | DuckDuckGo   | `duckassistbot`         | user agent `DuckAssistBot`         |
| DuckDuckBot           | DuckDuckGo   | `duckduckbot`           | user agent `DuckDuckBot`           |
| Google-CloudVertexBot | Google       | `google-cloudvertexbot` | user agent `Google-CloudVertexBot` |
| Google-InspectionTool | Google       | `google-inspectiontool` | user agent `Google-InspectionTool` |
| Google-Safety         | Google       | `google-safety`         | user agent `Google-Safety`         |
| Googlebot             | Google       | `googlebot`             | user agent `Googlebot`             |
| Googlebot Image       | Google       | `googlebot-image`       | user agent `Googlebot-Image`       |
| Googlebot Video       | Google       | `googlebot-video`       | user agent `Googlebot-Video`       |
| GoogleOther           | Google       | `googleother`           | user agent `GoogleOther`           |
| GoogleOther Image     | Google       | `googleother-image`     | user agent `GoogleOther-Image`     |
| GoogleOther Video     | Google       | `googleother-video`     | user agent `GoogleOther-Video`     |
| GPTBot                | OpenAI       | `gptbot`                | user agent `GPTBot`                |
| Mediapartners-Google  | Google       | `mediapartners-google`  | user agent `Mediapartners-Google`  |
| Meta-ExternalAds      | Meta         | `meta-externalads`      | user agent `meta-externalads`      |
| Meta-ExternalAgent    | Meta         | `meta-externalagent`    | user agent `meta-externalagent`    |
| Meta-WebIndexer       | Meta         | `meta-webindexer`       | user agent `meta-webindexer`       |
| MistralAI-Index       | Mistral AI   | `mistralai-index`       | user agent `MistralAI-Index`       |
| MistralAI-Training    | Mistral AI   | `mistralai-training`    | user agent `MistralAI-Training`    |
| OAI-AdsBot            | OpenAI       | `oai-adsbot`            | user agent `OAI-AdsBot`            |
| OAI-SearchBot         | OpenAI       | `oai-searchbot`         | user agent `OAI-SearchBot`         |
| PerplexityBot         | Perplexity   | `perplexitybot`         | user agent `PerplexityBot`         |
| PetalBot              | Huawei       | `petalbot`              | user agent `PetalBot`              |
| Scrapy                | Zyte         | `scrapy`                | user agent `Scrapy`                |
| SeznamBot             | Seznam       | `seznambot`             | user agent `SeznamBot`             |
| Storebot-Google       | Google       | `storebot-google`       | user agent `Storebot-Google`       |
| YandexBot             | Yandex       | `yandexbot`             | user agent `YandexBot`             |
| Yeti                  | Naver        | `yeti`                  | user agent `Yeti`                  |

</details>

<details><summary>HTTP clients and tools (24)</summary>

| Agent                  | Vendor                     | `agent_name`        | Evidence                       |
| ---------------------- | -------------------------- | ------------------- | ------------------------------ |
| aiohttp                | aio-libs                   | `aiohttp`           | user agent `aiohttp`           |
| Apache HttpClient      | Apache Software Foundation | `apache-httpclient` | user agent `Apache-HttpClient` |
| axios                  | axios                      | `axios`             | user agent `axios`             |
| Botscent check         | Botscent                   | `botscent-check`    | user agent `botscent-check`    |
| Bun                    | Oven                       | `bun`               | user agent `Bun`               |
| curl                   | curl project               | `curl`              | user agent `curl`              |
| Deno                   | Deno Land                  | `deno`              | user agent `Deno`              |
| GNU Wget               | GNU                        | `wget`              | user agent `Wget`              |
| Go net/http            | Go project                 | `go-http-client`    | user agent `Go-http-client`    |
| Guzzle                 | Guzzle                     | `guzzlehttp`        | user agent `GuzzleHttp`        |
| HTTPie                 | HTTPie                     | `httpie`            | user agent `HTTPie`            |
| HTTPX                  | Encode                     | `python-httpx`      | user agent `python-httpx`      |
| Java HttpClient        | OpenJDK                    | `java-http-client`  | user agent `Java-http-client`  |
| Java HttpURLConnection | OpenJDK                    | `java`              | user agent `Java`              |
| libwww-perl            | libwww-perl                | `libwww-perl`       | user agent `libwww-perl`       |
| node-fetch             | node-fetch                 | `node-fetch`        | user agent `node-fetch`        |
| Node.js fetch          | OpenJS Foundation          | `node`              | user agent `node`              |
| OkHttp                 | Square                     | `okhttp`            | user agent `okhttp`            |
| Postman                | Postman                    | `postmanruntime`    | user agent `PostmanRuntime`    |
| Python requests        | Python Software Foundation | `python-requests`   | user agent `python-requests`   |
| Python urllib          | Python Software Foundation | `python-urllib`     | user agent `Python-urllib`     |
| Ruby Net::HTTP         | Ruby                       | `ruby`              | user agent `Ruby`              |
| undici fetch           | OpenJS Foundation          | `undici`            | user agent `undici`            |
| urllib3                | urllib3                    | `python-urllib3`    | user agent `python-urllib3`    |

</details>

<!-- /generated -->

## Privacy

The page half makes no network request. It writes no cookie, storage or DOM. It keeps only the ids of reasons that held, never an observed value. The server half reads request headers only. Nothing leaves the page unless your code sends it, and then only the verdict. [PRIVACY.md](PRIVACY.md) lists every probe and every header.

## Debugging

To log each decision, use `start({ debug: true })`, `data-debug` on the script tag, `inspect(request, { debug: true })` or `BOTSCENT_DEBUG=1`. Each line starts with `[botscent]`. It shows a probe, a signature and why it verified or not, a token, or a verdict change. Python logs the same lines to the `botscent` logger at `DEBUG`.

## Stability

If you route or block on verdicts, pin an exact version: `npm install --save-exact botscent`, or `botscent==1.0.0` in Python. A minor release can change who is detected. To roll back, install the previous version.

- [The contract](spec/contract.md) and shared test vectors pin the behaviour. The TypeScript and Python halves pass the same vectors.
- Each release bundles the signers' keys, so the server half makes no outbound request. A scheduled job opens a pull request when a signer's published keys change.
- A key that a signer removes still verifies until you update. If you grant access with `isVerified`, keep the package current.
- A release that changes a verdict, or adds a reason or a name, is a minor version. Its release notes carry an output-change report.
- Renaming or removing a reason id or an agent name is a major version.
- The names ship as data, with each agent's display name, vendor and kind: `import names from 'botscent/names.json'`.

## License

MIT. Contributions are welcome under the [Developer Certificate of Origin](CONTRIBUTING.md).
