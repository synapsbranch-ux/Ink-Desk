import type { NextConfig } from 'next'

// Kept deliberately bare. The studio is a client-rendered page over a handful
// of Node route handlers that read and write `data/` — see
// `devpost/spec.md > Components > Singletons and the Dev Server`. The template's
// `cacheComponents` opt-in buys nothing here and adds rules about what a route
// segment may export, so it is left off.
const nextConfig: NextConfig = {}

export default nextConfig
