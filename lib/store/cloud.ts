// The cloud store (slice 13): the same interface as `local.ts`, on MongoDB
// for project state and an S3-compatible bucket (AWS S3, Cloudflare R2,
// MinIO) for every image. Selected by `INKDESK_STORAGE=cloud`; loaded only
// then, so a local desk never pulls in either driver.
//
//   MongoDB  <database>.projects   { _id: <project id>, rev: n, project: Project }
//   MongoDB  <database>.jobs       { _id: <job id>, rev: n, activeKey?: <key>, ...the job's fields } (v3, slice 18)
//   MongoDB  <database>.users      { _id: <Clerk user id>, email, createdAt, updatedAt, deletedAt } (v3, slice 19)
//   MongoDB  <database>.shares     { _id: <token>, activeProject?: <project id>, ...the share's fields } (v3, slice 21)
//   MongoDB  <database>.reports    { _id: <uuid>, token, reason, note, ipHash, at, handledAt } (v3, slice 21)
//   MongoDB  <database>.settings   { _id: <Clerk user id>, defaultStyle, readingDirection, voices?, updatedAt } (v3, slice 21)
//   MongoDB  <database>.videos     { _id: <video id>, ownerId, projectId, ...the video's fields } (v3, slice 21; slice 22 fills it)
//   bucket   <project-files bucket>/<prefix><kind>-<uuid>.<ext>   the same ids the local store writes,
//            under S3_KEY_PREFIX (default `inkdesk/`), never at the bucket's root (SEC-13)
//   bucket   <outputs bucket>/<prefix>outputs/<key>   exports and rendered videos (v3, slice 21); the `outputs/`
//            folder keeps an output key from ever being an image id or the bucket probe, whichever bucket it shares
//
// The settings come from `lib/config.ts`, which maps the learner's names
// (DB_URL, DB_DATABASE, S3_BUCKET_PROJECT_FILES, S3_BUCKET_COMPILE_OUTPUTS)
// onto what this file needs. Images and uploads go to the project-files
// bucket; the outputs bucket holds exports and rendered videos (`store.outputs`,
// since slice 21). Every MongoDB and S3 call has a timeout (CR-6),
// and so does every object body after its headers: a hung socket ends in the
// calm sentence, never a hang.
//
// The same two guarantees as the local store, by other means
// (`devpost/spec.md > Storage Adapter (v2)`):
//   1. No torn writes  — one document per project, replaced whole.
//   2. No lost updates — `updateProject()` is read → `fn` → write only if
//      `rev` is still the one read, with `rev` bumped in the same operation.
//      A mismatch means another writer got there first: re-read and run `fn`
//      again on the fresh project, a bounded number of times with a jittered
//      pause, then a calm failure. Since slice 18 the web service and the
//      worker both write the database, so this compare-and-set IS the guard;
//      the per-project promise chain in a process only keeps its own writers
//      from racing each other — a contention reducer, and nothing depends on
//      it. The job records (`jobs`) follow the same rule, plus a unique sparse
//      index on `activeKey` so two racing inserts for one key cannot both win.
//      The shares (slice 21) use the same trick for "one active share per
//      project": `activeProject` is on a share only while it is active, under a
//      unique sparse index, so the database itself decides a race between two
//      creates — and revoking removes the field in the same write that marks it.
//
// The browser still only ever sees `/api/projects/<id>/image/<imageId>` (owner
// checked, slice 19); the bucket is never public.

// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { MongoClient, MongoNetworkError, MongoServerError, MongoServerSelectionError, type Collection, type Db, type Filter, type MongoClientOptions } from 'mongodb'
import { ConfigError, cloudSettings, type CloudSettings } from '../config'
import { ProviderError, Refused } from '../errors'
import { BUSY, LOCAL_OWNER, isActive, type JobRecord } from '../queue/jobs'
import type { ReportRecord, ShareRecord, UserSettings, VideoRecord } from '../share/types'
import { singletons } from '../singleton'
import type { Project, ProjectSummary } from '../types'
import { missingCloudEnv, missingCloudSentence } from './env'
import {
  JOB_LIST_LIMIT,
  NOT_A_USER,
  OWNED_BY_ANOTHER,
  claimable,
  deleted,
  isImageId,
  isOutputKey,
  isProjectId,
  isRecordId,
  isShareToken,
  isUserId,
  keepOwner,
  mediaTypeOf,
  outputMediaType,
  projectProblem,
  reportLimit,
  requireOutputFolder,
  summarize,
  unreadableProject,
  unreadableSummary,
  upserted,
} from './local'
import type {
  BlobKind,
  BlobStream,
  Check,
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

export type ProjectDoc = { _id: string; rev: number; project: Project }

/** A job as stored: its record without `id` (that is `_id`), a `rev`, and `activeKey` — the job's key while it is queued or running, ABSENT once it ends. */
export type JobDoc = { _id: string; rev: number; activeKey?: string } & Omit<JobRecord, 'id'>

/** An account as stored: its record, with the id as `_id`. */
export type UserDoc = { _id: string } & Omit<UserRecord, 'id'>

/** A share as stored: its record with the token as `_id`, and `activeProject` — the project's id while the share is ACTIVE, ABSENT once it is revoked (and for a video share). */
export type ShareDoc = { _id: string; activeProject?: string } & Omit<ShareRecord, 'token'>

/** A report as stored: its record, with the id as `_id`. */
export type ReportDoc = { _id: string } & Omit<ReportRecord, 'id'>

/** A person's defaults as stored: with the user id as `_id`. */
export type SettingsDoc = { _id: string } & Omit<UserSettings, 'userId'>

/** A video as stored: its record, with the id as `_id`. */
export type VideoDoc = { _id: string } & Omit<VideoRecord, 'id'>

type Cloud = {
  client: MongoClient
  projects: Collection<ProjectDoc>
  jobs: Collection<JobDoc>
  users: Collection<UserDoc>
  shares: Collection<ShareDoc>
  reports: Collection<ReportDoc>
  settings: Collection<SettingsDoc>
  videos: Collection<VideoDoc>
  s3: S3Client
  /** Images and uploads. */
  bucket: string
  /** Exports and rendered videos (`store.outputs`). */
  outputsBucket: string
  /** Every key starts with this; an image id never carries a slash, so no id reaches outside it. */
  prefix: string
}

/** How many times one update re-reads after losing a race to another writer. Two writers (web, worker) plus a polling GET must not exhaust it. */
export const MAX_UPDATE_ATTEMPTS = 8

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

// --- Connection -----------------------------------------------------------------

// --- Timeouts (CR-6) --------------------------------------------------------------

/** MongoDB: finding the server, opening a socket, and any one read on it. A URI's own values win. */
export const MONGO_TIMEOUTS = { serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000, socketTimeoutMS: 30_000 } as const

/** S3: opening the connection, the whole request, and an idle socket. */
export const S3_TIMEOUTS = { connectionTimeout: 5_000, requestTimeout: 30_000, socketTimeout: 30_000 } as const

/**
 * An object's body that stops arriving ends in an error after `idleMs` with no
 * new bytes, and the socket is let go (CR-6). The SDK's own timers stop once
 * the headers are in, so without this a bucket that sends its headers and then
 * stalls would hold a queue slot, or a browser request, forever. Pull-based:
 * a slow reader downstream is never mistaken for a stalled bucket.
 */
export function idleLimited(body: ReadableStream<Uint8Array>, idleMs: number = S3_TIMEOUTS.socketTimeout): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`the bucket sent nothing for ${idleMs} ms`), { name: 'TimeoutError' })), idleMs)
      })
      try {
        const { done, value } = await Promise.race([reader.read(), stalled])
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (err) {
        // Cancelling the source destroys the response, and with it the socket.
        reader.cancel(err).catch(() => {})
        controller.error(err)
      } finally {
        clearTimeout(timer)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/** The client options, leaving out any timeout the URI already chooses. */
export function mongoOptions(uri: string): MongoClientOptions {
  const timeouts = Object.fromEntries(Object.entries(MONGO_TIMEOUTS).filter(([name]) => !new RegExp(`[?&]${name}=`, 'i').test(uri)))
  // An absent field stays absent, as it does in the JSON file —
  // `bubble: undefined` and `bubble: null` mean different things.
  return { ignoreUndefined: true, ...timeouts }
}

/** An S3 client on these settings, every request bounded in time. */
export function s3Client(
  settings: Pick<CloudSettings, 'endpoint' | 'region' | 'accessKeyId' | 'secretAccessKey' | 'forcePathStyle'>,
  timeouts: { connectionTimeout: number; requestTimeout: number; socketTimeout: number } = S3_TIMEOUTS
): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    // Path-style (`<endpoint>/<bucket>/<key>`) is what R2 and MinIO expect and
    // AWS still accepts; S3_FORCE_PATH_STYLE=false for a virtual-host-only provider.
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // Without these the SDK waits forever on a half-open socket.
    requestHandler: { ...timeouts, throwOnRequestTimeout: true },
    maxAttempts: 3,
  })
}

