// Who may use the studio, and how that is decided (v3, slice 19; Better Auth
// since the revision of 2026-10-24). One switch, INKDESK_AUTH:
//
//   better  sign-in through Better Auth, inside the studio: email and password,
//           nothing else. Accounts and sessions live in the studio's own
//           MongoDB. The only mode production accepts.
//   off     one owner, `local` — the single-person desk of v1 and v2, for a
//           fresh clone, development and every check that predates accounts.
//   test    development and the checks only: the caller names itself in the
//           `x-inkdesk-test-user` header, so two people can be played without
//           a database or the network.
//
// Unset, it is `better` in production and `off` everywhere else. See
// `devpost/spec.md > Revision v3 > Auth (v3)` and `> Environment and
// Configuration (v3)`.
//
// Deliberately NOT `server-only`: `next.config.ts` and `proxy.ts` read it too.
// It holds no secret — it only checks that the secret is set and long enough,
// and every sentence names a variable, never its value. `lib/config.ts` wraps
// these problems in its `ConfigError` for the boot.

type Env = Record<string, string | undefined>

export type AuthMode = 'better' | 'off' | 'test'

export const AUTH_MODES: readonly AuthMode[] = ['better', 'off', 'test']

/** Problems with the sign-in settings, by variable name; never a value. */
export class AuthConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The sign-in settings need fixing — ${problems.join('; ')}.`)
    this.name = 'AuthConfigError'
  }
}

/** The studio's own address: what sign-in trusts, and where `www` is sent. */
export const APP_URL_NAMES = ['APP_URL', 'NEXT_PUBLIC_APP_URL'] as const
/** The MongoDB the accounts live in — the same names the store reads (`lib/config.ts`). */
export const MONGO_URL_NAMES = ['MONGODB_URI', 'DB_URL'] as const
export const MONGO_DB_NAMES = ['MONGODB_DB', 'DB_DATABASE'] as const

/** Where sign-in lives: the studio's own page. There is no sign-up page — the learner makes every account. */
export const SIGN_IN_PATH = '/sign-in'
/** Where Better Auth answers (`app/api/auth/[...all]/route.ts`). */
export const AUTH_API_PATH = '/api/auth'
/** The request header the proxy puts a page's path and query in, so `pageUser` can send a signed-out visitor back to it. */
export const PATH_HEADER = 'x-inkdesk-path'
/** The session cookie's prefix (`inkdesk.session_token`, `__Secure-` in production). */
export const COOKIE_PREFIX = 'inkdesk'

/** What a development desk trusts besides APP_URL. */
const LOCAL_ORIGIN = 'http://localhost:3000'

/** An account id a script may name: Better Auth's (on MongoDB an ObjectId's 24 hex characters; its own generator's 32 letters and digits elsewhere) or a test-mode `user_…`. */
export const ACCOUNT_ID = /^(?:[A-Za-z0-9]{24,32}|user_[A-Za-z0-9]{1,40})$/

/** The shortest secret accepted: Better Auth signs cookies with it. */
export const SECRET_MIN_LENGTH = 32

function pick(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/**
 * Is this a server strangers may reach? Everything but `development` (what
 * `next dev` sets) and unset (the tsx checks). `next start` keeps whatever
 * NODE_ENV it is given, so `test` or `staging` there is still a public
 * server, and sign-in must not fall open on one string (S19-SEC-1).
 */
export function isProduction(env: Env = process.env): boolean {
  const value = env.NODE_ENV?.trim()
  return Boolean(value) && value !== 'development'
}

const production = isProduction

/** The mode's own problems: an unknown value, and off or test where strangers are. */
function modeProblems(env: Env): string[] {
  const raw = env.INKDESK_AUTH?.trim()
  if (!raw) return []
  if (!(AUTH_MODES as readonly string[]).includes(raw)) return ['INKDESK_AUTH must be better, off or test']
  if (production(env) && raw !== 'better') return ['INKDESK_AUTH must be better in production (off and test are for development and the checks)']
  return []
}

/**
 * The sign-in mode. Unset: `better` in production (any NODE_ENV but
 * development or unset — see `isProduction`), `off` otherwise, so a fresh
 * clone, `next dev` and every existing check keep working with no account. Throws
 * `AuthConfigError` for an unknown value, and for `off` or `test` in
 * production — a public studio never runs without sign-in, whoever asks.
 */
export function authMode(env: Env = process.env): AuthMode {
  const problems = modeProblems(env)
  if (problems.length > 0) throw new AuthConfigError(problems)
  const raw = env.INKDESK_AUTH?.trim()
  if (!raw) return production(env) ? 'better' : 'off'
  return raw as AuthMode
}

/**
 * Is real sign-in on? The tolerant read for what renders (the header's account
 * menu, the sign-in pages): never throws, because `next build` prerenders with
 * NODE_ENV=production whatever INKDESK_AUTH a development .env holds, and the
 * refusal belongs to the boot and the proxy, not to the build (S19-REG-1).
 */
export function signInOn(env: Env = process.env): boolean {
  try {
    return authMode(env) === 'better'
  } catch (err) {
    if (err instanceof AuthConfigError) return false
    throw err
  }
}

// --- Better Auth's settings ---------------------------------------------------

/** An `http(s)://host[:port]` origin from a URL setting, or null. */
function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/** The studio's own origin from APP_URL (else NEXT_PUBLIC_APP_URL), or null when unset or malformed. */
export function appOrigin(env: Env = process.env): string | null {
  return originOf(pick(env, APP_URL_NAMES))
}

