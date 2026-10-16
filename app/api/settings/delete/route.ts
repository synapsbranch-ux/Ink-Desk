// Delete my account (v3, slice 21), for Settings › Data and privacy:
//   POST { confirm: 'delete my account' } → 202 { job: { id, status } }   start the deletion — a background job
//   GET → { state: 'none' | 'working' | 'done' | 'failed', error? }
// The phrase must be typed (the dialog asks twice; the server checks it again — trimmed, any
// case — and a different one is a 400 that says what to type). On a desk with SIGN-IN OFF the
// request is refused before anything is read: the one owner there, `local`, is the whole desk,
// so "delete my account" would wipe it. The job is the same one the Clerk webhook starts for
// `user.deleted`; one deletion per person is ever in flight (the dedupe key), so a second click,
// the webhook and a retry all find the same job. It reserves nothing and is not stopped by
// GENERATION_ENABLED or the in-flight caps — a person must always be able to leave. Never cached.
// See `lib/account/deletion.ts` for what goes and in what order.
import { z } from 'zod'
import { authMode } from '@/lib/auth/config'
import { requireUser } from '@/lib/auth/session'
import { deleteState } from '@/lib/account/state'
import { parseJson } from '@/lib/body'
import { Refused, errorResponse } from '@/lib/errors'
import { enqueueAccountJob } from '@/lib/queue/enqueue'
import { LOCAL_OWNER, NO_ACCOUNT_TO_DELETE } from '@/lib/queue/jobs'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** What must be typed; compared trimmed and case-insensitively. */
const CONFIRM_PHRASE = 'delete my account'
const BODY_LIMIT_BYTES = 1024
const UNREADABLE = 'That request couldn’t be read. Type “delete my account” to confirm.'
const WRONG_PHRASE = 'To delete your account, type “delete my account” exactly. Nothing was changed.'

const BodySchema = z.object({ confirm: z.string().max(200) }).strict()

export async function POST(req: Request) {
  try {
    const userId = await requireUser(req)
    // A desk with sign-in off has no account to delete — and deleting its owner would wipe the desk.
    if (userId === LOCAL_OWNER || authMode() === 'off') throw new Refused(NO_ACCOUNT_TO_DELETE, 409)
    const { confirm } = await parseJson(req, BodySchema, BODY_LIMIT_BYTES, UNREADABLE)
    if (confirm.trim().toLowerCase() !== CONFIRM_PHRASE) throw new Refused(WRONG_PHRASE, 400)
    const { job } = await enqueueAccountJob({ ownerId: userId, kind: 'delete-account' })
    return Response.json({ job: { id: job.id, status: job.status } }, { status: 202, headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'delete-account', 'The deletion couldn’t be started just now. Nothing was removed; try again in a moment.')
  }
}

export async function GET(req: Request) {
  try {
    const userId = await requireUser(req)
    return Response.json(await deleteState(userId), { headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'delete-account', 'We couldn’t check on the deletion just now. Try again in a moment.')
  }
}
