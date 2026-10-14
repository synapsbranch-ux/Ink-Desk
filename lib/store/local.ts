// The local store: files under `data/`, exactly the guarantees v1's chapter
// store had, per project.
//
//   data/projects/<id>/project.json      one project, written whole
//   data/projects/<id>/project.json.bak  the version before the last write
//   data/projects/v1-migrated.json       the marker: the v1 desk was migrated once
//   data/images/<kind>-<uuid>.<ext>      every image, sheets and panels alike
//   data/jobs/<id>.json                  one job record each (v3, slice 18)
//   data/chapter.json                    the v1 desk, read once, never modified
//
// Two guarantees, for two different problems (see `devpost/spec.md >
// Components > Chapter Store`):
//   1. No torn files   — write to a temp file nobody else shares, fsync it,
//      then rename() over the real one.
//   2. No lost updates — every mutation of a project goes through
//      `updateProject()`: first serialized on that project's own promise chain
//      (so writers in this process queue instead of polling the disk), then
//      under a lock between processes (`lock.ts`, CR-3) — the web service, the
//      worker and a check script may all write one `data/` folder. The
//      read-modify-write never interleaves. Two projects never wait on each
//      other; two panels of one page finishing together never erase each
//      other.

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
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ProviderError, Refused } from '../errors'
import { isChapterV1, migrateV1 } from '../migrate'
import { BUSY, isActive, type JobRecord } from '../queue/jobs'
import { singletons } from '../singleton'
import { DEFAULT_STYLE_PRESET_ID } from '../styles'
import type { Project, ProjectSummary } from '../types'
import type { BlobKind, BlobStream, JobFilter, JobStore, Store, StoreHealth } from './index'
import { withFileLock } from './lock'

// Overridable so the acceptance checks can run against a scratch folder.
// Read at module load, like v1: set the env before the first import.
export const DATA_DIR = process.env.INKDESK_DATA_DIR ?? 'data'
export const PROJECTS_DIR = join(DATA_DIR, 'projects')
export const IMAGES_DIR = join(DATA_DIR, 'images')
export const JOBS_DIR = join(DATA_DIR, 'jobs')
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

/**
 * Write `value` so a reader sees the old file or the new one, never half of
 * either (CR-3): a temp file of this write's own — a name two processes can
 * never share, or one renames the other's file away — flushed to disk before
 * the rename, so a crash cannot leave a renamed file with nothing in it.
 */
