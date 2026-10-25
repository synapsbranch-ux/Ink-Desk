// Slice 22's mechanical check, from `devpost/checklist.md > Slices > 22`,
// `devpost/prd.md > Animate a Page (v3)` and `devpost/spec.md > Animate a Page (v3)`,
// `> Verified for v3`, `> Failure Modes (v3)`:
//
//   npm run check:video
//
// Free and offline. Every real credential is dropped before anything loads; the
// provider is a stub in this process (`globalThis.fetch`), which records every
// request and answers as OpenRouter's video, speech and music endpoints do — so
// no paid call can leave this machine. ffmpeg and ffprobe are REAL: the shots are
// synthetic test-pattern clips, the voices and the music are sine tones.
//
//   1. Cost — `renderDims` and the token formula against OpenRouter's listed
//      per-second prices and the six clips slice 17 was billed for ($0.7623 per
//      5 s at 720p, a square shot as dear as a wide one); the hold margin covers
//      that bill; an unknown model is priced as the dearest; the estimate the
//      Animate station shows is exactly what the limits layer holds.
//   2. The shot machine — every legal transition and no other; a crash between
//      the paid POST and saving the provider's id leaves the shot `orphaned`, and
//      a redelivered job NEVER sends it again; a failed shot does not stop the
//      others; Try again re-runs that one shot only; a refused shot (a real face)
//      has its own calm sentence; a trailer whose job vanished is ended so it can
//      be tried again.
//   3. Money — the hold is settled to what the provider reported, once, while
//      the reconciler's sweep races the worker; released when nothing was made;
//      the studio's daily cap pauses a new trailer before any call. A job ended
//      by something else (the worker giving up, a dead lease let go) still counts
//      what was billed and what is with the provider, keeps its seconds used, and
//      its runner sends nothing new; a provider that stops answering for a while
//      does not cost a shot; an account deleted mid-trailer leaves no file of
//      theirs and its spend in the studio's day; a shot sent and never collected
//      (a timeout, a job gone, a setting, an orphan) counts at the formula's
//      price, so the job settles there and is never released at $0.
//   4. The request bodies the code sends: model, resolution, a duration inside
//      Seedance's range, the ratio, `generate_audio: false`; method A sends the
//      panel as `first_frame` only, method B the panel and the locked sheet as
//      `input_references` and no `frame_images`; the pictures travel inside the
//      request, never as an address anyone could supply; the key goes only to
//      OpenRouter's own host.
//   5. Assembly with real ffmpeg: the trailer plays (ffprobe), runs the plan's
//      length inside 20–30 s, is 1280×720 at 24 fps with sound, the bubbles are
//      on the picture at their lines' times and not elsewhere, and the poster and
//      captions are written.
//   6. Ownership — another person gets the 404 a missing video or project gets
//      on every video, file and animate route, before a body is read; a video
//      share hands out only its snapshot, and a revoked one answers exactly like
//      a token that never was.
//   7. VIDEO_FAIL_SHOT fails the first attempt in development and is ignored in
//      production.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env as Record<string, string | undefined>

const ok = (msg: string) => console.log(`  ok  ${msg}`)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// --- The environment: a scratch local desk, nothing real ------------------------------------
for (const name of Object.keys(env)) {
  if (/^(BETTER_AUTH_|S3_|MONGODB_|DB_)/.test(name)) delete env[name]
}
for (const name of [
  'ANTHROPIC_API_KEY', 'RAILWAY_TOKEN', 'APP_URL', 'REDIS_URL', 'REDIS_PRIVATE_URL', 'REDIS_PUBLIC_URL', 'NODE_ENV', 'ALLOWLIST_EMAILS', 'ADMIN_EMAILS',
  'VIDEO_MODEL', 'VIDEO_RESOLUTION', 'VIDEO_MOTION_METHOD', 'VIDEO_FAIL_SHOT', 'TTS_MODEL', 'MUSIC_MODEL', 'GLOBAL_TOTAL_USD_CAP', 'INKDESK_LIMITS',
]) delete env[name]

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-video-'))
const media = join(dir, 'synthetic')
env.INKDESK_DATA_DIR = join(dir, 'desk')
env.INKDESK_STORAGE = 'local'
env.INKDESK_QUEUE = 'inline'
env.INKDESK_AUTH = 'test' // sign-in on, so the limits are on, on the in-process counters
env.GENERATION_ENABLED = 'true'
env.VIDEO_ENABLED = 'true'
env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below; nothing leaves this machine
env.LLM_FALLBACK = 'always'
// The claim's settings, as production runs them — the measured bills are 720p on seedance-2.0.
env.VIDEO_MODEL = 'bytedance/seedance-2.0'
env.VIDEO_RESOLUTION = '720p'
env.VIDEO_POLL_MS = '1000'
// A 720p trailer is about $3: room for the scenarios below, each person on a day of their own.
env.USER_DAILY_USD_FREE = '20'
env.GLOBAL_DAILY_USD_CAP = '100'
env.QUOTA_FREE_VIDEO_SECONDS = '200'

// --- ffmpeg is the one real tool -----------------------------------------------------------
function tool(program: string, args: string[], opts: { binary?: boolean } = {}): { stdout: Buffer; stderr: string } {
  const r = spawnSync(program, args, { maxBuffer: 64 * 1024 * 1024, timeout: 300_000 })
  if (r.error) throw new Error(`${program} could not run: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${program} ${args.slice(0, 6).join(' ')}… exited ${r.status}: ${r.stderr.toString().trim().split('\n').slice(-6).join('\n')}`)
  return { stdout: opts.binary ? r.stdout : Buffer.from(r.stdout), stderr: r.stderr.toString() }
}
try {
  tool('ffmpeg', ['-version'])
  tool('ffprobe', ['-version'])
} catch {
  console.log('  --  check:video needs ffmpeg and ffprobe on the PATH (the worker needs them too)')
  process.exit(1)
}

// --- Synthetic media: the shots, a voice, the music -----------------------------------------
await (await import('node:fs/promises')).mkdir(media, { recursive: true })
const CLIP = { '16:9': join(media, 'wide.mp4'), '1:1': join(media, 'square.mp4') } as const
const ff = (...args: string[]) => tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
ff('-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', CLIP['16:9'])
ff('-f', 'lavfi', '-i', 'testsrc=size=960x960:rate=24:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', CLIP['1:1'])
const VOICE_MP3 = join(media, 'voice.mp3')
const MUSIC_MP3 = join(media, 'music.mp3')
ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.6', '-c:a', 'libmp3lame', '-q:a', '4', VOICE_MP3)
ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', '-af', 'volume=0.5', '-c:a', 'libmp3lame', '-q:a', '4', MUSIC_MP3)
const clipBytes = { '16:9': await readFile(CLIP['16:9']), '1:1': await readFile(CLIP['1:1']) }
const voiceBytes = await readFile(VOICE_MP3)
const musicBytes = await readFile(MUSIC_MP3)

// --- The provider, in this process ------------------------------------------------------------
const VIDEOS = 'https://openrouter.ai/api/v1/videos'
const SPEECH = 'https://openrouter.ai/api/v1/audio/speech'
const CHAT = 'https://openrouter.ai/api/v1/chat/completions'
/** What slice 17's six clips were billed: $0.7623 for 5 s at 720p, wide or square. */
const MEASURED_5S_720P = 0.7623
const TTS_BILLED = 0.000713 // a figure only a header could have given
const MUSIC_BILLED = 0.04

/** Each panel is one flat colour, the sheet another, so a request says which picture it carries. */
const PANEL_RGB: [number, number, number][] = [[208, 48, 48], [48, 160, 64], [48, 80, 208], [208, 176, 32]]
const SHEET_RGB: [number, number, number] = [160, 64, 160]

type Call = { method: string; url: string; auth: string | null; body: Record<string, unknown> | null; panel?: number }
const calls: Call[] = []
const strays: string[] = []
type ProviderJob = { id: string; panel: number; seconds: number; aspect: '16:9' | '1:1'; polls: number }
const providerJobs = new Map<string, ProviderJob>()

const provider = {
  /** Polls wait on this while it is set. */
  gate: null as Promise<void> | null,
  /** Panels whose job answers `in_progress` while they are here (the provider still making them). */
  holdPanels: new Set<number>(),
  /** Panels whose job answers its first N polls with a 503 — a provider having a moment while the shot goes on being made. */
  pollErrors: new Map<number, number>(),
  /** Panels whose POST is answered 400 with a policy reason. */
  refusePost: new Set<number>(),
  /** Panels whose job ends `failed`, with the provider's own words. */
  failPoll: new Map<number, string>(),
  /** Panels whose poll answers 404 (the provider no longer has the job) or 401 (the key refused: a setting). */
  pollStatus: new Map<number, 401 | 404>(),
  audio: 'ok' as 'ok' | 'down',
  /** The first job answers a polling address on another host: the key must never follow it. */
  strangePollingUrl: true,
  reset() {
    this.gate = null
    this.holdPanels.clear()
    this.pollErrors.clear()
    this.refusePost.clear()
    this.failPoll.clear()
    this.pollStatus.clear()
    this.audio = 'ok'
  },
}

