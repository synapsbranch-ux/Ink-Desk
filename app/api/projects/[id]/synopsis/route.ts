// Pitch + genre + tone → Claude → a synopsis, written to the desk unaccepted.
// Calling it again is "Rewrite": the new draft replaces the old one — but
// only until the cast exists. The cast and page are built FROM the accepted
// synopsis, so replacing the story after that would orphan everything
// downstream. Once a cast is on the desk this route still writes synopses —
// it just stops writing them to the desk: the draft goes back to the browser
// alone, and accepting it starts a new project (`POST /api/projects` with the
// story), the old one untouched. See `devpost/prd.md > States and
// Boundaries` and `> Screens and Layout` (back-navigation rules).
import { read, update } from '@/lib/chapter'
import { writeSynopsis } from '@/lib/claude'
import { errorResponse } from '@/lib/errors'
import { SynopsisRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t write a synopsis just now. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = SynopsisRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Write a pitch and pick a genre and a tone first.' }, { status: 400 })
  }
  const { pitch, genre, tone } = parsed.data

  try {
    const existing = await read(id)
    const synopsis = await writeSynopsis({ pitch, genre, tone })
    if (existing.cast.length > 0) {
      // The desk's story is frozen; the new draft never touches it.
      return Response.json({ draft: { title: synopsis.title, body: synopsis.body } })
    }
    const desk = await update(id, (c) => ({
      ...c,
      pitch: { text: pitch, genre, tone },
      synopsis: { title: synopsis.title, body: synopsis.body, accepted: false },
    }))
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'synopsis', CALM)
  }
}
