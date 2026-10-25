// Better Auth's routes (the Better Auth revision, 2026-10-24): sign-up and
// sign-in with email and password, sign-out, the session, the password change
// and the sessions list that Settings › Account uses. See `devpost/spec.md > Revision v3 > Auth (v3)`.
//
// Open to a signed-out caller — that is the point of it — so it guards itself
// before Better Auth sees anything:
//   • only in `better` mode; a desk with sign-in off or in test mode has no
//     accounts, and the route is the studio's 404;
//   • a body larger than any of these forms is refused unread;
//   • every write takes the `signin` window per client address (password
//     guesses), and making an account with a password takes `signup` as well;
//     a read (the session) takes the signed-out `anon` window.
//     Both sign-in windows fail CLOSED when the counter store is down.
// The proxy has already refused a write from another origin (`isCrossOrigin`),
// and Better Auth checks the origin against `trustedOrigins` again.
import { signInOn } from '@/lib/auth/config'
import { limitsEnabled } from '@/lib/config'
import { Refused, errorResponse } from '@/lib/errors'

export const runtime = 'nodejs'

/** The largest form here (sign-up: a name, an address, a password) is well under this. */
const BODY_LIMIT_BYTES = 16 * 1024

const NOT_FOUND = 'There is no such page.'
const TOO_LARGE = 'That request is larger than a sign-in form.'

async function guard(req: Request): Promise<void> {
  if (!signInOn()) throw new Refused(NOT_FOUND, 404)
  const length = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > BODY_LIMIT_BYTES) throw new Refused(TOO_LARGE, 413)
  if (!limitsEnabled()) return
  const { limitByAddress } = await import('@/lib/limits/requests')
  if (req.method === 'GET' || req.method === 'HEAD') return limitByAddress(req, 'anon')
  await limitByAddress(req, 'signin')
  if (new URL(req.url).pathname.endsWith('/sign-up/email')) await limitByAddress(req, 'signup')
}

async function handle(req: Request): Promise<Response> {
  try {
    await guard(req)
    const { getAuth } = await import('@/lib/auth/server')
    return await getAuth().handler(req)
  } catch (err) {
    return errorResponse(err, 'auth', 'Signing in isn’t working just now. Try again in a moment.')
  }
}

export const GET = handle
export const POST = handle
