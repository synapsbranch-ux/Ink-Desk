// The local store: files under `data/`, exactly the guarantees v1's chapter
// store had, per project.
//
//   data/projects/<id>/project.json      one project, written whole
//   data/projects/<id>/project.json.bak  the version before the last write
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
//
// A project file that can't be read (CR-14) — a torn write, a crash before the
// disk caught up — opens from its backup, with a warning. With no good backup
// either, the dashboard shows it as a "can't be read" card, and opening it
// answers one calm sentence with a way back — never a crash, never hidden, and
// both files are left exactly as they are.

// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ProviderError, Refused } from '../errors'
import { isChapterV1, migrateV1 } from '../migrate'
import { singletons } from '../singleton'
import { DEFAULT_STYLE_PRESET_ID } from '../styles'
import type { Project, ProjectSummary } from '../types'
import type { BlobKind, BlobStream, Store, StoreHealth } from './index'

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

/** What opening a damaged project says, in both stores: the cause goes to the terminal. */
export const UNREADABLE_PROJECT =
  'This project couldn’t be read, so it can’t open. It has been left exactly as it is — go back to the desk to open another project.'

/** Why a stored value can't be opened as a version-2 project, or null if it can. Shared with the cloud store. */
export function projectProblem(raw: unknown): string | null {
  const project = raw as Partial<Project> | null
  if (typeof project !== 'object' || project === null) return 'not a project object'
  if (project.version !== 2) return `version ${String(project.version)}; this build reads version 2`
  if (!Array.isArray(project.chapters) || !Array.isArray(project.library?.characters)) return 'it is missing its chapters or its library'
  return null
}

/** A project that exists but can't be read: a 500 with the calm sentence, the cause logged by id. */
export function unreadableProject(id: string, cause: string): Refused {
  console.warn(`[store] projects/${id} couldn’t be read: ${cause}`)
  return new Refused(UNREADABLE_PROJECT, 500)
}

/** The dashboard's card for a project that can't be read: its id and when it last changed. Shared with the cloud store. */
export function unreadableSummary(id: string, updatedAt: string): ProjectSummary {
  return {
    id,
    title: id,
    stylePresetId: DEFAULT_STYLE_PRESET_ID,
    station: 'story',
    images: 0,
    costUsd: 0,
    pageCount: 0,
    pagesInked: 0,
    thumbnailImageId: null,
    characters: [],
    createdAt: updatedAt,
    updatedAt,
    unreadable: true,
  }
}

const PROJECT_FILE = 'project.json'
const BACKUP_FILE = 'project.json.bak'

type Loaded = { project: Project } | { problem: string } | null

/** One stored copy: the project, why it can't be opened, or null when the file isn't there. */
async function readCopy(path: string): Promise<Loaded> {
  let raw: unknown
  try {
    raw = await readJson(path)
  } catch (err) {
    if (err instanceof SyntaxError) return { problem: `not valid JSON (${err.message})` }
    throw err
  }
  if (raw === null) return null
  const problem = projectProblem(raw)
  return problem ? { problem } : { project: raw as Project }
}

// Named once per project per process: the desk polls, and the terminal
// shouldn't scroll with the same line until the next save heals the file.
const openedFromBackup = new Set<string>()

/** The project file, else the backup the last write kept (CR-14). */
async function loadProject(id: string): Promise<Loaded> {
  const dir = projectDir(id)
  const main = await readCopy(join(dir, PROJECT_FILE))
  if (main === null || 'project' in main) return main
  const backup = await readCopy(join(dir, BACKUP_FILE))
  if (backup === null || !('project' in backup)) return { problem: `${PROJECT_FILE}: ${main.problem}` }
  if (!openedFromBackup.has(id)) {
    openedFromBackup.add(id)
    console.warn(`[store] projects/${id}/${PROJECT_FILE} couldn’t be read (${main.problem}); opened from ${BACKUP_FILE}, and the next save writes it again`)
  }
  return backup
}

async function readProject(id: string): Promise<Project> {
  const loaded = await loadProject(id)
  if (loaded === null) throw new Refused('There is no such project.', 404)
  if ('problem' in loaded) throw unreadableProject(id, loaded.problem)
  return loaded.project
}

/** Write `project`, keeping `previous` — read good just now — as the backup first. */
async function writeProject(project: Project, previous?: Project): Promise<void> {
  const dir = projectDir(project.id)
  if (previous) await writeAtomic(dir, BACKUP_FILE, previous)
  await writeAtomic(dir, PROJECT_FILE, project)
  openedFromBackup.delete(project.id)
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
    await writeProject(next, current) // backup, then tmp + rename
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
    characters: p.library.characters
      .filter((c) => c.locked && c.sheetImageId)
      .map((c) => ({ id: c.id, name: c.name, role: c.role, sheetImageId: c.sheetImageId as string, imported: c.source === 'imported' })),
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
    // The dashboard shows the sentence; the path and the parser's words stay in the log (SEC-11).
    console.warn(`[store] ${V1_FILE} couldn’t be read as a desk:`, err instanceof Error ? err.message : String(err))
    return { projectId: null, problem: 'The old chapter.json couldn’t be read as a desk. It was left as it is; fix or move it to migrate it.' }
  }
  if (raw === null) return { projectId: null, problem: null }
  if (!isChapterV1(raw)) {
    console.warn(`[store] ${V1_FILE} is not a version-1 desk; left as it is, nothing migrated.`)
    return { projectId: null, problem: 'The old chapter.json is not a version-1 desk. It was left as it is, nothing migrated.' }
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
    // One unreadable project never takes the desk down with it, and is never
    // hidden: it gets a "can't be read" card dated by its folder.
    let loaded: Loaded
    try {
      loaded = await loadProject(id)
    } catch (err) {
      loaded = { problem: err instanceof Error ? err.message : String(err) }
    }
    if (loaded === null) continue // a folder without its file
    if ('project' in loaded) {
      try {
        summaries.push(summarize(loaded.project))
        continue
      } catch (err) {
        loaded = { problem: err instanceof Error ? err.message : String(err) }
      }
    }
    console.warn(`[store] projects/${id} couldn’t be read; listed as unreadable: ${loaded.problem}`)
    const changed = await stat(join(PROJECTS_DIR, id)).then((info) => info.mtime, () => new Date(0))
    summaries.push(unreadableSummary(id, changed.toISOString()))
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

/** The image as a stream from disk, with its size — never read whole (CR-17). */
async function openBlob(id: string): Promise<BlobStream | null> {
  if (!isImageId(id)) return null
  try {
    const { size } = await stat(imagePath(id))
    const body = Readable.toWeb(createReadStream(imagePath(id))) as ReadableStream<Uint8Array>
    return { body, bytes: size, mediaType: mediaTypeOf(id) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** A local desk needs no database and no bucket. */
async function health(): Promise<StoreHealth> {
  return { mongo: 'n/a', bucket: 'n/a' }
}

export const localStore: Store = { listProjects, migrateLegacy, readProject, createProject, updateProject, putBlob, getBlob, openBlob, health }
