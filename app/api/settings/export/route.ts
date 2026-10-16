// Export my data (v3, slice 21), for Settings › Data and privacy:
//   POST → 202 { job: { id, status } }   ask for an export — a background job on the account queue;
//                                        asking again while one is under way returns THAT job
//   GET  → { state: 'none' | 'working' | 'ready' | 'failed', jobId?, readyAt?, bytes?, error? }
// The caller's own id is the only key — there is no one else's export to ask for.
// The write takes no input (an empty body, or `{}`) and is an ordinary edit for the
// request window. It reserves nothing and calls no provider, so it is not stopped by
// GENERATION_ENABLED, the credit breaker or the in-flight caps: a person must always be
// able to take their data (`enqueueAccountJob`). Never cached. See `lib/account/export.ts`.
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { enqueueAccountJob } from '@/lib/queue/enqueue'
import { assertNoInput, exportState } from '@/lib/account/state'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  try {
    const userId = await requireUser(req)
    await assertNoInput(req)
    const { job } = await enqueueAccountJob({ ownerId: userId, kind: 'export' })
    return Response.json({ job: { id: job.id, status: job.status } }, { status: 202, headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'export', 'The export couldn’t be started just now. Try again in a moment.')
  }
}

export async function GET(req: Request) {
  try {
    const userId = await requireUser(req)
    return Response.json(await exportState(userId), { headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'export', 'Your export couldn’t be checked just now. Try again in a moment.')
  }
}
