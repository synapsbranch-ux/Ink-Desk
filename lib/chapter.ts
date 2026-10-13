// The desk facade (v2). v1's chapter store became `lib/store/`; what this file
// keeps is the shape the page engine, the patch route and the stations work
// on: a `Desk` — the project's story and cast beside ONE page's four panels —
// projected from a project and written back into it, inside the store's
// per-project lock. Nothing here computes a field; it only moves them.
// See `devpost/spec.md > Data Model (v2)` and `> Storage Adapter (v2)`.
import { Refused } from './errors'
import { singletons } from './singleton'
import { store } from './store'
import type { StylePresetId } from './styles'
import { emptyProject, type Desk, type PageAddress, type PageRef, type Pitch, type Project, type ProjectSummary } from './types'

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
    serverRunId: p.serverRunId,
    station: p.station,
    pitch: p.story.pitch,
    synopsis: p.story.synopsis,
    cast: p.library.characters,
    script: page.panels.length > 0 ? page.panels : null,
    imageCount: p.usage.images,
    costUsd: p.usage.costUsd,
    updatedAt: p.updatedAt,
  }
}

/** The desk written back: the story, the cast, this page's panels, the usage.
 *  Everything else on the project — assets, other pages, the title, the
 *  style — is untouched. */
export function applyDesk(p: Project, ref: PageRef, desk: Desk): Project {
  return {
    ...p,
    station: desk.station,
    story: { ...p.story, pitch: desk.pitch, synopsis: desk.synopsis },
    library: { ...p.library, characters: desk.cast },
    chapters: p.chapters.map((c) =>
      c.id !== ref.chapterId
        ? c
        : { ...c, pages: c.pages.map((pg) => (pg.index !== ref.pageIndex ? pg : { ...pg, panels: desk.script ?? [] })) }
    ),
    usage: { images: desk.imageCount, costUsd: desk.costUsd },
  }
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
  let ref: PageRef | undefined
  return store
    .updateProject(projectId, (p) => {
      ref = at ?? openRef(p)
      return applyDesk(p, ref, fn(toDesk(p, ref)))
    })
    .then((p) => toDesk(p, ref ?? openRef(p)))
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
