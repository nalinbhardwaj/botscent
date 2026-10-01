# Botscent v1 contract

Status: **draft**. Every statement is a requirement on both implementations (TypeScript and Python) unless it names one. It freezes when the vertical slice passes; until then a change here comes with the test that motivated it. Data referenced here lives in `registry/`; examples that must hold byte for byte live in `vectors/`.

## 1. The verdict

```ts
type Verdict = {
  type: 'agent' | 'human'
  agent_name?: string
  reasons: Reason[]
}
```

1. `type` is `'agent'` exactly when `reasons` is non-empty. `'human'` means no agent evidence was observed; it is never evidence of a person.
2. `agent_name` is present only when the naming rule (section 4) gives a name, and only on agents. It is absent, never `null` or empty.
3. `reasons` lists reason ids without duplicates, in the order of section 3. A person's verdict is exactly `{ type: 'human', reasons: [] }`.
4. A verdict is plain data with these three keys only, identical in JSON from both languages. In TypeScript it is frozen; in Python it is a `dict`.

## 2. What a verdict describes

5. The request verdict (`inspect`) describes one request: what it declared. The page verdict describes one document: whether agent evidence has been observed at any time during its lifetime. Neither describes who controls the browser now or who performed a particular action.
6. Page detection is monotonic within a document: once `type` is `'agent'` it stays `'agent'`. The name and the reasons are a deterministic function of the set of observations, so arrival order and duplicates never change them. The name can change when a stronger source arrives.

## 3. Reasons

7. The catalogue is `registry/reasons.json`, ordered strongest first. A verdict's reasons follow that order. Reasons this version does not know, which a newer server can send to an older page, follow the known ones in the order received. In a combined verdict, reasons with the `page.` prefix follow the request's own reasons in the report's order.
8. Admission: only the reasons in the catalogue are produced, and two are joint rules. `instinct.credentials.wrappers` and `instinct.geetest.accessor-pair` count only together, and then both are listed. The three `codex.*` reasons count only when at least two hold, and then every one that holds is listed.
9. Unsupported, failed and negative observations all mean no evidence. Nothing makes a verdict more human.

## 4. Names

10. Names are lower-case ids from `registry/names.json`. Only identity-grade sources name:
    - **declarations**: a Web Bot Auth signer host (verified or declared, `registry/signers.json`), a user-agent token (`registry/tokens.json`), what the page's own navigator declares (`registry/page.json`), and, in the page, the name carried by the server's `Server-Timing` entry;
    - **product shapes**: Muse's accessor family, Instinct's wrappers with its GeeTest pair, the Codex shell (two of three), the ChatGPT badge, the Claude marker.
11. If any declaration gives a name, the verdict is named only when every declared name is the same name. Otherwise, if any product shape gives a name, it is named only when every shape gives the same name. Every other case has no name.
12. Generic mechanisms never name: the webdriver flag, a HeadlessChrome user agent, hidden-document input, and the platform's verified-bot field.
13. Verification never changes a name; it decides only whether a signature's reason is `verified` or `declared`.

## 5. Server half

```ts
// botscent/server
function inspect(request: RequestLike, options?: InspectOptions): Promise<Verdict>
function readReport(value: string | Verdict | null | undefined): Verdict | null
function combine(request: Verdict, report: Verdict | null): Verdict
function isVerified(verdict: Verdict): boolean
function isNavigation(request: RequestLike): boolean
function applyTransport(headers: Headers, verdict: Verdict, request: RequestLike, options: { send: boolean; now?: number; debug?: Debug }): 'decorated' | 'scrubbed' | 'untouched'
const VERSION: string

type RequestLike = Request | { headers: Headers | Record<string, string | string[] | undefined>; method?: string; url?: string }
type InspectOptions = {
  cf?: { verifiedBotCategory?: string; botManagement?: { verifiedBot?: boolean } } // Cloudflare's request.cf
  now?: number                                  // milliseconds since the epoch; default Date.now()
  debug?: boolean | ((line: string) => void)    // section 13
}
```

