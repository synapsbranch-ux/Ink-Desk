// Draw sheet. Since slice 18 the route answers at once: the sheet is a job
// (`lib/sheet.ts`) that a worker runs in two steps — Claude writes the DNA from
// the card's description and it is saved before the picture is attempted, then
// the sheet is drawn from exactly that DNA and the pair lands on the card
// together. The card's "drawing" state is the job; the studio's poll watches
// it. `reuseDna: true` is Redraw sheet: same words, new picture.
// See `devpost/prd.md > Cast — Model Sheets` for why DNA-first is load-bearing.
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { JSON_LIMIT_BYTES, parseJson } from '@/lib/body'
import { errorResponse } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { readWithActivity } from '@/lib/queue/status'
import { SheetRequestSchema } from '@/lib/schemas'
import { queueSheet } from '@/lib/sheet'

export const runtime = 'nodejs'

const CALM = 'The sheet couldn’t start drawing just now. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  try {
    const userId = await requireUser(req)
    await ownedProject(userId, projectId) // before the flag, the body or any provider: someone else's project is a 404
    assertGenerationEnabled()
    const { id, reuseDna = false } = await parseJson(req, SheetRequestSchema, JSON_LIMIT_BYTES, 'That request couldn’t be read.')
    await queueSheet(projectId, id, reuseDna)
    return Response.json(await readWithActivity(projectId))
  } catch (err) {
    return errorResponse(err, 'sheet', CALM)
  }
}