/**
 * The origins that may send a request that changes something — the proxy's
 * Origin check and Better Auth's own `trustedOrigins`: APP_URL and
 * NEXT_PUBLIC_APP_URL, plus `http://localhost:3000` outside production.
 */
export function authorizedParties(env: Env = process.env): string[] {
  const parties = new Set<string>()
  for (const name of APP_URL_NAMES) {
    const origin = originOf(env[name]?.trim())
    if (origin) parties.add(origin)
  }
  if (!production(env)) parties.add(LOCAL_ORIGIN)
  return [...parties]
}

export type BetterSettings = {
  secret: string
  /** Where the studio answers. */
  baseURL: string
  authorizedParties: string[]
  mongoUrl: string
  mongoDb: string
}

const MONGO_URL = /^mongodb(\+srv)?:\/\/\S+$/
const MONGO_DB = /^[^\s./\\"$]{1,63}$/

function secretProblems(env: Env): string[] {
  const secret = env.BETTER_AUTH_SECRET?.trim()
  if (!secret) return ['BETTER_AUTH_SECRET is not set']
  return secret.length >= SECRET_MIN_LENGTH ? [] : [`BETTER_AUTH_SECRET must be at least ${SECRET_MIN_LENGTH} characters (openssl rand -base64 32 makes one)`]
}

function mongoProblems(env: Env): string[] {
  const problems: string[] = []
  const url = pick(env, MONGO_URL_NAMES)
  if (!url) problems.push('MONGODB_URI (or DB_URL) is not set — the accounts live in MongoDB')
  else if (!MONGO_URL.test(url)) problems.push('MONGODB_URI (or DB_URL) must be a MongoDB connection string')
  const db = pick(env, MONGO_DB_NAMES)
  if (!db) problems.push('MONGODB_DB (or DB_DATABASE) is not set — the accounts live in MongoDB')
  else if (!MONGO_DB.test(db)) problems.push('MONGODB_DB (or DB_DATABASE) must be a database name without spaces, dots or slashes')
  return problems
}

/**
 * What the worker needs of the sign-in settings: it never signs anyone in, but the deletion of an account ends the
 * person's sign-in by deleting their Better Auth user, sessions and password (`lib/account/signin.ts`), which needs the
 * accounts' database and the secret. Empty where the mode is not `better`. The worker's boot refuses to start on any of
 * these, and the deletion refuses before it changes anything.
 */
export function workerAuthProblems(env: Env = process.env): string[] {
  const problems = modeProblems(env)
  if (problems.length > 0) return problems
  return authMode(env) === 'better' ? [...secretProblems(env), ...mongoProblems(env)] : []
}

/** Every problem with the sign-in settings, by name. Empty when the mode needs nothing more. */
export function authProblems(env: Env = process.env): string[] {
  const problems = modeProblems(env)
  if (problems.length > 0) return problems
  if (authMode(env) !== 'better') return []

  problems.push(...secretProblems(env), ...mongoProblems(env))

  for (const name of APP_URL_NAMES) {
    const value = env[name]?.trim()
    if (value && !originOf(value)) problems.push(`${name} must be an http:// or https:// address`)
  }
  // In production the studio's address decides which pages may post; without
  // it nothing could be trusted.
  if (production(env) && !appOrigin(env)) problems.push('APP_URL is not set (the studio’s own https:// address)')

  return problems
}

/** Better Auth's settings for `lib/auth/server.ts`. Throws `AuthConfigError` naming every problem. */
export function betterSettings(env: Env = process.env): BetterSettings {
  const problems = authProblems(env)
  if (problems.length > 0) throw new AuthConfigError(problems)
  if (authMode(env) !== 'better') throw new AuthConfigError(['INKDESK_AUTH is not better, so there are no sign-in settings to read'])
  return {
    secret: (env.BETTER_AUTH_SECRET as string).trim(),
    baseURL: appOrigin(env) ?? LOCAL_ORIGIN,
    authorizedParties: authorizedParties(env),
    mongoUrl: pick(env, MONGO_URL_NAMES) as string,
    mongoDb: pick(env, MONGO_DB_NAMES) as string,
  }
}

// --- Request rules (the proxy's, pure so the checks can call them) -----------

/**
 * The API routes anyone may call with no session AND no Origin check: the deploy's health check, and nothing else.
 *
 * Two kinds of open route are deliberately NOT here, because this list also skips the proxy's Origin check:
 *   • `/api/auth/*` — Better Auth's own routes (sign-in, sign-out, the session). A
 *     signed-out person must reach them, but a page on another site must not be able to post a sign-in or a sign-out
 *     on a visitor's behalf; Better Auth checks the origin against `trustedOrigins` too.
 *   • `/api/s/` — the public share routes of slice 21; the report form WRITES.
 * Neither needs naming in the proxy: an API route answers for itself (`isApi`), so it passes without a redirect,
 * while `isCrossOrigin` still judges its writes. `check:auth` holds these facts.
 */
export const PUBLIC_API_PREFIXES = ['/api/health'] as const


/** Pages a signed-out visitor may open. `/s/` is the public share page (slice 21). */
const PUBLIC_PAGE_PREFIXES = [SIGN_IN_PATH, '/terms', '/privacy', '/s/'] as const

function under(pathname: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix)
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => under(pathname, prefix))
}

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some((prefix) => under(pathname, prefix))
}

