// Who may run the studio's admin pages (v3, slice 21): the reports queue, and
// nothing else for now. One list, ADMIN_EMAILS, matched exactly the way
// ALLOWLIST_EMAILS is (`lib/limits/plan.ts`): against the VERIFIED email in
// `store.users` (Clerk's webhook records only a verified address), compared
// case-insensitively. See `devpost/spec.md > Reports (v3)`.
//
//   • An account is an admin when its recorded email is on the list. An
//     account the webhook has not delivered yet, or one with no verified
//     email, is not.
//   • A DELETED account is never an admin (the tombstone is checked), and the
//     list is read fresh on every call, so taking an address off ADMIN_EMAILS
//     in Railway demotes it within the cache below.
//   • On a desk with sign-in off the single `local` owner is the admin, so the
//     learner can see the pages in development. With sign-in on, `local` owns
//     nothing and administers nothing. A blank list in production is nobody.
//   • The store being unreachable never promotes anyone: not an admin until it
//     answers (and the "no" is not remembered).
//
// The answer for anyone else is the answer for a page that does not exist:
// 404, the same sentence as the studio's unknown route, NEVER 403 — an admin
// page must not reveal that it is there. (A signed-out caller to an API route
// gets the 401 every API route gives; being signed out is not a secret, and
// the page itself says nothing at all.)
//
// Cached 15 seconds per person like the plan. That is also the bound on how long
// an account that has just been deleted could still read as an admin in the
// process that cached it; its Clerk session is gone by then, and every
// route re-checks.
//
// Server only.
import 'server-only'
import { adminEmails } from '../config'
import { Refused } from '../errors'
import { store } from '../store'
import { authMode } from './config'
import { LOCAL_OWNER, currentUser, requireUser } from './session'

/** The one answer for an admin page or route to anyone who is not an admin — word for word an unknown page's. */
export const NO_SUCH_PAGE = 'There is no such page.'

type Cached = { at: number; admin: boolean; list: string }
type Pinned = { __inkdeskAdmins?: Map<string, Cached> }
const g = globalThis as typeof globalThis & Pinned

/** A person is looked up in the store at most this often. */
const ADMIN_CACHE_MS = 15_000

/** Is this account an admin? Never throws: anything unreadable is "no". */
export async function isAdmin(userId: string): Promise<boolean> {
  let mode
  try {
    mode = authMode()
  } catch {
    return false // a mode production refuses: the boot stops the server; nothing here promotes anyone
  }
  if (mode === 'off') return userId === LOCAL_OWNER
  if (userId === LOCAL_OWNER) return false
  const list = adminEmails()
  if (list.length === 0) return false
  const key = list.join(',')
  const cache = (g.__inkdeskAdmins ??= new Map())
  const hit = cache.get(userId)
  if (hit && hit.list === key && Date.now() - hit.at < ADMIN_CACHE_MS) return hit.admin
  let admin = false
  try {
    const user = await store.users.get(userId)
    admin = Boolean(user && !user.deletedAt && user.email.trim() !== '' && list.includes(user.email.trim().toLowerCase()))
  } catch (err) {
    console.warn('[admin] could not read the account to check it:', err instanceof Error ? err.message : err)
    return false
  }
  cache.set(userId, { at: Date.now(), admin, list: key })
  return admin
}

/** Forget what was learned about admins — for the checks, which change the list and the accounts under it. */
export function forgetAdmins(): void {
  g.__inkdeskAdmins = undefined
}

/**
 * The route handler's guard: the caller's id if they are signed in AND an admin. A signed-out caller gets
 * `requireUser`'s 401 (and its request window); a signed-in caller who is not an admin gets 404 and the
 * unknown page's sentence — the route does not say that it exists. Call it first, before reading a body.
 */
export async function requireAdmin(req: Request): Promise<string> {
  const userId = await requireUser(req)
  if (!(await isAdmin(userId))) throw new Refused(NO_SUCH_PAGE, 404)
  return userId
}

/**
 * The server component's guard: the admin's id, or the studio's own 404 page
 * (`notFound()`) for anyone else — signed out, signed in, or deleted alike. The
 * proxy has already sent a signed-out visitor to sign-in in clerk mode (every page
 * does that), so a stranger who reaches this line learns nothing from it.
 */
export async function requireAdminPage(): Promise<string> {
  return adminPageGate(await currentUser())
}

/** `requireAdminPage`'s decision on its own, so it can be held without a request: the id of an admin, else Next's 404. */
export async function adminPageGate(userId: string | null): Promise<string> {
  if (userId && (await isAdmin(userId))) return userId
  const { notFound } = await import('next/navigation')
  return notFound()
}
