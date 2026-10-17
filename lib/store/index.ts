// The storage seam (v2). One interface, chosen by `INKDESK_STORAGE`:
//   • `local` (default) — files under `data/`, the way v1 worked. A clone runs
//     with nothing but the two API keys.
//   • `cloud` — MongoDB for project state and two S3-compatible buckets
//     (slice 13, `cloud.ts`; two buckets since v3): project files — images and
//     uploads — and outputs. The learner's variable names are mapped in
//     `lib/config.ts`. Loaded on first use, so a local desk
//     never loads either driver. Started without its settings, every call is
//     refused with the sentence naming the missing variables — never a quiet
//     fall back to the local desk. `instrumentation.ts` refuses the same thing
//     once, at server start.
// Since slice 21 the same seam also keeps the public shares, the reports about
// them, a person's defaults, the trailer records and the outputs (exports and
// rendered videos) — the types are in `lib/share/types.ts` — and can delete
// what an account deletion has to reach (a project's record, a person's job
// records) and answer the studio's light poll (`projectStamp`). Since slice 22
// a trailer record can be changed safely by two writers (`videos.update`, a
// compare-and-set on `rev`) and an output can be read by byte range
// (`outputs.open(key, range)`), which a phone will not play a video without.
// See `devpost/spec.md > Storage Adapter (v2)`.
//
// The mode is read once, at module load, like `INKDESK_DATA_DIR`: the checks
// set the environment before their first dynamic import.
//
// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { ProviderError } from '../errors'
import { missingCloudEnv, missingCloudSentence, storageMode } from './env'
import { localStore } from './local'
import type { JobRecord, JobStatus } from '../queue/jobs'
import type { ReportRecord, ShareRecord, ShareSnapshot, UserSettings, VideoRecord } from '../share/types'
import type { Project, ProjectSummary } from '../types'

export type BlobKind = 'sheet' | 'panel' | 'cover' | 'asset'

/**
 * One stored image, ready to stream: never held whole in memory (CR-17). A stream opened for a RANGE (slice 22, a
 * video player asking for the middle of a file) carries it as served: `start`/`end` are inclusive byte offsets and
 * `total` the whole object's size, so a route can answer 206 with `Content-Range: bytes start-end/total`; then
 * `bytes` is the length of THIS part (`end - start + 1`). A whole object has no `range`.
 */
export type BlobStream = {
  body: ReadableStream<Uint8Array>
  bytes: number | null
  mediaType: string
  range?: { start: number; end: number; total: number }
}

/** The part of an object a reader asks for: `end` is inclusive, and absent means "to the end" — the two forms of an HTTP `Range: bytes=a-b` / `bytes=a-`. */
export type ByteRange = { start: number; end?: number }

export { RangeNotSatisfiable } from './local'

/** What `/api/health` reports for each outside system: `n/a` where the mode doesn't use it. */
export type Check = 'ok' | 'down' | 'n/a'
export type StoreHealth = { mongo: Check; bucket: Check }

/** Which jobs `listJobs` returns; every field present must match. Newest first. */
export type JobFilter = {
  projectId?: string
  ownerId?: string
  status?: readonly JobStatus[]
  /** Exactly this dedupe key. */
  key?: string
  /** Only jobs changed at or after this ISO time. */
  updatedSince?: string
  /** Only jobs whose limits reservation is still `held` — the reconciler's sweep for ones that ended unsettled (slice 20). */
  reservation?: 'held'
  limit?: number
}

/**
 * The job records (v3, slice 18) — `jobs` in Mongo, `data/jobs/` on a local
 * desk. Every write is one atomic swap that other processes (web, worker) can
 * race against: the transitions themselves are the pure functions in
 * `lib/queue/jobs.ts`; a store only makes them safe to run concurrently.
 */
