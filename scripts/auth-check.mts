// Slice 19's sign-in rules (`devpost/spec.md > Revision v3 > Auth (v3)`,
// `devpost/security-report.md` SEC-01, SEC-10), against a scratch folder with
// `fetch` stubbed and fake settings made here — Better Auth runs for real, on
// an in-memory database: no MongoDB, no bucket, nothing outside this machine:
//
//   npm run check:auth
//
//   a. Every `app/api/**/route.ts` handler asks who is calling (`requireUser`,
//      or `requireAdmin`, which does) unless it is on the public list (the
//      health check) or is public by design: slice 21's `app/api/s/**`, the
//      share page's data, and Better Auth's own `app/api/auth/[...all]` — those
//      take NO session and must take an address window instead, before
//      anything else; under a project's address it checks the
//      owner before it reads a body, under `/api/shares/[token]` the share's
//      owner, under `/api/admin` the admin.
//   b. INKDESK_AUTH: off outside production, better in it; production refuses
//      off, test, and better without its secret or database — by name, never
//      by value.
//   c. requireUser in test mode (a valid header, none, a malformed one) and
//      in off mode.
//   d. Better Auth, for real, on a memory database (`authOptions`, the very
//      options production uses): sign-up (reopened 2026-10-25) makes an
//      UNVERIFIED account and a session, whatever the form claims; its record
//      carries no email, so it is on the free plan and never an admin even
//      when its address is on ALLOWLIST_EMAILS or ADMIN_EMAILS; a second
//      sign-up with that address is refused, saying no more than Better Auth
//      does; the learner's `createAccount` makes a verified account, and
//      `holdsPassword` (judge:account's guard) knows an account's own
//      password from any other; the studio's record carries the email only
//      while it is verified; sign-in
//      with a wrong password is refused; `currentUser` reads the session from
//      the cookie and nothing else; sign-out ends it; a write from another
//      origin is refused by Better Auth too; `deleteSignIn` removes the user,
//      its sessions and its sign-ins, and is safe to repeat.
//   e. The proxy: the Origin check (Better Auth's routes included), the www
//      redirect, the health check's host, and the redirect of a signed-out
//      page to `/sign-in?next=…` from the cookie alone — offline. `safeNext`
//      never sends anyone to another site.
//   f. The `/api/auth` route: 404 unless sign-in is on, a body too large is
//      refused unread, the `signin` and `signup` windows hold per client
//      address (the sixth account from one address in the hour is a 429 with
//      Retry-After; another address may), and with the counter store down a
//      sign-up is refused, never let through. The sign-in and sign-up pages,
//      rendered: open signed out, each linking to the other, and saying there
//      is no password reset; a signed-in visitor is sent to the desk.
//   g. The browser's apiFetch: a 401 sends the page to sign-in with the way
//      back, once, and never from the sign-in pages.
//   h. Admins (slice 21): ADMIN_EMAILS against the verified email, case-
//      insensitively; a deleted account, an unknown one and `local` (with
//      sign-in on) are not; a non-admin gets 404 "There is no such page.",
//      never 403; a store that is down promotes nobody.
//   i. Headers (slice 21): `/s/*` and `/api/s/*` are noindex, `/s/*` sends no
//      referrer, the CSP is the site's own; and the proxy keeps its Origin
//      check on the share routes' writes while leaving them open to a stranger.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'inkdesk-auth-'))
const env = process.env as Record<string, string | undefined>

// The sign-in and sign-up pages are rendered here without Next (section f2): the two request-scope functions they call
// are stood in for — `headers()` reads whatever the check set, `connection()` has nothing to wait for — and `next/server`
// only for those two pages, so the proxy keeps the real one.
const stubs = join(dir, '.stubs')
await mkdir(stubs, { recursive: true })
await writeFile(join(stubs, 'headers.cjs'), 'module.exports = { headers: async () => globalThis.__authCheckHeaders ?? new Headers() }')
await writeFile(join(stubs, 'server.cjs'), 'module.exports = { connection: async () => {} }')
const stubUrl = (name: string) => pathToFileURL(join(stubs, name)).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') return { url: stubUrl('headers.cjs'), format: 'commonjs', shortCircuit: true }
    if (specifier === 'next/server' && /\/app\/sign-(in|up)\//.test(decodeURIComponent(context.parentURL ?? ''))) return { url: stubUrl('server.cjs'), format: 'commonjs', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
/** The request the rendered pages see (section f2). */
const asRequest = (headers: Record<string, string>) => {
  ;(globalThis as { __authCheckHeaders?: Headers }).__authCheckHeaders = new Headers(headers)
}

// Whatever this shell holds — another app's sign-in, database or bucket — is
// never read here: every real credential is dropped before anything loads.
for (const name of Object.keys(env)) {
  if (/^(BETTER_AUTH_|S3_|DB_|MONGODB_|REDIS_|RAILWAY_)/.test(name)) delete env[name]
}
// …and neither are its limits. The windows below are keyed by the client address, which is read at TRUSTED_PROXY_HOPS
// from the right of X-Forwarded-For: a shell that sets TRUSTED_PROXY_HOPS=2 (this one did, on 2026-10-25) makes the
// one-entry header these requests carry name no address, so every request shares the `unknown` window — by design —
// and "another address may still try" fails for a reason that is not the code's. The check sets what it tests.
for (const name of Object.keys(env)) {
  if (/^(RATE_|QUOTA_|USER_DAILY_|GLOBAL_|TRUSTED_PROXY_HOPS$|CLIENT_IP_HEADER$)/.test(name)) delete env[name]
}
for (const name of ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'INKDESK_AUTH', 'INKDESK_QUEUE', 'GENERATION_ENABLED', 'CONTACT_EMAIL', 'INKDESK_LIMITS', 'ADMIN_EMAILS', 'ALLOWLIST_EMAILS']) delete env[name]
env.INKDESK_DATA_DIR = dir
env.INKDESK_STORAGE = 'local'
env.BETTER_AUTH_TELEMETRY = '0' // Better Auth asks nothing of the network here
const NODE_ENV = env.NODE_ENV
delete env.NODE_ENV

const realFetch = globalThis.fetch
const outbound: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  throw new Error('auth-check: nothing here may reach the network')
}) as typeof fetch

// --- Fake settings, made here and never valid anywhere ---------------------------
const SECRET = randomBytes(32).toString('base64')
const APP = 'https://inkdesk.example'

const ok = (line: string) => console.log(`  ok  ${line}`)

/** Run `fn` with these variables set (undefined = unset), then put everything back. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]))
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
  }
}

/** Better mode's settings, all fake: nothing here connects (the accounts' database below is in memory). */
const betterEnv = (extra: Record<string, string | undefined> = {}) => ({
  INKDESK_AUTH: 'better',
  BETTER_AUTH_SECRET: SECRET,
  MONGODB_URI: 'mongodb://auth-check.invalid:27017/',
  MONGODB_DB: 'auth_check',
  APP_URL: APP,
  ...extra,
})

