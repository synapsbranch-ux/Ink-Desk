// The capture: Playwright drives the REAL running app and records it — the
// live, private studio (v3) or a local one. Two journeys feed the same edit
// (src/cut.ts): a FRESH project generated on camera, or a FINISHED chapter
// walked station by station with `--project <id>` (a seeded copy, nothing
// generated, nothing spent). Every generation shown is real; the waits are
// long because the art is, and the edit time-lapses them (src/timeline.ts),
// it never fakes them.
//
//   cd video && npx tsx capture/record.mts [--url https://studio.example] [--project <id>]
//                                          [--short] [--seed capture/seed.json]
//                                          [--quality high] [--out <dir>]
//                                          [--stop-after <mark>]
//   npm run video:capture -- --url https://… --project <id>     (from the repo root)
//   npm run video:capture -- --short                             (a local app, page 1 only)
//
// A private studio redirects to /sign-in: the capture signs in with
// INKDESK_CAPTURE_EMAIL and INKDESK_CAPTURE_PASSWORD, from the environment or
// the repo's .env (the same loader as the OpenRouter key, openrouter.ts). The
// email is typed where the viewer can watch it; the password is filled, never
// typed, never printed and never written to any file here. On a local app
// with INKDESK_AUTH=off there is no sign-in and the two are not needed.
//
// Writes, once the run succeeds (it reaches `end`, or --stop-after's mark):
//   video/timeline.json                 marks (MARKS in src/timeline.ts, in order,
//                                       each when its moment is on screen; t =
//                                       seconds into the footage, which is wall
//                                       time since its first frame — see
//                                       screencast.mts), the path filmed, and
//                                       the public share page's path
//   video/public/capture/footage.mp4    the recording, 1920×1080 h264 at 30 fps
//   video/public/capture/stills/        the money shot: the imported picture, the
//                                       lead's panels across the pages, the cover
//   video/public/capture/chapter.pdf    the exported PDF (proof the export ran)
//
// The fresh journey: sign in → the desk → New project → the scenario → the
// Library (import, DNA, lock) → the Director's plan → pages ink in → a bubble
// edit → a redraw → the rest of the chapter and the cover → the reader → Export
// PDF → Share publicly → the public page in a signed-out window. --short
// generates page 1 only and no cover (≈ $0.10 at `low`); it still edits a
// bubble, redraws a panel, opens the reader, exports and shares, and has no
// `chapter-inked` mark.
//
// The seeded journey (--project <id>): sign in → the desk → the finished
// chapter → Story (the saved scenario) → Library (the locked cards, the DNA
// beside the sheet) → Director (the plan and the estimate) → the Pages (each
// inked page; the bubble edit from seed.json on page 1 — app lettering, free)
// → the reader → Export PDF → Share publicly → the public page. Nothing is
// generated, so --quality and --short mean nothing on it (a note says so).
//
// --out <dir> writes all of the above into one scratch folder instead (the
// footage, stills/, chapter.pdf and timeline.json side by side), so a test run
// never touches the real capture. The paths inside its timeline stay the ones
// the edit expects (capture/…).
//
// --stop-after <mark> ends the capture a beat after that mark, as a success:
// e.g. `--stop-after scenario-ready` films only what costs nothing — the
// Library's cast proposal right after it is the first paid call.
//
// A run records into its own folder beside the capture, public/capture/run-<time>/,
// and only moves its footage, stills/, chapter.pdf and timeline over the
// previous ones when it succeeds — the last good capture was paid for, and a
// failed or interrupted run (or a test) must not cost it. On any failure the
// footage so far is still finished, the folder is renamed failed-<time>/ with
// the marks reached in its own timeline.json, the previous capture and
// video/timeline.json are left as they were, and the script exits non-zero
// naming the step that stopped. The folder mirrors the capture's, so its files
// can be moved into place by hand if that partial run is wanted.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
// Two of the app's own pure modules: the preset table (so the recorder clicks
// the label the dialog really shows) and the owner-checked image route's
// address (slice 19). No imports, no environment — safe to read here.
import { imageUrl } from '../../lib/image-url.ts'
import { STYLE_PRESETS, type StylePresetId } from '../../lib/styles.ts'
import { setting } from '../openrouter.ts'
import { FPS, HEIGHT, MARKS, WIDTH, type CaptureTimeline, type MarkName, type MoneyShotStills } from '../src/timeline.ts'
import { onScreen, startRecording, type Recording } from './screencast.mts'

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..')
const FOOTAGE = 'capture/footage.mp4' // relative to video/public, as the timeline records it

const W = WIDTH
const H = HEIGHT

// Waits. A text call (cast, DNA, plan) is a minute or two through the
// fallback; an image is up to GENERATION_TIMEOUT_MS before the app itself
// calls it failed, so the recorder waits a little longer than the app would.
const IMAGE_MS = Number(process.env.GENERATION_TIMEOUT_MS) || 360_000
const TEXT_MS = 5 * 60_000
const POLL_MS = 1000
/** A readable pause after each visible result, so the edit has something to cut on. */
const BEAT = 1000
/** The money shot shows this many of the lead's panels, spread across the pages when there are more. */
const MONEY_SHOT_PANELS = 6

// ---------------------------------------------------------------------------
// Flags and seed

const INVOKED_FROM = process.env.INIT_CWD ?? process.cwd() // npm --prefix runs us from video/

function readFlags() {
  try {
    return parseArgs({
      options: {
        url: { type: 'string', default: 'http://localhost:3000' },
        project: { type: 'string' },
        short: { type: 'boolean', default: false },
        seed: { type: 'string' },
        quality: { type: 'string' },
        out: { type: 'string' },
        'stop-after': { type: 'string' },
      },
      strict: true,
    }).values
  } catch {
    console.error(
      '\nThe capture takes --url <address>, --project <id>, --short, --seed <file>, --quality <name>, --out <dir> and --stop-after <mark>; nothing else.\n',
    )
    process.exit(1)
  }
}
const flags = readFlags()

const BASE = flags.url!.replace(/\/+$/, '')
/** The finished chapter to walk instead of generating one (the seeded journey). */
const PROJECT = flags.project?.trim() || null
const SHORT = flags.short === true && !PROJECT
// Only a fallback: the timeline records the app's own quality once the project is open.
const QUALITY = flags.quality ?? process.env.IMAGE_PANEL_QUALITY ?? 'unknown'
const SEED_PATH = flags.seed ? resolve(INVOKED_FROM, flags.seed) : join(VIDEO, 'capture', 'seed.json')

/** The sign-in for a private studio; `null` when neither variable is set. Read once, never printed. */
const CREDENTIALS = (() => {
  const email = setting('INKDESK_CAPTURE_EMAIL')
  const password = setting('INKDESK_CAPTURE_PASSWORD')
  return email && password ? { email, password } : null
})()
const NO_CREDENTIALS =
  'the studio asks for a sign-in and there are no capture credentials: set INKDESK_CAPTURE_EMAIL and INKDESK_CAPTURE_PASSWORD in the environment or in the .env at the repository root'

