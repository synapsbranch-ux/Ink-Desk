// Better Auth, inside the studio (v3, slice 19; replaced Clerk in the revision
// of 2026-10-24). One instance per process, built on the first request that
// needs it, so a desk with sign-in off or in test mode never loads it. See
// `devpost/spec.md > Revision v3 > Auth (v3)`.
//
//   • Email and password, and nothing else — the one sign-in the plan names
//     (`devpost/prd.md > Accounts and Sign-in (v3)`).
//   • Anyone may sign up (reopened 2026-10-25, the learner's decision: the
//     judges must be able to make their own account) on `/sign-up`, through
//     Better Auth's `/sign-up/email`; the route takes the per-address `signup`
//     window first (`app/api/auth/[...all]/route.ts`). A self-made account is
//     UNVERIFIED — nothing can be sent to prove the address — so it is on the
//     free plan and can never match ALLOWLIST_EMAILS or ADMIN_EMAILS. The
//     learner still makes verified accounts (their own, and the judges' demo
//     account) with `npm run judge:account`, through `createAccount` below.
//   • What an account holds is the server's to say, not the form's: the display
//     name is the address before the @ (`displayNameOf`, at most 64
//     characters), no picture is kept, and Better Auth's `/update-user` is off
//     (`disabledPaths`) — the studio never calls it (2026-10-25).
//   • Accounts and sessions live in the studio's own MongoDB, in Better Auth's
//     collections (`user`, `session`, `account`, `verification`) beside the
//     studio's own `users` records — the names never meet.
//   • No email is ever sent: there is no email service. So nobody's address is
//     taken on their word. An account made on the sign-up page starts
//     UNVERIFIED and stays so (Better Auth writes `emailVerified: false` there,
//     whatever the form sends). The studio's `users` record — what ALLOWLIST_EMAILS and ADMIN_EMAILS are
//     matched against — carries the address only when it is verified
//     (`recordAccount`), and the user hooks below write it on sign-up exactly
//     as for an account the learner makes. A stranger who signs up with the
//     learner's address gets a free account and nothing more. `createAccount`
//     (run by the learner through `scripts/judge-account.mts`) marks the
//     address verified when it makes the account, because the learner vouches
//     for it; for an account that already exists unverified, the script marks
//     it verified only when it is given that account's own password
//     (`holdsPassword`), so it never verifies a stranger's sign-up.
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

/** The longest display name an account gets. */
export const NAME_MAX = 64

/**
 * The display name every account gets — the part of the address before the @, at most `NAME_MAX` characters — whatever
 * a form sent (2026-10-25: sign-up is open, and Better Auth would otherwise store any `name`, of any length, and any
 * `image`, as sent). The studio shows neither; Privacy says what is kept.
 */
export function displayNameOf(email: string): string {
  return email.trim().split('@')[0].slice(0, NAME_MAX) || 'Storyteller'
}

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
    // Better Auth's `/update-user` would let a signed-in caller store any name and any `image` URL; the studio never
    // calls it (there is nothing in an account to change but the password), so it is a 404 (2026-10-25).
    disabledPaths: ['/update-user'],
    emailAndPassword: {
      enabled: true,
      // Sign-up is open (2026-10-25): an account made there is signed in at once, unverified (see above).
      disableSignUp: false,
      autoSignIn: true,
      // Nothing can be sent, so nothing is waited for: the address simply counts as unverified.
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
        create: {
          // The name is the server's, from the address, and no picture is kept: what a sign-up form sends for either is ignored.
          before: async (user) => ({ data: { name: displayNameOf(user.email), image: null } }),
          after: async (user: AccountUser) => mirror(user),
        },
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
 * Make an email-and-password account, VERIFIED — the learner's way (`scripts/judge-account.mts`): the judges' demo
 * account and their own, which can then be on ALLOWLIST_EMAILS or ADMIN_EMAILS. An account made on the sign-up page
 * is never verified; this is. Better Auth's own structure: a user, and a `credential` account holding the password's
 * hash. The studio's record is written by the user hook.
 */
export async function createAccount(auth: Pick<Auth, '$context'>, input: { email: string; password: string }): Promise<{ id: string; email: string; createdAt: Date }> {
  const ctx = await auth.$context
  const email = input.email.trim().toLowerCase()
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) throw new Error(`The password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`)
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error('There is already an account with that email.')
  const hash = await ctx.password.hash(input.password)
  const user = await ctx.internalAdapter.createUser({ email, name: displayNameOf(email), emailVerified: true }, { method: 'admin' })
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash })
  return { id: user.id, email: user.email, createdAt: user.createdAt }
}

/**
 * Whether `password` is the password of the account `userId` (its `credential` sign-in), checked against the stored
 * hash. `scripts/judge-account.mts` asks it before marking an UNVERIFIED account verified: since sign-up is open, an
 * account with that address may be a stranger's, and only its own password proves the learner made it.
 */
export async function holdsPassword(auth: Pick<Auth, '$context'>, userId: string, password: string): Promise<boolean> {
  if (!password || password.length > PASSWORD_MAX) return false
  const ctx = await auth.$context
  const accounts = await ctx.internalAdapter.findAccounts(userId)
  const hash = accounts.find((a) => a.providerId === 'credential' && a.accountId === userId)?.password
  if (!hash) return false
  return ctx.password.verify({ hash, password })
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