/** The object every connect writes, under the key prefix: proves the bucket,
 *  the endpoint and the keys with the one permission the studio needs anyway.
 *  Never an image id (`.txt`), so no image route can ever serve it. */
export const BUCKET_PROBE_KEY = 'inkdesk-bucket-check.txt'

const MONGO_UNREACHABLE =
  'The studio couldn’t reach its MongoDB. Check MONGODB_URI (or DB_URL) and that the database lets this machine in, then reload.'
const MONGO_REFUSED =
  'The studio reached its MongoDB, but that user can’t read and write the MONGODB_DB (or DB_DATABASE) database. Give the user readWrite on it, then reload.'
const BUCKET_UNREACHABLE =
  'The studio couldn’t write to its bucket. Check S3_ENDPOINT, S3_REGION, S3_BUCKET_PROJECT_FILES (or S3_BUCKET) and the S3 keys (and that the bucket exists), then reload.'

type Pending = { settings: string; cloud: Promise<Cloud> }

// On `globalThis` for the same reason as the locks (`lib/singleton.ts`): a hot
// reload re-evaluates this module, and a client per reload would leak
// connection pools until Atlas refuses new ones. Keyed by the settings, so an
// edited `.env` under a running dev server reconnects instead of writing on to
// the old database or bucket.
const g = globalThis as typeof globalThis & { __inkdeskCloud?: Pending }

/**
 * What a failed connect leaves behind is plain data, not a `ProviderError`:
 * the pending connection is shared by every route, and Next compiles
 * `lib/errors.ts` once per layer, so a class made in one layer would fail
 * `instanceof` in another. Each caller turns it into its own layer's error.
 */
function unreachable(which: 'mongo' | 'mongo-refused' | 'bucket', cause: unknown): Error {
  return Object.assign(new Error(`cloud storage: ${which} unreachable`), { unreachable: which, cause })
}

function asProviderError(err: unknown): unknown {
  const which = (err as { unreachable?: string } | null)?.unreachable
  const sentence = which === 'mongo' ? MONGO_UNREACHABLE : which === 'mongo-refused' ? MONGO_REFUSED : which === 'bucket' ? BUCKET_UNREACHABLE : null
  // `unreachable` rides along, so the health check can tell which half failed.
  return sentence ? Object.assign(new ProviderError(sentence, 'config', (err as Error).cause), { unreachable: which }) : err
}

/** The mapped settings, or the config sentence naming what is missing or malformed. */
function settingsOrRefuse(): CloudSettings {
  const missing = missingCloudEnv()
  if (missing.length > 0) throw new ProviderError(missingCloudSentence(missing), 'config')
  try {
    return cloudSettings()
  } catch (err) {
    if (err instanceof ConfigError) throw new ProviderError(err.message, 'config')
    throw err
  }
}

async function cloud(): Promise<Cloud> {
  const current = settingsOrRefuse()
  // Kept in memory only, never printed: it carries the credentials.
  const settings = JSON.stringify(current)
  let entry = g.__inkdeskCloud
  if (entry?.settings !== settings) {
    const retired = entry
    const pending = connect(current)
    entry = { settings, cloud: pending }
    g.__inkdeskCloud = entry
    pending.catch(() => {
      if (g.__inkdeskCloud?.cloud === pending) g.__inkdeskCloud = undefined // the next request tries again
    })
    if (retired) void retired.cloud.then(close, () => {})
  }
  try {
    return await entry.cloud
  } catch (err) {
    throw asProviderError(err)
  }
}

/** The host part of a MongoDB URI — everything after the last `@`, so no
 *  part of a password (even one with an unescaped `/`) is ever printed. */