async function writeAtomic(dir: string, file: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true })
  const real = join(dir, file)
  const tmp = join(dir, `${file}.${process.pid}.${crypto.randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx')
    try {
      await handle.writeFile(JSON.stringify(value, null, 2))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, real)
  } catch (err) {
    await unlink(tmp).catch(() => {}) // a failed write leaves no stray temp file behind
    throw err
  }
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

/** The cross-process lock for one project: beside the project folders, which it may precede. The dot keeps it out of the listing. */
function projectLock(id: string): string {
  return join(PROJECTS_DIR, `.project-${id}.lock`)
}
/** One migration at a time, on every process that shares this folder. (An underscore cannot be in a project id.) */
const MIGRATE_LOCK = join(PROJECTS_DIR, '.migrate_v1.lock')

async function createProject(project: Project): Promise<void> {
  const dir = projectDir(project.id)
  // Under the lock, so two processes creating one id cannot both pass the check.
  await withFileLock(projectLock(project.id), async () => {
    if (await exists(join(dir, PROJECT_FILE))) throw new Refused('That project already exists.')
    await writeProject({ ...project, serverRunId: singletons.serverRunId })
  })
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
  const run = (): Promise<Project> =>
    withFileLock(projectLock(id), async () => {
      const current = await readProject(id) // fresh read, inside both locks
      const next: Project = {
        ...fn(current),
        id, // the id is the folder; a change here would be a different project
        serverRunId: singletons.serverRunId,
        updatedAt: new Date().toISOString(),
      }
      await writeProject(next, current) // backup, then tmp + fsync + rename
      return next
    })
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
  // Two processes listing a fresh desk together must not both migrate it: the
  // marker is checked again under the lock, and only the first one writes.
  return withFileLock(MIGRATE_LOCK, async () => {
    if (await exists(V1_MARKER)) return { projectId: null, problem: null }
    const ids = { projectId: `v1-${crypto.randomUUID().slice(0, 8)}`, chapterId: crypto.randomUUID() }
    const project = migrateV1(raw, ids, singletons.serverRunId, new Date().toISOString(), 'chapter.json')
    await createProject(project)
    await writeAtomic(PROJECTS_DIR, 'v1-migrated.json', { projectId: ids.projectId, at: project.updatedAt })
    console.log(`[store] migrated the v1 desk into project ${ids.projectId} (“${project.title}”); ${V1_FILE} untouched`)
    return { projectId: ids.projectId, problem: null }
  })
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

// --- Jobs -----------------------------------------------------------------------
//
// One file per job, `data/jobs/<id>.json`, written whole like a project. A job
// is changed by the worker as well as the web service, so every change is a
// read → function → write under that job's cross-process lock, and a new job
// is checked against the others' keys under a lock on the whole folder.

/** A job id is a filename: the same strictness as a project id (uuids pass). */
const JOB_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isJobId(id: string): boolean {
  return typeof id === 'string' && JOB_ID.test(id)
}

/** How many jobs one listing returns unless the caller asks for a number. */
export const JOB_LIST_LIMIT = 500

// The dot keeps both out of the listing; an underscore cannot be in a job id, so
// the folder's lock never collides with one job's.
const JOBS_LOCK = join(JOBS_DIR, '.jobs_dir.lock')
const jobLock = (id: string) => join(JOBS_DIR, `.${id}.lock`)

function jobFile(id: string): string {
  if (!isJobId(id)) throw new Error(`Not a job id: ${id}`)
  return `${id}.json`
}

// Named once per file per process: the studio polls, and a damaged record
// shouldn’t scroll the terminal every 1.5 s.
const warnedJobs = new Set<string>()

/** One job record, or null when there is none — or it can't be read, which is named once and never thrown. */
async function readJobFile(file: string): Promise<JobRecord | null> {
  const path = join(JOBS_DIR, file)
  let raw: unknown
  try {
    raw = await readJson(path)
  } catch (err) {
    if (err instanceof SyntaxError) raw = undefined
    else throw err
  }
  if (raw === null) return null
  const job = raw as Partial<JobRecord> | undefined
  if (typeof job !== 'object' || job === null || `${job.id}.json` !== file || typeof job.key !== 'string' || typeof job.status !== 'string') {
    if (!warnedJobs.has(file)) {
      warnedJobs.add(file)
      console.warn(`[store] jobs/${file} couldn’t be read as a job; skipped`)
    }
    return null
  }
  return job as JobRecord
}

/** Every readable job record in the folder (no limit, no order). */
async function readJobs(): Promise<JobRecord[]> {
  let names: string[]
  try {
    names = await readdir(JOBS_DIR)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const jobs: JobRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || !isJobId(name.slice(0, -'.json'.length))) continue // a lock, a temp file, anything else
    const job = await readJobFile(name)
    if (job) jobs.push(job)
  }
  return jobs
}

const newestFirst = (a: JobRecord, b: JobRecord) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

const jobs: JobStore = {
  async insertJob(job) {
    const file = jobFile(job.id) // refuses a path trick before anything is touched
    return withFileLock(
      JOBS_LOCK,
      async () => {
        if (isActive(job)) {
          const holder = (await readJobs()).find((other) => isActive(other) && other.key === job.key)
          if (holder) return { job: holder, created: false }
        }
        if (await exists(join(JOBS_DIR, file))) throw new Error(`jobs/${file} already exists`)
        await writeAtomic(JOBS_DIR, file, job)
        return { job, created: true }
      },
      { busy: BUSY }
    )
  },

  async getJob(id) {
    if (!isJobId(id)) return null
    return readJobFile(jobFile(id))
  },

  async updateJob(id, fn) {
    if (!isJobId(id)) return null
    const file = jobFile(id)
    return withFileLock(
      jobLock(id),
      async () => {
        const current = await readJobFile(file) // fresh read, inside both locks
        if (!current) return null
        const next = fn(current)
        if (next === null) return null
        const written: JobRecord = { ...next, id } // the id is the file; a change here would be a different job
        await writeAtomic(JOBS_DIR, file, written)
        return written
      },
      { busy: BUSY }
    )
  },

  async listJobs(filter: JobFilter = {}) {
    const { projectId, ownerId, status, key, updatedSince, limit } = filter
    return (await readJobs())
      .filter(
        (job) =>
          (projectId === undefined || job.projectId === projectId) &&
          (ownerId === undefined || job.ownerId === ownerId) &&
          (status === undefined || status.includes(job.status)) &&
          (key === undefined || job.key === key) &&
          (updatedSince === undefined || job.updatedAt >= updatedSince)
      )
      .sort(newestFirst)
      .slice(0, limit ?? JOB_LIST_LIMIT)
  },

  async pruneJobs(finishedBefore) {
    const over = (job: JobRecord) => !isActive(job) && (job.finishedAt ?? job.updatedAt) < finishedBefore
    let removed = 0
    for (const candidate of (await readJobs()).filter(over)) {
      // Looked at again under its lock: a record changed since the listing stays.
      removed += await withFileLock(
        jobLock(candidate.id),
        async () => {
          const current = await readJobFile(jobFile(candidate.id))
          if (!current || !over(current)) return 0
          await unlink(join(JOBS_DIR, jobFile(candidate.id)))
          return 1
        },
        { busy: BUSY }
      )
    }
    return removed
  },
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

/** Remove one image; one that isn't there is already gone (CR-16). An unsafe id names nothing. */
async function deleteBlob(id: string): Promise<void> {
  if (!isImageId(id)) return
  try {
    await unlink(imagePath(id))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/** A local desk needs no database and no bucket. */
async function health(): Promise<StoreHealth> {
  return { mongo: 'n/a', bucket: 'n/a' }
}

export const localStore: Store = { listProjects, migrateLegacy, readProject, createProject, updateProject, putBlob, getBlob, openBlob, deleteBlob, jobs, health }
