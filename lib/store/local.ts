// The local store: files under `data/`, exactly the guarantees v1's chapter
// store had, per project.
//
//   data/projects/<id>/project.json      one project, written whole
//   data/projects/<id>/project.json.bak  the version before the last write
//   data/projects/v1-migrated.json       the marker: the v1 desk was migrated once
//   data/images/<kind>-<uuid>.<ext>      every image, sheets and panels alike
//   data/jobs/<id>.json                  one job record each (v3, slice 18)
//   data/users/<id>.json                 one account each, from Clerk's webhook (v3, slice 19)
//   data/shares/<token>.json             one public share each, a revoked one with no snapshot (v3, slice 21)
//   data/reports/<id>.json               one visitor report each (v3, slice 21)
//   data/settings/<userId>.json          one person's defaults (v3, slice 21)
//   data/videos/<id>.json                one trailer record each — slice 22 fills them (v3, slice 21)
//   data/outputs/<key>                   exports and rendered videos, by key, e.g. exports/<owner>/<job>.zip (v3, slice 21)
//   data/outputs/.tmp/                   a write in progress, renamed into place when whole; never listed
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
//
// The records added in slice 21 follow the same two rules, by the same means:
// whole-file atomic writes, and a cross-process lock around every change that
// must not interleave (a share is created or revoked under the folder's lock,
// so "one active share per project" holds across the web service, the worker
// and a check script). Reads take no lock — a rename means they see the old
// file or the new one. The outputs are files the studio makes: written to
// `.tmp/` and renamed, so a reader never meets half of a zip.

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
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { authMode } from '../auth/config'
import { ProviderError, Refused } from '../errors'
import { isChapterV1, migrateV1 } from '../migrate'
import { BUSY, LOCAL_OWNER, isActive, type JobRecord } from '../queue/jobs'
import type { ReportRecord, ShareRecord, UserSettings, VideoRecord } from '../share/types'
import { singletons } from '../singleton'
import { DEFAULT_STYLE_PRESET_ID } from '../styles'
import type { Project, ProjectSummary } from '../types'
import type {
  BlobKind,
  BlobStream,
  Claim,
  JobFilter,
  JobStore,
  OutputStore,
  ProjectOwner,
  ReportStore,
  SettingsStore,
  ShareStore,
  Store,
  StoreHealth,
  UserRecord,
  UserStore,
  VideoStore,
} from './index'
import { withFileLock } from './lock'

// Overridable so the acceptance checks can run against a scratch folder.
// Read at module load, like v1: set the env before the first import.
export const DATA_DIR = process.env.INKDESK_DATA_DIR ?? 'data'
export const PROJECTS_DIR = join(DATA_DIR, 'projects')
export const IMAGES_DIR = join(DATA_DIR, 'images')
export const JOBS_DIR = join(DATA_DIR, 'jobs')
export const USERS_DIR = join(DATA_DIR, 'users')
export const SHARES_DIR = join(DATA_DIR, 'shares')
export const REPORTS_DIR = join(DATA_DIR, 'reports')
export const SETTINGS_DIR = join(DATA_DIR, 'settings')
export const VIDEOS_DIR = join(DATA_DIR, 'videos')
export const OUTPUTS_DIR = join(DATA_DIR, 'outputs')
const V1_FILE = join(DATA_DIR, 'chapter.json')
const V1_MARKER = join(PROJECTS_DIR, 'v1-migrated.json')

// --- Ids ---------------------------------------------------------------------

/** A project id is used as a folder name: strict on purpose. */
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isProjectId(id: string): boolean {
  return PROJECT_ID.test(id)
}

/** Whose a project is: a project written before accounts is `local`'s (slice 19). Shared with the cloud store. */
export function ownerOf(project: Pick<Project, 'ownerId'>): string {
  return project.ownerId ?? LOCAL_OWNER
}

