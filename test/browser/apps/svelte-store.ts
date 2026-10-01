import { start } from '../../../src/index.ts'
import { botscent } from '../../../src/adapters/svelte.ts'

const values: unknown[] = []
;(window as unknown as { __values: unknown[] }).__values = values
botscent.subscribe((v) => values.push(v))
start()