export interface JobStore {
  /** Writes `job` unless an active (queued or running) job already has its key,
   *  atomically; then `created` is false and `job` is the one that holds the key. */
  insertJob(job: JobRecord): Promise<{ job: JobRecord; created: boolean }>
  getJob(id: string): Promise<JobRecord | null>
  /**
   * Read → `fn` → write only if nothing changed in between, re-running `fn` on
   * the fresher record if something did. `fn` must be pure. It returns the next
   * record, or null to leave the record as it is — then this resolves null,
   * and so it does for a record that doesn't exist. A record that ends (leaves
   * queued/running) gives up its key in the same write.
   */
  updateJob(id: string, fn: (job: JobRecord) => JobRecord | null): Promise<JobRecord | null>
  listJobs(filter?: JobFilter): Promise<JobRecord[]>
  /** Delete jobs that finished before this ISO time; returns how many. */
  pruneJobs(finishedBefore: string): Promise<number>
  /** Delete one job record, whatever its state (account deletion); false if there was none. The key it held is free with it. */
  deleteJob(id: string): Promise<boolean>
  /** Delete every job record the owner has — except `exceptId`, the deletion job that is running this — and say how many (account deletion). */
  deleteJobsOf(ownerId: string, exceptId?: string): Promise<number>
}

/** One account as the app records it (v3, slice 19), written by Clerk's webhook. */
export type UserRecord = {
  /** Clerk's user id. */
  id: string
  email: string
  createdAt: string
  updatedAt: string
  /** Set once the account is deleted; a deleted account is never brought back by a late or replayed event. */
  deletedAt: string | null
}

/** The account records — `users` in Mongo, `data/users/` on a local desk. */
export interface UserStore {
  /** Write the account, or refresh its email. Running it twice is the same as once; a deleted account stays deleted. */
  upsert(user: { id: string; email: string; createdAt: string }): Promise<UserRecord>
  get(id: string): Promise<UserRecord | null>
  /** Mark the account deleted (its email is let go). One never seen is recorded as deleted, so its creation arriving late cannot revive it. */
  markDeleted(id: string): Promise<UserRecord>
}

/**
 * The public shares (v3, slice 21) — `shares` in Mongo, `data/shares/` on a
 * local desk. A share is addressed by its token alone and there is at most one
 * ACTIVE share per project: `create` is the one door that makes it true, so two
 * clicks, two tabs or two instances can never publish a project twice.
 */
export interface ShareStore {
  /** Write `record` unless its project already has an ACTIVE share, atomically (a lock on a local desk, a unique index in Mongo); then `created` is false and `share` is the one that holds the project. A token that is already taken is an error, never an overwrite. */
  create(record: ShareRecord): Promise<{ share: ShareRecord; created: boolean }>
  /** One share by token — a revoked one too (its snapshot is null). Null for an unknown token and for anything that cannot be a token. */
  get(token: string): Promise<ShareRecord | null>
  /** The project's active share, if it has one. */
  activeForProject(projectId: string): Promise<ShareRecord | null>
  /** The owner's active shares, newest first. */
  listActiveOf(ownerId: string): Promise<ShareRecord[]>
  /** Replace the snapshot of an ACTIVE share and stamp `now`; null when the share is unknown or revoked — a revoked token is never brought back. */
  refresh(token: string, snapshot: ShareSnapshot, now: string): Promise<ShareRecord | null>
  /** Revoke: `revokedAt` and `updatedAt` become `now` and the snapshot is dropped, so nothing of the work remains. Idempotent (the first time stands); the revoked record, or null for an unknown token. */
  revoke(token: string, now: string): Promise<ShareRecord | null>
  /** Delete every share the owner has, active or revoked (account deletion); the tokens deleted. */
  deleteAllOf(ownerId: string): Promise<string[]>
}

/** What visitors report about a share — `reports` in Mongo, `data/reports/` on a local desk. */
export interface ReportStore {
  add(report: ReportRecord): Promise<void>
  /** Newest first. `limit` defaults to 200 and is never more than 1000. */
  list(opts?: { limit?: number; unhandledOnly?: boolean }): Promise<ReportRecord[]>
  get(id: string): Promise<ReportRecord | null>
  /** Stamp `handledAt` (the first time stands); the report, or null if there is none. */
  markHandled(id: string, now: string): Promise<ReportRecord | null>
  /** Delete every report about these tokens; how many went. */
  deleteForTokens(tokens: string[]): Promise<number>
}

/** A person's defaults — `settings` in Mongo, `data/settings/` on a local desk. */
export interface SettingsStore {
  get(userId: string): Promise<UserSettings | null>
  put(settings: UserSettings): Promise<void>
  delete(userId: string): Promise<void>
}

