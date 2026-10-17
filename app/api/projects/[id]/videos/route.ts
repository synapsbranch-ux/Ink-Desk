// A project's trailers, newest first (v3, slice 22): GET → { videos: VideoView[] }.
// The caller must own the project (someone else's is the missing project's 404). Each
// trailer is settled first — one whose job is gone is ended as failed, so Try again is
// offered and nothing reads "making" for ever — and is a `VideoView`: states and
// sentences, never a key, a cost or the owner. Never cached.
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { store } from '@/lib/store'
import { videoViewOf } from '@/lib/video/status'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const userId = await requireUser(req)
    await ownedProject(userId, id)
    const mine = (await store.videos.listOf(userId)).filter((video) => video.projectId === id) // newest first
    const videos = await Promise.all(mine.map((video) => videoViewOf(video)))
    return Response.json({ videos }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err, 'videos', 'The trailers couldn’t be listed just now. Try again in a moment.')
  }
}
