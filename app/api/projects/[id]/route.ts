// GET a project's desk · POST an edit (typing, chips, accept, navigation,
// card text, Lock). The only writer besides the generation routes. The desk is
// the open page of the project — see `lib/chapter.ts`.
import { assertEditAllowed } from '@/lib/cast'
import { demoteStale, openRef, toDesk, update } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { gates } from '@/lib/gates'
import { imageConfig } from '@/lib/image-provider'
import { applyPatch, assertPageExists, assertStoryEditable, type ChapterPatch } from '@/lib/patch'
import { assertPlanEdit } from '@/lib/plan'
import { ChapterPatchSchema } from '@/lib/schemas'
import { findPanel } from '@/lib/script'
import { singletons } from '@/lib/singleton'
import { store } from '@/lib/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // The reader of the desk enforces the floor: a panel on any page — or the
    // cover — still `inking` past the generation timeout, or orphaned by a
    // server restart, comes back as `failed` with Try again; nothing spins
    // forever, on the open page or off it. Checked cheaply on the plain read;
    // demoted inside the lock against a fresh copy.
    const timeoutMs = imageConfig().timeoutMs
    const project = await store.readProject(id)
    if (demoteStale(project, singletons.serverRunId, timeoutMs).demoted.length === 0) {
      return Response.json(toDesk(project, openRef(project)))
    }
    const next = await store.updateProject(id, (p) => {
      const { project: demotedProject, demoted } = demoteStale(p, singletons.serverRunId, timeoutMs)
      for (const what of demoted) console.warn(`[${what}] demoted to failed — stale inking (timeout or server restart)`)
      return demotedProject
    })
    return Response.json(toDesk(next, openRef(next)))
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
      // The plan's own rules (slice 11): it must exist, a written page's lines
      // and a written page itself can't be edited away.
      if (patch.plan) assertPlanEdit(c, patch.plan)
      if (patch.cover && !c.cover) throw new Refused('Write the chapter plan first — the cover comes with it.')
      // The page switcher: a page the chapter has, counted after any page-count change in this same patch.
      if (patch.page !== undefined) {
        const count = patch.plan?.pageCount ?? c.pageCount
        assertPageExists({ ...c, pageCount: count }, patch.page)
      }
      return applyPatch(c, patch)
    })
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'project', 'The desk couldn’t save that.')
  }
}
