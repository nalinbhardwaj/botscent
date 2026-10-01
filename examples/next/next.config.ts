import type { NextConfig } from 'next'

const config: NextConfig = {
  turbopack: { root: import.meta.dirname },
  // The Python backend behind the same origin, as many React-plus-Python apps deploy it.
  async rewrites() {
    return [{ source: '/py/:path*', destination: `${process.env.PYTHON_BACKEND ?? 'http://127.0.0.1:8000'}/:path*` }]
  },
}

export default config
