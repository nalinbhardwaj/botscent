// One read-only view over the request shapes inspect accepts: a Fetch Request
// (Workers, Next.js, Hono, Deno, Bun), Node's IncomingMessage (Express), or a
// plain { headers, method, url } object.

type HeaderGetter = { get(name: string): string | null }
type HeaderRecord = Record<string, string | string[] | undefined>

export type RequestLike =
  Request | { headers: Headers | HeaderGetter | HeaderRecord; method?: string | undefined; url?: string | undefined }

export type RequestView = {
  /** The field's value, multiple values joined with ", ", or null when absent. */
  header(name: string): string | null
  method: string
  /** The absolute target URI when the request carries one. */
  url: URL | null
  /** The path and query, when known. */
  target: string | null
  /** The lower-cased authority without a default port. */
  authority: string | null
}

export function view(input: RequestLike): RequestView {
  const raw = (input as { headers?: unknown }).headers
  let header: (name: string) => string | null
  if (raw && typeof (raw as HeaderGetter).get === 'function') {
    const getter = raw as HeaderGetter
    // Fetch Headers throws on names it considers invalid (":authority"); a throwing getter means absent.
    header = (name) => {
      try {
        return getter.get(name)
      } catch {
        return null
      }
    }
  } else {
    const map = new Map<string, string>()
    for (const [key, value] of Object.entries((raw ?? {}) as HeaderRecord)) {
      if (value === undefined) continue
      const name = key.toLowerCase()
      const joined = Array.isArray(value) ? value.join(', ') : String(value)
      map.set(name, map.has(name) ? `${map.get(name)}, ${joined}` : joined)
    }
    header = (name) => map.get(name.toLowerCase()) ?? null
  }
  const rawUrl =
    typeof (input as { url?: unknown }).url === 'string' ? ((input as { url: string }).url as string) : null
  let url: URL | null = null
  let target: string | null = null
  if (rawUrl) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)) {
      try {
        url = new URL(rawUrl)
        target = url.pathname + url.search
      } catch {}
    } else if (rawUrl.startsWith('/')) target = rawUrl
  }
  const method = String((input as { method?: unknown }).method ?? 'GET').toUpperCase()
  // HTTP/2's :authority is the target's authority; Host, when an HTTP/2 client sends it too, is not.
  const host = header(':authority') ?? header('host') ?? url?.host ?? null
  let authority: string | null = null
  if (host) {
    authority = host.trim().toLowerCase()
    const scheme = url?.protocol ?? 'https:'
    if ((scheme === 'https:' && authority.endsWith(':443')) || (scheme === 'http:' && authority.endsWith(':80')))
      authority = authority.slice(0, authority.lastIndexOf(':'))
  }
  return { header, method, url, target, authority }
}
