// A trailer's public share, for its owner (v3, slice 22) — the same shape as a project's
// (`app/api/projects/[id]/share/route.ts`), for kind `video`:
//   GET    → { share: ShareView | null }   the active share, if there is one
//   POST   → { share }                     Share publicly — idempotent: the active share if it exists. Only a FINISHED
//                                          trailer can be shared (409 otherwise).
//   DELETE → { share: null }               Unpublish — idempotent; the address is dead for good
// The caller must own the trailer (someone else's is the missing video's 404, before any body is read). None of the
// writes takes input. A trailer never changes once it is made, so there is no "update". Every reply carries a token,
// so none is ever cached. See `lib/share/service.ts`.
import { ownedVideo } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { assertNoInput, createVideoShare, shareViewOfVideo, unpublishVideo } from '@/lib/share/service'
import { shareOrigin } from '@/lib/share/url'
import type { ShareView } from '@/lib/share/types'

export const runtime = 'nodejs'

type Params = { params: Promise<{ videoId: string }> }

const reply = (share: ShareView | null) => Response.json({ share }, { headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: Request, { params }: Params) {
  const { videoId } = await params
  try {
    const userId = await requireUser(req)
    const video = await ownedVideo(userId, videoId)
    return reply(await shareViewOfVideo(userId, video, shareOrigin(req)))
  } catch (err) {
    return errorResponse(err, 'share', 'The share couldn’t be read just now. Try again in a moment.')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { videoId } = await params
  try {
    const userId = await requireUser(req)
    const video = await ownedVideo(userId, videoId) // before the body is read
    await assertNoInput(req)
    return reply(await createVideoShare(userId, video, shareOrigin(req)))
  } catch (err) {
    return errorResponse(err, 'share', 'The share couldn’t be made just now. Try again in a moment.')
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { videoId } = await params
  try {
    const userId = await requireUser(req)
    const video = await ownedVideo(userId, videoId)
    await assertNoInput(req)
    await unpublishVideo(video)
    return reply(null)
  } catch (err) {
    return errorResponse(err, 'share', 'The share couldn’t be taken down just now. Try again in a moment.')
  }
}
