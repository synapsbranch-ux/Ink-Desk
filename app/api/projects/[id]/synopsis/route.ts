// Pitch + genre + tone → Claude → a synopsis, written to the desk unaccepted.
// Calling it again is "Rewrite": the new draft replaces the old one — but
// only until the cast exists. The cast and page are built FROM the accepted
// synopsis, so replacing the story after that would orphan everything
// downstream. Once a cast is on the desk this route still writes synopses —
// it just stops writing them to the desk: the draft goes back to the browser
// alone, and accepting it starts a new project (`POST /api/projects` with the
// story), the old one untouched. See `devpost/prd.md > States and
// Boundaries` and `> Screens and Layout` (back-navigation rules).
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { JSON_LIMIT_BYTES, parseJson } from '@/lib/body'
import { read, update } from '@/lib/chapter'
import { writeSynopsis } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { chargeText } from '@/lib/images'
import { textMeter } from '@/lib/llm'
import { SynopsisRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t write a synopsis just now. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const userId = await requireUser(req)
    await ownedProject(userId, id) // before the flag, the body or any provider: someone else's project is a 404
    assertGenerationEnabled()
    const { pitch, genre, tone } = await parseJson(
      req,
      SynopsisRequestSchema,
      JSON_LIMIT_BYTES,
      'Write a pitch and pick a genre and a tone first.'
    )
    const existing = await read(id)
    if (existing.storyMode === 'scenario' && existing.cast.length === 0) {
      throw new Refused('This project tells its story as a scenario. Switch to Pitch on the Story station to pitch instead.')
    }
    const meter = textMeter()
    const synopsis = await writeSynopsis({ pitch, genre, tone }, meter)
    if (existing.cast.length > 0) {
      // The desk's story is frozen; the new draft never touches it — but what it cost is still spent.
      await update(id, (c) => chargeText(c, meter))
      return Response.json({ draft: { title: synopsis.title, body: synopsis.body } })
    }
    const desk = await update(id, (c) =>
      chargeText(
        {
          ...c,
          pitch: { text: pitch, genre, tone },
          synopsis: { title: synopsis.title, body: synopsis.body, accepted: false },
        },
        meter
      )
    )
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'synopsis', CALM)
  }
}
