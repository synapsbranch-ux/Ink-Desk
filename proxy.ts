// Runs before every page and API request (Next 16's `proxy`, formerly
// `middleware`; always on Node — `node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/proxy.md`). See `devpost/spec.md >
// Revision v3 > Auth (v3)`.
//
// What it does depends on INKDESK_AUTH (`lib/auth/config.ts`):
//   off    nothing — a single-person desk has no one to keep out.
//   test   the `www` redirect and the Origin check, with no Clerk at all.
//   clerk  those two, then Clerk verifies the session (with CLERK_JWT_KEY, no
//          network call), and a signed-out visitor asking for a page is sent
//          to sign-in — optimistically: every route handler and page checks
//          again (`lib/auth/session.ts`), because a proxy must never be the
//          only check.
//
// The health check (Railway asks with the host `healthcheck.railway.app`) and
// Clerk's webhooks pass straight through: neither has a session, and the
// webhook proves itself with its signature.
//
// Every page also gets its Content Security Policy here (slice 23, after-audit
// #3; `lib/csp.ts`), in every mode, sign-in off included: a fresh nonce per
// request, handed to the page's render with the policy (Next reads the nonce
// from it and puts it on its own scripts; the root layout gives it to Clerk),
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
import { NextResponse, type NextFetchEvent, type NextMiddleware, type NextRequest } from 'next/server'
import {
  CROSS_ORIGIN_SENTENCE,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  authMode,
  authorizedParties,
  clerkSettings,
  isApi,
  isCrossOrigin,
  isPublicApi,
  isPublicPage,
  wwwRedirect,
  type ClerkSettings,
  clerkHostForCsp,
} from './lib/auth/config'
import { contentSecurityPolicy, newNonce } from './lib/csp'

// Built on the first clerk-mode request, not at import: a desk with sign-in
// off never loads Clerk, and a changed key (the checks change it) builds anew.
let clerk: { key: string; handler: NextMiddleware } | null = null

// A page request's headers with its nonce and policy, for Clerk's handler to
// pass on (it gets the same request object; an API call has none).
const pageHeaders = new WeakMap<Request, Headers>()

/** Through to the page, with the nonce and the policy among its request headers. */
function next(req: Request): NextResponse {
  const headers = pageHeaders.get(req)
  return headers ? NextResponse.next({ request: { headers } }) : NextResponse.next()
}

async function clerkHandler(settings: ClerkSettings): Promise<NextMiddleware> {
  const key = JSON.stringify(settings)
  if (clerk?.key === key) return clerk.handler
  const { clerkMiddleware } = await import('@clerk/nextjs/server')
  const handler = clerkMiddleware(
    async (auth, req) => {
      const { pathname } = req.nextUrl
      // API routes answer 401 themselves; the open pages stay open.
      if (isApi(pathname) || isPublicPage(pathname)) return next(req)
      const { userId, redirectToSignIn } = await auth()
      if (!userId) return redirectToSignIn({ returnBackUrl: req.url })
      return next(req)
    },
    {
      publishableKey: settings.publishableKey,
      // The secret key is read by Clerk from CLERK_SECRET_KEY; it never passes through here.
      jwtKey: settings.jwtKey,
      authorizedParties: settings.authorizedParties,
      signInUrl: SIGN_IN_PATH,
      signUpUrl: SIGN_UP_PATH,
    }
  )
  clerk = { key, handler }
  return handler
}

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const mode = authMode()
  const { pathname } = req.nextUrl

  let policy: string | null = null
  if (!isApi(pathname)) {
    const nonce = newNonce()
    policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === 'development', clerkHost: clerkHostForCsp() })
    const headers = new Headers(req.headers)
    headers.set('x-nonce', nonce)
    headers.set('content-security-policy', policy)
    pageHeaders.set(req, headers)
  }
  const res = await decide(req, event, mode)
  if (policy) res.headers.set('Content-Security-Policy', policy)
  return res
}

async function decide(req: NextRequest, event: NextFetchEvent, mode: ReturnType<typeof authMode>): Promise<Response> {
  if (mode === 'off') return next(req)

  const { pathname } = req.nextUrl
  if (isPublicApi(pathname)) return next(req)

  const apex = wwwRedirect(req.url, req.headers.get('host'))
  if (apex) return NextResponse.redirect(apex, 308)

  if (isCrossOrigin(req, authorizedParties())) {
    return NextResponse.json({ error: CROSS_ORIGIN_SENTENCE }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  if (mode === 'test') return next(req)
  const handler = await clerkHandler(clerkSettings())
  return (await handler(req, event)) ?? next(req)
}

export const config = {
  // Clerk's documented matcher: every page and every API route, never Next's
  // own files or a static asset (an image, a font, a stylesheet).
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
