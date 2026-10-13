// GET the chapter · POST an edit (typing, chips, accept, navigation, card
// text, Lock) · DELETE = new chapter. The only writer besides the generation
// routes.
import { assertEditAllowed } from '@/lib/cast'
import { read, reset, update } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { gates } from '@/lib/gates'
import { applyPatch, type ChapterPatch } from '@/lib/patch'
import { ChapterPatchSchema } from '@/lib/schemas'
import { findPanel } from '@/lib/script'

export const runtime = 'nodejs'

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
        if (!gate.open) throw new Refused(gate.hint ?? 'That station isn’t open yet.')
      }
      // Accepting needs a synopsis to accept.
      if (patch.synopsis?.accepted === true) {
        const hasOne = c.synopsis !== null || (patch.synopsis.title !== undefined && patch.synopsis.body !== undefined)
        if (!hasOne) throw new Refused('Pitch a story before accepting a synopsis.')
      }
      // A locked card is read-only here, not only in the UI; Lock needs a sheet.
      if (patch.cast) {
        for (const [id, edit] of Object.entries(patch.cast)) {
          const character = c.cast.find((x) => x.id === id)
          if (character) assertEditAllowed(character, edit)
        }
      }
      // A bubble or dialogue edit needs its panel to exist — refused before
      // the script is written, never silently dropped.
      if (patch.panels) {
        for (const index of Object.keys(patch.panels)) findPanel(c, Number(index))
      }
      return applyPatch(c, patch)
    })
    return Response.json(chapter)
  } catch (err) {
    return errorResponse(err, 'chapter', 'The desk couldn’t save that.')
  }
}

export async function DELETE() {
  return Response.json(await reset())
}
