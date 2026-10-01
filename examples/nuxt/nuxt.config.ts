// The page half in one line. The home page is prerendered at build time, and stays so.
export default defineNuxtConfig({
  modules: ['botscent/nuxt'],
  routeRules: { '/': { prerender: true } },
  compatibilityDate: '2026-10-01',
})