/**
 * The trailers (slice 22) — `videos` in Mongo, `data/videos/` on a local desk. One record carries a whole trailer's
 * progress, and two writers change it at once (the worker's four shots, and the web when a person retries one), so
 * every change after the first write goes through `update`.
 */
export interface VideoStore {
  /** Write the record whole: creation, and a lone writer's replacement. It carries its own `rev` (0 where it has none). The worker never uses it — `update` is the only safe way to change a record two writers can reach. */
  put(video: VideoRecord): Promise<void>
  /**
   * Read → `fn` → write only if the record did not change in between, re-running `fn` on the fresher record if it
   * did (`rev` is the compare-and-set counter; a record written before it existed reads as 0). `fn` must be pure.
   * It returns the next record, or null to leave the record as it is — then this resolves null, and so it does for
   * a record that does not exist. Every write bumps `rev`; the id cannot change. Resolves the record as written.
   */
  update(id: string, fn: (video: VideoRecord) => VideoRecord | null): Promise<VideoRecord | null>
  get(id: string): Promise<VideoRecord | null>
  /** Newest first. */
  listOf(ownerId: string): Promise<VideoRecord[]>
  /** Delete one record and hand it back (null if there was none): a refused Confirm leaves no record, and Remove ends one. */
  delete(id: string): Promise<VideoRecord | null>
  /** Delete the owner's video records and hand them back, so the caller can delete the files they name. */
  deleteAllOf(ownerId: string): Promise<VideoRecord[]>
}

/**
 * The outputs store: whatever the studio makes rather than is given — exports,
 * rendered videos. The outputs bucket in cloud mode, `data/outputs/` on a local
 * desk. A key is a path of plain segments (`exports/<owner>/<job>.zip`):
 * letters, digits, `.`, `_` and `-`, no segment empty or starting with a dot,
 * under 512 characters in all — so no key can name a place outside the store.
 * `put` refuses one that does not pass; `open` and `delete` treat it as naming
 * nothing. A PREFIX is a folder: `a/b` and `a/b/` mean the same and reach only
 * keys under it, in both stores.
 */
export interface OutputStore {
  /** `body` is bytes, a stream of them, or the path of a temp file (copied — the caller still owns, and removes, it). A key is written whole or not at all. */
  put(key: string, body: Buffer | AsyncIterable<Uint8Array> | string, mediaType: string): Promise<{ bytes: number }>
  /**
   * The object as a stream, never read whole; null when there is none. With a `range` only those bytes are read
   * (`end` past the last byte is cut back to it, as HTTP does); a range that starts at or after the end — or on an
   * empty object — throws `RangeNotSatisfiable`, which carries the object's size so the route can answer 416.
   */
  open(key: string, range?: ByteRange): Promise<BlobStream | null>
  /** A missing key is not an error. */
  delete(key: string): Promise<void>
  /** Delete everything under the folder `prefix` (never an empty one); how many objects went. */
  deletePrefix(prefix: string): Promise<number>
  /** Everything under the folder `prefix` (empty means all), by key. */
  list(prefix: string): Promise<{ key: string; bytes: number; modifiedAt: string }[]>
}

/** A project and whose it is, for `scripts/claim-projects.mts` only — never a listing anyone sees. */
export type ProjectOwner = { id: string; title: string; ownerId: string | null }

/** What `claimProject` did: gave the project its owner, or found it already theirs. */
export type Claim = 'claimed' | 'already-theirs'

