// GET a project's status: `{ rev, activity }` — the light poll (v3, slice 21,
// closes CR-8). While something is being drawn the studio asks this every
// second and a half instead of reading the whole desk: `rev` is when the
// project last changed (`store.projectStamp`: a projection of two fields, never
// the project), `activity` is what the queue holds for it (a job list by
// project — what is waiting or drawing, a failure still worth its sentence, and
// whether the queue is up). The studio reads the full desk (`GET
// /api/projects/<id>`) only when `rev` is not the one it holds or a job ended.
//
// Cheap on purpose, and a reader that writes nothing to the project: no parse,
// no `demoteStale` (the full read of the desk still does that, and a studio
// that sees nothing live always takes one — see `lib/poll.ts`). The one write
// on the way is the queue's own floor for a job whose worker is gone
// (`liveJobs` lets a lapsed lease go), a job record, as every reader of the
// queue does. Same ownership rule as the desk: someone else's project is the
// missing one's 404, word for word, before anything else is read. The reply is
// a few hundred bytes and never cached. See `devpost/security-report.md` CR-8
// and `devpost/spec.md > Queue and Worker (v3)`.
import { ownedProjectStamp } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { projectActivity } from '@/lib/queue/status'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const { id } = await params
  try {
    const userId = await requireUser(req) // the read window is taken here, as for every route
    // The owner comes off the stamp, not off the project: a missing project, a malformed id and someone else's are the same 404.
    const stamp = await ownedProjectStamp(userId, id)
    const { activity } = await projectActivity(id)
    return Response.json({ rev: stamp.updatedAt, activity }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err, 'status', 'The desk couldn’t be checked just now.')
  }
}
