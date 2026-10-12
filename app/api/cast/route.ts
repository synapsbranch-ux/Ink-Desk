// Accepted synopsis → Claude → exactly two characters, written to the desk
// unlocked and with no sheet yet.
// Implements `devpost/prd.md > Cast — Model Sheets` step 1.
import { read, update } from '@/lib/chapter'
import { newCharacter, ProviderError, proposeCast } from '@/lib/claude'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t cast this chapter just now. Try again in a moment.'

export async function POST() {
  const chapter = await read()
  if (chapter.synopsis?.accepted !== true) {
    return Response.json({ error: 'Accept a synopsis first.' }, { status: 409 })
  }
  // Re-casting would silently discard locked sheets and the DNA they froze.
  if (chapter.cast.some((c) => c.locked)) {
    return Response.json({ error: 'This chapter already has a locked character.' }, { status: 409 })
  }

  let proposed
  try {
    proposed = await proposeCast(chapter.synopsis)
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error(`[cast] ${err.message}`, err.cause ?? '')
      return Response.json({ error: err.kind === 'config' ? err.message : CALM }, { status: 502 })
    }
    console.error('[cast] unexpected failure:', err)
    return Response.json({ error: CALM }, { status: 502 })
  }

  const cast = proposed.map(newCharacter)
  return Response.json(await update((c) => ({ ...c, cast })))
}