```python
# botscent
def inspect(request, *, cf=None, now=None) -> Verdict: ...      # synchronous
def read_report(value) -> Verdict | None: ...
def combine(request: Verdict, report: Verdict | None) -> Verdict: ...
def is_verified(verdict: Verdict) -> bool: ...
VERSION: str
```

14. `inspect` reads request headers, the method, the URL when given, and platform hints. It never reads a body or a page report, never makes a network request and never throws: on an internal failure it returns the verdict of the evidence gathered so far, at worst `{ type: 'human', reasons: [] }`. In TypeScript it returns a promise because WebCrypto's verification is asynchronous; in Python it is synchronous. Python's `request` is any object with a `headers` mapping (Django, Starlette, Flask and Werkzeug requests) or a mapping of headers; the method comes from `request.method` when present.
15. `readReport` parses a page report: the wire string of section 9 or a verdict-shaped object (for a report passed as an argument). Anything malformed, over-long or of an unknown major version gives `null`. Every reason of a parsed report carries the `page.` prefix, so a report can never pass `isVerified`.
16. `combine` adds a report's evidence to the request's: the result is an agent when either is, its reasons are the request's followed by the report's, and its name is the request's name when it has one, otherwise the report's. A missing or empty report returns the request verdict unchanged. A combined verdict is for measurement and adaptation, never for access.
17. `isVerified(verdict)` is true exactly when `reasons` contains `signer.web-bot-auth.verified` or `signer.edge-verified-bot` without a prefix. Only `inspect` produces those.

## 6. Declared user-agent tokens

