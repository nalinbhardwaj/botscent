import { combine, inspect, readReport } from 'botscent/server'

// What this request declared, what the page reported, and the explicit join of the two.
export default defineEventHandler(async (event) => {
  const own = await inspect(event.node.req)
  const report = readReport(getHeader(event, 'botscent-report'))
  return { request: own, report, combined: combine(own, report) }
})