try {
  // --- a. Every API route asks who is calling --------------------------------------
  const { scanRoute, PUBLIC_ROUTES } = await (async () => {
    const PUBLIC_ROUTES = ['app/api/health/route.ts']
    /** Better Auth's own route: public by design (a signed-out person signs in there), so it is judged whole below. */
    const AUTH_ROUTE = 'app/api/auth/[...all]/route.ts'
    const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    const BODY = /\b(readJson|parseJson|readForm|readBytes|req\.json|req\.formData|req\.text|req\.arrayBuffer)\s*\(/
    /** Each exported handler's own text: from its `export` to the closing brace at column 0. */
    function handlers(source: string): { method: string; body: string }[] {
      const found: { method: string; body: string }[] = []
      const re = /^export\s+(?:async\s+)?function\s+([A-Z]+)\s*\(|^export\s+const\s+([A-Z]+)\s*=/gm
      for (let m = re.exec(source); m; m = re.exec(source)) {
        const method = m[1] ?? m[2]
        if (!METHODS.includes(method)) continue
        const end = source.indexOf('\n}', m.index)
        found.push({ method, body: source.slice(m.index, end === -1 ? undefined : end) })
      }
      return found
    }
    /** What is wrong with one route file; empty when nothing is. */
    function scanRoute(path: string, source: string): string[] {
      if (PUBLIC_ROUTES.includes(path)) return []
      const problems: string[] = []
      if (path === AUTH_ROUTE) {
        // Its handlers are one shared function: the guard (sign-in on, the body cap, the address windows) runs before Better Auth sees the request.
        if (/\b(requireUser|requireAdmin)\(/.test(source)) problems.push(`${path}: is public by design and must take no session`)
        for (const needle of ['signInOn()', "limitByAddress(req, 'signin')", "limitByAddress(req, 'signup')", "limitByAddress(req, 'anon')", 'BODY_LIMIT_BYTES']) {
          if (!source.includes(needle)) problems.push(`${path}: is missing ${needle}`)
        }
        const handle = source.slice(source.indexOf('async function handle('))
        // Better Auth must be handed the guard's result — the request the guard rebuilt on the bytes it read (2026-10-25:
        // the body is read here, capped, so the caller's own stream never reaches Better Auth) — and only after it.
        const guarded = /const (\w+) = await guard\(req\)/.exec(handle)
        const guard = guarded ? guarded.index : -1
        const handler = guarded ? handle.indexOf(`.handler(${guarded[1]})`) : -1
        if (guard === -1 || handler === -1 || handler < guard || handle.includes('.handler(req)')) problems.push(`${path}: Better Auth sees the request before the guard`)
        return problems
      }
      const list = handlers(source)
      if (list.length === 0) problems.push(`${path}: no handler found to check`)
      for (const { method, body } of list) {
        const firstOf = (...needles: string[]) => {
          const found = needles.map((n) => body.indexOf(n)).filter((i) => i !== -1)
          return found.length === 0 ? -1 : Math.min(...found)
        }
        const read = body.search(BODY)
        // Public by design (slice 21): the share page's data. A stranger holding a link has no session, so the route takes
        // none — and takes a window keyed by the client address instead, before it reads anything.
        if (path.startsWith('app/api/s/')) {
          const window = body.indexOf('limitByAddress(')
          if (window === -1) problems.push(`${path} ${method}: a public route takes no address window (limitByAddress)`)
          if (/\b(requireUser|requireAdmin)\(/.test(body)) problems.push(`${path} ${method}: is public by design and must take no session`)
          if (window !== -1 && read !== -1 && read < window) problems.push(`${path} ${method}: reads the body before its address window`)
          continue
        }
        // `requireAdmin` calls `requireUser` and then answers 404 to anyone who is not an admin.
        const asks = firstOf('requireUser(', 'requireAdmin(')
        // The v2 image route answers 404 for everything unless sign-in is off,
        // where there is one owner; that is its whole check.
        const offOnly = /^\s*if \(authMode\(\) !== 'off'\) return\b/m.test(body.split('\n').slice(1, 3).join('\n'))
        if (asks === -1 && !offOnly) {
          problems.push(`${path} ${method}: neither calls requireUser nor is on the public list`)
          continue
        }
        if (path.startsWith('app/api/projects/[id]/') && !offOnly) {
          const owned = body.search(/\bownedProject(Stamp)?\(/)
          if (owned === -1) problems.push(`${path} ${method}: does not check the project’s owner (ownedProject)`)
          if (read !== -1 && (owned === -1 || read < owned || read < asks)) problems.push(`${path} ${method}: reads the body before the owner is checked`)
          const flag = body.indexOf('assertGenerationEnabled(')
          if (flag !== -1 && owned !== -1 && flag < owned) problems.push(`${path} ${method}: checks the generation flag before the owner`)
        }
        if (path.startsWith('app/api/shares/[token]')) {
          const owned = body.indexOf('ownedShare(')
          if (owned === -1) problems.push(`${path} ${method}: does not check the share’s owner (ownedShare)`)
          if (read !== -1 && (owned === -1 || read < owned || read < asks)) problems.push(`${path} ${method}: reads the body before the owner is checked`)
        }
        if (path.startsWith('app/api/admin/')) {
          const admin = body.indexOf('requireAdmin(')
          if (admin === -1) problems.push(`${path} ${method}: does not call requireAdmin`)
          if (read !== -1 && (admin === -1 || read < admin)) problems.push(`${path} ${method}: reads the body before the admin is checked`)
        }
        if (/\/jobs?\//.test(path) && !body.includes('ownedJob(')) problems.push(`${path} ${method}: does not check the job’s owner (ownedJob)`)
      }
      return problems
    }
    return { scanRoute, PUBLIC_ROUTES }
  })()

  async function routeFiles(from: string): Promise<string[]> {
    const out: string[] = []
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const path = join(from, entry.name)
      if (entry.isDirectory()) out.push(...(await routeFiles(path)))
      else if (entry.name === 'route.ts') out.push(relative(ROOT, path))
    }
    return out
  }
  const routes = await routeFiles(join(ROOT, 'app/api'))
  assert.ok(routes.length >= 15, `expected the studio’s API routes, found ${routes.length}`)
  for (const pub of PUBLIC_ROUTES) assert.ok(routes.includes(pub), `${pub} exists`)
  const problems: string[] = []
  for (const path of routes) problems.push(...scanRoute(path, await readFile(join(ROOT, path), 'utf8')))
  assert.deepEqual(problems, [], `routes that do not ask who is calling:\n  ${problems.join('\n  ')}`)
  // The scanner itself: a handler with no check, and one that reads first, are caught.
  assert.equal(scanRoute('app/api/x/route.ts', 'export async function POST(req: Request) {\n  return Response.json(await req.json())\n}\n').length, 1)
  assert.match(
    scanRoute('app/api/projects/[id]/x/route.ts', 'export async function POST(req: Request) {\n  const b = await readJson(req, 1)\n  const u = await requireUser(req)\n  await ownedProject(u, "x")\n}\n').join(),
    /reads the body before the owner/
  )
  assert.match(scanRoute('app/api/projects/[id]/y/route.ts', 'export async function GET(req: Request) {\n  await requireUser(req)\n}\n').join(), /ownedProject/)
  // Slice 21's shapes. A route that is neither requireUser/requireAdmin nor public-by-design still fails…
  assert.match(scanRoute('app/api/settings/z/route.ts', 'export async function GET(req: Request) {\n  return Response.json({})\n}\n').join(), /neither calls requireUser nor is on the public list/)
  assert.equal(scanRoute('app/api/settings/z/route.ts', 'export async function GET(req: Request) {\n  await requireUser(req)\n}\n').length, 0)
  // …a public share route takes no session and DOES take an address window, before anything is read…
  const publicGood = 'export async function POST(req: Request) {\n  await limitByAddress(req, \'report\')\n  const b = await readJson(req, 1)\n}\n'
  assert.deepEqual(scanRoute('app/api/s/[token]/report/route.ts', publicGood), [], 'a public route that takes its address window first passes')
  assert.match(scanRoute('app/api/s/[token]/route.ts', 'export async function GET(req: Request) {\n  return Response.json({})\n}\n').join(), /takes no address window/, 'a public route without a window is caught')
  assert.match(scanRoute('app/api/s/[token]/route.ts', 'export async function GET(req: Request) {\n  await requireUser(req)\n  await limitByAddress(req)\n}\n').join(), /take no session/, 'a public route that asks for a session is caught')
  assert.match(scanRoute('app/api/s/[token]/report/route.ts', 'export async function POST(req: Request) {\n  const b = await readJson(req, 1)\n  await limitByAddress(req, \'report\')\n}\n').join(), /reads the body before its address window/)
  assert.match(scanRoute('app/api/projects/[id]/s/route.ts', 'export async function GET(req: Request) {\n  await limitByAddress(req)\n}\n').join(), /neither calls requireUser/, 'only app/api/s/ is public by design: an address window is no substitute for a session elsewhere')
  // …owner-managed share routes check the share’s owner first, admin routes the admin…
  assert.match(scanRoute('app/api/shares/[token]/route.ts', 'export async function DELETE(req: Request) {\n  await requireUser(req)\n}\n').join(), /ownedShare/)
  assert.match(scanRoute('app/api/shares/[token]/route.ts', 'export async function PUT(req: Request) {\n  const u = await requireUser(req)\n  const b = await readJson(req, 1)\n  await ownedShare(u, "t")\n}\n').join(), /reads the body before the owner/)
  assert.deepEqual(scanRoute('app/api/shares/[token]/route.ts', 'export async function DELETE(req: Request) {\n  const u = await requireUser(req)\n  await ownedShare(u, "t")\n}\n'), [])
  assert.match(scanRoute('app/api/admin/reports/[id]/route.ts', 'export async function POST(req: Request) {\n  await requireUser(req)\n}\n').join(), /does not call requireAdmin/)
  assert.match(scanRoute('app/api/admin/reports/[id]/route.ts', 'export async function POST(req: Request) {\n  const b = await readJson(req, 1)\n  await requireAdmin(req)\n}\n').join(), /reads the body before the admin is checked/)
  assert.deepEqual(scanRoute('app/api/admin/reports/[id]/route.ts', 'export async function POST(req: Request) {\n  await requireAdmin(req)\n  const b = await readJson(req, 1)\n}\n'), [])
  assert.ok(routes.includes('app/api/auth/[...all]/route.ts'), 'Better Auth’s route exists')
  assert.ok(!routes.some((r) => r.includes('webhooks')), 'there is no webhook any more')
  assert.match(scanRoute('app/api/auth/[...all]/route.ts', 'async function handle(req) {\n  return getAuth().handler(req)\n}\nexport const POST = handle\n').join(), /missing signInOn/, 'an unguarded auth route is caught')
  const sessionless = routes.filter((r) => r.startsWith('app/api/s/'))
  ok(`all ${routes.length} API routes ask who is calling (public: ${PUBLIC_ROUTES.map((p) => p.split('/').slice(2, -1).join('/')).join(', ')}; public by design, with an address window and no session: ${sessionless.length} under /api/s, and Better Auth’s /api/auth behind its guard); project, share and admin routes check the owner before the body`)

  // --- b. The mode, its defaults and production's refusals ---------------------------
  const authConfig = await import('../lib/auth/config')
  const { authMode, AuthConfigError, authProblems, workerAuthProblems, betterSettings, authorizedParties, signInOn } = authConfig
  const config = await import('../lib/config')
  const { authSettings, ConfigError } = config

  assert.equal(authMode({}), 'off', 'unset outside production: off')
  assert.equal(authMode({ NODE_ENV: 'development' }), 'off')
  assert.equal(authMode({ NODE_ENV: 'production' }), 'better', 'unset in production: better')
  // `next start` keeps any NODE_ENV it is given: anything but development (or unset) is a public server (S19-SEC-1).
  for (const nodeEnv of ['test', 'staging', ' production ', 'Development']) {
    assert.equal(authMode({ NODE_ENV: nodeEnv }), 'better', `NODE_ENV=${nodeEnv}, INKDESK_AUTH unset: better, never off`)
    for (const mode of ['off', 'test']) {
      assert.throws(() => authMode({ NODE_ENV: nodeEnv, INKDESK_AUTH: mode }), AuthConfigError, `NODE_ENV=${nodeEnv} refuses INKDESK_AUTH=${mode}`)
    }
    assert.deepEqual(authorizedParties({ NODE_ENV: nodeEnv, APP_URL: APP }), [APP], `NODE_ENV=${nodeEnv} trusts no localhost`)
  }
  assert.equal(authMode({ NODE_ENV: 'development', INKDESK_AUTH: 'test' }), 'test', 'next dev may play two people')
  assert.equal(authMode({ INKDESK_AUTH: 'test' }), 'test')
  assert.equal(authMode({ INKDESK_AUTH: ' better ' }), 'better')
  assert.equal(authMode({ NODE_ENV: 'production', INKDESK_AUTH: 'better' }), 'better')
  for (const mode of ['off', 'test']) {
    assert.throws(() => authMode({ NODE_ENV: 'production', INKDESK_AUTH: mode }), (err: unknown) => {
      assert.ok(err instanceof AuthConfigError)
      assert.match(err.message, /INKDESK_AUTH must be better in production/)
      return true
    })
  }
  // The old mode is gone, and says so rather than falling open.
  for (const value of ['maybe-later', 'clerk']) {
    assert.throws(() => authMode({ INKDESK_AUTH: value }), (err: unknown) => {
      assert.ok(err instanceof AuthConfigError && /INKDESK_AUTH must be better, off or test/.test(err.message))
      assert.ok(!err.message.includes(value), 'the value is never repeated')
      return true
    })
  }

  // Production, better, nothing set: every missing name, one sentence.
  const missing = (() => {
    try {
      authSettings({ NODE_ENV: 'production' })
    } catch (err) {
      assert.ok(err instanceof ConfigError, 'the boot’s own error')
      return err.message
    }
    return assert.fail('production without the sign-in settings must be refused')
  })()
  for (const name of ['BETTER_AUTH_SECRET is not set', 'MONGODB_URI (or DB_URL) is not set', 'MONGODB_DB (or DB_DATABASE) is not set', 'APP_URL is not set']) {
    assert.ok(missing.includes(name), `names ${name}: ${missing}`)
  }
  assert.match(refused(() => authSettings({ NODE_ENV: 'production', INKDESK_AUTH: 'off' })), /INKDESK_AUTH must be better in production/)
  assert.match(refused(() => authSettings({ NODE_ENV: 'production', INKDESK_AUTH: 'test' })), /INKDESK_AUTH must be better in production/)
  // Malformed values are named, never repeated — a secret-looking value least of all.
  const leaky = { NODE_ENV: 'production', BETTER_AUTH_SECRET: 'SECRETSHORT', MONGODB_URI: 'SECRETURI', MONGODB_DB: 'SECRET.DB', APP_URL: 'SECRETURL' }
  const malformed = refused(() => authSettings(leaky))
  for (const name of ['BETTER_AUTH_SECRET must be at least 32', 'MONGODB_URI (or DB_URL) must be', 'MONGODB_DB (or DB_DATABASE) must be', 'APP_URL must be']) assert.ok(malformed.includes(name), `names ${name}: ${malformed}`)
  assert.ok(!/SECRET(SHORT|URI|\.DB|URL)/.test(malformed), 'no value appears in the sentence')
  // Good settings pass. Email and password is the only way in: no outside sign-in is configured or configurable.
  assert.deepEqual(authSettings({ NODE_ENV: 'production', ...betterEnv() }), { mode: 'better' })
  const settings = betterSettings(betterEnv({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' }))
  assert.deepEqual(Object.keys(settings).sort(), ['authorizedParties', 'baseURL', 'mongoDb', 'mongoUrl', 'secret'], 'a stray provider key changes nothing')
  assert.equal(settings.baseURL, APP)
  assert.equal(betterSettings(betterEnv({ APP_URL: undefined })).baseURL, 'http://localhost:3000', 'a development desk answers on localhost')
  assert.deepEqual(authorizedParties({ APP_URL: `${APP}/some/path`, NEXT_PUBLIC_APP_URL: 'https://app.inkdesk.example' }), [APP, 'https://app.inkdesk.example', 'http://localhost:3000'])
  assert.deepEqual(authorizedParties({ NODE_ENV: 'production', APP_URL: APP }), [APP], 'no localhost in production')
  // The renderers' read never throws: `next build` runs with NODE_ENV=production whatever a development .env says (S19-REG-1).
  for (const mode of ['off', 'test', 'maybe-later']) assert.equal(signInOn({ NODE_ENV: 'production', INKDESK_AUTH: mode }), false, `a build with INKDESK_AUTH=${mode} renders no account menu`)
  assert.equal(signInOn({ NODE_ENV: 'production' }), true)
  for (const file of ['components/AuthControls.tsx', 'app/api/auth/[...all]/route.ts']) {
    const source = await readFile(join(ROOT, file), 'utf8')
    assert.ok(source.includes('signInOn(') && !/\bauthMode\(/.test(source), `${file} reads the mode through signInOn, which cannot fail a build`)
  }
  assert.ok(!(await readFile(join(ROOT, 'app/layout.tsx'), 'utf8')).includes('auth'), 'the root layout carries no sign-in provider at all')
  assert.deepEqual(authProblems({ INKDESK_AUTH: 'off' }), [], 'off needs nothing')
  assert.deepEqual(authProblems({ INKDESK_AUTH: 'test' }), [], 'test needs nothing')
  assert.ok(authProblems({ INKDESK_AUTH: 'better' }).length >= 3, 'better in development still needs its secret and its database')
  // The worker never signs anyone in, but deleting an account ends its sign-in: in better mode it needs the secret and the accounts' database.
  const workerEnv = { NODE_ENV: 'production', BETTER_AUTH_SECRET: SECRET, MONGODB_URI: 'mongodb://check.invalid:27017/', MONGODB_DB: 'check' }
  assert.deepEqual(workerAuthProblems(workerEnv), [], 'a production worker with the secret and the database is fine without APP_URL')
  assert.deepEqual(workerAuthProblems({ ...workerEnv, BETTER_AUTH_SECRET: undefined }), ['BETTER_AUTH_SECRET is not set'], 'a production worker without the secret is refused')
  assert.match(workerAuthProblems({ ...workerEnv, BETTER_AUTH_SECRET: 'short' })[0], /at least 32 characters/)
  assert.match(workerAuthProblems({ ...workerEnv, MONGODB_URI: undefined }).join(), /MONGODB_URI \(or DB_URL\) is not set/)
  assert.deepEqual(workerAuthProblems({ INKDESK_AUTH: 'off' }), [], 'off needs nothing')
  assert.deepEqual(workerAuthProblems({}), [], 'a bare development worker needs nothing')
  assert.ok(workerAuthProblems({ NODE_ENV: 'production', INKDESK_AUTH: 'off' }).length > 0, 'production off is refused here too')

  // The boot: production stops with the one sentence; development keeps its old behaviour.
  const { boot } = await import('../lib/boot')
  const exits: string[] = []
  const realExit = process.exit
  const realError = console.error
  const realLog = console.log
  const stopped = async (vars: Record<string, string | undefined>) => {
    exits.length = 0
    process.exit = ((code?: number) => {
      throw Object.assign(new Error('exit'), { exitCode: code })
    }) as typeof process.exit
    console.error = (...args: unknown[]) => void exits.push(args.map(String).join(' '))
    console.log = () => {}
    try {
      await withEnv(vars, () => boot())
      return null
    } catch (err) {
      return (err as { exitCode?: number }).exitCode ?? null
    } finally {
      process.exit = realExit
      console.error = realError
      console.log = realLog
    }
  }
  assert.equal(await stopped({ NODE_ENV: 'production', INKDESK_AUTH: 'off' }), 1, 'production with sign-in off does not start')
  assert.match(exits.join(), /INKDESK_AUTH must be better in production/)
  assert.equal(await stopped({ NODE_ENV: 'production', INKDESK_AUTH: 'test' }), 1)
  assert.equal(await stopped({ NODE_ENV: 'production' }), 1, 'production without the sign-in settings does not start')
  assert.match(exits.join(), /BETTER_AUTH_SECRET is not set/)
  assert.equal(await stopped({ NODE_ENV: 'production', PANEL_CONCURRENCY: 'many' }), 1)
  assert.match(exits.join(), /PANEL_CONCURRENCY must be.*BETTER_AUTH_SECRET is not set/, 'every problem, config and sign-in, in one sentence')
  assert.equal(await stopped({ NODE_ENV: 'test' }), 1, 'NODE_ENV=test with sign-in unset is better, and without its settings does not start')
  assert.match(exits.join(), /BETTER_AUTH_SECRET is not set/)
  assert.equal(await stopped({ NODE_ENV: 'staging', INKDESK_AUTH: 'test' }), 1, 'nor does a staging server in test mode')
  assert.match(exits.join(), /INKDESK_AUTH must be better in production/)
  assert.equal(await stopped({ NODE_ENV: 'development', INKDESK_AUTH: 'test' }), null, 'next dev in test mode starts')
  // Production also runs on Mongo and the buckets (after-audit #10): placeholders here, nothing connects at boot.
  const cloudEnv = { INKDESK_STORAGE: 'cloud', MONGODB_URI: 'mongodb://boot-check.invalid:27017/', MONGODB_DB: 'boot_check', S3_ENDPOINT: 'https://s3.boot-check.invalid', S3_REGION: 'auto', S3_BUCKET_PROJECT_FILES: 'boot-check', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'secret' }
  assert.equal(await stopped({ NODE_ENV: 'production', ...betterEnv() }), 1, 'production with its sign-in settings on the local desk does not start')
  assert.match(exits.join(), /INKDESK_STORAGE must be cloud in production/)
  assert.equal(await stopped({ NODE_ENV: 'production', ...betterEnv(), ...cloudEnv }), null, 'production with its sign-in and cloud settings starts')
  ok('INKDESK_AUTH: off in development, better under any other NODE_ENV (test, staging included); `clerk` is refused; production refuses off, test, a missing or short secret, and no database at boot, in one sentence of names, never values; the renderers’ read never fails a build')

  // --- c. requireUser ------------------------------------------------------------------
  const { requireUser, currentUser, LOCAL_OWNER, SIGN_IN_SENTENCE, TEST_USER_HEADER } = await import('../lib/auth/session')
  const { Refused } = await import('../lib/errors')
  const asking = (user?: string) => new Request('http://check/api/projects', user === undefined ? {} : { headers: { [TEST_USER_HEADER]: user } })
  const signInRefusal = async (req: Request) => {
    await assert.rejects(requireUser(req), (err: unknown) => {
      assert.ok(err instanceof Refused, `expected Refused, got ${String(err)}`)
      assert.equal(err.status, 401)
      assert.equal(err.message, SIGN_IN_SENTENCE)
      return true
    })
  }
  await withEnv({ INKDESK_AUTH: 'test' }, async () => {
    assert.equal(await requireUser(asking('user_alice1')), 'user_alice1')
    assert.equal(await currentUser(asking('user_B')), 'user_B')
    await signInRefusal(asking())
    for (const bad of ['', 'alice', 'user_', 'user_../../x', 'user_a b', `user_${'a'.repeat(41)}`, 'USER_abc', 'local']) await signInRefusal(asking(bad))
    assert.equal(await currentUser(asking('user_x/1')), null)
  })
  await withEnv({ INKDESK_AUTH: 'off' }, async () => {
    assert.equal(await requireUser(asking()), LOCAL_OWNER)
    assert.equal(await requireUser(asking('user_alice1')), LOCAL_OWNER, 'off mode ignores the test header')
    assert.equal(LOCAL_OWNER, 'local')
  })
  assert.equal(await requireUser(asking('user_alice1')), LOCAL_OWNER, 'unset outside production is off')
  ok('requireUser: test mode takes a well-formed header and refuses none or a malformed one with 401 and the one sentence; off mode is always "local"')

  // --- d. Better Auth, for real, on a memory database --------------------------------------
  const { store } = await import('../lib/store')
  const { betterAuth } = await import('better-auth')
  const { memoryAdapter } = await import('better-auth/adapters/memory')
  const authServer = await import('../lib/auth/server')
  const memory = { user: [], session: [], account: [], verification: [] } as Record<string, Record<string, unknown>[]>
  // The very options production uses (`authOptions`), on a memory database instead of MongoDB.
  const testAuth = betterAuth(authServer.authOptions({ secret: SECRET, baseURL: APP, authorizedParties: [APP] }, memoryAdapter(memory)))
  /** Make `getAuth()` answer with the memory instance for these settings — the check's seam; production builds its own on MongoDB. */
  const pinAuth = () => {
    ;(globalThis as { __inkdeskAuth?: unknown }).__inkdeskAuth = { key: JSON.stringify(betterSettings()), auth: testAuth }
  }
  const authCall = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    testAuth.handler(
      new Request(`${APP}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { origin: APP, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    )
  /** The session cookie a reply set, as a request's `cookie` header. */
  const cookieOf = (res: Response): string => {
    const set = res.headers.getSetCookie().find((c) => /inkdesk\.session_token=/.test(c))
    assert.ok(set, `a session cookie was set (${res.headers.getSetCookie().join(' | ')})`)
    assert.match(set, /HttpOnly/i, 'the session cookie is HttpOnly')
    assert.match(set, /SameSite=Lax/i, 'and SameSite=Lax')
    return set.split(';')[0]
  }
  await withEnv(betterEnv(), async () => {
    pinAuth()
    // Anyone may sign up (reopened 2026-10-25): an account and a session at once — UNVERIFIED, since nothing was sent to prove the address.
    const signedUp = await authCall('/sign-up/email', { email: 'Alice@Inkdesk.invalid', password: 'correct horse battery', name: 'Alice' })
    assert.equal(signedUp.status, 200, await signedUp.clone().text())
    const alice = ((await signedUp.clone().json()) as { user: { id: string; emailVerified: boolean } }).user
    assert.match(alice.id, authConfig.ACCOUNT_ID, 'an account id the scripts accept')
    assert.equal(alice.emailVerified, false, 'an address typed at sign-up is not verified: nothing was sent to prove it')
    const aliceCookie = cookieOf(signedUp)
    assert.match(aliceCookie, /^__Secure-inkdesk\.session_token=/, 'on an https studio the cookie is __Secure-')
    const record = await store.users.get(alice.id)
    assert.ok(record, 'the studio’s own record exists the moment the account is made — the same hook as for an account the learner makes')
    assert.equal(record.email, '', 'and carries no address while it is unverified — the allowlist and ADMIN_EMAILS cannot match it')
    // Claiming to be verified changes nothing: Better Auth writes false whatever the form sends.
    const claimed = await authCall('/sign-up/email', { email: 'mallory@inkdesk.invalid', password: 'correct horse battery', name: 'M', emailVerified: true })
    assert.equal(claimed.status, 200)
    const mallory = ((await claimed.json()) as { user: { id: string; emailVerified: boolean } }).user
    assert.equal(mallory.emailVerified, false, 'a form that says emailVerified: true still makes an unverified account')
    assert.equal((await store.users.get(mallory.id))?.email, '', 'and its record carries no address')
    // A self-made account is on the free plan, and never an admin — even with its address on both lists.
    const { planOf, forgetPlans } = await import('../lib/limits/plan')
    const { isAdmin: isAdminNow, forgetAdmins: forgetAdminsNow } = await import('../lib/auth/admin')
    await withEnv({ ALLOWLIST_EMAILS: 'alice@inkdesk.invalid, mallory@inkdesk.invalid', ADMIN_EMAILS: 'alice@inkdesk.invalid,mallory@inkdesk.invalid' }, async () => {
      forgetPlans()
      forgetAdminsNow()
      for (const who of [alice.id, mallory.id]) {
        assert.equal(await planOf(who), 'free', 'a self-made account stays on the free plan, though its address is on ALLOWLIST_EMAILS')
        assert.equal(await isAdminNow(who), false, 'and is no admin, though its address is on ADMIN_EMAILS')
      }
    })
    forgetPlans()
    forgetAdminsNow()
    // One account per address: a second sign-up (another case, another password) is refused, makes nothing and changes nothing.
    const usersBefore = memory.user.length
    const dup = await authCall('/sign-up/email', { email: 'alice@INKDESK.invalid', password: 'another long one', name: 'x' })
    assert.equal(dup.status, 422, `a second sign-up with that address is refused (got ${dup.status})`)
    assert.equal(dup.headers.getSetCookie().length, 0, 'and sets no cookie')
    const dupText = await dup.text()
    assert.equal((JSON.parse(dupText) as { code?: string }).code, 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'Better Auth’s own refusal')
    assert.ok(!dupText.includes(alice.id) && !/alice|createdAt|"user"/i.test(dupText), `it names no account and gives no detail of it: ${dupText}`)
    const { authSentence } = await import('../lib/auth/client')
    assert.equal(authSentence(JSON.parse(dupText) as { code: string; message: string }, 'x'), 'There is already an account with that email. Sign in instead.', 'the card says what Better Auth says, and no more')
    assert.equal(memory.user.length, usersBefore, 'no second account')
    assert.equal((await authCall('/sign-in/email', { email: 'alice@inkdesk.invalid', password: 'another long one' })).status, 401, 'the refused sign-up’s password opens nothing')
    // The password rule is the sign-in's: 10 to 128 characters; a name is Better Auth's to require.
    for (const [body, why] of [
      [{ email: 'short@inkdesk.invalid', password: 'short', name: 'x' }, 'a password under ten characters'],
      [{ email: 'long@inkdesk.invalid', password: 'x'.repeat(129), name: 'x' }, 'a password over 128 characters'],
      [{ email: 'noname@inkdesk.invalid', password: 'correct horse battery' }, 'no name'],
      [{ email: 'not-an-address', password: 'correct horse battery', name: 'x' }, 'not an address'],
    ] as const) {
      const res = await authCall('/sign-up/email', body)
      assert.equal(res.status, 400, `${why} is refused (got ${res.status})`)
      assert.equal(res.headers.getSetCookie().length, 0)
    }
    assert.equal(memory.user.length, usersBefore, 'and none of them made an account')

    // The learner's way (judge:account → createAccount): a VERIFIED account, which the allowlist can match.
    const made = await authServer.createAccount(testAuth, { email: 'Judge@Inkdesk.invalid', password: 'a judge’s long password' })
    assert.match(made.id, authConfig.ACCOUNT_ID)
    assert.equal((await store.users.get(made.id))?.email, 'judge@inkdesk.invalid', 'its record carries the address, verified by the learner who made it (lower-cased)')
    await assert.rejects(authServer.createAccount(testAuth, { email: 'judge@inkdesk.invalid', password: 'another long one' }), /already an account/, 'one account per address')
    await assert.rejects(authServer.createAccount(testAuth, { email: 'alice@inkdesk.invalid', password: 'another long one' }), /already an account/, 'an address already signed up included')
    await assert.rejects(authServer.createAccount(testAuth, { email: 'short@inkdesk.invalid', password: 'short' }), /10 to 128/, 'a password under ten characters is refused')
    await withEnv({ ALLOWLIST_EMAILS: 'judge@inkdesk.invalid' }, async () => {
      forgetPlans()
      assert.equal(await planOf(made.id), 'allowlisted', 'a verified account on ALLOWLIST_EMAILS gets the allowlisted plan')
    })
    forgetPlans()
    assert.equal((await authCall('/sign-in/email', { email: 'judge@inkdesk.invalid', password: 'a judge’s long password' })).status, 200, 'and signs in')
    // judge:account marks an UNVERIFIED account verified only on that account's own password (sign-up is open: it may be a stranger's).
    assert.equal(await authServer.holdsPassword(testAuth, alice.id, 'correct horse battery'), true, 'the account’s own password')
    for (const wrong of ['a judge’s long password', 'correct horse batterY', '', 'x'.repeat(129)]) assert.equal(await authServer.holdsPassword(testAuth, alice.id, wrong), false, 'any other is not')
    assert.equal(await authServer.holdsPassword(testAuth, 'no-such-account-id-000000', 'correct horse battery'), false, 'nor is an unknown account')
    const judgeScript = await readFile(join(ROOT, 'scripts/judge-account.mts'), 'utf8')
    assert.match(judgeScript, /!found\.user\.emailVerified && !\(await holdsPassword\(auth, found\.user\.id, password\)\)/, 'judge:account asks holdsPassword before verifying an unverified account')
    assert.ok(judgeScript.indexOf('holdsPassword(auth') < judgeScript.indexOf('updateUser(userId, { emailVerified: true })'), 'before it writes anything')

    // currentUser reads the session from the cookie, checked against the database.
    const asked = (cookie?: string) => new Request(`${APP}/api/projects`, cookie ? { headers: { cookie } } : {})
    assert.equal(await currentUser(asked(aliceCookie)), alice.id)
    assert.equal(await currentUser(asked()), null, 'no cookie, nobody')
    assert.equal(await currentUser(asked('__Secure-inkdesk.session_token=forged.value')), null, 'a forged cookie is nobody')
    assert.equal(await currentUser(asked(`${aliceCookie}x`)), null, 'an altered cookie is nobody')
    assert.equal(await requireUser(asked(aliceCookie)), alice.id)
    await signInRefusal(asked())
    // A test-mode header means nothing here.
    assert.equal(await currentUser(new Request(`${APP}/api/projects`, { headers: { [TEST_USER_HEADER]: 'user_alice1' } })), null)

    // Sign-in: the right password opens a second session; a wrong one, or an unknown address, is refused.
    const signedIn = await authCall('/sign-in/email', { email: 'alice@inkdesk.invalid', password: 'correct horse battery' })
    assert.equal(signedIn.status, 200)
    const secondCookie = cookieOf(signedIn)
    for (const wrong of [{ email: 'alice@inkdesk.invalid', password: 'wrong horse battery' }, { email: 'nobody@inkdesk.invalid', password: 'correct horse battery' }]) {
      const res = await authCall('/sign-in/email', wrong)
      assert.equal(res.status, 401, 'a wrong password or an unknown address is refused, the same way')
      assert.equal(res.headers.getSetCookie().length, 0, 'and sets no cookie')
    }
    // A write from another origin, carrying the session: Better Auth refuses it too (the proxy already has).
    const crossSite = await authCall('/sign-out', {}, { origin: 'https://evil.example', cookie: aliceCookie })
    assert.equal(crossSite.status, 403, `Better Auth refuses another origin (got ${crossSite.status})`)
    assert.equal(await currentUser(asked(aliceCookie)), alice.id, 'and the session survives it')
    // Email and password is the only way in: an outside sign-in is not offered at all.
    assert.ok((await authCall('/sign-in/social', { provider: 'google', callbackURL: '/' })).status >= 400, 'no Google sign-in')
    assert.ok((await authCall('/sign-in/social', { provider: 'github', callbackURL: '/' })).status >= 400, 'no GitHub sign-in')
    // Better Auth's own delete endpoint is closed: deleting is the studio's job.
    assert.ok((await authCall('/delete-user', {}, { cookie: aliceCookie })).status >= 400, 'Better Auth’s delete-user is off')
    assert.equal(await currentUser(asked(aliceCookie)), alice.id)

    // Verified (as judge:account does, given the account's own password), the record carries the address; unverified again, it does not.
    const ctx = await testAuth.$context
    await ctx.internalAdapter.updateUser(alice.id, { emailVerified: true })
    assert.equal((await store.users.get(alice.id))?.email, 'alice@inkdesk.invalid', 'a verified address is recorded, lower-cased by Better Auth')
    await ctx.internalAdapter.updateUser(alice.id, { emailVerified: false })
    assert.equal((await store.users.get(alice.id))?.email, '', 'an unverified address is never recorded — the allowlist and ADMIN_EMAILS cannot match it')
    await ctx.internalAdapter.updateUser(alice.id, { emailVerified: true })

    // Sign-out ends that session, and only that one.
    const out = await authCall('/sign-out', {}, { cookie: secondCookie })
    assert.equal(out.status, 200)
    assert.equal(await currentUser(asked(secondCookie)), null, 'a signed-out session is nobody')
    assert.equal(await currentUser(asked(aliceCookie)), alice.id, 'the other device stays signed in')

    // The end of an account deletion: the user, every session and every sign-in go; again is fine.
    await authServer.deleteSignIn(alice.id, testAuth)
    assert.equal(await currentUser(asked(aliceCookie)), null, 'a deleted account’s session is nobody')
    assert.equal(memory.user.filter((u) => u.id === alice.id).length, 0)
    assert.equal(memory.session.filter((x) => x.userId === alice.id).length, 0)
    assert.equal(memory.account.filter((x) => x.userId === alice.id).length, 0)
    await authServer.deleteSignIn(alice.id, testAuth)
    assert.equal((await authCall('/sign-in/email', { email: 'alice@inkdesk.invalid', password: 'correct horse battery' })).status, 401, 'and nobody signs in as them again')
    // A deleted account's record stays a tombstone, whatever is written after.
    await store.users.markDeleted(alice.id)
    await authServer.recordAccount({ id: alice.id, email: 'alice@inkdesk.invalid', emailVerified: true, createdAt: new Date() })
    assert.ok((await store.users.get(alice.id))?.deletedAt, 'a late account write cannot bring it back')
  })
  ok('Better Auth on a memory database, with production’s options: sign-up makes an account and an HttpOnly, SameSite=Lax, __Secure- session — unverified whatever the form claims, so its record carries no address and it is on the free plan and no admin even with its address on ALLOWLIST_EMAILS and ADMIN_EMAILS; a second sign-up with that address is a 422 that names no account; a short, long or nameless sign-up is refused; the learner’s createAccount makes a verified (allowlistable) account, and holdsPassword — judge:account’s guard — knows an account’s own password; a wrong password, a forged cookie, another origin and any outside (Google/GitHub) sign-in are refused; verified, the address is recorded; sign-out ends one session; deleteSignIn removes the user, its sessions and sign-ins, and repeats safely')

  // --- e. The proxy, offline ----------------------------------------------------------------
  const { NextRequest } = await import('next/server')
  const { proxy } = await import('../proxy')
  const call = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Response> => {
    const host = new URL(url).host
    const res = await proxy(new NextRequest(url, { method: init.method ?? 'GET', headers: { host, ...init.headers } }))
    assert.ok(res instanceof Response, 'the proxy always answers with a response')
    return res
  }
  // Through to the route: NextResponse.next(), with the page's headers (nonce, policy, path) as overrides.
  const passes = (res: Response) =>
    res.status === 200 && !res.headers.get('location') && (res.headers.get('x-middleware-next') === '1' || res.headers.has('x-middleware-override-headers'))
  const refusedOrigin = async (res: Response) => {
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: authConfig.CROSS_ORIGIN_SENTENCE })
  }
  const POST = (url: string, headers: Record<string, string> = {}) => call(url, { method: 'POST', headers })

  // off: nothing at all.
  assert.ok(passes(await POST(`${APP}/api/projects`, { origin: 'https://evil.example', cookie: '__session=x' })), 'off mode: a pass-through')
  assert.ok(passes(await call('https://www.inkdesk.example/', {})))

  for (const mode of ['test', 'better'] as const) {
    await withEnv(mode === 'test' ? { INKDESK_AUTH: 'test', APP_URL: APP } : betterEnv(), async () => {
      // The Origin check, on API writes only.
      await refusedOrigin(await POST(`${APP}/api/projects`, { origin: 'https://evil.example' }))
      await refusedOrigin(await POST(`${APP}/api/projects/abc/plan`, { origin: 'https://inkdesk.example.evil.example', cookie: '__session=x' }))
      await refusedOrigin(await POST(`${APP}/api/projects`, { cookie: '__session=x' }))
      await refusedOrigin(await POST(`${APP}/api/projects`, { origin: 'null' }))
      await refusedOrigin(await call(`${APP}/api/projects/abc`, { method: 'DELETE', headers: { origin: 'https://evil.example' } }))
      const own = await POST(`${APP}/api/projects`, { origin: APP })
      assert.notEqual(own.status, 403, 'the studio’s own origin passes')
      const local = await POST('http://localhost:3000/api/projects', { origin: 'http://localhost:3000' })
      assert.notEqual(local.status, 403, 'localhost:3000 passes outside production')
      const bare = await POST(`${APP}/api/projects`)
      assert.notEqual(bare.status, 403, 'no Origin and no cookie (a script, curl) is left to the route’s own check')
      const read = await call(`${APP}/api/projects`, { headers: { origin: 'https://evil.example', cookie: '__session=x' } })
      assert.notEqual(read.status, 403, 'a GET is not a write')
      // Better Auth's routes are open to a signed-out person, and their writes keep the Origin check: no other site signs anyone in or out.
      await refusedOrigin(await POST(`${APP}/api/auth/sign-in/email`, { origin: 'https://evil.example' }))
      await refusedOrigin(await POST(`${APP}/api/auth/sign-out`, { origin: 'https://evil.example', cookie: 'inkdesk.session_token=x' }))
      assert.ok(passes(await POST(`${APP}/api/auth/sign-in/email`, { origin: APP })), 'the studio’s own sign-in form passes')
      assert.ok(passes(await call(`${APP}/api/auth/get-session`)), 'a read of the session (a GET) reaches the route')
      // The share page’s routes (slice 21) need no session but are NOT exempt: a write to them keeps the Origin check, so a
      // page on another site cannot post reports for a visitor; a read from anywhere (a crawler, a chat app’s preview) is fine.
      await refusedOrigin(await POST(`${APP}/api/s/tok123/report`, { origin: 'https://evil.example' }))
      await refusedOrigin(await POST(`${APP}/api/s/tok123/report`, { origin: 'null' }))
      await refusedOrigin(await POST(`${APP}/api/s/tok123/report`, { cookie: '__session=x' }))
      assert.notEqual((await POST(`${APP}/api/s/tok123/report`, { origin: APP })).status, 403, 'the share page’s own origin passes')
      assert.notEqual((await POST(`${APP}/api/s/tok123/report`)).status, 403, 'no Origin and no cookie is left to the route’s own window')
      assert.notEqual((await call(`${APP}/api/s/tok123/image/img-1.png`, { headers: { origin: 'https://evil.example', cookie: '__session=x' } })).status, 403, 'a read of a share is not a write')
      assert.ok(passes(await call(`${APP}/api/s/tok123`)), 'and a stranger’s read reaches the route')
      // www → the apex, path and query kept, 308.
      const www = await call('https://www.inkdesk.example/p/abc?page=2')
      assert.equal(www.status, 308)
      assert.equal(www.headers.get('location'), `${APP}/p/abc?page=2`)
      // Railway's health check reaches the route, whatever its host.
      assert.ok(passes(await call('http://healthcheck.railway.app/api/health')), 'the health check passes untouched')
      assert.ok(passes(await call(`${APP}/api/health`)))
    })
  }
  // The reason the Origin check survives on /api/s/*: it is not among the routes the proxy waves through unchecked.
  assert.deepEqual([...authConfig.PUBLIC_API_PREFIXES], ['/api/health'], 'nothing public-by-design is on the unchecked list')
  for (const path of ['/api/s/tok123', '/api/s/tok123/report', '/api/s/tok123/image/img-1.png', '/api/admin/reports/r1', '/api/auth/sign-in/email', '/api/webhooks/clerk']) assert.equal(authConfig.isPublicApi(path), false, `${path} is not skipped by the proxy`)
  for (const path of ['/s/tok123', '/s/tok123/opengraph-image', '/sign-in', '/sign-up']) assert.equal(authConfig.isPublicPage(path), true, `${path} is an open page`)
  for (const path of ['/sign-upx', '/sign-inside']) assert.equal(authConfig.isPublicPage(path), false, `${path} is not the sign-in or sign-up page`)
  for (const path of ['/s', '/admin', '/admin/reports', '/settings/account', '/p/abc', '/share/tok']) assert.equal(authConfig.isPublicPage(path), false, `${path} needs sign-in`)
  // APP_URL on www: nothing to move.
  await withEnv({ INKDESK_AUTH: 'test', APP_URL: 'https://www.inkdesk.example' }, async () => {
    assert.notEqual((await call('https://www.inkdesk.example/')).status, 308)
  })
  ok('the proxy: a cross-origin, null-origin or cookie-without-origin API write is a calm 403, Better Auth’s routes included; reads, the studio’s own origin and a session read pass; www → apex 308; the health check passes')

  // Better mode, offline: a signed-out page goes to sign-in with the way back, from the cookie alone; the open pages stay open.
  const pageHeaders = { accept: 'text/html', 'sec-fetch-dest': 'document' }
  await withEnv({ ...betterEnv(), NODE_ENV: 'production' }, async () => {
    const signedOut = await call(`${APP}/p/abc?page=2`, { headers: pageHeaders })
    assert.equal(signedOut.status, 307, `a signed-out page is redirected, got ${signedOut.status}`)
    const to = new URL(signedOut.headers.get('location') ?? '')
    assert.equal(`${to.origin}${to.pathname}`, `${APP}/sign-in`)
    assert.equal(to.searchParams.get('next'), '/p/abc?page=2', 'and comes back where it was going')
    assert.equal((await call(`${APP}/`, { headers: pageHeaders })).headers.get('location'), `${APP}/sign-in`, 'the desk itself needs no way back')
    for (const open of ['/sign-in', '/sign-up', '/terms', '/privacy', '/s/tok123', '/s/tok123/opengraph-image']) {
      const res = await call(`${APP}${open}`, { headers: pageHeaders })
      assert.ok(passes(res), `${open} is open to a stranger (got ${res.status})`)
    }
    for (const closed of ['/admin', '/admin/reports', '/settings/account', '/settings/sharing']) {
      const res = await call(`${APP}${closed}`, { headers: pageHeaders })
      assert.equal(res.status, 307, `${closed} needs sign-in like any page, got ${res.status}`)
      assert.equal(new URL(res.headers.get('location') ?? '').pathname, '/sign-in', `${closed} goes to sign-in`)
    }
    for (const stranger of ['/api/s/tok123', '/api/s/tok123/image/img-1.png', '/api/admin/reports/r1', '/api/shares', '/api/auth/get-session']) {
      assert.ok(passes(await call(`${APP}${stranger}`)), `${stranger}: a signed-out call reaches its route, which decides — the proxy never redirects an API call`)
    }
    // The cookie's presence lets a page through (optimistically: the page checks the session for real), under either name.
    for (const cookie of ['__Secure-inkdesk.session_token=anything', 'inkdesk.session_token=anything']) {
      const res = await call(`${APP}/p/abc`, { headers: { ...pageHeaders, cookie } })
      assert.ok(passes(res), `${cookie.split('=')[0]} lets the page decide (got ${res.status})`)
      assert.equal(res.headers.get('x-middleware-request-x-inkdesk-path'), '/p/abc', 'and the page is told its own path')
    }
    assert.equal((await call(`${APP}/p/abc`, { headers: { ...pageHeaders, cookie: 'better-auth.session_token=x; other=1' } })).status, 307, 'another app’s cookie is not ours')
    // With a cookie, sign-in and sign-up still reach their pages, which check the session for real and send a signed-in visitor to the desk (section f).
    for (const page of ['/sign-in', '/sign-up']) assert.ok(passes(await call(`${APP}${page}`, { headers: { ...pageHeaders, cookie: '__Secure-inkdesk.session_token=stale' } })), `${page} with a cookie is the page’s to decide`)
  })
  // Where sign-in sends someone back: a path on this studio, never another site.
  const { safeNext, signInHref } = await import('../lib/auth/next')
  for (const [input, expected] of [
    ['/p/abc?page=2', '/p/abc?page=2'],
    ['/settings/account#x', '/settings/account#x'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example/', '/'],
    ['//evil.example/x', '/'],
    ['/\\evil.example', '/'],
    ['/\tevil', '/'],
    ['javascript:alert(1)', '/'],
    ['/sign-in?next=/x', '/'],
    ['/sign-up', '/'],
    ['/sign-up?next=/x', '/'],
    ['/api/projects', '/'],
    [`/${'a'.repeat(3000)}`, '/'],
  ] as const) assert.equal(safeNext(input), expected, `safeNext(${JSON.stringify(input)})`)
  assert.equal(signInHref('/p/abc'), '/sign-in?next=%2Fp%2Fabc')
  assert.equal(signInHref('//evil.example'), '/sign-in')
  assert.deepEqual(outbound, [], 'nothing reached the network')
  ok('better mode, offline: a signed-out page → /sign-in?next=<path> from the cookie alone; sign-in, sign-up, terms, privacy and a shared manga open, /admin and /settings need sign-in, API calls reach their routes; safeNext never leaves the studio, nor returns to sign-in or sign-up')

  // --- f. The /api/auth route: its guard ------------------------------------------------------
  {
    const route = await import('../app/api/auth/[...all]/route')
    const { resetBackend } = await import('../lib/limits/backend')
    const post = (path: string, body: unknown, from: string, extra: Record<string, string> = {}) =>
      route.POST(
        new Request(`${APP}/api/auth${path}`, {
          method: 'POST',
          headers: { origin: APP, 'content-type': 'application/json', 'x-forwarded-for': from, ...extra },
          body: JSON.stringify(body),
        })
      )
    // Sign-in off, or test mode: there are no accounts, and the route is a 404.
    for (const mode of ['off', 'test']) {
      await withEnv({ INKDESK_AUTH: mode }, async () => {
        assert.equal((await post('/sign-in/email', { email: 'a@b.c', password: 'x' }, '203.0.113.1')).status, 404, `${mode}: no such page`)
      })
    }
    await withEnv({ ...betterEnv(), INKDESK_LIMITS: 'on', RATE_SIGNIN_PER_MIN: '3' }, async () => {
      pinAuth()
      resetBackend()
      const big = await post('/sign-in/email', { pad: 'x' }, '203.0.113.9', { 'content-length': String(64 * 1024) })
      assert.equal(big.status, 413, 'a body larger than a sign-in form is refused unread')
      // Password guesses from one address: the window closes, and says when to come back.
      const guess = () => post('/sign-in/email', { email: 'bob@inkdesk.invalid', password: 'not the password' }, '203.0.113.2')
      for (let i = 0; i < 3; i++) assert.equal((await guess()).status, 401)
      const shut = await guess()
      assert.equal(shut.status, 429, 'the fourth guess in a minute is refused')
      assert.ok(Number(shut.headers.get('Retry-After')) > 0, 'with Retry-After')
      assert.match(((await shut.json()) as { error: string }).error, /going a little fast/)
      // Another address has its own window: the key is the client's address, not one key for everyone.
      assert.equal((await post('/sign-in/email', { email: 'bob@inkdesk.invalid', password: 'not the password' }, '203.0.113.3')).status, 401, 'another address may still try')
      resetBackend()
    })
    // Behind two appending proxies (TRUSTED_PROXY_HOPS=2) the client is the entry two from the right: still one window per client.
    await withEnv({ ...betterEnv(), INKDESK_LIMITS: 'on', RATE_SIGNIN_PER_MIN: '3', TRUSTED_PROXY_HOPS: '2' }, async () => {
      pinAuth()
      resetBackend()
      const guess = (client: string) => post('/sign-in/email', { email: 'bob@inkdesk.invalid', password: 'not the password' }, `${client}, 10.0.0.1`)
      for (let i = 0; i < 3; i++) assert.equal((await guess('203.0.113.5')).status, 401)
      assert.equal((await guess('203.0.113.5')).status, 429, 'two hops: the fourth guess from one client is refused')
      assert.equal((await guess('203.0.113.6')).status, 401, 'two hops: another client may still try')
      resetBackend()
    })

    // Sign-up through the route (reopened 2026-10-25): RATE_SIGNUP_PER_HOUR's default, 5 accounts an hour per client address.
    await withEnv({ ...betterEnv(), INKDESK_LIMITS: 'on' }, async () => {
      pinAuth()
      resetBackend()
      const { planOf, forgetPlans } = await import('../lib/limits/plan')
      const signUp = (n: number, from: string) => post('/sign-up/email', { email: `reader${n}@inkdesk.invalid`, password: 'a long password', name: `Reader ${n}` }, from)
      const ids: string[] = []
      for (let n = 1; n <= 5; n++) {
        const res = await signUp(n, '203.0.113.20')
        assert.equal(res.status, 200, `a fresh address and email: sign-up ${n} makes an account (got ${res.status})`)
        assert.ok(res.headers.getSetCookie().some((c) => /inkdesk\.session_token=/.test(c)), 'and signs the person in at once')
        const user = ((await res.json()) as { user: { id: string; emailVerified: boolean } }).user
        assert.equal(user.emailVerified, false, 'unverified')
        ids.push(user.id)
      }
      const sixth = await signUp(6, '203.0.113.20')
      assert.equal(sixth.status, 429, 'the sixth account from one address within the hour is refused')
      const retry = Number(sixth.headers.get('Retry-After'))
      assert.ok(retry > 60 && retry <= 3600, `with Retry-After, up to an hour (got ${retry})`)
      assert.match(((await sixth.json()) as { error: string }).error, /going a little fast — try again in \d+ minutes/, 'the calm sentence the sign-in window gives')
      assert.equal(memory.user.filter((u) => u.email === 'reader6@inkdesk.invalid').length, 0, 'and no account was made')
      assert.equal((await signUp(6, '203.0.113.21')).status, 200, 'another address may still sign up')
      // A duplicate through the route: Better Auth's 422, and it counts toward the hour like any attempt.
      assert.equal((await signUp(1, '203.0.113.22')).status, 422, 'an address already taken is refused through the route too')
      // The account made through the route signs in, and is on the free plan even with its address on ALLOWLIST_EMAILS.
      assert.equal((await post('/sign-in/email', { email: 'reader1@inkdesk.invalid', password: 'a long password' }, '203.0.113.23')).status, 200, 'a self-made account signs in')
      await withEnv({ ALLOWLIST_EMAILS: 'reader1@inkdesk.invalid' }, async () => {
        forgetPlans()
        assert.equal(await planOf(ids[0]), 'free', 'a self-made account is on the free plan, whatever ALLOWLIST_EMAILS says')
      })
      forgetPlans()
      // Every spelling of the sign-up path takes the window (Better Auth routes only the exact one; the others are 404s, never a way round).
      resetBackend()
      for (const [i, path] of ['/sign-up/email/', '/SIGN-UP/email', '/sign%2Dup/email', '/sign-up/email?x=1', '/sign-up/email?y=2'].entries()) {
        const res = await post(path, { email: `spelling${i}@inkdesk.invalid`, password: 'a long password', name: 'S' }, '203.0.113.30')
        assert.notEqual(res.status, 429, `${path}: within the hour’s five`)
      }
      assert.equal((await signUp(7, '203.0.113.30')).status, 429, 'five spellings of the sign-up path used that address’s five accounts an hour')
      resetBackend()
    })
    // The counter store down: a sign-up is REFUSED (503, the busy sentence) and makes nothing — never let through unlimited.
    await withEnv({ ...betterEnv(), INKDESK_LIMITS: 'on' }, async () => {
      pinAuth()
      const { BUSY } = await import('../lib/queue/jobs')
      const pinned = globalThis as { __inkdeskLimits?: { key: string; backend: unknown } }
      const down = () => Promise.reject(new Error('auth-check: the counter store is down'))
      pinned.__inkdeskLimits = { key: 'memory', backend: { kind: 'memory', hit: down, reserve: down, finish: down, counters: down, orphans: down, hold: down, peek: down } }
      const warn = console.warn
      console.warn = () => {}
      try {
        const res = await post('/sign-up/email', { email: 'flood@inkdesk.invalid', password: 'a long password', name: 'F' }, '203.0.113.40')
        assert.equal(res.status, 503, `with no counters, sign-up is refused (got ${res.status})`)
        assert.equal(((await res.json()) as { error: string }).error, BUSY)
        assert.equal(res.headers.getSetCookie().length, 0)
        assert.equal(memory.user.filter((u) => u.email === 'flood@inkdesk.invalid').length, 0, 'and no account was made')
        assert.equal((await post('/sign-in/email', { email: 'reader1@inkdesk.invalid', password: 'a long password' }, '203.0.113.40')).status, 503, 'sign-in fails closed too')
      } finally {
        console.warn = warn
        resetBackend()
      }
    })
  }
  ok('the /api/auth route: a 404 unless sign-in is on; a body larger than a form is a 413 unread; sign-in attempts are windowed per client address (one hop or two), with Retry-After; sign-up makes an unverified, free account that can sign in, five an hour per address — the sixth is a 429 with Retry-After, another address may, any spelling of the path counts; a duplicate is a 422; with the counter store down a sign-up is a 503 and makes nothing')

  // --- f2. The sign-in and sign-up pages, rendered ------------------------------------------
  {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const signUpPage = (await import('../app/sign-up/[[...sign-up]]/page')).default
    const signInPage = (await import('../app/sign-in/[[...sign-in]]/page')).default
    const redirectedTo = async (render: () => Promise<unknown>): Promise<string> => {
      try {
        await render()
      } catch (err) {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.ok(digest.startsWith('NEXT_REDIRECT;'), `a redirect, got ${String(err)}`)
        return digest.split(';').slice(2, -2).join(';')
      }
      return assert.fail('expected a redirect')
    }
    const none = { searchParams: Promise.resolve({}) }
    await withEnv(betterEnv(), async () => {
      pinAuth()
      // Signed out: the sign-up card, with its fields, the way to sign in, and the plain words.
      asRequest({})
      const up = renderToStaticMarkup((await signUpPage()) as Parameters<typeof renderToStaticMarkup>[0])
      for (const needle of ['Make an account', 'name="email"', 'name="password"', 'minLength="10"', 'maxLength="128"', 'autoComplete="new-password"', 'Have an account?', 'href="/sign-in"', 'no password reset', 'free plan', 'href="/terms"', 'href="/privacy"']) {
        assert.ok(up.includes(needle), `the sign-up page shows ${needle}`)
      }
      const signIn = renderToStaticMarkup((await signInPage(none)) as Parameters<typeof renderToStaticMarkup>[0])
      for (const needle of ['Sign in', 'No account?', 'href="/sign-up"', 'Sign up', 'no password reset', 'Anyone can make an account']) assert.ok(signIn.includes(needle), `the sign-in page shows ${needle}`)
      assert.ok(!/There is no sign-up/i.test(signIn) && !/no sign-up/i.test(up), 'neither says there is no sign-up')
      // Signed in: both pages send the visitor to the desk (sign-in to where they were going).
      const made = await authCall('/sign-up/email', { email: 'pages@inkdesk.invalid', password: 'a long password', name: 'P' })
      asRequest({ cookie: cookieOf(made) })
      assert.equal(await redirectedTo(() => signUpPage()), '/', 'a signed-in visitor to /sign-up goes to the desk')
      assert.equal(await redirectedTo(() => signInPage({ searchParams: Promise.resolve({ next: '/settings/usage' }) })), '/settings/usage')
      asRequest({ cookie: '__Secure-inkdesk.session_token=stale.value' })
      assert.ok(renderToStaticMarkup((await signUpPage()) as Parameters<typeof renderToStaticMarkup>[0]).includes('Make an account'), 'a stale cookie still sees the card')
      asRequest({})
    })
    for (const mode of ['off', 'test']) {
      await withEnv({ INKDESK_AUTH: mode }, async () => {
        assert.equal(await redirectedTo(() => signUpPage()), '/', `${mode}: no accounts to make, so the desk`)
      })
    }
    ok('the sign-up page, rendered: signed out it shows the card (email, a 10–128 character password, “Have an account? Sign in”, the free plan, no password reset, Terms and Privacy); the sign-in card links “No account? Sign up” and no longer says there is no sign-up; a signed-in visitor to /sign-up goes to the desk, a stale cookie still sees the card; with sign-in off or in test mode, the desk')
  }

  // --- g. The browser: a 401 goes to sign-in, once, with the way back ------------------------
  {
    const { apiFetch } = await import('../components/api-fetch')
    const seen = { fetches: 0, assigned: [] as string[] }
    const g = globalThis as unknown as { window?: unknown }
    const offline = globalThis.fetch
    const browser = (pathname: string) => ({
      location: { pathname, search: '?page=2', origin: APP, assign: (to: string) => void seen.assigned.push(String(to)) },
      dispatchEvent: () => true,
    })
    const replying = (statuses: number[]) => {
      seen.fetches = 0
      globalThis.fetch = (async () => {
        seen.fetches++
        const status = statuses.shift() ?? 500
        return new Response(JSON.stringify({ error: 'Sign in to use the studio.' }), { status })
      }) as typeof fetch
    }
    try {
      // On the sign-in and sign-up pages themselves, a 401 never sends anyone anywhere.
      for (const page of ['/sign-in', '/sign-up']) {
        g.window = browser(page)
        replying([401])
        assert.equal((await apiFetch('/api/projects')).status, 401)
        assert.equal(seen.assigned.length, 0, `never from ${page}`)
      }
      // Anywhere else: asked once (no retry), then off to sign-in with the way back — once, however many replies follow.
      g.window = browser('/p/abc')
      replying([401, 401])
      assert.equal((await apiFetch('/api/projects/abc', { method: 'POST', body: '{}' })).status, 401)
      assert.equal(seen.fetches, 1, 'nothing is asked twice')
      assert.deepEqual(seen.assigned, ['/sign-in?next=%2Fp%2Fabc%3Fpage%3D2'])
      assert.equal((await apiFetch('/api/projects/abc')).status, 401)
      assert.equal(seen.assigned.length, 1, 'once')
    } finally {
      delete g.window
      globalThis.fetch = offline
    }
    ok('apiFetch: a 401 is asked once and sends the page to /sign-in?next=<where it was>, once; never from the sign-in or sign-up page')
  }

  // --- h. Admins (slice 21) -------------------------------------------------------------------
  {
    const { isAdmin, requireAdmin, adminPageGate, forgetAdmins, NO_SUCH_PAGE } = await import('../lib/auth/admin')
    assert.equal(NO_SUCH_PAGE, 'There is no such page.')
    const at = '2026-10-16T09:00:00.000Z'
    for (const [id, email] of [['user_boss1', 'Boss@Example.COM'], ['user_plain1', 'plain@example.com'], ['user_gone1', 'gone@example.com'], ['user_noaddr1', '']] as const) {
      await store.users.upsert({ id, email, createdAt: at })
    }
    await store.users.markDeleted('user_gone1')
    const asking = (user?: string) => new Request('http://check/api/admin/reports/r1', { method: 'POST', headers: user === undefined ? {} : { [TEST_USER_HEADER]: user } })
    const notThere = async (req: Request) => {
      await assert.rejects(requireAdmin(req), (err: unknown) => {
        assert.ok(err instanceof Refused, `expected Refused, got ${String(err)}`)
        assert.equal(err.status, 404, 'never 403: an admin route does not reveal itself')
        assert.equal(err.message, 'There is no such page.')
        return true
      })
    }
    await withEnv({ INKDESK_AUTH: 'test', ADMIN_EMAILS: ' boss@example.com , Gone@Example.com ,,' }, async () => {
      forgetAdmins()
      assert.equal(await isAdmin('user_boss1'), true, 'matched case-insensitively against the recorded email (Boss@Example.COM vs boss@example.com)')
      assert.equal(await isAdmin('user_plain1'), false)
      assert.equal(await isAdmin('user_gone1'), false, 'a deleted account is never an admin, though its old email is still on the list')
      assert.equal(await isAdmin('user_unknown1'), false, 'an account the webhook has not delivered yet')
      assert.equal(await isAdmin('user_noaddr1'), false, 'an account with no verified email')
      assert.equal(await isAdmin('local'), false, 'with sign-in on, `local` administers nothing')
      assert.equal(await requireAdmin(asking('user_boss1')), 'user_boss1')
      await notThere(asking('user_plain1'))
      await notThere(asking('user_gone1'))
      await notThere(asking('user_unknown1'))
      await assert.rejects(requireAdmin(asking()), (err: unknown) => err instanceof Refused && err.status === 401 && err.message === SIGN_IN_SENTENCE, 'signed out is the 401 every API route gives')
      // The page guard: an admin passes; anyone else — signed out included — gets Next’s own 404.
      assert.equal(await adminPageGate('user_boss1'), 'user_boss1')
      for (const who of ['user_plain1', 'user_gone1', null, 'local']) {
        await assert.rejects(adminPageGate(who), (err: unknown) => (err as { digest?: string }).digest === 'NEXT_HTTP_ERROR_FALLBACK;404', `${who}: the page is a 404`)
      }

      // Cached 15 s per person, like the plan; forgetting it re-reads.
      let reads = 0
      const realGet = store.users.get
      store.users.get = async (id) => (reads++, realGet(id))
      try {
        forgetAdmins()
        await isAdmin('user_boss1')
        await isAdmin('user_boss1')
        await isAdmin('user_boss1')
        assert.equal(reads, 1, 'three questions, one read')
        // A store that is down promotes nobody, and the "no" is not remembered.
        store.users.get = async () => {
          throw new Error('the store went away')
        }
        forgetAdmins()
        const log = console.warn
        console.warn = () => {}
        try {
          assert.equal(await isAdmin('user_boss1'), false, 'unreachable store: not an admin')
          await notThere(asking('user_boss1'))
        } finally {
          console.warn = log
        }
        store.users.get = realGet
        assert.equal(await isAdmin('user_boss1'), true, 'and it answers again as soon as the store does')
      } finally {
        store.users.get = realGet
      }

      // The list is read fresh: take the address off and the same account is no longer an admin (after the cache, or forgetting it).
      env.ADMIN_EMAILS = 'someone.else@example.com'
      assert.equal(await isAdmin('user_boss1'), false, 'the cache is keyed by the list: a changed list is believed at once')
      env.ADMIN_EMAILS = ''
      assert.equal(await isAdmin('user_boss1'), false, 'blank: nobody')
      delete env.ADMIN_EMAILS
      assert.equal(await isAdmin('user_boss1'), false, 'unset: nobody')
      env.ADMIN_EMAILS = 'boss@example.com, not-an-address'
      assert.equal(await isAdmin('user_boss1'), false, 'a malformed list names nobody: a typo promotes no one')
      env.ADMIN_EMAILS = 'boss@example.com'
      assert.equal(await isAdmin('user_boss1'), true)
      // …and an account deleted since being cached is demoted once the cache is let go.
      await store.users.upsert({ id: 'user_later1', email: 'boss@example.com', createdAt: at })
      assert.equal(await isAdmin('user_later1'), true)
      await store.users.markDeleted('user_later1')
      forgetAdmins()
      assert.equal(await isAdmin('user_later1'), false, 'deleted: never an admin')
    })
    // Sign-in off: the one owner is the admin (so the learner can see the page in development); nobody else exists.
    await withEnv({ INKDESK_AUTH: 'off', ADMIN_EMAILS: undefined }, async () => {
      forgetAdmins()
      assert.equal(await isAdmin(LOCAL_OWNER), true, 'a desk without accounts: the owner administers it, with a blank list')
      assert.equal(await isAdmin('user_boss1'), false)
      assert.equal(await requireAdmin(asking()), LOCAL_OWNER)
      assert.equal(await adminPageGate(LOCAL_OWNER), LOCAL_OWNER)
    })
    // Production, blank list: nobody — and `local` is nobody there either.
    await withEnv({ ...betterEnv(), NODE_ENV: 'production', ADMIN_EMAILS: undefined }, async () => {
      forgetAdmins()
      assert.equal(await isAdmin('user_boss1'), false)
      assert.equal(await isAdmin(LOCAL_OWNER), false)
    })
    forgetAdmins()
    ok('admins: the verified email against ADMIN_EMAILS, case-insensitive; a deleted, unknown, address-less or `local` account is not (sign-in on); a non-admin gets 404 “There is no such page.” (never 403) from the route and Next’s 404 from the page; a store that is down promotes nobody; a changed list is believed at once; sign-in off makes the local owner the admin; a blank list in production is nobody')
  }

  // --- i. Headers (slice 21): the share page is noindex and sends no referrer, the CSP is the site’s own ------------
  {
    const nextConfig = (await import('../next.config')).default
    const rules = await nextConfig.headers!()
    // Next’s `:path*` matching, enough for the patterns this file uses: `/x/:path*` is `/x` and everything under it.
    const matches = (source: string, path: string) => new RegExp(`^${source.replace(/\/:path\*$/, '(?:/.*)?')}$`).test(path)
    /** What a response for `path` carries: every matching rule in order, a later one overriding an earlier one’s key. */
    const headersFor = (path: string) => {
      const out = new Map<string, string>()
      for (const rule of rules) if (matches(rule.source, path)) for (const { key, value } of rule.headers) out.set(key.toLowerCase(), value)
      return out
    }
    const NOINDEX = 'noindex, nofollow'
    for (const path of ['/s/abc123', '/s/abc123/opengraph-image', '/s/abc123/anything/deeper']) {
      const h = headersFor(path)
      assert.equal(h.get('x-robots-tag'), NOINDEX, `${path} is noindex, nofollow`)
      assert.equal(h.get('referrer-policy'), 'no-referrer', `${path} sends no referrer: the link’s secret never leaves in a Referer`)
    }
    for (const path of ['/api/s/abc123', '/api/s/abc123/image/img-1.png', '/api/s/abc123/report']) {
      const h = headersFor(path)
      assert.equal(h.get('x-robots-tag'), NOINDEX, `${path} is noindex, nofollow`)
      assert.equal(h.get('referrer-policy'), 'strict-origin-when-cross-origin', `${path} keeps the site’s referrer policy (it is the page that sends no referrer)`)
    }
    for (const path of ['/', '/p/abc', '/settings/account', '/admin/reports', '/api/projects', '/api/shares', '/sign-in', '/status/s/x', '/sx']) {
      const h = headersFor(path)
      assert.equal(h.get('x-robots-tag'), undefined, `${path} is not marked noindex`)
      assert.equal(h.get('referrer-policy'), 'strict-origin-when-cross-origin', `${path} keeps the site’s referrer policy`)
    }
    // Nothing else changed: the CSP and the rest of the site-wide set reach the share routes untouched, and the page loads no third party.
    const site = headersFor('/')
    for (const path of ['/s/abc123', '/api/s/abc123/image/img-1.png']) {
      const h = headersFor(path)
      for (const key of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'permissions-policy']) assert.equal(h.get(key), site.get(key), `${path}: ${key} is the site’s own`)
    }
    const csp = headersFor('/s/abc123').get('content-security-policy') ?? ''
    assert.match(csp, /default-src 'self'/)
    assert.match(csp, /img-src 'self' data: blob:(?:;|$)/, 'pictures come from the studio’s own route')
    assert.match(csp, /frame-ancestors 'none'/)
    assert.doesNotMatch(csp, /https?:\/\//, 'with sign-in off the policy names no outside host at all')
    ok('headers: /s/* and /api/s/* carry X-Robots-Tag noindex, nofollow; /s/* also Referrer-Policy no-referrer; every other path is untouched; the CSP and the rest of the security set reach the share routes unchanged (no third party)')
  }

  console.log('\n  Sign-in check passed.\n')
} finally {
  globalThis.fetch = realFetch
  if (NODE_ENV === undefined) delete env.NODE_ENV
  else env.NODE_ENV = NODE_ENV
  await rm(dir, { recursive: true, force: true })
}

function refused(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  return assert.fail('expected the settings to be refused')
}
