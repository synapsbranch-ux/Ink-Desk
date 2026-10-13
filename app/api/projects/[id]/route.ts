// GET a project's desk · POST an edit (typing, chips, accept, navigation,
// card text, Lock). The only writer besides the generation routes. The desk is
// the open page of the project — see `lib/chapter.ts`.
import { assertEditAllowed } from '@/lib/cast'
import { read, update } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { gates } from '@/lib/gates'
import { imageConfig } from '@/lib/image-provider'
import { applyPatch, assertStoryEditable, type ChapterPatch } from '@/lib/patch'
import { ChapterPatchSchema } from '@/lib/schemas'
import { findPanel, markFailed, staleInkingIndices } from '@/lib/script'
import { singletons } from '@/lib/singleton'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  try {
    // The reader of the desk enforces the floor: a panel still `inking` past
    // the generation timeout, or orphaned by a server restart, comes back as
    // `failed` with Try again — nothing spins forever. Checked cheaply on the
    // plain read; demoted inside the lock against a fresh copy.
    let desk = await read(id)
    const timeoutMs = imageConfig().timeoutMs
    if (staleInkingIndices(desk, singletons.serverRunId, timeoutMs).length > 0) {
      desk = await update(id, (d) => {
        let next = d
        for (const index of staleInkingIndices(d, singletons.serverRunId, timeoutMs)) {
          console.warn(`[p${d.address.pageIndex + 1} panel ${index + 1}] demoted to failed — stale inking (timeout or server restart)`)
          next = markFailed(next, index, 'failed')
        }
        return next
      })
    }
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'project', 'The desk couldn’t be opened.')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const parsed = ChapterPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'That edit couldn’t be read.' }, { status: 400 })
  }
  const patch: ChapterPatch = parsed.data

  try {
    const desk = await update(id, (c) => {
      // Once the cast exists, the story is frozen on this path too — a stale
      // tab's pitch edit orphaned the desk at the slice 6 checkpoint.
      assertStoryEditable(c, patch)
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
        for (const [cid, edit] of Object.entries(patch.cast)) {
          const character = c.cast.find((x) => x.id === cid)
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
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'project', 'The desk couldn’t save that.')
  }
}
