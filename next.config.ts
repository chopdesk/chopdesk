import type { NextConfig } from 'next'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Every Vercel deploy has a unique commit SHA. Locally it falls back to 'dev'.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || 'dev'

// Publish the build ID so installed copies of the app can compare against it
writeFileSync(join(process.cwd(), 'public', 'version.json'), JSON.stringify({ version: BUILD_ID }))

const nextConfig: NextConfig = {
  output: 'export',
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  
  // Fix Turbopack root warning
  turbopack: {
    root: process.cwd(),
  },
}

export default nextConfig