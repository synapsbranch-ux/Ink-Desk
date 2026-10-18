// Slice 23's responsive check, from `devpost/checklist.md > 23` (Verify):
// "Playwright screenshots of every screen at 390, 768 and 1280 px with no
// horizontal scroll and no target under 44 px (a script, not a framework)".
// See `devpost/prd.md > Responsive (v3)` and `devpost/spec.md > Responsive (v3)`.
//
//   npm run check:responsive                       every screen, 390/768/1280
//   npm run check:responsive -- --only studio-page,share-manga --widths 390
//   npm run check:responsive -- --only @reader     every screen whose area is reader
//   npm run check:responsive -- --only 'studio-*'  a prefix
//   npm run check:responsive -- --area page        measure all, print only page's violations
//   npm run check:responsive -- --serve            build the fixture, start a server, keep it up
//   npm run check:responsive -- --url http://localhost:PORT   measure a --serve server (no restart)
//   npm run check:responsive -- --list             the screens, their areas and what each shows
//   … --verbose (exemptions, truncations, page errors) · --jobs N · --out DIR · --keep
//
// Free and offline. Every real credential is dropped from this process before
// anything loads, and the dev server it starts gets an EXPLICIT minimal
// environment (PATH, HOME, the proxy and CA variables, the Playwright browsers,
// NODE_ENV and the INKDESK_* modes) — never this shell's. No OPENROUTER key is
// given, so no screen can spend even if something were pressed; nothing here
// presses a spending button (Animate only asks for the estimate, a GET).
//
// The desk is a temp COPY of `data/filming-2026-10-14` plus shares, trailers,
// reports and settings seeded through the studio's own store and services
// (`scripts/responsive-fixture.mts`). The server runs INKDESK_AUTH=test — the
// check's person names itself in a header, so the admin list is reached the
// production way (an account whose email is on ADMIN_EMAILS) and a brand-new
// account's empty desk can be seen too — with the limits ON (in-process
// counters, request windows raised) so the quota meter shows as it does for a
// signed-in person. Sign-in and sign-up are listed but cannot be reached: they
// render only in clerk mode, which needs real Clerk keys and Clerk's network.
//
// Measured per screen and width (`scripts/responsive-measure.mts`):
//   sideways-scroll  html/body wider than the viewport (or a masked overflow),
//                    with the outermost elements that stick out
//   small-target     a visible, enabled control whose hit area is under 44×44
//                    at 390/768 (touch: hasTouch + isMobile, so (pointer:
//                    coarse) matches), under 24×24 at 1280 (WCAG 2.5.8, with
//                    its spacing and inline-link exceptions). A checkbox, radio
//                    or file input is measured by its <label>.
//   text-cut         lettering (.bubble-text, .cover-title, [data-lettering])
//                    clipped by itself or by a clipping ancestor
// Each violation is assigned to an area by the file that renders the element:
// the nearest class on it or its ancestors that only one area's files use.
//
// Screenshots: out/responsive/<width>/<screen>.png (full page). The report:
// out/responsive/report.json, merged across runs so `--only` keeps the rest.
// Exit 0 clean, 1 with any violation, 2 when the check itself could not run.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices, type Browser, type BrowserContext } from 'playwright'
import { NEWCOMER, OWNER, ADMIN_EMAIL, type Fixture } from './responsive-fixture.mjs'
import { HIDE_DEV_CHROME_CSS, HIDE_DEV_CHROME_SCRIPT, MEASURE_SOURCE, SETTLE_SOURCE, type ElementInfo, type Measurement } from './responsive-measure.mjs'
import { AREAS, SCREENS, type Area, type Screen, type ScreenCtx } from './responsive-screens.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DESK = join(ROOT, 'data/filming-2026-10-14')
const env = process.env as Record<string, string | undefined>
const started = Date.now()

// --- Nothing real in this process -----------------------------------------------------------
for (const name of Object.keys(env)) {
  if (/^(CLERK_|S3_|MONGODB_|DB_|NEXT_PUBLIC_|OPENROUTER_|ANTHROPIC_|ELEVENLABS_|REDIS_|BUCKET_|AWS_|CLOUDFLARE_|CLOUDFARE_|RAILWAY_)/.test(name)) delete env[name]
}
for (const name of ['APP_URL', 'ADMIN_URL', 'COMPILE_WORKER_URL', 'ADMIN_EMAILS', 'ALLOWLIST_EMAILS', 'INKDESK_AUTH', 'INKDESK_DATA_DIR', 'NODE_ENV']) delete env[name]

// --- Options -------------------------------------------------------------------------------------
type Options = {
  only: string[] | null
  widths: number[]
  url: string | null
  verbose: boolean
  serve: boolean
  list: boolean
  keep: boolean
  jobs: number
  out: string
  area: Area | null
}

