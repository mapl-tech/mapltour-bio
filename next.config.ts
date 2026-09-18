import type { NextConfig } from 'next'

// A single static page: exported HTML, no server, no image optimiser. Netlify
// serves `out/` from its CDN and one function handles the email capture.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  reactStrictMode: true,
}

export default nextConfig