// Where everything is written: the real places, or one scratch folder.
const OUT = flags.out ? resolve(INVOKED_FROM, flags.out) : null
const CAPTURE_DIR = OUT ?? join(VIDEO, 'public', 'capture')
const TIMELINE = OUT ? join(OUT, 'timeline.json') : join(VIDEO, 'timeline.json')
// This run's own folder: it replaces the capture above only on success, and
// is set aside as failed-<time> otherwise (see the top of the file).
const STAMP = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
const RUN_DIR = join(CAPTURE_DIR, `run-${STAMP}`)
const FAILED_DIR = join(CAPTURE_DIR, `failed-${STAMP}`)
const RUN_TIMELINE = join(RUN_DIR, 'timeline.json')
const FOOTAGE_FILE = join(RUN_DIR, 'footage.mp4')
const STILLS_DIR = join(RUN_DIR, 'stills')
const PDF_FILE = join(RUN_DIR, 'chapter.pdf')
const FAILURE_PNG = join(RUN_DIR, 'failure.png')
/** What a successful run replaces in CAPTURE_DIR, as one set; failure.png is an old run's, cleared with it. */
const CAPTURED = ['footage.mp4', 'stills', 'chapter.pdf', 'failure.png']
/** A path as the person typing would write it: relative when it is under where they ran us, whole otherwise. */
const shown = (path: string) => {
  const r = relative(INVOKED_FROM, path)
  return r === '' ? '.' : r.startsWith('..') ? path : r
}

const STOP_AFTER = flags['stop-after'] as MarkName | undefined
if (STOP_AFTER !== undefined && !MARKS.some((m) => m.name === STOP_AFTER)) {
  console.error(`\n--stop-after takes a mark's name: ${MARKS.map((m) => m.name).join(', ')}.\n`)
  process.exit(1)
}

type Seed = {
  title: string
  preset: StylePresetId
  /** 'sample' clicks Try the sample scenario; anything else is a text file, relative to the seed. */
  scenario: string
  /** The picture imported as the lead's sheet, relative to the seed. */
  character: string
  /** The file name the shelf shows. Defaults to the picture's own. */
  uploadName?: string
  /** The words typed into page 1, panel 1's bubble (both journeys). */
  bubble: string
  /** Which panel of page 1 is redrawn, 1–4 (the fresh journey). */
  redrawPanel: number
}

function quit(sentence: string): never {
  console.error(`\n${sentence}\n`)
  process.exit(1)
}

function readSeed(): Seed & { scenarioText: string | null; picture: Buffer; pictureType: string } {
  if (!existsSync(SEED_PATH)) quit(`There is no seed file at ${SEED_PATH}.`)
  let seed: Seed
  try {
    seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed
  } catch {
    quit(`The seed file ${SEED_PATH} is not valid JSON.`)
  }
  const here = dirname(SEED_PATH)
  if (!seed.title?.trim()) quit('The seed needs a title.')
  if (!(seed.preset in STYLE_PRESETS)) {
    quit(`The seed's preset "${seed.preset}" is not one of the app's: ${Object.keys(STYLE_PRESETS).join(', ')}.`)
  }
  if (!seed.bubble?.trim()) quit('The seed needs the bubble words to type.')
  if (![1, 2, 3, 4].includes(seed.redrawPanel)) quit('The seed\'s redrawPanel is a panel of page 1, from 1 to 4.')
  let scenarioText: string | null = null
  if (seed.scenario !== 'sample') {
    const p = resolve(here, seed.scenario)
    if (!existsSync(p)) quit(`The seed's scenario file ${p} is missing.`)
    scenarioText = readFileSync(p, 'utf8').trim()
    if (!scenarioText) quit(`The seed's scenario file ${p} is empty.`)
  }
  const pic = resolve(here, seed.character)
  if (!existsSync(pic)) quit(`The seed's character picture ${pic} is missing.`)
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
  const pictureType = types[extname(pic).toLowerCase()]
  if (!pictureType) quit('The character picture must be a PNG, JPEG or WebP.')
  return { ...seed, uploadName: seed.uploadName ?? basename(pic), scenarioText, picture: readFileSync(pic), pictureType }
}

// ---------------------------------------------------------------------------
// The timeline, written into the run's folder after every mark so a capture
// that stops still has the marks it reached; the real one is written only on
// success. The quality starts as the flag's (or this shell's) guess and is
// replaced by the app's own once the project is open. Nothing private goes in
// it: not the email, never the password; the share path is a public link.

const timeline: CaptureTimeline = {
  version: 1,
  recordedAt: null,
  quality: QUALITY,
  footage: null,
  duration: null,
  marks: [],
  stills: null,
  path: PROJECT ? 'seeded' : 'fresh',
  share: null,
}
const saveTimeline = (file = RUN_TIMELINE) => writeFileSync(file, `${JSON.stringify(timeline, null, 2)}\n`)

let recording: Recording | null = null
/**
 * Why the capture is stopping, once something outside the journey says so (a
 * Ctrl+C, ffmpeg failing). The journey checks it at every wait and mark, so
 * nothing more is started — or spent — after it is set.
 */
let failure: unknown = null

const ORDER = MARKS.map((m) => m.name as string)
/** Ends the journey after --stop-after's mark; not a failure. */
class StoppedAfter extends Error {}

/** The moment on screen now, in footage seconds — the recorder's own clock, so it is where the file shows it. */
async function mark(name: MarkName): Promise<void> {
  if (failure) throw failure
  const last = timeline.marks.at(-1)
  if (last && ORDER.indexOf(name) <= ORDER.indexOf(last.name)) throw new Error(`mark ${name} out of order`)
  const { t, late } = await onScreen(page, recording!)
  timeline.marks.push({ name, t })
  saveTimeline()
  console.log(`  · ${name.padEnd(16)} ${t.toFixed(1).padStart(7)} s${late > 0.25 ? `  (painted ${late.toFixed(1)} s after it was found)` : ''}`)
  if (name === STOP_AFTER) {
    await pause(BEAT) // a beat of the moment itself, so a cut on this mark has somewhere to land
    throw new StoppedAfter()
  }
}

// ---------------------------------------------------------------------------
// Watchable driving: a visible cursor, smooth moves, gentle scrolls.

/** An ink pointer that follows the mouse, with a hanko ring on each press. Headless Chromium draws no cursor of its own. */
const CURSOR_SCRIPT = `(() => {
  const ID = '__inkdesk_capture_cursor'
  let x = -80, y = -80, down = false
  const cursor = () => {
    let c = document.getElementById(ID)
    if (!c && document.documentElement) {
      c = document.createElement('div')
      c.id = ID
      c.setAttribute('aria-hidden', 'true')
      c.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M4 3 L4 27 L10.5 21 L15 30.5 L19.5 28.6 L15 19.4 L24 19.4 Z" fill="#201f1d" stroke="#f3f2f2" stroke-width="1.8" stroke-linejoin="round"/></svg>'
      Object.assign(c.style, { position: 'fixed', left: '0', top: '0', width: '34px', height: '34px', pointerEvents: 'none', zIndex: '2147483647', transformOrigin: '4px 3px', filter: 'drop-shadow(0 2px 3px rgba(45,43,43,.35))' })
      document.documentElement.appendChild(c)
    }
    return c
  }
  const place = () => {
    const c = cursor()
    if (c) c.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 3) + 'px) scale(' + (down ? 0.85 : 1) + ')'
  }
  const ring = () => {
    const r = document.createElement('div')
    Object.assign(r.style, { position: 'fixed', left: (x - 18) + 'px', top: (y - 18) + 'px', width: '36px', height: '36px', borderRadius: '50%', border: '3px solid #b5382e', pointerEvents: 'none', zIndex: '2147483646', opacity: '0.9', transition: 'transform 420ms ease-out, opacity 420ms ease-out', transform: 'scale(0.4)' })
    document.documentElement.appendChild(r)
    requestAnimationFrame(() => { r.style.transform = 'scale(1.3)'; r.style.opacity = '0' })
    setTimeout(() => r.remove(), 500)
  }
  // The dev server's corner badge is the app's build tool, not the app: kept out of the film.
  const hideDevBadge = () => {
    if (document.getElementById(ID + '_style') || !document.head) return
    const st = document.createElement('style')
    st.id = ID + '_style'
    st.textContent = 'nextjs-portal { display: none !important; }'
    document.head.appendChild(st)
  }
  addEventListener('DOMContentLoaded', hideDevBadge)
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place() }, true)
  addEventListener('mousedown', () => { down = true; place(); ring() }, true)
  addEventListener('mouseup', () => { down = false; place() }, true)
})()`

