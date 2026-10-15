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
