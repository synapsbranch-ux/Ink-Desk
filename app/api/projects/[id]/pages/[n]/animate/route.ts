// Animate a finished page into a one-page trailer (v3, slice 22):
//   GET  → { estimate: AnimateEstimate, video: VideoView | null }   what Animate would take, and the page's newest trailer
//   POST → 202 { video: VideoView }                                 Confirm: the trailer is queued
// The caller must own the project (someone else's is the missing project's 404, before
// the flag, the body or any provider). The GET never spends and never writes; a page that
// is not complete answers `{ ok: false, reason }` in its estimate, not an error. The POST
// takes no input — the page in the address is all there is — and re-plans from the project
// now: the estimate the person saw is advisory, the server's plan is the one that is held,
// paid for and animated. It leaves no record behind on any refusal (the studio is closed,
// the page is not whole, a trailer is already in the works, a quota or cap says no).
// Both are the `read` and the `image` request windows (`lib/limits/requests.ts`). Never cached.
// See `lib/video/animate.ts` and `devpost/spec.md > Animate a Page (v3)`.
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { assertNoInput } from '@/lib/share/service'
import { assertVideoOpen, estimateFor, startTrailer } from '@/lib/video/animate'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; n: string }> }

const NO_STORE = { 'Cache-Control': 'no-store' }
/** A page number as the address spells it: digits only; anything else is no page at all. */
const pageNumber = (n: string): number => (/^\d{1,6}$/.test(n) ? Number(n) : -1)

export async function GET(req: Request, { params }: Params) {
  const { id, n } = await params
  try {
    const userId = await requireUser(req)
    const project = await ownedProject(userId, id)
    return Response.json(await estimateFor(userId, project, pageNumber(n)), { headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'animate', 'The estimate couldn’t be worked out just now. Try again in a moment.')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id, n } = await params
  try {
    const userId = await requireUser(req)
    const project = await ownedProject(userId, id) // before the flags, the body or any provider
    assertVideoOpen() // a closed studio costs nothing and says so before it reads a byte of the body
    await assertNoInput(req)
    return Response.json({ video: await startTrailer(userId, project, pageNumber(n)) }, { status: 202, headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'animate', 'The trailer couldn’t be started just now. Try again in a moment.')
  }
}
