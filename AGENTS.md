# AGENTS.md

Instructions for coding agents: first for adding Botscent to an application, then for working on this repository.

## Adding Botscent to an application

Every step is safe to run again. The quickstart in [README.md](README.md) has the exact lines for each framework; this is the order to apply them in and the rules that keep an install correct.

1. **Find the framework** from the project's own files: `next` in `package.json` is Next.js, `nuxt` is Nuxt, `@sveltejs/kit` is SvelteKit, `astro` is Astro, `vue` or `react` without those is a Vite or similar app, `express` or `hono` is a Node.js server, `wrangler.json`, `wrangler.jsonc` or `wrangler.toml` is Cloudflare Workers, and `pyproject.toml` or `requirements.txt` with `fastapi`, `starlette`, `django` or `flask` is a Python backend. A site can need two halves from different stacks, for example a React frontend and a Django backend.
2. **Install:** `npm install botscent`; for a Python backend, `pip install botscent` (or the project's tool: `uv add botscent`, `poetry add botscent`).
3. **Add the page half** once, where the browser starts: `import 'botscent/auto'` in Next.js's `instrumentation-client.ts` (create it, or add the line to the existing file) or SvelteKit's `src/hooks.client.ts`; `<Botscent />` from `botscent/react`; `app.use(Botscent)` from `botscent/vue`; `modules: ['botscent/nuxt']`; `integrations: [botscent()]` from `botscent/astro`; otherwise `<script defer src="/botscent.js"></script>` serving `node_modules/botscent/dist/botscent.js`.
4. **Add the server half** where requests arrive. **Never replace an existing proxy or middleware**: in Next.js, if `proxy.ts` or `middleware.ts` already exists, wrap its function with `withBotscent(existing)` from `botscent/next`; only when there is none, create it with `export { proxy } from 'botscent/next'` (`export { middleware } from 'botscent/next'` in `middleware.ts` before Next.js 16). Elsewhere, add the framework's middleware next to the existing ones: `app.use(botscent())` for Express and Hono, `withBotscent(handler)` for Workers, `BotscentMiddleware` for ASGI and Django, `Botscent(app)` for Flask.
5. **Leave the transport option alone.** Do not set `transport: 'always'` (or `transport=True`) unless the user confirms that no shared cache stores the site's HTML.
6. **Use the verdict as documented.** Access decisions use `isVerified(await inspect(request))` (Python: `botscent.is_verified(botscent.inspect(request))`), never a reason string and never a report from the page.
7. **Verify:** start the site and run `npx botscent check <url>` from the project's directory. Fix every `fail` with the fix its line gives, then run it again. Report each `unknown` to the user with its likely cause; an `unknown` server half is expected at an origin with the transport off.

## Working on this repository

- Node.js 22.12 or later for TypeScript; [uv](https://docs.astral.sh/uv/) for Python, in `python/`.
- Before a commit: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; for the page half `npm run test:browser`; for adapters `npm run test:examples`; for Python `cd python && uv run ruff check . && uv run pytest`.
- [spec/contract.md](spec/contract.md) is the specification. The TypeScript and Python halves must give byte-identical verdicts on [`vectors/`](vectors), so a change to one is a change to both.
- `registry/*.json` is the one source for names, tokens, signers, keys, reasons and page declarations. After editing it run `npm run generate`; after changing vectors, `npm run vectors`; the README's tables come from `node scripts/docs.ts`. CI fails when any generated file is stale.
- The npm package has no runtime dependencies; `cryptography` is the Python package's only one. Keep it so.
- A change that alters any verdict is a minor release: add a changeset with `npx changeset`. The release pull request carries the output-change report.
- Commits are signed off under the Developer Certificate of Origin: `git commit -s` ([CONTRIBUTING.md](CONTRIBUTING.md)).
