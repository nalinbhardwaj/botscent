// Debug output for the server half: off by default; on with { debug: true }, a
// function, or BOTSCENT_DEBUG=1 where process.env exists.

export type Debug = boolean | ((line: string) => void) | undefined
export type Log = ((line: string) => void) | null

export function logger(debug: Debug): Log {
  // A sink that throws loses its line; it never changes a verdict or reaches the application.
  if (typeof debug === 'function')
    return (line) => {
      try {
        debug(`[botscent] ${line}`)
      } catch {}
    }
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
