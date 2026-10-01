// Every server adapter, installed from the packed artifacts and run in its real
// runtime (Node, workerd, Django's, Flask's and uvicorn's servers), against the
// same checks from plan 4.6. Each example answers /verdict with the request verdict
// as its framework exposes it and the number of body bytes the application read,
// and sets a stale botscent entry beside its own app entry, as a cache might replay.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import { build } from 'tsdown'

const examples = new URL('../', import.meta.url).pathname
const PERSON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const AGENT_UA = `${PERSON_UA}; compatible; ChatGPT-User/1.0; +https://openai.com/bot`
const navigation = (ua: string) => ({ 'user-agent': ua, 'sec-fetch-dest': 'document', accept: 'text/html' })
const HUMAN = { type: 'human', reasons: [] }
const servers: ChildProcess[] = []
const workers: Miniflare[] = []

/** A request signed for chatgpt.com under a fresh key, which no release holds: declared, never verified. */
function signedFor(authority: string): Record<string, string> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const x = publicKey.export({ format: 'jwk' }).x!
  const keyid = createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest('base64url')
  const now = Math.floor(Date.now() / 1000)
  const params = `("@authority" "signature-agent";key="sig1");created=${now};keyid="${keyid}";alg="ed25519";expires=${now + 60};tag="web-bot-auth"`
  const base = `"@authority": ${authority}\n"signature-agent";key="sig1": "https://chatgpt.com"\n"@signature-params": ${params}`
  return {
    'user-agent': PERSON_UA,
    'signature-agent': 'sig1="https://chatgpt.com"',
    'signature-input': `sig1=${params}`,
    signature: `sig1=:${sign(null, Buffer.from(base), privateKey).toString('base64')}:`,
  }
}

type Send = (init: RequestInit) => Promise<Response>

/** An example served over HTTP by its own server, in its own process group. */
async function serve(command: string, args: string[], dir: string, port: number): Promise<Send> {
  const origin = `http://127.0.0.1:${port}`
  if (
    await fetch(origin).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`${origin} is already in use`)
  servers.push(
    spawn(command, args, {
      cwd: `${examples}${dir}`,
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, PORT: String(port) },
    }),
  )
  for (let i = 0; ; i++) {
    if (
      await fetch(`${origin}/verdict`).then(
        () => true,
        () => false,
      )
    )
      break
    if (i > 120) throw new Error(`${dir} did not start on ${origin}`)
    await new Promise((r) => setTimeout(r, 250))
  }
  return (init) => fetch(`${origin}/verdict`, init)
}

/** A Worker example bundled from its wrangler.json entry and run in workerd. */
async function worker(dir: string): Promise<Send> {
  const config = JSON.parse(readFileSync(`${examples}${dir}/wrangler.json`, 'utf8')) as {
    main: string
    compatibility_date: string
  }
  const outDir = `${examples}${dir}/.wrangler/test`
  await build({
    cwd: `${examples}${dir}`,
    entry: { worker: `${examples}${dir}/${config.main}` },
    outDir,
    format: 'esm',
    platform: 'neutral',
    dts: false,
    deps: { alwaysBundle: [/.*/] },
    logLevel: 'silent',
    config: false,
  })
  const mf = new Miniflare({
    modules: true,
    scriptPath: `${outDir}/worker.js`,
    compatibilityDate: config.compatibility_date,
    cf: false,
  })
  workers.push(mf)
  return (init) => mf.dispatchFetch('http://example.com/verdict', init as never) as unknown as Promise<Response>
}

after(async () => {
  for (const s of servers)
    try {
      process.kill(-s.pid!, 'SIGTERM')
    } catch {}
  for (const mf of workers) await mf.dispose().catch(() => {})
})

