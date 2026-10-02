// What must never be in this public repository (plan 6.3): a public IP address, a
// personal host or account, an access key or a private key. Scans every tracked file;
// gitleaks covers secrets in history (ci.yml). Exits 1 on a finding.
//
//   node scripts/hygiene.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url).pathname
const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/(^|\/)package-lock\.json$|\.lock$|\.tgz$|\.png$|\.ico$/.test(f))

// A dotted quad that is not part of a version (Chrome/141.0.0.0) or a longer number.
const IPV4 = /(?<![\w./-])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])/g
const reserved = (a: number, b: number, c: number) =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  // Documentation ranges (RFC 5737).
  (a === 192 && b === 0 && c === 2) ||
  (a === 198 && b === 51 && c === 100) ||
  (a === 203 && b === 0 && c === 113)

const PATTERNS: [string, RegExp][] = [
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['an AWS account in an ARN', /arn:aws:[a-z0-9-]*:[a-z0-9-]*:\d{12}:/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a CloudFront distribution host', /\bd[a-z0-9]{13}\.cloudfront\.net\b/],
  ['a personal workers.dev subdomain', /\.[a-z0-9-]+\.workers\.dev\b/],
  ['a personal address', /[A-Za-z0-9._%+-]+@nibnalin\.me\b/],
]
// Public on purpose: Cloudflare's own Web Bot Auth directory, a registered signer.
const ALLOWED = [/web-bot-auth\.cloudflare-browser-rendering-085\.workers\.dev/]

const findings: string[] = []
for (const file of files) {
  let text: string
  try {
    text = readFileSync(root + file, 'utf8')
  } catch {
    continue
  }
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`
    for (const m of line.matchAll(IPV4)) {
      const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number]
      if ([a, b, c, d].some((n) => n > 255) || reserved(a, b, c)) continue
      findings.push(`${where}: a public IP address (${m[0]})`)
    }
    const scrubbed = ALLOWED.reduce((s, re) => s.replace(re, ''), line)
    for (const [what, re] of PATTERNS) if (re.test(scrubbed)) findings.push(`${where}: ${what}`)
  })
}
for (const f of findings) console.error(f)
console.log(`hygiene: ${files.length} tracked files, ${findings.length} finding${findings.length === 1 ? '' : 's'}`)
if (findings.length) process.exit(1)
