// Reroll one character: a fresh proposal from Claude replaces exactly that
// card, with the other character held fixed in the prompt and untouched on
// the desk. Text only — the sheet and DNA start over.
import { assertUnlocked, findCharacter, replaceCharacter } from '@/lib/cast'
import { read, update } from '@/lib/chapter'
import { rewriteCharacter } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { RerollRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t reroll that character just now. Try again in a moment.'

export async function POST(req: Request) {
  const parsed = RerollRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'That request couldn’t be read.' }, { status: 400 })
  const { id } = parsed.data

  try {
    const current = await read()
    const synopsis = current.synopsis
    if (synopsis?.accepted !== true) throw new Refused('Accept a synopsis first.')
    const target = assertUnlocked(findCharacter(current, id))
    const keep = current.cast.find((c) => c.id !== id)
    if (!keep) throw new Refused('The cast isn’t complete yet.')

    const proposal = await rewriteCharacter(synopsis, keep, target)
    const chapter = await update((c) => replaceCharacter(c, id, proposal))
    return Response.json(chapter)
  } catch (err) {
    return errorResponse(err, 'cast/reroll', CALM)
  }
}
