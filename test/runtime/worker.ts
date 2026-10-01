// workerd (Cloudflare Workers): bundled and run through Miniflare by scripts/runtimes.ts.
import { runVectors } from './vectors.ts'

export default {
  async fetch(): Promise<Response> {
    return Response.json(await runVectors())
  },
}