export interface Store {
  /** The caller's projects, newest first — a project with no owner counts as
   *  `local`. On a desk without accounts, runs the one-time v1 migration first. */
  listProjects(ownerId: string): Promise<ProjectSummary[]>
  /** The one-time v1 migration on its own: the project it made, or the
   *  sentence that says why the v1 file was left alone. Nulls when there is
   *  nothing to migrate. */
  migrateLegacy(): Promise<{ projectId: string | null; problem: string | null }>
  readProject(id: string): Promise<Project>
  /** Refuses if the id exists. The project's `ownerId` is whatever the caller set. */
  createProject(project: Project): Promise<void>
  /** Read → `fn` → write, serialized per project, atomic on disk. `fn` cannot change the id or the owner. */
  updateProject(id: string, fn: (project: Project) => Project): Promise<Project>
  /** Every project and its owner — for the claim script. */
  projectOwners(): Promise<ProjectOwner[]>
  /** Whose one project is, from whatever of it can still be read (`local` when nothing names an owner); null when there is no such project. For `ownedProject`'s answer to a project that can't be read. */
  projectOwner(id: string): Promise<string | null>
  /** Give a project with no owner (or `local`) to `ownerId`; refuses a project someone else owns. */
  claimProject(id: string, ownerId: string): Promise<Claim>
  /** Remove the project's record — its document or its folder — and only that: the pictures are the caller's to delete first (`projectImageIds`). A project that is not there is already gone. */
  deleteProject(id: string): Promise<void>
  /**
   * When a project last changed and whose it is, read without the project
   * itself (a projection in Mongo) — what the studio's light poll asks (CR-8).
   * `ownerId` is the owner the project states, `local` where it states none
   * (the same answer as `projectOwner`); a project that cannot be read still
   * answers, dated by its last write. Null when there is no such project.
   */
  projectStamp(id: string): Promise<{ ownerId: string; updatedAt: string } | null>
  /** The ids of every project `ownerId` owns — the unreadable ones too, which `listProjects` shows as a card but this lists as plain ids; account deletion must not skip a damaged project. Sorted by id. */
  projectsOf(ownerId: string): Promise<{ id: string }[]>
  /** Store one image; returns its id, `<kind>-<uuid>.<ext>`, extension from the media type. */
  putBlob(bytes: Buffer, mediaType: string, kind: BlobKind): Promise<string>
  getBlob(id: string): Promise<{ bytes: Buffer; mediaType: string } | null>
  /** The same image as a stream, for the image route; null if there is no such image. */
  openBlob(id: string): Promise<BlobStream | null>
  /** Remove one stored image; a missing one is not an error (CR-16: an orphan is cleaned up, a dropped version is let go). */
  deleteBlob(id: string): Promise<void>
  /** The job records. */
  jobs: JobStore
  /** The account records. */
  users: UserStore
  /** The public shares. */
  shares: ShareStore
  /** What visitors report about them. */
  reports: ReportStore
  /** A person's defaults. */
  settings: SettingsStore
  /** The trailers. */
  videos: VideoStore
  /** Exports and rendered videos. */
  outputs: OutputStore
  /** Is everything this mode needs reachable, each answer within `timeoutMs`? Never throws. */
  health(timeoutMs: number): Promise<StoreHealth>
}

function refusing(sentence: string): Store {
  const refuse = () => Promise.reject(new ProviderError(sentence, 'config'))
  return {
    listProjects: refuse,
    migrateLegacy: refuse,
    readProject: refuse,
    createProject: refuse,
    updateProject: refuse,
    projectOwners: refuse,
    projectOwner: refuse,
    claimProject: refuse,
    deleteProject: refuse,
    projectStamp: refuse,
    projectsOf: refuse,
    putBlob: refuse,
    getBlob: refuse,
    openBlob: refuse,
    deleteBlob: refuse,
    jobs: { insertJob: refuse, getJob: refuse, updateJob: refuse, listJobs: refuse, pruneJobs: refuse, deleteJob: refuse, deleteJobsOf: refuse },
    users: { upsert: refuse, get: refuse, markDeleted: refuse },
    shares: { create: refuse, get: refuse, activeForProject: refuse, listActiveOf: refuse, refresh: refuse, revoke: refuse, deleteAllOf: refuse },
    reports: { add: refuse, list: refuse, get: refuse, markHandled: refuse, deleteForTokens: refuse },
    settings: { get: refuse, put: refuse, delete: refuse },
    videos: { delete: refuse, put: refuse, update: refuse, get: refuse, listOf: refuse, deleteAllOf: refuse },
    outputs: { put: refuse, open: refuse, delete: refuse, deletePrefix: refuse, list: refuse },
    health: async () => ({ mongo: 'down', bucket: 'down' }),
  }
}

