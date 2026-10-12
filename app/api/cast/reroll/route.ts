// Replace exactly one character with a fresh proposal. Text only, so
// iteration is cheap — `devpost/prd.md > Cast — Model Sheets` step 2.
//
// The one the user is keeping goes into the prompt, so the replacement
// contrasts with it rather than echoing it.
import { read, update } from '@/lib/chapter'
import { newCharacter, ProviderError, rerollCharacter } from '@/lib/claude'
import { RerollRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t reroll that character just now. Try again in a moment.'

export async function POST(req: Request) {
  const parsed = RerollRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'That character couldn’t be read.' }, { status: 400 })

  const chapter = await read()
  if (chapter.synopsis?.accepted !== true) {
    return Response.json({ error: 'Accept a synopsis first.' }, { status: 409 })
  }

  const replacing = chapter.cast.find((c) => c.id === parsed.data.characterId)
  const keeping = chapter.cast.find((c) => c.id !== parsed.data.characterId)
  if (!replacing || !keeping) return Response.json({ error: 'That character isn’t on the desk.' }, { status: 404 })
  if (replacing.locked) {
    return Response.json({ error: 'That sheet is locked. Locking is final in this version.' }, { status: 409 })
  }

  let proposal
  try {
    proposal = await rerollCharacter({ synopsis: chapter.synopsis, replacing, keeping })
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error(`[reroll] ${err.message}`, err.cause ?? '')
      return Response.json({ error: err.kind === 'config' ? err.message : CALM }, { status: 502 })
    }
    console.error('[reroll] unexpected failure:', err)
    return Response.json({ error: CALM }, { status: 502 })
  }

  // A new id, because this is a different character and nothing about the old
  // one should follow it — including any sheet it had drawn.
  const replacement = newCharacter(proposal)
  return Response.json(
    await update((c) => ({
      ...c,
      // Re-read inside the lock: the other card may have changed meanwhile.
      cast: c.cast.map((x) => (x.id === replacing.id ? replacement : x)),
    }))
  )
}
