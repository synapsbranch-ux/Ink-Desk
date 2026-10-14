// GET a project's desk · POST an edit (typing, chips, accept, navigation,
// card text, Lock). The only writer besides the generation routes. The desk is
// the open page of the project — see `lib/chapter.ts`.
import { parseJson } from '@/lib/body'
import { assertEditAllowed } from '@/lib/cast'
import { demoteStale, openRef, read, toDesk, update } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { gates } from '@/lib/gates'
import { maxRunMs, projectActivity } from '@/lib/queue/status'
import { applyPatch, assertPageExists, assertStoryEditable, type ChapterPatch } from '@/lib/patch'
import { assertPlanEdit } from '@/lib/plan'
import { ChapterPatchSchema, PATCH_LIMIT_BYTES } from '@/lib/schemas'
import { findPanel } from '@/lib/script'
import { store } from '@/lib/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // The reader of the desk enforces the floor: a panel on any page — or the
    // cover — still `inking` that no live job holds (its job ended, was let go
    // as dead, or never existed) comes back as `failed` with Try again; nothing
    // spins forever, on the open page or off it, and nothing alive is demoted
    // because a different web instance answered the poll (CR-1, CR-13).
    const project = await store.readProject(id)
    const { activity, live } = await projectActivity(id)
    const maxAge = maxRunMs()
    const first = demoteStale(project, live, maxAge)
    if (first.demoted.length === 0) return Response.json({ ...toDesk(project, openRef(project)), activity })
    try {
      // Demoted against a fresh copy: a job that finished meanwhile is not undone.
      const next = await store.updateProject(id, (p) => {
        const { project: demotedProject, demoted } = demoteStale(p, live, maxAge)
        for (const what of demoted) console.warn(`[${what}] demoted to failed — no live job holds it`)
        return demotedProject
      })
      return Response.json({ ...toDesk(next, openRef(next)), activity })
    } catch (err) {
      // CR-7: being able to read a project must not depend on being able to
      // write it. A full disk or a refused write still shows the desk as it
      // would read once the write lands.
      console.error(`[project] could not record the demoted panels (${first.demoted.join(', ')}); showing them anyway:`, err instanceof Error ? err.message : err)
      return Response.json({ ...toDesk(first.project, openRef(first.project)), activity })
    }
  } catch (err) {
    return errorResponse(err, 'project', 'The desk couldn’t be opened.')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  try {
    // Sized for a whole scenario; every other route takes 64 KB.
    const patch: ChapterPatch = await parseJson(req, ChapterPatchSchema, PATCH_LIMIT_BYTES, 'That edit couldn’t be read.')
    // Panel edits are written to the page they were made on (`at`), which
    // may no longer be the open page by the time they land — another tab, or
    // a page switch still in flight. Everything else on the desk is
    // project- or chapter-level and the same from any page's view.
    const at =
      patch.panels && patch.at !== undefined
        ? { chapterId: (await store.readProject(id)).chapters[0]?.id ?? '', pageIndex: patch.at }
        : undefined
    const written = await update(id, (c) => {
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
    }, at)
    // The reply is always the open page, as every route's is.
    return Response.json(at ? await read(id) : written)
  } catch (err) {
    return errorResponse(err, 'project', 'The desk couldn’t save that.')
  }
}
