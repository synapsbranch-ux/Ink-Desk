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
//   admins               ADMIN_EMAILS (slice 21; see `adminEmails`)
//   video                VIDEO_ENABLED (slice 21; see `videoEnabled`)
//
// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { z } from 'zod'
import { authMode, authProblems, isProduction, type AuthMode } from './auth/config'
import type { PlanName, RateBucket } from './limits/rules'

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

/** The Redis address, or null — read on its own, because the limits only need to know whether there is one and the queue's other problems are not theirs to throw. */
export function redisUrl(env: Env = process.env): string | null {
  return pick(env, REDIS_NAMES) ?? null
}

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
  // Limits (slice 20): the per-plan daily quotas, the request windows, the proxy.
  QUOTA_FREE_IMAGES: { schema: wholeNumber(0, 100_000), fallback: 20, rule: 'a whole number from 0 to 100000' },
  QUOTA_FREE_PROJECTS: { schema: wholeNumber(0, 1_000), fallback: 1, rule: 'a whole number from 0 to 1000' },
  QUOTA_FREE_VIDEO_SECONDS: { schema: wholeNumber(0, 100_000), fallback: 15, rule: 'a whole number from 0 to 100000' },
  QUOTA_FREE_AUDIO_CHARS: { schema: wholeNumber(0, 10_000_000), fallback: 2_000, rule: 'a whole number from 0 to 10000000' },
  QUOTA_ALLOW_IMAGES: { schema: wholeNumber(0, 100_000), fallback: 150, rule: 'a whole number from 0 to 100000' },
  QUOTA_ALLOW_PROJECTS: { schema: wholeNumber(0, 1_000), fallback: 10, rule: 'a whole number from 0 to 1000' },
  QUOTA_ALLOW_VIDEO_SECONDS: { schema: wholeNumber(0, 100_000), fallback: 120, rule: 'a whole number from 0 to 100000' },
  QUOTA_ALLOW_AUDIO_CHARS: { schema: wholeNumber(0, 10_000_000), fallback: 20_000, rule: 'a whole number from 0 to 10000000' },
  RATE_TEXT_PER_MIN: { schema: wholeNumber(1, 100_000), fallback: 10, rule: 'a whole number from 1 to 100000' },
  RATE_IMAGE_PER_MIN: { schema: wholeNumber(1, 100_000), fallback: 6, rule: 'a whole number from 1 to 100000' },
  RATE_UPLOAD_PER_HOUR: { schema: wholeNumber(1, 100_000), fallback: 20, rule: 'a whole number from 1 to 100000' },
  RATE_EDIT_PER_MIN: { schema: wholeNumber(1, 100_000), fallback: 120, rule: 'a whole number from 1 to 100000' },
  RATE_READ_PER_MIN: { schema: wholeNumber(1, 100_000), fallback: 240, rule: 'a whole number from 1 to 100000' },
  RATE_MEDIA_PER_MIN: { schema: wholeNumber(1, 1_000_000), fallback: 1_200, rule: 'a whole number from 1 to 1000000' },
  RATE_ANON_PER_MIN: { schema: wholeNumber(1, 100_000), fallback: 60, rule: 'a whole number from 1 to 100000' },
  // Slice 21: the share page's pictures per client address (a reader page is dozens, and a page of a shared manga is read by one address behind a school's NAT), and the report form.
  RATE_ANON_MEDIA_PER_MIN: { schema: wholeNumber(1, 1_000_000), fallback: 600, rule: 'a whole number from 1 to 1000000' },
  RATE_REPORT_PER_HOUR: { schema: wholeNumber(1, 100_000), fallback: 6, rule: 'a whole number from 1 to 100000' },
  TRUSTED_PROXY_HOPS: { schema: wholeNumber(0, 5), fallback: 1, rule: 'a whole number from 0 to 5' },
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

/**
 * Whether video is open (VIDEO_ENABLED, default off — slice 22 builds it; until
 * then the dashboard hides its Videos section and no route makes one). Read
 * fresh on every call. Only `true` opens it: a value other than true or false
 * is refused at boot, and read here anyway it keeps video closed.
 */
export function videoEnabled(env: Env = process.env): boolean {
  return env.VIDEO_ENABLED?.trim() === 'true'
}

// --- The queue ------------------------------------------------------------------

export type QueueMode = 'inline' | 'bullmq'

