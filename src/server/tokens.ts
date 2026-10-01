// Declared user-agent tokens (contract section 6): a token matches as a whole
// token, as Name/version only ('versioned'), or as the whole header ('exact').
import type { Token } from '../generated/server.ts'

const BEFORE = ' \t;(,+'
const AFTER = '/ \t;),'

/** Every registry token the user agent declares, with its name. */
export function matchTokens(ua: string, tokens: readonly Token[]): { token: string; name: string }[] {
  const found: { token: string; name: string }[] = []
  for (const [token, name, match] of tokens) {
    if (match === 'exact') {
      if (ua === token) found.push({ token, name })
      continue
    }
    for (let at = ua.indexOf(token); at !== -1; at = ua.indexOf(token, at + 1)) {
      const before = at === 0 ? '' : ua[at - 1]!
      const after = ua[at + token.length] ?? ''
      const ends = match === 'versioned' ? after === '/' : after === '' || AFTER.includes(after)
      if ((before === '' || BEFORE.includes(before)) && ends) {
        found.push({ token, name })
        break
      }
    }
  }
  return found
}

export const isHeadlessChrome = (ua: string): boolean => ua.includes('HeadlessChrome/')
