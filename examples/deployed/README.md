# Deployments for the plan-4.4 tests

Sources for the deployments `examples/test/deployed.test.ts` and the notes in the build log ran against. Each installs `../botscent.tgz` (from `npm run test:examples` or `npm pack`) and copies `dist/botscent.js` into its public directory before deploying.

- `origin/`: a Cloudflare Worker, `botscent-deploytest-origin`, meant to sit behind another cache. Paths ending in `always/` force the transport on, as an origin adapter with `transport: 'always'`; paths ending in `never/` are an origin adapter's default. Both pages ask shared caches to keep them for a minute. `npx wrangler@4 deploy`.
- `cloudfront/`: the distribution in front of `origin/`: CloudFront's own `Server-Timing` on everywhere; `/*` honours the origin's `Cache-Control`; `/forced/*` and `/plain/*` (the latter without CloudFront's `Server-Timing`) have a minimum TTL of 60 s, which overrides `no-store`.
- `netlify/`: a static site with the Workers adapter as a Netlify Edge Function. `/as-agent/` presents ChatGPT-User's user agent to `inspect`, so that a real browser sees an agent's entry. `netlify deploy --prod --dir public`.
- `cache/nginx.conf`: a local cache that ignores `Cache-Control`, keyed by path, in front of `origin/`.
