// The studio's settings, read in one place (v3, slice 16). Every variable the
// server needs is named here, validated with zod, and refused at boot by
// `instrumentation.ts` in one sentence that lists every problem — the
// variable's name, never its value. See `devpost/spec.md > Environment and
// Configuration (v3)` and `> Config and Boot (v3)`.
//
// The learner's variable names are mapped, never renamed: where two names are
// accepted, the first one set wins.
//
//   Mongo URL            MONGODB_URI, else DB_URL
//   Mongo database       MONGODB_DB, else DB_DATABASE
//   project-files bucket S3_BUCKET_PROJECT_FILES, else S3_BUCKET
//   outputs bucket       S3_BUCKET_COMPILE_OUTPUTS, else the project-files bucket
//   S3_FORCE_PATH_STYLE  'true' | 'false', default true
//   S3_PUBLIC_ENDPOINT   the host for signed URLs, default S3_ENDPOINT
//   S3_KEY_PREFIX        where in the buckets Ink Desk writes, default `inkdesk/`
//   Redis                REDIS_URL (Railway's Redis provides it)
//   queue mode           INKDESK_QUEUE: `inline` (this process runs jobs; the
//                        checks and a bare dev desk) or `bullmq` (a `worker`
//                        service runs them; the only mode in production)
//   image concurrency    QUEUE_CONCURRENCY_IMAGE, else PANEL_CONCURRENCY
//
// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { z } from 'zod'
import { authMode, authProblems, type AuthMode } from './auth/config'

type Env = Record<string, string | undefined>

/** One sentence that lists every problem, by variable name. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `The studio’s settings need fixing — ${problems.join('; ')} — so set ${problems.length === 1 ? 'it' : 'them'} in .env (or the host’s variables) and restart.`
    )
    this.name = 'ConfigError'
  }
}

// --- Names ----------------------------------------------------------------------

/** The accepted names for one setting, the preferred one first. */
export const NAMES = {
  mongoUrl: ['MONGODB_URI', 'DB_URL'],
  mongoDb: ['MONGODB_DB', 'DB_DATABASE'],
  endpoint: ['S3_ENDPOINT'],
  region: ['S3_REGION'],
  projectFilesBucket: ['S3_BUCKET_PROJECT_FILES', 'S3_BUCKET'],
  accessKeyId: ['S3_ACCESS_KEY_ID'],
  secretAccessKey: ['S3_SECRET_ACCESS_KEY'],
  outputsBucket: ['S3_BUCKET_COMPILE_OUTPUTS'],
  publicEndpoint: ['S3_PUBLIC_ENDPOINT'],
  forcePathStyle: ['S3_FORCE_PATH_STYLE'],
  keyPrefix: ['S3_KEY_PREFIX'],
} as const satisfies Record<string, readonly string[]>

/** Redis — the queue's, not the store's; kept apart from `NAMES` so a change to it is not "a new database connection". */
const REDIS_NAMES = ['REDIS_URL'] as const

/** What cloud mode cannot start without, in the order the sentences name them. */
export const CLOUD_REQUIRED = ['mongoUrl', 'mongoDb', 'endpoint', 'region', 'projectFilesBucket', 'accessKeyId', 'secretAccessKey'] as const

/** Every variable cloud mode reads — a change to any of them is a new connection. */
export const CLOUD_VARIABLES: readonly string[] = Object.values(NAMES).flat()

/** `MONGODB_URI (or DB_URL)` — how a sentence names a setting. */
export function nameOf(names: readonly string[]): string {
  return names.length === 1 ? names[0] : `${names[0]} (or ${names.slice(1).join(' or ')})`
}

/** The first accepted name that is set and not blank, trimmed. */
function pick(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

// --- Storage --------------------------------------------------------------------

export type StorageMode = 'local' | 'cloud'

/** The buckets alone — what a script that only moves files needs. */
export type BucketSettings = {
  endpoint: string
  /** The host signed and public URLs are made on; S3_ENDPOINT unless set. */
  publicEndpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Images and uploads. */
  projectFilesBucket: string
  /** Rendered videos and exports; the project-files bucket unless set. Nothing writes here yet. */
  outputsBucket: string
  forcePathStyle: boolean
  /** Every key Ink Desk writes starts with this (SEC-13): a bucket shared with
   *  another app keeps Ink Desk's objects in one folder, never at its root. */
  keyPrefix: string
}

/** Where in a bucket Ink Desk writes unless S3_KEY_PREFIX says otherwise. */
export const DEFAULT_KEY_PREFIX = 'inkdesk/'

export type CloudSettings = BucketSettings & { mongoUrl: string; mongoDb: string }

const BUCKET_REQUIRED = ['endpoint', 'region', 'projectFilesBucket', 'accessKeyId', 'secretAccessKey'] as const

/** The cloud settings that are missing or blank, each named by every name it accepts. */
export function missingCloud(env: Env = process.env, required: readonly (keyof typeof NAMES)[] = CLOUD_REQUIRED): string[] {
  return required.filter((key) => !pick(env, NAMES[key])).map((key) => nameOf(NAMES[key]))
}

const MONGO_URL = z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/i)
const HTTP_URL = z.url({ protocol: /^https?$/ })
const FLAG = z.enum(['true', 'false'])
// Database names: no path or field characters, as MongoDB itself requires.
const MONGO_DB = z.string().regex(/^[^/\\. "$*<>:|?]{1,63}$/)
// Bucket names as S3 and R2 accept them (lenient on case; the bucket refuses the rest).
const BUCKET = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$/)
// One or more plain folder names, ending in a slash: never the bucket's root.
const KEY_PREFIX = z.string().max(200).regex(/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)+$/)

