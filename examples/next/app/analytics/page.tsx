import { VerdictView } from '../verdict'
import { Analytics } from './client'

export default function AnalyticsPage() {
  return (
    <main>
      <h1>Analytics</h1>
      <VerdictView />
      <Analytics />
      <button id="action">Do something</button>
    </main>
  )
}