export type QueueSettings = {
  mode: QueueMode
  /** Null on the inline queue — and on a production web service with generation closed and no Redis yet. */
  redisUrl: string | null
  imageConcurrency: number
  /**
   * How many account jobs (an export, a deletion) a worker runs at once. Fixed
   * at one, not a setting: an export racing the deletion of the same person
   * could write a file after the deletion swept the folder, and nothing about
   * a person leaving needs to be quick (`lib/queue/jobs.ts > QUEUE_OF`).
   */
  accountConcurrency: number
  /** How many jobs one person may have queued or running at once. */
  userInflight: number
  /** How many jobs may be queued or running across everyone before the studio says it is busy. */
  maxWaiting: number
  /** The first pause before BullMQ re-runs a job whose worker hit a store outage; it doubles each time. */
  retryBackoffMs: number
  /** How long a worker told to stop lets what it is drawing finish before it gives up on it. */
  graceMs: number
}

/** The `account` queue runs one job at a time per worker. */
export const ACCOUNT_CONCURRENCY = 1

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
    accountConcurrency: ACCOUNT_CONCURRENCY,
    userInflight: readNumber(env, 'QUEUE_USER_INFLIGHT'),
    maxWaiting: readNumber(env, 'QUEUE_MAX_WAITING'),
    retryBackoffMs: readNumber(env, 'QUEUE_RETRY_BACKOFF_MS'),
    graceMs: readNumber(env, 'WORKER_GRACE_MS'),
  }
}

// --- Limits (v3, slice 20) --------------------------------------------------------
//
// Quotas, request windows, spend caps and the kill switch. Read from the
// environment on EVERY call, never memoised: the learner lowers
// GLOBAL_DAILY_USD_CAP in Railway to 0.01 and generation pauses for everyone on
// the next click, with no code path that remembers the old number. Blank means
// the default (CR-15); a malformed value is refused at boot by name, never by
// its value. See `devpost/spec.md > Limits, Quotas and the Kill Switch (v3)`.
//
//   INKDESK_LIMITS         on | off; unset = on whenever sign-in is on (clerk or
//                          test) and in production, off only on a local desk
//                          with INKDESK_AUTH=off. Production refuses off.
//   ALLOWLIST_EMAILS       comma list, case-insensitive: these accounts get the
//                          `allowlisted` plan (the local owner always does)
//   GLOBAL_DAILY_USD_CAP   the studio's spend per UTC day, default 5 (0 = paused)
//   GLOBAL_TOTAL_USD_CAP   optional: a cumulative ceiling across all days; unset
//                          means none. The learner chooses it.
//   QUOTA_FREE_* / QUOTA_ALLOW_*   IMAGES, PROJECTS, VIDEO_SECONDS, AUDIO_CHARS a day
//   USER_DAILY_USD_FREE / USER_DAILY_USD_ALLOW   one person's spend a day
//   RATE_*                 the request windows (text 10/min, image 6/min, upload
//                          20/hour, edit 120/min, read 240/min; pictures served
//                          1200/min; signed-out callers 60/min per client; and,
//                          per client address, a shared manga's pictures 600/min
//                          and reports 6/hour — slice 21)
//   TRUSTED_PROXY_HOPS     how many proxies in front of the app append to
//                          X-Forwarded-For, default 1 (Railway's edge)
//   CLIENT_IP_HEADER       x-forwarded-for (default) or x-real-ip: which header
//                          names the client address (see lib/limits/requests.ts)

/** Dollar amounts: a plain decimal with at most six places. */
const dollars = (max: number) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .transform(Number)
    .pipe(z.number().min(0).max(max))

const DOLLARS = {
  GLOBAL_DAILY_USD_CAP: { schema: dollars(100_000), fallback: 5, rule: 'a dollar amount like 5 or 0.25' },
  GLOBAL_TOTAL_USD_CAP: { schema: dollars(10_000_000), fallback: null, rule: 'a dollar amount like 20 (or be left unset)' },
  USER_DAILY_USD_FREE: { schema: dollars(100_000), fallback: 1, rule: 'a dollar amount like 1 or 0.5' },
  USER_DAILY_USD_ALLOW: { schema: dollars(100_000), fallback: 10, rule: 'a dollar amount like 10' },
} as const

/** The limits settings that are not plain numbers. */
const LIMIT_OTHER = ['INKDESK_LIMITS', 'ALLOWLIST_EMAILS', 'CLIENT_IP_HEADER'] as const

/** Slice 21's settings that are not limits: who administers, and whether video is open. */
const STUDIO_OTHER = ['ADMIN_EMAILS', 'VIDEO_ENABLED'] as const

function dollarProblem(env: Env, name: keyof typeof DOLLARS): string | null {
  const raw = env[name]?.trim()
  if (!raw) return null
  return DOLLARS[name].schema.safeParse(raw).success ? null : `${name} must be ${DOLLARS[name].rule}`
}

