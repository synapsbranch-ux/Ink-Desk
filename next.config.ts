import type { NextConfig } from 'next'

// Kept small. The studio is a client-rendered page over a handful of Node
// route handlers — see `devpost/spec.md > Components > Singletons and the Dev
// Server`. The template's `cacheComponents` opt-in buys nothing here and adds
// rules about what a route segment may export, so it is left off.
//
// v3 (slice 16, SEC-09): security headers on every response, pages and API
// alike. See `devpost/spec.md > Security Headers and CSP (v3)`.

const dev = process.env.NODE_ENV === 'development'
const production = process.env.NODE_ENV === 'production'

// The policy without nonces, as Next 16's CSP guide gives it
// (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`):
// Next's own inline bootstrap scripts need 'unsafe-inline' until a nonce is
// minted per request, and that needs `proxy.ts`, which arrives with sign-in
// in slice 19 — move the policy there then and drop 'unsafe-inline' from
// script-src. Dev adds 'unsafe-eval' because React's dev build uses eval for
// its error stacks; production never does. Clerk's hosts and the bucket's
// signed-URL host join the list when those features land.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The old browsers' frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Only where the studio is served over HTTPS: on localhost it would pin
  // the browser to https for every other local project too.
  ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
]

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js` advertising the stack.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  experimental: {
    // Once `proxy.ts` exists (slice 19) it buffers every body; nothing the
    // studio accepts is larger than one upload (3.75 MB plus its envelope).
    proxyClientMaxBodySize: '4mb',
  },
}

export default nextConfig
