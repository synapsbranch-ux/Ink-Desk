// Make the judges' demo account (the Better Auth revision, 2026-10-24) — an
// email-and-password account whose address is marked VERIFIED, so it can be on
// ALLOWLIST_EMAILS (the studio sends no email, so an account made on the
// sign-up page never is). Given the email of an account that already exists —
// the learner's own — it marks that one verified instead, so ADMIN_EMAILS and
// ALLOWLIST_EMAILS can match it; this is the only way an address is verified. Its credentials go in the Devpost testing
// instructions, which the learner writes. Then give it a finished chapter with
// `scripts/seed-judge.mts --to <the id this prints>`.
//
//   JUDGE_PASSWORD='…' npm run judge:account -- --email judge@example.com [--dry-run]
//
// The password is read from JUDGE_PASSWORD (or --password), at least 10
// characters; it is never printed. Run again with the same email to mark an
// existing account verified and write its record again — the password of an
// existing account is NOT changed (sign in and change it in Settings › Account).
//
// Uses the web service's own settings (`.env`): INKDESK_AUTH=better,
// BETTER_AUTH_SECRET and the MongoDB the accounts live in. Because that
// database may be the live studio's, it refuses unless
// INKDESK_JUDGE_CONFIRMED=yes. See `devpost/spec.md > Revision v3 > Auth (v3)`.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import { parseArgs } from 'node:util'

const USAGE = "Usage: JUDGE_PASSWORD='…' npm run judge:account -- --email judge@example.com [--dry-run]"
const PASSWORD_MIN = 10

function fail(sentence: string): never {
  console.error(sentence)
  process.exit(1)
}

let args
try {
  args = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }).values
} catch (err) {
  fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`)
}

const email = (args.email ?? '').trim().toLowerCase()
const password = args.password ?? process.env.JUDGE_PASSWORD ?? ''
const dryRun = args['dry-run'] === true
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(`--email must be an email address.\n${USAGE}`)

const { authMode, authProblems } = await import('../lib/auth/config')
let mode
try {
  mode = authMode()
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
if (mode !== 'better') fail('INKDESK_AUTH is not better, so there are no accounts to make. Run this with the web service’s settings (INKDESK_AUTH=better, BETTER_AUTH_SECRET and the MongoDB).')
const problems = authProblems()
if (problems.length > 0) fail(`The sign-in settings need fixing — ${problems.join('; ')}.`)
if (process.env.INKDESK_JUDGE_CONFIRMED !== 'yes') {
  fail('This writes an account in the MongoDB that MONGODB_URI (or DB_URL) points at, which may be the live studio’s. Check that it is Ink Desk’s own, then run again with INKDESK_JUDGE_CONFIRMED=yes.')
}

const { getAuth, recordAccount } = await import('../lib/auth/server')
const auth = getAuth()
const ctx = await auth.$context
const found = await ctx.internalAdapter.findUserByEmail(email)

if (dryRun) {
  console.log(found ? `Would mark ${email} (${found.user.id}) verified and write its record. Nothing was written.` : `Would make ${email}, verified. Nothing was written.`)
  process.exit(0)
}

let userId: string
if (found) {
  userId = found.user.id
  console.log(`${email} already has an account (${userId}); its password is left as it is.`)
} else {
  if (password.length < PASSWORD_MIN) fail(`Set JUDGE_PASSWORD (or --password) to at least ${PASSWORD_MIN} characters.\n${USAGE}`)
  const made = await auth.api.signUpEmail({ body: { email, password, name: email.split('@')[0] } })
  userId = made.user.id
  console.log(`Made ${email} (${userId}).`)
}
const user = await ctx.internalAdapter.updateUser(userId, { emailVerified: true })
await recordAccount({ id: user.id, email: user.email, emailVerified: true, createdAt: user.createdAt })

console.log(`Verified, and recorded for the allowlist.`)
console.log(`Account id  ${userId}`)
console.log(`Next: add ${email} to ALLOWLIST_EMAILS, then  npx tsx scripts/seed-judge.mts --from <projectId> --to ${userId}`)
process.exit(0)
