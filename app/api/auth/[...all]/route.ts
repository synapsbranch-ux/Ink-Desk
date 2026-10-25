// Better Auth's routes (the Better Auth revision, 2026-10-24): sign-up (open
// again since 2026-10-25) and sign-in with email and password, sign-out, the
// session, the password change and the sessions list that Settings › Account
// uses. See `devpost/spec.md > Revision v3 > Auth (v3)`.
//
// Open to a signed-out caller — that is the point of it — so it guards itself
// before Better Auth sees anything:
//   • only in `better` mode; a desk with sign-in off or in test mode has no
//     accounts, and the route is the studio's 404;
//   • a body larger than any of these forms is refused: unread when its
//     Content-Length says so, and as soon as it passes the cap when it declares
//     none (a chunked body) — Better Auth is handed the bytes read here, never
//     the caller's stream, so no size a caller sends gets past 16 KB;
//   • every write takes the `signin` window per client address (password
//     guesses), and making an account takes the `signup` window first;
//     a read (the session) takes the signed-out `anon` window.
//     Both sign-in windows fail CLOSED when the counter store is down: a
//     sign-up is refused, never let through unlimited.
// The proxy has already refused a write from another origin (`isCrossOrigin`),
// and Better Auth checks the origin against `trustedOrigins` again.
import { signInOn } from '@/lib/auth/config'
import { limitsEnabled } from '@/lib/config'
import { Refused, errorResponse } from '@/lib/errors'

export const runtime = 'nodejs'

/** The largest form here (sign-up: a name, an address, a password) is well under this. */
const BODY_LIMIT_BYTES = 16 * 1024

/** Better Auth's sign-up (`/sign-up/email`), however the path is spelled — another case, a trailing slash, escaped. */
function isSignUp(url: string): boolean {
  let path = new URL(url).pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    // A malformed escape is judged as written (Better Auth will not route it either).
  }
  return /\/sign-up(?:\/|$)/i.test(path)
}

const NOT_FOUND = 'There is no such page.'
const TOO_LARGE = 'That request is larger than a sign-in form.'

/**
 * The body, read here to its end but never past the cap. A declared Content-Length is only a claim, and a chunked body
 * declares nothing, so the bytes are counted as they arrive; past the cap the stream is cancelled and the request is a
 * 413. Null when the request carries no body.
 */
async function boundedBody(req: Request): Promise<Buffer | null> {
  if (!req.body) return null
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > BODY_LIMIT_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Refused(TOO_LARGE, 413)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Refuse what must not reach Better Auth; otherwise the request to hand it — a write rebuilt on the bytes read here. */
async function guard(req: Request): Promise<Request> {
  if (!signInOn()) throw new Refused(NOT_FOUND, 404)
  const length = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > BODY_LIMIT_BYTES) throw new Refused(TOO_LARGE, 413)
  const read = req.method === 'GET' || req.method === 'HEAD'
  if (limitsEnabled()) {
    const { limitByAddress } = await import('@/lib/limits/requests')
    if (read) await limitByAddress(req, 'anon')
    else {
      if (isSignUp(req.url)) await limitByAddress(req, 'signup')
      await limitByAddress(req, 'signin')
    }
  }
  if (read) return req
  const body = await boundedBody(req)
  const headers = new Headers(req.headers)
  headers.delete('transfer-encoding')
  if (body) headers.set('content-length', String(body.byteLength))
  return new Request(req.url, { method: req.method, headers, body })
}

async function handle(req: Request): Promise<Response> {
  try {
    const checked = await guard(req)
    const { getAuth } = await import('@/lib/auth/server')
    return await getAuth().handler(checked)
  } catch (err) {
    return errorResponse(err, 'auth', 'Signing in isn’t working just now. Try again in a moment.')
  }
}

export const GET = handle
export const POST = handle
