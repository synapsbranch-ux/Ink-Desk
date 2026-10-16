// Slice 19's sign-in rules (`devpost/spec.md > Revision v3 > Auth (v3)`,
// `devpost/security-report.md` SEC-01, SEC-10), against a scratch folder with
// `fetch` stubbed and FAKE Clerk keys made here — no Clerk, no database, no
// bucket, nothing outside this machine:
//
//   npm run check:auth
//
//   a. Every `app/api/**/route.ts` handler asks who is calling (`requireUser`,
//      or `requireAdmin`, which does) unless it is on the public list (the
//      health check, Clerk's webhook) or is public by design (slice 21:
//      `app/api/s/**`, the share page's data — those take NO session and must
//      take an address window instead); under a project's address it checks the
//      owner before it reads a body, under `/api/shares/[token]` the share's
//      owner, under `/api/admin` the admin.
//   b. INKDESK_AUTH: off outside production, clerk in it; production refuses
//      off, test, and clerk without its keys — by name, never by value.
//   c. requireUser in test mode (a valid header, none, a malformed one) and
//      in off mode.
//   d. Clerk's webhook: a signed user.created is recorded; a bad signature is
//      a 400 with nothing echoed and nothing written; a replayed message id
//      writes nothing; an old timestamp is refused.
//   e. The proxy: the Origin check, the www redirect, the health check's
//      host, and Clerk's redirect of a signed-out page — offline.
//   f. A session token is verified with CLERK_JWT_KEY alone: one minted with
//      that key passes, one signed by another key does not.
//   g. The browser's apiFetch: a 401 while Clerk still holds a session (a
//      token that lapsed while the machine slept) refreshes and asks once
//      more; only a 401 that stays one sends the page to sign-in.
//   h. Admins (slice 21): ADMIN_EMAILS against the verified email, case-
//      insensitively; a deleted account, an unknown one and `local` (with
//      sign-in on) are not; a non-admin gets 404 "There is no such page.",
//      never 403; a store that is down promotes nobody.
//   i. Headers (slice 21): `/s/*` and `/api/s/*` are noindex, `/s/*` sends no
//      referrer, the CSP is the site's own; and the proxy keeps its Origin
//      check on the share routes' writes while leaving them open to a stranger.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync, randomBytes, sign as rsaSign, type KeyObject } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'inkdesk-auth-'))
const env = process.env as Record<string, string | undefined>

// Whatever this shell holds — another app's Clerk, database or bucket — is
// never read here: every real credential is dropped before anything loads.
for (const name of Object.keys(env)) {
  if (/^(CLERK_|NEXT_PUBLIC_CLERK_|S3_|DB_|MONGODB_|REDIS_|RAILWAY_)/.test(name)) delete env[name]
}
for (const name of ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'INKDESK_AUTH', 'INKDESK_QUEUE', 'GENERATION_ENABLED', 'CONTACT_EMAIL']) delete env[name]
env.INKDESK_DATA_DIR = dir
env.INKDESK_STORAGE = 'local'
env.CLERK_TELEMETRY_DISABLED = '1' // the fake development key would otherwise announce Clerk's telemetry
const NODE_ENV = env.NODE_ENV
delete env.NODE_ENV

const realFetch = globalThis.fetch
const outbound: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  throw new Error('auth-check: nothing here may reach the network')
}) as typeof fetch

