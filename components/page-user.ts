// Who is looking at a page (slice 19). The dashboard and the studio resolve
// the caller on the server before reading anything: the proxy's redirect is
// only optimistic, and a page must check for itself.
//
//   clerk  signed out → Clerk's sign-in, with the way back to this page
//   test   signed out → null; the page says so (there is no sign-in to send to)
//   off    always `local`
import 'server-only'
import { authMode } from '@/lib/auth/config'
import { currentUser } from '@/lib/auth/session'
import { limitsEnabled } from '@/lib/config'
import { Refused } from '@/lib/errors'

/** The signed-in user's id; in clerk mode a signed-out visitor never gets past this line. */
export async function pageUser(): Promise<string | null> {
  const userId = await currentUser()
  if (userId) return userId
  if (authMode() === 'clerk') {
    const { auth } = await import('@clerk/nextjs/server')
    const { redirectToSignIn } = await auth()
    return redirectToSignIn() // throws Next's redirect; returnBackUrl defaults to this page
  }
  return null
}

/** What a test-mode desk shows a caller who named nobody. */
export const SIGNED_OUT_SENTENCE = 'This desk is in test mode: name yourself in the x-inkdesk-test-user header.'

/**
 * The person's read window for a page render (after-audit #13). A page reads the store as an API read does — the desk
 * lists projects, shares, trailers and settings; the studio reads the whole project — so it takes the same per-person
 * window `requireUser(req)` takes for `/api/*`. Returns the refusal (429, the calm rate sentence) for the page to show,
 * before it reads anything; null when there is room or the limits are off.
 */
export async function pageWindow(userId: string): Promise<Refused | null> {
  if (!limitsEnabled()) return null
  try {
    await (await import('@/lib/limits/requests')).hit('read', userId)
    return null
  } catch (err) {
    if (err instanceof Refused && (err.status === 429 || err.status === 503)) return err
    throw err
  }
}

/** The heading a page shows over that refusal. */
export const SLOW_DOWN_HEADING = 'One moment.'
