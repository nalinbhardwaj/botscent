import { createApp } from 'vue'
import { Botscent } from 'botscent/vue'
import App from './App.vue'

// The plugin starts observation in the browser.
createApp(App).use(Botscent).mount('#app')
