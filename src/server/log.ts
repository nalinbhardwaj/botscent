// Debug output for the server half: off by default; on with { debug: true }, a
// function, or BOTSCENT_DEBUG=1 where process.env exists.

export type Debug = boolean | ((line: string) => void) | undefined
export type Log = ((line: string) => void) | null

export function logger(debug: Debug): Log {
  if (typeof debug === 'function') return (line) => debug(`[botscent] ${line}`)
  if (debug === true || (debug === undefined && fromEnvironment())) return (line) => console.debug(`[botscent] ${line}`)
  return null
}

function fromEnvironment(): boolean {
  try {
    return (
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BOTSCENT_DEBUG === '1'
    )
  } catch {
    return false
  }
}
