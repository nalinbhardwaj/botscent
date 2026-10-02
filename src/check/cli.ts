#!/usr/bin/env node
// npx botscent check <url> (plan 8.17): verifies an install from outside, the way
// a coding agent's last install step should. One line per check, --json for
// machines, --report for an issue.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { VERSION } from '../generated/core.ts'
import { bare, evaluate, exitCode, report, type Check, type Observations } from './evaluate.ts'
import { findChrome, inBrowser, request, scanProject } from './probe.ts'

const USAGE = `Usage: botscent check <url> [options]

Checks a botscent install from outside: the server half, the page half in a
local Chrome, the transport between them, caches, and the project on disk.

Options:
  --origin <url>   also ask the origin directly, to name a hop that removes Server-Timing
  --project <dir>  the project to scan (default: the current directory, if it has a package.json)
  --chrome <path>  the Chrome or Chromium to drive (default: found, or CHROME_PATH)
  --no-browser     skip the checks that need a browser
  --json           the checks as JSON
  --report         a report to paste into an issue (no query strings, cookies or addresses)

Exit codes: 0 installed; 1 broken, a check failed; 2 unverified, neither half confirmed; 64 usage.`

const USER_AGENT = `botscent-check/${VERSION} (+https://botscent.nibnalin.me/check)`

type Options = {
  url: string
  origin?: string
  project?: string
  chrome?: string
  browser: boolean
  json: boolean
  report: boolean
}

function parse(argv: string[]): Options | string {
  const [command, ...rest] = argv
  if (command !== 'check')
    return command === undefined || command === 'help' || command === '--help' ? '' : `unknown command ${command}`
  const options: Partial<Options> = { browser: true, json: false, report: false }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    const value = () => {
      const v = rest[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }
    if (arg === '--origin') options.origin = value()
    else if (arg === '--project') options.project = value()
    else if (arg === '--chrome') options.chrome = value()
    else if (arg === '--no-browser') options.browser = false
    else if (arg === '--json') options.json = true
    else if (arg === '--report') options.report = true
    else if (arg.startsWith('-')) return `unknown option ${arg}`
    else if (options.url) return `one URL only (got ${options.url} and ${arg})`
    else options.url = arg
  }
  if (!options.url) return 'a URL is needed, for example: botscent check http://localhost:3000/'
  for (const url of [options.url, options.origin])
    if (url !== undefined && !/^https?:\/\/[^/]/.test(url)) return `not an http(s) URL: ${url}`
  return options as Options
}

async function observe(options: Options): Promise<Observations> {
  const sentAt = Date.now()
  const self = await request(options.url, USER_AGENT)
  // Right after, so that a cache which stored check's decorated response serves it here.
  const anonymous = await request(options.url, '')
  const origin = options.origin ? await request(options.origin, USER_AGENT) : undefined
  const chrome = options.browser ? findChrome(options.chrome) : null
  const browser = !options.browser
    ? { skipped: 'skipped (--no-browser)' }
    : chrome
      ? await inBrowser(options.url, chrome)
      : { skipped: 'no Chrome or Chromium found' }
  const dir = options.project ? resolve(options.project) : process.cwd()
  const project =
    options.project || existsSync(resolve(dir, 'package.json'))
      ? scanProject(dir)
      : { skipped: 'not run inside a project (pass --project <dir>)' }
  return { url: options.url, sentAt, self, anonymous, ...(origin ? { origin } : {}), browser, project }
}

/** The URL without its query or fragment. */
function lines(url: string, checks: Check[], exit: number): string {
  const width = Math.max(...checks.map((c) => c.id.length))
  const out = [`botscent check ${VERSION}: ${bare(url)}`]
  for (const c of checks) {
    let line = `${c.outcome.toUpperCase().padEnd(8)} ${c.id.padEnd(width)}  ${c.observed}`
    if (c.detail) line += ` (${c.detail})`
    if (c.cause) line += `. Likely: ${c.cause}`
    if (c.fix) line += `. Fix: ${c.fix}`
    out.push(line)
  }
  const failures = checks.filter((c) => c.outcome === 'fail').length
  out.push(
    exit === 1
      ? `Broken: ${failures} check${failures > 1 ? 's' : ''} failed.`
      : exit === 2
        ? 'Unverified: neither half could be confirmed.'
        : 'Installed.',
  )
  return out.join('\n')
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(VERSION)
    return 0
  }
  const options = parse(argv)
  if (typeof options === 'string') {
    if (options) console.error(`botscent: ${options}\n`)
    console.error(USAGE)
    return options ? 64 : 0
  }
  const observations = await observe(options)
  const checks = evaluate(observations)
  const exit = exitCode(checks)
  if (options.json) console.log(JSON.stringify({ check: VERSION, url: bare(options.url), checks, exit }, null, 2))
  else console.log(lines(options.url, checks, exit))
  if (options.report) console.log(`\n${report(observations, checks, exit)}`)
  return exit
}

process.exitCode = await main(process.argv.slice(2)).catch((error) => {
  console.error(`botscent: ${error instanceof Error ? error.message : String(error)}`)
  return 64
})