function usage(problem: string): never {
  console.error(`check:responsive: ${problem}`)
  console.error('options: --only a,b,@area,prefix-*  --widths 390,768,1280  --url <base>  --serve  --list  --area <area>  --jobs N  --out DIR  --keep  --verbose')
  process.exit(2)
}

function parseArgs(argv: string[]): Options {
  const o: Options = { only: null, widths: [390, 768, 1280], url: null, verbose: false, serve: false, list: false, keep: false, jobs: 3, out: join(ROOT, 'out/responsive'), area: null }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].includes('=') ? [argv[i].slice(0, argv[i].indexOf('=')), argv[i].slice(argv[i].indexOf('=') + 1)] : [argv[i], undefined]
    const value = () => inline ?? argv[++i] ?? usage(`${flag} needs a value`)
    switch (flag) {
      case '--only': o.only = value().split(',').map((s) => s.trim()).filter(Boolean); break
      case '--widths': o.widths = value().split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0); break
      case '--url': o.url = value().replace(/\/+$/, ''); break
      case '--jobs': o.jobs = Math.max(1, Math.min(6, Number(value()) || 3)); break
      case '--out': o.out = resolve(process.cwd(), value()); break
      case '--area': { const a = value() as Area; if (!AREAS.includes(a)) usage(`--area must be one of ${AREAS.join(', ')}`); o.area = a; break }
      case '--verbose': case '-v': o.verbose = true; break
      case '--serve': o.serve = true; break
      case '--list': o.list = true; break
      case '--keep': o.keep = true; break
      case '--help': case '-h': usage('help')
      default: usage(`unknown option ${flag}`)
    }
  }
  if (o.widths.length === 0) usage('--widths needs at least one width')
  return o
}

const opts = parseArgs(process.argv.slice(2))

function selected(): Screen[] {
  if (!opts.only) return [...SCREENS]
  const picked = new Set<Screen>()
  for (const term of opts.only) {
    const matches = SCREENS.filter((s) =>
      term.startsWith('@') ? s.area === term.slice(1) : term.endsWith('*') ? s.name.startsWith(term.slice(0, -1)) : s.name === term,
    )
    if (matches.length === 0) usage(`--only: no screen matches "${term}" (see --list)`)
    matches.forEach((s) => picked.add(s))
  }
  return SCREENS.filter((s) => picked.has(s))
}

if (opts.list) {
  for (const s of SCREENS) console.log(`${s.name.padEnd(28)} ${s.area.padEnd(9)} ${s.unreachable ? '(unreachable) ' : ''}${s.what}`)
  process.exit(0)
}

// --- Who owns which element: classes → files → areas ---------------------------------------------
const OWNERS: Record<Area, (string | RegExp)[]> = {
  shell: ['components/StationRail.tsx', 'components/Studio.tsx', 'components/StationFooter.tsx', 'components/NewProjectDialog.tsx', 'components/ConfirmDialog.tsx', 'components/SettingsDialog.tsx', 'components/DeskNotice.tsx', 'components/GenerationStatus.tsx', 'app/responsive/shell.css'],
  page: ['components/Panel.tsx', 'components/SpeechBubble.tsx', 'components/PageSwitcher.tsx', 'components/StoryboardStation.tsx', 'components/CoverCard.tsx', 'components/PencilPlaceholder.tsx', 'components/PageScript.tsx', 'app/responsive/page.css', 'components/BubbleEditSheet.tsx'],
  planning: ['components/DirectorStation.tsx', 'components/PagePlanCard.tsx', 'components/StoryStation.tsx', 'components/ScenarioDesk.tsx', 'components/AssetShelf.tsx', 'components/CastStation.tsx', 'components/CharacterCard.tsx', 'components/SpendNote.tsx', 'app/responsive/planning.css'],
  reader: ['components/ReaderStation.tsx', 'components/ReaderParts.tsx', 'components/AnimateStation.tsx', 'components/ShotCard.tsx', 'components/VideoPlayer.tsx', 'components/SharedReader.tsx', 'components/SharedVideo.tsx', 'components/ShareDialog.tsx', 'components/ReportDialog.tsx', 'components/report-dialog.css', 'app/s/share.css', /^app\/s\//, 'app/responsive/reader.css'],
  surfaces: ['components/Dashboard.tsx', 'components/dashboard.css', 'components/VideoCard.tsx', 'components/QuotaMeter.tsx', 'components/AuthControls.tsx', 'components/UsagePanel.tsx', 'components/SettingsNav.tsx', 'components/SettingsHead.tsx', 'components/SettingsDefaults.tsx', 'components/SettingsSharing.tsx', 'components/SettingsExport.tsx', 'components/SettingsDelete.tsx', /^components\/admin\//, /^app\/settings\//, /^app\/admin\//, 'app/terms/page.tsx', 'app/privacy/page.tsx', /^app\/sign-(in|up)\//, 'app/not-found.tsx', 'app/error.tsx', 'app/page.tsx', 'app/responsive/surfaces.css'],
}

function areaOfFile(file: string): Area | null {
  for (const area of AREAS) if (OWNERS[area].some((p) => (typeof p === 'string' ? p === file : p.test(file)))) return area
  return null
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'api' && name !== 'node_modules') walk(path, out)
    } else if (/\.(tsx|css)$/.test(name)) out.push(path)
  }
  return out
}

