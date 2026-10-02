// npm's spelling of a version as PEP 440 spells it, so that npm and PyPI share one
// release: 1.0.0 stays 1.0.0; the prereleases changesets makes, 1.0.0-rc.0, 1.0.0-beta.2
// and 1.0.0-alpha.1, become 1.0.0rc0, 1.0.0b2 and 1.0.0a1. Anything else is refused.
export function pep440(version: string): string {
  const m = /^(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(version)
  if (!m) throw new Error(`not a release or alpha/beta/rc prerelease version: ${version}`)
  return m[2] ? `${m[1]}${{ alpha: 'a', beta: 'b', rc: 'rc' }[m[2] as 'alpha' | 'beta' | 'rc']}${m[3]}` : m[1]!
}

// node scripts/pep440.ts <version>: prints it, for the release workflow.
if (import.meta.url === `file://${process.argv[1]}`) console.log(pep440(process.argv[2] ?? ''))