/** Problems with the cloud settings (missing, then malformed), by name only. */
function cloudProblems(env: Env, withMongo = true): string[] {
  const problems = missingCloud(env, withMongo ? CLOUD_REQUIRED : BUCKET_REQUIRED).map((name) => `${name} is not set`)
  const check = (key: keyof typeof NAMES, schema: z.ZodType, what: string) => {
    const value = pick(env, NAMES[key])
    if (value !== undefined && !schema.safeParse(value).success) problems.push(`${nameOf(NAMES[key])} must be ${what}`)
  }
  if (withMongo) {
    check('mongoUrl', MONGO_URL, 'a MongoDB connection string (one that starts with mongodb or mongodb+srv)')
    check('mongoDb', MONGO_DB, 'a database name without spaces, dots or slashes')
  }
  check('endpoint', HTTP_URL, 'an http:// or https:// address')
  check('publicEndpoint', HTTP_URL, 'an http:// or https:// address')
  check('projectFilesBucket', BUCKET, 'a bucket name')
  check('outputsBucket', BUCKET, 'a bucket name')
  check('forcePathStyle', FLAG, 'true or false')
  check('keyPrefix', KEY_PREFIX, 'a folder name ending in a slash, like inkdesk/')
  return problems
}

/**
 * Where cloud mode connects, with every mapping applied. Throws `ConfigError`
 * naming each missing or malformed setting. Not memoised: the store keys its
 * connection on these values, so an edited `.env` reconnects.
 */
export function cloudSettings(env: Env = process.env): CloudSettings {
  const problems = cloudProblems(env)
  if (problems.length > 0) throw new ConfigError(problems)
  return { mongoUrl: pick(env, NAMES.mongoUrl) as string, mongoDb: pick(env, NAMES.mongoDb) as string, ...readBuckets(env) }
}

/** The buckets alone, mapped the same way; no database needed. Throws `ConfigError`. */
export function bucketSettings(env: Env = process.env): BucketSettings {
  const problems = cloudProblems(env, false)
  if (problems.length > 0) throw new ConfigError(problems)
  return readBuckets(env)
}

function readBuckets(env: Env): BucketSettings {
  const get = (key: keyof typeof NAMES) => pick(env, NAMES[key]) as string
  const projectFilesBucket = get('projectFilesBucket')
  return {
    endpoint: get('endpoint'),
    publicEndpoint: pick(env, NAMES.publicEndpoint) ?? get('endpoint'),
    region: get('region'),
    accessKeyId: get('accessKeyId'),
    secretAccessKey: get('secretAccessKey'),
    projectFilesBucket,
    outputsBucket: pick(env, NAMES.outputsBucket) ?? projectFilesBucket,
    forcePathStyle: (pick(env, NAMES.forcePathStyle) ?? 'true') === 'true',
    keyPrefix: pick(env, NAMES.keyPrefix) ?? DEFAULT_KEY_PREFIX,
  }
}

// --- Numbers and flags ----------------------------------------------------------

const wholeNumber = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))

const NUMBERS = {
  PANEL_CONCURRENCY: { schema: wholeNumber(1, 8), fallback: 2, rule: 'a whole number from 1 to 8' },
  QUEUE_CONCURRENCY_IMAGE: { schema: wholeNumber(1, 8), fallback: 0, rule: 'a whole number from 1 to 8' },
  QUEUE_USER_INFLIGHT: { schema: wholeNumber(1, 200), fallback: 30, rule: 'a whole number from 1 to 200' },
  QUEUE_MAX_WAITING: { schema: wholeNumber(1, 5000), fallback: 200, rule: 'a whole number from 1 to 5000' },
  QUEUE_RETRY_BACKOFF_MS: { schema: wholeNumber(0, 60_000), fallback: 5_000, rule: 'a whole number of milliseconds from 0 to 60000' },
  WORKER_GRACE_MS: { schema: wholeNumber(0, 600_000), fallback: 90_000, rule: 'a whole number of milliseconds from 0 to 600000' },
  GENERATION_TIMEOUT_MS: { schema: wholeNumber(30_000, 900_000), fallback: 360_000, rule: 'a whole number of milliseconds from 30000 to 900000' },
} as const

