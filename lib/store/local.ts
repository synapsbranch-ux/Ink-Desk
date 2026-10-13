// The local store: files under `data/`, exactly the guarantees v1's chapter
// store had, per project.
//
//   data/projects/<id>/project.json      one project, written whole
//   data/projects/v1-migrated.json       the marker: the v1 desk was migrated once
//   data/images/<kind>-<uuid>.<ext>      every image, sheets and panels alike
//   data/chapter.json                    the v1 desk, read once, never modified
//
// Two guarantees, for two different problems (see `devpost/spec.md >
// Components > Chapter Store`):
//   1. No torn files   — write to a temp file, then rename() over the real one.
//   2. No lost updates — every mutation of a project goes through
//      `updateProject()`, serialized on that project's own promise chain, so
//      read-modify-write never interleaves. Two projects never wait on each
//      other; two panels of one page finishing together never erase each
//      other.
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProviderError, Refused } from '../errors'
import { isChapterV1, migrateV1 } from '../migrate'
import { singletons } from '../singleton'
import type { Project, ProjectSummary } from '../types'
import type { BlobKind, Store } from './index'

// Overridable so the acceptance checks can run against a scratch folder.
// Read at module load, like v1: set the env before the first import.
export const DATA_DIR = process.env.INKDESK_DATA_DIR ?? 'data'
export const PROJECTS_DIR = join(DATA_DIR, 'projects')
export const IMAGES_DIR = join(DATA_DIR, 'images')
const V1_FILE = join(DATA_DIR, 'chapter.json')
const V1_MARKER = join(PROJECTS_DIR, 'v1-migrated.json')

// --- Ids ---------------------------------------------------------------------

/** A project id is used as a folder name: strict on purpose. */
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isProjectId(id: string): boolean {
  return PROJECT_ID.test(id)
}

function projectDir(id: string): string {
  if (!isProjectId(id)) throw new Refused('There is no such project.', 404)
  return join(PROJECTS_DIR, id)
}

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}
const MEDIA_TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MEDIA_TYPE).map(([type, ext]) => [ext, type])
)

/** `<kind>-<uuid>.<ext>`. Strict on purpose: the id is used as a filename. */
const IMAGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpg|webp)$/

export function isImageId(id: string): boolean {
  return IMAGE_ID.test(id)
}

export function mediaTypeOf(id: string): string {
  return MEDIA_TYPE_BY_EXT[id.slice(id.lastIndexOf('.') + 1)] ?? 'application/octet-stream'
}

function imagePath(id: string): string {
  if (!isImageId(id)) throw new Error(`Not an image id: ${id}`)
  return join(IMAGES_DIR, id)
}

