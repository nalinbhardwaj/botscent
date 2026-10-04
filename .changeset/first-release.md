---
'botscent': major
---

First release. Botscent tells your site when an AI agent, not a person, is browsing it, and which agent.

- The server half reads Web Bot Auth signatures, user-agent tokens and your host's verified-bot field. It runs in TypeScript (Node.js, Cloudflare Workers, Vercel, Deno, Bun) and Python.
- The page half finds agents inside the browser. It is about 5 KB gzipped and makes no network request.
- Adapters for Next.js, React, Vue, Nuxt, SvelteKit, Astro, Express, Hono, Cloudflare Workers, Netlify, Vercel, FastAPI, Starlette, Django and Flask.
- `npx botscent check <url>` tests an install.
