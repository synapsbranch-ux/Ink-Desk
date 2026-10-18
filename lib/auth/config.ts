// Who may use the studio, and how that is decided (v3, slice 19). One switch,
// INKDESK_AUTH:
//
//   clerk  sign-in through Clerk; every request carries a Clerk session. The
//          only mode production accepts.
//   off    one owner, `local` — the single-person desk of v1 and v2, for a
//          fresh clone, development and every check that predates accounts.
//   test   development and the checks only: the caller names itself in the
//          `x-inkdesk-test-user` header, so two people can be played without
//          Clerk or the network.
//
// Unset, it is `clerk` in production and `off` everywhere else. See
// `devpost/spec.md > Revision v3 > Auth (v3)` and `> Environment and
// Configuration (v3)`.
//
// Deliberately NOT `server-only`: `next.config.ts` (the CSP) and `proxy.ts`
// read it too. It holds no secret — it only checks that the secret key is set,
// and every sentence names a variable, never its value. `lib/config.ts` wraps
// these problems in its `ConfigError` for the boot.

type Env = Record<string, string | undefined>

export type AuthMode = 'clerk' | 'off' | 'test'

export const AUTH_MODES: readonly AuthMode[] = ['clerk', 'off', 'test']

/** Problems with the sign-in settings, by variable name; never a value. */
export class AuthConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The sign-in settings need fixing — ${problems.join('; ')}.`)
    this.name = 'AuthConfigError'
  }
}

/** The publishable key's names: the SDK reads the first, the learner's host has the second (mapped, not renamed). */
export const PUBLISHABLE_KEY_NAMES = ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_PUBLISHABLE_KEY'] as const
/** The studio's own address: what sign-in trusts and where `www` is sent. */
export const APP_URL_NAMES = ['APP_URL', 'NEXT_PUBLIC_APP_URL'] as const

/** Where sign-in and sign-up live; Clerk is told these, not left to read them from the environment. */
export const SIGN_IN_PATH = '/sign-in'
export const SIGN_UP_PATH = '/sign-up'

/** What a development desk trusts besides APP_URL. */
const LOCAL_ORIGIN = 'http://localhost:3000'

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
  if (!(AUTH_MODES as readonly string[]).includes(raw)) return ['INKDESK_AUTH must be clerk, off or test']
  if (production(env) && raw !== 'clerk') return ['INKDESK_AUTH must be clerk in production (off and test are for development and the checks)']
  return []
}

/**
 * The sign-in mode. Unset: `clerk` in production (any NODE_ENV but
 * development or unset — see `isProduction`), `off` otherwise, so a fresh
 * clone, `next dev` and every existing check keep working with no account. Throws
 * `AuthConfigError` for an unknown value, and for `off` or `test` in
 * production — a public studio never runs without sign-in, whoever asks.
 */
export function authMode(env: Env = process.env): AuthMode {
  const problems = modeProblems(env)
  if (problems.length > 0) throw new AuthConfigError(problems)
  const raw = env.INKDESK_AUTH?.trim()
  if (!raw) return production(env) ? 'clerk' : 'off'
  return raw as AuthMode
}

/**
 * The publishable key the root layout hands `<ClerkProvider>`, or undefined to
 * render bare: sign-in off or test, Clerk without its key, or a mode
 * production refuses. Never throws: `next build` prerenders the layout with
 * NODE_ENV=production whatever INKDESK_AUTH a development .env holds, and the
 * refusal belongs to the boot and the proxy, which decide who gets in — not to
 * the build (S19-REG-1). A page rendered bare lets nobody in.
 */
export function providerKey(env: Env = process.env): string | undefined {
  try {
    return authMode(env) === 'clerk' ? publishableKeyOf(env) : undefined
  } catch (err) {
    if (err instanceof AuthConfigError) return undefined
    throw err
  }
}

// --- Clerk's settings ---------------------------------------------------------

/**
 * The Frontend API host a publishable key names (`pk_test_` / `pk_live_` + the
 * base64 of `<host>$`), or null when the key is not one. Pure; the CSP and the
 * boot both use it, so neither needs Clerk loaded.
 */
export function frontendApiOf(publishableKey: string | undefined): string | null {
  const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey ?? '')
  if (!match) return null
  let decoded: string
  try {
    decoded = Buffer.from(match[2], 'base64').toString('utf8')
  } catch {
    return null
  }
  if (!decoded.endsWith('$')) return null
  const host = decoded.slice(0, -1)
  // A host name, nothing more: it goes into a CSP header.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host) ? host.toLowerCase() : null
}

/** The publishable key under either of its names, or undefined. */
export function publishableKeyOf(env: Env = process.env): string | undefined {
  return pick(env, PUBLISHABLE_KEY_NAMES)
}

/**
 * The Clerk host the CSP allows (`lib/csp.ts`): the Frontend API host in clerk mode, else null. Never throws — a mode
 * production refuses gets no host, and the boot stops that server with the sentence.
 */
export function clerkHostForCsp(env: Env = process.env): string | null {
  try {
    return authMode(env) === 'clerk' ? frontendApiOf(publishableKeyOf(env)) : null
  } catch (err) {
    if (err instanceof AuthConfigError) return null
    throw err
  }
}

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
 * The origins a Clerk session may come from (its `azp`), and that may send a
 * request that changes something: APP_URL and NEXT_PUBLIC_APP_URL, plus
 * `http://localhost:3000` outside production.
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

