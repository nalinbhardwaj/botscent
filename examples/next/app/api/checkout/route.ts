import { combine, inspect, readReport } from 'botscent/server'

// What this request declared, what the page reported, and the explicit join of the two.
export async function POST(request: Request) {
  const own = await inspect(request)
  const report = readReport(request.headers.get('botscent-report'))
  return Response.json({ request: own, report, combined: combine(own, report) })
}