/** The cloud store behind a dynamic import: `mongodb` and the S3 client load on the first call. */
function lazyCloud(): Store {
  const load = () => import('./cloud').then((m) => m.cloudStore)
  return {
    listProjects: async (ownerId) => (await load()).listProjects(ownerId),
    migrateLegacy: async () => (await load()).migrateLegacy(),
    readProject: async (id) => (await load()).readProject(id),
    createProject: async (project) => (await load()).createProject(project),
    updateProject: async (id, fn) => (await load()).updateProject(id, fn),
    projectOwners: async () => (await load()).projectOwners(),
    projectOwner: async (id) => (await load()).projectOwner(id),
    claimProject: async (id, ownerId) => (await load()).claimProject(id, ownerId),
    deleteProject: async (id) => (await load()).deleteProject(id),
    projectStamp: async (id) => (await load()).projectStamp(id),
    projectsOf: async (ownerId) => (await load()).projectsOf(ownerId),
    putBlob: async (bytes, mediaType, kind) => (await load()).putBlob(bytes, mediaType, kind),
    getBlob: async (id) => (await load()).getBlob(id),
    openBlob: async (id) => (await load()).openBlob(id),
    deleteBlob: async (id) => (await load()).deleteBlob(id),
    jobs: {
      insertJob: async (job) => (await load()).jobs.insertJob(job),
      getJob: async (id) => (await load()).jobs.getJob(id),
      updateJob: async (id, fn) => (await load()).jobs.updateJob(id, fn),
      listJobs: async (filter) => (await load()).jobs.listJobs(filter),
      pruneJobs: async (before) => (await load()).jobs.pruneJobs(before),
      deleteJob: async (id) => (await load()).jobs.deleteJob(id),
      deleteJobsOf: async (ownerId, exceptId) => (await load()).jobs.deleteJobsOf(ownerId, exceptId),
    },
    users: {
      upsert: async (user) => (await load()).users.upsert(user),
      get: async (id) => (await load()).users.get(id),
      markDeleted: async (id) => (await load()).users.markDeleted(id),
    },
    shares: {
      create: async (record) => (await load()).shares.create(record),
      get: async (token) => (await load()).shares.get(token),
      activeForProject: async (projectId) => (await load()).shares.activeForProject(projectId),
      listActiveOf: async (ownerId) => (await load()).shares.listActiveOf(ownerId),
      refresh: async (token, snapshot, now) => (await load()).shares.refresh(token, snapshot, now),
      revoke: async (token, now) => (await load()).shares.revoke(token, now),
      deleteAllOf: async (ownerId) => (await load()).shares.deleteAllOf(ownerId),
    },
    reports: {
      add: async (report) => (await load()).reports.add(report),
      list: async (opts) => (await load()).reports.list(opts),
      get: async (id) => (await load()).reports.get(id),
      markHandled: async (id, now) => (await load()).reports.markHandled(id, now),
      deleteForTokens: async (tokens) => (await load()).reports.deleteForTokens(tokens),
    },
    settings: {
      get: async (userId) => (await load()).settings.get(userId),
      put: async (settings) => (await load()).settings.put(settings),
      delete: async (userId) => (await load()).settings.delete(userId),
    },
    videos: {
      put: async (video) => (await load()).videos.put(video),
      delete: async (id) => (await load()).videos.delete(id),
      update: async (id, fn) => (await load()).videos.update(id, fn),
      get: async (id) => (await load()).videos.get(id),
      listOf: async (ownerId) => (await load()).videos.listOf(ownerId),
      deleteAllOf: async (ownerId) => (await load()).videos.deleteAllOf(ownerId),
    },
    outputs: {
      put: async (key, body, mediaType) => (await load()).outputs.put(key, body, mediaType),
      open: async (key, range) => (await load()).outputs.open(key, range),
      delete: async (key) => (await load()).outputs.delete(key),
      deletePrefix: async (prefix) => (await load()).outputs.deletePrefix(prefix),
      list: async (prefix) => (await load()).outputs.list(prefix),
    },
    health: async (timeoutMs) => (await load()).health(timeoutMs),
  }
}

function choose(): Store {
  if (storageMode() === 'local') return localStore
  const missing = missingCloudEnv()
  return missing.length > 0 ? refusing(missingCloudSentence(missing)) : lazyCloud()
}

export const store: Store = choose()