export type ClerkSettings = {
  publishableKey: string
  /** The PEM public key that lets a session be verified with no network call. Optional. */
  jwtKey: string | undefined
  authorizedParties: string[]
  /** The Frontend API host the browser loads Clerk from (the CSP allows it). */
  frontendApi: string
}

const SECRET_KEY = /^sk_(test|live)_[A-Za-z0-9]{20,}$/
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{16,}$/

/** A PEM public key, as Clerk's dashboard shows it (real or escaped newlines both pass). */
function looksLikePem(value: string): boolean {
  return /-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/.test(value.replace(/\\n/g, '\n'))
}

function secretProblems(env: Env): string[] {
  const secret = env.CLERK_SECRET_KEY?.trim()
  if (!secret) return ['CLERK_SECRET_KEY is not set']
  return SECRET_KEY.test(secret) ? [] : ['CLERK_SECRET_KEY must be a Clerk secret key (sk_test_… or sk_live_…)']
}

/**
 * What the worker needs of the sign-in settings: it never signs anyone in, but the deletion of an account ends the
 * person's Clerk sessions by deleting the Clerk user (`lib/account/clerk.ts`), which needs the secret key and nothing
 * else of Clerk's. Empty where the mode is not `clerk`. The worker's boot refuses to start on any of these, and the
 * deletion refuses before it changes anything.
 */
export function workerAuthProblems(env: Env = process.env): string[] {
  const problems = modeProblems(env)
  if (problems.length > 0) return problems
  return authMode(env) === 'clerk' ? secretProblems(env) : []
}

/** Every problem with the sign-in settings, by name. Empty when the mode needs nothing more. */
export function authProblems(env: Env = process.env): string[] {
  const problems = modeProblems(env)
  if (problems.length > 0) return problems
  if (authMode(env) !== 'clerk') return []

  const publishable = publishableKeyOf(env)
  const keyName = `${PUBLISHABLE_KEY_NAMES[0]} (or ${PUBLISHABLE_KEY_NAMES[1]})`
  if (!publishable) problems.push(`${keyName} is not set`)
  else if (!frontendApiOf(publishable)) problems.push(`${keyName} must be a Clerk publishable key (pk_test_… or pk_live_…)`)

  problems.push(...secretProblems(env))

  const jwtKey = env.CLERK_JWT_KEY?.trim()
  if (jwtKey && !looksLikePem(jwtKey)) problems.push('CLERK_JWT_KEY must be the PEM public key from Clerk’s dashboard (or be left unset)')

  const webhook = env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()
  if (webhook && !WEBHOOK_SECRET.test(webhook)) problems.push('CLERK_WEBHOOK_SIGNING_SECRET must be the whsec_… secret from Clerk’s webhook endpoint')

  for (const name of APP_URL_NAMES) {
    const value = env[name]?.trim()
    if (value && !originOf(value)) problems.push(`${name} must be an http:// or https:// address`)
  }
  // In production the studio's address decides whose sessions are trusted and
  // which pages may post; without it Clerk would accept a session minted for
  // any origin.
  if (production(env) && !appOrigin(env)) problems.push('APP_URL is not set (the studio’s own https:// address)')
  return problems
}

/** Clerk's settings for the proxy and the layout. Throws `AuthConfigError` naming every problem. */
export function clerkSettings(env: Env = process.env): ClerkSettings {
  const problems = authProblems(env)
  if (problems.length > 0) throw new AuthConfigError(problems)
  if (authMode(env) !== 'clerk') throw new AuthConfigError(['INKDESK_AUTH is not clerk, so there are no Clerk settings to read'])
  const publishableKey = publishableKeyOf(env) as string
  const jwtKey = env.CLERK_JWT_KEY?.trim()
  return {
    publishableKey,
    // Railway and .env files often carry a PEM on one line with literal \n.
    jwtKey: jwtKey ? jwtKey.replace(/\\n/g, '\n') : undefined,
    authorizedParties: authorizedParties(env),
    frontendApi: frontendApiOf(publishableKey) as string,
  }
}

// --- Request rules (the proxy's, pure so the checks can call them) -----------

/**
 * The API routes anyone may call: the deploy's health check and Clerk's webhooks (signed, checked in the route).
 *
 * `/api/s/` — the public share routes of slice 21 — is deliberately NOT here. It needs no session either (a
 * stranger holding a link has none), but this list also skips the proxy's Origin check, and a share route that
 * WRITES (the report form) must keep it: a page on another site may not post reports on a visitor's behalf.
 * Nothing in the proxy needs to name `/api/s/`: an API route answers for itself in clerk mode (`isApi`), so it
 * passes without a redirect, while `isCrossOrigin` still judges its writes. `check:auth` holds both facts.
 */
export const PUBLIC_API_PREFIXES = ['/api/health', '/api/webhooks/'] as const

/** Pages a signed-out visitor may open. `/s/` is the public share page (slice 21). */
const PUBLIC_PAGE_PREFIXES = [SIGN_IN_PATH, SIGN_UP_PATH, '/terms', '/privacy', '/s/'] as const

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
 * POST; a cookie with none is something else replaying a session). Clerk's
 * webhooks are exempt — they carry no cookie and are signed.
 */
export function isCrossOrigin(req: OriginInput, parties: readonly string[]): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false
  const url = new URL(req.url)
  if (!isApi(url.pathname) || under(url.pathname, '/api/webhooks')) return false
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
