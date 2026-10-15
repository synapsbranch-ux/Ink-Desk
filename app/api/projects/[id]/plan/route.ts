// The Director (slice 11): the story, the locked cast and the style → the
// chapter plan — every page's four lines and the cover brief — in one text
// call, before a single image. Written once; after that the plan is edited
// through the patch route (`plan` edits), or rewritten whole with
// `replace: true` ("Ask the Director again") while no page is written from it.
// See `lib/director.ts` and `devpost/prd.md > The Director — Chapter Plan and Cover`.
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { JSON_LIMIT_BYTES, parseJson } from '@/lib/body'
import { writePlan } from '@/lib/director'
import { errorResponse } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { takeSlot } from '@/lib/inflight'
import { spendText } from '@/lib/limits/text'
import { PlanRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

/** Plans in flight across the process (CR-18): each can hold tens of megabytes while it waits on the model. */
const PLANS_AT_ONCE = 3

const CALM = 'The Director didn’t come back with a plan, the studio is busy. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let release: (() => void) | undefined
  try {
    const userId = await requireUser(req)
    await ownedProject(userId, id) // before the flag, the body or any provider: someone else's project is a 404
    assertGenerationEnabled()
    const { pageCount, replace } = await parseJson(req, PlanRequestSchema, JSON_LIMIT_BYTES, 'A chapter plan has 3 to 6 pages.')
    release = takeSlot('plan', id, PLANS_AT_ONCE, 'The Director is already writing this project’s plan.')
    return Response.json(await spendText(userId, 'plan', (meter) => writePlan(id, pageCount, replace === true, meter)))
  } catch (err) {
    return errorResponse(err, 'plan', CALM)
  } finally {
    release?.()
  }
}
