// Who is calling (v3, slice 19). Every route handler asks here first — the
// proxy's redirect is only optimistic, and Next's own guide says the proxy
// must never be the only check (`node_modules/next/dist/docs/01-app/02-guides/
// authentication.md`). See `devpost/spec.md > Revision v3 > Auth (v3)`.
//
//   off    everyone is `local`, the one owner of a single-person desk
//   test   the `x-inkdesk-test-user` header names the caller (development and
//          the checks; production refuses the mode at boot and in `authMode`)
//   clerk  Clerk's session, verified by `clerkMiddleware` in `proxy.ts`
//
// Clerk is loaded only in clerk mode, so the checks and a local desk never
// load it.
import 'server-only'
import { limitsEnabled } from '../config'
import { Refused } from '../errors'
import { authMode } from './config'

/** The owner of everything on a desk with sign-in off — and of every record made before accounts existed. */
export const LOCAL_OWNER = 'local'

/** The header a test-mode caller names itself with. */
export const TEST_USER_HEADER = 'x-inkdesk-test-user'

/** What a test-mode user id must look like: Clerk's own shape, so nothing downstream can tell the difference. */
const TEST_USER = /^user_[A-Za-z0-9]{1,40}$/

/** The one sentence a signed-out caller gets, from every route. */
export const SIGN_IN_SENTENCE = 'Sign in to use the studio.'

async function testUser(req?: Request): Promise<string | null> {
  let value: string | null
  if (req) {
    value = req.headers.get(TEST_USER_HEADER)
  } else {
    // A page has no Request; Next gives it the incoming headers.
    const { headers } = await import('next/headers')
    value = (await headers()).get(TEST_USER_HEADER)
  }
  return value && TEST_USER.test(value) ? value : null
}

/**
 * The caller's user id, or null when nobody is signed in. Route handlers pass
 * their Request; pages pass nothing.
 */
export async function currentUser(req?: Request): Promise<string | null> {
  const mode = authMode()
  if (mode === 'off') return LOCAL_OWNER
  if (mode === 'test') return testUser(req)
  // clerk: `auth()` reads what clerkMiddleware verified for this request.
  const { auth } = await import('@clerk/nextjs/server')
  const { userId } = await auth()
  return userId ?? null
}

/**
 * The caller's user id; a signed-out caller is refused with 401 and the one
 * sentence.
 *
 * Slice 20: this is also the ONE choke point for the request windows. A route
 * handler passes its Request, and — when the limits are on — the caller's
 * window for that kind of request is taken here, before the route does
 * anything else, so no route has to remember (`lib/limits/requests.ts`). A
 * signed-out caller takes no window: it gets the 401 and nothing else happens,
 * which costs no store, no provider and no counter. The routes that have no
 * signed-in person (a share view, a report) take a window keyed by the
 * client's address themselves (`limitByAddress`). A page passes no Request and
 * takes no window; with the limits off nothing is loaded or counted.
 */
export async function requireUser(req?: Request): Promise<string> {
  const userId = await currentUser(req)
  if (!userId) throw new Refused(SIGN_IN_SENTENCE, 401)
  if (req !== undefined && limitsEnabled()) await (await import('../limits/requests')).limitRequest(req, userId)
  return userId
}
