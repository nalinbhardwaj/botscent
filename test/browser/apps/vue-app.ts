import { createApp, defineComponent, h } from 'vue'
import { Botscent, useBotscent } from '../../../src/adapters/vue.ts'

const counts = { type: 0, full: 0, first: '' }
;(window as unknown as { __counts: typeof counts }).__counts = counts
// Reads only the type, through a selector.
const TypeOnly = defineComponent({
  setup() {
    const type = useBotscent((v) => v.type)
    return () => {
      counts.type++
      return h('span', { id: 'type' }, type.value)
    }
  },
})
// Reads the whole verdict.
const Full = defineComponent({
  setup() {
    const verdict = useBotscent()
    counts.first = JSON.stringify(verdict.value)
    return () => {
      counts.full++
      return h('pre', { id: 'verdict' }, JSON.stringify(verdict.value))
    }
  },
})
createApp({ render: () => [h(TypeOnly), h(Full)] })
  .use(Botscent)
  .mount('#app')
