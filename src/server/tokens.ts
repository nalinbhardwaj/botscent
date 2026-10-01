// Declared user-agent tokens, matched as whole tokens (contract section 6).

const BEFORE = ' \t;(,+'
const AFTER = '/ \t;),'

/** Every registry token that occurs in the user agent as a whole token, with its name. */
export function matchTokens(
  ua: string,
  tokens: readonly (readonly [token: string, name: string])[],
): { token: string; name: string }[] {
  const found: { token: string; name: string }[] = []
  for (const [token, name] of tokens) {
    for (let at = ua.indexOf(token); at !== -1; at = ua.indexOf(token, at + 1)) {
      const before = at === 0 ? '' : ua[at - 1]!
      const after = ua[at + token.length] ?? ''
      if ((before === '' || BEFORE.includes(before)) && (after === '' || AFTER.includes(after))) {
        found.push({ token, name })
        break
      }
    }
  }
  return found
}

export const isHeadlessChrome = (ua: string): boolean => ua.includes('HeadlessChrome/')