async function colourOf(dataUri: string): Promise<{ rgb: [number, number, number]; width: number; height: number; format: string }> {
  assert.match(dataUri, /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, 'a picture travels inside the request, as a JPEG data URI')
  const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64')
  const img = sharp(bytes)
  const meta = await img.metadata()
  const stats = await img.stats()
  return { rgb: [stats.channels[0].mean, stats.channels[1].mean, stats.channels[2].mean], width: meta.width ?? 0, height: meta.height ?? 0, format: meta.format ?? '' }
}
const nearest = (rgb: number[], palette: [number, number, number][]) => {
  let best = 0
  let bestD = Infinity
  palette.forEach((p, i) => {
    const d = p.reduce((t, v, k) => t + (v - rgb[k]) ** 2, 0)
    if (d < bestD) [best, bestD] = [i, d]
  })
  return { index: best, distance: Math.sqrt(bestD) }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

async function answer(call: Call): Promise<Response> {
  const u = new URL(call.url)
  // A video job.
  if (call.method === 'POST' && call.url === VIDEOS) {
    const b = call.body ?? {}
    const pictures = (b.frame_images ?? b.input_references) as { image_url: { url: string } }[] | undefined
    const first = pictures?.[0] ? await colourOf(pictures[0].image_url.url) : null
    call.panel = first ? nearest(first.rgb, PANEL_RGB).index : -1
    if (provider.refusePost.has(call.panel)) return json(400, { error: { message: 'Content policy violation: the input image contains a real human face.' } })
    const id = `job-${providerJobs.size + 1}-${randomBytes(3).toString('hex')}`
    providerJobs.set(id, { id, panel: call.panel, seconds: Number(b.duration), aspect: b.aspect_ratio === '1:1' ? '1:1' : '16:9', polls: 0 })
    const polling = provider.strangePollingUrl ? 'https://evil.example/steal' : `${VIDEOS}/${id}`
    provider.strangePollingUrl = false
    return json(202, { id, polling_url: polling, status: 'pending' })
  }
  const poll = /^\/api\/v1\/videos\/([^/]+)$/.exec(u.pathname)
  if (call.method === 'GET' && poll) {
    if (provider.gate) await provider.gate
    const job = providerJobs.get(poll[1])
    if (!job) return json(404, { error: { message: 'not found' } })
    job.polls++
    const lost = provider.pollStatus.get(job.panel)
    if (lost) return json(lost, { error: { message: lost === 404 ? 'not found' : 'invalid key' } })
    if (job.polls <= (provider.pollErrors.get(job.panel) ?? 0)) return json(503, { error: { message: 'upstream unavailable' } })
    if (provider.holdPanels.has(job.panel)) return json(200, { id: job.id, status: 'in_progress' })
    const why = provider.failPoll.get(job.panel)
    if (why !== undefined) return json(200, { id: job.id, status: 'failed', error: why, unsigned_urls: [] })
    const cost = Math.round(MEASURED_5S_720P * (job.seconds / 5) * 1e6) / 1e6
    return json(200, { id: job.id, status: 'completed', usage: { cost }, unsigned_urls: [`https://openrouter.ai/files/${job.id}.mp4`] })
  }
  const content = /^\/api\/v1\/videos\/([^/]+)\/content$/.exec(u.pathname)
  if (call.method === 'GET' && content) {
    const job = providerJobs.get(content[1])
    if (!job) return json(404, { error: { message: 'gone' } })
    return new Response(new Uint8Array(clipBytes[job.aspect]), { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  if (call.method === 'POST' && call.url === SPEECH) {
    if (provider.audio === 'down') return json(503, { error: { message: 'upstream unavailable' } })
    return new Response(new Uint8Array(voiceBytes), { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-openrouter-cost': String(TTS_BILLED) } })
  }
  if (call.method === 'POST' && call.url === CHAT) {
    if (provider.audio === 'down') return json(503, { error: { message: 'upstream unavailable' } })
    const b64 = musicBytes.toString('base64')
    const cut = Math.floor(b64.length / 2 / 4) * 4 // two chunks, each a whole base64 group
    const events = [b64.slice(0, cut), b64.slice(cut)].map((data) => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data } } }] })}\n\n`)
    events.push(`data: ${JSON.stringify({ usage: { cost: MUSIC_BILLED } })}\n\n`, 'data: [DONE]\n\n')
    return new Response(events.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return json(404, { error: { message: 'the stub does not know this address' } })
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? 'GET').toUpperCase()
  const auth = new Headers(init?.headers).get('authorization')
  let body: Call['body'] = null
  if (typeof init?.body === 'string') {
    try {
      body = JSON.parse(init.body) as Call['body']
    } catch {}
  }
  const call: Call = { method, url, auth, body }
  calls.push(call)
  if (new URL(url).hostname !== 'openrouter.ai') {
    strays.push(url)
    throw new Error('the video check never leaves this machine')
  }
  return answer(call)
}) as typeof fetch

const videoPosts = () => calls.filter((c) => c.method === 'POST' && c.url === VIDEOS)
const audioPosts = () => calls.filter((c) => c.method === 'POST' && (c.url === SPEECH || c.url === CHAT))

// --- The studio, loaded after the environment is set --------------------------------------------
const { store } = await import('../lib/store')
const { videoSettings } = await import('../lib/config')
const cost = await import('../lib/video/cost')
const plan = await import('../lib/video/plan')
const rec = await import('../lib/video/record')
const { submitBody, SHOT_REFUSED } = await import('../lib/video/seedance')
const { buildFfmpegArgs, buildPosterArgs, shotStarts } = await import('../lib/video/assemble')
const { buildVtt } = await import('../lib/video/captions')
const { renderBubbleOverlay } = await import('../lib/video/bubbles')
const { runTrailer } = await import('../lib/video/run')
const { settleStaleVideo } = await import('../lib/video/status')
const { backend } = await import('../lib/limits/backend')
const { settleEnded, sweepUnsettled } = await import('../lib/limits/jobs')
const { NO_SUCH_PROJECT, NO_SUCH_VIDEO } = await import('../lib/auth/access')
const { endJob } = await import('../lib/queue/ending')
const { finish, TOO_MANY_RESTARTS } = await import('../lib/queue/jobs')
const { deleteAccount } = await import('../lib/account/deletion')
const { purgeCounters } = await import('../lib/account/counters')
const { shareFileUrl } = await import('../lib/share/url')
const { ShareThumb } = await import('../components/SettingsSharing')
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { emptyProject } = await import('../lib/types')
const { ONE_TRAILER_AT_A_TIME, TRAILER_HEIGHT, TRAILER_WIDTH, TRAILER_FPS, TRAILER_MIN_SECONDS, TRAILER_MAX_SECONDS } = await import('../lib/video/types')
import type { Character, Panel, Project } from '../lib/types'
import type { JobRecord } from '../lib/queue/jobs'
import type { ShareView, VideoRecord } from '../lib/share/types'
import type { TrailerPlan, ShotState } from '../lib/video/types'

const ALICE = 'user_alice'
const BOB = 'user_bob'
const CAROL = 'user_carol'
const DAVE = 'user_dave'
const ERIN = 'user_erin'
const FRANK = 'user_frank'
const GINA = 'user_gina'
const HANK = 'user_hank'
const IVY = 'user_ivy'
const JUNE = 'user_june'
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const micros = (usd: number) => Math.round(usd * 1e6)

// --- A finished page --------------------------------------------------------------------------------
const LINES = ['We leave at dawn.', '', 'Then the lantern goes with us, and so does the old map from the attic.', 'Ready.']
const CAST = ['c1', 'c2', 'c2', 'c1']

async function solid(rgb: [number, number, number], width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
}

function panelsOf(images: string[]): Panel[] {
  const at = new Date().toISOString()
  return [0, 1, 2, 3].map(
    (i): Panel => ({
      index: i as 0 | 1 | 2 | 3,
      characterId: CAST[i],
      action: 'looks toward the harbour',
      camera: i === 0 ? 'slow push in' : 'static',
      background: 'a lamplit street',
      dialogue: LINES[i],
      versions: [{ imageId: images[i], createdAt: at }],
      currentVersion: 0,
      status: 'done',
      startedAt: null,
      startedByRun: null,
    })
  )
}

/** A project for `ownerId` with one finished page: two wide panels (3:2), two square ones, and two locked characters with sheets. */
async function makeProject(ownerId: string, title: string): Promise<{ project: Project; images: string[]; sheet: string }> {
  const id = randomUUID()
  await store.createProject({ ...emptyProject({ id, chapterId: randomUUID(), title, stylePresetId: 'manga-bw', serverRunId: 'check' }), ownerId })
  const images: string[] = []
  for (let i = 0; i < 4; i++) {
    const wide = i === 0 || i === 3
    images.push(await store.putBlob(await solid(PANEL_RGB[i], wide ? 1200 : 800, 800), 'image/png', 'panel'))
  }
  const sheet = await store.putBlob(await solid(SHEET_RGB, 1200, 800), 'image/png', 'sheet')
  const characters: Character[] = [
    { id: 'c1', name: 'Aki', role: 'lead', traits: [], look: 'a tall young woman', dna: 'a tall young woman with a scar over her left brow, red scarf', sheetImageId: sheet, locked: true },
    { id: 'c2', name: 'Old Ren', role: 'counterpart', traits: [], look: 'an old man', dna: 'an old man with a grey beard, round glasses, brown coat', sheetImageId: sheet, locked: true },
  ]
  const project = await store.updateProject(id, (p: Project) => ({
    ...p,
    library: { ...p.library, characters },
    chapters: p.chapters.map((c) => ({ ...c, pages: [{ index: 0, layoutId: 'four-shot', panels: panelsOf(images) }] })),
  }))
  return { project, images, sheet }
}

// --- The route handlers, as Next calls them ----------------------------------------------------------
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
type Reply = { status: number; text: string; json: Record<string, unknown> | null; pulled: number; headers: Headers; bytes: Buffer }

function chunked(total = 64 * 1024) {
  const seen = { pulled: 0 }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (seen.pulled >= total) return c.close()
        const chunk = new TextEncoder().encode(seen.pulled === 0 ? '{"a":"' : 'a'.repeat(8 * 1024))
        seen.pulled += chunk.byteLength
        c.enqueue(chunk)
      },
    },
    { highWaterMark: 0 }
  )
  return { stream, seen }
}

/** One call, as `who` (null: no session). `body`: undefined = none, 'chunked' = a counted stream, else JSON. */
async function call(handler: Handler, method: string, params: Record<string, string>, who: string | null, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...extra }
  if (who) headers['x-inkdesk-test-user'] = who
  let req: Request
  let seen = { pulled: 0 }
  if (body === 'chunked' && method !== 'GET' && method !== 'HEAD') {
    const c = chunked()
    seen = c.seen
    req = new Request('http://check/api', { method, headers: { ...headers, 'content-type': 'application/json' }, body: c.stream, duplex: 'half' } as RequestInit)
  } else if (body !== undefined && body !== 'chunked' && method !== 'GET' && method !== 'HEAD') {
    req = new Request('http://check/api', { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } else req = new Request('http://check/api', { method, headers })
  const res = await handler(req, { params: Promise.resolve(params) })
  const bytes = Buffer.from(await res.arrayBuffer())
  const text = bytes.toString('utf8')
  let parsed: Reply['json'] = null
  try {
    parsed = JSON.parse(text) as Reply['json']
  } catch {}
  return { status: res.status, text, json: parsed, pulled: seen.pulled, headers: res.headers, bytes }
}

const API = join(ROOT, 'app', 'api')
async function routeOf(path: string): Promise<Record<string, Handler>> {
  return (await import(pathToFileURL(join(API, ...path.split('/'), 'route.ts')).href)) as Record<string, Handler>
}
const animateRoute = await routeOf('projects/[id]/pages/[n]/animate')
const projectVideosRoute = await routeOf('projects/[id]/videos')
const videoRoute = await routeOf('videos/[videoId]')
const videoFileRoute = await routeOf('videos/[videoId]/file/[name]')
const videoShareRoute = await routeOf('videos/[videoId]/share')
const publicShareRoute = await routeOf('s/[token]')
const publicFileRoute = await routeOf('s/[token]/file/[name]')
const statusRoute = await routeOf('projects/[id]/status')
const sharesRoute = await routeOf('shares')

async function until(what: string, test: () => Promise<boolean>, ms = 180_000): Promise<void> {
  const t0 = Date.now()
  while (!(await test())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(50)
  }
}
/** The run saves what it has spent on its job just after each write of the record: a moment for the last save to land. The counters asserted after it are the test. */
const settleRun = (jobId: string, owed: number) => until('the job to carry what its run has spent', async () => (await store.jobs.getJob(jobId))?.costUsd === owed, 3_000).catch(() => undefined)
const idle = (ownerId: string) => until(`${ownerId}'s trailer job to end`, async () => (await store.jobs.listJobs({ ownerId, status: ['queued', 'running'] })).length === 0)
const trailerJobs = async (ownerId: string) => (await store.jobs.listJobs({ ownerId, limit: 100 })).filter((j) => j.kind === 'trailer').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
const videoOf = async (id: string) => {
  const v = await store.videos.get(id)
  assert.ok(v, 'the trailer record exists')
  return v
}

/** A local file from the outputs store. */
async function pullOutput(key: string, dest: string): Promise<Buffer> {
  const blob = await store.outputs.open(key)
  assert.ok(blob, `${key} is in the outputs store`)
  const bytes = Buffer.from(await new Response(blob.body as ReadableStream).arrayBuffer())
  await writeFile(dest, bytes)
  return bytes
}

let failures = 0
async function section(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${name}`)
  try {
    await fn()
  } catch (err) {
    failures++
    console.error(`  FAIL ${name}:`, err)
  }
}

try {
  // ==================================================================================================
  await section('1. Cost — the token formula, the measured bills, the hold', async () => {
    assert.deepEqual(cost.renderDims('16:9', '720p'), { w: 1280, h: 720 })
    assert.deepEqual(cost.renderDims('1:1', '720p'), { w: 960, h: 960 }, 'a square shot renders 960×960 at 720p (measured 2026-10-14)')
    assert.deepEqual(cost.renderDims('1:1', '480p'), { w: 640, h: 640 })
    assert.equal(cost.videoTokens({ w: 1280, h: 720 }, 1), 21_600, 'W × H × s × 24 / 1024')
    // OpenRouter's listing: $0.151/s at 720p 16:9 on seedance-2.0, $0.040/s at 480p on -fast.
    assert.ok(Math.abs(cost.shotUsd('bytedance/seedance-2.0', '720p', '16:9', 1) - 0.151) < 0.0005, 'seedance-2.0 720p is $0.151 a second')
    assert.ok(Math.abs(cost.shotUsd('bytedance/seedance-2.0-fast', '480p', '16:9', 1) - 0.04) < 0.0006, 'seedance-2.0-fast 480p is about $0.040 a second')
    const wide5 = cost.shotUsd('bytedance/seedance-2.0', '720p', '16:9', 5)
    const square5 = cost.shotUsd('bytedance/seedance-2.0', '720p', '1:1', 5)
    assert.equal(round6(wide5), 0.756)
    assert.ok(Math.abs(square5 - wide5) / wide5 < 0.001, 'a square shot costs what a wide one does (960² ≈ 1280×720)')
    assert.ok(Math.abs(MEASURED_5S_720P - wide5) / MEASURED_5S_720P < 0.01, 'the formula is within 1% of the six measured bills')
    assert.ok(wide5 * cost.HOLD_MARGIN >= MEASURED_5S_720P, `the hold (${(wide5 * cost.HOLD_MARGIN).toFixed(4)}) covers the measured bill (${MEASURED_5S_720P})`)
    assert.ok(cost.HOLD_MARGIN > 1 && cost.HOLD_MARGIN < 1.1, 'the margin is a little over, not a guess')
    assert.equal(cost.usdPerMToken('bytedance/seedance-2.0', '480p'), cost.usdPerMToken('bytedance/seedance-2.0', '720p'), '480p and 720p cost the same per token')
    assert.deepEqual(Object.keys(cost.USD_PER_MTOKEN).sort(), ['bytedance/seedance-2.0', 'bytedance/seedance-2.0-fast'], 'only the two adopted models are priced')
    const dearest = Math.max(...Object.values(cost.USD_PER_MTOKEN))
    assert.equal(cost.usdPerMToken('someone/new-video-model', '720p'), dearest, 'an unknown model is priced as the dearest')
    assert.ok(cost.shotUsd('someone/new-video-model', '720p', '16:9', 5) >= Math.max(...Object.keys(cost.USD_PER_MTOKEN).map((m) => cost.shotUsd(m, '720p', '16:9', 5))))

    // The plan's estimate is the formula, the voices and the music, over by the margin — and a retry holds one shot only.
    const images = ['img-a', 'img-b', 'img-c', 'img-d']
    const p = plan.planTrailer({ title: 'T', page: 0, panels: panelsOf(images), characters: [{ id: 'c1', name: 'Aki', dna: 'a woman', look: '' }, { id: 'c2', name: 'Ren', dna: 'a man', look: '' }], model: 'bytedance/seedance-2.0', resolution: '720p', method: 'B' })
    assert.deepEqual(p.shots.map((s) => [s.aspect, s.seconds]), [['16:9', 4], ['1:1', 4], ['1:1', 5], ['16:9', 4]], 'shots: the layout’s ratios, clamp(ceil(speech + 1), 4, 5)')
    assert.deepEqual([p.introSeconds, p.shotSeconds, p.outroSeconds, p.runSeconds], [3, 17, 2, 22])
    const chars = LINES.join('').length
    assert.equal(p.speechChars, chars)
    const byHand = (p.shots.reduce((t, s) => t + cost.shotUsd(p.model, p.resolution, s.aspect, s.seconds), 0) + chars * cost.TTS_USD_PER_CHAR + cost.MUSIC_USD) * cost.HOLD_MARGIN
    assert.equal(plan.planUsd(p), round6(byHand))
    assert.equal(plan.planUsd(p, [2]), round6(cost.shotUsd(p.model, p.resolution, '1:1', 5) * cost.HOLD_MARGIN), 'a retry of one shot holds that shot, no voices, no music')
    assert.deepEqual(plan.planUses(p), { videoSeconds: 17, audioChars: chars })
    assert.deepEqual(plan.planUses(p, [2]), { videoSeconds: 5, audioChars: 0 })
    // Every four-panel page lands inside 20–30 s: the shortest and the longest shots.
    for (const words of ['', 'x'.repeat(160)]) {
      const q = plan.planTrailer({ ...{ title: 'T', page: 0, characters: [], model: 'm/x', resolution: '720p', method: 'A' as const }, panels: panelsOf(images).map((pp) => ({ ...pp, dialogue: words })) })
      assert.ok(q.runSeconds >= TRAILER_MIN_SECONDS && q.runSeconds <= TRAILER_MAX_SECONDS, `a page of ${words.length}-character lines runs ${q.runSeconds}s`)
      assert.ok(q.shots.every((s) => s.seconds >= 4 && s.seconds <= 5), 'every shot 4–5 s, inside Seedance’s 4–15')
    }
    ok('renderDims (square 960×960 at 720p), $0.151/s and $0.040/s as listed, $0.756 per 5 s within 1% of the $0.7623 billed and under the 3% hold, unknown models at the dearest price, the plan’s estimate and a retry’s')
  })

  // ==================================================================================================
  await section('2a. The shot machine — every legal transition and no other', async () => {
    const STATES: ShotState[] = ['queued', 'submitting', 'animating', 'done', 'failed', 'orphaned']
    const now = new Date()
    const base = rec.newVideoRecord({ id: 'v-pure', ownerId: 'u', projectId: 'p', plan: plan.planTrailer({ title: 'T', page: 0, panels: panelsOf(['a', 'b', 'c', 'd']), characters: [], model: 'bytedance/seedance-2.0', resolution: '720p', method: 'B' }) })
    const withState = (state: ShotState, status: VideoRecord['status'] = 'making'): VideoRecord => ({
      ...base,
      status,
      shots: base.shots.map((s) => (s.panel === 1 ? { ...s, state, providerJobId: state === 'animating' || state === 'done' ? 'job-x' : null, blobKey: state === 'done' ? 'k' : null } : s)),
    })
    const legal: Record<string, ShotState[]> = {
      markSubmitting: ['queued'],
      markSubmitted: ['submitting', 'animating'], // animating: only with the SAME id, and then nothing changes
      markShotDone: ['animating', 'done'], // done: only with the SAME clip, and then nothing changes
      markShotFailed: ['queued', 'submitting', 'animating'],
      queueRetry: ['failed', 'orphaned'],
    }
    for (const from of STATES) {
      const r = withState(from)
      const allowed = {
        markSubmitting: rec.markSubmitting(r, 1, now),
        markSubmitted: rec.markSubmitted(r, 1, 'job-x', now),
        markShotDone: rec.markShotDone(r, 1, { blobKey: 'k', costUsd: 0.5 }, now),
        markShotFailed: rec.markShotFailed(r, 1, 'why', 0, now),
        queueRetry: rec.queueRetry(withState(from, 'failed'), 1, now),
      }
      for (const [name, out] of Object.entries(allowed)) {
        assert.equal(out !== null, legal[name].includes(from), `${name} from ${from}: ${out ? 'allowed' : 'refused'}`)
      }
    }
    // The edges' targets.
    assert.equal(rec.shotOf(rec.markSubmitting(withState('queued'), 1, now)!, 1)?.state, 'submitting')
    assert.equal(rec.shotOf(rec.markSubmitting(withState('queued'), 1, now)!, 1)?.attempts, 1, 'the attempt is counted when it is sent')
    assert.equal(rec.shotOf(rec.markSubmitted(withState('submitting'), 1, 'job-x', now)!, 1)?.state, 'animating')
    assert.equal(rec.markSubmitted(withState('animating'), 1, 'job-other', now), null, 'a second provider id never replaces the first')
    assert.equal(rec.markSubmitted(withState('submitting'), 1, '', now), null)
    assert.equal(rec.shotOf(rec.markShotDone(withState('animating'), 1, { blobKey: 'k', costUsd: 0.5 }, now)!, 1)?.state, 'done')
    assert.equal(rec.markShotDone(withState('done'), 1, { blobKey: 'other', costUsd: 0.5 }, now), null, 'a done shot is never re-done with another clip')
    assert.equal(rec.markSubmitting(withState('queued', 'failed'), 1, now), null, 'nothing is sent for a trailer that has ended')
    assert.equal(rec.queueRetry(withState('failed', 'making'), 1, now), null, 'no Try again while the trailer is still being made')
    // A crash between POST and saving the id: submitting with no id → orphaned, on the next run, untouched otherwise.
    const crashed = rec.recoverShots(withState('submitting'), now)
    assert.equal(rec.shotOf(crashed, 1)?.state, 'orphaned')
    assert.equal(rec.shotOf(crashed, 1)?.error, rec.ORPHANED_SHOT)
    assert.equal(rec.markSubmitting(crashed, 1, now), null, 'an orphaned shot is never submitted by the machine')
    // After-audit #9: it may have been billed, so it carries the formula's price (what owedSince held for it), never $0.
    const priceOf = (panel: number) => round6(cost.shotUsd(base.plan.model, base.plan.resolution, base.plan.shots[panel].aspect, base.plan.shots[panel].seconds))
    assert.equal(rec.shotOf(crashed, 1)?.costUsd, priceOf(1), 'an orphaned shot is counted at the formula’s price')
    assert.equal(crashed.costUsd, priceOf(1))
    for (const s of ['queued', 'animating', 'done', 'failed', 'orphaned'] as ShotState[]) {
      const r = withState(s)
      assert.equal(rec.recoverShots(r, now), r, `a resume leaves a ${s} shot as it is`)
    }
    const live = withState('animating')
    assert.equal(rec.recoverShots(live, now), live, 'a resume leaves a live animating shot alone (it is polled by its id)')
    // The web's restart rule: a job gone leaves nothing spinning.
    const gone = rec.recoverShots({ ...withState('animating'), shots: withState('animating').shots.map((s) => (s.panel === 0 ? { ...s, state: 'submitting' } : s.panel === 3 ? { ...s, state: 'done', blobKey: 'd' } : s)) }, now, { jobGone: true })
    assert.deepEqual(gone.shots.map((s) => s.state), ['orphaned', 'orphaned', 'failed', 'done'])
    assert.deepEqual(gone.shots.map((s) => s.costUsd), [priceOf(0), priceOf(1), 0, 0], 'a job gone counts the shots it left with the provider at the formula’s price; one never sent costs nothing')
    // Money in the record: the sum of its parts, never added twice.
    const done1 = rec.markShotDone(withState('animating'), 1, { blobKey: 'k', costUsd: 0.7623 }, now)!
    assert.equal(rec.markShotDone(done1, 1, { blobKey: 'k', costUsd: 0.7623 }, now), done1, 'the same clip twice is the same record')
    assert.equal(done1.costUsd, 0.7623)
    const failedBilled = rec.markShotFailed(withState('animating'), 1, 'x', 0.4, now)!
    assert.equal(failedBilled.costUsd, 0.4, 'a shot billed and failed keeps its bill')
    assert.equal(rec.markShotFailed(failedBilled, 1, 'x', 0.4, now), null, 'and is never billed twice')
    // What a person sees of an orphaned shot: failed, with its own sentence, and Try again when nothing runs.
    const view = rec.viewOfVideo({ ...crashed, status: 'failed' }, { running: false })
    assert.deepEqual([view.shots[1].state, view.shots[1].error, view.shots[1].canRetry], ['failed', rec.ORPHANED_SHOT, true])
    assert.equal(rec.viewOfVideo({ ...crashed, status: 'failed' }, { running: true }).shots[1].canRetry, false)
    const text = JSON.stringify(view)
    assert.ok(!text.includes('job-x') && !text.includes('"u"') && !/costUsd|blobKey|ownerId/.test(text), 'a view carries no provider id, key, cost or owner')
    ok('queued → submitting → animating → done, → failed from the three live states, orphaned only by a resume (at the formula’s price), Try again only on a failed or orphaned shot of an ended trailer; money is the sum of the parts')
  })

  // ==================================================================================================
  await section('7. VIDEO_FAIL_SHOT — development only', async () => {
    assert.equal(videoSettings({ VIDEO_FAIL_SHOT: '2' }).failShot, 2)
    assert.equal(videoSettings({ VIDEO_FAIL_SHOT: '2', NODE_ENV: 'production' }).failShot, null, 'ignored in production')
    assert.equal(videoSettings({ NODE_ENV: 'production' }).failShot, null)
    assert.throws(() => videoSettings({ VIDEO_FAIL_SHOT: '7' }), /VIDEO_FAIL_SHOT/)
    const prod = videoSettings({ NODE_ENV: 'production' })
    assert.deepEqual([prod.model, prod.resolution, prod.method], ['bytedance/seedance-2.0', '720p', 'B'], 'production: seedance-2.0 at 720p; method B until the learner’s verdict')
    const dev = videoSettings({})
    assert.deepEqual([dev.model, dev.resolution], ['bytedance/seedance-2.0-fast', '480p'], 'development runs the cheap model at 480p')
    assert.equal(videoSettings({ VIDEO_MOTION_METHOD: 'A' }).method, 'A')
    // The slowest trailer must fit its claim: ceil(4 / parallel) shots deep, each up to its timeout, then the assembly.
    assert.throws(() => videoSettings({ VIDEO_SHOT_PARALLEL: '1' }), /VIDEO_SHOT_PARALLEL and VIDEO_SHOT_TIMEOUT_MS/, 'one at a time × 12 min is 48 min: refused')
    assert.throws(() => videoSettings({ VIDEO_SHOT_PARALLEL: '2' }), /VIDEO_SHOT_PARALLEL and VIDEO_SHOT_TIMEOUT_MS/, 'two at a time × 12 min + 3 is 27 min: refused')
    assert.throws(() => videoSettings({ VIDEO_SHOT_TIMEOUT_MS: '1800000' }), /VIDEO_SHOT_PARALLEL and VIDEO_SHOT_TIMEOUT_MS/, 'a 30-minute shot never fits')
    assert.equal(videoSettings({ VIDEO_SHOT_PARALLEL: '2', VIDEO_SHOT_TIMEOUT_MS: '600000' }).shotParallel, 2)
    assert.equal(videoSettings({ VIDEO_SHOT_PARALLEL: '1', VIDEO_SHOT_TIMEOUT_MS: '300000' }).shotParallel, 1)
    assert.deepEqual([videoSettings({}).shotParallel, videoSettings({}).shotTimeoutMs], [4, 720_000], 'the defaults fit')
    ok('VIDEO_FAIL_SHOT is read in development and ignored in production (its run-time effect is in section 2c)')
  })

  // ==================================================================================================
  let aliceVideo: VideoRecord | null = null
  let alicePlan: TrailerPlan | null = null
  let aliceProject: Project | null = null
  await section('3a/4/5. A whole trailer through the routes, the queue and real ffmpeg (method B)', async () => {
    provider.reset()
    const { project } = await makeProject(ALICE, 'The Lantern Keeper')
    aliceProject = project
    const before = { posts: videoPosts().length, calls: calls.length }

    // The estimate: spends nothing, writes nothing.
    const est = await call(animateRoute.GET, 'GET', { id: project.id, n: '0' }, ALICE)
    assert.equal(est.status, 200, est.text)
    const estimate = est.json!.estimate as { ok: true; usd: number; uses: { videoSeconds: number; audioChars: number }; shotSeconds: number; runSeconds: number; model: string; resolution: string }
    assert.equal(estimate.ok, true)
    assert.deepEqual([estimate.model, estimate.resolution, estimate.shotSeconds, estimate.runSeconds], ['bytedance/seedance-2.0', '720p', 17, 22])
    assert.equal(calls.length, before.calls, 'the estimate calls nobody')
    assert.deepEqual(await store.videos.listOf(ALICE), [], 'and writes no record')

    // Confirm, with the polls held so the hold can be read while the shots are with the provider.
    let open!: () => void
    provider.gate = new Promise<void>((r) => (open = r))
    const counters0 = await backend().counters(ALICE)
    const global0 = counters0.globalDayMicros
    const started = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, ALICE)
    assert.equal(started.status, 202, started.text)
    const videoId = (started.json!.video as { id: string }).id
    await until('four shots to be sent', async () => videoPosts().length - before.posts === 4)
    const [job] = await trailerJobs(ALICE)
    assert.ok(job, 'one trailer job')
    assert.equal(job.reservation, 'held')
    assert.equal(job.reservedUsd, estimate.usd, 'the job holds exactly the estimate the station showed')
    const hold = await backend().hold(job.id)
    assert.ok(hold, 'the limits layer holds it')
    assert.equal(hold.usd, micros(estimate.usd), `the hold (${hold.usd} µ$) is the estimate ($${estimate.usd})`)
    assert.deepEqual({ videoSeconds: hold.units.videoSeconds, audioChars: hold.units.audioChars }, estimate.uses, 'and the quota units are the estimate’s')
    const held = await backend().counters(ALICE)
    assert.equal(held.quota.videoSeconds, estimate.uses.videoSeconds)
    assert.equal(held.userDayMicros, micros(estimate.usd))
    // One at a time: a second Confirm is refused before anything is sent.
    const second = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, ALICE)
    assert.deepEqual([second.status, second.json?.error], [409, ONE_TRAILER_AT_A_TIME])
    assert.equal(videoPosts().length - before.posts, 4, 'the refused second trailer sent nothing')
    assert.equal((await store.videos.listOf(ALICE)).length, 1, 'and left no record')
    const polling = await call(videoRoute.GET, 'GET', { videoId }, ALICE)
    assert.ok((polling.json!.video as { shots: { state: string }[] }).shots.every((s) => s.state === 'animating'), 'the cards read animating while the provider works')

    // The reconciler's sweep runs over and over while the worker ends the job: the hold is settled once.
    let sweeping = true
    const sweeper = (async () => {
      while (sweeping) {
        await sweepUnsettled()
        await sleep(2)
      }
    })()
    open()
    provider.gate = null
    await idle(ALICE)
    sweeping = false
    await sweeper

    const video = await videoOf(videoId)
    aliceVideo = video
    alicePlan = video.plan
    const ended = (await store.jobs.getJob(job.id))!
    assert.deepEqual([video.status, ended.status, ended.outcome], ['done', 'done', 'done'], `the trailer is made: ${video.error ?? ''}`)
    const shotBills = video.plan.shots.map((s) => round6(MEASURED_5S_720P * (s.seconds / 5)))
    const lines = video.plan.shots.filter((s) => s.line).length
    const billed = round6(shotBills.reduce((t, n) => t + n, 0) + lines * TTS_BILLED + MUSIC_BILLED)
    assert.deepEqual(video.shots.map((s) => s.costUsd), shotBills, 'each shot carries what the provider reported for it')
    assert.equal(video.costUsd, billed, 'the record is the sum of what the providers reported')
    assert.equal(ended.costUsd, billed, 'the job’s cost is the record’s')
    assert.equal(ended.reservation, 'settled')
    assert.equal(await backend().hold(job.id), null, 'the hold is gone')
    const after = await backend().counters(ALICE)
    assert.equal(after.userDayMicros, micros(billed), `the person’s day counts the bill once (${after.userDayMicros} µ$ for $${billed}), not the estimate`)
    assert.equal(after.globalDayMicros - global0, micros(billed), 'the studio’s day too')
    assert.equal(after.quota.videoSeconds, 17, 'the seconds stay used')
    // A crash between the job's ending and its settle mark: the worker and the sweep both try again, at once.
    await store.jobs.updateJob(job.id, (j) => ({ ...j, reservation: 'held' }))
    const reheld = (await store.jobs.getJob(job.id))!
    await Promise.all([settleEnded(reheld), settleEnded(reheld), sweepUnsettled(), sweepUnsettled()])
    const raced = await backend().counters(ALICE)
    assert.deepEqual([raced.userDayMicros, raced.globalDayMicros, raced.quota.videoSeconds], [after.userDayMicros, after.globalDayMicros, after.quota.videoSeconds], 'settling again, from two places at once, changes nothing')
    assert.equal((await store.jobs.getJob(job.id))!.reservation, 'settled')
    ok(`the estimate ($${estimate.usd}) is the hold, to the micro-dollar and the second; one trailer at a time; settled once to the $${billed} reported while the sweep raced the worker, and again from two places at once changes nothing`)

    // --- 4. What was sent ------------------------------------------------------------------------
    const sent = videoPosts().slice(before.posts)
    assert.deepEqual(sent.map((c) => c.panel).sort(), [0, 1, 2, 3], 'one POST per panel, never two')
    for (const c of sent) {
      const b = c.body!
      const shot = video.plan.shots.find((s) => s.panel === c.panel)!
      assert.equal(c.auth, 'Bearer check-only-never-sent', 'the key is the bearer header')
      assert.equal(b.model, 'bytedance/seedance-2.0')
      assert.equal(b.resolution, '720p')
      assert.ok(Number.isInteger(b.duration) && (b.duration as number) >= 4 && (b.duration as number) <= 15, `a duration inside Seedance's 4–15 s (${b.duration})`)
      assert.equal(b.duration, shot.seconds, 'the plan’s seconds')
      assert.equal(b.aspect_ratio, shot.aspect)
      assert.equal(b.aspect_ratio, c.panel === 0 || c.panel === 3 ? '16:9' : '1:1', 'wide panels at 16:9 (no 3:2 on Seedance), squares at 1:1')
      assert.equal(b.generate_audio, false, 'the model never invents speech')
      assert.equal(b.session_id, videoId)
      assert.equal(b.user, ALICE)
      assert.ok(Number.isInteger(b.seed))
      assert.ok(!('frame_images' in b), 'method B sends no frame_images (they would drop the references)')
      const refs = b.input_references as { type: string; image_url: { url: string } }[]
      assert.equal(refs.length, 2, 'the panel and the locked sheet')
      assert.ok(refs.every((r) => r.type === 'image_url'))
      const panelPic = await colourOf(refs[0].image_url.url)
      const sheetPic = await colourOf(refs[1].image_url.url)
      assert.ok(nearest(panelPic.rgb, PANEL_RGB).distance < 12, 'the first reference is the panel')
      assert.ok(nearest(sheetPic.rgb, [SHEET_RGB]).distance < 12, 'the second is the character’s sheet')
      const ratio = panelPic.width / panelPic.height
      assert.ok(Math.abs(ratio - (shot.aspect === '1:1' ? 1 : 16 / 9)) < 0.01, `the panel is cut to the shot's ratio (${panelPic.width}×${panelPic.height})`)
      assert.ok(Math.abs(sheetPic.width / sheetPic.height - 1.5) < 0.01, 'the sheet is sent whole, not cropped')
      assert.ok(Math.max(panelPic.width, panelPic.height) <= 1280)
      assert.match(String(b.prompt), /No text, no speech bubbles, no captions/)
      assert.ok(!/https?:\/\//.test(JSON.stringify(b)), 'no address in the request: nothing the provider could be pointed at')
    }
    assert.ok(!strays.includes('https://evil.example/steal') && calls.every((c) => new URL(c.url).hostname === 'openrouter.ai'), 'a polling address on another host is never followed: the key goes only to openrouter.ai')
    const speech = calls.filter((c) => c.url === SPEECH).slice(-3)
    assert.equal(speech.length, 3, 'one voice request per spoken line')
    assert.deepEqual(speech.map((c) => c.body!.model), ['elevenlabs/eleven-v4', 'elevenlabs/eleven-v4', 'elevenlabs/eleven-v4'])
    const voiceOf = (text: string) => speech.find((c) => c.body!.input === text)!.body!.voice
    assert.equal(voiceOf(LINES[0]), voiceOf(LINES[3]), 'one voice per character')
    assert.notEqual(voiceOf(LINES[0]), voiceOf(LINES[2]), 'and the two characters differ')
    const kept = (await store.readProject(project.id)).library.characters
    assert.deepEqual(kept.map((c) => c.voice), [voiceOf(LINES[0]), voiceOf(LINES[2])], 'the voices are kept on the characters, chosen once')
    const music = calls.filter((c) => c.url === CHAT).slice(-1)[0]
    assert.deepEqual([music.body!.model, music.body!.stream], ['google/lyria-3-clip-preview', true])
    ok('four POSTs, one per panel: seedance-2.0, 720p, 4–5 s, 16:9 or 1:1, generate_audio false, session and user set; method B = the panel then the sheet as input_references and no frame_images; pictures inside the request; the key only to openrouter.ai; one voice per character, kept')

    // --- 5. The film ---------------------------------------------------------------------------------
    const out = join(dir, 'alice')
    await (await import('node:fs/promises')).mkdir(out, { recursive: true })
    const keys = rec.videoKeys(ALICE, videoId)
    assert.equal(video.finalKey, keys.final)
    const finalPath = join(out, 'final.mp4')
    await pullOutput(keys.final, finalPath)
    const probe = JSON.parse(tool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate', '-of', 'json', finalPath]).stdout.toString()) as {
      format: { duration: string }
      streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string; sample_rate?: string }[]
    }
    const seconds = Number(probe.format.duration)
    const v = probe.streams.find((s) => s.codec_type === 'video')!
    const a = probe.streams.find((s) => s.codec_type === 'audio')
    assert.ok(seconds >= TRAILER_MIN_SECONDS && seconds <= TRAILER_MAX_SECONDS, `20–30 s (${seconds})`)
    assert.ok(Math.abs(seconds - video.plan.runSeconds) < 0.15, `the plan's ${video.plan.runSeconds} s (${seconds})`)
    assert.ok(Math.abs(video.seconds - seconds) < 0.01, 'the record carries the measured length')
    assert.deepEqual([v.codec_name, v.width, v.height, v.r_frame_rate, v.pix_fmt], ['h264', TRAILER_WIDTH, TRAILER_HEIGHT, `${TRAILER_FPS}/1`, 'yuv420p'])
    assert.ok(a && a.codec_name === 'aac' && a.sample_rate === '48000', 'an AAC sound track')
    const loud = /max_volume: (-?[\d.]+) dB/.exec(tool('ffmpeg', ['-hide_banner', '-nostats', '-i', finalPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-']).stderr)
    assert.ok(loud && Number(loud[1]) > -20, `the sound is not silence (max ${loud?.[1]} dB)`)
    // A decodable film all the way through.
    tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', finalPath, '-f', 'null', '-'])

    // The bubbles: at a line's time the film differs from the bare shot exactly where the bubble is, and nowhere else.
    const W = TRAILER_WIDTH
    const H = TRAILER_HEIGHT
    const frameOf = (path: string, index: number, filter = ''): Buffer =>
      tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-vf', `${filter}select=eq(n\\,${index})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { binary: true }).stdout
    const bare = (aspect: '16:9' | '1:1') => {
      const box = aspect === '1:1' ? '720:720' : `${W}:${H}`
      return `fps=${TRAILER_FPS},scale=${box}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0xf3f2f2,setsar=1,`
    }
    const diff = (x: Buffer, y: Buffer, box: { x0: number; y0: number; x1: number; y1: number }, inside: boolean) => {
      let sum = 0
      let n = 0
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const within = xx >= box.x0 && xx <= box.x1 && yy >= box.y0 && yy <= box.y1
          if (within !== inside) continue
          const i = (yy * W + xx) * 3
          sum += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
          n += 3
        }
      }
      return n === 0 ? 0 : sum / n
    }
    const starts = shotStarts(video.plan)
    /** Two encodes of a busy test pattern differ by a few levels a pixel; a bubble over it by eighty or more. */
    const NOISE = 15
    const K = 48 // two seconds into the shot: the bubble is fully on (0.6 s … seconds − 0.4 s)
    const measured: string[] = []
    for (const [i, shot] of video.plan.shots.entries()) {
      const finalFrame = frameOf(finalPath, Math.round(starts[i] * TRAILER_FPS) + K)
      const rawFrame = frameOf(CLIP[shot.aspect], K, bare(shot.aspect))
      assert.equal(finalFrame.length, W * H * 3)
      assert.equal(rawFrame.length, W * H * 3)
      if (!shot.line) {
        const all = diff(finalFrame, rawFrame, { x0: -1, y0: -1, x1: -1, y1: -1 }, false)
        assert.ok(all < NOISE, `panel ${i + 1} has no line: the film is the bare shot (mean difference ${all.toFixed(1)})`)
        measured.push(`panel ${i + 1} bare ${all.toFixed(1)}`)
        continue
      }
      const overlay = await sharp(await renderBubbleOverlay({ line: shot.line, aspect: shot.aspect })).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const box = { x0: W, y0: H, x1: -1, y1: -1 }
      for (let yy = 0; yy < overlay.info.height; yy++) {
        for (let xx = 0; xx < overlay.info.width; xx++) {
          if (overlay.data[(yy * overlay.info.width + xx) * 4 + 3] > 128) {
            box.x0 = Math.min(box.x0, xx)
            box.y0 = Math.min(box.y0, yy)
            box.x1 = Math.max(box.x1, xx)
            box.y1 = Math.max(box.y1, yy)
          }
        }
      }
      assert.ok(box.x1 > box.x0 && box.y1 > box.y0, 'the bubble has a body')
      const inBubble = diff(finalFrame, rawFrame, box, true)
      const elsewhere = diff(finalFrame, rawFrame, box, false)
      assert.ok(inBubble > 40, `panel ${i + 1}: the bubble is on the picture at its line's time (mean difference ${inBubble.toFixed(1)} inside its box)`)
      assert.ok(elsewhere < NOISE, `panel ${i + 1}: and nothing else is drawn over the shot (mean difference ${elsewhere.toFixed(1)} outside it)`)
      // Before its line, the bubble is not there yet.
      const early = diff(frameOf(finalPath, Math.round(starts[i] * TRAILER_FPS) + 2), frameOf(CLIP[shot.aspect], 2, bare(shot.aspect)), box, true)
      assert.ok(early < NOISE, `panel ${i + 1}: no bubble before the line starts (mean difference ${early.toFixed(1)})`)
      measured.push(`panel ${i + 1} bubble ${inBubble.toFixed(0)} / rest ${elsewhere.toFixed(1)} / before ${early.toFixed(1)}`)
    }

    // Poster and captions.
    const poster = await pullOutput(keys.poster, join(out, 'poster.jpg'))
    const posterMeta = await sharp(poster).metadata()
    assert.deepEqual([posterMeta.format, posterMeta.width, posterMeta.height], ['jpeg', W, H], 'poster.jpg, a frame of the film')
    const captions = (await pullOutput(keys.captions, join(out, 'captions.vtt'))).toString('utf8')
    assert.equal(captions, buildVtt(video.plan), 'captions.vtt is the plan’s')
    assert.match(captions, /^WEBVTT\n/)
    for (const line of LINES.filter(Boolean)) assert.ok(captions.includes(line), `the captions carry “${line.slice(0, 20)}…”`)
    assert.equal((captions.match(/-->/g) ?? []).length, 3, 'a cue per spoken line')
    assert.match(captions, /00:00:03\.400 --> 00:00:06\.800\nWe leave at dawn\./, 'timed to the bubble: the line window inside its shot')
    // The ffmpeg command itself: no shell, the target written, CFR 24, H.264 + AAC, faststart.
    const args = buildFfmpegArgs({ plan: video.plan, clips: { 0: 'a b.mp4', 1: "c'd.mp4", 2: 'e.mp4', 3: 'f.mp4' }, speech: {}, music: null, workDir: '/w', outDir: '/o', overlays: { 0: '/w/b0.png', 2: '/w/b2.png', 3: '/w/b3.png' }, titleCard: '/w/t.png', envelope: null })
    assert.ok(args.includes("c'd.mp4") && args.includes('a b.mp4'), 'paths are arguments, never shell words')
    for (const [flag, value] of [['-c:v', 'libx264'], ['-pix_fmt', 'yuv420p'], ['-r', '24'], ['-fps_mode', 'cfr'], ['-c:a', 'aac'], ['-movflags', '+faststart'], ['-t', String(video.plan.runSeconds)]]) {
      assert.equal(args[args.lastIndexOf(flag) + 1], value, `${flag} ${value}`)
    }
    assert.equal(args.at(-1), '/o/final.mp4')
    assert.ok(buildPosterArgs(video.plan, '/o/final.mp4', '/o/p.jpg').includes('-frames:v'))
    ok(`final.mp4 plays: ${seconds.toFixed(2)} s (plan ${video.plan.runSeconds}), ${W}×${H} h264 at 24 fps, AAC 48 kHz, peak ${loud![1]} dB; bubbles on at their lines and nowhere else (${measured.join('; ')}); poster.jpg and captions.vtt written`)
  })

  // ==================================================================================================
  await section('2b. A failed shot, a refused one, and Try again on one shot only', async () => {
    provider.reset()
    const { project } = await makeProject(CAROL, 'Two Bad Shots')
    provider.failPoll.set(2, 'Internal error while generating the video')
    provider.failPoll.set(3, 'Request rejected: the input image appears to contain a real human face, which is not allowed.')
    const posts0 = videoPosts().length
    const audio0 = audioPosts().length
    const started = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, CAROL)
    assert.equal(started.status, 202, started.text)
    const videoId = (started.json!.video as { id: string }).id
    await idle(CAROL)
    let video = await videoOf(videoId)
    assert.deepEqual(video.shots.map((s) => s.state), ['done', 'done', 'failed', 'failed'], 'the good shots finish beside the failed ones')
    assert.equal(video.status, 'failed')
    assert.equal(video.error, "2 of 4 shots didn't finish - try them again.")
    assert.equal(video.shots[2].error, 'The video model couldn’t finish this shot.')
    assert.equal(video.shots[3].error, SHOT_REFUSED, 'a refusal has its own sentence')
    assert.ok(/panel|picture/i.test(SHOT_REFUSED) && !/face|policy|moderation|HTTP|\d{3}/i.test(SHOT_REFUSED), 'calm, pointed at the panel, and free of the provider’s words')
    const view = (await call(videoRoute.GET, 'GET', { videoId }, CAROL)).json!.video as { shots: { state: string; canRetry: boolean; error: string | null }[]; warnings: string[] }
    assert.deepEqual(view.shots.map((s) => [s.state, s.canRetry]), [['done', false], ['done', false], ['failed', true], ['failed', true]])
    assert.ok(!JSON.stringify(view).includes('human face'), 'the provider’s words stay in the terminal')
    const [first] = await trailerJobs(CAROL)
    const partial = round6(MEASURED_5S_720P * (4 / 5) * 2 + 3 * TTS_BILLED + MUSIC_BILLED)
    assert.deepEqual([first.outcome, first.costUsd, first.reservation], ['done', partial, 'settled'], 'the run billed two shots, the voices and the music, and is settled to that')
    assert.equal((await backend().counters(CAROL)).userDayMicros, micros(partial))
    const kept = { 0: video.shots[0], 1: video.shots[1] }

    // Try again on shot 3 (index 2): one POST, for that panel only; nothing else is remade.
    provider.failPoll.delete(2)
    const retried = await call(videoRoute.POST, 'POST', { videoId }, CAROL, { action: 'retry', shot: 2 })
    assert.equal(retried.status, 200, retried.text)
    await idle(CAROL)
    const afterOne = videoPosts().slice(posts0 + 4)
    assert.deepEqual(afterOne.map((c) => c.panel), [2], 'Try again sends that one shot, once')
    assert.equal(audioPosts().length - audio0, 4, 'and no voice or music is made again')
    video = await videoOf(videoId)
    assert.deepEqual(video.shots.map((s) => s.state), ['done', 'done', 'done', 'failed'])
    assert.deepEqual([video.shots[0], video.shots[1]], [kept[0], kept[1]], 'the shots that were done are untouched')
    assert.equal(video.shots[2].attempts, 2)
    const retryJob = (await trailerJobs(CAROL))[1]
    assert.deepEqual((retryJob.payload as { only?: number[] }).only, [2])
    assert.equal(retryJob.reservedUsd, plan.planUsd(video.plan, [2]), 'the retry holds one shot’s price, no voices, no music')
    assert.equal(retryJob.costUsd, round6(MEASURED_5S_720P), 'and is charged that shot only')
    assert.equal(video.error, "1 of 4 shots didn't finish - try it again.")
    // A shot that is done cannot be tried again; one that failed can, and then the trailer is assembled.
    const refusedRetry = await call(videoRoute.POST, 'POST', { videoId }, CAROL, { action: 'retry', shot: 0 })
    assert.equal(refusedRetry.status, 409)
    provider.failPoll.delete(3)
    assert.equal((await call(videoRoute.POST, 'POST', { videoId }, CAROL, { action: 'retry', shot: 3 })).status, 200)
    await idle(CAROL)
    video = await videoOf(videoId)
    assert.equal(video.status, 'done', `assembled once every shot is made: ${video.error ?? ''}`)
    assert.deepEqual(videoPosts().slice(posts0).map((c) => c.panel).sort(), [0, 1, 2, 2, 3, 3], 'six POSTs in all: four, then one per Try again')
    assert.equal(video.costUsd, round6(MEASURED_5S_720P * 0.8 * 3 + MEASURED_5S_720P + 3 * TTS_BILLED + MUSIC_BILLED))
    assert.equal((await backend().counters(CAROL)).userDayMicros, micros(video.costUsd), 'three jobs, each settled once: the day counts exactly the record’s bill')
    ok('a failed shot and a refused one leave the others done; the refusal reads “change the picture or its description”; Try again sends that one shot once, holds and charges only it, remakes no voice or music; a done shot cannot be retried')
  })

  // ==================================================================================================
  await section('3b. Released when nothing was made; the daily cap pauses before any call', async () => {
    provider.reset()
    const { project } = await makeProject(DAVE, 'Nothing Comes Back')
    // The studio's daily cap below the estimate: refused before any call, no record, nothing held.
    env.GLOBAL_DAILY_USD_CAP = '0.5'
    const calls0 = calls.length
    const paused = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, DAVE)
    assert.equal(paused.status, 503, paused.text)
    assert.equal((paused.json as { code?: string }).code, 'paused')
    assert.match(String(paused.json!.error), /paused/i)
    assert.equal(calls.length, calls0, 'no provider was called')
    assert.deepEqual(await store.videos.listOf(DAVE), [], 'no trailer record is left behind')
    assert.deepEqual(await trailerJobs(DAVE), [])
    assert.equal((await backend().counters(DAVE)).quota.videoSeconds, 0, 'nothing is held')
    env.GLOBAL_DAILY_USD_CAP = '100'

    // Every shot refused at the door, the voices and the music down: nothing made, nothing billed — the hold comes back.
    for (const p of [0, 1, 2, 3]) provider.refusePost.add(p)
    provider.audio = 'down'
    const posts0 = videoPosts().length
    const started = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, DAVE)
    assert.equal(started.status, 202, started.text)
    await idle(DAVE)
    assert.equal(videoPosts().length - posts0, 4, 'a refused POST is never sent again (it was answered)')
    const [job] = await trailerJobs(DAVE)
    assert.deepEqual([job.status, job.outcome, job.costUsd, job.reservation], ['failed', 'failed', 0, 'settled'])
    assert.equal(await backend().hold(job.id), null)
    const c = await backend().counters(DAVE)
    assert.deepEqual([c.quota.videoSeconds, c.quota.audioChars, c.userDayMicros], [0, 0, 0], 'the quota and the dollars come back')
    const video = (await store.videos.listOf(DAVE))[0]
    assert.ok(video.shots.every((s) => s.state === 'failed' && s.error === SHOT_REFUSED))
    assert.equal(video.warnings.length, 4, 'a calm note for each voice line and the music')
    provider.reset()
    ok('the global daily cap answers 503 “paused” before any provider call and leaves nothing; a trailer that made and billed nothing is failed and its hold released — quota and dollars back')
  })

  // ==================================================================================================
  await section('2c. The crash between the paid POST and its id (method A, VIDEO_FAIL_SHOT, a redelivery)', async () => {
    provider.reset()
    env.VIDEO_FAIL_SHOT = '3'
    const { project, images } = await makeProject(ERIN, 'Pulled Plug')
    const p = plan.planTrailer({
      title: 'Pulled Plug',
      page: 0,
      panels: panelsOf(images),
      characters: project.library.characters,
      model: 'bytedance/seedance-2.0',
      resolution: '720p',
      method: 'A',
    })
    const videoId = randomUUID()
    await store.videos.put(rec.newVideoRecord({ id: videoId, ownerId: ERIN, projectId: project.id, plan: p }))
    provider.failPoll.set(0, 'Internal error').set(2, 'Internal error')
    const payload: { kind: 'trailer'; videoId: string; baselineUsd?: number } = { kind: 'trailer', videoId }
    const job = { id: 'job-erin', ownerId: ERIN, projectId: project.id, kind: 'trailer', payload } as unknown as JobRecord
    const runOf = () => ({ jobId: job.id, resultImageId: null, costUsd: 0, checkpoint: async () => {}, patchPayload: async (patch: object) => void Object.assign(payload, patch), spent: async () => {}, isCurrent: async () => true })

    // The plug is pulled just as panel 2's provider id would be saved: that write never lands.
    const realUpdate = store.videos.update
    store.videos.update = async (id, fn) => {
      const current = await store.videos.get(id)
      const out = current ? fn(current) : null
      const was = current?.shots.find((s) => s.panel === 1)
      const now = out?.shots.find((s) => s.panel === 1)
      if (was?.state === 'submitting' && now?.state === 'animating') throw new Error('the check pulls the plug here')
      return realUpdate(id, fn)
    }
    const posts0 = videoPosts().length
    try {
      await assert.rejects(runTrailer(job, runOf()), /pulls the plug/, 'the run stops on the lost write, for the queue to run it again')
    } finally {
      store.videos.update = realUpdate
    }
    const firstPosts = videoPosts().slice(posts0)
    assert.deepEqual(firstPosts.map((c) => c.panel).sort(), [0, 1, 2], 'three POSTs: VIDEO_FAIL_SHOT stopped panel 4 before anything was sent')
    for (const c of firstPosts) {
      const b = c.body!
      assert.ok(!('input_references' in b), 'method A sends no input_references')
      const frames = b.frame_images as { type: string; frame_type: string; image_url: { url: string } }[]
      assert.equal(frames.length, 1)
      assert.deepEqual([frames[0].type, frames[0].frame_type], ['image_url', 'first_frame'], 'the panel is the first frame')
      const pic = await colourOf(frames[0].image_url.url)
      assert.ok(nearest(pic.rgb, PANEL_RGB).distance < 12 && nearest(pic.rgb, PANEL_RGB).index === c.panel, 'the frame is the panel itself, not the sheet')
      assert.ok(Math.abs(pic.width / pic.height - (b.aspect_ratio === '1:1' ? 1 : 16 / 9)) < 0.01)
      assert.deepEqual([b.generate_audio, b.model, b.resolution], [false, 'bytedance/seedance-2.0', '720p'])
    }
    let video = await videoOf(videoId)
    const lost = video.shots[1]
    assert.deepEqual([lost.state, lost.providerJobId], ['submitting', null], 'the crash leaves panel 2 submitting, its provider id unsaved')
    assert.deepEqual([video.shots[3].state, video.shots[3].error, video.shots[3].attempts], ['failed', SHOT_REFUSED, 1], 'VIDEO_FAIL_SHOT: the first attempt fails as a refusal, before anything is spent')
    const lostJobId = [...providerJobs.values()].filter((j) => j.panel === 1).at(-1)!.id

    // The redelivery: panel 2 is orphaned and NEVER sent again; its job at the provider is not even asked after.
    const calls1 = calls.length
    const outcome = await runTrailer(job, runOf())
    const later = calls.slice(calls1)
    assert.equal(later.filter((c) => c.method === 'POST' && c.url === VIDEOS).length, 0, 'the redelivery sends no shot at all')
    assert.ok(!later.some((c) => c.url.includes(lostJobId)), 'and does not poll the lost job')
    video = await videoOf(videoId)
    assert.deepEqual([video.shots[1].state, video.shots[1].error], ['orphaned', rec.ORPHANED_SHOT])
    assert.deepEqual(video.shots.map((s) => s.state), ['failed', 'orphaned', 'failed', 'failed'])
    assert.equal(video.status, 'failed')
    assert.equal(video.error, "4 of 4 shots didn't finish - try them again.")
    assert.equal(outcome.outcome, 'done', 'the voices and music were billed, so the run is done (its hold is settled to them)')
    // …and the orphaned shot, which may have been billed, at the formula's price (after-audit #9).
    const orphanUsd = cost.shotUsd(p.model, p.resolution, p.shots[1].aspect, p.shots[1].seconds)
    assert.equal(video.shots[1].costUsd, round6(orphanUsd))
    assert.equal(outcome.costUsd, round6(3 * TTS_BILLED + MUSIC_BILLED + orphanUsd))
    // A third delivery changes nothing either.
    const calls2 = calls.length
    await runTrailer(job, runOf())
    assert.equal(calls.slice(calls2).filter((c) => c.url === VIDEOS || c.url === SPEECH || c.url === CHAT).length, 0, 'nothing ended is started again by the machine')
    // Only a person's Try again sends it again — once, with its attempt counted.
    const retried = await call(videoRoute.POST, 'POST', { videoId }, ERIN, { action: 'retry', shot: 1 })
    assert.equal(retried.status, 200, retried.text)
    await idle(ERIN)
    const byPerson = videoPosts().slice(posts0 + 3)
    assert.deepEqual(byPerson.map((c) => c.panel), [1], 'Try again sends the orphaned shot once')
    assert.ok('frame_images' in byPerson[0].body!, 'still method A: the plan pinned it at Confirm')
    video = await videoOf(videoId)
    assert.deepEqual([video.shots[1].state, video.shots[1].attempts], ['done', 2])
    // VIDEO_FAIL_SHOT fails only the first attempt: Try again on that panel is sent.
    assert.equal((await call(videoRoute.POST, 'POST', { videoId }, ERIN, { action: 'retry', shot: 3 })).status, 200)
    await idle(ERIN)
    assert.deepEqual(videoPosts().slice(posts0 + 4).map((c) => c.panel), [3], 'the switch’s panel is sent on its second attempt')
    assert.deepEqual([(await videoOf(videoId)).shots[3].state, (await videoOf(videoId)).shots[3].attempts], ['done', 2])
    delete env.VIDEO_FAIL_SHOT
    // The two shapes are exclusive by construction, whatever the caller holds.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff])
    const shape = { model: 'bytedance/seedance-2.0', prompt: 'p', seconds: 4, resolution: '720p', aspect: '16:9' as const, seed: 1, sessionId: 's', userId: 'u', frame: jpeg, sheet: jpeg }
    const a = submitBody({ ...shape, method: 'A' })
    assert.ok(!('input_references' in a) && (a.frame_images as unknown[]).length === 1, 'method A never sends the sheet, even when it has one')
    const b = submitBody({ ...shape, method: 'B' })
    assert.ok(!('frame_images' in b) && (b.input_references as unknown[]).length === 2)

    // The web's restart rule: a trailer whose job is gone is ended so a person can act, with nothing sent.
    const stale = rec.newVideoRecord({ id: randomUUID(), ownerId: ERIN, projectId: project.id, plan: p, now: new Date(Date.now() - 60_000) })
    const old = new Date(Date.now() - 60_000).toISOString()
    stale.status = 'making'
    stale.phase = 'shots'
    stale.updatedAt = old
    stale.shots = stale.shots.map((s) => (s.panel === 0 ? { ...s, state: 'animating', providerJobId: 'job-gone' } : s.panel === 1 ? { ...s, state: 'submitting' } : s.panel === 3 ? { ...s, state: 'done', blobKey: 'k' } : s))
    await store.videos.put(stale)
    const calls3 = calls.length
    const settled = await settleStaleVideo((await store.videos.get(stale.id))!)
    assert.deepEqual(settled.shots.map((s) => s.state), ['orphaned', 'orphaned', 'failed', 'done'])
    assert.deepEqual([settled.status, settled.error], ['failed', rec.STUDIO_RESTARTED])
    assert.equal(calls.length, calls3, 'and nobody is called')
    ok('a crash after the paid POST leaves the shot submitting; every redelivery marks it orphaned and never sends or polls it again; only Try again pays for it, once; method A = the panel as first_frame only; VIDEO_FAIL_SHOT fails the first attempt with nothing sent; a vanished job ends the trailer for a person to act on')
  })

  // ==================================================================================================
  await section('3c. Money when something else ends the job — the worker gives up, a dead lease is let go', async () => {
    const shotPrice = (v: VideoRecord, panel: number) => {
      const s = v.plan.shots.find((x) => x.panel === panel)!
      return cost.shotUsd(v.plan.model, v.plan.resolution, s.aspect, s.seconds)
    }
    const partsDone = (v: VideoRecord) => v.music.state === 'done' && v.speech.every((p) => p.state === 'done')

    // (i) The worker's own ending once a job stalled or threw past its attempts (`lib/queue/worker.ts`'s 'failed'
    // handler; the reconciler at MAX_CLAIMS writes the same), with three shots billed and one still at the provider.
    provider.reset()
    provider.holdPanels.add(3)
    const gina = await makeProject(GINA, 'Given Up On')
    const posts0 = videoPosts().length
    const global0 = (await backend().counters(GINA)).globalDayMicros
    const started = await call(animateRoute.POST, 'POST', { id: gina.project.id, n: '0' }, GINA)
    assert.equal(started.status, 202, started.text)
    const videoId = (started.json!.video as { id: string }).id
    await until('three shots, the voices and the music', async () => {
      const v = await videoOf(videoId)
      return v.shots.filter((s) => s.state === 'done').length === 3 && v.shots[3].state === 'animating' && partsDone(v)
    })
    const [job] = await trailerJobs(GINA)
    const midway = await videoOf(videoId)
    const owed = rec.owedSince(midway, 0)
    assert.equal(owed, round6(midway.costUsd + shotPrice(midway, 3) * cost.HOLD_MARGIN), 'owed: what was billed, and the shot still at the provider at its price over the margin')
    await settleRun(job.id, owed)
    await endJob(job.id, (j) => finish(j, { outcome: 'failed', error: TOO_MANY_RESTARTS }, new Date()))
    const c1 = await backend().counters(GINA)
    assert.equal(c1.userDayMicros, micros(owed), `the person’s day counts $${owed}, not the $0 a released hold would leave`)
    assert.equal(c1.globalDayMicros - global0, micros(owed), 'and so does the studio’s')
    assert.equal(c1.quota.videoSeconds, 17, 'the seconds stay used')
    const given = (await store.jobs.getJob(job.id))!
    assert.deepEqual([given.status, given.reservation, given.costUsd], ['failed', 'settled', owed])
    // The run goes on with what was already sent: panel 4 is collected and the trailer made; the counters do not move.
    provider.holdPanels.clear()
    await until('the record to end', async () => !['queued', 'making'].includes((await videoOf(videoId)).status))
    const made = await videoOf(videoId)
    assert.equal(made.status, 'done', made.error ?? '')
    assert.equal(videoPosts().length - posts0, 4, 'every shot was sent once, before the ending')
    const c2 = await backend().counters(GINA)
    assert.deepEqual([c2.userDayMicros, c2.quota.videoSeconds], [c1.userDayMicros, 17])
    assert.ok(c2.userDayMicros >= micros(made.costUsd) && c2.userDayMicros <= micros(made.costUsd * cost.HOLD_MARGIN), `counted $${c2.userDayMicros / 1e6} against the $${made.costUsd} the providers billed: never under, at most the margin over`)
    ok(`the worker giving up after three billed shots settles at $${owed} (billed + the shot still at the provider), not $0, the seconds kept; the trailer the run then finishes leaves the counters where they were, within the margin of the bill`)

    // (ii) A worker that died: its lease lapses and the next read of the project lets the job go (`liveJobs`, the page's
    // status poll). Two shots at a time, so two are still waiting their turn when it happens — and are never sent.
    env.VIDEO_SHOT_PARALLEL = '2'
    env.VIDEO_SHOT_TIMEOUT_MS = '600000' // two at a time: 2 × 10 min + the assembly fits the trailer's 25
    try {
      provider.reset()
      provider.holdPanels.add(0).add(1)
      const frank = await makeProject(FRANK, 'Let Go')
      const fPosts0 = videoPosts().length
      const fStarted = await call(animateRoute.POST, 'POST', { id: frank.project.id, n: '0' }, FRANK)
      assert.equal(fStarted.status, 202, fStarted.text)
      const fVideo = (fStarted.json!.video as { id: string }).id
      await until('two shots at the provider, two waiting, the voices and the music', async () => {
        const v = await videoOf(fVideo)
        return v.shots.map((s) => s.state).join() === 'animating,animating,queued,queued' && partsDone(v)
      })
      const [fJob] = await trailerJobs(FRANK)
      const fOwed = rec.owedSince(await videoOf(fVideo), 0)
      await settleRun(fJob.id, fOwed)
      await store.jobs.updateJob(fJob.id, (j) => ({ ...j, leaseUntil: new Date(Date.now() - 1_000).toISOString() }))
      assert.equal((await call(statusRoute.GET, 'GET', { id: frank.project.id }, FRANK)).status, 200)
      const letGo = (await store.jobs.getJob(fJob.id))!
      assert.deepEqual([letGo.status, letGo.outcome, letGo.reservation], ['failed', 'abandoned', 'settled'], 'the dead job is let go and its hold settled')
      const f1 = await backend().counters(FRANK)
      assert.equal(f1.userDayMicros, micros(fOwed), `the day counts the $${fOwed} it spent and has at the provider, not the $0 a released hold would leave`)
      assert.equal(f1.quota.videoSeconds, 17, 'the seconds stay used')
      provider.holdPanels.clear()
      await until('the record to end', async () => !['queued', 'making'].includes((await videoOf(fVideo)).status))
      const v = await videoOf(fVideo)
      assert.equal(videoPosts().length - fPosts0, 2, 'a run whose job was let go sends no new shot: the two waiting are never paid for')
      assert.deepEqual(v.shots.map((s) => s.state), ['done', 'done', 'failed', 'failed'], 'what was already sent is collected')
      assert.deepEqual([v.shots[2].error, v.shots[3].error], [rec.STUDIO_RESTARTED, rec.STUDIO_RESTARTED])
      assert.equal(v.status, 'failed')
      const view = (await call(videoRoute.GET, 'GET', { videoId: fVideo }, FRANK)).json!.video as { shots: { canRetry: boolean }[] }
      assert.deepEqual(view.shots.map((s) => s.canRetry), [false, false, true, true], 'and the two never sent can be tried again')
      const f2 = await backend().counters(FRANK)
      assert.equal(f2.userDayMicros, f1.userDayMicros, 'nothing more is counted, because nothing more was spent')
      assert.ok(f2.userDayMicros >= micros(v.costUsd), `never under the $${v.costUsd} billed`)
    } finally {
      delete env.VIDEO_SHOT_PARALLEL
      delete env.VIDEO_SHOT_TIMEOUT_MS
      provider.reset()
    }
    ok('a lease let go by the web settles the job at what it spent and has at the provider, its seconds kept; its run collects the two shots already sent and never sends the two that were waiting, which can be tried again')
  })

  // ==================================================================================================
  await section('3d. A provider that stops answering for a while does not cost a shot', async () => {
    provider.reset()
    provider.pollErrors.set(1, 8) // eight 503s in a row on panel 2's polls, while the shot goes on being made
    const { project } = await makeProject(HANK, 'Bad Line')
    const posts0 = videoPosts().length
    const started = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, HANK)
    assert.equal(started.status, 202, started.text)
    const videoId = (started.json!.video as { id: string }).id
    await idle(HANK)
    const v = await videoOf(videoId)
    const p2 = [...providerJobs.values()].filter((j) => j.panel === 1).at(-1)!
    assert.ok(p2.polls > 8, `panel 2 was asked after past its eight errors (${p2.polls} polls)`)
    assert.deepEqual([v.status, v.shots[1].state], ['done', 'done'], `the shot is collected when the provider answers again: ${v.shots[1].error ?? ''}`)
    assert.equal(v.shots[1].costUsd, round6(MEASURED_5S_720P * (v.plan.shots[1].seconds / 5)), 'with what it billed')
    assert.deepEqual(videoPosts().slice(posts0).map((c) => c.panel).sort(), [0, 1, 2, 3], 'and it was sent once')
    const [job] = await trailerJobs(HANK)
    assert.equal(job.costUsd, v.costUsd)
    provider.reset()
    ok(`eight 503s in a row on a shot already sent are waited out (${p2.polls} polls, then completed): the shot is done with its bill and was paid for once`)
  })

  // ==================================================================================================
  await section('3e. An account deleted while its trailer is with the provider', async () => {
    provider.reset()
    let open!: () => void
    provider.gate = new Promise<void>((r) => (open = r))
    const { project } = await makeProject(IVY, 'Gone Before Dawn')
    const posts0 = videoPosts().length
    const global0 = (await backend().counters(IVY)).globalDayMicros
    const started = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, IVY)
    assert.equal(started.status, 202, started.text)
    const videoId = (started.json!.video as { id: string }).id
    await until('four shots at the provider, the voices and the music made', async () => {
      const v = await store.videos.get(videoId)
      return !!v && v.shots.every((s) => s.state === 'animating') && v.music.state === 'done' && v.speech.every((p) => p.state === 'done')
    })
    const [job] = await trailerJobs(IVY)
    const owed = rec.owedSince((await store.videos.get(videoId))!, 0)
    await settleRun(job.id, owed)
    const deletion = { id: randomUUID(), ownerId: IVY, kind: 'delete-account', payload: { kind: 'delete-account' } } as unknown as JobRecord
    assert.deepEqual(await deleteAccount(deletion, { signIn: null, purgeCounters, now: () => new Date() }), { outcome: 'done' })
    const folder = `videos/${IVY}/`
    assert.deepEqual(await store.outputs.list(folder), [], 'the deletion leaves the folder empty')
    // The provider answers now: the clips come back to a run whose record, job and person are gone.
    open()
    provider.gate = null
    const running = () => (globalThis as { __inkdeskRunning?: Set<string> }).__inkdeskRunning?.size ?? 0
    await until('the cancelled run to stop', async () => running() === 0)
    assert.deepEqual((await store.outputs.list(folder)).map((f) => f.key), [], 'nothing of theirs is written back after the deletion said done')
    assert.equal(await store.videos.get(videoId), null)
    assert.equal(videoPosts().length - posts0, 4, 'and nothing new was sent')
    // What the provider bills for that trailer is in the studio's day all the same (the kill switch counts it), the person's own counters gone.
    const sent = [...providerJobs.values()].slice(-4)
    assert.deepEqual(sent.map((j) => j.panel).sort(), [0, 1, 2, 3])
    const bill = round6(sent.reduce((t, j) => t + round6(MEASURED_5S_720P * (j.seconds / 5)), 0) + 3 * TTS_BILLED + MUSIC_BILLED)
    const counted = (await backend().counters(IVY)).globalDayMicros - global0
    assert.ok(counted >= micros(bill) && counted <= micros(bill * cost.HOLD_MARGIN), `the studio’s day counts $${counted / 1e6} for a trailer the providers billed $${bill} (not $0)`)
    assert.deepEqual([(await backend().counters(IVY)).userDayMicros, (await backend().counters(IVY)).quota.videoSeconds], [0, 0], 'the person’s own counters went with them')
    provider.reset()
    ok(`deleting the account mid-trailer leaves videos/${IVY}/ empty after the four clips land, sends nothing new, and keeps the $${bill} billed in the studio’s day (counted $${counted / 1e6})`)
  })

  // ==================================================================================================
  await section('3f. A shot sent and never collected is counted at the formula’s price (after-audit #9)', async () => {
    // Panels 1 and 4 outlast VIDEO_SHOT_TIMEOUT_MS, panel 2's job is gone (404), panel 3's poll refuses the key (a setting);
    // the voices and the music are down. Each shot was POSTed, so the provider bills it: none may be counted at $0.
    provider.reset()
    env.VIDEO_SHOT_TIMEOUT_MS = '60000' // the shortest the settings allow
    provider.holdPanels.add(0)
    provider.holdPanels.add(3)
    provider.pollStatus.set(1, 404)
    provider.pollStatus.set(2, 401)
    provider.audio = 'down'
    const { project } = await makeProject(JUNE, 'Slow Provider Day')
    const posts0 = videoPosts().length
    const started = await call(animateRoute.POST, 'POST', { id: project.id, n: '0' }, JUNE)
    assert.equal(started.status, 202, started.text)
    const videoId = (started.json!.video as { id: string }).id
    await until('four shots to be sent', async () => videoPosts().length - posts0 === 4)
    const heldSeconds = (await backend().counters(JUNE)).quota.videoSeconds
    assert.ok(heldSeconds > 0)
    await idle(JUNE)
    assert.equal(videoPosts().length - posts0, 4, 'four shots sent, so four billed')
    const v = await videoOf(videoId)
    const price = v.plan.shots.map((s) => round6(cost.shotUsd(v.plan.model, v.plan.resolution, s.aspect, s.seconds)))
    assert.deepEqual(v.shots.map((s) => s.state), ['failed', 'failed', 'failed', 'failed'])
    assert.deepEqual(v.shots.map((s) => s.costUsd), price, 'a timeout, a job gone and a setting each count the shot at the formula’s price')
    const total = round6(price.reduce((t, n) => t + n, 0))
    assert.equal(v.costUsd, total)
    const [job] = await trailerJobs(JUNE)
    assert.deepEqual([job.outcome, job.costUsd, job.reservation], ['done', total, 'settled'], 'the job settles at that estimate; its hold is not given back at $0')
    const c = await backend().counters(JUNE)
    assert.equal(c.userDayMicros, micros(total), 'the person’s day counts it')
    assert.equal(c.quota.videoSeconds, heldSeconds, 'and the seconds stay used')
    provider.reset()
    delete env.VIDEO_SHOT_TIMEOUT_MS
    ok(`two shots timed out, one gone (404), one refused key (401): each counted at the formula’s price, the job settled at $${total} and the seconds kept, not released at $0`)
  })

  // ==================================================================================================
  await section('6. Ownership — every video, file and animate route; the share', async () => {
    assert.ok(aliceVideo && aliceProject && alicePlan, 'alice’s finished trailer from section 3a')
    const video = aliceVideo as VideoRecord
    const project = aliceProject as Project
    const fingerprint = async () => JSON.stringify([await store.videos.get(video.id), (await store.shares.listActiveOf(ALICE)).length, await store.outputs.list(rec.videoKeys(ALICE, video.id).folder)])
    const before = await fingerprint()
    const calls0 = calls.length

    // Every route that names a video or animates a page, found on disk so a new one cannot be missed.
    async function routeFiles(at: string): Promise<string[]> {
      const found: string[] = []
      for (const entry of await readdir(at, { withFileTypes: true })) {
        const full = join(at, entry.name)
        if (entry.isDirectory()) found.push(...(await routeFiles(full)))
        else if (entry.name === 'route.ts') found.push(full)
      }
      return found
    }
    const paths = (await routeFiles(API)).map((f) => relative(API, dirname(f)).split(sep).join('/')).filter((p) => p.startsWith('videos/') || /^projects\/\[id\]\/(videos|pages\/\[n\]\/animate)$/.test(p)).sort()
    assert.deepEqual(paths, ['projects/[id]/pages/[n]/animate', 'projects/[id]/videos', 'videos/[videoId]', 'videos/[videoId]/file/[name]', 'videos/[videoId]/share'])
    const values: Record<string, string> = { id: project.id, n: '0', videoId: video.id, name: 'final.mp4' }
    let tried = 0
    for (const path of paths) {
      const mod = await routeOf(path)
      const params = Object.fromEntries([...path.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1], values[m[1]]]))
      const expected = path.startsWith('projects/') ? NO_SUCH_PROJECT : NO_SUCH_VIDEO
      for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
        const handler = mod[method]
        if (typeof handler !== 'function') continue
        const bob = await call(handler, method, params, BOB, method === 'GET' || method === 'HEAD' ? undefined : 'chunked')
        assert.equal(bob.status, 404, `${method} /api/${path} as bob: ${bob.text.slice(0, 120)}`)
        if (method !== 'HEAD') assert.equal(bob.json?.error, expected, `${method} /api/${path}: the missing thing’s own sentence`)
        assert.equal(bob.pulled, 0, `${method} /api/${path}: bob’s body is never read`)
        // Alice's id and one that never was are one answer.
        const unknown = await call(handler, method, { ...params, ...(params.videoId ? { videoId: randomUUID() } : {}), ...(params.id ? { id: randomUUID() } : {}) }, BOB, method === 'GET' || method === 'HEAD' ? undefined : 'chunked')
        assert.deepEqual([unknown.status, unknown.text], [bob.status, bob.text], `${method} /api/${path}: alice’s trailer reads exactly like one that never existed`)
        tried++
      }
    }
    assert.equal(calls.length, calls0, 'bob reached no provider')
    assert.equal(await fingerprint(), before, 'alice’s trailer, its share and its files are untouched')
    // Alice gets her own.
    const mine = await call(videoRoute.GET, 'GET', { videoId: video.id }, ALICE)
    assert.equal(mine.status, 200)
    assert.ok(!/ownerId|costUsd|Key"|providerJobId|videos\//.test(mine.text.replace(/"videoUrl":"[^"]*"|"posterUrl":"[^"]*"|"captionsUrl":"[^"]*"/g, '')), 'her view carries no key, cost, owner or provider id')
    const ranged = await call(videoFileRoute.GET, 'GET', { videoId: video.id, name: 'final.mp4' }, ALICE, undefined, { range: 'bytes=0-99' })
    assert.deepEqual([ranged.status, ranged.headers.get('content-type'), ranged.bytes.length], [206, 'video/mp4', 100], 'a ranged read of her film')
    assert.equal((await call(videoFileRoute.GET, 'GET', { videoId: video.id, name: '../../etc/passwd' }, ALICE)).status, 404, 'only the three names')
    const list = await call(projectVideosRoute.GET, 'GET', { id: project.id }, ALICE)
    assert.deepEqual(((list.json!.videos as { id: string }[]) ?? []).map((x) => x.id), [video.id])
    ok(`${paths.length} routes, ${tried} handlers: bob gets “${NO_SUCH_VIDEO}” / “${NO_SUCH_PROJECT}” word for word as for an id that never was, his body unread, no provider called, alice’s trailer untouched; alice reads her own (a 206 range)`)

    // The share: only the snapshot; revoked = unknown, byte for byte.
    const made = await call(videoShareRoute.POST, 'POST', { videoId: video.id }, ALICE)
    assert.equal(made.status, 200, made.text)
    const token = (made.json!.share as { token: string }).token
    // Settings › Sharing lists it with its poster, from the link's own file route (a video share names no cover).
    const row = ((await call(sharesRoute.GET, 'GET', {}, ALICE)).json!.shares as ShareView[]).find((x) => x.token === token)!
    assert.deepEqual([row.kind, row.cover], ['video', null])
    const thumb = renderToStaticMarkup(createElement(ShareThumb, { share: row }))
    assert.ok(thumb.includes(`<img src="${shareFileUrl(token, 'poster.jpg')}"`) && !thumb.includes('No poster'), `the trailer’s row shows its poster: ${thumb}`)
    assert.ok(renderToStaticMarkup(createElement(ShareThumb, { share: { kind: 'manga', token, cover: null } })).includes('No cover'), 'a manga with no cover says so')
    assert.equal((await call(videoShareRoute.DELETE, 'DELETE', { videoId: video.id }, BOB, 'chunked')).status, 404, 'bob cannot unpublish it')
    const pub = await call(publicShareRoute.GET, 'GET', { token }, null)
    assert.equal(pub.status, 200, pub.text)
    assert.deepEqual(Object.keys(pub.json!).sort(), ['hasCaptions', 'kind', 'seconds', 'takenAt', 'title'], 'the snapshot’s allow-list and nothing else')
    assert.deepEqual([pub.json!.kind, pub.json!.title, pub.json!.hasCaptions], ['video', 'The Lantern Keeper · Page 1', true])
    for (const secret of [ALICE, project.id, video.id, 'videos/', 'costUsd']) assert.ok(!pub.text.includes(secret), `the share does not carry ${secret}`)
    const film = await call(publicFileRoute.GET, 'GET', { token, name: 'final.mp4' }, null)
    const stored = await readFile(join(dir, 'alice', 'final.mp4'))
    assert.deepEqual([film.status, film.headers.get('content-type'), film.bytes.equals(stored)], [200, 'video/mp4', true], 'the shared film is the film')
    for (const name of ['poster.jpg', 'captions.vtt']) assert.equal((await call(publicFileRoute.GET, 'GET', { token, name }, null)).status, 200)
    assert.equal((await call(publicFileRoute.GET, 'GET', { token, name: 'shots/0.mp4' }, null)).status, 404, 'a shot is never public')
    // Unpublish: every public answer is the unknown token's.
    const off = await call(videoShareRoute.DELETE, 'DELETE', { videoId: video.id }, ALICE)
    assert.equal(off.status, 200)
    const never = Array.from(randomBytes(22), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('')
    const same = (r: Reply) => [r.status, r.text, r.headers.get('content-type'), r.headers.get('cache-control'), r.headers.get('x-content-type-options')]
    assert.deepEqual(same(await call(publicShareRoute.GET, 'GET', { token }, null)), same(await call(publicShareRoute.GET, 'GET', { token: never }, null)), 'the snapshot: revoked = never was')
    for (const name of ['final.mp4', 'poster.jpg', 'captions.vtt']) {
      for (const method of ['GET', 'HEAD']) {
        const dead = await call(publicFileRoute[method], method, { token, name }, null)
        const unknown = await call(publicFileRoute[method], method, { token: never, name }, null)
        assert.equal(dead.status, 404)
        assert.deepEqual(same(dead), same(unknown), `${method} ${name}: revoked = never was`)
      }
    }
    ok('a video share hands out {kind, title, seconds, hasCaptions, takenAt} and the three files only; bob cannot unpublish it; once revoked, the snapshot and every file answer byte for byte like a token that never existed')
  })
} finally {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

assert.deepEqual(strays, [], 'nothing left for another host')
if (failures > 0) {
  console.error(`\ncheck:video — ${failures} section${failures === 1 ? '' : 's'} failed`)
  process.exit(1)
}
console.log(`\ncheck:video — all sections passed (${calls.length} provider requests, all answered by the stub in this process)`)
process.exit(0)
