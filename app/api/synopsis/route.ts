// Pitch + genre + tone → Claude → a synopsis, written to the desk unaccepted.
// Calling it again is "Rewrite": the new draft replaces the old one.
import { update } from '@/lib/chapter'
import { writeSynopsis } from '@/lib/claude'
import { errorResponse } from '@/lib/errors'
import { SynopsisRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t write a synopsis just now. Try again in a moment.'

export async function POST(req: Request) {
  const parsed = SynopsisRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Write a pitch and pick a genre and a tone first.' }, { status: 400 })
  }
  const { pitch, genre, tone } = parsed.data

  try {
    const synopsis = await writeSynopsis({ pitch, genre, tone })
    const chapter = await update((c) => ({
      ...c,
      pitch: { text: pitch, genre, tone },
      synopsis: { title: synopsis.title, body: synopsis.body, accepted: false },
    }))
    return Response.json(chapter)
  } catch (err) {
    return errorResponse(err, 'synopsis', CALM)
  }
}
