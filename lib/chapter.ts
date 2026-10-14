// The desk facade (v2). v1's chapter store became `lib/store/`; what this file
// keeps is the shape the page engine, the patch route and the stations work
// on: a `Desk` — the project's story and cast beside ONE page's four panels —
// projected from a project and written back into it, inside the store's
// per-project lock. Nothing here computes a field; it only moves them.
// See `devpost/spec.md > Data Model (v2)` and `> Storage Adapter (v2)`.

// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { Refused } from './errors'
import { coverIsStale, markCoverFailed, pageSummaries } from './plan'
import { markFailed, staleInkingIndices } from './script'
import { singletons } from './singleton'
import { store } from './store'
import type { StylePresetId } from './styles'
import { emptyProject, type Desk, type PageAddress, type PageRef, type Pitch, type Project, type ProjectPage, type ProjectSummary } from './types'

// Re-exported so the checks and `lib/images.ts` keep one import for the data folder.
export { DATA_DIR } from './store/local'

/** The page the project has open. One chapter in this build. */
export function openRef(p: Project): PageRef {
  const chapter = p.chapters[0]
  if (!chapter || chapter.pages.length === 0) throw new Refused('This project has no page.', 404)
  return { chapterId: chapter.id, pageIndex: Math.min(Math.max(0, p.openPage), chapter.pages.length - 1) }
}

/** The desk view of one page. */
export function toDesk(p: Project, ref: PageRef): Desk {
  const chapter = p.chapters.find((c) => c.id === ref.chapterId)
  const page = chapter?.pages[ref.pageIndex]
  if (!chapter || !page) throw new Refused('There is no such page.', 404)
  return {
    version: 2,
    address: { projectId: p.id, chapterId: chapter.id, pageIndex: page.index },
    title: p.title,
    stylePresetId: p.stylePresetId,
    pageCount: chapter.pages.length,
    station: p.station,
    pitch: p.story.pitch,
    synopsis: p.story.synopsis,
    cast: p.library.characters,
    assets: p.library.assets,
    script: page.panels.length > 0 ? page.panels : null,
    imageCount: p.usage.images,
    costUsd: p.usage.costUsd,
    updatedAt: p.updatedAt,
    storyMode: p.story.mode,
    scenario: p.story.scenario,
    plan: chapter.plan,
    cover: chapter.cover,
    openPage: p.openPage,
    pages: pageSummaries(chapter.pages),
    panelQuality: process.env.IMAGE_PANEL_QUALITY ?? 'low',
    chapterPanels: chapter.pages.map((pg) => pg.panels),
  }
}

/** The desk written back: the story, the cast, this page's panels, the
 *  chapter's plan and cover, the open page, the usage. Every other page, the
 *  title and the style are untouched; `pages` and `chapterPanels` are derived
 *  and never read back.
 *  With a plan, the chapter's pages follow its length — a page the stepper
 *  added is appended blank, a page it dropped must not have been written
 *  (`assertPlanEdit` refuses that before it gets here). */
export function applyDesk(p: Project, ref: PageRef, desk: Desk): Project {
  const pageCount = desk.plan ? desk.plan.pages.length : (p.chapters.find((c) => c.id === ref.chapterId)?.pages.length ?? 1)
  return {
    ...p,
    station: desk.station,
    story: { ...p.story, mode: desk.storyMode, pitch: desk.pitch, synopsis: desk.synopsis, scenario: desk.scenario },
    library: { ...p.library, characters: desk.cast, assets: desk.assets },
    chapters: p.chapters.map((c) => {
      if (c.id !== ref.chapterId) return c
      const pages = c.pages.map((pg) => (pg.index !== ref.pageIndex ? pg : { ...pg, panels: desk.script ?? [] }))
      return { ...c, plan: desk.plan, cover: desk.cover, pages: desk.plan ? fitPages(pages, desk.plan.pages.length) : pages }
    }),
    openPage: Math.min(Math.max(0, desk.openPage), Math.max(0, pageCount - 1)),
    usage: { images: desk.imageCount, costUsd: desk.costUsd },
  }
}

function fitPages(pages: ProjectPage[], count: number): ProjectPage[] {
  for (const pg of pages) {
    if (pg.index >= count && pg.panels.length > 0) throw new Error(`the plan dropped page ${pg.index + 1}, which is written`)
  }
  return Array.from({ length: count }, (_, i) => pages.find((pg) => pg.index === i) ?? { index: i, layoutId: 'four-shot', panels: [] })
}

