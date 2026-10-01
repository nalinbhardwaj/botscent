import { createRoot } from 'react-dom/client'
import { Botscent } from 'botscent/react'
import { App } from './App.tsx'

// <Botscent /> starts observation when it mounts, for apps without Next.js's
// instrumentation-client entry.
createRoot(document.getElementById('root')!).render(
  <>
    <Botscent />
    <App />
  </>,
)
