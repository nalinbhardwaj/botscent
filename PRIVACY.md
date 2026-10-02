# Privacy

What Botscent reads, what it keeps and what it sends. This describes the library's behaviour; it is not legal advice.

## In short

- The page half reads browser properties and uses them only inside the page. It makes no network request, sets no cookie, writes no storage and writes nothing to the DOM. It keeps no observed value: each probe compares what it reads with a rule and keeps only the id of a reason that held.
- Nothing leaves the page unless your code sends it, through a carrier you choose (below). What a carrier sends is the verdict, never an observed value.
- The server half reads the request's headers and nothing else. It makes no outbound request.
- There is no telemetry, no identifier and nothing sent to the maintainers, from any part of the library.

## The page half: every probe

| Probe         | What it reads                                                                                                                                                                                                                                                                                         | When                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `navigator`   | `navigator.webdriver`; whether `navigator.userAgent` begins with a prefix in `registry/page.json`; whether `navigator.platform` is one listed there                                                                                                                                                   | at start                                                                                     |
| `credentials` | the property descriptors of `navigator.credentials.get` and `.create` and of three `PublicKeyCredential` methods: whether each is an accessor or a value, its function name and length, and whether its source looks native. Nothing is called                                                        | at start, then at 1.5 s and 5 s                                                              |
| `geetest`     | the descriptors of `window.initGeetest` and `window.initGeetest4`, if present                                                                                                                                                                                                                         | as above                                                                                     |
| `prompt`      | the shape of `window.prompt`: its name, its length and the length of its source text                                                                                                                                                                                                                  | as above                                                                                     |
| `computer`    | the screen's size and available area, the window's outer size and position, `devicePixelRatio` and the time-zone name, joined into one string and compared with one profile. Only on a match, the number of entries `navigator.mediaDevices.enumerateDevices()` returns (no labels; it never prompts) | at start                                                                                     |
| `keyboard`    | the size of `navigator.keyboard.getLayoutMap()`, where the browser has it (no keys)                                                                                                                                                                                                                   | at start                                                                                     |
| `overlay`     | for children of `<html>` other than `<head>` and `<body>` that have an open shadow root: their id, position, z-index and pointer-events                                                                                                                                                               | at start, at 1.5 s and 5 s, after DOM changes there, and every 5 s while the page is visible |
| `markers`     | whether elements with a few specific ids exist, and whether a favicon link carries a known attribute                                                                                                                                                                                                  | as above, and at a trusted pointerdown or keydown                                            |
| `input`       | on trusted `pointerdown`, `keydown`, `wheel` and `input` events: only whether the document was hidden and focused at that moment. No coordinates, keys, targets or text                                                                                                                               | while started                                                                                |
| `dom`         | a `MutationObserver` on the children of `<html>` and `<body>`, and on `<head>` for favicons, used only to schedule `overlay` and `markers`                                                                                                                                                            | while started                                                                                |

The `botscent` entry in the navigation's `Server-Timing` is read once at start; it is the server half's verdict, which your own server sent.

`diagnostics()` reports each probe's status (`ok`, `pending`, `unsupported`, `failed`) and the transport's outcome, never a value a probe read. Debug output (`start({ debug: true })`) logs reason ids and statuses to the console.

## What can leave the page

Only through a carrier your code uses:

- `reportHeaders(url)` gives a `Botscent-Report` header for a request to the page's own origin, which your code adds to a `fetch`.
- A form you mark with `data-botscent-field` gets a `botscent` field on its own POST submission to the same origin.

Each carries the verdict in the wire format of the [contract](spec/contract.md), section 9: a version, the agent's name when there is one, and reason ids. It is empty for a person, and never contains an observed value. Once a value leaves the device this way, your site is the one collecting it, and its purpose decides what that needs. If you also send the verdict to analytics, the same applies.

## The server half

`inspect` reads the request's `User-Agent`, `Signature`, `Signature-Input` and `Signature-Agent` headers, `Host` or `:authority`, the method and the request target, any other header a signature covers (to verify it), and, on Cloudflare, the platform's verified-bot fields in `request.cf`. The adapters also read `Sec-Fetch-Dest` and `Accept` to tell a document navigation from other requests. It reads no body and no cookie, keeps nothing between requests and makes no outbound request: signer keys are bundled with each release.

Debug output, off by default, logs the method, the host, the path (without the query) and up to 200 characters of the user agent for each request. Leave it off in production unless your logs may hold those.

## `npx botscent check`

It requests the URL you give it, opens it in a Chrome on your machine and reads the page half's diagnostics. It sends nothing anywhere else. Its `--report` block is built only from what Botscent owns: versions, its own `Server-Timing` entries, diagnostics and bounded check results; no query string, cookie or address.

## Purpose

The texts that govern device access (in the EU, Article 5(3) of the ePrivacy Directive, read with the EDPB's Guidelines 2/2023) turn on what the information is used for and whether it leaves the device:

- Reading properties that never leave the device is how the page half works by default.
- Headers your server already receives can still be in scope when they are used to collect information about the device.
- Protecting a service (rate limits, abuse prevention) and measuring traffic (analytics) are different purposes, and an exemption that covers one does not carry over to the other.

So Botscent keeps the two apart: access decisions use only the request's own verdict, and nothing reaches analytics unless your code sends it there.
