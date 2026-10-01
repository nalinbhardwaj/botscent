import { json } from '@sveltejs/kit'
import { combine, inspect, readReport } from 'botscent/server'
import type { RequestHandler } from './$types'

// What this request declared, what the page reported, and the explicit join of the two.
export const POST: RequestHandler = async ({ request }) => {
  const own = await inspect(request)
  const report = readReport(request.headers.get('botscent-report'))
  return json({ request: own, report, combined: combine(own, report) })
}