/** A number setting: blank means the default (CR-15 — an empty value is not 0). */
function numberProblem(env: Env, name: keyof typeof NUMBERS): string | null {
  const raw = env[name]?.trim()
  if (!raw) return null
  return NUMBERS[name].schema.safeParse(raw).success ? null : `${name} must be ${NUMBERS[name].rule}`
}

function readNumber(env: Env, name: keyof typeof NUMBERS): number {
  const problem = numberProblem(env, name)
  if (problem) throw new ConfigError([problem])
  const raw = env[name]?.trim()
  return raw ? NUMBERS[name].schema.parse(raw) : NUMBERS[name].fallback
}

/** How many panel images may generate at once (PANEL_CONCURRENCY, 1–8, default 2). */
export function panelConcurrency(env: Env = process.env): number {
  return readNumber(env, 'PANEL_CONCURRENCY')
}

/** How many image jobs a worker (or the inline queue) runs at once: QUEUE_CONCURRENCY_IMAGE, else PANEL_CONCURRENCY, default 2. */
export function imageConcurrency(env: Env = process.env): number {
  const own = env.QUEUE_CONCURRENCY_IMAGE?.trim()
  return own ? readNumber(env, 'QUEUE_CONCURRENCY_IMAGE') : readNumber(env, 'PANEL_CONCURRENCY')
}

/** How long one image call may take (GENERATION_TIMEOUT_MS, 30 s–15 min, default 6 min). */
export function generationTimeoutMs(env: Env = process.env): number {
  return readNumber(env, 'GENERATION_TIMEOUT_MS')
}

/**
 * Whether paid generation is open (GENERATION_ENABLED). Unset, it is on in
 * development and off in production, so a public deploy cannot spend by
 * accident. A value other than true or false is refused at boot; read here
 * anyway, it keeps the studio closed.
 */
export function generationEnabled(env: Env = process.env): boolean {
  const raw = env.GENERATION_ENABLED?.trim()
  if (!raw) return env.NODE_ENV !== 'production'
  return raw === 'true'
}

// --- The queue ------------------------------------------------------------------

export type QueueMode = 'inline' | 'bullmq'

export type QueueSettings = {
  mode: QueueMode
  /** Null on the inline queue — and on a production web service with generation closed and no Redis yet. */
  redisUrl: string | null
  imageConcurrency: number
  /** How many jobs one person may have queued or running at once. */
  userInflight: number
  /** How many jobs may be queued or running across everyone before the studio says it is busy. */
  maxWaiting: number
  /** The first pause before BullMQ re-runs a job whose worker hit a store outage; it doubles each time. */
  retryBackoffMs: number
  /** How long a worker told to stop lets what it is drawing finish before it gives up on it. */
  graceMs: number
}

const REDIS_URL = z.string().regex(/^rediss?:\/\/\S+$/i)

/**
 * INKDESK_QUEUE. Unset: `bullmq` in production, `inline` everywhere else, so a
 * clone with two API keys still runs. Production refuses `inline` — two
 * processes cannot share an in-memory queue.
 */
function queueMode(env: Env): QueueMode {
  const raw = env.INKDESK_QUEUE?.trim()
  if (!raw) return env.NODE_ENV === 'production' ? 'bullmq' : 'inline'
  return raw === 'bullmq' ? 'bullmq' : 'inline'
}

function queueProblems(env: Env, role: 'web' | 'worker'): string[] {
  const problems: string[] = []
  const raw = env.INKDESK_QUEUE?.trim()
  if (raw && raw !== 'inline' && raw !== 'bullmq') problems.push('INKDESK_QUEUE must be inline or bullmq')
  else if (env.NODE_ENV === 'production' && raw === 'inline') problems.push('INKDESK_QUEUE must be bullmq in production (a worker service runs the jobs)')
  const redis = pick(env, REDIS_NAMES)
  if (redis !== undefined && !REDIS_URL.safeParse(redis).success) problems.push('REDIS_URL must be a redis:// or rediss:// address')
  if (queueMode(env) === 'bullmq' && redis === undefined) {
    // A web service that cannot generate yet may start without Redis (reads
    // need none); the worker, and a web service that can generate, may not.
    if (role === 'worker' || generationEnabled(env)) problems.push('REDIS_URL is not set')
  }
  return problems
}