/** Read one project's desk: the open page, or the page `at`. */
export async function read(projectId: string, at?: PageRef): Promise<Desk> {
  const p = await store.readProject(projectId)
  return toDesk(p, at ?? openRef(p))
}

/**
 * Apply one change to a project's desk and persist it, serialized per
 * project. `fn` receives the freshest desk and returns the next one; callers
 * must not close over a desk they read earlier. Throwing inside `fn` rejects
 * this call and leaves the file untouched. A page job passes `at` explicitly
 * so it can never write to a page other than the one it claimed.
 */
export function update(projectId: string, fn: (desk: Desk) => Desk, at?: PageRef): Promise<Desk> {
  return store
    .updateProject(projectId, (p) => {
      const ref = at ?? openRef(p)
      return applyDesk(p, ref, fn(toDesk(p, ref)))
    })
    // A page job reads back the page it wrote; anyone else reads the open
    // page as it is *after* the change — so the page switcher's reply is
    // already the page it switched to.
    .then((p) => toDesk(p, at ?? openRef(p)))
}

/**
 * One change across several pages of the chapter, in one write — Generate
 * all writes every page's panels from the plan together. `fn` runs once per
 * page, in order, each time on the project as the previous page left it.
 */
export function updatePages(projectId: string, pageIndices: number[], fn: (desk: Desk) => Desk): Promise<Project> {
  return store.updateProject(projectId, (p) => {
    let next = p
    for (const n of pageIndices) {
      const ref: PageRef = { chapterId: openRef(next).chapterId, pageIndex: n }
      next = applyDesk(next, ref, fn(toDesk(next, ref)))
    }
    return next
  })
}

/**
 * The floor under "generation survives a reload", for the whole chapter: a
 * panel on any page — or the cover — still `inking` that cannot be in flight
 * in this process is demoted to `failed` with Try again. Pure; the GET route
 * runs it cheaply, then inside the lock against a fresh copy.
 */
export function demoteStale(p: Project, runId: string, timeoutMs: number, now = new Date()): { project: Project; demoted: string[] } {
  const demoted: string[] = []
  let next = p
  const chapter = p.chapters[0]
  if (!chapter) return { project: p, demoted }
  for (const pg of chapter.pages) {
    const ref: PageRef = { chapterId: chapter.id, pageIndex: pg.index }
    const desk = toDesk(next, ref)
    const stale = staleInkingIndices(desk, runId, timeoutMs, now)
    if (stale.length === 0) continue
    let d = desk
    for (const index of stale) {
      demoted.push(`p${pg.index + 1} panel ${index + 1}`)
      d = markFailed(d, index, 'failed')
    }
    next = applyDesk(next, ref, d)
  }
  if (coverIsStale(chapter.cover, runId, timeoutMs, now)) {
    demoted.push('cover')
    const ref = openRef(next)
    next = applyDesk(next, ref, markCoverFailed(toDesk(next, ref), 'failed'))
  }
  return { project: next, demoted }
}

/** The address of page `n` of a project's chapter, or a 404. */
export async function pageAt(projectId: string, n: number): Promise<PageAddress> {
  const p = await store.readProject(projectId)
  const chapter = p.chapters[0]
  if (!chapter || !Number.isInteger(n) || n < 0 || n >= chapter.pages.length) {
    throw new Refused('There is no such page.', 404)
  }
  return { projectId, chapterId: chapter.id, pageIndex: n }
}

/**
 * A new project on the desk, with its locked style. With a story it wakes
 * with that synopsis already accepted — the v2 form of v1's "accepting a new
 * synopsis starts a new chapter": the old project stays exactly as it is.
 */
export async function createProject(input: {
  title: string
  stylePresetId: StylePresetId
  story?: { pitch: Pitch; synopsis: { title: string; body: string } }
}): Promise<Desk> {
  const project = emptyProject({
    id: crypto.randomUUID(),
    chapterId: crypto.randomUUID(),
    title: input.title.trim(),
    stylePresetId: input.stylePresetId,
    serverRunId: singletons.serverRunId,
  })
  const withStory: Project = input.story
    ? {
        ...project,
        story: {
          ...project.story,
          pitch: input.story.pitch,
          synopsis: { title: input.story.synopsis.title, body: input.story.synopsis.body, accepted: true },
        },
      }
    : project
  await store.createProject(withStory)
  return toDesk(withStory, openRef(withStory))
}

export function listProjects(): Promise<ProjectSummary[]> {
  return store.listProjects()
}

/** The v1 migration's outcome, for the dashboard's one sentence when the v1 file can't be read. */
export function migrateLegacy(): Promise<{ projectId: string | null; problem: string | null }> {
  return store.migrateLegacy()
}