export function mongoHost(uri: string): string {
  const rest = uri.replace(/^[a-z+]+:\/\//i, '')
  return rest.slice(rest.lastIndexOf('@') + 1).split(/[/?]/)[0]
}

/** Where the connection points, for the terminal: hosts and names, never credentials. */
function describe(settings: CloudSettings): string {
  let bucketHost = settings.endpoint
  try {
    bucketHost = new URL(settings.endpoint).host
  } catch {}
  const outputs = settings.outputsBucket === settings.projectFilesBucket ? '' : `, outputs “${settings.outputsBucket}”`
  return `MongoDB “${settings.mongoDb}” on ${mongoHost(settings.mongoUrl)} · bucket “${settings.projectFilesBucket}”${outputs} under ${settings.keyPrefix} at ${bucketHost}`
}

/** The listing's sort, indexed so the dashboard never scans the collection. */
const UPDATED_INDEX = { 'project.updatedAt': -1 } as const

/** The dashboard's query since slice 19 — one owner's projects, newest first — served by one index (SEC-12). */
const OWNER_INDEX = { 'project.ownerId': 1, 'project.updatedAt': -1 } as const

/**
 * The projects `ownerId` owns. A project written before accounts has no owner
 * and counts as `local`'s; `$in` with null matches a missing field, so the
 * owner index still serves it.
 */
export function ownerFilter(ownerId: string): Filter<ProjectDoc> {
  return ownerId === LOCAL_OWNER ? { 'project.ownerId': { $in: [LOCAL_OWNER, null] } } : { 'project.ownerId': ownerId }
}

/**
 * The `jobs` indexes, made once per connection and idempotent. The unique
 * sparse `activeKey` is what lets two racing inserts for one key have exactly
 * one winner; the rest serve the listings. A failure is logged, not fatal: a
 * user without createIndex still gets a working desk (but see the warning —
 * without the unique index, a double click can queue twice).
 */
async function ensureJobIndexes(db: Db): Promise<void> {
  const jobs = db.collection<JobDoc>('jobs')
  const indexes = [
    { key: { activeKey: 1 }, options: { unique: true, sparse: true, name: 'activeKey_unique_sparse' } },
    { key: { ownerId: 1, status: 1 }, options: { name: 'ownerId_status' } },
    { key: { projectId: 1, status: 1 }, options: { name: 'projectId_status' } },
    { key: { status: 1, updatedAt: 1 }, options: { name: 'status_updatedAt' } },
    // The reconciler's sweep for ended jobs whose reservation was never settled (slice 20).
    { key: { reservation: 1, status: 1 }, options: { name: 'reservation_status' } },
  ] as const
  await Promise.all(
    indexes.map(({ key, options }) =>
      jobs.createIndex({ ...key }, { ...options }).catch((err: unknown) => console.warn(`[store] the jobs index ${options.name} couldn’t be created:`, err instanceof Error ? err.message : err))
    )
  )
}

/**
 * The indexes of slice 21's collections, made once per connection and
 * idempotent, a failure logged and not fatal like the jobs'. The unique sparse
 * `activeProject` is what makes "one active share per project" a fact of the
 * database: the index keeps only documents that HAVE the field, and a share has
 * it only while it is active (a partial index on `revokedAt: null` would say the
 * same, but equality with null is not a form partial indexes promise to
 * support; a field that is simply absent is, and `activeKey` has worked this
 * way since slice 18).
 */
async function ensureShareIndexes(db: Db): Promise<void> {
  const shares = db.collection<ShareDoc>('shares')
  const reports = db.collection<ReportDoc>('reports')
  const videos = db.collection<VideoDoc>('videos')
  const made: { name: string; make: () => Promise<unknown> }[] = [
    { name: 'shares.activeProject_unique_sparse', make: () => shares.createIndex({ activeProject: 1 }, { unique: true, sparse: true, name: 'activeProject_unique_sparse' }) },
    { name: 'shares.ownerId_revokedAt_createdAt', make: () => shares.createIndex({ ownerId: 1, revokedAt: 1, createdAt: -1 }, { name: 'ownerId_revokedAt_createdAt' }) },
    { name: 'reports.at', make: () => reports.createIndex({ at: -1 }, { name: 'at' }) },
    { name: 'reports.token', make: () => reports.createIndex({ token: 1 }, { name: 'token' }) },
    { name: 'videos.ownerId_createdAt', make: () => videos.createIndex({ ownerId: 1, createdAt: -1 }, { name: 'ownerId_createdAt' }) },
  ]
  await Promise.all(made.map(({ name, make }) => make().catch((err: unknown) => console.warn(`[store] the index ${name} couldn’t be created:`, err instanceof Error ? err.message : err))))
}

async function connect(settings: CloudSettings): Promise<Cloud> {
  let client: MongoClient | undefined
  try {
    // Inside the try: a malformed URI throws from the constructor. The URI
    // itself is never repeated anywhere — it carries the password.
    client = new MongoClient(settings.mongoUrl, mongoOptions(settings.mongoUrl))
    await client.connect()
    await client.db(settings.mongoDb).command({ ping: 1 })
  } catch (err) {
    await client?.close().catch(() => {})
    throw unreachable('mongo', err)
  }
  try {
    // A ping needs no privileges. A read and a write do — and a user with
    // rights on some other database is a common Atlas mistake, found here
    // rather than by the write after a paid image.
    const db = client.db(settings.mongoDb)
    await db.collection<ProjectDoc>('projects').findOne({ _id: '' }, { projection: { _id: 1 } })
    await db.collection<{ _id: string; at: string }>('connect_check').updateOne({ _id: 'last' }, { $set: { at: new Date().toISOString() } }, { upsert: true })
  } catch (err) {
    await client.close().catch(() => {})
    throw unreachable(isRefusal(err) ? 'mongo-refused' : 'mongo', err)
  }
  // Idempotent; a user without createIndex still gets a working (slower) desk.
  await client
    .db(settings.mongoDb)
    .collection<ProjectDoc>('projects')
    .createIndex(UPDATED_INDEX)
    .catch((err: unknown) => console.warn('[store] the listing index couldn’t be created:', err instanceof Error ? err.message : err))
  await client
    .db(settings.mongoDb)
    .collection<ProjectDoc>('projects')
    .createIndex(OWNER_INDEX, { name: 'owner_updatedAt' })
    .catch((err: unknown) => console.warn('[store] the owner index couldn’t be created:', err instanceof Error ? err.message : err))
  await ensureJobIndexes(client.db(settings.mongoDb))
  await ensureShareIndexes(client.db(settings.mongoDb))
  const s3 = s3Client(settings)
  const bucket = settings.projectFilesBucket
  const probeKey = settings.keyPrefix + BUCKET_PROBE_KEY
  try {
    // A wrong bucket or key found here costs nothing; found by `putBlob`, it
    // would be found after an image was already paid for. A write, not
    // HeadBucket: that needs ListBucket, which a bucket-scoped key may lack.
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: probeKey, Body: 'Ink Desk keeps its images in this bucket.\n', ContentType: 'text/plain' }))
    // And back: a key that can write but not read would store every image
    // and serve none.
    const probe = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: probeKey }))
    // Read to the end, so the socket goes back to the pool — bounded, or a
    // stalled bucket would hold every request waiting on this connect.
    if (probe.Body) await new Response(idleLimited(probe.Body.transformToWebStream() as ReadableStream<Uint8Array>)).arrayBuffer()
  } catch (err) {
    s3.destroy()
    await client.close().catch(() => {})
    throw unreachable('bucket', err)
  }
  console.log(`[store] cloud: ${describe(settings)}`)
  return {
    client,
    projects: client.db(settings.mongoDb).collection<ProjectDoc>('projects'),
    jobs: client.db(settings.mongoDb).collection<JobDoc>('jobs'),
    users: client.db(settings.mongoDb).collection<UserDoc>('users'),
    shares: client.db(settings.mongoDb).collection<ShareDoc>('shares'),
    reports: client.db(settings.mongoDb).collection<ReportDoc>('reports'),
    settings: client.db(settings.mongoDb).collection<SettingsDoc>('settings'),
    videos: client.db(settings.mongoDb).collection<VideoDoc>('videos'),
    s3,
    bucket,
    outputsBucket: settings.outputsBucket,
    prefix: settings.keyPrefix,
  }
}

/** Both buckets and the key prefix, as the store uses them — for the scripts and the slices that write outputs. */
export async function cloudBuckets(): Promise<{ projectFiles: string; outputs: string; prefix: string }> {
  const { bucket, outputsBucket, prefix } = await cloud()
  return { projectFiles: bucket, outputs: outputsBucket, prefix }
}

async function close(c: Cloud): Promise<void> {
  c.s3.destroy()
  await c.client.close().catch(() => {})
}

/** Close the connection — for the checks, which must exit when they finish. */
export async function closeCloud(): Promise<void> {
  const entry = g.__inkdeskCloud
  g.__inkdeskCloud = undefined
  const c = await entry?.cloud.catch(() => null)
  if (c) await close(c)
}

/**
 * One MongoDB operation. A connection lost after a good start (Atlas down,
 * this machine's address dropped from the allowlist) is the same calm
 * sentence as one that never came up, not a raw driver error on the desk.
 */
/** Unauthorized (13), or Atlas's own refusal (8000) — a role problem, not an outage. */
export function isRefusal(err: unknown): boolean {
  return err instanceof MongoServerError && (err.code === 13 || err.code === 8000)
}

async function mongoCall<T>(op: (c: Cloud) => Promise<T>): Promise<T> {
  const c = await cloud()
  try {
    return await op(c)
  } catch (err) {
    if (err instanceof MongoNetworkError || err instanceof MongoServerSelectionError) {
      throw new ProviderError(MONGO_UNREACHABLE, 'config', err)
    }
    if (isRefusal(err)) throw new ProviderError(MONGO_REFUSED, 'config', err)
    throw err
  }
}

function mongo<T>(op: (projects: Collection<ProjectDoc>) => Promise<T>): Promise<T> {
  return mongoCall((c) => op(c.projects))
}

function mongoJobs<T>(op: (jobs: Collection<JobDoc>) => Promise<T>): Promise<T> {
  return mongoCall((c) => op(c.jobs))
}