/** The queue's settings from `env`; throws `ConfigError`. `role: 'worker'` refuses a missing Redis outright. */
export function queueSettings(env: Env = process.env, role: 'web' | 'worker' = 'web'): QueueSettings {
  const problems = queueProblems(env, role)
  for (const name of ['PANEL_CONCURRENCY', 'QUEUE_CONCURRENCY_IMAGE', 'QUEUE_USER_INFLIGHT', 'QUEUE_MAX_WAITING', 'QUEUE_RETRY_BACKOFF_MS', 'WORKER_GRACE_MS'] as const) {
    const problem = numberProblem(env, name)
    if (problem) problems.push(problem)
  }
  if (problems.length > 0) throw new ConfigError([...new Set(problems)])
  return {
    mode: queueMode(env),
    redisUrl: pick(env, REDIS_NAMES) ?? null,
    imageConcurrency: imageConcurrency(env),
    userInflight: readNumber(env, 'QUEUE_USER_INFLIGHT'),
    maxWaiting: readNumber(env, 'QUEUE_MAX_WAITING'),
    retryBackoffMs: readNumber(env, 'QUEUE_RETRY_BACKOFF_MS'),
    graceMs: readNumber(env, 'WORKER_GRACE_MS'),
  }
}

// --- The whole configuration ----------------------------------------------------

export type AppConfig = {
  storage: StorageMode
  /** Null on a local desk. */
  cloud: CloudSettings | null
  panelConcurrency: number
  generationTimeoutMs: number
  generationEnabled: boolean
  queue: QueueSettings
}

const READ = ['NODE_ENV', 'INKDESK_STORAGE', 'INKDESK_QUEUE', 'GENERATION_ENABLED', ...Object.keys(NUMBERS), ...CLOUD_VARIABLES, ...REDIS_NAMES]

/** The configuration from `env`, or a `ConfigError` listing every problem. Pure. */
export function parseConfig(env: Env = process.env, role: 'web' | 'worker' = 'web'): AppConfig {
  const problems: string[] = []
  const storage = env.INKDESK_STORAGE?.trim() || 'local'
  if (storage !== 'local' && storage !== 'cloud') problems.push('INKDESK_STORAGE must be local (the default) or cloud')
  if (storage === 'cloud') problems.push(...cloudProblems(env))
  const flag = env.GENERATION_ENABLED?.trim()
  if (flag && !FLAG.safeParse(flag).success) problems.push('GENERATION_ENABLED must be true or false')
  for (const name of Object.keys(NUMBERS) as (keyof typeof NUMBERS)[]) {
    const problem = numberProblem(env, name)
    if (problem) problems.push(problem)
  }
  // The queue's own numbers were just checked above; its mode and Redis here.
  for (const problem of queueProblems(env, role)) problems.push(problem)
  if (problems.length > 0) throw new ConfigError(problems)
  return {
    storage: storage as StorageMode,
    cloud: storage === 'cloud' ? cloudSettings(env) : null,
    panelConcurrency: panelConcurrency(env),
    generationTimeoutMs: generationTimeoutMs(env),
    generationEnabled: generationEnabled(env),
    queue: queueSettings(env, role),
  }
}

let memo: { key: string; config: AppConfig } | undefined

/** The process's configuration, validated once per set of values. Throws `ConfigError`. */
export function appConfig(): AppConfig {
  const key = JSON.stringify(READ.map((name) => process.env[name] ?? null))
  if (memo?.key !== key) memo = { key, config: parseConfig(process.env) }
  return memo.config
}

// --- Sign-in (v3, slice 19) -----------------------------------------------------
//
// INKDESK_AUTH and Clerk's variables; the rules live in `lib/auth/config.ts`
// (the proxy and the CSP read them too, and cannot load a server-only module).
// Kept out of `parseConfig` on purpose: the worker never signs anyone in, and
// a web service's boot asks for them on its own (`lib/boot.ts`).
//
//   INKDESK_AUTH                       clerk | off | test; unset = clerk in production, off elsewhere
//   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  else CLERK_PUBLISHABLE_KEY (mapped, not renamed)
//   CLERK_SECRET_KEY                   required in clerk mode
//   CLERK_JWT_KEY                      optional: sessions verified with no network call
//   CLERK_WEBHOOK_SIGNING_SECRET       optional at boot; the webhook refuses without it
//   APP_URL, NEXT_PUBLIC_APP_URL       the trusted origins; APP_URL required in production

export type AuthSettings = { mode: AuthMode }

/** The sign-in settings from `env`, or a `ConfigError` naming every problem — production refuses off, test, and clerk without its keys. */
export function authSettings(env: Env = process.env): AuthSettings {
  const problems = authProblems(env)
  if (problems.length > 0) throw new ConfigError(problems)
  return { mode: authMode(env) }
}
