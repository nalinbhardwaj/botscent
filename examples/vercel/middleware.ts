// The server half as Vercel Routing Middleware, for a project that is not Next.js.
// It runs per request in front of Vercel's cache, so an agent's document navigation
// carries the request's verdict to the page in Server-Timing.
export { default } from 'botscent/vercel'
