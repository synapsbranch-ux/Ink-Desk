// Better Auth, inside the studio (v3, slice 19; replaced Clerk in the revision
// of 2026-10-24). One instance per process, built on the first request that
// needs it, so a desk with sign-in off or in test mode never loads it. See
// `devpost/spec.md > Revision v3 > Auth (v3)`.
//
//   • Email and password, and nothing else — the one sign-in the plan names
//     (`devpost/prd.md > Accounts and Sign-in (v3)`).
//   • Accounts and sessions live in the studio's own MongoDB, in Better Auth's
//     collections (`user`, `session`, `account`, `verification`) beside the
//     studio's own `users` records — the names never meet.
//   • No email is ever sent: there is no email service. So nobody's address is
//     taken on their word. An account made on the sign-up page starts
//     UNVERIFIED and stays so. The studio's `users` record — what ALLOWLIST_EMAILS and ADMIN_EMAILS are
//     matched against — carries the address only when it is verified
//     (`recordAccount`). A stranger who signs up with the learner's address gets
//     a free account and nothing more. The only way an address becomes verified
//     is `scripts/judge-account.mts`, run by the learner: it makes the judge
//     account, and marks an existing account (the learner's own, for
//     ADMIN_EMAILS) verified.
//   • Deleting an account is the studio's job (`lib/account/deletion.ts`), never
//     Better Auth's own endpoint: the sweep removes the work first and the
//     sign-in last (`deleteSignIn`).
//   • Rate limits are the studio's own, per client address, taken in the route
//     before Better Auth sees the request (`app/api/auth/[...all]/route.ts`);
//     Better Auth's in-memory limiter is off so there is one rule, not two.
//
// Server only (SEC-15).
import 'server-only'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { MongoClient } from 'mongodb'
import { store } from '../store'
import { COOKIE_PREFIX, AUTH_API_PATH, betterSettings, type BetterSettings } from './config'

/** What the studio needs to know of a Better Auth user. */
export type AccountUser = { id: string; email: string; emailVerified: boolean; createdAt: Date | string }

/** The passwords Better Auth accepts; the sign-in window (per address) keeps guessing slow. */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

/**
 * Write the studio's own record of an account: the id, the address only when it is verified, and when the account was
 * made. The store writes nothing when nothing changed, and a deleted account stays deleted (its tombstone wins).
 */
export async function recordAccount(user: AccountUser): Promise<void> {
  const createdAt = new Date(user.createdAt)
  await store.users.upsert({
    id: user.id,
    email: user.emailVerified ? user.email.trim() : '',
    createdAt: Number.isFinite(createdAt.getTime()) ? createdAt.toISOString() : new Date().toISOString(),
  })
}

/** Better Auth's options for these settings and that database: the one place they are written, so the checks build the same thing on a memory database. */
export function authOptions(settings: Pick<BetterSettings, 'secret' | 'baseURL' | 'authorizedParties'>, database: BetterAuthOptions['database']) {
  return {
    appName: 'Ink Desk',
    secret: settings.secret,
    baseURL: settings.baseURL,
    basePath: AUTH_API_PATH,
    trustedOrigins: settings.authorizedParties,
    database,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // Nothing can be sent, so nothing is waited for: the address simply counts as unverified (see above).
      requireEmailVerification: false,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
    },
    user: {
      // An address cannot be changed without an email to prove the new one.
      changeEmail: { enabled: false },
      // Deleting goes through the studio's job, which removes the work before the sign-in.
      deleteUser: { enabled: false },
    },
    account: {
      // One way in, so nothing to join: no account is ever linked to another sign-in.
      accountLinking: { enabled: false },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // thirty days
      updateAge: 60 * 60 * 24, // the expiry moves forward at most once a day
    },
    rateLimit: { enabled: false },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // The client address is the studio's to read (`lib/limits/requests.ts`); Better Auth keeps none.
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      user: {
        create: { after: async (user: AccountUser) => mirror(user) },
        update: { after: async (user: AccountUser) => mirror(user) },
      },
    },
  } satisfies BetterAuthOptions
}

/** The record follows the account. A store that does not answer is logged, not fatal: `currentUser` writes it again. */
async function mirror(user: AccountUser): Promise<void> {
  try {
    await recordAccount(user)
  } catch (err) {
    console.warn('[auth] the account record could not be written yet:', err instanceof Error ? err.message : err)
  }
}

function build(settings: BetterSettings) {
  const client = new MongoClient(settings.mongoUrl, { serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000 })
  // Railway's MongoDB is a single server: no transactions.
  return betterAuth(authOptions(settings, mongodbAdapter(client.db(settings.mongoDb), { client, transaction: false })))
}

export type Auth = ReturnType<typeof build>

type Pinned = { __inkdeskAuth?: { key: string; auth: Auth } }
const g = globalThis as typeof globalThis & Pinned

/** The process's Better Auth. Throws `AuthConfigError` when the settings are wrong (the boot has already said so). */
export function getAuth(): Auth {
  const settings = betterSettings()
  const key = JSON.stringify(settings)
  if (g.__inkdeskAuth?.key !== key) g.__inkdeskAuth = { key, auth: build(settings) }
  return g.__inkdeskAuth.auth
}

/**
 * End a person's sign-in for good: their sessions, their password and their Better Auth
 * user. The last step of an account deletion. Safe to repeat: a user already gone is a success.
 */
export async function deleteSignIn(userId: string, auth: Pick<Auth, '$context'> = getAuth()): Promise<void> {
  const ctx = await auth.$context
  await ctx.internalAdapter.deleteUserSessions(userId)
  await ctx.internalAdapter.deleteAccounts(userId)
  await ctx.internalAdapter.deleteUser(userId)
}