18. Each token in `registry/tokens.json` matches case-sensitively, in one of three ways. By default it matches where it occurs in the `User-Agent` value preceded by the start of the value or one of space, tab, `;`, `(`, `,`, `+`, and followed by the end of the value or one of `/`, space, tab, `;`, `)`, `,`. A `versioned` token matches the same way but only when followed by `/` (short words such as `curl`, `Bun` or `Yeti` that could be free text). An `exact` token matches only the whole value (defaults that are a bare word, such as Node's `node`). Every matching token is a declaration (section 4), so a value that declares two products names neither.
19. `ua.headless-chrome` holds when the `User-Agent` contains `HeadlessChrome/`.
20. A missing, empty or unfamiliar user agent is no evidence. There is no generic pattern such as `bot` or `crawler`.

## 7. Web Bot Auth signatures

21. A request carries a Web Bot Auth signature when it has a `Signature` header and its `Signature-Input` parses as a structured-field dictionary (RFC 9651) with a member that is an inner list with the parameter `tag="web-bot-auth"`. An unparseable `Signature-Input` is no evidence; an unparseable `Signature` leaves the signature declared.
22. A signature's signer comes from `Signature-Agent` (draft-ietf-webbotauth-httpsig-protocol-00, section 5.2.1). When the header is a dictionary, the signer is the member named by the `key` parameter of the signature's covered `signature-agent` component; when that component has no `key`, the member under the signature's label, or the only member. A member whose `type` parameter is present and is not `directory` is ignored. When the header is a bare string (the legacy form), that string is the signer of every signature. The signer host is the host of the value parsed as a URL, which must be an `https` origin (no path, query, fragment or credentials), compared exactly with `registry/signers.json`.
23. A signature verifies when all of these hold, and otherwise it is declared:
    - its covered components include `@authority` or `@target-uri`, and the `signature-agent` component that attributes it (with `key` when `Signature-Agent` is a dictionary of several members);
    - every covered component can be derived from the request: `@method`, `@authority`, `@scheme`, `@target-uri`, `@path`, `@query`, or a header field, with no component parameter other than `key`;
    - its `keyid` is the JWK thumbprint (RFC 7638) or `kid` of an Ed25519 key in the signer's own bundled directory (`registry/keys.json`), and its `alg`, when present, is `ed25519`;
    - `created` and `expires` are present and the request time lies in [`created` minus 5 seconds, `expires`]: a signer's clock may run a little ahead, and expiry has no allowance; the key's `nbf` and `exp`, when present, contain `created`;
    - the Ed25519 signature verifies over the signature base built as in RFC 9421 section 2.5, with `@authority` lower-cased and without a default port.
24. The request gets `signer.web-bot-auth.verified` when any Web Bot Auth signature verifies, otherwise `signer.web-bot-auth.declared` when any is present. Each signature's signer host is a declaration for naming, verified or not.
25. Why a signature did not verify goes to the debug output only, never into the verdict.
26. The library makes no request to refresh keys. Between a signer's rotation and an upgrade, its signatures are declared rather than verified.

## 8. Platform hints

27. With `cf`, `signer.edge-verified-bot` holds when `cf.verifiedBotCategory` is a non-empty string or `cf.botManagement.verifiedBot` is `true`. It names nothing.

## 9. Wire grammar

The `Server-Timing` entry and the page report share one grammar:

```abnf
entry   = version ";" name ";" time ";" reasons *( ";" ext )
version = 1*3DIGIT [ "." 1*3DIGIT ]       ; major[.minor]; this release writes "1"
name    = *64( %x61-7A / DIGIT / "-" )    ; empty when unnamed
time    = *15DIGIT                        ; server receipt time, ms since the epoch; empty in page reports
reasons = reason *( "," reason )
reason  = 1*80( %x61-7A / DIGIT / "." / "-" / "_" )
ext     = *( %x21-7E except ";" )         ; ignored: room for later minor versions
```

28. An entry is at most 256 bytes. A value that does not match the grammar, is longer, or has an unknown major version is discarded whole. Reasons a reader does not know are kept.

## 10. Server to page: the `Server-Timing` entry

29. Adapters write `Server-Timing: botscent;desc="<entry>"` only when the request verdict is an agent and the request is a document navigation (`Sec-Fetch-Dest: document`, or, without fetch metadata, a GET whose `Accept` includes `text/html`).
30. They write it after the shared-cache lookup, at most once per response, together with `Cache-Control: no-store`, and remove every inherited `botscent` entry from every response they pass, keeping all other entries.
31. Origin adapters, which cannot see whether a shared cache stores their HTML, write the entry only when the developer opts in.
32. The page accepts one entry whose time lies between 10 seconds before and 120 seconds after its own navigation start. More than one `botscent` entry, a malformed one, or one outside the window is ignored. An absent entry is no evidence. An accepted entry contributes its reasons and, as a declaration, its name.

## 10a. Adapters

- An adapter preserves status codes, redirects, cookies, streaming responses, request bodies and the application's own exceptions; never turns a statically rendered route into a dynamic one; adds no detection logic of its own; and fails to "no evidence", never into the application.
- It gives the application the request verdict where the framework keeps per-request state, and its `transport` option is `'auto'` (send where the adapter knows it runs per request after the shared cache), `'always'` (the developer states that no shared cache stores the HTML), or `'never'`. The Python adapters take `transport=True` (Django: the `BOTSCENT_TRANSPORT` setting). Origin adapters default to off.

| Server entry       | What it is                                                     | The request verdict                         | Transport by default                                           |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `botscent/next`    | Next.js proxy: `proxy`, `middleware`, `withBotscent(existing)` | route handlers call `inspect(request)`      | on Vercel only                                                 |
| `botscent/vercel`  | Vercel Routing Middleware, for projects that are not Next.js   | not passed on; the middleware continues     | on                                                             |
| `botscent/workers` | `withBotscent(handler)` around a Worker's `fetch`              | the handler's fourth argument               | on; `'never'` for a Worker that stores HTML with the Cache API |
| `botscent/hono`    | Hono middleware                                                | `c.get('botscent')`                         | on Cloudflare Workers only                                     |
| `botscent/express` | Express and Connect middleware                                 | `req.botscent`                              | off                                                            |
| `botscent/astro`   | Astro integration, both halves                                 | `Astro.locals.botscent` on on-demand routes | off                                                            |
| `botscent.asgi`    | ASGI middleware (FastAPI, Starlette)                           | `request.state.botscent`                    | off                                                            |
| `botscent.django`  | Django middleware                                              | `request.botscent`                          | off                                                            |
| `botscent.flask`   | Flask extension                                                | `flask.g.botscent`                          | off                                                            |

| Page entry        | What it does                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `botscent/auto`   | calls `start()` on import: Next.js `instrumentation-client`, SvelteKit `hooks.client`                                            |
| `botscent/react`  | `useBotscent(select?)`; `<Botscent />` starts observation; `<BotscentField />` opts a form in                                    |
| `botscent/vue`    | `app.use(Botscent)` starts observation; `useBotscent(select?)` is a read-only ref                                                |
| `botscent/svelte` | the `botscent` store                                                                                                             |
| `botscent/nuxt`   | a Nuxt module: a client plugin calls `start()`, and `useBotscent` is auto-imported; server routes call `inspect(event.node.req)` |
| `botscent/astro`  | adds `botscent/auto` to every page                                                                                               |
| `botscent.js`     | the script build (section 11)                                                                                                    |

- Framework values render the server's snapshot (`{ type: 'human', reasons: [] }`) and follow the page's verdict after hydration, so hydration always matches.
- A Next.js proxy cannot see headers the route sets later, and Next.js keeps one value per header, so on the agent navigations it decorates, its `Server-Timing` replaces one the route set. People's responses are untouched.

## 11. Page half

```ts
// botscent
function start(options?: { debug?: boolean }): () => void
function verdict(): Verdict
function subscribe(listener: (verdict: Verdict) => void): () => void
function subscribe<T>(select: (verdict: Verdict) => T, listener: (selected: T, verdict: Verdict) => void): () => void
function headers(url: string | URL): Record<string, string>
function diagnostics(): Diagnostics
function isVerified(verdict: Verdict): boolean
const VERSION: string
```

33. Importing any entry except the auto-starting ones (`botscent/auto`, the script build) does nothing. `start()` begins observation and is idempotent: a second call, including one from a second copy of the library on the page, does nothing more. It returns `stop`, which removes the library's listeners and observers and keeps the evidence.
34. One instance runs per page. The running instance is published at `globalThis[Symbol.for('botscent')]`, and a second copy uses it.
35. `verdict()` returns the current snapshot. An unchanged state returns the same object. Before `start()`, and during server rendering, it is `{ type: 'human', reasons: [] }`.
36. `subscribe` calls its listener after every change of the snapshot, or, given a selector first, after every change of the selected value (compared with `Object.is`); it does not call it on subscription. The selector comes first so that TypeScript can infer the selected type. Every change also dispatches a `botscent` event on `window` whose `detail` is the new verdict, so code that runs before the library loads can listen.
37. The script build (`<script defer src="/botscent.js">`) starts itself, reads `data-debug` from its tag, and exposes the functions above at `window.botscent`.

## 12. Page to server: the carriers

38. Nothing leaves the page unless the developer uses a carrier.
39. `headers(url)` returns `{ 'Botscent-Report': <entry> }` when the verdict is an agent and `url` resolves to the page's own origin, and `{}` otherwise.
40. A form opts in with the `data-botscent-field` attribute on the form or on an element inside it. When an opted-in form is serialised (submission, `requestSubmit()`, `submit()`, `new FormData(form)`), its entry list gains `botscent=<entry>` if the verdict is an agent, the effective method is POST (a submitter's `formmethod` counts) and the action is same-origin. Nothing is written to the DOM.
41. For a report passed as an argument, the server accepts `verdict()`'s object through `readReport`.

## 13. Diagnostics and debug output

```ts
type Diagnostics = {
  version: string
  started: boolean
  startedAt: number | null                  // ms after navigation start
  probes: Record<string, 'pending' | 'ok' | 'unsupported' | 'failed'>
  transport: 'pending' | 'received' | 'absent' | 'unsupported' | 'rejected'
}
```

42. `diagnostics()` never contains raw observed values and is never part of a verdict.
43. Debug output, off by default, writes one line per decision, prefixed `[botscent]`: in the page, through `console.debug`, each probe result, the transport outcome and each verdict change with its time since navigation start; on the server, each request's tokens, signatures (with the reason one did not verify), hints, verdict and transport decision. Python logs the same lines, without the prefix, to the `botscent` logger at `DEBUG`.

## 14. Releases

44. Every release publishes an output-change report, and any change to outputs is a minor version.
45. npm and PyPI releases share a version number, a tag and a vectors hash, and bundle the same, latest signer key directories.