/** The project with the owner it was read with — no edit can change it (slice 19). */
export function keepOwner(next: Project, current: Project): Project {
  const kept = { ...next }
  if (current.ownerId === undefined) delete kept.ownerId
  else kept.ownerId = current.ownerId
  return kept
}

/** Is this project free to claim: no owner, or the desk-without-accounts owner. */
export function claimable(ownerId: string | null | undefined): boolean {
  return ownerId === undefined || ownerId === null || ownerId === LOCAL_OWNER
}

/** The sentence for a claim on a project somebody else owns. Shared with the cloud store. */
export const OWNED_BY_ANOTHER = 'That project already has an owner; it was left as it is.'

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
        ...keepOwner(fn(current), current), // the owner is set once, at creation
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
      .map((c) => ({ projectId: p.id, id: c.id, name: c.name, role: c.role, sheetImageId: c.sheetImageId as string, imported: c.source === 'imported' })),
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
  // The v1 desk was one person's; on a studio with accounts it would land as
  // `local`'s, which nobody signed in can open — `claim-projects` hands it over instead.
  if (authMode() !== 'off') return { projectId: null, problem: null }
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

/**
 * Whose an unreadable project is, as far as either copy still says: a project
 * that can't be opened is still listed for its owner (CR-14), and for nobody
 * else. Where neither copy names one, it is `local`'s.
 */
async function rawOwner(id: string): Promise<string> {
  for (const file of [PROJECT_FILE, BACKUP_FILE]) {
    const raw = await readJson(join(PROJECTS_DIR, id, file)).catch(() => null)
    const owner = (raw as { ownerId?: unknown } | null)?.ownerId
    if (typeof owner === 'string') return owner
  }
  return LOCAL_OWNER
}

/** Whose one project is, even when it can't be read; null when its folder holds neither copy. */
async function projectOwner(id: string): Promise<string | null> {
  if (!isProjectId(id)) return null
  const dir = projectDir(id)
  if (!(await exists(join(dir, PROJECT_FILE))) && !(await exists(join(dir, BACKUP_FILE)))) return null
  return rawOwner(id)
}