function mongoUsers<T>(op: (users: Collection<UserDoc>) => Promise<T>): Promise<T> {
  return mongoCall((c) => op(c.users))
}

function mongoShares<T>(op: (shares: Collection<ShareDoc>) => Promise<T>): Promise<T> {
  return mongoCall((c) => op(c.shares))
}

function mongoReports<T>(op: (reports: Collection<ReportDoc>) => Promise<T>): Promise<T> {
  return mongoCall((c) => op(c.reports))
}

function mongoSettings<T>(op: (settings: Collection<SettingsDoc>) => Promise<T>): Promise<T> {
  return mongoCall((c) => op(c.settings))
}

function mongoVideos<T>(op: (videos: Collection<VideoDoc>) => Promise<T>): Promise<T> {
  return mongoCall((c) => op(c.videos))
}

// --- Projects -------------------------------------------------------------------

function noSuchProject(): Refused {
  return new Refused('There is no such project.', 404)
}

/** What lands in MongoDB is exactly what the local store would write to disk (no `undefined`, no class instances). */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** The document's project, or the calm 500 for one that can't be read (CR-14). */
function checked(doc: ProjectDoc): Project {
  const problem = projectProblem(doc.project)
  if (problem) throw unreadableProject(doc._id, problem)
  return doc.project
}

async function readProject(id: string): Promise<Project> {
  if (!isProjectId(id)) throw noSuchProject()
  const doc = await mongo((projects) => projects.findOne({ _id: id }))
  if (!doc) throw noSuchProject()
  return checked(doc)
}

async function createProject(project: Project): Promise<void> {
  if (!isProjectId(project.id)) throw noSuchProject()
  try {
    await mongo((projects) => projects.insertOne({ _id: project.id, rev: 0, project: plain({ ...project, serverRunId: singletons.serverRunId }) }))
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) throw new Refused('That project already exists.')
    throw err
  }
}

/** The two collection calls an update needs — narrow, so `check:store` can drive a lost race on purpose. */
export type RevCollection = {
  findOne(filter: { _id: string }): Promise<ProjectDoc | null>
  findOneAndUpdate(
    filter: { _id: string; rev: number },
    update: { $set: { project: Project }; $inc: { rev: 1 } },
    options: { projection: { _id: 1 } }
  ): Promise<unknown>
}

/** A jittered pause that grows with each lost race: step aside, then start again from what the winner wrote. */
const jitteredPause = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 30 * attempt)))

/**
 * Optimistic concurrency, whatever the document: `once` reads, computes and
 * tries the compare-and-set, answering `{ won: false }` when `rev` had moved.
 * A lost race pauses (jittered, growing) and starts again from what the other
 * writer left, up to `MAX_UPDATE_ATTEMPTS` times, then a calm failure. This is
 * the guard between the web service and the worker — nothing else is.
 */
async function casLoop<R>(
  once: () => Promise<{ won: true; value: R } | { won: false }>,
  busy: { sentence: string; what: string; whom: string },
  pause: (attempt: number) => Promise<void>
): Promise<R> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await once()
    if (outcome.won) return outcome.value
    if (attempt >= MAX_UPDATE_ATTEMPTS) {
      throw new ProviderError(busy.sentence, 'provider', `${busy.what}: rev moved under ${MAX_UPDATE_ATTEMPTS} attempts in a row — another process is writing this ${busy.whom}`)
    }
    await pause(attempt)
  }
}

/**
 * One update with optimistic concurrency: read → `fn` → write only if `rev`
 * hasn't moved. A lost race re-reads and runs `fn` again on what the other
 * writer left, up to `MAX_UPDATE_ATTEMPTS` times, then a calm failure.
 */
export async function revUpdate(
  projects: RevCollection,
  id: string,
  fn: (project: Project) => Project,
  pause: (attempt: number) => Promise<void> = jitteredPause
): Promise<Project> {
  return casLoop<Project>(
    async () => {
      const doc = await projects.findOne({ _id: id }) // fresh read, inside the lock
      if (!doc) throw noSuchProject()
      const current = checked(doc)
      const next = plain({
        ...keepOwner(fn(current), current), // the owner is set once, at creation
        id, // the id is the document's key; a change here would be a different project
        serverRunId: singletons.serverRunId,
        updatedAt: new Date().toISOString(),
      })
      const won = await projects.findOneAndUpdate(
        { _id: id, rev: doc.rev },
        { $set: { project: next }, $inc: { rev: 1 } },
        { projection: { _id: 1 } }
      )
      return won ? { won: true, value: next } : { won: false }
    },
    { sentence: 'The desk is busy with another change to this project.', what: `projects/${id}`, whom: 'project' },
    pause
  )
}

/**
 * Run `run` after whatever this process is already doing for `key`. Only a
 * contention reducer — the `rev` compare-and-set is the guard, so a writer in
 * another process, or a cleared chain, is still correct. With `keep` false the
 * entry is dropped once it is the tail and settled, so a long-lived process
 * does not collect one per job (projects are few; their entries stay).
 */
function inProcess<T>(key: string, run: () => Promise<T>, keep = true): Promise<T> {
  const previous = singletons.locks.get(key) ?? Promise.resolve()
  // `.then(run, run)` so one failed update doesn't block the next.
  const result = previous.then(run, run)
  const tail = result.catch(() => {})
  singletons.locks.set(key, tail)
  if (!keep)
    void tail.then(() => {
      if (singletons.locks.get(key) === tail) singletons.locks.delete(key)
    })
  return result
}

/**
 * Apply one change to a project and persist it — the same contract as the
 * local store: `fn` receives the freshest project and returns the next one,
 * and must be pure, because a lost race runs it again on a fresher project.
 * Throwing inside `fn` rejects this call and writes nothing.
 */
function updateProject(id: string, fn: (project: Project) => Project): Promise<Project> {
  // Validated before the lock map is touched, so a garbage id is a 404 and
  // never a lock entry.
  if (!isProjectId(id)) return Promise.reject(noSuchProject())
  return inProcess(id, () => mongo((projects) => revUpdate(projects, id, fn)))
}

/**
 * Only the fields `summarize()` reads (CR-12, SEC-12): a dashboard load never
 * pulls a scenario, a plan or a panel's dialogue out of the database. Arrays
 * keep their length, so the page and panel counts are still right.
 */
export const SUMMARY_PROJECTION = {
  _id: 1,
  rev: 1,
  'project.id': 1,
  'project.version': 1,
  'project.title': 1,
  'project.stylePresetId': 1,
  'project.station': 1,
  'project.usage.images': 1,
  'project.usage.costUsd': 1,
  'project.createdAt': 1,
  'project.updatedAt': 1,
  'project.chapters.cover.versions.imageId': 1,
  'project.chapters.cover.currentVersion': 1,
  'project.chapters.pages.panels.versions.imageId': 1,
  'project.chapters.pages.panels.currentVersion': 1,
  'project.library.characters.id': 1,
  'project.library.characters.name': 1,
  'project.library.characters.role': 1,
  'project.library.characters.locked': 1,
  'project.library.characters.sheetImageId': 1,
  'project.library.characters.source': 1,
} as const

/** A ceiling on one listing; the dashboard has no pages yet, and this is far past what it shows. */
export const LIST_LIMIT = 500

