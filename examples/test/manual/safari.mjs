// Real Safari through safaridriver (W3C WebDriver), against the Netlify deployment
// (examples/deployed/netlify): what the page half sees for a person's and an agent's
// navigation, over https and through Netlify's http-to-https redirect.
//   BOTSCENT_SAFARI_SITE=<host> node examples/test/manual/safari.mjs [ios]   (ios: the USB-connected iPhone)
// Starts safaridriver itself, stops it by PID, and exits within three minutes.
import { spawn } from 'node:child_process'

setTimeout(() => {
  console.error('timed out')
  driver.kill()
  process.exit(2)
}, 180_000).unref()
const ios = process.argv.includes('ios')
const port = 4444 + Math.floor(Math.random() * 1000)
const driver = spawn('/usr/bin/safaridriver', ['-p', String(port)], { stdio: 'ignore' })
const base = `http://127.0.0.1:${port}`
const call = async (method, path, body) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const json = await r.json()
  if (json.value?.error) throw new Error(`${path}: ${json.value.error}: ${json.value.message}`)
  return json.value
}
let session
try {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/status`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const alwaysMatch = ios
    ? { browserName: 'safari', platformName: 'iOS', 'safari:useSimulator': false }
    : { browserName: 'safari' }
  ;({ sessionId: session } = await call('POST', '/session', { capabilities: { alwaysMatch } }))
  // The host of a deployment of examples/deployed/netlify, e.g. BOTSCENT_SAFARI_SITE=example.netlify.app
  const site = process.env.BOTSCENT_SAFARI_SITE
  if (!site) throw new Error('set BOTSCENT_SAFARI_SITE to the host of a deployment of examples/deployed/netlify')
  for (const url of [`https://${site}/`, `https://${site}/as-agent/`, `http://${site}/as-agent/`]) {
    await call('POST', `/session/${session}/url`, { url })
    await new Promise((r) => setTimeout(r, 3500))
    const seen = await call('POST', `/session/${session}/execute/sync`, {
      script: `const b = window.botscent, nav = performance.getEntriesByType('navigation')[0]
        return { at: location.href, verdict: b && b.verdict(), transport: b && b.diagnostics().transport,
          probes: b && b.diagnostics().probes, webdriver: navigator.webdriver, secure: isSecureContext,
          serverTiming: nav && nav.serverTiming ? nav.serverTiming.map((e) => e.name + ' ' + e.description) : 'not exposed',
          redirects: nav && nav.redirectCount, userAgent: navigator.userAgent }`,
      args: [],
    })
    console.log(url, JSON.stringify(seen))
  }
} finally {
  if (session) await call('DELETE', `/session/${session}`).catch(() => {})
  driver.kill()
}
