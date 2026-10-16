// Ending the sign-in (v3, slice 21) — step 3 of the account deletion, clerk mode
// only. Deleting the Clerk user ends their sessions, so nothing new can be made
// while their data goes. A user Clerk no longer has (the webhook came from
// Clerk's own deletion, or an earlier run of this very job did it) is a
// success. Any other answer throws, and the queue tries again.
//
// The secret is read by Clerk from CLERK_SECRET_KEY and is never touched,
// logged or put in an error here: what is logged is the HTTP status and nothing
// from the response.
import 'server-only'

/** Is this Clerk's "there is no such user"? Its API errors carry the HTTP status and a code. */
export function isGone(err: unknown): boolean {
  const e = err as { status?: unknown; errors?: { code?: unknown }[] } | null
  if (e?.status === 404) return true
  return Array.isArray(e?.errors) && e.errors.some((item) => item?.code === 'resource_not_found')
}

export async function deleteClerkUser(userId: string): Promise<void> {
  try {
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    await client.users.deleteUser(userId)
  } catch (err) {
    if (isGone(err)) return
    const status = (err as { status?: unknown } | null)?.status
    throw new Error(`Clerk would not delete the user (${typeof status === 'number' ? `HTTP ${status}` : 'no answer'}); the deletion will be tried again`)
  }
}