export function isApi(pathname: string): boolean {
  return under(pathname, '/api')
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** What the Origin check needs from a request; a `NextRequest` and a plain `Request` both give it. */
export type OriginInput = { method: string; url: string; headers: Headers }

/**
 * True when a request that changes something did not come from the studio
 * (SEC-10, beside SameSite cookies): a non-GET to `/api/*` whose Origin is
 * not one of the authorized parties nor the request's own origin, or which
 * carries a cookie and no Origin at all (a browser always sends one on a
 * POST; a cookie with none is something else replaying a session).
 */
export function isCrossOrigin(req: OriginInput, parties: readonly string[]): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false
  const url = new URL(req.url)
  if (!isApi(url.pathname)) return false
  const origin = req.headers.get('origin')
  if (!origin || origin === 'null') {
    // `null` is what a sandboxed frame or a redirect chain sends: never the studio.
    if (origin === 'null') return true
    return req.headers.has('cookie')
  }
  return !(parties.includes(origin) || origin === url.origin)
}

/** The calm answer to a cross-origin write. */
export const CROSS_ORIGIN_SENTENCE = 'That request didn’t come from the studio, so it wasn’t accepted.'

/**
 * Where a `www.` request goes: the same path on the apex, when APP_URL's own
 * host has no `www.` (a paid Railway plan can serve both; the studio answers
 * on one). Null when nothing should move.
 */
export function wwwRedirect(requestUrl: string, host: string | null, env: Env = process.env): URL | null {
  const app = appOrigin(env)
  if (!app || !host) return null
  const apex = new URL(app)
  if (apex.hostname.startsWith('www.')) return null
  const requestHost = host.toLowerCase().split(':')[0]
  if (requestHost !== `www.${apex.hostname}`) return null
  const from = new URL(requestUrl)
  const to = new URL(`${from.pathname}${from.search}`, app)
  return to
}