/** Every project folder's id, in no order — the marker file, a lock or a stray temp file are not projects. */
async function projectIds(): Promise<string[]> {
  try {
    return (await readdir(PROJECTS_DIR)).filter(isProjectId)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/**
 * The caller's projects (slice 19). A local desk has no index: every project
 * is read and the others are skipped — fine for one person's folder, which is
 * the only thing a local desk is (production runs on the cloud store, SEC-12).
 */
async function listProjects(ownerId: string): Promise<ProjectSummary[]> {
  await migrateLegacy()
  const entries = await projectIds()
  const summaries: ProjectSummary[] = []
  for (const id of entries) {
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
      if (ownerOf(loaded.project) !== ownerId) continue // someone else's: not even its id is listed
      try {
        summaries.push(summarize(loaded.project))
        continue
      } catch (err) {
        loaded = { problem: err instanceof Error ? err.message : String(err) }
      }
    }
    if ((await rawOwner(id)) !== ownerId) continue
    console.warn(`[store] projects/${id} couldn’t be read; listed as unreadable: ${loaded.problem}`)
    const changed = await stat(join(PROJECTS_DIR, id)).then((info) => info.mtime, () => new Date(0))
    summaries.push(unreadableSummary(id, changed.toISOString()))
  }
  return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/** Every project and its owner, for the claim script. An unreadable project is named with the owner its file still states. */
async function projectOwners(): Promise<ProjectOwner[]> {
  const owners: ProjectOwner[] = []
  for (const id of await projectIds()) {
    const loaded = await loadProject(id).catch((err: unknown) => ({ problem: String(err) }))
    if (loaded === null) continue
    if ('project' in loaded) owners.push({ id, title: loaded.project.title, ownerId: loaded.project.ownerId ?? null })
    else owners.push({ id, title: id, ownerId: await rawOwner(id).then((o) => (o === LOCAL_OWNER ? null : o)) })
  }
  return owners.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Give an unowned project to `ownerId`, under the project's own lock — the one write that may set an owner after creation. */
async function claimProject(id: string, ownerId: string): Promise<Claim> {
  if (!isProjectId(id)) throw new Refused('There is no such project.', 404)
  return withFileLock(projectLock(id), async () => {
    const current = await readProject(id)
    if (current.ownerId === ownerId) return 'already-theirs'
    if (!claimable(current.ownerId)) throw new Refused(OWNED_BY_ANOTHER)
    await writeProject({ ...current, ownerId, serverRunId: singletons.serverRunId, updatedAt: new Date().toISOString() }, current)
    return 'claimed'
  })
}

/** The ids of every project `ownerId` owns, unreadable ones included: whose it is is asked of whatever either copy still says (`projectOwner`), not of a parse that may fail. */
async function projectsOf(ownerId: string): Promise<{ id: string }[]> {
  const mine: { id: string }[] = []
  for (const id of (await projectIds()).sort()) {
    if ((await projectOwner(id)) === ownerId) mine.push({ id })
  }
  return mine
}

/**
 * When a project last changed and whose it is. A readable project says so
 * itself; one that cannot be read is dated by its folder, as its dashboard card
 * is, and owned by whatever either copy still names. Null when neither copy exists.
 */
async function projectStamp(id: string): Promise<{ ownerId: string; updatedAt: string } | null> {
  if (!isProjectId(id)) return null
  let loaded: Loaded
  try {
    loaded = await loadProject(id)
  } catch (err) {
    loaded = { problem: err instanceof Error ? err.message : String(err) }
  }
  if (loaded && 'project' in loaded && typeof loaded.project.updatedAt === 'string') {
    return { ownerId: ownerOf(loaded.project), updatedAt: loaded.project.updatedAt }
  }
  const owner = await projectOwner(id)
  if (owner === null) return null
  const changed = await stat(join(PROJECTS_DIR, id)).then((info) => info.mtime, () => new Date(0))
  return { ownerId: owner, updatedAt: changed.toISOString() }
}

/**
 * Remove the project's folder — the file, its backup — under the project's own
 * lock, so a write in flight finishes first and a later one finds no project.
 * The pictures are not the project's to remove here: the caller lists them
 * (`projectImageIds`) and deletes them first. A garbage id names no folder.
 */
async function deleteProject(id: string): Promise<void> {
  if (!isProjectId(id)) return
  await withFileLock(projectLock(id), () => rm(projectDir(id), { recursive: true, force: true }))
  openedFromBackup.delete(id)
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

/** Remove one job record, under its lock so it never meets a write half-way; true if there was one. */
async function deleteJob(id: string): Promise<boolean> {
  if (!isJobId(id)) return false
  const file = jobFile(id)
  return withFileLock(
    jobLock(id),
    async () => {
      try {
        await unlink(join(JOBS_DIR, file))
        return true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw err
      }
    },
    { busy: BUSY }
  )
}

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
    const { projectId, ownerId, status, key, updatedSince, reservation, limit } = filter
    return (await readJobs())
      .filter(
        (job) =>
          (projectId === undefined || job.projectId === projectId) &&
          (ownerId === undefined || job.ownerId === ownerId) &&
          (status === undefined || status.includes(job.status)) &&
          (key === undefined || job.key === key) &&
          (updatedSince === undefined || job.updatedAt >= updatedSince) &&
          (reservation === undefined || job.reservation === reservation)
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

  deleteJob,

  async deleteJobsOf(ownerId, exceptId) {
    let removed = 0
    for (const job of await readJobs()) {
      if (job.ownerId === ownerId && job.id !== exceptId && (await deleteJob(job.id))) removed++
    }
    return removed
  },
}

// --- Users ----------------------------------------------------------------------
//
// One file per account, `data/users/<id>.json`, written whole (temp, fsync,
// rename) under that account's lock — Clerk may deliver one event twice, or
// two at once.

/** A user id is a filename: Clerk's ids (`user_…`) pass, a path never does. */
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function isUserId(id: string): boolean {
  return typeof id === 'string' && USER_ID.test(id)
}

/** The sentence for an id that cannot be an account. Shared with the cloud store. */
export const NOT_A_USER = 'That is not an account id.'

const userLock = (id: string) => join(USERS_DIR, `.${id}.lock`)

/** Pure, shared with the cloud store: the record after an upsert. A deleted account stays deleted and keeps no email. */
export function upserted(current: UserRecord | null, user: { id: string; email: string; createdAt: string }, now: string): UserRecord {
  if (current?.deletedAt) return current
  if (current && current.email === user.email) return current // a replay changes nothing, not even the time
  return { id: user.id, email: user.email, createdAt: current?.createdAt ?? user.createdAt, updatedAt: now, deletedAt: null }
}

/** Pure, shared with the cloud store: the record after a deletion. Deleting twice keeps the first time. */
export function deleted(current: UserRecord | null, id: string, now: string): UserRecord {
  if (current?.deletedAt) return current
  return { id, email: '', createdAt: current?.createdAt ?? now, updatedAt: now, deletedAt: now }
}

async function readUser(id: string): Promise<UserRecord | null> {
  const raw = (await readJson(join(USERS_DIR, `${id}.json`))) as UserRecord | null
  return raw && raw.id === id ? raw : null
}

/** Read → change → write one account, under its lock. */
function changeUser(id: string, fn: (current: UserRecord | null) => UserRecord): Promise<UserRecord> {
  if (!isUserId(id)) return Promise.reject(new Refused(NOT_A_USER, 400))
  return withFileLock(userLock(id), async () => {
    const current = await readUser(id)
    const next = fn(current)
    if (next !== current) await writeAtomic(USERS_DIR, `${id}.json`, next)
    return next
  })
}

const users: UserStore = {
  upsert: (user) => changeUser(user.id, (current) => upserted(current, user, new Date().toISOString())),
  async get(id) {
    return isUserId(id) ? readUser(id) : null
  },
  markDeleted: (id) => changeUser(id, (current) => deleted(current, id, new Date().toISOString())),
}

// --- Shares ---------------------------------------------------------------------
//
// One file per share, `data/shares/<token>.json`, written whole. Every change
// (create, refresh, revoke, delete) runs under ONE lock on the folder: shares
// are rare writes, and "at most one active share per project" is a fact about
// the whole folder, so the check and the write must be one step. Reads take no
// lock; a rename means they see the old file or the new one.

/** A token is a filename: base62 from 128 random bits is 22 characters; this accepts anything of that kind and never a path. Shared with the cloud store. */
const SHARE_TOKEN = /^[A-Za-z0-9]{8,64}$/

export function isShareToken(token: unknown): token is string {
  return typeof token === 'string' && SHARE_TOKEN.test(token)
}

const SHARES_LOCK = join(SHARES_DIR, '.shares_dir.lock')

const warnedShares = new Set<string>()

/** Is this what a share record looks like — enough to trust the fields the store itself reads. */
function shareProblem(raw: unknown, token: string): string | null {
  const share = raw as Partial<ShareRecord> | null
  if (typeof share !== 'object' || share === null) return 'not an object'
  if (share.token !== token) return 'its token is not its file’s name'
  if (typeof share.ownerId !== 'string') return 'no owner'
  if (share.kind !== 'manga' && share.kind !== 'video') return 'no kind'
  if (typeof share.createdAt !== 'string') return 'no creation time'
  if (share.revokedAt !== null && share.revokedAt !== undefined && typeof share.revokedAt !== 'string') return 'a revocation time that is not a time'
  return null
}

/** One share, or null when there is none — or it can't be read, which is named once and never thrown. */
async function readShare(token: string): Promise<ShareRecord | null> {
  if (!isShareToken(token)) return null
  let raw: unknown
  try {
    raw = await readJson(join(SHARES_DIR, `${token}.json`))
  } catch (err) {
    if (err instanceof SyntaxError) raw = undefined
    else throw err
  }
  if (raw === null) return null
  const problem = shareProblem(raw, token)
  if (problem) {
    // The token is the address of someone's work: it stays out of the log.
    if (!warnedShares.has(token.slice(0, 4))) {
      warnedShares.add(token.slice(0, 4))
      console.warn(`[store] a file in shares/ couldn’t be read as a share (${problem}); skipped`)
    }
    return null
  }
  const share = raw as ShareRecord
  return { ...share, projectId: share.projectId ?? null, videoId: share.videoId ?? null, snapshot: share.snapshot ?? null, updatedAt: share.updatedAt ?? share.createdAt, revokedAt: share.revokedAt ?? null }
}

/** Every readable share (no order). */
async function readShares(): Promise<ShareRecord[]> {
  let names: string[]
  try {
    names = await readdir(SHARES_DIR)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const shares: ShareRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue // a lock, a temp file, anything else
    const share = await readShare(name.slice(0, -'.json'.length))
    if (share) shares.push(share)
  }
  return shares
}

const sharesNewestFirst = (a: ShareRecord, b: ShareRecord) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.token < b.token ? 1 : a.token > b.token ? -1 : 0)

/** Run `fn` on the folder's lock. */
const sharesLocked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(SHARES_LOCK, fn, { busy: BUSY })

const shares: ShareStore = {
  async create(record) {
    if (!isShareToken(record.token)) throw new Error('Not a share token')
    return sharesLocked(async () => {
      if (record.projectId !== null && record.revokedAt === null) {
        const holder = (await readShares()).find((other) => other.revokedAt === null && other.projectId === record.projectId)
        if (holder) return { share: holder, created: false }
      }
      // A taken token is never overwritten: a revoked one is dead for good.
      if (await exists(join(SHARES_DIR, `${record.token}.json`))) throw new Error('that share token is already taken')
      await writeAtomic(SHARES_DIR, `${record.token}.json`, record)
      return { share: record, created: true }
    })
  },

  get: (token) => readShare(token),

  async activeForProject(projectId) {
    return (await readShares()).find((share) => share.revokedAt === null && share.projectId === projectId) ?? null
  },

  async listActiveOf(ownerId) {
    return (await readShares()).filter((share) => share.revokedAt === null && share.ownerId === ownerId).sort(sharesNewestFirst)
  },

  async refresh(token, snapshot, now) {
    if (!isShareToken(token)) return null
    return sharesLocked(async () => {
      const current = await readShare(token)
      if (!current || current.revokedAt !== null) return null
      const next: ShareRecord = { ...current, snapshot, updatedAt: now }
      await writeAtomic(SHARES_DIR, `${token}.json`, next)
      return next
    })
  },

  async revoke(token, now) {
    if (!isShareToken(token)) return null
    return sharesLocked(async () => {
      const current = await readShare(token)
      if (!current) return null
      if (current.revokedAt !== null) return current // the first revocation stands
      const next: ShareRecord = { ...current, snapshot: null, revokedAt: now, updatedAt: now }
      await writeAtomic(SHARES_DIR, `${token}.json`, next)
      return next
    })
  },

  async deleteAllOf(ownerId) {
    return sharesLocked(async () => {
      const gone: string[] = []
      for (const share of await readShares()) {
        if (share.ownerId !== ownerId) continue
        await unlink(join(SHARES_DIR, `${share.token}.json`)).catch((err: unknown) => {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        })
        gone.push(share.token)
      }
      return gone.sort()
    })
  },
}

// --- Records by id --------------------------------------------------------------
//
// Reports and videos: one file per record, named by an id the app makes (a
// uuid), checked before it touches a path.

/** A record id is a filename: uuids pass, a path never does. Shared with the cloud store. */
export function isRecordId(id: unknown): id is string {
  return typeof id === 'string' && JOB_ID.test(id)
}

/** The record in `<dir>/<id>.json`, or null when it isn't there, can't be read as JSON, or isn't the record the name says. */
async function readRecord<T extends { id: string }>(dir: string, id: string): Promise<T | null> {
  if (!isRecordId(id)) return null
  let raw: unknown
  try {
    raw = await readJson(join(dir, `${id}.json`))
  } catch (err) {
    if (err instanceof SyntaxError) return null
    throw err
  }
  const record = raw as Partial<T> | null
  return typeof record === 'object' && record !== null && record.id === id ? (record as T) : null
}

/** Every readable record in `<dir>` (no order). */
async function readRecords<T extends { id: string }>(dir: string): Promise<T[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const records: T[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const record = await readRecord<T>(dir, name.slice(0, -'.json'.length))
    if (record) records.push(record)
  }
  return records
}

/** Remove a file that may not be there. */
async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

// --- Reports --------------------------------------------------------------------

const REPORTS_LOCK = join(REPORTS_DIR, '.reports_dir.lock')

/** How many reports one listing returns unless the caller asks for a number, and the most it ever returns. Shared with the cloud store. */
export const REPORT_LIST_DEFAULT = 200
export const REPORT_LIST_MAX = 1000

export function reportLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return REPORT_LIST_DEFAULT
  return Math.min(Math.max(1, Math.floor(limit)), REPORT_LIST_MAX)
}

const reportsLocked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(REPORTS_LOCK, fn, { busy: BUSY })

const reports: ReportStore = {
  async add(report) {
    if (!isRecordId(report.id)) throw new Error('Not a report id')
    await reportsLocked(async () => {
      if (await exists(join(REPORTS_DIR, `${report.id}.json`))) throw new Error('that report id is already taken')
      await writeAtomic(REPORTS_DIR, `${report.id}.json`, report)
    })
  },

  async list(opts = {}) {
    return (await readRecords<ReportRecord>(REPORTS_DIR))
      .filter((report) => !opts.unhandledOnly || report.handledAt === null || report.handledAt === undefined)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, reportLimit(opts.limit))
  },

  get: (id) => readRecord<ReportRecord>(REPORTS_DIR, id),

  async markHandled(id, now) {
    if (!isRecordId(id)) return null
    return reportsLocked(async () => {
      const current = await readRecord<ReportRecord>(REPORTS_DIR, id)
      if (!current) return null
      if (current.handledAt) return current // the first time stands
      const next: ReportRecord = { ...current, handledAt: now }
      await writeAtomic(REPORTS_DIR, `${id}.json`, next)
      return next
    })
  },

  async deleteForTokens(tokens) {
    const wanted = new Set(tokens)
    if (wanted.size === 0) return 0
    return reportsLocked(async () => {
      let removed = 0
      for (const report of await readRecords<ReportRecord>(REPORTS_DIR)) {
        if (wanted.has(report.token) && (await removeFile(join(REPORTS_DIR, `${report.id}.json`)))) removed++
      }
      return removed
    })
  },
}

// --- Settings -------------------------------------------------------------------
//
// One file per person, `data/settings/<userId>.json`. A put is one whole-file
// write and the last one wins, which is all a form of defaults needs.

/** The sentence for an id that cannot be an account is `NOT_A_USER` (above). */
const settings: SettingsStore = {
  async get(userId) {
    if (!isUserId(userId)) return null
    const raw = (await readJson(join(SETTINGS_DIR, `${userId}.json`)).catch((err: unknown) => {
      if (err instanceof SyntaxError) return null
      throw err
    })) as UserSettings | null
    return raw && raw.userId === userId ? raw : null
  },

  async put(next) {
    if (!isUserId(next.userId)) throw new Refused(NOT_A_USER, 400)
    await writeAtomic(SETTINGS_DIR, `${next.userId}.json`, next)
  },

  async delete(userId) {
    if (!isUserId(userId)) return
    await removeFile(join(SETTINGS_DIR, `${userId}.json`))
  },
}

// --- Videos ---------------------------------------------------------------------

const VIDEOS_LOCK = join(VIDEOS_DIR, '.videos_dir.lock')

/** Put and delete-all share the folder's lock, so a record written while an account is being deleted is either seen by the deletion or refused by nothing — never half. */
const videosLocked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(VIDEOS_LOCK, fn, { busy: BUSY })

const videos: VideoStore = {
  async put(video) {
    if (!isRecordId(video.id)) throw new Error('Not a video id')
    await videosLocked(() => writeAtomic(VIDEOS_DIR, `${video.id}.json`, video))
  },

  get: (id) => readRecord<VideoRecord>(VIDEOS_DIR, id),

  async listOf(ownerId) {
    return (await readRecords<VideoRecord>(VIDEOS_DIR))
      .filter((video) => video.ownerId === ownerId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  },

  async deleteAllOf(ownerId) {
    return videosLocked(async () => {
      const gone: VideoRecord[] = []
      for (const video of await readRecords<VideoRecord>(VIDEOS_DIR)) {
        if (video.ownerId !== ownerId) continue
        await removeFile(join(VIDEOS_DIR, `${video.id}.json`))
        gone.push(video)
      }
      return gone
    })
  },
}

// --- Outputs --------------------------------------------------------------------
//
// `data/outputs/<key>`. Keys are made by the app, but they are checked as if a
// visitor had typed them: plain segments only, so nothing a key can say reaches
// outside the folder. The same rules guard the bucket in cloud mode.

const OUTPUT_KEY_MAX = 512
const OUTPUT_SEGMENT_MAX = 128
/** Letters, digits, `.`, `_`, `-`; never a leading dot (that is for the store's own `.tmp`), so `.` and `..` cannot be a segment. */
const OUTPUT_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

/** Is this a key the outputs store will name: 1–512 characters, plain non-empty segments joined by `/`. Shared with the cloud store. */
export function isOutputKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > OUTPUT_KEY_MAX) return false
  return key.split('/').every((segment) => segment.length <= OUTPUT_SEGMENT_MAX && OUTPUT_SEGMENT.test(segment))
}