/** class → the source files that write it (in a string literal of a .tsx, or as a selector in a .css that is its own). */
function buildClassMap(): Map<string, Set<string>> {
  const files = [...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'app'))]
  const cssClasses = new Set<string>()
  for (const f of files.filter((f) => f.endsWith('.css'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)) cssClasses.add(m[1])
  }
  const map = new Map<string, Set<string>>()
  for (const f of files.filter((f) => f.endsWith('.tsx'))) {
    const rel = relative(ROOT, f)
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
      const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ')
      for (const token of text.split(/\s+/)) {
        if (!cssClasses.has(token)) continue
        if (!map.has(token)) map.set(token, new Set())
        map.get(token)!.add(rel)
      }
    }
  }
  return map
}

const classMap = buildClassMap()

/** Component name → the files that define it (a function or const starting with a capital). */
function buildComponentMap(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const f of [...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'app'))].filter((f) => f.endsWith('.tsx'))) {
    const rel = relative(ROOT, f)
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=)/g)) {
      const name = m[1] ?? m[2]
      if (!map.has(name)) map.set(name, new Set())
      map.get(name)!.add(rel)
    }
  }
  return map
}

const componentMap = buildComponentMap()

/**
 * The area that owns an element: the nearest React component that rendered it and is defined in exactly one
 * owned file; else the nearest class only one area's files write; else the screen's own area.
 */
function classify(el: Pick<ElementInfo, 'chain' | 'owners'>, fallback: Area): { area: Area; file: string | null } {
  for (const name of el.owners ?? []) {
    const files = componentMap.get(name)
    if (!files || files.size !== 1) continue
    const [file] = files
    const area = areaOfFile(file)
    if (area) return { area, file }
  }
  for (const classes of el.chain) {
    for (const c of classes) {
      const files = classMap.get(c)
      if (!files || files.size === 0) continue
      const areas = new Set([...files].map(areaOfFile))
      if (areas.size === 1) {
        const [area] = areas
        if (area) return { area, file: [...files].join(', ') }
      }
    }
  }
  return { area: fallback, file: null }
}

// --- The server ---------------------------------------------------------------------------------------
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/** A dist dir of our own, reused run after run (Turbopack's cache lives there) but never by two runs at once. */
function claimDistDir(): { dir: string; release: () => void } {
  for (let slot = 1; slot <= 8; slot++) {
    const dir = `.next-responsive-${slot}`
    const lock = join(ROOT, `${dir}.lock`)
    try {
      mkdirSync(lock)
    } catch {
      let pid = 0
      try {
        pid = Number(readFileSync(join(lock, 'pid'), 'utf8'))
      } catch {}
      let alive = false
      if (pid) {
        try {
          process.kill(pid, 0)
          alive = true
        } catch {}
      }
      if (alive) continue
      rmSync(lock, { recursive: true, force: true })
      try {
        mkdirSync(lock)
      } catch {
        continue
      }
    }
    writeFileSync(join(lock, 'pid'), String(process.pid))
    return { dir, release: () => rmSync(lock, { recursive: true, force: true }) }
  }
  throw new Error('eight responsive servers are already running here; stop one or use --url')
}

/** Exactly what the dev server is given — never this shell's environment. */
function serverEnv(dataDir: string, distDir: string, port: number): NodeJS.ProcessEnv {
  const pass = ['PATH', 'HOME', 'TERM', 'LANG', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'PLAYWRIGHT_BROWSERS_PATH']
  const out: Record<string, string | undefined> = {}
  for (const name of pass) if (env[name] !== undefined) out[name] = env[name]
  return {
    ...out,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    INKDESK_AUTH: 'test',
    INKDESK_STORAGE: 'local',
    INKDESK_QUEUE: 'inline',
    INKDESK_LIMITS: 'on',
    INKDESK_DATA_DIR: dataDir,
    INKDESK_DIST_DIR: distDir,
    VIDEO_ENABLED: 'true',
    ADMIN_EMAILS: ADMIN_EMAIL,
    // A crawl is many reads a minute; the windows are the limits' business, not this check's.
    RATE_READ_PER_MIN: '100000',
    RATE_EDIT_PER_MIN: '100000',
    RATE_MEDIA_PER_MIN: '1000000',
    RATE_ANON_PER_MIN: '100000',
    RATE_ANON_MEDIA_PER_MIN: '1000000',
  }
}