// --- Files --------------------------------------------------------------------

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function writeAtomic(dir: string, file: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true })
  const real = join(dir, file)
  const tmp = join(dir, `${file}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, real)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

// --- Projects -----------------------------------------------------------------

async function readProject(id: string): Promise<Project> {
  const raw = await readJson(join(projectDir(id), 'project.json'))
  if (raw === null) throw new Refused('There is no such project.', 404)
  const project = raw as Project
  if (project.version !== 2) {
    throw new Error(`${join(projectDir(id), 'project.json')} is version ${String(project.version)}; this build reads version 2.`)
  }
  return project
}

async function writeProject(project: Project): Promise<void> {
  await writeAtomic(projectDir(project.id), 'project.json', project)
}

async function createProject(project: Project): Promise<void> {
  const dir = projectDir(project.id)
  if (await exists(join(dir, 'project.json'))) throw new Refused('That project already exists.')
  await writeProject({ ...project, serverRunId: singletons.serverRunId })
}

/**
 * Apply one change to a project and persist it. `fn` receives the freshest
 * project and returns the next one; callers must not close over a project
 * they read earlier. Throwing inside `fn` rejects this call and leaves the
 * file untouched; the chain itself never wedges.
 */
function updateProject(id: string, fn: (project: Project) => Project): Promise<Project> {
  // Validated before the lock map is touched, so a garbage id is a 404 and
  // never a lock entry.
  if (!isProjectId(id)) return Promise.reject(new Refused('There is no such project.', 404))
  const run = async (): Promise<Project> => {
    const current = await readProject(id) // fresh read, inside the lock
    const next: Project = {
      ...fn(current),
      id, // the id is the folder; a change here would be a different project
      serverRunId: singletons.serverRunId,
      updatedAt: new Date().toISOString(),
    }
    await writeProject(next) // tmp + rename
    return next
  }
  const previous = singletons.locks.get(id) ?? Promise.resolve()
  // `.then(run, run)` so one failed update doesn't block the next.
  const result = previous.then(run, run)
  singletons.locks.set(id, result.catch(() => {}))
  return result
}

/** The dashboard's view of a project — derived, never stored. */
export function summarize(p: Project): ProjectSummary {
  const chapter = p.chapters[0]
  const pages = chapter?.pages ?? []
  const firstInked = pages.flatMap((pg) => pg.panels).find((panel) => panel.versions.length > 0)
  const cover = chapter?.cover?.versions[chapter.cover.currentVersion]?.imageId ?? null
  return {
    id: p.id,
    title: p.title,
    stylePresetId: p.stylePresetId,
    station: p.station,
    images: p.usage.images,
    costUsd: p.usage.costUsd,
    pageCount: pages.length,
    pagesInked: pages.filter((pg) => pg.panels.length === 4 && pg.panels.every((panel) => panel.versions.length > 0)).length,
    thumbnailImageId: cover ?? firstInked?.versions[firstInked.currentVersion]?.imageId ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

/**
 * The one-time migration of the v1 desk (`data/chapter.json`) into a project.
 * Runs on the first listing; the marker makes it run exactly once, so a
 * migrated project that is later deleted does not come back from the v1 file.
 * The v1 file is read and never written. A file that cannot be read as a v1
 * desk is left exactly as it is and named in `problem` — the dashboard opens
 * empty with that sentence rather than failing (`spec.md > Important Failure
 * Modes (v2)`).
 */
export async function migrateLegacy(): Promise<{ projectId: string | null; problem: string | null }> {
  if (await exists(V1_MARKER)) return { projectId: null, problem: null }
  let raw: unknown
  try {
    raw = await readJson(V1_FILE)
  } catch (err) {
    const problem = `${V1_FILE} couldn’t be read as a desk (${err instanceof Error ? err.message : String(err)}). It was left as it is; fix or move it to migrate it.`
    console.warn(`[store] ${problem}`)
    return { projectId: null, problem }
  }
  if (raw === null) return { projectId: null, problem: null }
  if (!isChapterV1(raw)) {
    const problem = `${V1_FILE} is not a version-1 desk. It was left as it is, nothing migrated.`
    console.warn(`[store] ${problem}`)
    return { projectId: null, problem }
  }
  const ids = { projectId: `v1-${crypto.randomUUID().slice(0, 8)}`, chapterId: crypto.randomUUID() }
  const project = migrateV1(raw, ids, singletons.serverRunId, new Date().toISOString(), 'chapter.json')
  await createProject(project)
  await writeAtomic(PROJECTS_DIR, 'v1-migrated.json', { projectId: ids.projectId, at: project.updatedAt })
  console.log(`[store] migrated the v1 desk into project ${ids.projectId} (“${project.title}”); ${V1_FILE} untouched`)
  return { projectId: ids.projectId, problem: null }
}

async function listProjects(): Promise<ProjectSummary[]> {
  await migrateLegacy()
  let entries: string[]
  try {
    entries = await readdir(PROJECTS_DIR)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const summaries: ProjectSummary[] = []
  for (const id of entries) {
    if (!isProjectId(id)) continue // the marker file, a stray .tmp, anything else
    let raw: unknown
    try {
      raw = await readJson(join(PROJECTS_DIR, id, 'project.json'))
    } catch (err) {
      // One unreadable project never takes the desk down with it.
      console.warn(`[store] projects/${id}/project.json couldn’t be read; skipped:`, err instanceof Error ? err.message : err)
      continue
    }
    if (raw === null || (raw as Project).version !== 2) continue
    summaries.push(summarize(raw as Project))
  }
  return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

// --- Blobs ----------------------------------------------------------------------

async function putBlob(bytes: Buffer, mediaType: string, kind: BlobKind): Promise<string> {
  const ext = EXT_BY_MEDIA_TYPE[mediaType]
  if (!ext) {
    throw new ProviderError(
      'The image came back in a format the studio doesn’t keep.',
      'provider',
      `unrecognised media_type "${mediaType}" — add it to EXT_BY_MEDIA_TYPE rather than guessing`
    )
  }
  const id = `${kind}-${crypto.randomUUID()}.${ext}`
  await mkdir(IMAGES_DIR, { recursive: true })
  await writeFile(imagePath(id), bytes)
  return id
}

async function getBlob(id: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
  if (!isImageId(id)) return null
  try {
    return { bytes: await readFile(imagePath(id)), mediaType: mediaTypeOf(id) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export const localStore: Store = { listProjects, migrateLegacy, readProject, createProject, updateProject, putBlob, getBlob }