async function listProjects(ownerId: string): Promise<ProjectSummary[]> {
  const docs = await mongo((projects) =>
    projects.find(ownerFilter(ownerId), { projection: SUMMARY_PROJECTION }).sort(UPDATED_INDEX).limit(LIST_LIMIT).toArray()
  )
  if (docs.length === LIST_LIMIT) console.warn(`[store] the desk lists its newest ${LIST_LIMIT} projects; older ones are not shown`)
  const summaries: ProjectSummary[] = []
  for (const doc of docs) {
    try {
      summaries.push(summarize(checked(doc)))
    } catch (err) {
      // One unreadable project never takes the desk down with it, and is never
      // hidden (CR-14): a "can't be read" card. `checked` has already named it
      // in the terminal; anything it missed is named here.
      if (!(err instanceof Refused)) console.warn(`[store] projects/${doc._id} couldn’t be read:`, err instanceof Error ? err.message : err)
      const at = (doc.project as Partial<Project> | null | undefined)?.updatedAt
      summaries.push(unreadableSummary(doc._id, typeof at === 'string' ? at : new Date(0).toISOString()))
    }
  }
  return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/**
 * The v1 desk is a file on this machine and its images are in `data/images/`,
 * which the bucket has never seen — so cloud mode does not migrate it. It stays
 * on the local desk, where `INKDESK_STORAGE=local` still opens it.
 */
async function migrateLegacy(): Promise<{ projectId: string | null; problem: string | null }> {
  return { projectId: null, problem: null }
}

/** Every project and its owner, for the claim script: three fields each, never the whole document. */
async function projectOwners(): Promise<ProjectOwner[]> {
  const docs = await mongo((projects) =>
    projects.find({}, { projection: { _id: 1, 'project.title': 1, 'project.ownerId': 1 } }).sort({ _id: 1 }).toArray()
  )
  return docs.map((doc) => {
    const project = doc.project as Partial<Project> | undefined
    return { id: doc._id, title: typeof project?.title === 'string' ? project.title : doc._id, ownerId: project?.ownerId ?? null }
  })
}

/** Whose one project is, read by projection alone, so a document that fails the project check still names its owner. */
async function projectOwner(id: string): Promise<string | null> {
  if (!isProjectId(id)) return null
  const doc = await mongo((projects) => projects.findOne({ _id: id }, { projection: { _id: 1, 'project.ownerId': 1 } }))
  if (!doc) return null
  const owner = (doc.project as Partial<Project> | undefined)?.ownerId
  return typeof owner === 'string' ? owner : LOCAL_OWNER
}

/** Give an unowned project to `ownerId` in one conditional write: two claims racing cannot both win. */
async function claimProject(id: string, ownerId: string): Promise<Claim> {
  if (!isProjectId(id)) throw noSuchProject()
  const won = await mongo((projects) =>
    projects.findOneAndUpdate(
      { _id: id, 'project.ownerId': { $in: [LOCAL_OWNER, null] } },
      { $set: { 'project.ownerId': ownerId, 'project.updatedAt': new Date().toISOString() }, $inc: { rev: 1 } },
      { projection: { _id: 1 } }
    )
  )
  if (won) return 'claimed'
  const doc = await mongo((projects) => projects.findOne({ _id: id }, { projection: { _id: 1, 'project.ownerId': 1 } }))
  if (!doc) throw noSuchProject()
  const current = (doc.project as Partial<Project> | undefined)?.ownerId
  if (current === ownerId) return 'already-theirs'
  if (claimable(current)) throw new ProviderError('The desk is busy with another change to this project.', 'provider', `projects/${id}: the claim lost a race it should have won`)
  throw new Refused(OWNED_BY_ANOTHER)
}

/** The ids of every project `ownerId` owns — a document that fails the project check included, as the projection never reads the project itself. Sorted in the process: an `_id` sort next to an owner filter would scan the collection. */
async function projectsOf(ownerId: string): Promise<{ id: string }[]> {
  const docs = await mongo((projects) => projects.find(ownerFilter(ownerId), { projection: { _id: 1 } }).toArray())
  return docs.map((doc) => ({ id: doc._id })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** When a project last changed and whose it is: two fields by projection, so a poll never pulls the project out of the database (CR-8). A document that can't be read as a project is dated by whatever it still says, else the epoch. */
async function projectStamp(id: string): Promise<{ ownerId: string; updatedAt: string } | null> {
  if (!isProjectId(id)) return null
  const doc = await mongo((projects) => projects.findOne({ _id: id }, { projection: { _id: 1, 'project.ownerId': 1, 'project.updatedAt': 1 } }))
  if (!doc) return null
  const project = doc.project as Partial<Project> | undefined
  return { ownerId: typeof project?.ownerId === 'string' ? project.ownerId : LOCAL_OWNER, updatedAt: typeof project?.updatedAt === 'string' ? project.updatedAt : new Date(0).toISOString() }
}

/** Remove the project's document and only that; the pictures are the caller's to delete first. One that is not there is already gone. */
async function deleteProject(id: string): Promise<void> {
  if (!isProjectId(id)) return
  await mongo((projects) => projects.deleteOne({ _id: id }))
}

// --- Users ------------------------------------------------------------------------
//
// One document per account. Each write is one conditional update, so a late or
// replayed `user.created` can never bring back an account already deleted, and
// two deliveries of one event leave one document.

const fromUserDoc = (doc: UserDoc): UserRecord => ({ id: doc._id, email: doc.email, createdAt: doc.createdAt, updatedAt: doc.updatedAt, deletedAt: doc.deletedAt ?? null })

async function readUser(id: string): Promise<UserRecord | null> {
  const doc = await mongoUsers((users) => users.findOne({ _id: id }))
  return doc ? fromUserDoc(doc) : null
}

const users: UserStore = {
  async upsert(user) {
    if (!isUserId(user.id)) throw new Refused(NOT_A_USER, 400)
    const current = await readUser(user.id)
    const now = new Date().toISOString()
    const next = upserted(current, user, now)
    if (next === current) return current
    try {
      // Only an account not deleted: a deletion that landed since the read wins.
      await mongoUsers((collection) =>
        collection.updateOne(
          { _id: user.id, deletedAt: null },
          { $set: { email: next.email, updatedAt: now }, $setOnInsert: { createdAt: next.createdAt } },
          { upsert: true }
        )
      )
    } catch (err) {
      // The filter missed a deleted account and the upsert met its `_id`: it stays deleted.
      if (!(err instanceof MongoServerError && err.code === 11000)) throw err
    }
    return (await readUser(user.id)) ?? next
  },

  async get(id) {
    return isUserId(id) ? readUser(id) : null
  },

  async markDeleted(id) {
    if (!isUserId(id)) throw new Refused(NOT_A_USER, 400)
    const now = new Date().toISOString()
    const next = deleted(null, id, now)
    try {
      await mongoUsers((collection) =>
        collection.updateOne(
          { _id: id, deletedAt: null },
          { $set: { email: '', updatedAt: now, deletedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        )
      )
    } catch (err) {
      // Already deleted: the first deletion's time stands.
      if (!(err instanceof MongoServerError && err.code === 11000)) throw err
    }
    return (await readUser(id)) ?? next
  },
}

// --- Jobs -------------------------------------------------------------------------

const without = (value: object, drop: readonly string[]) => Object.fromEntries(Object.entries(value).filter(([name]) => !drop.includes(name)))

/** A job's fields as stored — plain data, and not its `id` (that is `_id`). */
function fieldsOf(job: JobRecord): Omit<JobRecord, 'id'> {
  return without(plain(job), ['id']) as Omit<JobRecord, 'id'>
}

/** The stored document for a job. `activeKey` is there only while the job is queued or running. */
function toDoc(job: JobRecord, rev: number): JobDoc {
  return { _id: job.id, rev, ...(isActive(job) ? { activeKey: job.key } : {}), ...fieldsOf(job) }
}

function fromDoc(doc: JobDoc): JobRecord {
  return { id: doc._id, ...without(doc, ['_id', 'rev', 'activeKey']) } as JobRecord
}

/** A duplicate-key error on the index named by `field` (`_id`, `activeKey` or, for a share, `activeProject`). */
function duplicateOn(err: unknown, field: '_id' | 'activeKey' | 'activeProject'): boolean {
  if (!(err instanceof MongoServerError) || err.code !== 11000) return false
  const pattern = (err as MongoServerError & { keyPattern?: Record<string, unknown> }).keyPattern
  if (pattern) return field in pattern
  return field === '_id' ? /\b_id_\b/.test(err.message) : err.message.includes(field)
}

/** How many times an insert looks again for the holder of its key, when the holder ended between the refusal and the look. */
const MAX_INSERT_ATTEMPTS = 5

/** The two collection calls a job update needs — narrow, so `check:store` can drive a lost race on purpose. */
export type JobRevCollection = {
  findOne(filter: { _id: string }): Promise<JobDoc | null>
  findOneAndUpdate(
    filter: { _id: string; rev: number },
    update: { $set: Record<string, unknown>; $unset?: { activeKey: '' }; $inc: { rev: 1 } },
    options: { projection: { _id: 1 } }
  ): Promise<unknown>
}

/**
 * One job update with optimistic concurrency, the same loop as `revUpdate`:
 * read → `fn` → write only if `rev` hasn't moved. `fn` returning null leaves
 * the record as it is and resolves null — so does a record that isn't there.
 * The write that ends a job (it leaves queued/running) removes `activeKey` in
 * the same operation, so the key is free the moment the job is over.
 */
export async function jobUpdate(
  jobs: JobRevCollection,
  id: string,
  fn: (job: JobRecord) => JobRecord | null,
  pause: (attempt: number) => Promise<void> = jitteredPause
): Promise<JobRecord | null> {
  return casLoop<JobRecord | null>(
    async () => {
      const doc = await jobs.findOne({ _id: id })
      if (!doc) return { won: true, value: null }
      const next = fn(fromDoc(doc))
      if (next === null) return { won: true, value: null }
      const fields = fieldsOf({ ...next, id })
      const won = await jobs.findOneAndUpdate(
        { _id: id, rev: doc.rev },
        isActive(next) ? { $set: { ...fields, activeKey: next.key }, $inc: { rev: 1 } } : { $set: fields, $unset: { activeKey: '' }, $inc: { rev: 1 } },
        { projection: { _id: 1 } }
      )
      return won ? { won: true, value: { ...next, id } } : { won: false }
    },
    { sentence: BUSY, what: `jobs/${id}`, whom: 'job' },
    pause
  )
}

/** The query for a listing: every field present must match. */
function jobQuery(filter: JobFilter): Filter<JobDoc> {
  const query: Filter<JobDoc> = {}
  if (filter.projectId !== undefined) query.projectId = filter.projectId
  if (filter.ownerId !== undefined) query.ownerId = filter.ownerId
  if (filter.status !== undefined) query.status = { $in: [...filter.status] }
  if (filter.key !== undefined) query.key = filter.key
  if (filter.updatedSince !== undefined) query.updatedAt = { $gte: filter.updatedSince }
  if (filter.reservation !== undefined) query.reservation = filter.reservation
  return query
}

const jobs: JobStore = {
  async insertJob(job) {
    const doc = toDoc(job, 0)
    for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt++) {
      try {
        await mongoJobs((collection) => collection.insertOne(doc))
        return { job, created: true }
      } catch (err) {
        if (duplicateOn(err, '_id')) throw new Error(`jobs/${job.id} already exists`)
        if (!duplicateOn(err, 'activeKey')) throw err
      }
      // Another active job has the key — the unique index decided, not a read.
      const holder = await mongoJobs((collection) => collection.findOne({ activeKey: job.key }))
      if (holder) return { job: fromDoc(holder), created: false }
      // It ended between the refusal and the look; the key is free now, so try again.
    }
    throw new ProviderError(BUSY, 'provider', `jobs/${job.id}: key ${job.key} kept changing hands under ${MAX_INSERT_ATTEMPTS} attempts`)
  },

  async getJob(id) {
    const doc = await mongoJobs((collection) => collection.findOne({ _id: id }))
    return doc ? fromDoc(doc) : null
  },

  async updateJob(id, fn) {
    return inProcess(`job:${id}`, () => mongoJobs((collection) => jobUpdate(collection, id, fn)), false)
  },

  async listJobs(filter: JobFilter = {}) {
    const docs = await mongoJobs((collection) =>
      collection
        .find(jobQuery(filter))
        .sort({ updatedAt: -1, _id: -1 })
        .limit(filter.limit ?? JOB_LIST_LIMIT)
        .toArray()
    )
    return docs.map(fromDoc)
  },

  async pruneJobs(finishedBefore) {
    const result = await mongoJobs((collection) =>
      collection.deleteMany({
        status: { $in: ['done', 'failed'] },
        $or: [{ finishedAt: { $lt: finishedBefore } }, { finishedAt: null, updatedAt: { $lt: finishedBefore } }],
      })
    )
    return result.deletedCount
  },

  async deleteJob(id) {
    const result = await mongoJobs((collection) => collection.deleteOne({ _id: id }))
    return result.deletedCount > 0
  },

  async deleteJobsOf(ownerId, exceptId) {
    const result = await mongoJobs((collection) => collection.deleteMany(exceptId === undefined ? { ownerId } : { ownerId, _id: { $ne: exceptId } }))
    return result.deletedCount
  },
}

// --- Shares -----------------------------------------------------------------------
//
// One document per share, the token as `_id`. Create is one `insertOne`: the
// unique sparse `activeProject` index decides a race between two creates for
// one project, and the loser reads the winner. Refresh and revoke are single
// conditional updates, so none of them needs a read-modify-write loop.

const fromShareDoc = (doc: ShareDoc): ShareRecord => ({
  token: doc._id,
  ownerId: doc.ownerId,
  kind: doc.kind,
  projectId: doc.projectId ?? null,
  videoId: doc.videoId ?? null,
  snapshot: doc.snapshot ?? null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  revokedAt: doc.revokedAt ?? null,
})

/** The stored form of a record: `activeProject` only for a manga share that is still active. */
function toShareDoc(record: ShareRecord): ShareDoc {
  const { token, ...fields } = plain(record)
  return { _id: token, ...(fields.revokedAt === null && typeof fields.projectId === 'string' ? { activeProject: fields.projectId } : {}), ...fields }
}

/** A listing of shares is bounded; a person with this many active shares has found a bug before we have. */
const SHARE_LIST_LIMIT = 500

const shares: ShareStore = {
  async create(record) {
    if (!isShareToken(record.token)) throw new Error('Not a share token')
    const doc = toShareDoc(record)
    for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt++) {
      try {
        await mongoShares((collection) => collection.insertOne(doc))
        return { share: fromShareDoc(doc), created: true }
      } catch (err) {
        // A taken token is never overwritten: a revoked one is dead for good.
        if (duplicateOn(err, '_id')) throw new Error('that share token is already taken')
        if (!duplicateOn(err, 'activeProject')) throw err
      }
      // The project already has an active share — the unique index decided, not a read.
      const holder = await mongoShares((collection) => collection.findOne({ activeProject: doc.activeProject }))
      if (holder) return { share: fromShareDoc(holder), created: false }
      // It was revoked between the refusal and the look; the project is free now, so try again.
    }
    throw new ProviderError(BUSY, 'provider', `shares/${record.projectId}: the project’s share kept changing hands under ${MAX_INSERT_ATTEMPTS} attempts`)
  },

  async get(token) {
    if (!isShareToken(token)) return null
    const doc = await mongoShares((collection) => collection.findOne({ _id: token }))
    return doc ? fromShareDoc(doc) : null
  },

  async activeForProject(projectId) {
    if (typeof projectId !== 'string') return null
    const doc = await mongoShares((collection) => collection.findOne({ activeProject: projectId }))
    return doc ? fromShareDoc(doc) : null
  },

  async listActiveOf(ownerId) {
    const docs = await mongoShares((collection) => collection.find({ ownerId, revokedAt: null }).sort({ createdAt: -1, _id: -1 }).limit(SHARE_LIST_LIMIT).toArray())
    return docs.map(fromShareDoc)
  },

  async refresh(token, snapshot, now) {
    if (!isShareToken(token)) return null
    // Only an active share: a revoked token stays dead.
    const doc = await mongoShares((collection) =>
      collection.findOneAndUpdate({ _id: token, revokedAt: null }, { $set: { snapshot: plain(snapshot), updatedAt: now } }, { returnDocument: 'after' })
    )
    return doc ? fromShareDoc(doc) : null
  },

  async revoke(token, now) {
    if (!isShareToken(token)) return null
    // One write: the time, the snapshot gone and the project freed to be shared again.
    const doc = await mongoShares((collection) =>
      collection.findOneAndUpdate({ _id: token, revokedAt: null }, { $set: { revokedAt: now, updatedAt: now, snapshot: null }, $unset: { activeProject: '' } }, { returnDocument: 'after' })
    )
    if (doc) return fromShareDoc(doc)
    // Already revoked (the first time stands) — or never there.
    const existing = await mongoShares((collection) => collection.findOne({ _id: token }))
    return existing ? fromShareDoc(existing) : null
  },

  async deleteAllOf(ownerId) {
    const docs = await mongoShares((collection) => collection.find({ ownerId }, { projection: { _id: 1 } }).toArray())
    const tokens = docs.map((doc) => doc._id)
    if (tokens.length > 0) await mongoShares((collection) => collection.deleteMany({ _id: { $in: tokens } }))
    return tokens.sort()
  },
}

// --- Reports, settings, videos --------------------------------------------------------

const fromReportDoc = (doc: ReportDoc): ReportRecord => ({ id: doc._id, token: doc.token, reason: doc.reason, note: doc.note, ipHash: doc.ipHash, at: doc.at, handledAt: doc.handledAt ?? null })

/** Tokens per `deleteMany`: a query this long is still one small message. */
const TOKEN_CHUNK = 500

const reports: ReportStore = {
  async add(report) {
    if (!isRecordId(report.id)) throw new Error('Not a report id')
    const { id, ...fields } = plain(report)
    try {
      await mongoReports((collection) => collection.insertOne({ _id: id, ...fields }))
    } catch (err) {
      if (duplicateOn(err, '_id')) throw new Error('that report id is already taken')
      throw err
    }
  },

  async list(opts = {}) {
    const docs = await mongoReports((collection) =>
      collection
        .find(opts.unhandledOnly ? { handledAt: null } : {})
        .sort({ at: -1, _id: -1 })
        .limit(reportLimit(opts.limit))
        .toArray()
    )
    return docs.map(fromReportDoc)
  },

  async get(id) {
    if (!isRecordId(id)) return null
    const doc = await mongoReports((collection) => collection.findOne({ _id: id }))
    return doc ? fromReportDoc(doc) : null
  },

  async markHandled(id, now) {
    if (!isRecordId(id)) return null
    const doc = await mongoReports((collection) => collection.findOneAndUpdate({ _id: id, handledAt: null }, { $set: { handledAt: now } }, { returnDocument: 'after' }))
    if (doc) return fromReportDoc(doc)
    const existing = await mongoReports((collection) => collection.findOne({ _id: id })) // handled already: the first time stands
    return existing ? fromReportDoc(existing) : null
  },

  async deleteForTokens(tokens) {
    let removed = 0
    const wanted = [...new Set(tokens)]
    for (let i = 0; i < wanted.length; i += TOKEN_CHUNK) {
      const chunk = wanted.slice(i, i + TOKEN_CHUNK)
      removed += (await mongoReports((collection) => collection.deleteMany({ token: { $in: chunk } }))).deletedCount
    }
    return removed
  },
}

const settings: SettingsStore = {
  async get(userId) {
    if (!isUserId(userId)) return null
    const doc = await mongoSettings((collection) => collection.findOne({ _id: userId }))
    if (!doc) return null
    const { _id, ...fields } = doc
    return { userId: _id, ...fields }
  },

  async put(next) {
    if (!isUserId(next.userId)) throw new Refused(NOT_A_USER, 400)
    const { userId, ...fields } = plain(next)
    await mongoSettings((collection) => collection.replaceOne({ _id: userId }, { ...fields }, { upsert: true }))
  },

  async delete(userId) {
    if (!isUserId(userId)) return
    await mongoSettings((collection) => collection.deleteOne({ _id: userId }))
  },
}

const fromVideoDoc = (doc: VideoDoc): VideoRecord => {
  const { _id, ...fields } = doc
  return { id: _id, ...fields }
}

const videos: VideoStore = {
  async put(video) {
    if (!isRecordId(video.id)) throw new Error('Not a video id')
    const { id, ...fields } = plain(video)
    await mongoVideos((collection) => collection.replaceOne({ _id: id }, { ...fields }, { upsert: true }))
  },

  async get(id) {
    if (!isRecordId(id)) return null
    const doc = await mongoVideos((collection) => collection.findOne({ _id: id }))
    return doc ? fromVideoDoc(doc) : null
  },

  async listOf(ownerId) {
    const docs = await mongoVideos((collection) => collection.find({ ownerId }).sort({ createdAt: -1, _id: -1 }).limit(SHARE_LIST_LIMIT).toArray())
    return docs.map(fromVideoDoc)
  },

  async deleteAllOf(ownerId) {
    const docs = await mongoVideos((collection) => collection.find({ ownerId }).toArray())
    if (docs.length > 0) await mongoVideos((collection) => collection.deleteMany({ _id: { $in: docs.map((doc) => doc._id) } }))
    return docs.map(fromVideoDoc)
  },
}

// --- Outputs ----------------------------------------------------------------------
//
// The outputs bucket, under the key prefix and an `outputs/` folder of its own.
// The folder is why two buckets or one makes no difference to correctness: an
// output key can never be an image id (those have no slash) or the probe object.
// The key rules are the local store's (`isOutputKey`), so a hostile key names
// nothing here either.

/** The object key in the bucket for an output key. Exported for the slices that hand a file to the browser or to a worker by key. */
export function outputObjectKey(prefix: string, key: string): string {
  return `${prefix}outputs/${key}`
}

/** Up to this size a file or a stream is held in memory for the upload, so the SDK can retry it; bigger ones stream from disk. */
const OUTPUT_BUFFER_MAX = 64 * 1024 * 1024

/** A listing page is 1000 keys; a prefix bigger than this many pages is cut off with a warning (nothing here comes close). */
const MAX_LIST_PAGES = 100

/** Parallel deletes: gentle on a small bucket, and an account's outputs are a handful. */
const DELETE_PARALLEL = 8

/** Every object under the folder `folder` (already checked), keys relative to the outputs folder. */
async function listOutputs(folder: string): Promise<{ key: string; bytes: number; modifiedAt: string }[]> {
  const { s3, outputsBucket, prefix } = await cloud()
  const root = outputObjectKey(prefix, '')
  const found: { key: string; bytes: number; modifiedAt: string }[] = []
  let token: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await s3.send(new ListObjectsV2Command({ Bucket: outputsBucket, Prefix: root + folder, ContinuationToken: token }))
    for (const object of result.Contents ?? []) {
      if (!object.Key || !object.Key.startsWith(root)) continue
      found.push({ key: object.Key.slice(root.length), bytes: object.Size ?? 0, modifiedAt: (object.LastModified ?? new Date(0)).toISOString() })
    }
    if (!result.IsTruncated || !result.NextContinuationToken) return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    token = result.NextContinuationToken
  }
  console.warn(`[store] outputs/${folder} lists more than ${MAX_LIST_PAGES * 1000} objects; the rest are not shown`)
  return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

const outputs: OutputStore = {
  async put(key, body, mediaType) {
    if (!isOutputKey(key)) throw new Error(`Not an output key: ${JSON.stringify(key).slice(0, 80)}`)
    const { s3, outputsBucket, prefix } = await cloud()
    const Key = outputObjectKey(prefix, key)
    if (Buffer.isBuffer(body)) {
      await s3.send(new PutObjectCommand({ Bucket: outputsBucket, Key, Body: body, ContentType: mediaType }))
      return { bytes: body.length }
    }
    // A file the caller made, or a stream of bytes spooled to one: S3 wants a stream's length up front, and a body
    // that is held can be sent again if the SDK retries.
    let spooled: string | null = null
    try {
      let path: string
      if (typeof body === 'string') path = body
      else {
        spooled = join(tmpdir(), `inkdesk-output-${randomUUID()}.tmp`)
        path = spooled
        const handle = await open(spooled, 'wx')
        try {
          for await (const chunk of body) await handle.writeFile(chunk)
        } finally {
          await handle.close()
        }
      }
      const { size } = await stat(path)
      if (size <= OUTPUT_BUFFER_MAX) {
        await s3.send(new PutObjectCommand({ Bucket: outputsBucket, Key, Body: await readFile(path), ContentType: mediaType }))
      } else {
        // Too big to hold: stream it, and send it again from the start if the first try fails (a consumed stream cannot be replayed).
        for (let attempt = 1; ; attempt++) {
          const stream = createReadStream(path)
          try {
            await s3.send(new PutObjectCommand({ Bucket: outputsBucket, Key, Body: stream, ContentLength: size, ContentType: mediaType }))
            break
          } catch (err) {
            if (attempt >= 3) throw err
          } finally {
            stream.destroy()
          }
        }
      }
      return { bytes: size }
    } finally {
      if (spooled) await rm(spooled, { force: true }).catch(() => {})
    }
  },

  async open(key) {
    if (!isOutputKey(key)) return null
    const { s3, outputsBucket, prefix } = await cloud()
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: outputsBucket, Key: outputObjectKey(prefix, key) }))
      if (!object.Body) return null
      const body = idleLimited(object.Body.transformToWebStream() as ReadableStream<Uint8Array>)
      return { body, bytes: object.ContentLength ?? null, mediaType: object.ContentType || outputMediaType(key) }
    } catch (err) {
      if (isMissingObject(err)) return null
      throw err
    }
  },

  async delete(key) {
    if (!isOutputKey(key)) return
    const { s3, outputsBucket, prefix } = await cloud()
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: outputsBucket, Key: outputObjectKey(prefix, key) }))
    } catch (err) {
      if (!isMissingObject(err)) throw err
    }
  },

  async deletePrefix(folderOrPrefix) {
    const folder = requireOutputFolder(folderOrPrefix)
    if (folder === '') throw new Error('deletePrefix needs a folder; an empty prefix would delete every output')
    const { s3, outputsBucket, prefix } = await cloud()
    const objects = await listOutputs(folder)
    for (let i = 0; i < objects.length; i += DELETE_PARALLEL) {
      await Promise.all(
        objects.slice(i, i + DELETE_PARALLEL).map((object) =>
          s3.send(new DeleteObjectCommand({ Bucket: outputsBucket, Key: outputObjectKey(prefix, object.key) })).catch((err: unknown) => {
            if (!isMissingObject(err)) throw err
          })
        )
      )
    }
    return objects.length
  },

  async list(folderOrPrefix) {
    return listOutputs(requireOutputFolder(folderOrPrefix))
  },
}

