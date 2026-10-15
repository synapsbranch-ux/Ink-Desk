import type { NextConfig } from 'next'
import { authMode, frontendApiOf, publishableKeyOf } from './lib/auth/config'

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
//
// Slice 19 kept 'unsafe-inline': the nonce policy moves to `proxy.ts` in
// slice 23, with the rest of the after-audit. What slice 19 adds is Clerk, in
// clerk mode only — its Frontend API host (read from the publishable key, so
// the key must be set when the app is BUILT: these headers are fixed at
// build time) for its script, its API calls, its images and its frames;
// img.clerk.com for avatars; Cloudflare's Turnstile (challenges.cloudflare.com),
// which is Clerk's bot protection on sign-up; and blob: workers, which
// Clerk's session refresh uses. With sign-in off the policy is unchanged.
function clerkHost(): string | null {
  try {
    return authMode() === 'clerk' ? frontendApiOf(publishableKeyOf()) : null
  } catch {
    // A mode production refuses: the boot stops the server with the sentence.
    return null
  }
}
const clerk = clerkHost()
const fapi = clerk ? ` https://${clerk}` : ''
const turnstile = clerk ? ' https://challenges.cloudflare.com' : ''

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}${fapi}${turnstile}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${fapi}${clerk ? ' https://img.clerk.com' : ''}`,
  "font-src 'self' data:",
  `connect-src 'self'${fapi}`,
  "media-src 'self' blob:",
  ...(clerk ? [`frame-src 'self'${fapi}${turnstile}`, "worker-src 'self' blob:"] : []),
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
  // The queue's client libraries load native helpers and read their own files at
  // run time; bundled, they break. Left to Node's own resolution (v3, slice 18).
  serverExternalPackages: ['bullmq', 'ioredis'],
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
