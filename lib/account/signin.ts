// Ending the sign-in (v3, slice 21; Better Auth since 2026-10-24) — the last
// step of an account deletion, `better` mode only. The person's sessions, their
// password and their Better Auth user are deleted
// from the accounts' database, so nothing new can be made and nobody can sign
// in as them again. A user already gone (an earlier run of this very job did
// it) is a success. Any other failure throws, and the queue tries again.
//
// Nothing secret is logged: an error names the step, never a value.
import 'server-only'
import { workerAuthProblems } from '../auth/config'

/** Why the sign-in cannot be ended right now (the secret or the accounts' database is not set), or null when it can. */
export function signInNotReady(): string | null {
  const problems = workerAuthProblems()
  return problems.length > 0 ? problems.join('; ') : null
}

export async function deleteSignInUser(userId: string): Promise<void> {
  try {
    const { deleteSignIn } = await import('../auth/server')
    await deleteSignIn(userId)
  } catch (err) {
    throw new Error(`The sign-in could not be ended (${err instanceof Error ? err.name : 'no answer'}); the deletion will be tried again`)
  }
}
