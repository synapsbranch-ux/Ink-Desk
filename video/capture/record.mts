// The capture: Playwright drives the REAL running app through the v2 journey
// on a fresh project and records it — spec.md > The Demo Video Pipeline (v2).
// Every generation is real; the waits are long because the art is, and the
// edit time-lapses them (src/timeline.ts), it never fakes them.
//
//   cd video && npx tsx capture/record.mts [--url http://localhost:3000]
//                                          [--short] [--seed capture/seed.json]
//                                          [--quality high] [--out <dir>]
//                                          [--stop-after <mark>]
//   npm run video:capture -- --short       (from the repo root)
//
// Writes, as it goes:
//   video/timeline.json                 marks (MARKS in src/timeline.ts, in order,
//                                       each when its moment is on screen; t =
//                                       seconds into the footage, which is wall
//                                       time since its first frame — see
//                                       screencast.mts)
//   video/public/capture/footage.mp4    the recording, 1920×1080 h264 at 30 fps
//   video/public/capture/stills/        the money shot: the imported picture, the
//                                       lead's current panels, the cover if drawn
//   video/public/capture/chapter.pdf    the exported PDF (proof the export ran)
//
// --short generates page 1 only and no cover (the slice's ≈ $0.10 test
// capture); it still edits a bubble, redraws a panel, opens the reader and
// exports the PDF, and it has no `chapter-inked` mark.
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
// On any failure the footage so far is still saved and the timeline keeps the
// marks reached; the script then exits non-zero naming the step that stopped.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
// The app's own preset table: no imports, no environment — safe to read here,
// and it means the recorder clicks the label the dialog really shows.
import { STYLE_PRESETS, type StylePresetId } from '../../lib/styles.ts'
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

// ---------------------------------------------------------------------------
// Flags and seed

const INVOKED_FROM = process.env.INIT_CWD ?? process.cwd() // npm --prefix runs us from video/

function readFlags() {
  try {
    return parseArgs({
      options: {
        url: { type: 'string', default: 'http://localhost:3000' },
        short: { type: 'boolean', default: false },
        seed: { type: 'string' },
        quality: { type: 'string' },
        out: { type: 'string' },
        'stop-after': { type: 'string' },
      },
      strict: true,
    }).values
  } catch {
    console.error('\nThe capture takes --url <address>, --short, --seed <file>, --quality <name>, --out <dir> and --stop-after <mark>; nothing else.\n')
    process.exit(1)
  }
}
const flags = readFlags()

const BASE = flags.url!.replace(/\/+$/, '')
const SHORT = flags.short === true
const QUALITY = flags.quality ?? process.env.IMAGE_PANEL_QUALITY ?? 'unknown'
const SEED_PATH = flags.seed ? resolve(INVOKED_FROM, flags.seed) : join(VIDEO, 'capture', 'seed.json')

// Where everything is written: the real places, or one scratch folder.
const OUT = flags.out ? resolve(INVOKED_FROM, flags.out) : null
const CAPTURE_DIR = OUT ?? join(VIDEO, 'public', 'capture')
const TIMELINE = OUT ? join(OUT, 'timeline.json') : join(VIDEO, 'timeline.json')
const FOOTAGE_FILE = join(CAPTURE_DIR, 'footage.mp4')
const STILLS_DIR = join(CAPTURE_DIR, 'stills')
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
  /** The words typed into page 1, panel 1's bubble. */
  bubble: string
  /** Which panel of page 1 is redrawn, 1–4. */
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
// The timeline, written after every mark so a capture that stops still has
// the marks it reached.

const timeline: CaptureTimeline = {
  version: 1,
  recordedAt: null,
  quality: QUALITY,
  footage: null,
  duration: null,
  marks: [],
  stills: null,
}
const saveTimeline = () => writeFileSync(TIMELINE, `${JSON.stringify(timeline, null, 2)}\n`)

let recording: Recording | null = null

const ORDER = MARKS.map((m) => m.name as string)
/** Ends the journey after --stop-after's mark; not a failure. */
class StoppedAfter extends Error {}

/** The moment on screen now, in footage seconds — the recorder's own clock, so it is where the file shows it. */
async function mark(name: MarkName): Promise<void> {
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

let page: Page
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
    const r = await check()
    if (r === true) return
    if (typeof r === 'string') throw new Stopped(r)
    if (Date.now() > end) throw new Stopped(`waited ${Math.round(timeoutMs / 1000)} s for ${what} and it never arrived`)
    await page.waitForTimeout(POLL_MS)
  }
}

/** The first visible alert on screen, if any — the app puts every refusal in one. */
async function alertText(scope: Locator | Page = page): Promise<string | null> {
  const alerts = scope.getByRole('alert')
  const n = await alerts.count()
  for (let i = 0; i < n; i++) {
    const a = alerts.nth(i)
    if (await a.isVisible()) return ((await a.textContent()) ?? '').replace(/\s+/g, ' ').replace(/Try again$|Dismiss$/, '').trim()
  }
  return null
}