/**
 * `next dev` adds its dist dir's type folders to the tracked tsconfig.json (`include`) when they are not there
 * (`next/dist/lib/typescript/writeConfigurationDefaults.js`), and another dev server sees the change. When the
 * server stops, the entries for OUR dist dir are taken out again — only those; another server's stay.
 */
function untouchTsconfig(distDir: string): void {
  const path = join(ROOT, 'tsconfig.json')
  try {
    const text = readFileSync(path, 'utf8')
    const config = JSON.parse(text) as { include?: string[] }
    if (!Array.isArray(config.include)) return
    const kept = config.include.filter((p) => !p.startsWith(`${distDir}/`))
    if (kept.length === config.include.length) return
    const ours = new Set(config.include.filter((p) => p.startsWith(`${distDir}/`)))
    // Line by line, so the file keeps whatever shape it has now.
    const lines = text.split('\n')
    const out = lines.filter((line) => {
      const m = /^\s*"([^"]+)",?\s*$/.exec(line)
      return !(m && ours.has(m[1]))
    })
    // A trailing comma left on the last entry of `include` would not be JSON: take it off.
    let joined = out.join('\n').replace(/,(\s*\])/g, '$1')
    try {
      JSON.parse(joined)
    } catch {
      joined = `${JSON.stringify({ ...config, include: kept }, null, 2)}\n`
    }
    writeFileSync(path, joined)
  } catch {
    // An unreadable tsconfig is not this check's to mend.
  }
}

type Server = { base: string; stop: () => Promise<void> }

async function startServer(dataDir: string): Promise<Server> {
  const port = await freePort()
  const dist = claimDistDir()
  const next = join(ROOT, 'node_modules/next/dist/bin/next')
  const child: ChildProcess = spawn(process.execPath, [next, 'dev', '--port', String(port), '--hostname', 'localhost'], {
    cwd: ROOT,
    env: serverEnv(dataDir, dist.dir, port),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const log: string[] = []
  const keep = (b: Buffer) => {
    for (const line of b.toString().split('\n')) if (line.trim()) log.push(line)
    if (log.length > 200) log.splice(0, log.length - 200)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  let exited = false
  child.on('exit', () => (exited = true))

  const stop = async () => {
    if (!exited && child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {}
      const t0 = Date.now()
      while (!exited && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 100))
      if (!exited) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {}
      }
    }
    untouchTsconfig(dist.dir)
    dist.release()
  }
  cleanups.push(stop)

  const base = `http://localhost:${port}`
  const t0 = Date.now()
  while (Date.now() - t0 < 180_000) {
    if (exited) throw new Error(`the dev server exited:\n${log.slice(-25).join('\n')}`)
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(60_000) })
      if (res.status < 500 || res.status === 503) return { base, stop }
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`the dev server did not answer in 3 minutes:\n${log.slice(-25).join('\n')}`)
}

// --- Clean-up, whatever happens -----------------------------------------------------------------------
const cleanups: (() => Promise<void>)[] = []
let cleaning: Promise<void> | null = null
function cleanup(): Promise<void> {
  cleaning ??= (async () => {
    for (const fn of cleanups.reverse()) {
      try {
        await fn()
      } catch {}
    }
  })()
  return cleaning
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    console.error(`\ncheck:responsive: ${sig} — stopping the server and removing the temp desk`)
    void cleanup().then(() => process.exit(2))
  })
}

// --- Measuring --------------------------------------------------------------------------------------------
type Kind = 'sideways-scroll' | 'small-target' | 'text-cut'
type Violation = { area: Area; screen: string; width: number; kind: Kind; selector: string; label: string; detail: string; file: string | null }
type Note = { screen: string; width: number; area: Area; selector: string; label: string; detail: string; file: string | null }
type WidthResult = {
  url: string
  screenshot: string | null
  ms: number
  coarse: boolean
  innerWidth: number
  scrollWidth: number
  targetsChecked: number
  violations: Violation[]
  exemptions: Note[]
  truncations: Note[]
  errors: string[]
  failure: string | null
}
type ScreenResult = { area: Area; what: string; widths: Record<string, WidthResult> }

const touchOf = (w: number) => w < 1024

