// The cloud store (slice 13): the same interface as `local.ts`, on MongoDB
// for project state and an S3-compatible bucket (AWS S3, Cloudflare R2,
// MinIO) for every image. Selected by `INKDESK_STORAGE=cloud`; loaded only
// then, so a local desk never pulls in either driver.
//
//   MongoDB  <MONGODB_DB>.projects   { _id: <project id>, rev: n, project: Project }
//   bucket   <S3_BUCKET>/<kind>-<uuid>.<ext>   the same ids the local store writes
//
// The same two guarantees as the local store, by other means
// (`devpost/spec.md > Storage Adapter (v2)`):
//   1. No torn writes  — one document per project, replaced whole.
//   2. No lost updates — `updateProject()` is read → `fn` → write only if
//      `rev` is still the one read, with `rev` bumped in the same operation.
//      A mismatch means another writer got there first: re-read and run `fn`
//      again on the fresh project, a bounded number of times, then a calm
//      failure. Inside one process the per-project promise chain still
//      serializes updates first, so a retry only happens when something
//      else writes the database — a check, a script, a second server
//      started by mistake. Run one Ink Desk server per database: a second
//      one's stale-inking floor would demote this one's panels in flight.
//
// The browser still only ever sees `/api/image/<id>`; the bucket is never
// public. The panel queue stays in this process in both modes, and the
// stale-inking floor (`startedByRun`, `startedAt`) is unchanged — cloud mode
// makes the data durable and shareable, not the app multi-instance.
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { MongoClient, MongoNetworkError, MongoServerError, MongoServerSelectionError, type Collection } from 'mongodb'
import { ProviderError, Refused } from '../errors'
import { singletons } from '../singleton'
import type { Project, ProjectSummary } from '../types'
import { CLOUD_ENV, missingCloudEnv, missingCloudSentence } from './env'
import { isImageId, isProjectId, mediaTypeOf, summarize } from './local'
import type { BlobKind, Store } from './index'

export type ProjectDoc = { _id: string; rev: number; project: Project }

type Cloud = { client: MongoClient; projects: Collection<ProjectDoc>; s3: S3Client; bucket: string }

/** How many times one update re-reads after losing a race to another writer. */
export const MAX_UPDATE_ATTEMPTS = 5

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

// --- Connection -----------------------------------------------------------------

/** The object every connect writes: proves the bucket, the endpoint and the
 *  keys with the one permission the studio needs anyway. Never an image id
 *  (`.txt`), so `/api/image` can never serve it. */
export const BUCKET_PROBE_KEY = 'inkdesk-bucket-check.txt'

const MONGO_UNREACHABLE =
  'The studio couldn’t reach its MongoDB. Check MONGODB_URI (and that the database lets this machine in), then reload.'
const BUCKET_UNREACHABLE =
  'The studio couldn’t write to its bucket. Check S3_ENDPOINT, S3_REGION, S3_BUCKET and the S3 keys (and that the bucket exists), then reload.'

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
function unreachable(which: 'mongo' | 'bucket', cause: unknown): Error {
  return Object.assign(new Error(`cloud storage: ${which} unreachable`), { unreachable: which, cause })
}

function asProviderError(err: unknown): unknown {
  const which = (err as { unreachable?: string } | null)?.unreachable
  if (which === 'mongo') return new ProviderError(MONGO_UNREACHABLE, 'config', (err as Error).cause)
  if (which === 'bucket') return new ProviderError(BUCKET_UNREACHABLE, 'config', (err as Error).cause)
  return err
}

async function cloud(): Promise<Cloud> {
  const missing = missingCloudEnv()
  if (missing.length > 0) throw new ProviderError(missingCloudSentence(missing), 'config')
  const settings = CLOUD_ENV.map((name) => process.env[name] ?? '').join('\n')
  let entry = g.__inkdeskCloud
  if (entry?.settings !== settings) {
    const retired = entry
    const pending = connect(process.env as Record<string, string>)
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

/** Where the connection points, for the terminal: hosts and names, never credentials. */
function describe(env: Record<string, string>): string {
  const mongoHost = env.MONGODB_URI.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]*@/, '').split(/[/?]/)[0]
  let bucketHost = env.S3_ENDPOINT
  try {
    bucketHost = new URL(env.S3_ENDPOINT).host
  } catch {}
  return `MongoDB “${env.MONGODB_DB}” on ${mongoHost} · bucket “${env.S3_BUCKET}” at ${bucketHost}`
}

