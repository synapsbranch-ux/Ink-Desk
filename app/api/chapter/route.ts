// GET the chapter · POST an edit (typing, chips, accept, navigation) ·
// DELETE = new chapter. The only writer besides the generation routes.
import { read, reset, update } from '@/lib/chapter'
import { gates } from '@/lib/gates'
import { applyPatch, type ChapterPatch } from '@/lib/patch'
import { ChapterPatchSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

class Refused extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function GET() {
  return Response.json(await read())
}

export async function POST(req: Request) {
  const parsed = ChapterPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'That edit couldn’t be read.' }, { status: 400 })
  }
  const patch: ChapterPatch = parsed.data

  try {
    const chapter = await update((c) => {
      // Gating is enforced here, not only in the rail.
      if (patch.station) {
        const gate = gates(c)[patch.station]
        if (!gate.open) throw new Refused(gate.hint ?? 'That station isn’t open yet.', 409)
      }
      // Accepting needs a synopsis to accept.
      if (patch.synopsis?.accepted === true) {
        const hasOne = c.synopsis !== null || (patch.synopsis.title !== undefined && patch.synopsis.body !== undefined)
        if (!hasOne) throw new Refused('Pitch a story before accepting a synopsis.', 409)
      }
      if (patch.character) {
        const target = c.cast.find((x) => x.id === patch.character?.id)
        if (!target) throw new Refused('That character isn’t on the desk.', 404)
        // Locking is final, and read-only means read-only on the server too —
        // not just hidden in the UI.
        if (target.locked) throw new Refused('That sheet is locked. Locking is final in this version.', 409)
        // Nothing is final until both the words and the picture are approved.
        if (patch.character.locked === true && (target.dna === null || target.sheetImageId === null)) {
          throw new Refused('Draw the sheet before locking it.', 409)
        }
      }
      return applyPatch(c, patch)
    })
    return Response.json(chapter)
  } catch (err) {
    if (err instanceof Refused) return Response.json({ error: err.message }, { status: err.status })
    console.error('[chapter] save failed:', err)
    return Response.json({ error: 'The desk couldn’t save that.' }, { status: 500 })
  }
}

export async function DELETE() {
  return Response.json(await reset())
}