const EXAMPLES: { name: string; transport: boolean; authority: string; start: () => Promise<Send> }[] = [
  {
    name: 'Express (CommonJS)',
    transport: false,
    authority: '127.0.0.1:3301',
    start: () => serve(process.execPath, ['server.js'], 'express', 3301),
  },
  { name: 'Hono on Workers', transport: true, authority: 'example.com', start: () => worker('hono') },
  { name: 'Cloudflare Workers', transport: true, authority: 'example.com', start: () => worker('workers') },
  {
    name: 'Django',
    transport: false,
    authority: '127.0.0.1:3302',
    start: () =>
      serve(
        `${examples}django/.venv/bin/python`,
        ['manage.py', 'runserver', '127.0.0.1:3302', '--noreload'],
        'django',
        3302,
      ),
  },
  {
    name: 'Flask',
    transport: false,
    authority: '127.0.0.1:3303',
    start: () =>
      serve(
        `${examples}flask/.venv/bin/flask`,
        ['--app', 'app', 'run', '--host', '127.0.0.1', '--port', '3303'],
        'flask',
        3303,
      ),
  },
  {
    name: 'FastAPI',
    transport: false,
    authority: '127.0.0.1:3304',
    start: () =>
      serve(
        `${examples}fastapi/.venv/bin/uvicorn`,
        ['app:app', '--host', '127.0.0.1', '--port', '3304', '--log-level', 'warning'],
        'fastapi',
        3304,
      ),
  },
]

for (const example of EXAMPLES)
  describe(example.name, () => {
    let send: Send
    before(async () => {
      send = await example.start()
    })

    test("a person's navigation is human; the stale entry is removed and the application's own kept", async () => {
      const r = await send({ headers: navigation(PERSON_UA) })
      assert.equal(r.status, 200)
      assert.deepEqual((await r.json()).verdict, HUMAN)
      assert.equal(r.headers.get('server-timing'), 'app;dur=1')
      assert.notEqual(r.headers.get('cache-control'), 'no-store')
    })

    test(`an agent's navigation: the verdict, and the transport ${example.transport ? 'on' : 'off'} by default`, async () => {
      const r = await send({ headers: navigation(AGENT_UA) })
      const verdict = { type: 'agent', agent_name: 'chatgpt-user', reasons: ['ua.declared-agent-token'] }
      assert.deepEqual((await r.json()).verdict, verdict)
      const timing = r.headers.get('server-timing')!
      if (example.transport) {
        const m = /^app;dur=1, botscent;desc="1;chatgpt-user;(\d+);ua\.declared-agent-token"$/.exec(timing)
        assert.ok(m, timing)
        assert.ok(Math.abs(Number(m[1]) - Date.now()) < 60_000, 'the entry carries the receipt time')
        assert.equal(r.headers.get('cache-control'), 'no-store')
      } else {
        assert.equal(timing, 'app;dur=1')
        assert.notEqual(r.headers.get('cache-control'), 'no-store')
      }
    })

    test("a signature under a key the release does not hold is declared, under its signer's name", async () => {
      const r = await send({ headers: signedFor(example.authority) })
      assert.deepEqual((await r.json()).verdict, {
        type: 'agent',
        agent_name: 'chatgpt',
        reasons: ['signer.web-bot-auth.declared'],
      })
    })

    test('the application reads the request body as sent', async () => {
      const body = randomBytes(65536)
      const r = await send({
        method: 'POST',
        headers: { 'user-agent': PERSON_UA, 'content-type': 'application/octet-stream' },
        body,
      })
      assert.deepEqual(await r.json(), { verdict: HUMAN, bytes: body.length })
    })
  })

describe('Vercel Routing Middleware', async () => {
  // Routing Middleware runs only on Vercel; here the example's middleware.ts, resolving
  // the packed package, is called as the platform calls it.
  const { default: middleware } = (await import('../vercel/middleware.ts')) as {
    default: (request: Request) => Promise<Response>
  }
  const call = (headers: Record<string, string>) => middleware(new Request('https://example.com/', { headers }))

  test("a person's navigation continues untouched", async () => {
    const r = await call(navigation(PERSON_UA))
    assert.equal(r.headers.get('x-middleware-next'), '1')
    assert.equal(r.headers.get('server-timing'), null)
    assert.equal(r.headers.get('cache-control'), null)
  })

  test("an agent's navigation continues with the entry and no-store", async () => {
    const r = await call(navigation(AGENT_UA))
    assert.equal(r.headers.get('x-middleware-next'), '1')
    assert.match(r.headers.get('server-timing')!, /^botscent;desc="1;chatgpt-user;\d+;ua\.declared-agent-token"$/)
    assert.equal(r.headers.get('cache-control'), 'no-store')
  })

  test("a signature under a key the release does not hold is declared, under its signer's name", async () => {
    const r = await call({ ...signedFor('example.com'), 'sec-fetch-dest': 'document' })
    assert.match(r.headers.get('server-timing')!, /^botscent;desc="1;chatgpt;\d+;signer\.web-bot-auth\.declared"$/)
  })
})