// --- Blobs ------------------------------------------------------------------------

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
  const { s3, bucket, prefix } = await cloud()
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + id, Body: bytes, ContentType: mediaType }))
  return id
}

async function getBlob(id: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
  if (!isImageId(id)) return null
  const { s3, bucket, prefix } = await cloud()
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + id }))
    if (!object.Body) return null
    // The id's extension is the media type, exactly as on the local desk.
    const body = idleLimited(object.Body.transformToWebStream() as ReadableStream<Uint8Array>)
    return { bytes: Buffer.from(await new Response(body).arrayBuffer()), mediaType: mediaTypeOf(id) }
  } catch (err) {
    // Only a missing *object* is "no such image". A missing bucket or a
    // refused key is a 404 or 403 too, and must not make every image on the
    // desk look deleted — it goes to the route's 502 and the terminal.
    if (isMissingObject(err)) return null
    throw err
  }
}

/** The image as a stream straight from the bucket, never buffered whole (CR-17). */
async function openBlob(id: string): Promise<BlobStream | null> {
  if (!isImageId(id)) return null
  const { s3, bucket, prefix } = await cloud()
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + id }))
    if (!object.Body) return null
    const body = idleLimited(object.Body.transformToWebStream() as ReadableStream<Uint8Array>)
    return { body, bytes: object.ContentLength ?? null, mediaType: mediaTypeOf(id) }
  } catch (err) {
    if (isMissingObject(err)) return null
    throw err
  }
}

