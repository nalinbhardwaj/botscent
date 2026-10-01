// A stand-in analytics endpoint: keeps every event it receives, for the tests to read.
const events: unknown[] = []
export async function POST(request: Request) {
  events.push(await request.json())
  return new Response(null, { status: 204 })
}
export async function GET() {
  return Response.json(events)
}
export const dynamic = 'force-dynamic'
