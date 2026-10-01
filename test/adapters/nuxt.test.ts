// The Nuxt module against the parts of Nuxt it touches: a generated client-only
// plugin, placed first, that starts observation with the module's options, and the
// useBotscent auto-import. examples/test/nuxt.test.ts runs it in a real Nuxt build.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import botscent from '../../src/adapters/nuxt.ts'

type Template = { filename: string; getContents(): string }
type Imports = { name: string; from: string }[]

function install(options: Parameters<typeof botscent>[0]) {
  const hooks: Record<string, (imports: Imports) => void> = {}
  const nuxt = {
    options: {
      buildDir: '/app/.nuxt',
      plugins: ['/app/plugins/auth.ts'] as unknown[],
      build: { templates: [] as unknown[] },
    },
    hook: (name: string, fn: (imports: Imports) => void) => void (hooks[name] = fn),
  }
  botscent(options, nuxt)
  const imports: Imports = []
  hooks['imports:extend']!(imports)
  return { plugins: nuxt.options.plugins, templates: nuxt.options.build.templates as Template[], imports }
}

test("a client-only plugin, before the application's own, starts observation", () => {
  const { plugins, templates, imports } = install({})
  assert.deepEqual(plugins, [{ src: '/app/.nuxt/botscent.client.mjs', mode: 'client' }, '/app/plugins/auth.ts'])
  assert.equal(templates.length, 1)
  assert.equal(templates[0]!.filename, 'botscent.client.mjs')
  assert.equal(
    templates[0]!.getContents(),
    `import { start } from 'botscent'\nexport default function botscent() {\n  start({"debug":false})\n}\n`,
  )
  assert.deepEqual(imports, [{ name: 'useBotscent', from: 'botscent/vue' }])
})

test('the debug option is built into the plugin; anything but true is off', () => {
  assert.match(install({ debug: true }).templates[0]!.getContents(), /start\(\{"debug":true\}\)/)
  for (const options of [undefined, { debug: 'yes' }] as never[])
    assert.match(install(options).templates[0]!.getContents(), /start\(\{"debug":false\}\)/)
})