const imageLoaded = (img: Locator) =>
  img.evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0).catch(() => false)

// ---------------------------------------------------------------------------
// The app, read back for the stills and the spend.

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

async function readDesk(projectId: string): Promise<Desk> {
  const res = await fetch(`${BASE}/api/projects/${projectId}`)
  if (!res.ok) throw new Error(`the project couldn't be read back (${res.status})`)
  return (await res.json()) as Desk
}

/** Copy the money shot's pictures out of the app, by id, into public/capture/stills. */
async function copyStills(projectId: string): Promise<MoneyShotStills | null> {
  const desk = await readDesk(projectId)
  const lead = desk.cast.find((c) => c.source === 'imported') ?? desk.cast.find((c) => c.sheetImageId)
  if (!lead?.sheetImageId) return null
  rmSync(STILLS_DIR, { recursive: true, force: true })
  mkdirSync(STILLS_DIR, { recursive: true })
  const copy = async (id: string) => {
    const res = await fetch(`${BASE}/api/image/${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error(`the image ${id} couldn't be read back (${res.status})`)
    writeFileSync(join(STILLS_DIR, id), Buffer.from(await res.arrayBuffer()))
    return `capture/stills/${id}`
  }
  const panels: MoneyShotStills['panels'] = []
  for (const [p, list] of desk.chapterPanels.entries()) {
    for (const panel of list) {
      const id = panel.versions[panel.currentVersion]?.imageId
      if (panel.characterId === lead.id && id) panels.push({ src: await copy(id), page: p + 1, panel: panel.index + 1 })
    }
  }
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

async function journey(seed: ReturnType<typeof readSeed>): Promise<void> {
  // Rail buttons are found by station id: a locked station's name carries its gate hint, which names other buttons.
  const rail = page.getByRole('navigation', { name: 'Stations' })
  const heading = (name: string) => page.getByRole('heading', { level: 1, name, exact: true })

  step = 'opening the dashboard'
  await page.goto(BASE, { waitUntil: 'load' })
  await heading('Your manga, one project each').waitFor()
  await page.waitForLoadState('networkidle').catch(() => {})
  await glide(W * 0.55, H * 0.45) // the pointer appears before anything is clicked
  await mark('dashboard')
  await pause(BEAT * 1.5)

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
  await rail.waitFor()
  await mark('project-created')
  await pause(BEAT)

  const desk = projectId ? await readDesk(projectId) : null
  if (desk && QUALITY !== 'unknown' && desk.panelQuality !== QUALITY) {
    console.warn(`  ! The app is drawing panels at "${desk.panelQuality}", but this capture is recorded as "${QUALITY}".`)
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
  await heading('The page').waitFor({ timeout: 60_000 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await settleScroll()

  step = 'inking page 1'
  const board = page.getByRole('region', { name: 'The page', exact: true })
  const panels = board.locator('figure[data-panel]')
  await park() // off the art while it inks
  await until('page 1 to ink in', IMAGE_MS * 4 + 60_000, async () => {
    if ((await panels.count()) !== 4) return false
    for (let i = 0; i < 4; i++) {
      const p = panels.nth(i)
      const status = await p.getAttribute('data-status')
      if (status === 'failed' || status === 'refused') return `panel ${i + 1} of page 1 didn’t come back: ${(await p.locator('figcaption').textContent())?.trim()}`
      if ((await p.getAttribute('data-inked')) !== 'true') return false
    }
    return true
  })
  await mark('page1-inked')
  await pause(BEAT * 2)

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
    await press(rail.locator('button[data-station="director"]'))
    await heading('The Director').waitFor({ timeout: 30_000 })
    await glide(W * 0.5, H * 0.2)
    const statuses = page.locator('[data-plan-page] .plan-page-status')
    const coverFrame = page.getByRole('article', { name: 'The cover' }).locator('.cover-frame')
    const pageCount = await page.locator('[data-plan-page]').count()
    await until('every page and the cover', IMAGE_MS * (pageCount * 2 + 2), async () => {
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

  step = 'opening Ink & Publish'
  await press(rail.locator('button[data-station="reader"]'))
  // One button, two labels: "Binding the PDF…" while it works.
  const exportPdf = page.getByRole('button', { name: /^(Export PDF|Binding the PDF…)$/ })
  await exportPdf.waitFor({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await until('the reader’s pictures', 60_000, () =>
    page.evaluate(() => [...document.querySelectorAll('main img')].every((i) => (i as HTMLImageElement).complete))
  )
  await mark('reader-open')
  await glide(W * 0.5, H * 0.55)
  await pause(BEAT * 2.4)

  step = 'exporting the PDF'
  const download = page.waitForEvent('download', { timeout: 180_000 })
  await press(exportPdf)
  await (await download).saveAs(join(CAPTURE_DIR, 'chapter.pdf'))
  await until('the export to finish', 60_000, async () =>
    (await exportPdf.textContent()) === 'Export PDF' || (await alertText()) || false
  )
  await mark('pdf-exported')
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
  return (await sheet.isVisible()) && (await imageLoaded(sheet)) && (await card.locator('.dna-text').isVisible())
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const seed = readSeed()

  // Refuse plainly when there is no app to film.
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(10_000) })
  } catch {
    quit(`Ink Desk isn't answering at ${BASE}. Start it first (npm run dev), or pass --url.`)
  }

  mkdirSync(CAPTURE_DIR, { recursive: true })
  rmSync(FOOTAGE_FILE, { force: true })
  rmSync(join(CAPTURE_DIR, 'failure.png'), { force: true })

  console.log(`Recording ${BASE} — ${SHORT ? 'short (page 1 only, no cover)' : 'the full chapter and its cover'}, quality recorded as "${QUALITY}"${STOP_AFTER ? `, stopping after ${STOP_AFTER}` : ''}.`)
  if (OUT) console.log(`Writing to ${shown(OUT)}, not the real capture.`)

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let failure: unknown = null
  let stoppedAfter = false
  // Ctrl+C: closing the context makes the pending step fail, and the footage
  // so far is finished and saved like any other stop. A second Ctrl+C leaves
  // at once (ffmpeg, in its own process group, still closes the file when its
  // input ends). Playwright's own SIGINT handling is off so it can't take the
  // browser away mid-step.
  let interrupted = 0
  process.on('SIGINT', () => {
    // npm and tsx relay the terminal's Ctrl+C to us as well, so one press can
    // arrive twice within a moment; only a later one is the second press.
    if (interrupted) {
      if (Date.now() - interrupted > 700) process.exit(130)
      return
    }
    interrupted = Date.now()
    failure = new Stopped('the capture was interrupted')
    console.error('\nInterrupted — saving the footage so far (Ctrl+C again to leave without it).')
    void context?.close().catch(() => {})
  })

  try {
    browser = await chromium.launch({ handleSIGINT: false })
    context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true })
    context.setDefaultTimeout(60_000)
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
        void context?.close().catch(() => {})
      },
    })
    timeline.recordedAt = new Date().toISOString()
    saveTimeline()
    await journey(seed)
  } catch (err) {
    if (err instanceof StoppedAfter) stoppedAfter = true
    else {
      failure ??= err
      if (page) await page.screenshot({ path: join(CAPTURE_DIR, 'failure.png') }).catch(() => {})
    }
  }

  // The footage, whatever happened: finished before the browser goes.
  if (recording) {
    const rec = await recording.stop()
    if (rec.failure) {
      failure ??= new Stopped(rec.failure)
      console.error(`The recorder failed: ${rec.failure}.`)
    }
    const probed = probe(FOOTAGE_FILE)
    if (probed.seconds !== null) {
      timeline.footage = FOOTAGE
      timeline.duration = probed.seconds
      console.log(`Footage: ${shown(FOOTAGE_FILE)} · ${probed.seconds.toFixed(1)} s · ${rec.received} screen frames into ${rec.frames} at ${FPS} fps`)
      if (probed.frames !== null && probed.frames !== rec.frames) {
        console.warn(`  ! The file holds ${probed.frames} frames but ${rec.frames} were written; check the marks against the footage before cutting.`)
      }
    } else {
      console.error(`The footage couldn't be read back from ${shown(FOOTAGE_FILE)}, so the timeline names none.`)
    }
  }
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})

  if (projectId) {
    try {
      timeline.stills = await copyStills(projectId)
      if (timeline.stills) {
        console.log(`Stills: ${1 + timeline.stills.panels.length + (timeline.stills.cover ? 1 : 0)} pictures in ${shown(STILLS_DIR)}`)
      }
      const desk = await readDesk(projectId)
      console.log(`Spend on this project, as the providers reported it: ${desk.imageCount} images · $${desk.costUsd.toFixed(4)}`)
    } catch (err) {
      console.error(`The stills couldn't be copied: ${(err as Error).message}`)
    }
  }
  saveTimeline()
  console.log(`Timeline: ${shown(TIMELINE)} · ${timeline.marks.length} marks`)

  if (failure) {
    const why = failure instanceof Stopped ? failure.message : ((failure as Error).message ?? String(failure)).split('\n')[0]
    console.error(`\nThe capture stopped while ${step}: ${why}.`)
    const kept = timeline.footage ? 'The footage so far and the marks reached are saved' : 'The marks reached are saved'
    console.error(`${kept}; ${shown(join(CAPTURE_DIR, 'failure.png'))} is the last screen, if it could be taken.\n`)
    process.exit(1)
  }
  if (stoppedAfter) console.log(`\nThe capture stopped after ${STOP_AFTER}, as asked.`)
  else console.log('\nThe capture is complete. Next: npm run video:render')
}

await main()
