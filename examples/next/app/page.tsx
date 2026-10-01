import { VerdictView } from './verdict'

// A static page: built once, served from Next's own cache to every visitor.
export default function Home() {
  return (
    <main>
      <h1>Static page</h1>
      <VerdictView />
    </main>
  )
}
