// The Director (slice 11): the story, the locked cast and the style → the
// chapter plan — every page's four lines and the cover brief — in one text
// call, before a single image. Written once; after that the plan is edited
// through the patch route (`plan` edits), or rewritten whole with
// `replace: true` ("Ask the Director again") while no page is written from it.
// See `lib/director.ts` and `devpost/prd.md > The Director — Chapter Plan and Cover`.
import { JSON_LIMIT_BYTES, parseJson } from '@/lib/body'
import { writePlan } from '@/lib/director'
import { errorResponse } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { PlanRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The Director didn’t come back with a plan, the studio is busy. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    assertGenerationEnabled()
    const { pageCount, replace } = await parseJson(req, PlanRequestSchema, JSON_LIMIT_BYTES, 'A chapter plan has 3 to 6 pages.')
    return Response.json(await writePlan(id, pageCount, replace === true))
  } catch (err) {
    return errorResponse(err, 'plan', CALM)
  }
}
