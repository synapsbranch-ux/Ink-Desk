import type { NextConfig } from 'next'
import { clerkHostForCsp, isProduction } from './lib/auth/config'
import { contentSecurityPolicy } from './lib/csp'

// Kept small. The studio is a client-rendered page over a handful of Node
// route handlers — see `devpost/spec.md > Components > Singletons and the Dev
// Server`. The template's `cacheComponents` opt-in buys nothing here and adds
// rules about what a route segment may export, so it is left off.
//
// v3 (slice 16, SEC-09): security headers on every response, pages and API
// alike. See `devpost/spec.md > Security Headers and CSP (v3)`.

const dev = process.env.NODE_ENV === 'development'
// One rule for production everywhere (S19-SEC-1): anything but development.
const production = isProduction()

// The CSP (`lib/csp.ts`). Slice 16 set it here with 'unsafe-inline' for
// scripts; slice 19 added Clerk's hosts in clerk mode. Slice 23 (after-audit
// #3) moves the page's policy to `proxy.ts`, which mints a nonce per request:
// what stays here is the same policy with no nonce and no 'unsafe-inline',
// for every response the proxy does not shape (API answers, Next's own files,
// `public/`). On a page the proxy's header replaces this one. Clerk's host is
// read from the publishable key, so here it is fixed when the app is BUILT;
// the proxy reads it at run time.
const csp = contentSecurityPolicy({ dev, clerkHost: clerkHostForCsp() })

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

// Slice 21: the public share page (`/s/<token>`) and its data and pictures
// (`/api/s/<token>/…`) are for the people a link was given to, not for search
// engines: `X-Robots-Tag: noindex, nofollow` on both (the page also says so in
// its metadata, the header covers the image and JSON routes that have none),
// and `Referrer-Policy: no-referrer` on the page, so a link a reader follows
// out of a shared manga never carries the secret token in its Referer. The CSP
// above is untouched on purpose: the share page loads nothing from a third
// party (its pictures are streamed by the studio's own route, `img-src 'self'`).
// A later entry overrides an earlier one for the same key, so these come after
// the site-wide list; `check:auth` reads this function and holds all of it.
const robotsHeader = { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
const sharePageHeaders = [robotsHeader, { key: 'Referrer-Policy', value: 'no-referrer' }]

const nextConfig: NextConfig = {
  // Only for several `next dev` servers at once on one machine (the build agents, the checks): `INKDESK_DIST_DIR=.next-3931`.
  ...(process.env.INKDESK_DIST_DIR ? { distDir: process.env.INKDESK_DIST_DIR } : {}),
  // No `X-Powered-By: Next.js` advertising the stack.
  poweredByHeader: false,
  // The queue's client libraries load native helpers and read their own files at
  // run time; bundled, they break. Left to Node's own resolution (v3, slice 18).
  serverExternalPackages: ['bullmq', 'ioredis'],
  // Slice 23 (after-audit #1): no image optimizer. Left open, `/_next/image`
  // fetched the studio's own `/api/**` and `/s/**` routes and kept each answer
  // in its disk cache, so a share picture outlived its unpublishing, a
  // takedown and the deletion of the account. The only `<Image>` the studio
  // renders is the brand mark, an SVG the optimizer never touched anyway; and
  // were it switched back on, it would still fetch the brand marks only.
  images: { unoptimized: true, localPatterns: [{ pathname: '/brand/**', search: '' }] },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/s/:path*', headers: sharePageHeaders },
      { source: '/api/s/:path*', headers: [robotsHeader] },
    ]
  },
  experimental: {
    // Once `proxy.ts` exists (slice 19) it buffers every body; nothing the
    // studio accepts is larger than one upload (3.75 MB plus its envelope).
    proxyClientMaxBodySize: '4mb',
  },
}

export default nextConfig
