// The cover (slice 11): Generate cover, Redraw cover and Try again — one
// image of the lead character against their locked sheet, from the
// Director's brief, in the project's style. Queued and answered at once; the
// poll watches it land. The title is lettered by the app over the art and is
// never part of the request. See `lib/director.ts > inkCover`.
import { read } from '@/lib/chapter'
import { isCoverQueued, queueCover } from '@/lib/director'
import { errorResponse, Refused } from '@/lib/errors'
import { lockedPair } from '@/lib/script'

export const runtime = 'nodejs'

const CALM = 'The cover couldn’t start inking just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // Checked before queuing so a refusal is a sentence, not a silent no-op;
    // `markCoverInking` runs the same rules inside the lock.
    const desk = await read(id)
    if (!desk.cover) throw new Refused('Write the chapter plan first — the cover brief comes with it.')
    if (desk.cover.status === 'inking') throw new Refused('The cover is already inking.')
    if (desk.cover.brief.trim() === '') throw new Refused('Write the cover brief first.')
    lockedPair(desk)
    if (isCoverQueued(id, desk.address.chapterId)) throw new Refused('The cover is already waiting to ink.')
    queueCover(id, desk.address.chapterId)
    return Response.json(await read(id))
  } catch (err) {
    return errorResponse(err, 'cover', CALM)
  }
}