function readDollars(env: Env, name: keyof typeof DOLLARS): number | null {
  const raw = env[name]?.trim()
  return raw && !dollarProblem(env, name) ? DOLLARS[name].schema.parse(raw) : DOLLARS[name].fallback
}

const EMAIL = z.string().regex(/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/)

/** A comma list of addresses as lower-cased, de-duplicated entries; `null` when an entry is not an address. Blank is an empty list. */
function readEmailList(env: Env, name: 'ALLOWLIST_EMAILS' | 'ADMIN_EMAILS'): string[] | null {
  const raw = env[name]?.trim()
  if (!raw) return []
  const entries = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return entries.every((e) => EMAIL.safeParse(e).success) ? [...new Set(entries)] : null
}

/** The allowlist as a list of lower-cased addresses; `null` when an entry is not an address. */
function readAllowlist(env: Env): string[] | null {
  return readEmailList(env, 'ALLOWLIST_EMAILS')
}

/**
 * Who may open the admin pages (ADMIN_EMAILS, slice 21): a comma list,
 * case-insensitive, matched against the VERIFIED email in `store.users`
 * exactly as ALLOWLIST_EMAILS is (`lib/auth/admin.ts`). Read fresh on every
 * call, never memoised. Blank is nobody — an unset list in production gives
 * no one the admin pages, which is the safe default. A malformed list is
 * refused at boot by name; read here anyway it names nobody, so a typo can
 * never promote anyone.
 */
export function adminEmails(env: Env = process.env): readonly string[] {
  return readEmailList(env, 'ADMIN_EMAILS') ?? []
}

/** Is the sign-in mode `off`? Never throws: an unreadable mode is the boot's to refuse, and counts as on here. */
function signInIsOff(env: Env): boolean {
  try {
    return authMode(env) === 'off'
  } catch {
    return false
  }
}

/**
 * Are the limits on? INKDESK_LIMITS says; unset, they are on wherever sign-in
 * is on and in production, and off only on a local desk with sign-in off, so a
 * fresh clone and every check that predates accounts run untouched.
 * Production never reads off, whatever the variable says — the boot refuses
 * it, and this is the second lock.
 */
export function limitsEnabled(env: Env = process.env): boolean {
  if (isProduction(env)) return true
  const raw = env.INKDESK_LIMITS?.trim()
  if (raw === 'on') return true
  if (raw === 'off') return false
  return !signInIsOff(env)
}

function limitsProblems(env: Env): string[] {
  const problems: string[] = []
  const raw = env.INKDESK_LIMITS?.trim()
  if (raw && raw !== 'on' && raw !== 'off') problems.push('INKDESK_LIMITS must be on or off')
  else if (raw === 'off' && isProduction(env)) problems.push('INKDESK_LIMITS must be on in production (off is for a local desk)')
  const header = env.CLIENT_IP_HEADER?.trim()
  if (header && header !== 'x-forwarded-for' && header !== 'x-real-ip') problems.push('CLIENT_IP_HEADER must be x-forwarded-for or x-real-ip')
  if (readAllowlist(env) === null) problems.push('ALLOWLIST_EMAILS must be a comma-separated list of email addresses')
  for (const name of Object.keys(DOLLARS) as (keyof typeof DOLLARS)[]) {
    const problem = dollarProblem(env, name)
    if (problem) problems.push(problem)
  }
  return problems
}

/** Problems with slice 21's settings (not part of the limits: a typo in the admin list must not stop a window being taken). */
function studioProblems(env: Env): string[] {
  const problems: string[] = []
  if (readEmailList(env, 'ADMIN_EMAILS') === null) problems.push('ADMIN_EMAILS must be a comma-separated list of email addresses')
  const video = env.VIDEO_ENABLED?.trim()
  if (video && !FLAG.safeParse(video).success) problems.push('VIDEO_ENABLED must be true or false')
  return problems
}

export type PlanLimits = {
  image: number
  project: number
  videoSeconds: number
  audioChars: number
  /** One person's spend a UTC day, in dollars. */
  dailyUsd: number
}

export type RateLimit = { limit: number; windowMs: number }

export type LimitsSettings = {
  enabled: boolean
  /** Lower-cased addresses on the allowlisted plan. */
  allowlist: readonly string[]
  globalDailyUsd: number
  /** Null: no cumulative cap. */
  globalTotalUsd: number | null
  plans: Record<PlanName, PlanLimits>
  rates: Record<RateBucket, RateLimit>
  /** Proxies in front of the app that append to X-Forwarded-For. */
  trustedProxyHops: number
  /** The header the client address is read from. */
  clientIpHeader: 'x-forwarded-for' | 'x-real-ip'
}