function contextOptions(width: number): Parameters<Browser['newContext']>[0] {
  const common = { reducedMotion: 'reduce' as const, locale: 'en-GB', timezoneId: 'Europe/London', ignoreHTTPSErrors: false }
  if (width < 600) {
    return { ...common, userAgent: devices['Pixel 7'].userAgent, viewport: { width, height: 844 }, screen: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  }
  if (touchOf(width)) {
    return { ...common, userAgent: devices['iPad Mini'].userAgent, viewport: { width, height: 1024 }, screen: { width, height: 1024 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  }
  return { ...common, viewport: { width, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
}

function headersFor(who: Screen['who']): Record<string, string> {
  if (who === 'owner') return { 'x-inkdesk-test-user': OWNER }
  if (who === 'newcomer') return { 'x-inkdesk-test-user': NEWCOMER }
  return {}
}

/** One lock for the studio screens: they set a project's station on the server, so two at once would race. */
let studioTail: Promise<void> = Promise.resolve()
function studioTurn(): Promise<() => void> {
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  const before = studioTail
  studioTail = before.then(() => mine)
  return before.then(() => release)
}

function toNote(screen: Screen, width: number, el: ElementInfo, detail: string): Note {
  const { area, file } = classify(el, screen.area)
  return { screen: screen.name, width, area, selector: el.selector, label: el.label, detail, file }
}

async function measureOne(ctx: BrowserContext, base: string, fx: Fixture, screen: Screen, width: number): Promise<WidthResult> {
  const t0 = Date.now()
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.length < 8 && errors.push(`pageerror: ${e.message.split('\n')[0]}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && errors.length < 8) errors.push(`console: ${m.text().split('\n')[0].slice(0, 200)}`)
  })
  const headers = headersFor(screen.who)
  await page.setExtraHTTPHeaders(headers)
  const touch = touchOf(width)
  const shotPath = join(opts.out, String(width), `${screen.name}.png`)
  const result: WidthResult = { url: '', screenshot: null, ms: 0, coarse: false, innerWidth: 0, scrollWidth: 0, targetsChecked: 0, violations: [], exemptions: [], truncations: [], errors, failure: null }

  const sctx: ScreenCtx = {
    page,
    request: ctx.request,
    base,
    fx,
    width,
    touch,
    headers,
    goto: async (path) => {
      await page.goto(base + path, { waitUntil: 'load', timeout: 180_000 })
    },
    press: async (target, how = {}) => {
      await target.waitFor({ state: 'visible', timeout: 30_000 })
      await target.scrollIntoViewIfNeeded()
      if (touch) await target.tap({ timeout: 15_000, force: how.force })
      else await target.click({ timeout: 15_000, force: how.force })
    },
    studio: async (projectId, station, pageIndex) => {
      const body: Record<string, unknown> = { station }
      if (pageIndex !== undefined) body.page = pageIndex
      const res = await ctx.request.post(`${base}/api/projects/${projectId}`, { data: body, headers: { ...headers, origin: base }, timeout: 180_000 })
      if (!res.ok()) throw new Error(`setting the station to ${station} answered ${res.status()}: ${(await res.text()).slice(0, 200)}`)
      await page.goto(`${base}/p/${projectId}`, { waitUntil: 'load', timeout: 180_000 })
      await page.locator('.studio .rail, .studio nav[aria-label="Stations"]').first().waitFor({ state: 'visible', timeout: 120_000 })
      if (station === 'storyboard') await page.locator('.page-switcher').first().waitFor({ state: 'visible', timeout: 60_000 })
      if (station === 'reader') await page.locator('.reader-sheet').first().waitFor({ state: 'visible', timeout: 60_000 })
      if (station === 'storyboard' && pageIndex !== undefined) {
        await page.locator('.animate').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      }
    },
  }

  const release = screen.studio ? await studioTurn() : null
  try {
    await screen.run!(sctx)
    if (screen.ready) await page.locator(screen.ready).first().waitFor({ state: 'visible', timeout: 60_000 })
    await page.addStyleTag({ content: HIDE_DEV_CHROME_CSS }).catch(() => {})
    await page.evaluate(SETTLE_SOURCE)
    await page.waitForTimeout(150)
    const m = (await page.evaluate(`(${MEASURE_SOURCE})(${JSON.stringify({ width, minTarget: touch ? 44 : 24, spacing: !touch, scope: screen.scope ?? null, verbose: opts.verbose })})`)) as Measurement
    result.url = page.url().replace(base, '')
    result.coarse = m.coarse
    result.innerWidth = m.innerWidth
    result.scrollWidth = Math.max(m.docScrollWidth, m.bodyScrollWidth)
    result.targetsChecked = m.targetsChecked
    if (!m.scopeFound) result.failure = `the dialog (${screen.scope}) was not found when measuring`
    if (touch !== m.coarse) errors.push(`(pointer: coarse) is ${m.coarse} at ${width} — the emulation is not what the check meant`)

    if (m.sideways || (m.masked && m.offenders.length > 0)) {
      const culprits = m.offenders.slice(0, 4).map((o) => `${o.selector} (${o.left}→${o.right})`).join('; ')
      const first = m.offenders[0]
      const { area, file } = first ? classify(first, screen.area) : { area: screen.area, file: null }
      result.violations.push({
        area,
        screen: screen.name,
        width,
        kind: 'sideways-scroll',
        selector: first?.selector ?? 'html',
        label: first?.label ?? '',
        detail: `page is ${result.scrollWidth}px wide in a ${width}px viewport${m.innerWidth !== width ? ` (the browser zoomed out to ${m.innerWidth}px)` : ''}${m.masked ? `; masked by ${m.masked}` : ''}${culprits ? ` — sticking out: ${culprits}` : ''}`,
        file,
      })
      // The other culprits, each by its own owner, so every area sees its part.
      for (const o of m.offenders.slice(1, 6)) {
        const c = classify(o, screen.area)
        if (c.area !== area) result.violations.push({ area: c.area, screen: screen.name, width, kind: 'sideways-scroll', selector: o.selector, label: o.label, detail: `sticks out to ${o.right}px (${o.width}px wide) in a ${width}px viewport`, file: c.file })
      }
    }
    for (const t of m.small) {
      const n = toNote(screen, width, t, '')
      result.violations.push({ ...n, kind: 'small-target', detail: `${t.w}×${t.h}px${t.hitFrom === 'label' ? ' (its label)' : ''}, under ${touch ? 44 : 24}×${touch ? 44 : 24}` })
    }
    for (const c of m.cut) {
      const n = toNote(screen, width, c, c.detail)
      result.violations.push({ ...n, kind: 'text-cut' })
    }
    result.exemptions = m.exempt.map((e) => toNote(screen, width, e, `${e.w}×${e.h}px — ${e.reason}`))
    result.truncations = m.truncated.map((t) => toNote(screen, width, t, t.detail))

    await capture(page, shotPath, width, !screen.scope)
    result.screenshot = relative(ROOT, shotPath)
  } catch (err) {
    result.failure = err instanceof Error ? err.message.split('\n').slice(0, 3).join(' ') : String(err)
    try {
      await capture(page, shotPath, width, !screen.scope)
      result.screenshot = relative(ROOT, shotPath)
    } catch {}
  } finally {
    release?.()
    await page.close().catch(() => {})
  }
  result.ms = Date.now() - t0
  return result
}

/**
 * A full-page picture that keeps the touch emulation. Playwright's `fullPage` capture drops it for the shot (a
 * 768 px tablet came out with desktop-pointer styles and a sticky footer floating mid-page), so the viewport is
 * grown to the page's height instead, the picture taken, and the viewport put back.
 */
async function capture(page: import('playwright').Page, path: string, width: number, full: boolean): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  if (!full) {
    // A dialog: what the person sees with it open is the viewport.
    await page.screenshot({ path, animations: 'disabled', timeout: 60_000 })
    return
  }
  const viewport = page.viewportSize() ?? { width, height: 800 }
  const height = Number(await page.evaluate('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)'))
  const tall = Math.min(Math.max(height, viewport.height), 16_000)
  try {
    if (tall > viewport.height) {
      await page.setViewportSize({ width: viewport.width, height: tall })
      await page.evaluate(SETTLE_SOURCE)
    }
    await page.screenshot({ path, animations: 'disabled', timeout: 60_000 })
  } finally {
    if (tall > viewport.height) await page.setViewportSize(viewport).catch(() => {})
  }
}

/** Compile every route once, in turn, before the crawl: the first visit to a route in `next dev` is slow. */
async function warmUp(base: string, fx: Fixture): Promise<void> {
  const owner = { 'x-inkdesk-test-user': OWNER }
  const paths = ['/', `/p/${fx.projectId}`, '/settings/account', '/settings/defaults', '/settings/sharing', '/settings/data', '/settings/usage', '/admin/reports', '/terms', '/privacy', '/no-such-page-here', `/s/${fx.mangaToken}`, `/s/${fx.missingToken}`, '/api/usage', `/api/projects/${fx.projectId}`, `/api/projects/${fx.projectId}/status`, `/api/projects/${fx.projectId}/pages/0/animate`, '/api/shares']
  for (const p of paths) {
    try {
      await fetch(base + p, { headers: owner, signal: AbortSignal.timeout(180_000) }).then((r) => r.arrayBuffer())
    } catch {}
  }
}

// --- Main ------------------------------------------------------------------------------------------------------
async function main(): Promise<number> {
  const screens = selected()
  const reachable = screens.filter((s) => !s.unreachable)
  let base = opts.url
  let fx: Fixture

  if (!base) {
    const dir = await mkdtemp(join(tmpdir(), 'inkdesk-responsive-'))
    if (!opts.keep) cleanups.push(() => rm(dir, { recursive: true, force: true }))
    env.INKDESK_DATA_DIR = join(dir, 'desk')
    env.INKDESK_STORAGE = 'local'
    env.INKDESK_QUEUE = 'inline'
    env.INKDESK_AUTH = 'test'
    env.INKDESK_LIMITS = 'off'
    env.VIDEO_ENABLED = 'true'
    const { buildFixture } = await import('./responsive-fixture.mjs')
    const t0 = Date.now()
    // The share views carry an absolute URL; the records do not, so any origin will do here.
    fx = await buildFixture(ROOT, SOURCE_DESK, join(dir, 'media'), 'http://localhost')
    console.log(`fixture: ${env.INKDESK_DATA_DIR} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    const t1 = Date.now()
    const server = await startServer(env.INKDESK_DATA_DIR)
    base = server.base
    console.log(`server: ${base} (up in ${((Date.now() - t1) / 1000).toFixed(1)} s)`)
    if (opts.serve) {
      writeFixtureNote(base, fx)
      console.log(`\nServing the fixture desk. Measure it with:\n  npm run check:responsive -- --url ${base} [--only …]\nStop with Ctrl-C (the server and the temp desk go with it).`)
      await new Promise(() => {})
    }
  } else {
    const get = async (path: string) => {
      const res = await fetch(base + path, { headers: { 'x-inkdesk-test-user': OWNER }, signal: AbortSignal.timeout(180_000) })
      if (!res.ok) throw new Error(`${path} answered ${res.status} — is --url a check:responsive --serve server?`)
      return res.json()
    }
    const { discoverFixture } = await import('./responsive-fixture.mjs')
    fx = await discoverFixture(get)
    console.log(`server: ${base} (reused)`)
  }

  const t2 = Date.now()
  await warmUp(base, fx)
  console.log(`warm-up: ${((Date.now() - t2) / 1000).toFixed(1)} s`)

  const browser = await chromium.launch({ headless: true })
  cleanups.push(() => browser.close())
  const contexts = new Map<number, BrowserContext>()
  for (const w of opts.widths) {
    const ctx = await browser.newContext(contextOptions(w))
    // The dev server's badge sits over the bottom-left corner and would take taps meant for the page.
    await ctx.addInitScript(HIDE_DEV_CHROME_SCRIPT)
    contexts.set(w, ctx)
  }

  const results: Record<string, ScreenResult> = {}
  const jobs: { screen: Screen; width: number }[] = []
  // Studio screens first, so the one-at-a-time queue starts early while the others run beside it.
  const ordered = [...reachable.filter((s) => s.studio), ...reachable.filter((s) => !s.studio)]
  for (const screen of ordered) for (const width of opts.widths) jobs.push({ screen, width })
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < jobs.length) {
      const { screen, width } = jobs[next++]
      let r = await measureOne(contexts.get(width)!, base!, fx, screen, width)
      // Once more on a failure: a dev server recompiling (someone saved a file) can reload a page under the check.
      if (r.failure) {
        const again = await measureOne(contexts.get(width)!, base!, fx, screen, width)
        r = again.failure ? { ...again, failure: `${again.failure} (twice; a dev server stuck reloading pages — e.g. after tsconfig.json changed — needs a restart)` } : again
      }
      results[screen.name] ??= { area: screen.area, what: screen.what, widths: {} }
      results[screen.name].widths[String(width)] = r
      done++
      const mark = r.failure ? '!' : r.violations.length ? '✗' : '✓'
      process.stdout.write(`  ${mark} ${screen.name} @${width} ${r.violations.length ? `${r.violations.length} violation(s) ` : ''}${r.failure ? `FAILED: ${r.failure} ` : ''}(${(r.ms / 1000).toFixed(1)} s, ${done}/${jobs.length})\n`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.jobs, jobs.length) }, worker))

  const report = writeReport(results, screens.filter((s) => s.unreachable), base)
  return summarize(results, screens, report)
}

function writeFixtureNote(base: string, fx: Fixture): void {
  mkdirSync(opts.out, { recursive: true })
  writeFileSync(join(opts.out, 'fixture.json'), JSON.stringify({ base, ...fx, owner: OWNER, newcomer: NEWCOMER }, null, 2))
}

type Report = {
  generatedAt: string
  base: string
  widths: number[]
  screens: Record<string, ScreenResult>
  unreachable: { screen: string; area: Area; reason: string }[]
  violations: Violation[]
  failures: { screen: string; width: number; failure: string }[]
}

function writeReport(results: Record<string, ScreenResult>, unreachable: Screen[], base: string): Report {
  mkdirSync(opts.out, { recursive: true })
  const path = join(opts.out, 'report.json')
  let previous: Report | null = null
  if (existsSync(path)) {
    try {
      previous = JSON.parse(readFileSync(path, 'utf8')) as Report
    } catch {}
  }
  const screens: Record<string, ScreenResult> = { ...(previous?.screens ?? {}) }
  for (const [name, r] of Object.entries(results)) {
    screens[name] = { ...r, widths: { ...(screens[name]?.widths ?? {}), ...r.widths } }
  }
  // Screens that no longer exist drop out of the merged report.
  for (const name of Object.keys(screens)) if (!SCREENS.some((s) => s.name === name)) delete screens[name]
  const all = Object.values(screens).flatMap((s) => Object.values(s.widths))
  const report: Report = {
    generatedAt: new Date().toISOString(),
    base,
    widths: [...new Set([...(previous?.widths ?? []), ...opts.widths])].sort((a, b) => a - b),
    screens,
    unreachable: SCREENS.filter((s) => s.unreachable).map((s) => ({ screen: s.name, area: s.area, reason: s.unreachable! })),
    violations: all.flatMap((w) => w.violations),
    failures: Object.entries(screens).flatMap(([name, s]) => Object.entries(s.widths).filter(([, w]) => w.failure).map(([width, w]) => ({ screen: name, width: Number(width), failure: w.failure! }))),
  }
  void unreachable
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(report, null, 2))
  renameSync(tmp, path)
  return report
}

function summarize(results: Record<string, ScreenResult>, screens: Screen[], report: Report): number {
  const thisRun = Object.values(results).flatMap((s) => Object.values(s.widths))
  const violations = thisRun.flatMap((w) => w.violations).filter((v) => !opts.area || v.area === opts.area)
  const failures = Object.entries(results).flatMap(([name, s]) => Object.entries(s.widths).filter(([, w]) => w.failure).map(([width, w]) => `${name} @${width}: ${w.failure}`))

  console.log(`\n── violations${opts.area ? ` (area ${opts.area})` : ''} ──`)
  if (violations.length === 0) console.log('  none')
  // Grouped: the same element (by area, kind, selector and label) is one entry, with the screens it was seen on.
  const groups = new Map<string, { v: Violation; screens: Set<string>; details: Map<string, number> }>()
  for (const v of violations) {
    const key = `${v.area}|${v.kind}|${v.selector}|${v.label}`
    const g = groups.get(key) ?? { v, screens: new Set<string>(), details: new Map<string, number>() }
    g.screens.add(v.screen)
    const d = `@${v.width} ${v.detail}`
    g.details.set(d, (g.details.get(d) ?? 0) + 1)
    groups.set(key, g)
  }
  for (const area of AREAS) {
    const mine = [...groups.values()].filter((g) => g.v.area === area)
    if (mine.length === 0) continue
    console.log(`\n[${area}] ${mine.length} distinct`)
    for (const g of mine.sort((a, b) => a.v.kind.localeCompare(b.v.kind) || a.v.selector.localeCompare(b.v.selector))) {
      const label = g.v.label ? ` “${g.v.label}”` : ''
      console.log(`  ${g.v.kind} · ${g.v.selector}${label}${g.v.file ? `  (${g.v.file})` : ''}`)
      const details = [...g.details].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      for (const [d, n] of details.slice(0, 6)) console.log(`      ${d}${n > 1 ? ` (×${n})` : ''}`)
      if (details.length > 6) console.log(`      … ${details.length - 6} more`)
      console.log(`      on: ${[...g.screens].join(', ')}`)
    }
  }

  if (opts.verbose) {
    console.log('\n── exemptions ──')
    for (const n of thisRun.flatMap((w) => w.exemptions)) console.log(`  ${n.screen} @${n.width} ${n.selector} “${n.label}” — ${n.detail}`)
    console.log('\n── truncated text (ellipsis / line-clamp; reported, not failed) ──')
    for (const n of thisRun.flatMap((w) => w.truncations)) console.log(`  ${n.screen} @${n.width} ${n.selector} — ${n.detail}`)
    console.log('\n── page errors ──')
    for (const [name, s] of Object.entries(results)) for (const [w, r] of Object.entries(s.widths)) for (const e of r.errors) console.log(`  ${name} @${w} ${e}`)
  }

  const unreachable = screens.filter((s) => s.unreachable)
  if (unreachable.length) {
    console.log('\n── not reachable on a check desk ──')
    for (const s of unreachable) console.log(`  ${s.name}: ${s.unreachable}`)
  }
  if (failures.length) {
    console.log('\n── screens the check could not finish ──')
    for (const f of failures) console.log(`  ${f}`)
  }
  const byKind = (k: Kind) => violations.filter((v) => v.kind === k).length
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(
    `\n${Object.keys(results).length} screens × ${opts.widths.join('/')} px: ${violations.length} violation(s) — ${byKind('sideways-scroll')} sideways, ${byKind('small-target')} small targets, ${byKind('text-cut')} cut text${failures.length ? `; ${failures.length} unfinished` : ''} — ${secs} s`,
  )
  console.log(`screenshots: ${relative(ROOT, opts.out)}/<width>/<screen>.png · report: ${relative(ROOT, join(opts.out, 'report.json'))} (${report.violations.length} violation(s) across every screen measured so far)`)
  if (failures.length) return 2
  return violations.length > 0 ? 1 : 0
}

let code = 2
try {
  code = await main()
} catch (err) {
  console.error(`check:responsive could not run: ${err instanceof Error ? err.message : String(err)}`)
  code = 2
} finally {
  await cleanup()
}
process.exit(code)