// --- Fake keys, made here and never valid anywhere ------------------------------
const FAPI = 'clerk.inkdesk.invalid'
const b64 = (s: string) => Buffer.from(s).toString('base64')
const alnum = (n: number) =>
  Array.from(randomBytes(n), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('')
const FAKE = {
  publishable: `pk_test_${b64(`${FAPI}$`)}`,
  publishableLive: `pk_live_${b64(`${FAPI}$`)}`,
  secret: `sk_test_${alnum(40)}`,
  secretLive: `sk_live_${alnum(40)}`,
  webhook: `whsec_${randomBytes(24).toString('base64')}`,
}
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
const ours = pair()
const theirs = pair()
const PEM = ours.publicKey.export({ type: 'spki', format: 'pem' }).toString()
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

const clerkEnv = (extra: Record<string, string | undefined> = {}) => ({
  INKDESK_AUTH: 'clerk',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE.publishable,
  CLERK_SECRET_KEY: FAKE.secret,
  CLERK_JWT_KEY: PEM,
  APP_URL: APP,
  ...extra,
})

try {
  // --- a. Every API route asks who is calling --------------------------------------
  const { scanRoute, PUBLIC_ROUTES } = await (async () => {
    const PUBLIC_ROUTES = ['app/api/health/route.ts', 'app/api/webhooks/clerk/route.ts']
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
  const sessionless = routes.filter((r) => r.startsWith('app/api/s/'))
  ok(`all ${routes.length} API routes ask who is calling (public: ${PUBLIC_ROUTES.map((p) => p.split('/').slice(2, -1).join('/')).join(', ')}; public by design, with an address window and no session: ${sessionless.length} under /api/s); project, share and admin routes check the owner before the body`)

  // --- b. The mode, its defaults and production's refusals ---------------------------
  const authConfig = await import('../lib/auth/config')
  const { authMode, AuthConfigError, authProblems, workerAuthProblems, clerkSettings, authorizedParties, frontendApiOf } = authConfig
  const config = await import('../lib/config')
  const { authSettings, ConfigError } = config

  assert.equal(authMode({}), 'off', 'unset outside production: off')
  assert.equal(authMode({ NODE_ENV: 'development' }), 'off')
  assert.equal(authMode({ NODE_ENV: 'production' }), 'clerk', 'unset in production: clerk')
  // `next start` keeps any NODE_ENV it is given: anything but development (or unset) is a public server (S19-SEC-1).
  for (const nodeEnv of ['test', 'staging', ' production ', 'Development']) {
    assert.equal(authMode({ NODE_ENV: nodeEnv }), 'clerk', `NODE_ENV=${nodeEnv}, INKDESK_AUTH unset: clerk, never off`)
    for (const mode of ['off', 'test']) {
      assert.throws(() => authMode({ NODE_ENV: nodeEnv, INKDESK_AUTH: mode }), AuthConfigError, `NODE_ENV=${nodeEnv} refuses INKDESK_AUTH=${mode}`)
    }
    assert.deepEqual(authorizedParties({ NODE_ENV: nodeEnv, APP_URL: APP }), [APP], `NODE_ENV=${nodeEnv} trusts no localhost`)
  }
  assert.equal(authMode({ NODE_ENV: 'development', INKDESK_AUTH: 'test' }), 'test', 'next dev may play two people')
  assert.equal(authMode({ INKDESK_AUTH: 'test' }), 'test')
  assert.equal(authMode({ INKDESK_AUTH: ' clerk ' }), 'clerk')
  assert.equal(authMode({ NODE_ENV: 'production', INKDESK_AUTH: 'clerk' }), 'clerk')
  for (const mode of ['off', 'test']) {
    assert.throws(() => authMode({ NODE_ENV: 'production', INKDESK_AUTH: mode }), (err: unknown) => {
      assert.ok(err instanceof AuthConfigError)
      assert.match(err.message, /INKDESK_AUTH must be clerk in production/)
      return true
    })
  }
  assert.throws(() => authMode({ INKDESK_AUTH: 'maybe-later' }), (err: unknown) => {
    assert.ok(err instanceof AuthConfigError && /INKDESK_AUTH must be clerk, off or test/.test(err.message))
    assert.ok(!err.message.includes('maybe-later'), 'the value is never repeated')
    return true
  })

  // Production, clerk, nothing set: every missing name, one sentence.
  const missing = (() => {
    try {
      authSettings({ NODE_ENV: 'production' })
    } catch (err) {
      assert.ok(err instanceof ConfigError, 'the boot’s own error')
      return err.message
    }
    return assert.fail('production without Clerk’s keys must be refused')
  })()
  for (const name of ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (or CLERK_PUBLISHABLE_KEY) is not set', 'CLERK_SECRET_KEY is not set', 'APP_URL is not set']) {
    assert.ok(missing.includes(name), `names ${name}: ${missing}`)
  }
  assert.match(refused(() => authSettings({ NODE_ENV: 'production', INKDESK_AUTH: 'off' })), /INKDESK_AUTH must be clerk in production/)
  assert.match(refused(() => authSettings({ NODE_ENV: 'production', INKDESK_AUTH: 'test' })), /INKDESK_AUTH must be clerk in production/)
  // Malformed values are named, never repeated — a secret-looking value least of all.
  const leaky = { NODE_ENV: 'production', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_nope_SECRETPUB', CLERK_SECRET_KEY: 'sk_SECRETVALUE', CLERK_JWT_KEY: 'SECRETJWT', CLERK_WEBHOOK_SIGNING_SECRET: 'SECRETHOOK', APP_URL: 'SECRETURL' }
  const malformed = refused(() => authSettings(leaky))
  for (const name of ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_JWT_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET', 'APP_URL must be']) assert.ok(malformed.includes(name), `names ${name}`)
  assert.ok(!/SECRET(PUB|VALUE|JWT|HOOK|URL)/.test(malformed), 'no value appears in the sentence')
  // Fake keys pass, under either publishable name; the learner's name is mapped, the SDK's wins when both are set.
  assert.deepEqual(authSettings({ NODE_ENV: 'production', CLERK_PUBLISHABLE_KEY: FAKE.publishableLive, CLERK_SECRET_KEY: FAKE.secretLive, APP_URL: APP }), { mode: 'clerk' })
  assert.equal(clerkSettings(clerkEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined, CLERK_PUBLISHABLE_KEY: FAKE.publishable })).publishableKey, FAKE.publishable)
  assert.equal(clerkSettings(clerkEnv({ CLERK_PUBLISHABLE_KEY: FAKE.publishableLive })).publishableKey, FAKE.publishable)
  assert.equal(clerkSettings(clerkEnv({ CLERK_JWT_KEY: PEM.replace(/\n/g, '\\n') })).jwtKey, PEM, 'a one-line PEM with literal \\n is read as the key')
  assert.equal(clerkSettings(clerkEnv({ CLERK_JWT_KEY: undefined })).jwtKey, undefined, 'the JWT key is optional')
  assert.equal(frontendApiOf(FAKE.publishable), FAPI)
  assert.equal(frontendApiOf('pk_test_' + b64('evil.example; script-src *$')), null, 'a key whose host is not a host is not trusted into the CSP')
  assert.deepEqual(authorizedParties({ APP_URL: `${APP}/some/path`, NEXT_PUBLIC_APP_URL: 'https://app.inkdesk.example' }), [APP, 'https://app.inkdesk.example', 'http://localhost:3000'])
  assert.deepEqual(authorizedParties({ NODE_ENV: 'production', APP_URL: APP }), [APP], 'no localhost in production')
  // The layout's read never throws: `next build` runs with NODE_ENV=production whatever a development .env says (S19-REG-1).
  const { providerKey } = authConfig
  for (const mode of ['off', 'test', 'maybe-later']) {
    assert.equal(providerKey({ NODE_ENV: 'production', INKDESK_AUTH: mode, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE.publishable }), undefined, `a build with INKDESK_AUTH=${mode} renders bare`)
  }
  assert.equal(providerKey({ NODE_ENV: 'production' }), undefined, 'clerk with no key renders bare')
  assert.equal(providerKey({ INKDESK_AUTH: 'off', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE.publishable }), undefined, 'off never loads Clerk')
  assert.equal(providerKey(clerkEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined, CLERK_PUBLISHABLE_KEY: FAKE.publishable })), FAKE.publishable)
  for (const file of ['app/layout.tsx', 'components/AuthControls.tsx']) {
    const source = await readFile(join(ROOT, file), 'utf8')
    assert.ok(source.includes('providerKey(') && !/\bauthMode\(/.test(source), `${file} reads the mode through providerKey, which cannot fail a build`)
  }
  assert.deepEqual(authProblems({ INKDESK_AUTH: 'off' }), [], 'off needs nothing')
  assert.deepEqual(authProblems({ INKDESK_AUTH: 'test' }), [], 'test needs nothing')
  assert.ok(authProblems({ INKDESK_AUTH: 'clerk' }).length >= 2, 'clerk in development still needs its keys')
  // The worker never signs anyone in, but deleting an account deletes the Clerk user: in clerk mode it needs the secret key, and only that.
  assert.deepEqual(workerAuthProblems({ NODE_ENV: 'production', CLERK_SECRET_KEY: FAKE.secret }), [], 'a production worker with the key is fine without the publishable key or APP_URL')
  assert.deepEqual(workerAuthProblems({ NODE_ENV: 'production' }), ['CLERK_SECRET_KEY is not set'], 'a production worker without the key is refused')
  assert.match(workerAuthProblems({ INKDESK_AUTH: 'clerk', CLERK_SECRET_KEY: 'nope' })[0], /must be a Clerk secret key/)
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
  assert.match(exits.join(), /INKDESK_AUTH must be clerk in production/)
  assert.equal(await stopped({ NODE_ENV: 'production', INKDESK_AUTH: 'test' }), 1)
  assert.equal(await stopped({ NODE_ENV: 'production' }), 1, 'production without Clerk’s keys does not start')
  assert.match(exits.join(), /CLERK_SECRET_KEY is not set/)
  assert.equal(await stopped({ NODE_ENV: 'production', PANEL_CONCURRENCY: 'many' }), 1)
  assert.match(exits.join(), /PANEL_CONCURRENCY must be.*CLERK_SECRET_KEY is not set/, 'every problem, config and sign-in, in one sentence')
  assert.equal(await stopped({ NODE_ENV: 'test' }), 1, 'NODE_ENV=test with sign-in unset is clerk, and without its keys does not start')
  assert.match(exits.join(), /CLERK_SECRET_KEY is not set/)
  assert.equal(await stopped({ NODE_ENV: 'staging', INKDESK_AUTH: 'test' }), 1, 'nor does a staging server in test mode')
  assert.match(exits.join(), /INKDESK_AUTH must be clerk in production/)
  assert.equal(await stopped({ NODE_ENV: 'development', INKDESK_AUTH: 'test' }), null, 'next dev in test mode starts')
  assert.equal(await stopped({ NODE_ENV: 'production', ...clerkEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE.publishableLive, CLERK_SECRET_KEY: FAKE.secretLive }) }), null, 'production with its keys starts')
  ok('INKDESK_AUTH: off in development, clerk under any other NODE_ENV (test, staging included); production refuses off, test and missing keys at boot, in one sentence of names, never values; the layout’s read never fails a build')

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

  // --- d. Clerk's webhook -----------------------------------------------------------------
  const { store } = await import('../lib/store')
  const webhook = await import('../app/api/webhooks/clerk/route')
  const writes: string[] = []
  const realUpsert = store.users.upsert
  const realMarkDeleted = store.users.markDeleted
  store.users.upsert = async (user) => {
    writes.push(`upsert:${user.id}`)
    return realUpsert(user)
  }
  store.users.markDeleted = async (id) => {
    writes.push(`deleted:${id}`)
    return realMarkDeleted(id)
  }
  const signed = (body: string, opts: { id?: string; at?: number; secret?: string } = {}) => {
    const id = opts.id ?? `msg_${alnum(20)}`
    const at = String(Math.floor((opts.at ?? Date.now()) / 1000))
    const key = Buffer.from((opts.secret ?? FAKE.webhook).replace(/^whsec_/, ''), 'base64')
    const signature = createHmac('sha256', key).update(`${id}.${at}.${body}`).digest('base64')
    return new Request('http://check/api/webhooks/clerk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': at, 'svix-signature': `v1,${signature}` },
      body,
    })
  }
  const userEvent = (type: string, id: string, email: string) =>
    JSON.stringify({
      type,
      object: 'event',
      data: {
        id,
        object: 'user',
        created_at: Date.parse('2026-10-14T09:00:00Z'),
        primary_email_address_id: 'idn_2',
        email_addresses: [
          { id: 'idn_1', email_address: 'old@inkdesk.invalid' },
          { id: 'idn_2', email_address: email },
        ],
      },
    })

  await withEnv({ CLERK_WEBHOOK_SIGNING_SECRET: undefined }, async () => {
    const res = await webhook.POST(signed(userEvent('user.created', 'user_nosecret', 'a@inkdesk.invalid')))
    assert.equal(res.status, 503, 'no secret: refused, nothing verified')
  })
  await withEnv({ CLERK_WEBHOOK_SIGNING_SECRET: FAKE.webhook }, async () => {
    const created = userEvent('user.created', 'user_alice1', 'alice@inkdesk.invalid')
    const first = signed(created, { id: 'msg_first' })
    const res = await webhook.POST(first)
    assert.equal(res.status, 200, await res.clone().text())
    const alice = await store.users.get('user_alice1')
    assert.equal(alice?.email, 'alice@inkdesk.invalid', 'the primary address is the one recorded')
    assert.equal(alice?.createdAt, '2026-10-14T09:00:00.000Z')
    assert.deepEqual(writes, ['upsert:user_alice1'])

    // Clerk's retry of the same message (same id, a fresh timestamp and signature): no second write.
    const again = await webhook.POST(signed(created, { id: 'msg_first' }))
    assert.equal(again.status, 200)
    assert.equal(((await again.json()) as { duplicate?: boolean }).duplicate, true)
    assert.deepEqual(writes, ['upsert:user_alice1'], 'a replayed message id writes nothing')

    // A forged signature: 400, no body echoed, nothing written.
    const forgedBody = userEvent('user.created', 'user_mallory', 'mallory-SECRET-MARK@inkdesk.invalid')
    const forged = await webhook.POST(signed(forgedBody, { secret: `whsec_${randomBytes(24).toString('base64')}` }))
    assert.equal(forged.status, 400)
    const forgedText = await forged.text()
    assert.ok(!forgedText.includes('SECRET-MARK') && !forgedText.includes('user_mallory'), 'nothing from the body comes back')
    // A tampered body under a good signature, and no signature at all.
    const tampered = signed(created, { id: 'msg_tamper' })
    const swapped = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: forgedBody })
    assert.equal((await webhook.POST(swapped)).status, 400)
    assert.equal((await webhook.POST(new Request('http://check/api/webhooks/clerk', { method: 'POST', body: forgedBody }))).status, 400)
    // An old message, correctly signed, ten minutes late: refused.
    const stale = await webhook.POST(signed(forgedBody, { at: Date.now() - 10 * 60 * 1000 }))
    assert.equal(stale.status, 400)
    assert.equal(await store.users.get('user_mallory'), null)
    assert.deepEqual(writes, ['upsert:user_alice1'], 'no refused message wrote anything')

    // Too large: refused before it is read whole.
    const huge = await webhook.POST(signed(JSON.stringify({ type: 'user.created', data: { id: 'user_big', pad: 'x'.repeat(300 * 1024) } })))
    assert.ok(huge.status === 413 || huge.status === 400, `an oversized webhook is refused, got ${huge.status}`)

    // An update refreshes the email; a deletion marks the account; a late creation cannot bring it back.
    assert.equal((await webhook.POST(signed(userEvent('user.updated', 'user_alice1', 'alice@new.invalid')))).status, 200)
    assert.equal((await store.users.get('user_alice1'))?.email, 'alice@new.invalid')
    const gone = JSON.stringify({ type: 'user.deleted', object: 'event', data: { id: 'user_alice1', object: 'user', deleted: true } })
    assert.equal((await webhook.POST(signed(gone))).status, 200)
    assert.ok((await store.users.get('user_alice1'))?.deletedAt, 'the account is marked deleted')
    assert.equal((await webhook.POST(signed(userEvent('user.created', 'user_alice1', 'alice@inkdesk.invalid')))).status, 200)
    assert.ok((await store.users.get('user_alice1'))?.deletedAt, 'and stays deleted')
    // An address Clerk says is unverified is not a person's identity — the allowlist is matched against what is stored, so a stranger who typed
    // an allowlisted address into a sign-up must not be recorded under it. Primary or not, the first verified address stands in; none leaves it blank.
    const withAddresses = (id: string, primary: string | null, addresses: { id: string; email_address: string; verification?: { status: string; strategy: string } | null }[]) =>
      JSON.stringify({ type: 'user.created', object: 'event', data: { id, object: 'user', created_at: Date.parse('2026-10-14T09:00:00Z'), primary_email_address_id: primary, email_addresses: addresses } })
    const verified = { status: 'verified', strategy: 'email_code' }
    const unverified = { status: 'unverified', strategy: 'email_code' }
    assert.equal((await webhook.POST(signed(withAddresses('user_typed1', 'idn_1', [{ id: 'idn_1', email_address: 'judge@inkdesk.invalid', verification: unverified }])))).status, 200)
    assert.equal((await store.users.get('user_typed1'))?.email, '', 'an unverified primary address is not recorded')
    assert.equal(
      (await webhook.POST(signed(withAddresses('user_typed2', null, [{ id: 'idn_1', email_address: 'judge@inkdesk.invalid', verification: unverified }, { id: 'idn_2', email_address: 'me@inkdesk.invalid', verification: verified }])))).status,
      200
    )
    assert.equal((await store.users.get('user_typed2'))?.email, 'me@inkdesk.invalid', 'with no primary, the first address is not taken on faith: a verified one is')
    assert.equal(
      (await webhook.POST(signed(withAddresses('user_typed3', 'idn_2', [{ id: 'idn_1', email_address: 'old@inkdesk.invalid', verification: verified }, { id: 'idn_2', email_address: 'judge@inkdesk.invalid', verification: null }])))).status,
      200
    )
    assert.equal((await store.users.get('user_typed3'))?.email, 'judge@inkdesk.invalid', 'a payload that says nothing about verification is taken as it is')
    // Something the studio does not subscribe to is acknowledged and ignored.
    const before = writes.length
    assert.equal((await webhook.POST(signed(JSON.stringify({ type: 'session.created', object: 'event', data: { id: 'sess_1' } })))).status, 200)
    assert.equal(writes.length, before)
  })
  store.users.upsert = realUpsert
  store.users.markDeleted = realMarkDeleted
  ok('the webhook: a signed user.created is recorded; a forged, tampered, unsigned or ten-minute-old one is a 400 that echoes nothing and writes nothing; a replayed id writes nothing')

  // --- e. The proxy, offline ----------------------------------------------------------------
  const { NextRequest } = await import('next/server')
  const { proxy } = await import('../proxy')
  const event = { waitUntil() {} } as unknown as import('next/server').NextFetchEvent
  const call = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Response> => {
    const host = new URL(url).host
    const res = await proxy(new NextRequest(url, { method: init.method ?? 'GET', headers: { host, ...init.headers } }), event)
    assert.ok(res instanceof Response, 'the proxy always answers with a response')
    return res
  }
  // Through to the route: NextResponse.next() — Clerk's carries its verified headers as overrides instead of the plain marker.
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

  for (const mode of ['test', 'clerk'] as const) {
    await withEnv(mode === 'test' ? { INKDESK_AUTH: 'test', APP_URL: APP } : clerkEnv(), async () => {
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
      assert.ok(passes(await POST(`${APP}/api/webhooks/clerk`, { origin: 'https://evil.example' })), 'Clerk’s webhooks are exempt')
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
  assert.deepEqual([...authConfig.PUBLIC_API_PREFIXES], ['/api/health', '/api/webhooks/'], 'nothing public-by-design is on the unchecked list')
  for (const path of ['/api/s/tok123', '/api/s/tok123/report', '/api/s/tok123/image/img-1.png', '/api/admin/reports/r1']) assert.equal(authConfig.isPublicApi(path), false, `${path} is not skipped by the proxy`)
  for (const path of ['/s/tok123', '/s/tok123/opengraph-image']) assert.equal(authConfig.isPublicPage(path), true, `${path} is an open page`)
  for (const path of ['/s', '/admin', '/admin/reports', '/settings/account', '/p/abc', '/share/tok']) assert.equal(authConfig.isPublicPage(path), false, `${path} needs sign-in`)
  // APP_URL on www: nothing to move.
  await withEnv({ INKDESK_AUTH: 'test', APP_URL: 'https://www.inkdesk.example' }, async () => {
    assert.notEqual((await call('https://www.inkdesk.example/')).status, 308)
  })
  ok('the proxy: a cross-origin, null-origin or cookie-without-origin API write is a calm 403; reads, the studio’s own origin and the webhook pass; www → apex 308; the health check passes')

  // Clerk mode, offline: a signed-out page goes to sign-in; a session minted with CLERK_JWT_KEY is accepted.
  const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url')
  const mint = (key: KeyObject, claims: Record<string, unknown>) => {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ins_check' }))
    const payload = b64url(JSON.stringify(claims))
    const signature = rsaSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key)
    return `${header}.${payload}.${b64url(signature)}`
  }
  const now = Math.floor(Date.now() / 1000)
  const claims = (extra: Record<string, unknown> = {}) => ({
    sub: 'user_alice1',
    sid: 'sess_check',
    iss: `https://${FAPI}`,
    azp: APP,
    iat: now - 5,
    nbf: now - 5,
    exp: now + 60,
    v: 2,
    ...extra,
  })
  await withEnv(clerkEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE.publishableLive, CLERK_SECRET_KEY: FAKE.secretLive, NODE_ENV: 'production' }), async () => {
    const signedOut = await call(`${APP}/p/abc`, { headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } })
    assert.ok([302, 307, 308].includes(signedOut.status), `a signed-out page is redirected, got ${signedOut.status}`)
    const to = new URL(signedOut.headers.get('location') ?? '')
    assert.equal(`${to.origin}${to.pathname}`, `${APP}/sign-in`)
    assert.equal(to.searchParams.get('redirect_url'), `${APP}/p/abc`, 'and comes back where it was going')
    // Slice 21: a shared manga and its picture card are open to a stranger holding the link; the admin pages are pages like any other.
    for (const open of ['/sign-in', '/sign-up/verify', '/terms', '/privacy', '/s/tok123', '/s/tok123/opengraph-image']) {
      const res = await call(`${APP}${open}`, { headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } })
      assert.ok(passes(res), `${open} is open to a stranger (got ${res.status})`)
    }
    for (const closed of ['/admin', '/admin/reports', '/settings/account', '/settings/sharing']) {
      const res = await call(`${APP}${closed}`, { headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } })
      assert.ok([302, 307, 308].includes(res.status), `${closed} needs sign-in like any page, got ${res.status}`)
      assert.equal(new URL(res.headers.get('location') ?? '').pathname, '/sign-in', `${closed} goes to sign-in`)
    }
    for (const stranger of ['/api/s/tok123', '/api/s/tok123/image/img-1.png', '/api/admin/reports/r1', '/api/shares']) {
      assert.ok(passes(await call(`${APP}${stranger}`)), `${stranger}: a signed-out call reaches its route, which decides (an address window, or 401, or 404) — the proxy never redirects an API call`)
    }
    const api = await call(`${APP}/api/projects`)
    assert.ok(passes(api), 'a signed-out API call reaches its route, which answers 401 itself')
    assert.equal(api.headers.get('x-middleware-request-x-clerk-auth-status') ?? 'signed-out', 'signed-out')

    const session = mint(ours.privateKey, claims())
    const signedIn = await call(`${APP}/p/abc`, {
      headers: { accept: 'text/html', 'sec-fetch-dest': 'document', cookie: `__session=${session}; __client_uat=${now - 5}` },
    })
    assert.ok(passes(signedIn), `a session signed with CLERK_JWT_KEY opens the page (status ${signedIn.status} ${signedIn.headers.get('location') ?? ''})`)
    assert.equal(signedIn.headers.get('x-middleware-request-x-clerk-auth-status'), 'signed-in')
    const forgedSession = mint(theirs.privateKey, claims())
    const intruder = await call(`${APP}/p/abc`, {
      headers: { accept: 'text/html', 'sec-fetch-dest': 'document', cookie: `__session=${forgedSession}; __client_uat=${now - 5}` },
    })
    assert.ok(!passes(intruder), 'a session signed by another key does not open the page')
  })
  assert.deepEqual(outbound, [], 'nothing reached the network')
  ok('Clerk mode, offline: a signed-out page → /sign-in?redirect_url=…; sign-in, sign-up, terms, privacy and a shared manga (/s/…) open, /admin and /settings need sign-in; a session minted with CLERK_JWT_KEY is signed-in; another key’s is not')

  // --- f. Networkless verification with the JWT key --------------------------------------
  const { verifyToken } = await import('@clerk/backend')
  const good = await verifyToken(mint(ours.privateKey, claims()), { jwtKey: PEM, authorizedParties: [APP] })
  assert.equal(good.sub, 'user_alice1')
  const refusedToken = async (token: string, why: string, parties: string[] = [APP]) => {
    await assert.rejects(verifyToken(token, { jwtKey: PEM, authorizedParties: parties }), Error, why)
  }
  await refusedToken(mint(theirs.privateKey, claims()), 'another key’s signature')
  await refusedToken(mint(ours.privateKey, claims({ exp: now - 120, iat: now - 300, nbf: now - 300 })), 'an expired token')
  await refusedToken(mint(ours.privateKey, claims({ azp: 'https://evil.example' })), 'a token minted for another origin')
  const parts = mint(ours.privateKey, claims()).split('.')
  await refusedToken(`${parts[0]}.${b64url(JSON.stringify(claims({ sub: 'user_mallory' })))}.${parts[2]}`, 'a token whose claims were changed')
  assert.deepEqual(outbound, [], 'verification made no network call')
  ok('verifyToken with CLERK_JWT_KEY alone: our token passes; another key’s, an expired one, another origin’s and an altered one are refused — offline')

  // --- g. The browser: a lapsed token is refreshed before anyone is sent away ---------------
  {
    const { apiFetch } = await import('../components/api-fetch')
    const seen = { fetches: 0, refreshes: 0, assigned: [] as string[], replies: [] as number[] }
    const g = globalThis as unknown as { window?: unknown }
    const offline = globalThis.fetch
    const session = { getToken: async (o?: { skipCache?: boolean }) => (seen.refreshes++, assert.equal(o?.skipCache, true), 'fresh') }
    const browser = (clerk: unknown) => ({
      location: { pathname: '/p/abc', href: `${APP}/p/abc`, origin: APP, assign: (to: URL) => void seen.assigned.push(String(to)) },
      dispatchEvent: () => true,
      Clerk: clerk,
    })
    const replying = (statuses: number[]) => {
      seen.fetches = 0
      seen.refreshes = 0
      globalThis.fetch = (async () => {
        seen.fetches++
        const status = statuses.shift() ?? 500
        return new Response(JSON.stringify({ error: 'Sign in to use the studio.' }), { status })
      }) as typeof fetch
    }
    try {
      // Still signed in, the token lapsed: refreshed, asked once more, and the page stays.
      g.window = browser({ session })
      replying([401, 200])
      assert.equal((await apiFetch('/api/projects/abc', { method: 'POST', body: '{}' })).status, 200)
      assert.deepEqual([seen.fetches, seen.refreshes, seen.assigned.length], [2, 1, 0], 'a lapsed token: one refresh, one retry, no trip to sign-in')
      // The session is really gone (the retry is a 401 too): off to sign-in, with the way back.
      replying([401, 401])
      assert.equal((await apiFetch('/api/projects/abc')).status, 401)
      assert.deepEqual([seen.fetches, seen.refreshes], [2, 1])
      assert.equal(seen.assigned.length, 1, 'a 401 that stays one goes to sign-in')
      assert.equal(new URL(seen.assigned[0]).searchParams.get('redirect_url'), `${APP}/p/abc`)
      // No Clerk session (signed out, or test mode): no refresh, no retry.
      for (const clerk of [undefined, { session: null }, { session: { getToken: async () => { throw new Error('offline') } } }]) {
        g.window = browser(clerk)
        replying([401, 200])
        assert.equal((await apiFetch('/api/projects/abc')).status, 401)
        assert.equal(seen.fetches, 1, 'nothing is asked twice without a live session')
      }
    } finally {
      delete g.window
      globalThis.fetch = offline
    }
    ok('apiFetch: a 401 while Clerk still holds a session refreshes the token and retries once, so a waking laptop stays on its page; only a lasting 401 goes to sign-in')
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
    await withEnv({ ...clerkEnv(), NODE_ENV: 'production', ADMIN_EMAILS: undefined }, async () => {
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