/** The page the helpers drive: the owner's window, then — for the public page — the visitor's. */
let page: Page
/** The owner's browser context: its cookies carry the signed-in session, so every read of the app goes through it. */
let context: BrowserContext | null = null
/** A second context with no cookies — a stranger with the link — for the public share page. */
let visitor: BrowserContext | null = null
let mx = W / 2
let my = H / 2

const pause = (ms: number) => page.waitForTimeout(ms)
const GLIDE_STEP_MS = 40
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)

/**
 * Glide the pointer so the footage shows a hand rather than a jump: 25 moves
 * a second (the pace the journey was tuned at; every move still lands on a
 * frame at 30 fps), half a second to a second per glide.
 */
async function glide(x: number, y: number): Promise<void> {
  const sx = mx
  const sy = my
  const steps = Math.max(12, Math.min(25, Math.round(Math.hypot(x - sx, y - sy) / 40)))
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps)
    await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k)
    await page.waitForTimeout(GLIDE_STEP_MS)
  }
  mx = x
  my = y
}

/** Wait for the window's smooth scroll to come to rest. */
async function settleScroll(): Promise<void> {
  let last = -1
  let still = 0
  for (let i = 0; i < 40 && still < 3; i++) {
    const y = await page.evaluate(() => window.scrollY)
    still = y === last ? still + 1 : 0
    last = y
    await page.waitForTimeout(100)
  }
}

/** Bring a target into the frame with a smooth scroll — clear of the sticky station footer — if it is not already. */
async function reveal(loc: Locator): Promise<void> {
  await loc.waitFor({ state: 'visible' })
  const box = await loc.boundingBox()
  if (box && box.y >= 20 && box.y + Math.min(box.height, H / 2) <= H - 120) return
  await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await settleScroll()
}

/** Off the controls while something long runs, so the pointer never rests on a button that appears under it. */
const park = () => glide(W * 0.72, H * 0.3)

async function pointAt(loc: Locator): Promise<void> {
  await reveal(loc)
  const box = await loc.boundingBox()
  if (!box) throw new Error('target has no box')
  await glide(box.x + box.width / 2, box.y + box.height / 2)
}

/** Move to a button, wait for it to be clickable, press it. */
async function press(loc: Locator, timeout = 30_000): Promise<void> {
  await loc.waitFor({ state: 'visible', timeout })
  await until('the button to be ready', timeout, async () => (await loc.isEnabled()) || false)
  await pointAt(loc)
  await pause(220)
  await loc.click()
  await pause(150)
}

/** A short text, typed where the viewer can watch it. */
async function typeVisibly(loc: Locator, text: string): Promise<void> {
  await press(loc)
  await loc.pressSequentially(text, { delay: 65 })
}

class Stopped extends Error {}

/**
 * Poll the screen until `check` says it is there (true), or it says what went
 * wrong (a sentence from the app's own notice). Never a blind sleep.
 */
async function until(what: string, timeoutMs: number, check: () => Promise<boolean | string>): Promise<void> {
  const end = Date.now() + timeoutMs
  for (;;) {
    if (failure) throw failure
    const r = await check()
    if (r === true) return
    if (typeof r === 'string') throw new Stopped(r)
    if (Date.now() > end) throw new Stopped(`waited ${Math.round(timeoutMs / 1000)} s for ${what} and it never arrived`)
    await page.waitForTimeout(POLL_MS)
  }
}

/** The first visible alert on screen, if any — the app puts every refusal in one. */
async function alertText(scope: Locator | Page = page): Promise<string | null> {
  // Read while the page may be navigating (sign-in reloads the whole page):
  // a poll that lands mid-navigation is "no alert", not a stopped capture.
  try {
    const alerts = scope.getByRole('alert')
    const n = await alerts.count()
    for (let i = 0; i < n; i++) {
      const a = alerts.nth(i)
      if (await a.isVisible()) return ((await a.textContent()) ?? '').replace(/\s+/g, ' ').replace(/Try again$|Dismiss$/, '').trim()
    }
  } catch {
    return null
  }
  return null
}

const imageLoaded = (img: Locator) =>
  img.evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0).catch(() => false)

/** Every picture inside <main> has finished loading. */
const mainPicturesLoaded = () =>
  page.evaluate(() => [...document.querySelectorAll('main img')].every((i) => (i as HTMLImageElement).complete))

// The studio's landmarks, on whichever page is being driven.
const rail = () => page.getByRole('navigation', { name: 'Stations' })
const heading = (name: string) => page.getByRole('heading', { level: 1, name, exact: true })
type StationId = 'story' | 'cast' | 'director' | 'storyboard' | 'reader'

/** Open a station from the rail (unless it is the one on screen) and wait until `ready` says it is there, scrolled to the top. */
async function goStation(id: StationId, what: string, ready: () => Promise<boolean | string>): Promise<void> {
  const button = rail().locator(`button[data-station="${id}"]`)
  if ((await button.getAttribute('aria-current')) !== 'step') await press(button)
  await until(what, 30_000, ready)
  await page.evaluate(() => window.scrollTo({ top: 0 }))
}

/** A card folds its DNA once written (v3); unfold it so the words sit beside the sheet on camera. */
async function showDna(card: Locator): Promise<void> {
  const toggle = card.getByRole('button', { name: 'Show DNA', exact: true })
  if (await toggle.isVisible()) {
    await press(toggle)
    await card.locator('.dna-text').waitFor({ state: 'visible', timeout: 10_000 })
  }
}

