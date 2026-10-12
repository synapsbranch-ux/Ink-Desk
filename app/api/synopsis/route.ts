// Pitch + genre + tone → Claude → a synopsis, written to the desk unaccepted.
// Calling it again is "Rewrite": the new draft replaces the old one.
import { update } from '@/lib/chapter'
import { ProviderError, writeSynopsis } from '@/lib/claude'
import { SynopsisRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t write a synopsis just now. Try again in a moment.'

export async function POST(req: Request) {
  const parsed = SynopsisRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Write a pitch and pick a genre and a tone first.' }, { status: 400 })
  }
  const { pitch, genre, tone } = parsed.data

  let synopsis
  try {
    synopsis = await writeSynopsis({ pitch, genre, tone })
  } catch (err) {
    // The terminal gets the real cause; the browser gets a sentence.
    if (err instanceof ProviderError) {
      console.error(`[synopsis] ${err.message}`, err.cause ?? '')
      return Response.json({ error: err.kind === 'config' ? err.message : CALM }, { status: 502 })
    }
    console.error('[synopsis] unexpected failure:', err)
    return Response.json({ error: CALM }, { status: 502 })
  }

  const chapter = await update((c) => ({
    ...c,
    pitch: { text: pitch, genre, tone },
    synopsis: { title: synopsis.title, body: synopsis.body, accepted: false },
  }))
  return Response.json(chapter)
}
