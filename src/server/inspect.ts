// inspect: what one request itself declared (contract section 5).
import { decide, HUMAN, nameOf, type Evidence, type Verdict } from '../core/verdict.ts'
import { logger, type Debug, type Log } from './log.ts'
import { view, type RequestLike, type RequestView } from './request.ts'
import { isHeadlessChrome, matchTokens } from './tokens.ts'
import { verifySignatures, type Registry } from './webbotauth.ts'

/** Cloudflare's request.cf, or the parts of it inspect reads. */
export type CloudflareHints = {
  verifiedBotCategory?: string | null | undefined
  botManagement?: { verifiedBot?: boolean | null | undefined } | null | undefined
}

export type InspectOptions = {
  /** Cloudflare's request.cf, for its verified-bot field. */
  cf?: CloudflareHints | null | undefined
  /** The request time in milliseconds since the epoch; defaults to now. */
  now?: number | undefined
  /** Log each decision: true for console.debug, or a function that receives each line. */
  debug?: Debug
}

export async function inspectWith(
  registry: Registry,
  request: RequestLike,
  options: InspectOptions = {},
): Promise<Verdict> {
  const log = logger(options.debug)
  const evidence: Evidence[] = []
  let req: RequestView
  try {
    req = view(request)
  } catch (error) {
    log?.(`inspect: unreadable request (${(error as Error)?.message ?? error}): human`)
    return HUMAN
  }
  const ua = req.header('user-agent') ?? ''
  log?.(
    `${req.method} ${req.authority ?? '?'}${(req.target ?? '').split('?')[0]} user-agent ${JSON.stringify(ua.slice(0, 200))}`,
  )

  await step(log, 'signatures', async () => {
    const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
    for (const s of await verifySignatures(req, now, registry, log)) {
      const reason = s.verified ? 'signer.web-bot-auth.verified' : 'signer.web-bot-auth.declared'
      evidence.push(s.name ? { reason, name: s.name, source: 'declaration' } : { reason, source: 'declaration' })
    }
  })
  await step(log, 'platform', () => {
    const cf = options.cf
    const category = cf?.verifiedBotCategory
    if ((typeof category === 'string' && category !== '') || cf?.botManagement?.verifiedBot === true) {
      log?.(`platform: verified bot${typeof category === 'string' && category ? ` (${category})` : ''}`)
      evidence.push({ reason: 'signer.edge-verified-bot' })
    }
  })
  await step(log, 'user agent', () => {
    for (const t of matchTokens(ua, registry.tokens)) {
      log?.(`token ${t.token}: ${t.name}`)
      evidence.push({ reason: 'ua.declared-agent-token', name: t.name, source: 'declaration' })
    }
    if (isHeadlessChrome(ua)) {
      log?.('user agent declares HeadlessChrome')
      evidence.push({ reason: 'ua.headless-chrome' })
    }
  })

  const verdict = decide(evidence)
  if (log) {
    if (verdict.type === 'agent') log(`name: ${nameOf(evidence).why}`)
    log(`verdict ${verdict.type}${verdict.agent_name ? ` ${verdict.agent_name}` : ''} [${verdict.reasons.join(', ')}]`)
  }
  return verdict
}

async function step(log: Log, what: string, run: () => unknown): Promise<void> {
  try {
    await run()
  } catch (error) {
    log?.(`${what}: failed (${(error as Error)?.message ?? error}); no evidence from it`)
  }
}