/** Every panel of the page on the board has inked in — or one says it failed. */
async function waitInked(board: Locator, what: string, timeoutMs: number): Promise<void> {
  const panels = board.locator('figure[data-panel]')
  await until(`${what} to ink in`, timeoutMs, async () => {
    if ((await panels.count()) !== 4) return false
    for (let i = 0; i < 4; i++) {
      const p = panels.nth(i)
      const status = await p.getAttribute('data-status')
      if (status === 'failed' || status === 'refused') return `panel ${i + 1} of ${what} didn’t come back: ${(await p.locator('figcaption').textContent())?.trim()}`
      if ((await p.getAttribute('data-inked')) !== 'true') return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// The app, read back for the stills and the spend — through the browser
// context's request, so the signed-in session's cookies travel with every
// read (a plain fetch would be a stranger and get the sign-in page). On a
// local app with INKDESK_AUTH=off there are no cookies and nothing changes.

type DeskPanel = { index: number; characterId: string; versions: { imageId: string }[]; currentVersion: number }
type Desk = {
  title: string
  panelQuality: string
  imageCount: number
  costUsd: number
  cast: { id: string; name: string; sheetImageId: string | null; source?: 'imported' }[]
  chapterPanels: DeskPanel[][]
  cover: { title: string; versions: { imageId: string }[]; currentVersion: number } | null
}

function session(): BrowserContext {
  if (!context) throw new Error('the browser is gone, so the app can’t be read back')
  return context
}

async function readDesk(projectId: string): Promise<Desk> {
  const res = await session().request.get(`${BASE}/api/projects/${encodeURIComponent(projectId)}`)
  if (!res.ok()) throw new Error(`the project couldn't be read back (${res.status()})`)
  return (await res.json()) as Desk
}

/** At most `limit` of the list, spread evenly from the first to the last, in order. */
function spread<T>(list: T[], limit: number): T[] {
  if (list.length <= limit) return list
  const picked = new Set<number>()
  for (let i = 0; i < limit; i++) picked.add(Math.round((i * (list.length - 1)) / (limit - 1)))
  return [...picked].sort((a, b) => a - b).map((i) => list[i])
}

/** Copy the money shot's pictures out of the app, by id, into public/capture/stills. */
async function copyStills(projectId: string): Promise<MoneyShotStills | null> {
  const desk = await readDesk(projectId)
  const lead = desk.cast.find((c) => c.source === 'imported') ?? desk.cast.find((c) => c.sheetImageId)
  if (!lead?.sheetImageId) return null
  rmSync(STILLS_DIR, { recursive: true, force: true })
  mkdirSync(STILLS_DIR, { recursive: true })
  const copy = async (id: string) => {
    const res = await session().request.get(`${BASE}${imageUrl(projectId, id)}`)
    if (!res.ok()) throw new Error(`the image ${id} couldn't be read back (${res.status()})`)
    writeFileSync(join(STILLS_DIR, id), await res.body())
    return `capture/stills/${id}`
  }
  // The lead's panels across the whole chapter, in page order; the money
  // shot shows a handful, spread from the first page to the last.
  const found: { id: string; page: number; panel: number }[] = []
  for (const [p, list] of desk.chapterPanels.entries()) {
    for (const panel of list) {
      const id = panel.versions[panel.currentVersion]?.imageId
      if (panel.characterId === lead.id && id) found.push({ id, page: p + 1, panel: panel.index + 1 })
    }
  }
  const panels: MoneyShotStills['panels'] = []
  for (const f of spread(found, MONEY_SHOT_PANELS)) panels.push({ src: await copy(f.id), page: f.page, panel: f.panel })
  const coverId = desk.cover?.versions[desk.cover.currentVersion]?.imageId ?? null
  return {
    title: desk.cover?.title.trim() || desk.title,
    character: { name: lead.name, reference: await copy(lead.sheetImageId), source: lead.source === 'imported' ? 'upload' : 'sheet' },
    panels,
    cover: coverId ? await copy(coverId) : null,
  }
}

/** Seconds and frames of footage, from the file itself, to check the recorder's count; nulls when ffprobe can't say. */
function probe(path: string): { seconds: number | null; frames: number | null } {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets:format=duration', '-of', 'default=nw=1', path],
    { encoding: 'utf8' }
  )
  if (r.status !== 0) return { seconds: null, frames: null }
  const num = (key: string) => {
    const v = Number.parseFloat(new RegExp(`^${key}=(.+)$`, 'm').exec(r.stdout)?.[1] ?? '')
    return Number.isFinite(v) ? v : null
  }
  const seconds = num('duration')
  return { seconds: seconds === null ? null : Math.round(seconds * 100) / 100, frames: num('nb_read_packets') }
}

// ---------------------------------------------------------------------------
// The journey

let step = 'starting'
let projectId: string | null = null

type SeedRead = ReturnType<typeof readSeed>

const DESK_HEADING = 'Your manga, one project each'

/**
 * The way in, on both journeys: the studio's front door, the sign-in card if
 * the studio is private, then the desk with the pointer in view.
 */
async function openDesk(): Promise<void> {
  step = 'opening the studio'
  await page.goto(BASE, { waitUntil: 'load' })

  if (new URL(page.url()).pathname.startsWith('/sign-in')) {
    step = 'signing in'
    if (!CREDENTIALS) throw new Stopped(NO_CREDENTIALS)
    await heading('Sign in').waitFor({ timeout: 30_000 })
    await glide(W * 0.5, H * 0.38) // the pointer appears over the card
    await mark('sign-in')
    await pause(BEAT * 1.2) // the card, readable
    await typeVisibly(page.getByLabel('Email', { exact: true }), CREDENTIALS.email)
    await pause(BEAT * 0.4)
    const password = page.getByLabel('Password', { exact: true })
    await press(password)
    await password.fill(CREDENTIALS.password) // filled, not typed: nothing to read off the screen or the file
    await pause(BEAT * 0.5)
    await press(page.getByRole('button', { name: /^(Sign in|Signing in…)$/ }))
    // A refused sign-in is the card's own sentence (never the password).
    await until('the desk after signing in', 60_000, async () => (await heading(DESK_HEADING).isVisible()) || (await alertText()) || false)
    await mark('signed-in')
  }

  step = 'opening the dashboard'
  await heading(DESK_HEADING).waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {}) // a meter may keep polling; the desk is on screen either way
  await glide(W * 0.55, H * 0.45) // the pointer appears before anything is clicked
  await mark('dashboard')
  await pause(BEAT * 1.5)
}

/** The fresh journey: a new project, generated on camera. */
async function freshJourney(seed: SeedRead): Promise<void> {
  step = 'creating the project'
  await press(page.getByRole('button', { name: 'New project', exact: true }).first())
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.waitFor()
  await pause(BEAT * 0.6)
  await typeVisibly(dialog.getByLabel('Title'), seed.title)
  await pause(BEAT * 0.6)
  await press(dialog.getByRole('radio', { name: new RegExp(`^${escape(STYLE_PRESETS[seed.preset].label)}`) }))
  await pause(BEAT * 0.6)
  await pointAt(dialog.getByText(/chapter and its cover ≈/))
  await pause(BEAT * 1.6) // the estimate, readable
  await press(dialog.getByRole('button', { name: 'Create project', exact: true }))
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 30_000 })
  projectId = new URL(page.url()).pathname.split('/').at(-1) ?? null
  await heading('What’s your story?').waitFor({ timeout: 30_000 })
  await rail().waitFor()
  await mark('project-created')
  await pause(BEAT)

  // The timeline records the quality the app really draws at (the project is
  // stamped with it), not the flag's or this shell's guess, so the edit's DRAFT
  // stamp is right either way. A --quality the app doesn't match stops here:
  // the project is free, and the Library's cast proposal is the first paid call.
  step = 'checking the app’s quality'
  if (projectId) {
    const desk = await readDesk(projectId)
    if (flags.quality !== undefined && desk.panelQuality !== flags.quality) {
      throw new Stopped(`the app is drawing panels at "${desk.panelQuality}", not the "${flags.quality}" asked for, so restart it with IMAGE_PANEL_QUALITY=${flags.quality} or drop --quality`)
    }
    timeline.quality = desk.panelQuality
    saveTimeline()
  }

  step = 'writing the scenario'
  await press(page.getByRole('radiogroup', { name: 'How to tell the story' }).getByRole('radio', { name: 'Scenario' }))
  const box = page.getByRole('textbox', { name: 'Your scenario' })
  await box.waitFor()
  await pause(BEAT * 0.6)
  if (seed.scenarioText === null) {
    await press(page.getByRole('button', { name: 'Try the sample scenario', exact: true }))
    await until('the sample scenario', 15_000, async () => (await box.inputValue()).trim().length > 0)
  } else {
    await pointAt(box)
    await box.fill(seed.scenarioText) // long text is filled, not typed
  }
  await pointAt(box)
  await pause(BEAT * 1.4)
  await press(page.getByRole('button', { name: 'Use this scenario', exact: true }))
  await page.getByText('Scenario · saved', { exact: true }).waitFor({ timeout: 30_000 })
  await page.getByText('Scenario saved — the library is open.').waitFor({ timeout: 30_000 })
  await mark('scenario-ready')
  await pause(BEAT)

  step = 'opening the Library (the cast proposal)'
  await press(page.getByRole('button', { name: /^Next: Library/ }))
  await heading('The library').waitFor({ timeout: 30_000 })
  const cards = page.locator('article.cast-card')
  await until('the proposed cast', TEXT_MS, async () => (await cards.count()) === 2 || (await alertText()) || false)
  await mark('library-open')
  await pause(BEAT * 1.4)

  step = 'uploading the character picture'
  const shelf = page.getByRole('region', { name: 'Reference shelf' })
  await pointAt(shelf.getByText(/^Only upload pictures you made/))
  await pause(BEAT * 1.4) // the rights notice, readable
  const tiles = shelf.locator('figure.asset-tile')
  const before = await tiles.count()
  const chooser = page.waitForEvent('filechooser')
  // Awaited after the press; if the press fails first, closing the page
  // rejects this wait, and unhandled that would kill us before the save.
  chooser.catch(() => {})
  await press(shelf.getByRole('button', { name: 'Upload a reference', exact: true }))
  await (await chooser).setFiles({ name: seed.uploadName!, mimeType: seed.pictureType, buffer: seed.picture })
  await until('the picture on the shelf', 60_000, async () => {
    if ((await tiles.count()) > before && (await imageLoaded(tiles.last().locator('img')))) return true
    return (await alertText(shelf)) || false
  })
  await pause(BEAT)

  step = 'importing the picture as the lead’s sheet'
  const lead = cards.nth(0)
  const leadName = await lead.getByLabel('Name', { exact: true }).inputValue()
  await pointAt(lead.getByLabel(`Reference for ${leadName}`))
  await pause(BEAT * 0.6)
  await press(lead.getByRole('button', { name: 'Use as sheet', exact: true }))
  await until(`${leadName}’s DNA from the picture`, TEXT_MS, () => cardReady(lead, leadName))
  await mark('import-done')
  await showDna(lead)
  await pointAt(lead.locator('.dna-text'))
  await pause(BEAT * 2.2) // the DNA written from the picture, readable

  step = `locking ${leadName}`
  await press(lead.getByRole('group', { name: `Actions for ${leadName}` }).getByRole('button', { name: 'Lock', exact: true }))
  await lead.getByText('Locked', { exact: true }).first().waitFor({ timeout: 30_000 })
  await pause(BEAT)

  const second = cards.nth(1)
  const secondName = await second.getByLabel('Name', { exact: true }).inputValue()
  step = `drawing ${secondName}’s sheet`
  await press(second.getByRole('group', { name: `Actions for ${secondName}` }).getByRole('button', { name: 'Draw sheet', exact: true }))
  await park()
  await until(`${secondName}’s sheet`, TEXT_MS + IMAGE_MS, () => cardReady(second, secondName))
  await pointAt(second.getByRole('img', { name: `${secondName}’s model sheet` }))
  await pause(BEAT * 1.6)

  step = `locking ${secondName}`
  await press(second.getByRole('group', { name: `Actions for ${secondName}` }).getByRole('button', { name: 'Lock', exact: true }))
  await second.getByText('Locked', { exact: true }).first().waitFor({ timeout: 30_000 })
  await page.getByText('Both sheets are locked — the Director is open.').waitFor({ timeout: 30_000 })
  await mark('cast-locked')
  await pause(BEAT)

  step = 'opening the Director'
  await press(page.getByRole('button', { name: /^Next: Director/ }))
  await heading('The Director').waitFor({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await mark('director-open')
  await pause(BEAT)

  step = 'writing the chapter plan'
  await pointAt(page.locator('.plan-bar .estimate'))
  await pause(BEAT * 1.4)
  await press(page.getByRole('button', { name: 'Write the chapter plan', exact: true }))
  await park()
  const generateAll = page.getByRole('button', { name: /^(Generate all|Starting…)$/ })
  const page1Card = page.locator('[data-plan-page="0"]')
  await until('the chapter plan', TEXT_MS, async () =>
    ((await generateAll.isVisible()) && (await page1Card.isVisible())) || (await alertText()) || false
  )
  await settleScroll()
  await mark('plan-ready')
  await pointAt(page.locator('.plan-bar .estimate'))
  await pause(BEAT * 2) // the plan's estimate, readable
  await pointAt(page1Card.getByRole('region').first())
  await pause(BEAT * 1.4)

  step = SHORT ? 'starting page 1' : 'starting the chapter and the cover'
  if (SHORT) {
    await press(page1Card.getByRole('button', { name: 'Generate page 1', exact: true }))
    await mark('pages-queued')
  } else {
    await press(generateAll)
    await mark('pages-queued')
    await until('every page written', TEXT_MS, async () => (await alertText()) || (await generateAll.textContent()) !== 'Starting…')
    const coverButton = page.getByRole('article', { name: 'The cover' }).getByRole('button', { name: 'Generate cover', exact: true })
    await press(coverButton)
    await pause(BEAT)
    await press(page1Card.getByRole('button', { name: 'Open page 1 →' }))
  }
  // A refused start (or cover) is only a notice on the Director: watch for it too.
  await until('the page to open', 60_000, async () => (await heading('The page').isVisible()) || (await alertText()) || false)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await settleScroll()

  step = 'inking page 1'
  const board = page.getByRole('region', { name: 'The page', exact: true })
  await park() // off the art while it inks
  await waitInked(board, 'page 1', IMAGE_MS * 4 + 60_000)
  await mark('page1-inked')
  await pause(BEAT * 2)

  await editBubble(seed)

  step = `redrawing panel ${seed.redrawPanel}`
  const target = board.locator(`figure[data-panel="${seed.redrawPanel - 1}"]`)
  const art = target.locator('img.panel-art')
  const oldSrc = await art.getAttribute('src')
  await press(target.getByRole('button', { name: 'Redraw panel', exact: true }))
  await park()
  await until(`panel ${seed.redrawPanel} to ink in again`, IMAGE_MS + 120_000, async () => {
    const status = await target.getAttribute('data-status')
    if (status === 'failed' || status === 'refused') return `the redraw of panel ${seed.redrawPanel} didn’t come back`
    const src = await art.getAttribute('src').catch(() => null)
    return status === 'done' && src !== null && src !== oldSrc && (await target.getAttribute('data-inked')) === 'true'
  })
  await mark('redraw-done')
  await pointAt(target.getByRole('group', { name: `Panel ${seed.redrawPanel} versions` }))
  await pause(BEAT * 1.6)

  if (!SHORT) {
    step = 'inking the rest of the chapter and the cover'
    await press(rail().locator('button[data-station="director"]'))
    await heading('The Director').waitFor({ timeout: 30_000 })
    await glide(W * 0.5, H * 0.2)
    const statuses = page.locator('[data-plan-page] .plan-page-status')
    const coverFrame = page.getByRole('article', { name: 'The cover' }).locator('.cover-frame')
    const pageCount = await page.locator('[data-plan-page]').count()
    await until('every page and the cover', IMAGE_MS * (pageCount * 2 + 2), async () => {
      // A refused or failed request (the cover's POST, say) is only a notice;
      // the statuses below would never change and this would wait it out.
      const notice = await alertText()
      if (notice) return notice
      const labels = await statuses.allTextContents()
      const failed = labels.find((l) => l.includes('didn’t come back'))
      if (failed) return `a page reports “${failed}”`
      const coverFailed = await page.getByText(/The cover (didn’t come back|couldn’t be drawn)/).first().isVisible()
      if (coverFailed) return 'the cover didn’t come back'
      const allDone = labels.length === pageCount && labels.every((l) => l.startsWith('Complete'))
      return allDone && /\bis-inked\b/.test((await coverFrame.getAttribute('class')) ?? '')
    })
    await mark('chapter-inked')
    await pointAt(coverFrame)
    await pause(BEAT * 1.6)
  }

  await publish()
}

/** The board shows page `n` (the station remounts per page; the switcher's highlight moves first). */
async function onBoard(n: number): Promise<void> {
  await until(`page ${n} on the board`, 30_000, async () => {
    const words = (await page.locator('.page-progress').first().textContent().catch(() => '')) ?? ''
    return new RegExp(`^\\s*Page ${n}\\b`).test(words)
  })
}

/**
 * The seeded journey: a finished chapter, walked station by station with
 * pauses and pointer glides so each is readable. Nothing is generated; the
 * one edit is the bubble, which is app lettering.
 */
async function seededJourney(seed: SeedRead, id: string): Promise<void> {
  step = 'opening the project'
  // Its card on the desk when it is there (the desk → the project, on camera); the address otherwise.
  const card = page.locator(`a.project-link[href="/p/${id}"]`)
  if (await card.isVisible()) await press(card)
  else await page.goto(`${BASE}/p/${encodeURIComponent(id)}`, { waitUntil: 'load' })
  await until('the project to open', 30_000, async () => {
    if ((await rail().isVisible()) && (await page.locator('h1.station-title').first().isVisible())) return true
    // A desk notice instead of the studio (not this account's, unreadable, signed out): its own sentence, not a timeout.
    const notice = page.locator('h1').first()
    if (!(await notice.isVisible())) return false
    const words = ((await notice.textContent({ timeout: 2000 }).catch(() => '')) ?? '').trim()
    return /no such page|can’t be opened|can’t be reached|not found|can’t be found|Sign in to use|One moment|Slow down|isn’t here/i.test(words)
      ? `the project ${id} didn’t open: “${words}” — is the id right, and is it this account’s?`
      : false
  })
  projectId = id
  try {
    timeline.quality = (await readDesk(id)).panelQuality // the app's own setting, for the record; nothing is drawn on this path
    saveTimeline()
  } catch {
    // The desk read is a convenience here; the walk goes on without it.
  }
  await mark('project-open')
  await pause(BEAT * 0.8)

  step = 'reading the scenario'
  const storyTitle = page.locator('h1.station-title')
  await goStation('story', 'the Story station', async () => /^(The scenario|Tell a different story\?|What’s your story\?)$/.test(((await storyTitle.first().textContent()) ?? '').trim()))
  const scenario = page.getByLabel('The saved scenario', { exact: true })
  if (await scenario.isVisible()) {
    await pointAt(scenario)
    await pause(BEAT * 2.6) // the scenario, readable
  } else {
    await pointAt(page.locator('.synopsis-card').first())
    await pause(BEAT * 2.2)
  }
  await mark('scenario-shown')
  await pause(BEAT * 0.4)

  step = 'showing the locked cast'
  await goStation('cast', 'the Library station', () => heading('The library').isVisible())
  const cards = page.locator('article.cast-card')
  await until('the locked cards', 30_000, async () => (await cards.count()) === 2 && (await mainPicturesLoaded()))
  const lead = cards.nth(0)
  const nameEl = lead.locator('.cast-name').first()
  const leadName = (((await nameEl.textContent()) ?? '').trim() || (await nameEl.inputValue().catch(() => ''))).trim()
  await pointAt(lead.getByRole('img', { name: `${leadName}’s model sheet` }))
  await pause(BEAT * 1.4)
  await showDna(lead)
  await pointAt(lead.locator('.dna-text')) // scrolls the DNA into view beside the sheet
  await pause(BEAT * 2.6) // the words every panel carries, readable
  const second = cards.nth(1)
  await pointAt(second.getByText('Locked', { exact: true }).first())
  await pause(BEAT * 1.4)
  await mark('library-shown')
  await pause(BEAT * 0.4)

  step = 'showing the Director’s plan'
  await goStation('director', 'the Director station', () => heading('The Director').isVisible())
  await pointAt(page.locator('.plan-bar .estimate'))
  await pause(BEAT * 1.8) // the estimate, readable
  const page1Card = page.locator('[data-plan-page="0"]')
  await pointAt(page1Card.getByRole('region').first())
  await pause(BEAT * 1.6)
  await mark('director-shown')
  await pause(BEAT * 0.4)

  step = 'opening page 1'
  await press(page1Card.getByRole('button', { name: 'Open page 1 →' }))
  await until('the page to open', 60_000, async () => (await heading('The page').isVisible()) || (await alertText()) || false)
  await onBoard(1)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await settleScroll()
  const board = page.getByRole('region', { name: 'The page', exact: true })
  await park() // off the art while it loads
  await waitInked(board, 'page 1', 90_000)
  await pause(BEAT * 1.2)
  await mark('pages-shown')
  await pause(BEAT * 1.4)

  await editBubble(seed)

  // The other pages: finished, so each is shown as it loads (nothing inks in
  // on this path — a finished panel appears whole; the ink-in is the fresh
  // journey's, or the reader's replay).
  const tabs = page.getByRole('navigation', { name: 'Pages of the chapter' }).getByRole('button')
  const pageCount = await tabs.count()
  for (let i = 1; i < pageCount; i++) {
    step = `showing page ${i + 1}`
    const tab = tabs.nth(i)
    await press(tab)
    await until(`page ${i + 1} to open`, 30_000, async () => (await tab.getAttribute('aria-current')) === 'page')
    await onBoard(i + 1) // the station remounts for the new page; its art is not the old page's
    await park()
    await waitInked(board, `page ${i + 1}`, 90_000)
    await pause(BEAT * 1.8)
  }
  await mark('chapter-shown')
  await pause(BEAT * 0.6)

  await publish()
}

/** Page 1, panel 1's bubble retyped with the seed's words — app lettering, free, on both journeys. */
async function editBubble(seed: SeedRead): Promise<void> {
  step = 'editing a speech bubble'
  const bubble = page.getByRole('textbox', { name: 'Panel 1 dialogue — click to edit' })
  await press(bubble)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(seed.bubble, { delay: 70 })
  await pause(BEAT * 0.5)
  await press(page.getByRole('heading', { level: 1, name: 'The page' })) // clicking away saves the words
  await until('the new words saved', 30_000, async () => {
    const saved = (await page.getByText('Saved to desk', { exact: true }).isVisible()) || false
    const words = (await bubble.textContent())?.trim() === seed.bubble.trim()
    return (saved && words) || (await alertText()) || false
  })
  await mark('bubble-edited')
  await pointAt(bubble)
  await pause(BEAT * 1.4)
}

/** The reader, the PDF, the public link — and the public page, as a stranger sees it. Both journeys end here. */
async function publish(): Promise<void> {
  step = 'opening Ink & Publish'
  await press(rail().locator('button[data-station="reader"]'))
  // One button, two labels: "Binding the PDF…" while it works.
  const exportPdf = page.getByRole('button', { name: /^(Export PDF|Binding the PDF…)$/ })
  await exportPdf.waitFor({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await until('the reader’s pictures', 60_000, mainPicturesLoaded)
  await mark('reader-open')
  await glide(W * 0.5, H * 0.55)
  await pause(BEAT * 2.4)

  step = 'exporting the PDF'
  const download = page.waitForEvent('download', { timeout: 180_000 })
  // Handled at once, as the file chooser's wait is; and a refused export is a
  // notice rather than a download, so the two are watched together.
  let downloaded = false
  download.then(() => (downloaded = true), () => {})
  await press(exportPdf)
  await until('the PDF', 180_000, async () => downloaded || (await alertText()) || false)
  await (await download).saveAs(PDF_FILE)
  await until('the export to finish', 60_000, async () =>
    (await exportPdf.textContent()) === 'Export PDF' || (await alertText()) || false
  )
  await mark('pdf-exported')
  await pause(BEAT * 2)

  step = 'sharing the chapter'
  await press(page.getByRole('button', { name: 'Share publicly…', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'Share publicly' })
  await dialog.waitFor({ timeout: 30_000 })
  const link = dialog.locator('input.share-link')
  const share = dialog.getByRole('button', { name: /^(Share publicly|Making the link…)$/ })
  await until('the share dialog', 30_000, async () => (await link.isVisible()) || (await share.isVisible()) || (await alertText(dialog)) || false)
  // A chapter shared before (a seeded copy may be) opens on its link; a new one is made on camera.
  if (!(await link.isVisible())) {
    await pause(BEAT * 1.4) // what a link holds, readable
    await press(share)
    await until('the public link', 60_000, async () => (await link.isVisible()) || (await alertText(dialog)) || false)
  }
  await mark('share-link')
  const shareUrl = await link.inputValue()
  // The pointer goes to the buttons, not the field: the address is the
  // studio's host name, and the film names no host. Short, then on to the page.
  await press(dialog.getByRole('button', { name: /^(Copy link|Copied)$/ }))
  await pause(BEAT * 0.8) // "Copied"
  await press(dialog.getByRole('button', { name: 'Done', exact: true }))
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
  // The link's path is the share; the page is opened on the address this
  // capture films (the same studio — APP_URL and --url may be written
  // differently), and recorded in the timeline, nowhere else.
  const sharePath = new URL(shareUrl).pathname
  timeline.share = sharePath
  saveTimeline()
  await pause(BEAT * 0.6)

  // The public page, opened the way a stranger with the link opens it: a
  // second browser context with no cookies — not this signed-in session, and
  // not this window signed out, which would end the session that still has to
  // read the stills back. The recorder follows the new window from here
  // (screencast.mts `follow`); the owner's last frame holds until the
  // visitor's first one arrives, on the same clock.
  step = 'opening the public link, signed out'
  const browser = session().browser()
  if (!browser) throw new Error('the browser is gone')
  visitor = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await visitor.addInitScript(CURSOR_SCRIPT)
  const publicPage = await visitor.newPage()
  // The navigation starts before the recorder follows, so the visitor's first
  // frames are the page painting rather than an empty window.
  const opening = publicPage.goto(new URL(sharePath, BASE).href, { waitUntil: 'commit' })
  opening.catch(() => {})
  await recording!.follow(visitor, publicPage)
  page = publicPage
  mx = W / 2
  my = H / 2
  await opening
  await page.waitForLoadState('load', { timeout: 60_000 })
  await page.locator('h1.share-title').waitFor({ timeout: 30_000 })
  await page.getByText('Shared on Ink Desk', { exact: true }).waitFor({ timeout: 30_000 })
  await until('the public page’s pictures', 60_000, mainPicturesLoaded)
  await glide(W * 0.5, H * 0.52) // the pointer appears: a reader, not a screenshot
  await mark('share-opened')
  await pause(BEAT * 2.5)
  await mark('end')
  await pause(BEAT)
}

/** A card has its sheet and its DNA, and nothing is running on it — or its notice says why not. */
async function cardReady(card: Locator, name: string): Promise<boolean | string> {
  const notice = await alertText(card)
  if (notice) return `${name}’s card says: ${notice}`
  if ((await card.getAttribute('aria-busy')) === 'true') return false
  const sheet = card.getByRole('img', { name: `${name}’s model sheet` })
  return (await sheet.isVisible()) && (await imageLoaded(sheet)) && (await card.locator('.dna-text, .dna-toggle').first().isVisible())
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const seed = readSeed()

  // Refuse plainly when there is no app to film. Any answer is an answer — a
  // private studio's 307 to /sign-in included; that one also says, before a
  // browser is started, whether the sign-in can be made at all.
  let answered: Response
  const slow = setTimeout(() => console.log(`Waiting for ${BASE} to answer (a hosted studio may be waking up)…`), 5_000)
  try {
    answered = await fetch(BASE, { redirect: 'manual', signal: AbortSignal.timeout(45_000) })
  } catch {
    quit(`Ink Desk isn't answering at ${BASE}. Start it first (npm run dev), or pass --url.`)
  } finally {
    clearTimeout(slow)
  }
  const sentTo = answered.headers.get('location') ?? ''
  if (answered.status >= 300 && answered.status < 400 && /\/sign-in/.test(sentTo) && !CREDENTIALS) {
    quit(`Ink Desk at ${BASE} ${NO_CREDENTIALS}.`)
  }

  // Nothing of the previous capture is touched until this run has succeeded.
  mkdirSync(RUN_DIR, { recursive: true })

  const what = PROJECT
    ? `the finished chapter ${PROJECT}, station by station (nothing generated)`
    : SHORT
      ? 'a fresh project, short (page 1 only, no cover)'
      : 'a fresh project, the full chapter and its cover'
  const quality = PROJECT ? '' : flags.quality ? `, expecting "${flags.quality}" quality` : ', at the app’s own quality'
  console.log(`Recording ${BASE} — ${what}${quality}${STOP_AFTER ? `, stopping after ${STOP_AFTER}` : ''}.`)
  if (PROJECT && (flags.quality !== undefined || flags.short)) {
    console.log('  (--quality and --short mean nothing on a finished chapter: nothing is drawn, so they are ignored.)')
  }
  if (CREDENTIALS) console.log('  Signing in with INKDESK_CAPTURE_EMAIL if the studio asks.')
  if (OUT) console.log(`Writing to ${shown(OUT)}, not the real capture.`)

  let browser: Browser | null = null
  let stoppedAfter = false
  // Ctrl+C: closing the contexts (or, before there is one, the browser) makes
  // the pending step fail, and the footage so far is finished and set aside
  // like any other stop; the journey also checks `failure` at every wait, so
  // a press during start-up still stops it. A second Ctrl+C leaves at once
  // (ffmpeg, in its own process group, still closes the file when its input
  // ends). Playwright's own SIGINT handling is off so it can't take the
  // browser away mid-step.
  let interrupted = 0
  process.on('SIGINT', () => {
    // npm and tsx relay the terminal's Ctrl+C to us as well, so one press can
    // arrive twice within a moment; only a later one is the second press.
    if (interrupted) {
      if (Date.now() - interrupted > 700) {
        console.error(`Left at once; what was filmed stays in ${shown(RUN_DIR)}, and the previous capture is untouched.`)
        process.exit(130)
      }
      return
    }
    interrupted = Date.now()
    failure = new Stopped('the capture was interrupted')
    console.error('\nInterrupted — saving the footage so far (Ctrl+C again to leave without it).')
    void visitor?.close().catch(() => {})
    void (context ?? browser)?.close().catch(() => {})
  })

  try {
    browser = await chromium.launch({ handleSIGINT: false })
    if (failure) throw failure
    context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true })
    if (failure) throw failure
    context.setDefaultTimeout(60_000)
    // The Share dialog's Copy link uses the clipboard; granted, so the film shows "Copied" rather than the by-hand fallback.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin }).catch(() => {})
    await context.addInitScript(CURSOR_SCRIPT)
    page = await context.newPage()
    // The recording starts with the page; a capture that can no longer be
    // filmed stops at once rather than spend on generations nobody will see.
    recording = await startRecording(context, page, FOOTAGE_FILE, {
      fps: FPS,
      width: W,
      height: H,
      onFailure: (why) => {
        failure ??= new Stopped(why)
        void visitor?.close().catch(() => {})
        void context?.close().catch(() => {})
      },
    })
    if (failure) throw failure
    timeline.recordedAt = new Date().toISOString()
    saveTimeline()
    await openDesk()
    if (PROJECT) await seededJourney(seed, PROJECT)
    else await freshJourney(seed)
  } catch (err) {
    if (err instanceof StoppedAfter) stoppedAfter = true
    else {
      failure ??= err
      if (page) await page.screenshot({ path: FAILURE_PNG }).catch(() => {})
    }
  }

  // The footage, whatever happened: finished before the browser goes.
  if (recording) {
    if (!failure && !stoppedAfter) step = 'finishing the footage' // a stop keeps naming the step it happened in
    const rec = await recording.stop()
    if (rec.failure) {
      failure ??= new Stopped(rec.failure)
      console.error(`The recorder failed: ${rec.failure}.`)
    }
    const probed = probe(FOOTAGE_FILE)
    if (probed.seconds !== null) {
      timeline.footage = FOOTAGE
      timeline.duration = probed.seconds
      saveTimeline() // at once: the footage is the part worth keeping, whatever happens next
      console.log(`Footage: ${probed.seconds.toFixed(1)} s · ${rec.received} screen frames into ${rec.frames} at ${FPS} fps`)
      if (probed.frames !== null && probed.frames !== rec.frames) {
        console.warn(`  ! The file holds ${probed.frames} frames but ${rec.frames} were written; check the marks against the footage before cutting.`)
      }
    } else {
      console.error(`The footage couldn't be read back from ${shown(FOOTAGE_FILE)}, so the timeline names none.`)
    }
  }

  // The stills and the spend, read with the signed-in session while the
  // browser is still here (an interrupted run has closed it; that is reported).
  if (projectId) {
    try {
      timeline.stills = await copyStills(projectId)
      if (timeline.stills) {
        console.log(`Stills: ${1 + timeline.stills.panels.length + (timeline.stills.cover ? 1 : 0)} pictures`)
      }
      const desk = await readDesk(projectId)
      console.log(`Spend on this project, as the providers reported it: ${desk.imageCount} images · $${desk.costUsd.toFixed(4)}`)
    } catch (err) {
      console.error(`The stills couldn't be copied: ${(err as Error).message}`)
    }
  }
  await visitor?.close().catch(() => {})
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})

  // A run with no footage to show can't stand in for the capture, however far it got.
  if (!failure && !timeline.footage) failure = new Stopped('the footage couldn’t be read back, so this run can’t replace the capture')
  saveTimeline()

  if (failure) {
    const why = failure instanceof Stopped ? failure.message : ((failure as Error).message ?? String(failure)).split('\n')[0]
    console.error(`\nThe capture stopped while ${step}: ${why}.`)
    const untouched = `the previous capture and ${shown(TIMELINE)} are untouched`
    if (!timeline.footage && timeline.marks.length === 0 && !existsSync(FAILURE_PNG)) {
      rmSync(RUN_DIR, { recursive: true, force: true }) // nothing was filmed, so there is nothing to keep
      console.error(`Nothing was filmed; ${untouched}.\n`)
      process.exit(1)
    }
    let kept = FAILED_DIR
    try {
      renameSync(RUN_DIR, FAILED_DIR)
    } catch {
      kept = RUN_DIR
    }
    const what = timeline.footage ? 'The footage so far and the marks reached are' : 'The marks reached are'
    const png = existsSync(join(kept, 'failure.png')) ? ', with failure.png as the last screen' : ''
    console.error(`${what} kept in ${shown(kept)} (its own timeline.json${png}); ${untouched}.\n`)
    process.exit(1)
  }

  // Success: this run becomes the capture, as one set — what it didn't make
  // (no stills or PDF after an early --stop-after) is not left over from the last.
  for (const name of CAPTURED) {
    rmSync(join(CAPTURE_DIR, name), { recursive: true, force: true })
    if (existsSync(join(RUN_DIR, name))) renameSync(join(RUN_DIR, name), join(CAPTURE_DIR, name))
  }
  saveTimeline(TIMELINE)
  rmSync(RUN_DIR, { recursive: true, force: true })
  console.log(`Capture: ${shown(CAPTURE_DIR)} · Timeline: ${shown(TIMELINE)} · ${timeline.marks.length} marks${timeline.share ? ' · the public page was opened signed out' : ''}`)

  if (stoppedAfter) console.log(`\nThe capture stopped after ${STOP_AFTER}, as asked, and replaced the previous one.`)
  else console.log('\nThe capture is complete and replaced the previous one. Next: npm run video:docs (once), then npm run video:render')
}

await main()
