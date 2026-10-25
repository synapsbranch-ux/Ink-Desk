// Runs before every page and API request (Next 16's `proxy`, formerly
// `middleware`; always on Node — `node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/proxy.md`). See `devpost/spec.md >
// Revision v3 > Auth (v3)`.
//
// What it does depends on INKDESK_AUTH (`lib/auth/config.ts`):
//   off     nothing — a single-person desk has no one to keep out.
//   test    the `www` redirect and the Origin check, with no sign-in at all.
//   better  those two, then a signed-out visitor asking for a page is sent to
//           sign-in — OPTIMISTICALLY, from the presence of Better Auth's
//           session cookie alone, with no database call: every route handler
//           and page checks the session for real (`lib/auth/session.ts`),
//           because a proxy must never be the only check.
//
// The health check (Railway asks with the host `healthcheck.railway.app`)
// passes straight through. Better Auth's own routes (`/api/auth/*`) are API
// routes: they answer for themselves, and their writes are Origin-checked here
// like every other.
//
// Every page also gets its Content Security Policy here (slice 23, after-audit
// #3; `lib/csp.ts`), in every mode, sign-in off included: a fresh nonce per
// request, handed to the page's render with the policy (Next reads the nonce
// from it and puts it on its own scripts),
// and the same policy on the response. API answers keep the static policy
// from `next.config.ts`, which allows no inline script; `check:hardening`
// holds both.
//
// Slice 21 adds nothing to this file, on purpose, and `check:auth` holds why:
//   • `/s/*` (a shared manga and its picture card) is an open PAGE
//     (`isPublicPage`), so a stranger holding a link is never sent to sign-in.
//   • `/api/s/*` (that page's data, pictures and report form) needs no session
//     either, but it is NOT among the unchecked API prefixes: the Origin check
//     still judges its writes, so a page on another site cannot post reports
//     for a visitor. Its reads reach the route, which takes an address window
//     (`limitByAddress`) before it does anything else.
//   • `/admin/*` is a page like any other: a signed-out visitor goes to
//     sign-in, and the page itself answers anyone who is not an admin with the
//     studio's 404 (`lib/auth/admin.ts`) — the proxy is never the only check.
import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import {
  COOKIE_PREFIX,
  PATH_HEADER,
  CROSS_ORIGIN_SENTENCE,
  authMode,
  authorizedParties,
  isApi,
  isCrossOrigin,
  isPublicApi,
  isPublicPage,
  wwwRedirect,
} from './lib/auth/config'
import { signInHref } from './lib/auth/next'
import { contentSecurityPolicy, newNonce } from './lib/csp'

// A page request's headers with its nonce and policy.
const pageHeaders = new WeakMap<Request, Headers>()

/** Through to the page, with the nonce and the policy among its request headers. */
function next(req: Request): NextResponse {
  const headers = pageHeaders.get(req)
  return headers ? NextResponse.next({ request: { headers } }) : NextResponse.next()
}

/** Sign-in, with the way back to where the visitor was going (a path on this studio, never another site). */
function toSignIn(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL(signInHref(`${req.nextUrl.pathname}${req.nextUrl.search}`), req.url), 307)
}

export async function proxy(req: NextRequest) {
  const mode = authMode()
  const { pathname } = req.nextUrl

  let policy: string | null = null
  if (!isApi(pathname)) {
    const nonce = newNonce()
    policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === 'development' })
    const headers = new Headers(req.headers)
    headers.set('x-nonce', nonce)
    headers.set(PATH_HEADER, `${pathname}${req.nextUrl.search}`)
    headers.set('content-security-policy', policy)
    pageHeaders.set(req, headers)
  }
  const res = decide(req, mode)
  if (policy) res.headers.set('Content-Security-Policy', policy)
  return res
}

function decide(req: NextRequest, mode: ReturnType<typeof authMode>): Response {
  if (mode === 'off') return next(req)

  const { pathname } = req.nextUrl
  if (isPublicApi(pathname)) return next(req)

  const apex = wwwRedirect(req.url, req.headers.get('host'))
  if (apex) return NextResponse.redirect(apex, 308)

  if (isCrossOrigin(req, authorizedParties())) {
    return NextResponse.json({ error: CROSS_ORIGIN_SENTENCE }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  if (mode === 'test') return next(req)
  // better: API routes answer 401 themselves; the open pages stay open.
  if (isApi(pathname) || isPublicPage(pathname)) return next(req)
  if (!getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX })) return toSignIn(req)
  return next(req)
}

export const config = {
  // Every page and every API route, never Next's own files or a static asset
  // (an image, a font, a stylesheet).
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/api(.*)',
  ],
}