/**
 * A prefix as a folder: `''` (everything), else a key with one trailing `/`
 * added or kept — `a/b` and `a/b/` both reach only what is under `a/b/`, never
 * `a/bc`. Null for one that is not safe. Shared with the cloud store.
 */
export function outputFolder(prefix: unknown): string | null {
  if (prefix === '') return ''
  if (typeof prefix !== 'string') return null
  const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  return isOutputKey(bare) ? `${bare}/` : null
}

const EXT_MEDIA_TYPES: Record<string, string> = {
  zip: 'application/zip',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

/** What a key's extension says it is: the local store keeps no media type beside the file, as an image id's extension is its media type. Shared with the cloud store, for an object that came back without one. */
export function outputMediaType(key: string): string {
  const name = key.slice(key.lastIndexOf('/') + 1)
  return EXT_MEDIA_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
}

const OUTPUTS_TMP = join(OUTPUTS_DIR, '.tmp')

/** The path of a key under the outputs folder — and a second look that it is inside it, whatever the key said. */
function outputPath(path: string): string {
  const full = resolve(OUTPUTS_DIR, path)
  if (!full.startsWith(resolve(OUTPUTS_DIR) + sep)) throw new Error('Not an output key')
  return full
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const IS_GONE = new Set(['ENOENT', 'ENOTDIR'])

/** Every file under `dir` as `{key, bytes, modifiedAt}`, keys relative to the outputs folder; a name starting with a dot is the store's own and is skipped. */
async function walkOutputs(dir: string, folder: string, found: { key: string; bytes: number; modifiedAt: string }[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (IS_GONE.has((err as NodeJS.ErrnoException).code ?? '')) return
    throw err
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) await walkOutputs(join(dir, entry.name), `${folder}${entry.name}/`, found)
    else if (entry.isFile()) {
      const info = await stat(join(dir, entry.name)).catch(() => null)
      if (info) found.push({ key: `${folder}${entry.name}`, bytes: info.size, modifiedAt: info.mtime.toISOString() })
    }
  }
}

/** The folder a prefix names, or the refusal for one that names nowhere safe. Shared with the cloud store. */
export function requireOutputFolder(prefix: string): string {
  const folder = outputFolder(prefix)
  if (folder === null) throw new Error(`Not an output prefix: ${JSON.stringify(prefix).slice(0, 80)}`)
  return folder
}

const outputs: OutputStore = {
  // The media type is not kept beside a local file (see `outputMediaType`): the key's extension says it.
  async put(key, body) {
    if (!isOutputKey(key)) throw new Error(`Not an output key: ${JSON.stringify(key).slice(0, 80)}`)
    const real = outputPath(key)
    await mkdir(OUTPUTS_TMP, { recursive: true })
    await mkdir(dirname(real), { recursive: true })
    // A temp file of this write's own, flushed before the rename: a reader sees the old object or the whole new one.
    const tmp = join(OUTPUTS_TMP, `${process.pid}.${crypto.randomUUID()}.tmp`)
    try {
      if (typeof body === 'string') {
        await copyFile(body, tmp)
        await syncFile(tmp)
      } else {
        const handle = await open(tmp, 'wx')
        try {
          if (Buffer.isBuffer(body)) await handle.writeFile(body)
          else for await (const chunk of body) await handle.writeFile(chunk) // appends at the position the last chunk left
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
      const { size } = await stat(tmp)
      await rename(tmp, real)
      return { bytes: size }
    } catch (err) {
      await unlink(tmp).catch(() => {}) // a failed write leaves no stray temp file behind
      throw err
    }
  },

  async open(key) {
    if (!isOutputKey(key)) return null
    const real = outputPath(key)
    try {
      const info = await stat(real)
      if (!info.isFile()) return null
      const body = Readable.toWeb(createReadStream(real)) as ReadableStream<Uint8Array>
      return { body, bytes: info.size, mediaType: outputMediaType(key) }
    } catch (err) {
      if (IS_GONE.has((err as NodeJS.ErrnoException).code ?? '')) return null
      throw err
    }
  },

  /** A key that is not safe names nothing, so there is nothing to remove. */
  async delete(key) {
    if (!isOutputKey(key)) return
    const real = outputPath(key)
    const info = await stat(real).catch(() => null)
    if (info?.isFile()) await removeFile(real)
  },

  async deletePrefix(prefix) {
    const folder = requireOutputFolder(prefix)
    if (folder === '') throw new Error('deletePrefix needs a folder; an empty prefix would delete every output')
    const found: { key: string; bytes: number; modifiedAt: string }[] = []
    const real = outputPath(folder)
    // A prefix is a FOLDER: a key that happens to be spelled the same (`exports/a/job.zip` asked as a prefix) names no folder, and in a bucket matches nothing — it must not remove that file here.
    const info = await stat(real).catch(() => null)
    if (!info?.isDirectory()) return 0
    await walkOutputs(real, folder, found)
    await rm(real, { recursive: true, force: true })
    return found.length
  },

  async list(prefix) {
    const folder = requireOutputFolder(prefix)
    const found: { key: string; bytes: number; modifiedAt: string }[] = []
    await walkOutputs(folder === '' ? OUTPUTS_DIR : outputPath(folder), folder, found)
    return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
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

export const localStore: Store = {
  listProjects,
  migrateLegacy,
  readProject,
  createProject,
  updateProject,
  projectOwners,
  projectOwner,
  claimProject,
  deleteProject,
  projectStamp,
  projectsOf,
  putBlob,
  getBlob,
  openBlob,
  deleteBlob,
  jobs,
  users,
  shares,
  reports,
  settings,
  videos,
  outputs,
  health,
}
