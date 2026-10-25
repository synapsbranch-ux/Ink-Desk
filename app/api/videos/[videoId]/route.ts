// One trailer, for its owner (v3, slice 22):
//   GET    → { video: VideoView }    the poll. A trailer that says queued/making while its job is gone (the studio
//                                    restarted) is ended as failed on the way, with "The studio restarted before this
//                                    finished. Try again." — the web's version of the stale-claim rule.
//   POST   → { video }              body { action: 'retry', shot?: 0..3 }: Try again on one failed shot (a new, smaller
//                                    job with its own hold), or — with no shot — put a trailer together again when every
//                                    shot is made and only the assembly failed. Only when nothing is running for it.
// The caller must own the trailer (someone else's, an unknown and a malformed id are one 404, before the body is
// read). The body is strict and under 1 KB. POST is a spend: the `image` request window, the flags, the quota.
// Never cached. See `lib/video/animate.ts`.
import { z } from 'zod'
import { ownedVideo } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { parseJson } from '@/lib/body'
import { errorResponse } from '@/lib/errors'
import { assertVideoOpen, retryShot } from '@/lib/video/animate'
import { videoViewOf } from '@/lib/video/status'

export const runtime = 'nodejs'

type Params = { params: Promise<{ videoId: string }> }

const NO_STORE = { 'Cache-Control': 'no-store' }

const RETRY_UNREADABLE = 'That request couldn’t be read.'
const RetrySchema = z
  .object({
    action: z.literal('retry'),
    /** The shot to try again, 0–3; absent means "put the trailer together again". */
    shot: z.number().int().min(0).max(3).optional(),
  })
  .strict()

export async function GET(req: Request, { params }: Params) {
  const { videoId } = await params
  try {
    const userId = await requireUser(req)
    const video = await ownedVideo(userId, videoId)
    return Response.json({ video: await videoViewOf(video) }, { headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'video', 'The trailer couldn’t be read just now. Try again in a moment.')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { videoId } = await params
  try {
    const userId = await requireUser(req)
    const video = await ownedVideo(userId, videoId) // before the body is read
    assertVideoOpen()
    const body = await parseJson(req, RetrySchema, 1024, RETRY_UNREADABLE)
    return Response.json({ video: await retryShot(video, body.shot ?? null) }, { headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'video', 'That shot couldn’t be started again just now. Try again in a moment.')
  }
}