const MINUTE = 60_000

/** The limits from `env` (default: the process's), read fresh each time. Throws `ConfigError` naming every problem. */
export function limitsSettings(env: Env = process.env): LimitsSettings {
  const problems = limitsProblems(env)
  for (const name of Object.keys(NUMBERS) as (keyof typeof NUMBERS)[]) {
    if (/^(QUOTA_|RATE_|TRUSTED_)/.test(name)) {
      const problem = numberProblem(env, name)
      if (problem) problems.push(problem)
    }
  }
  if (problems.length > 0) throw new ConfigError([...new Set(problems)])
  const n = (name: keyof typeof NUMBERS) => readNumber(env, name)
  const d = (name: keyof typeof DOLLARS) => readDollars(env, name)
  return {
    enabled: limitsEnabled(env),
    allowlist: readAllowlist(env) ?? [],
    globalDailyUsd: d('GLOBAL_DAILY_USD_CAP') as number,
    globalTotalUsd: d('GLOBAL_TOTAL_USD_CAP'),
    plans: {
      free: { image: n('QUOTA_FREE_IMAGES'), project: n('QUOTA_FREE_PROJECTS'), videoSeconds: n('QUOTA_FREE_VIDEO_SECONDS'), audioChars: n('QUOTA_FREE_AUDIO_CHARS'), dailyUsd: d('USER_DAILY_USD_FREE') as number },
      allowlisted: { image: n('QUOTA_ALLOW_IMAGES'), project: n('QUOTA_ALLOW_PROJECTS'), videoSeconds: n('QUOTA_ALLOW_VIDEO_SECONDS'), audioChars: n('QUOTA_ALLOW_AUDIO_CHARS'), dailyUsd: d('USER_DAILY_USD_ALLOW') as number },
    },
    rates: {
      text: { limit: n('RATE_TEXT_PER_MIN'), windowMs: MINUTE },
      image: { limit: n('RATE_IMAGE_PER_MIN'), windowMs: MINUTE },
      upload: { limit: n('RATE_UPLOAD_PER_HOUR'), windowMs: 60 * MINUTE },
      edit: { limit: n('RATE_EDIT_PER_MIN'), windowMs: MINUTE },
      read: { limit: n('RATE_READ_PER_MIN'), windowMs: MINUTE },
      media: { limit: n('RATE_MEDIA_PER_MIN'), windowMs: MINUTE },
      anon: { limit: n('RATE_ANON_PER_MIN'), windowMs: MINUTE },
      anonMedia: { limit: n('RATE_ANON_MEDIA_PER_MIN'), windowMs: MINUTE },
      report: { limit: n('RATE_REPORT_PER_HOUR'), windowMs: 60 * MINUTE },
    },
    trustedProxyHops: n('TRUSTED_PROXY_HOPS'),
    clientIpHeader: env.CLIENT_IP_HEADER?.trim() === 'x-real-ip' ? 'x-real-ip' : 'x-forwarded-for',
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
  /** Video is closed unless VIDEO_ENABLED=true (slice 21; the dashboard hides its Videos section while it is). */
  videoEnabled: boolean
  /** Lower-cased addresses that may open the admin pages; empty = nobody. */
  adminEmails: readonly string[]
  queue: QueueSettings
  limits: LimitsSettings
}

const READ = [
  'NODE_ENV',
  'INKDESK_STORAGE',
  'INKDESK_QUEUE',
  'INKDESK_AUTH',
  'GENERATION_ENABLED',
  ...Object.keys(NUMBERS),
  ...LIMIT_OTHER,
  ...STUDIO_OTHER,
  ...Object.keys(DOLLARS),
  ...CLOUD_VARIABLES,
  ...REDIS_NAMES,
]

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
  problems.push(...limitsProblems(env))
  problems.push(...studioProblems(env))
  if (problems.length > 0) throw new ConfigError([...new Set(problems)])
  return {
    storage: storage as StorageMode,
    cloud: storage === 'cloud' ? cloudSettings(env) : null,
    panelConcurrency: panelConcurrency(env),
    generationTimeoutMs: generationTimeoutMs(env),
    generationEnabled: generationEnabled(env),
    videoEnabled: videoEnabled(env),
    adminEmails: adminEmails(env),
    queue: queueSettings(env, role),
    limits: limitsSettings(env),
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
