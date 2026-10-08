# botscent

## 1.1.0

### Minor Changes

- 31a84bf: Names Cursor's in-app browser, `cursor-browser`, from the `Cursor/<version>` token in its user agent ([#3](https://github.com/nalinbhardwaj/botscent/issues/3)). Both halves read it: the server half as a declared user-agent token, the page half from `navigator.userAgent`. Like the Codex in-app browser, it identifies the browser, not who acts in it: a person who browses Cursor's browser by hand is reported as `cursor-browser` too.

## 1.0.1

### Patch Changes

- 148c1a1: Package pages: a full README on PyPI, the README banner from an absolute URL, and the descriptions in the site's words. No change to any verdict.

## 1.0.0

### Major Changes

- babd9ed: First release. Botscent tells your site when an AI agent, not a person, is browsing it, and which agent.

  - The server half reads Web Bot Auth signatures, user-agent tokens and your host's verified-bot field. It runs in TypeScript (Node.js, Cloudflare Workers, Vercel, Deno, Bun) and Python.
  - The page half finds agents inside the browser. It is about 5 KB gzipped and makes no network request.
  - Adapters for Next.js, React, Vue, Nuxt, SvelteKit, Astro, Express, Hono, Cloudflare Workers, Netlify, Vercel, FastAPI, Starlette, Django and Flask.
  - `npx botscent check <url>` tests an install.