/** Remove one image from the bucket; one that isn't there is already gone (CR-16). An unsafe id names nothing. */
async function deleteBlob(id: string): Promise<void> {
  if (!isImageId(id)) return
  const { s3, bucket, prefix } = await cloud()
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: prefix + id }))
  } catch (err) {
    if (!isMissingObject(err)) throw err // S3 answers 204 for a missing key; a store that says otherwise still means "gone"
  }
}

/** One answer within `ms`, or 'down'. */
function within(ms: number, probe: (signal: AbortSignal) => Promise<unknown>): Promise<Check> {
  const signal = AbortSignal.timeout(ms)
  return Promise.race([
    probe(signal).then((): Check => 'ok', (): Check => 'down'),
    new Promise<Check>((resolve) => signal.addEventListener('abort', () => resolve('down'), { once: true })),
  ])
}

/**
 * The health check's view: MongoDB answers a ping and the bucket answers for
 * the probe object, each within `timeoutMs`. Never throws, never says why —
 * the terminal has the cause.
 */
async function health(timeoutMs: number): Promise<StoreHealth> {
  let c: Cloud
  try {
    c = await new Promise<Cloud>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cloud storage: still connecting')), timeoutMs)
      cloud().then(resolve, reject).finally(() => clearTimeout(timer))
    })
  } catch (err) {
    // A connect that failed on the bucket got past MongoDB first.
    const which = (err as { unreachable?: string } | null)?.unreachable
    console.warn('[health] cloud storage:', err instanceof Error ? err.message : err)
    return { mongo: which === 'bucket' ? 'ok' : 'down', bucket: 'down' }
  }
  const db = c.client.db(c.projects.dbName)
  const [mongo, bucket] = await Promise.all([
    within(timeoutMs, () => db.command({ ping: 1 })),
    within(timeoutMs, (abortSignal) => c.s3.send(new HeadObjectCommand({ Bucket: c.bucket, Key: c.prefix + BUCKET_PROBE_KEY }), { abortSignal })),
  ])
  return { mongo, bucket }
}

export const cloudStore: Store = {
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

/** Only a missing *object* is "no such image" — exported so `check:store` can
 *  hold it to real errors from a real bucket. */
export function isMissingObject(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'NoSuchKey'
}