async function connect(env: Record<string, string>): Promise<Cloud> {
  let client: MongoClient | undefined
  try {
    // Inside the try: a malformed URI throws from the constructor. The URI
    // itself is never repeated anywhere — it carries the password.
    client = new MongoClient(env.MONGODB_URI, {
      // An absent field stays absent, as it does in the JSON file —
      // `bubble: undefined` and `bubble: null` mean different things.
      ignoreUndefined: true,
      // Ten seconds unless the URI chooses its own.
      ...(/[?&]serverSelectionTimeoutMS=/i.test(env.MONGODB_URI) ? {} : { serverSelectionTimeoutMS: 10_000 }),
    })
    await client.connect()
    await client.db(env.MONGODB_DB).command({ ping: 1 })
  } catch (err) {
    await client?.close().catch(() => {})
    throw unreachable('mongo', err)
  }
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    // Path-style (`<endpoint>/<bucket>/<key>`) is what R2 and MinIO expect
    // and AWS still accepts, so one setting serves all three.
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  })
  try {
    // A wrong bucket or key found here costs nothing; found by `putBlob`, it
    // would be found after an image was already paid for. A write, not
    // HeadBucket: that needs ListBucket, which a bucket-scoped key may lack.
    await s3.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: BUCKET_PROBE_KEY, Body: 'Ink Desk keeps its images in this bucket.\n', ContentType: 'text/plain' })
    )
  } catch (err) {
    s3.destroy()
    await client.close().catch(() => {})
    throw unreachable('bucket', err)
  }
  console.log(`[store] cloud: ${describe(env)}`)
  return { client, projects: client.db(env.MONGODB_DB).collection<ProjectDoc>('projects'), s3, bucket: env.S3_BUCKET }
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
async function mongo<T>(op: (projects: Collection<ProjectDoc>) => Promise<T>): Promise<T> {
  const { projects } = await cloud()
  try {
    return await op(projects)
  } catch (err) {
    if (err instanceof MongoNetworkError || err instanceof MongoServerSelectionError) {
      throw new ProviderError(MONGO_UNREACHABLE, 'config', err)
    }
    throw err
  }
}

// --- Projects -------------------------------------------------------------------

function noSuchProject(): Refused {
  return new Refused('There is no such project.', 404)
}

/** What lands in MongoDB is exactly what the local store would write to disk. */
function plain(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project
}

function checked(doc: ProjectDoc): Project {
  if (doc.project?.version !== 2) {
    throw new Error(`projects/${doc._id} is version ${String(doc.project?.version)}; this build reads version 2.`)
  }
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

/**
 * One update with optimistic concurrency: read → `fn` → write only if `rev`
 * hasn't moved. A lost race re-reads and runs `fn` again on what the other
 * writer left, up to `MAX_UPDATE_ATTEMPTS` times, then a calm failure.
 */
export async function revUpdate(
  projects: RevCollection,
  id: string,
  fn: (project: Project) => Project,
  pause: (attempt: number) => Promise<void> = (attempt) =>
    new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 30)))
): Promise<Project> {
  for (let attempt = 1; ; attempt++) {
    const doc = await projects.findOne({ _id: id }) // fresh read, inside the lock
    if (!doc) throw noSuchProject()
    const next = plain({
      ...fn(checked(doc)),
      id, // the id is the document's key; a change here would be a different project
      serverRunId: singletons.serverRunId,
      updatedAt: new Date().toISOString(),
    })
    const won = await projects.findOneAndUpdate(
      { _id: id, rev: doc.rev },
      { $set: { project: next }, $inc: { rev: 1 } },
      { projection: { _id: 1 } }
    )
    if (won) return next
    if (attempt >= MAX_UPDATE_ATTEMPTS) {
      throw new ProviderError(
        'The desk is busy with another change to this project.',
        'provider',
        `projects/${id}: rev moved under ${MAX_UPDATE_ATTEMPTS} attempts in a row — another process is writing this project`
      )
    }
    // Another writer got in between the read and the write. Step aside for a
    // moment (jittered, growing) and start again from what it wrote.
    await pause(attempt)
  }
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
  const run = (): Promise<Project> => mongo((projects) => revUpdate(projects, id, fn))
  const previous = singletons.locks.get(id) ?? Promise.resolve()
  // `.then(run, run)` so one failed update doesn't block the next.
  const result = previous.then(run, run)
  singletons.locks.set(id, result.catch(() => {}))
  return result
}

async function listProjects(): Promise<ProjectSummary[]> {
  const summaries: ProjectSummary[] = []
  for (const doc of await mongo((projects) => projects.find({}).toArray())) {
    try {
      summaries.push(summarize(checked(doc)))
    } catch (err) {
      // One unreadable project never takes the desk down with it.
      console.warn(`[store] projects/${doc._id} couldn’t be read; skipped:`, err instanceof Error ? err.message : err)
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
  const { s3, bucket } = await cloud()
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: id, Body: bytes, ContentType: mediaType }))
  return id
}

async function getBlob(id: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
  if (!isImageId(id)) return null
  const { s3, bucket } = await cloud()
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: id }))
    if (!object.Body) return null
    // The id's extension is the media type, exactly as on the local desk.
    return { bytes: Buffer.from(await object.Body.transformToByteArray()), mediaType: mediaTypeOf(id) }
  } catch (err) {
    // Only a missing *object* is "no such image". A missing bucket or a
    // refused key is a 404 or 403 too, and must not make every image on the
    // desk look deleted — it goes to the route's 502 and the terminal.
    if ((err as { name?: string }).name === 'NoSuchKey') return null
    throw err
  }
}

export const cloudStore: Store = { listProjects, migrateLegacy, readProject, createProject, updateProject, putBlob, getBlob }
