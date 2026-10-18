// Slice 21's SHARING check, from `devpost/prd.md > Sharing (v3)`, `devpost/spec.md
// > Sharing (v3)` and `devpost/checklist.md > Slices > 21`:
//
//   npx tsx scripts/share-check-sharing.mts
//
// On a scratch desk (INKDESK_DATA_DIR in a temp folder, sign-in in test mode —
// user_alice and user_bob —, the local store, every credential unset and `fetch`
// stubbed so nothing can leave) a manga is built with a SENTINEL planted in every
// place the allow-list must keep private: the project's title, the scenario, the
// pitch, the plan, the cast's looks and DNA, the camera and background notes, an
// older version of a panel, the character sheet, an upload, the cost, the owner
// and the project's id. Then:
//
//   1  snapshot     the allow-list is exactly the keys the spec names; complete
//                   pages only; the chapter's title, speaker names, static shot
//                   labels; control characters stripped, lengths capped; a
//                   project with nothing readable is refused with its sentence
//   2  owner API    create is idempotent (even 8 at once), the link is absolute
//                   (APP_URL, else the request origin), `stale` follows what a
//                   reader would see (not the project's clock), Update share
//                   retakes the snapshot, Unpublish is idempotent; bob gets 404
//                   on every one of alice's share routes with the body unread;
//                   signed-out is 401; a body is refused
//   3  public       the JSON route, the picture route, the page's props and HTML,
//                   the metadata and the preview image hold none of the sentinels
//                   — not even when the STORED record carries extra fields; only
//                   snapshot pictures are served; later edits do not change what
//                   a link shows until the owner updates it
//   4  revoke       the page, the JSON, the pictures and the preview are the same
//                   (status, body, headers) as for a token that never existed;
//                   the record drops its snapshot; a new share after a revoke has a
//                   NEW token and the old one stays dead
//   5  windows      the address windows apply to the JSON, the pictures, the
//                   preview and the page, per address
//   6  XSS          markup in the title, a line and a name renders as text
//   7  a video      a video share: the player on the page, the real files (with Range) of its own
//                   video only, the preview from the poster, and every dead link the same 404
//
// The cloud store cannot be exercised from here; this script is the local half.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'

const env = process.env as Record<string, string | undefined>
const execFileAsync = promisify(execFile)
const ok = (msg: string) => console.log(`  ok  ${msg}`)

if (env.INKDESK_STORAGE?.trim() === 'cloud') {
  console.log('  --  this check runs on the local store only: the cloud half needs a MongoDB and a bucket on this machine')
  process.exit(1)
}

// --- The environment ---------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'inkdesk-share-sharing-'))
env.INKDESK_DATA_DIR = dir
for (const name of [
  'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_JWT_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET', 'RAILWAY_TOKEN', 'REDIS_URL', 'GENERATION_ENABLED', 'INKDESK_QUEUE', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'ADMIN_EMAILS',
  'MONGODB_URI', 'DB_URL', 'MONGODB_DB', 'DB_DATABASE', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_BUCKET_PROJECT_FILES', 'S3_BUCKET_COMPILE_OUTPUTS',
  'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'TRUSTED_PROXY_HOPS', 'CLIENT_IP_HEADER',
]) delete env[name]
env.INKDESK_STORAGE = 'local'
env.INKDESK_AUTH = 'test'
env.INKDESK_QUEUE = 'inline'
// The windows are real (test mode has the limits on); the general ones are set high so only section 5 meets a line.
env.RATE_ANON_PER_MIN = '100000'
env.RATE_ANON_MEDIA_PER_MIN = '100000'
delete env.NODE_ENV

const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // The preview card's renderer loads its own wasm from a data: URL through fetch; that never leaves the process.
  if (url.startsWith('data:')) return realFetch(input, init)
  outbound.push(url.slice(0, 120))
  throw new Error('the sharing check never reaches a provider')
}) as typeof fetch

// A page is rendered here without Next: its stylesheet imports are empty, and the three request-scope functions it
// calls are stood in for (`headers()` reads whatever the check set; `connection()` has nothing to wait for).
const stubs = join(dir, '.stubs')
await import('node:fs/promises').then(async ({ mkdir }) => mkdir(stubs, { recursive: true }))
await writeFile(join(stubs, 'empty.cjs'), 'module.exports = {}')
await writeFile(join(stubs, 'headers.cjs'), 'module.exports = { headers: async () => globalThis.__shareCheckHeaders ?? new Headers() }')
await writeFile(join(stubs, 'server.cjs'), 'module.exports = { connection: async () => {} }')
const stubUrl = (name: string) => pathToFileURL(join(stubs, name)).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) return { url: stubUrl('empty.cjs'), format: 'commonjs', shortCircuit: true }
    if (specifier === 'next/headers') return { url: stubUrl('headers.cjs'), format: 'commonjs', shortCircuit: true }
    if (specifier === 'next/server') return { url: stubUrl('server.cjs'), format: 'commonjs', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const asRequest = (headers: Record<string, string>) => {
  ;(globalThis as unknown as { __shareCheckHeaders?: Headers }).__shareCheckHeaders = new Headers(headers)
}

// Imported after the env is set, because the store reads it at load.
const { renderToStaticMarkup } = await import('react-dom/server')
const { store } = await import('../lib/store')
const { NO_SUCH_PROJECT, NO_SUCH_SHARE } = await import('../lib/auth/access')
const { emptyProject } = await import('../lib/types')
const { buildMangaSnapshot, cleanText, NOTHING_READABLE, NothingReadable, publicManga, snapshotImageIds, snapshotsDiffer, SNAPSHOT_LIMITS } = await import('../lib/share/snapshot')
const { createVideoShare, newShareToken, NOT_SHARED, unpublishVideo } = await import('../lib/share/service')
const { newVideoRecord, markVideoDone, videoKeys } = await import('../lib/video/record')
const { planTrailer } = await import('../lib/video/plan')
const { Refused } = await import('../lib/errors')
const { isShareToken } = await import('../lib/share/url')
const { PANEL_LAYOUT } = await import('../lib/prompts')
const { landImage } = await import('../lib/images')
const { attachPanelVersion } = await import('../lib/script')
const { attachCoverVersion } = await import('../lib/plan')
import type { Panel, Project } from '../lib/types'
import type { MangaSnapshot, ShareRecord, ShareView } from '../lib/share/types'

const projectRoute = (await import('../app/api/projects/[id]/share/route')) as unknown as Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>
const listRoute = (await import('../app/api/shares/route')) as unknown as Record<'GET', Handler>
const byToken = (await import('../app/api/shares/[token]/route')) as unknown as Record<'DELETE', Handler>
const publicJson = (await import('../app/api/s/[token]/route')) as unknown as Record<'GET', Handler>
const publicImage = (await import('../app/api/s/[token]/image/[imageId]/route')) as unknown as Record<'GET', Handler>
const fileRoute = (await import('../app/api/s/[token]/file/[name]/route')) as unknown as Record<'GET' | 'HEAD', Handler>
const sharePage = (await import('../app/s/[token]/page')) as unknown as {
  default: (p: { params: Promise<{ token: string }> }) => Promise<import('react').ReactElement>
  generateMetadata: (p: { params: Promise<{ token: string }> }) => Promise<Record<string, unknown>>
}
const ownerImage = (await import('../app/api/projects/[id]/image/[imageId]/route')) as unknown as Record<'GET', Handler>
const preview = (await import('../app/s/[token]/opengraph-image')) as unknown as { default: (p: { params: Promise<{ token: string }> }) => Promise<Response> }

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const ALICE = 'user_alice'
const BOB = 'user_bob'
/** Planted in every place the allow-list must keep private. */
const SENTINEL = 'ZXQ-PRIVATE-7734'
const COST = 0.773412
const DNA = 'dna: silver scar over the left brow, ZXQ-DNA-9921'

// --- Calls -----------------------------------------------------------------------------
type Reply = { status: number; text: string; json: unknown; headers: [string, string][]; bytes: Buffer }

async function reply(res: Response): Promise<Reply> {
  const bytes = Buffer.from(await res.arrayBuffer())
  const text = bytes.toString('utf8')
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {}
  const headers = [...res.headers.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  return { status: res.status, text, json, headers, bytes }
}

/** A chunked body with no Content-Length, counting what was pulled (to prove a refusal never read it). */
function chunked() {
  const seen = { pulled: 0 }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (seen.pulled >= 64 * 1024) return c.close()
        const chunk = new TextEncoder().encode(seen.pulled === 0 ? '{"a":"' : 'a'.repeat(8 * 1024))
        seen.pulled += chunk.byteLength
        c.enqueue(chunk)
      },
    },
    { highWaterMark: 0 }
  )
  return { stream, seen }
}

async function owner(handler: Handler, method: string, params: Record<string, string>, who: string | null, opts: { body?: unknown; raw?: boolean; origin?: string; address?: string } = {}): Promise<Reply & { pulled: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (who) headers['x-inkdesk-test-user'] = who
  if (opts.address) headers['x-forwarded-for'] = opts.address
  const url = `${opts.origin ?? 'http://check'}/api`
  let req: Request
  let seen = { pulled: 0 }
  if (method === 'GET') req = new Request(url, { method, headers })
  else if (opts.raw) {
    const c = chunked()
    seen = c.seen
    req = new Request(url, { method, headers, body: c.stream, duplex: 'half' } as RequestInit)
  } else req = new Request(url, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) })
  return { ...(await reply(await handler(req, { params: Promise.resolve(params) }))), pulled: seen.pulled }
}

async function open(handler: Handler, params: Record<string, string>, address?: string): Promise<Reply> {
  const headers: Record<string, string> = address ? { 'x-forwarded-for': address } : {}
  return reply(await handler(new Request('http://check/api/s', { headers }), { params: Promise.resolve(params) }))
}

const shareOf = (r: Reply): ShareView | null => (r.json as { share: ShareView | null }).share

// --- A manga with everything private planted in it ------------------------------------------
const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#808080' } }).png().toBuffer()
const at = new Date().toISOString()

type Made = { project: Project; ids: { cover: string; panels: string[][]; older: string; sheet: string; asset: string; unfinished: string } }

const panel = (index: 0 | 1 | 2 | 3, characterId: string, versions: string[], dialogue: string, current = versions.length - 1): Panel => ({
  index,
  characterId,
  action: `${SENTINEL} acts`,
  camera: `${SENTINEL} camera looking down`,
  background: `${SENTINEL} background`,
  dialogue,
  bubble: index === 1 ? { x: 10, y: 12, w: 30, h: 20, tailX: 40, tailY: 50 } : null,
  versions: versions.map((imageId) => ({ imageId, createdAt: at })),
  currentVersion: Math.max(0, current),
  status: versions.length > 0 ? 'done' : 'empty',
  startedAt: null,
  startedByRun: SENTINEL,
})

async function makeManga(ownerId: string, opts: { style?: 'manga-bw' | 'manhwa-colour'; coverTitle?: string; names?: [string, string]; lines?: string[] } = {}): Promise<Made> {
  const id = crypto.randomUUID()
  const base = emptyProject({ id, chapterId: crypto.randomUUID(), title: `Working title ${SENTINEL}`, stylePresetId: opts.style ?? 'manga-bw', serverRunId: SENTINEL })
  await store.createProject({ ...base, ownerId })
  const img = (kind: 'sheet' | 'panel' | 'cover' | 'asset') => store.putBlob(png, 'image/png', kind)
  const ids = {
    cover: await img('cover'),
    panels: [await Promise.all([img('panel'), img('panel'), img('panel'), img('panel')]), await Promise.all([img('panel'), img('panel'), img('panel'), img('panel')])],
    older: await img('panel'),
    sheet: await img('sheet'),
    asset: await img('asset'),
    unfinished: await img('panel'),
  }
  const [nameA, nameB] = opts.names ?? ['Mika', 'Ren']
  const lines = opts.lines ?? ['The train is late.', 'It always is.', 'Not tonight.', 'Then we walk.', 'Page two opens.', 'Quiet, now.', 'Listen.', 'It begins.']
  const project = await store.updateProject(id, (p) => ({
    ...p,
    story: {
      mode: 'scenario',
      pitch: { text: `${SENTINEL} pitch`, genre: SENTINEL, tone: SENTINEL },
      synopsis: { title: `${SENTINEL} synopsis title`, body: `${SENTINEL} synopsis body`, accepted: true },
      scenario: { text: `${SENTINEL} scenario`, notes: `${SENTINEL} notes`, referenceAssetIds: [ids.asset], saved: true },
    },
    library: {
      characters: [
        { id: 'c1', name: nameA, role: `${SENTINEL} role`, traits: [SENTINEL], look: `${SENTINEL} look`, dna: DNA, sheetImageId: ids.sheet, locked: true },
        { id: 'c2', name: nameB, role: 'foil', traits: [], look: `${SENTINEL} look two`, dna: DNA, sheetImageId: null, locked: true },
      ],
      assets: [{ id: ids.asset, kind: 'reference', name: `${SENTINEL}.png`, blobId: ids.asset, mediaType: 'image/png', bytes: png.length, createdAt: at }],
    },
    usage: { images: 11, costUsd: COST },
    chapters: p.chapters.map((c) => ({
      ...c,
      plan: { pageCount: 3, coverBrief: `${SENTINEL} cover brief`, pages: [], source: 'scenario' as const, summarized: false, writtenAt: at },
      cover: { brief: `${SENTINEL} brief`, title: opts.coverTitle ?? 'The Last Train', versions: [{ imageId: ids.cover, createdAt: at }], currentVersion: 0, status: 'done' as const, startedAt: null, startedByRun: null },
      pages: [
        // Page 1: complete; panel 0 has an older version that must never be published (the current one is the second).
        { index: 0, layoutId: 'four-shot' as const, panels: [panel(0, 'c1', [ids.older, ids.panels[0][0]], lines[0]), panel(1, 'c2', [ids.panels[0][1]], lines[1]), panel(2, 'c1', [ids.panels[0][2]], lines[2]), panel(3, 'c2', [ids.panels[0][3]], lines[3])] },
        { index: 1, layoutId: 'four-shot' as const, panels: [panel(0, 'c1', [ids.panels[1][0]], lines[4]), panel(1, 'c2', [ids.panels[1][1]], lines[5]), panel(2, 'c1', [ids.panels[1][2]], lines[6]), panel(3, 'c2', [ids.panels[1][3]], lines[7])] },
        // Page 3: two panels inked, two not — it does not read yet.
        { index: 2, layoutId: 'four-shot' as const, panels: [panel(0, 'c1', [ids.unfinished], 'Unfinished one'), panel(1, 'c2', [ids.unfinished], 'Unfinished two'), panel(2, 'c1', [], ''), panel(3, 'c2', [], '')] },
      ],
    })),
  }))
  return { project, ids }
}

/** Every string a private field could be printed as. */
function forbidden(made: Made): string[] {
  const { project, ids } = made
  return [SENTINEL, 'ZXQ-DNA-9921', 'user_alice', project.id, String(COST), '0.7734', ids.older, ids.sheet, ids.asset, ids.unfinished, `${project.id}`]
}

function assertClean(label: string, text: string, made: Made, allowOwner = false) {
  for (const needle of forbidden(made)) {
    if (allowOwner && needle === 'user_alice') continue
    assert.ok(!text.includes(needle), `${label}: "${needle}" must not appear`)
  }
}

const ALLOWED = {
  snapshot: ['cover', 'kind', 'pages', 'reading', 'takenAt', 'title'],
  cover: ['imageId', 'title'],
  page: ['index', 'panels'],
  panel: ['bubble', 'dialogue', 'imageId', 'shot', 'speaker'],
  bubble: ['h', 'tailX', 'tailY', 'w', 'x', 'y'],
}
function assertAllowList(label: string, value: unknown) {
  const s = value as MangaSnapshot
  assert.deepEqual(Object.keys(s).sort(), ALLOWED.snapshot, `${label}: the snapshot's keys are the allow-list`)
  if (s.cover) assert.deepEqual(Object.keys(s.cover).sort(), ALLOWED.cover, `${label}: cover`)
  for (const page of s.pages) {
    assert.deepEqual(Object.keys(page).sort(), ALLOWED.page, `${label}: page`)
    assert.equal(page.panels.length, 4)
    for (const p of page.panels) {
      assert.deepEqual(Object.keys(p).sort(), ALLOWED.panel, `${label}: panel`)
      if (p.bubble) assert.deepEqual(Object.keys(p.bubble).sort(), ALLOWED.bubble, `${label}: bubble`)
    }
  }
}

try {
  // =====================================================================================
  // 1. The snapshot
  // =====================================================================================
  const alice = await makeManga(ALICE)
  {
    const snap = buildMangaSnapshot(alice.project, '2026-01-02T03:04:05.000Z')
    assertAllowList('built snapshot', snap)
    assert.equal(snap.kind, 'manga')
    assert.equal(snap.title, 'The Last Train', 'the chapter title the reader uses (the lettered cover title), not the project title')
    assert.equal(snap.reading, 'rtl', 'a manga preset opens right to left')
    assert.equal(snap.takenAt, '2026-01-02T03:04:05.000Z')
    assert.deepEqual(snap.cover, { imageId: alice.ids.cover, title: 'The Last Train' })
    assert.deepEqual(snap.pages.map((p) => p.index), [0, 1], 'complete pages only — the page with two inked panels is left out')
    const first = snap.pages[0].panels
    assert.equal(first[0].imageId, alice.ids.panels[0][0], 'the CURRENT version of a panel, not the older one')
    assert.deepEqual(first.map((p) => p.speaker), ['Mika', 'Ren', 'Mika', 'Ren'], 'the speaker is the character’s name')
    assert.deepEqual(first.map((p) => p.shot), PANEL_LAYOUT.map((s) => s.shot), 'the shot is the static slot label')
    assert.deepEqual(first.map((p) => p.dialogue), ['The train is late.', 'It always is.', 'Not tonight.', 'Then we walk.'])
    assert.deepEqual(first[1].bubble, { x: 10, y: 12, w: 30, h: 20, tailX: 40, tailY: 50 }, 'a placed bubble is kept')
    assert.ok(first[0].bubble && first[0].bubble.w > 0, 'an unplaced one is resolved to the layout the reader would draw')
    assertClean('the snapshot JSON', JSON.stringify(snap), alice)
    assert.deepEqual([...snapshotImageIds(snap)].sort(), [alice.ids.cover, ...alice.ids.panels.flat()].sort(), 'the only pictures a snapshot publishes')
    assert.equal(snapshotsDiffer(snap, { ...snap, takenAt: 'later' }), false, 'the time it was taken is not a change')
    assert.equal(snapshotsDiffer(snap, { ...snap, title: 'Other' }), true)

    // A manhwa reads as one scroll.
    const manhwa = buildMangaSnapshot((await makeManga(ALICE, { style: 'manhwa-colour' })).project, at)
    assert.equal(manhwa.reading, 'vertical')

    // Control characters and lengths.
    assert.equal(cleanText('Hello\u0000\u0007 ‮world\nsecond\tline x', 100), 'Hello world second line x')
    assert.equal(cleanText('   ', 10), '')
    assert.equal(cleanText(42 as unknown as string, 10), '')
    assert.equal(cleanText('a'.repeat(900), SNAPSHOT_LIMITS.dialogue).length, SNAPSHOT_LIMITS.dialogue)
    assert.equal(Array.from(cleanText('😀'.repeat(50), 7)).length, 7, 'capped by code point — an emoji is never cut in half')
    assert.equal(cleanText('\ud800 lone surrogate', 50).includes('\ud800'), false, 'a lone surrogate is made well-formed')
    const messy = await makeManga(ALICE, { coverTitle: `${'X'.repeat(400)}\u0000`, names: ['M\u0000ika\n', 'R'.repeat(200)], lines: ['\u0007Hi\u0000 there\nfriend', 'b'.repeat(900), '', '', '', '', '', ''] })
    const m = buildMangaSnapshot(messy.project, at)
    assert.equal(m.title.length, SNAPSHOT_LIMITS.title)
    assert.equal(m.cover?.title.length, SNAPSHOT_LIMITS.coverTitle)
    assert.equal(m.pages[0].panels[0].speaker, 'Mika')
    assert.equal(m.pages[0].panels[1].speaker?.length, SNAPSHOT_LIMITS.speaker)
    assert.equal(m.pages[0].panels[0].dialogue, 'Hi there friend')
    assert.equal(m.pages[0].panels[1].dialogue.length, SNAPSHOT_LIMITS.dialogue)

    // A cover that is not drawn is no cover; a project with nothing readable is refused.
    const noCover: Project = { ...alice.project, chapters: alice.project.chapters.map((c) => ({ ...c, cover: c.cover && { ...c.cover, versions: [], status: 'empty' as const } })) }
    const withoutCover = buildMangaSnapshot(noCover, at)
    assert.equal(withoutCover.cover, null)
    assert.equal(withoutCover.pages.length, 2)
    const empty = emptyProject({ id: crypto.randomUUID(), chapterId: 'c', title: 'Nothing', stylePresetId: 'manga-bw', serverRunId: 'x' })
    assert.throws(() => buildMangaSnapshot(empty, at), (e: unknown) => e instanceof NothingReadable && e.status === 409 && e.message === NOTHING_READABLE)
    const onlyUnfinished = { ...noCover, chapters: noCover.chapters.map((c) => ({ ...c, pages: c.pages.slice(2) })) }
    assert.throws(() => buildMangaSnapshot(onlyUnfinished, at), NothingReadable, 'an unfinished page alone is nothing to share')
    // A picture id that is not the shape the store makes is not published.
    const hostile = { ...alice.project, chapters: alice.project.chapters.map((c) => ({ ...c, pages: c.pages.map((pg, i) => (i === 0 ? { ...pg, panels: pg.panels.map((pn, j) => (j === 0 ? { ...pn, versions: [{ imageId: '../../etc/passwd', createdAt: at }], currentVersion: 0 } : pn)) } : pg)) })) }
    assert.deepEqual(buildMangaSnapshot(hostile, at).pages.map((p) => p.index), [1], 'a page with an unusable picture id does not read')
    // publicManga re-picks whatever a store hands back.
    const dirty = { ...snap, secret: SENTINEL, pages: snap.pages.map((pg) => ({ ...pg, projectId: alice.project.id, panels: pg.panels.map((pn) => ({ ...pn, action: SENTINEL, shot: SENTINEL })) })), cover: snap.cover && { ...snap.cover, dna: DNA } }
    const repicked = publicManga(dirty)
    assert.ok(repicked)
    assertAllowList('publicManga', repicked)
    assertClean('publicManga', JSON.stringify(repicked), alice)
    assert.deepEqual(repicked.pages[0].panels.map((p) => p.shot), PANEL_LAYOUT.map((s) => s.shot), 'a shot label is always the slot’s own')
    assert.equal(publicManga({ kind: 'video' }), null)
    assert.equal(publicManga(null), null)
    assert.equal(publicManga({ ...snap, pages: [{ index: 0, panels: [snap.pages[0].panels[0]] }] })?.pages.length, 0, 'a page that does not hold four panels is dropped')
    ok('snapshot: exactly the allow-list; the chapter’s lettered title; current versions only; complete pages only; names and static shot labels; control characters stripped, lengths capped by code point; nothing readable → 409 with its sentence; publicManga re-picks whatever the store returns')

    // Tokens.
    const tokens = new Set(Array.from({ length: 500 }, () => newShareToken()))
    assert.equal(tokens.size, 500, '500 tokens, no repeat')
    for (const t of tokens) assert.match(t, /^[0-9A-Za-z]{22}$/)
    assert.ok(isShareToken([...tokens][0]))
    for (const bad of ['', 'short', '../../etc/passwd', 'a'.repeat(65), 'a b c d e f g h', '日本語日本語日本語日本語', 42, null, undefined]) assert.equal(isShareToken(bad), false, `${String(bad)} is not a token`)
    ok('tokens: 128 random bits in base62 (22 characters), 500 distinct; the shape check refuses paths, spaces, non-ASCII and anything too short or long')
  }

  // =====================================================================================
  // 2. The owner's API
  // =====================================================================================
  const A = alice.project.id
  const bobs = await makeManga(BOB)
  let token = ''
  {
    // Signed out: 401, body unread.
    for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
      const r = await owner(projectRoute[method], method, { id: A }, null, { raw: true })
      assert.equal(r.status, 401, `${method} signed out`)
      assert.equal(r.pulled, 0)
    }
    assert.equal((await owner(listRoute.GET, 'GET', {}, null)).status, 401)
    assert.equal((await owner(byToken.DELETE, 'DELETE', { token: 'x'.repeat(22) }, null, { raw: true })).status, 401)

    // Nothing shared yet.
    let r = await owner(projectRoute.GET, 'GET', { id: A }, ALICE)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { share: null })
    assert.ok(r.headers.some(([k, v]) => k === 'cache-control' && v === 'no-store'), 'a reply that carries a token is never cached')
    r = await owner(projectRoute.PUT, 'PUT', { id: A }, ALICE)
    assert.equal(r.status, 409)
    assert.equal((r.json as { error: string }).error, NOT_SHARED, 'nothing to update yet — with a way forward in the sentence')

    // A project with nothing readable cannot be shared.
    const blank = emptyProject({ id: crypto.randomUUID(), chapterId: 'c', title: 'Blank', stylePresetId: 'manga-bw', serverRunId: 'x' })
    await store.createProject({ ...blank, ownerId: ALICE })
    r = await owner(projectRoute.POST, 'POST', { id: blank.id }, ALICE)
    assert.equal(r.status, 409)
    assert.equal((r.json as { error: string }).error, NOTHING_READABLE)
    assert.equal(await store.shares.activeForProject(blank.id), null, 'and no record was made')

    // Share publicly: a view, never the snapshot.
    r = await owner(projectRoute.POST, 'POST', { id: A }, ALICE, { body: {} })
    assert.equal(r.status, 200, r.text)
    const view = shareOf(r) as ShareView
    token = view.token
    assert.match(token, /^[0-9A-Za-z]{22}$/)
    assert.deepEqual(Object.keys(view).sort(), ['cover', 'createdAt', 'kind', 'pages', 'path', 'projectId', 'stale', 'title', 'token', 'updatedAt', 'url'])
    assert.equal(view.url, `http://check/s/${token}`, 'without APP_URL the link is built on the request’s origin')
    assert.equal(view.path, `/s/${token}`)
    assert.deepEqual([view.kind, view.title, view.pages, view.cover, view.projectId, view.stale], ['manga', 'The Last Train', 2, alice.ids.cover, A, false])
    assert.ok(!r.text.includes('"snapshot"') && !r.text.includes('Mika'), 'the owner’s view holds no snapshot')
    const record = (await store.shares.get(token)) as ShareRecord
    assert.deepEqual([record.ownerId, record.kind, record.projectId, record.videoId, record.revokedAt], [ALICE, 'manga', A, null, null])
    assert.equal(record.snapshot?.kind, 'manga')

    // Idempotent — one at a time, and eight at once.
    r = await owner(projectRoute.POST, 'POST', { id: A }, ALICE)
    assert.equal(shareOf(r)?.token, token, 'the second Share publicly is the same share')
    const fresh = await makeManga(ALICE)
    const burst = await Promise.all(Array.from({ length: 8 }, () => owner(projectRoute.POST, 'POST', { id: fresh.project.id }, ALICE)))
    assert.deepEqual(new Set(burst.map((b) => shareOf(b)?.token)).size, 1, 'eight at once → one token')
    assert.equal((await store.shares.listActiveOf(ALICE)).filter((s) => s.projectId === fresh.project.id).length, 1)

    // The link is APP_URL's when it is set.
    env.APP_URL = 'https://ink.example'
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: A }, ALICE))?.url, `https://ink.example/s/${token}`)
    delete env.APP_URL

    // GET and the list.
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: A }, ALICE))?.token, token)
    const list = (await owner(listRoute.GET, 'GET', {}, ALICE)).json as { shares: ShareView[] }
    assert.ok(list.shares.some((s) => s.token === token) && list.shares.some((s) => s.projectId === fresh.project.id))
    assert.ok(list.shares.every((s) => !('snapshot' in s)))

    // stale follows what a reader would see.
    await store.updateProject(A, (p) => ({ ...p, station: 'reader', openPage: 1 })) // the project's clock moves; nothing visible changed
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: A }, ALICE))?.stale, false, 'walking between stations is not a change')
    await store.updateProject(A, (p) => ({ ...p, chapters: p.chapters.map((c) => ({ ...c, pages: c.pages.map((pg, i) => (i === 0 ? { ...pg, panels: pg.panels.map((pn, j) => (j === 1 ? { ...pn, dialogue: 'A new line, after sharing.' } : pn)) } : pg)) })) }))
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: A }, ALICE))?.stale, true, 'a changed line is')
    assert.equal(((await owner(listRoute.GET, 'GET', {}, ALICE)).json as { shares: ShareView[] }).shares.find((s) => s.token === token)?.stale, true, 'and the Settings list says so too')

    // …and the link still shows the OLD line (checked in section 3); Update share retakes it.
    const before = (await store.shares.get(token)) as ShareRecord
    r = await owner(projectRoute.PUT, 'PUT', { id: A }, ALICE, { body: {} })
    assert.equal(r.status, 200, r.text)
    assert.equal(shareOf(r)?.token, token, 'the same address')
    assert.equal(shareOf(r)?.stale, false)
    const after = (await store.shares.get(token)) as ShareRecord
    assert.equal((after.snapshot as MangaSnapshot).pages[0].panels[1].dialogue, 'A new line, after sharing.')
    assert.equal((before.snapshot as MangaSnapshot).pages[0].panels[1].dialogue, 'It always is.')
    assert.equal(after.createdAt, before.createdAt)
    assert.ok(after.updatedAt >= before.updatedAt)
    // A project whose readable content is gone is stale (and cannot be updated: nothing to publish).
    await store.updateProject(fresh.project.id, (p) => ({ ...p, chapters: p.chapters.map((c) => ({ ...c, cover: null, pages: [] })) }))
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: fresh.project.id }, ALICE))?.stale, true)
    assert.equal((await owner(projectRoute.PUT, 'PUT', { id: fresh.project.id }, ALICE)).status, 409)

    // Bodies: only nothing, or {}.
    for (const body of [{ x: 1 }, [], 'text', 42]) {
      const bad = await owner(projectRoute.POST, 'POST', { id: A }, ALICE, { body })
      assert.equal(bad.status, 400, JSON.stringify(body))
    }
    ok('owner API: 401 signed out (body unread); nothing-readable and nothing-to-update are 409 with a sentence; Share publicly returns a view with no snapshot; idempotent (8 at once → 1 share); the link is APP_URL’s or the request’s origin; stale tracks what a reader would see, not the clock; Update share retakes the snapshot under the same address; stray bodies are refused')
  }

  // bob on alice's everything
  {
    const mine = JSON.stringify(await store.shares.get(token))
    const missingProject = (r: Reply & { pulled: number }, label: string) => {
      assert.equal(r.status, 404, `${label}: ${r.text}`)
      assert.equal((r.json as { error: string }).error, NO_SUCH_PROJECT, `${label}: the missing project’s sentence`)
      assert.equal(r.pulled, 0, `${label}: the body is not read`)
    }
    for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) missingProject(await owner(projectRoute[method], method, { id: A }, BOB, { raw: true }), `bob ${method} alice’s project`)
    assert.deepEqual(((await owner(listRoute.GET, 'GET', {}, BOB)).json as { shares: unknown[] }).shares, [], 'bob’s list holds none of alice’s')
    for (const t of [token, newShareToken(), 'nope']) {
      const r = await owner(byToken.DELETE, 'DELETE', { token: t }, BOB, { raw: true })
      assert.equal(r.status, 404)
      assert.equal((r.json as { error: string }).error, NO_SUCH_SHARE, 'alice’s, unknown and malformed tokens are all “There is no such share.”')
      assert.equal(r.pulled, 0)
    }
    assert.equal(JSON.stringify(await store.shares.get(token)), mine, 'alice’s share is untouched')
    // bob has his own.
    const b = await owner(projectRoute.POST, 'POST', { id: bobs.project.id }, BOB)
    assert.equal(b.status, 200)
    assert.notEqual(shareOf(b)?.token, token)
    assert.deepEqual(((await owner(listRoute.GET, 'GET', {}, ALICE)).json as { shares: ShareView[] }).shares.map((s) => s.token).includes(shareOf(b)?.token as string), false, 'and alice cannot see it')
    ok('owner-only: bob gets the missing project’s 404 on all four project routes and “There is no such share.” on DELETE /api/shares/<token>, body unread, alice’s share untouched; the lists are per owner')
  }

  // a project claimed after it was shared on a desk with no accounts: the link belongs to 'local', the project to alice
  {
    const claimed = await makeManga(ALICE)
    const P = claimed.project.id
    const old = (await store.shares.create({
      token: newShareToken(),
      ownerId: 'local',
      kind: 'manga',
      projectId: P,
      videoId: null,
      snapshot: buildMangaSnapshot(claimed.project, at),
      createdAt: at,
      updatedAt: at,
      revokedAt: null,
    })).share
    assert.equal((await open(publicJson.GET, { token: old.token })).status, 200, 'the old link is live')
    const frozen = JSON.stringify(await store.shares.get(old.token))
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: P }, ALICE)), null, 'the new owner is not shown a link that is not theirs')
    // Update share is not for a link an earlier owner made: nothing is retaken, nothing is revealed.
    const put = await owner(projectRoute.PUT, 'PUT', { id: P }, ALICE)
    assert.equal(put.status, 409)
    assert.equal((put.json as { error: string }).error, NOT_SHARED)
    assert.equal(JSON.stringify(await store.shares.get(old.token)), frozen, 'Update share left the earlier owner’s share as it was')
    // Share publicly takes the old link down and mints one of the new owner's own: the account never shows a live link it cannot unpublish.
    const posted = shareOf(await owner(projectRoute.POST, 'POST', { id: P }, ALICE))
    assert.ok(posted, 'the new owner has a share')
    assert.notEqual(posted.token, old.token, 'a new address, not the earlier owner’s')
    assert.equal((await store.shares.get(posted.token))?.ownerId, ALICE)
    assert.ok((await store.shares.get(old.token))?.revokedAt, 'the earlier owner’s share is revoked')
    assert.equal((await open(publicJson.GET, { token: old.token })).status, 404, 'its address answers the unknown 404 now')
    assert.equal((await open(publicJson.GET, { token: posted.token })).status, 200)
    assert.equal((await store.shares.activeForProject(P))?.token, posted.token, 'exactly one active share on the project')
    assert.deepEqual(((await owner(listRoute.GET, 'GET', {}, ALICE)).json as { shares: ShareView[] }).shares.filter((x) => x.token === old.token), [], 'and the old one is in no list')

    // Unpublish by the new owner also takes down an earlier owner's link left on the project (the route proved the project is theirs).
    const second = await makeManga(ALICE)
    const left = (await store.shares.create({
      token: newShareToken(),
      ownerId: 'local',
      kind: 'manga',
      projectId: second.project.id,
      videoId: null,
      snapshot: buildMangaSnapshot(second.project, at),
      createdAt: at,
      updatedAt: at,
      revokedAt: null,
    })).share
    const del = await owner(projectRoute.DELETE, 'DELETE', { id: second.project.id }, ALICE)
    assert.equal(del.status, 200)
    assert.equal(await store.shares.activeForProject(second.project.id), null, 'Unpublish leaves no live link on the project')
    assert.equal((await open(publicJson.GET, { token: left.token })).status, 404)
    ok('claimed project: the earlier owner’s link is not shown to, nor updated by, the new owner; Share publicly revokes it and mints their own (old address 404, one active share); Unpublish leaves no live link')
  }

  // =====================================================================================
  // 3. The public surface
  // =====================================================================================
  const unknown = newShareToken()
  {
    const live = await open(publicJson.GET, { token })
    assert.equal(live.status, 200)
    const snap = live.json as MangaSnapshot
    assertAllowList('public JSON', snap)
    assertClean('the public JSON', live.text, alice)
    assert.ok(!live.text.includes(token), 'the token is not echoed')
    assert.equal(snap.title, 'The Last Train')
    assert.equal(snap.pages.length, 2)
    assert.ok(live.headers.some(([k, v]) => k === 'cache-control' && v === 'no-store'))
    assert.ok(live.headers.some(([k, v]) => k === 'x-content-type-options' && v === 'nosniff'))

    // The page's props and HTML, rendered for real: the serialized props are the whole of what a client component is given.
    asRequest({})
    const element = await sharePage.default({ params: Promise.resolve({ token }) })
    const props = (element as { props: Record<string, unknown> }).props
    assert.deepEqual(Object.keys(props).sort(), ['cover', 'pages', 'reading', 'title', 'token'], 'the reader is given the snapshot’s fields and the token — nothing else')
    assertClean('the reader’s props', JSON.stringify(props), alice)
    const html = renderToStaticMarkup(element)
    assertClean('the rendered page', html, alice)
    assert.ok(html.includes('Made with Ink Desk') && html.includes('The Last Train'))
    assert.ok(!/Export (PNG|PDF)/.test(html), 'no export buttons')
    assert.ok(html.includes('Replay the ink-in') && html.includes('Right to left'))
    assert.ok(html.includes(`/api/s/${token}/image/${alice.ids.cover}`), 'pictures come from the share’s own route')
    assert.ok(!html.includes('/api/projects/'), 'never the owner’s image route')
    assert.ok(!/signed|bucket|amazonaws|X-Amz/i.test(html), 'no bucket key or signed URL')
    assert.ok(html.includes('Report'), 'the Report button is there')

    // A vertical share renders every page into the HTML: walk all of it too.
    const scroll = await makeManga(ALICE, { style: 'manhwa-colour' })
    const scrollToken = shareOf(await owner(projectRoute.POST, 'POST', { id: scroll.project.id }, ALICE))?.token as string
    const scrollHtml = renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token: scrollToken }) }))
    for (const line of ['The train is late.', 'Page two opens.', 'Mika, wide establishing shot', 'Page 2']) assert.ok(scrollHtml.toUpperCase().includes(line.toUpperCase()) || scrollHtml.includes(line), `the scroll holds "${line}"`)
    assert.ok(scrollHtml.includes('one vertical scroll') && !scrollHtml.includes('Left to right'), 'a manhwa share is one vertical scroll')
    assertClean('the rendered scroll', scrollHtml, scroll)
    assert.ok(!scrollHtml.includes('Unfinished'), 'and the unfinished page is not in it')

    // The metadata.
    const meta = (await sharePage.generateMetadata({ params: Promise.resolve({ token }) })) as { title: string; robots: Record<string, boolean>; openGraph: { title: string; url: string }; twitter: { card: string }; metadataBase: URL }
    assert.equal(meta.title, 'The Last Train')
    assert.deepEqual(meta.robots, { index: false, follow: false })
    assert.equal(meta.openGraph.title, 'The Last Train')
    assert.equal(meta.openGraph.url, `/s/${token}`)
    assert.equal(meta.twitter.card, 'summary_large_image')
    assert.equal(meta.metadataBase.origin, 'http://localhost:3000')
    assertClean('the metadata', JSON.stringify(meta), alice)

    // Pictures: exactly the snapshot's, and the same 404 for everything else.
    const ids = [...snapshotImageIds(snap)]
    assert.equal(ids.length, 9)
    for (const id of ids) {
      const img = await open(publicImage.GET, { token, imageId: id })
      assert.equal(img.status, 200, id)
      assert.ok(img.bytes.equals(png), 'the picture’s own bytes')
      const h = Object.fromEntries(img.headers)
      assert.equal(h['cache-control'], 'no-store')
      assert.equal(h['x-content-type-options'], 'nosniff')
      assert.equal(h['content-type'], 'image/png')
    }
    const gone = await open(publicImage.GET, { token: unknown, imageId: ids[0] })
    assert.equal(gone.status, 404)
    const notThere = [alice.ids.older, alice.ids.sheet, alice.ids.asset, alice.ids.unfinished, bobs.ids.cover, 'panel-00000000-0000-0000-0000-000000000000.png', '../../etc/passwd', '..%2f..%2fetc%2fpasswd', 'x.svg', '', 'a'.repeat(300)]
    for (const id of notThere) {
      const r = await open(publicImage.GET, { token, imageId: id })
      assert.deepEqual([r.status, r.text, r.headers], [gone.status, gone.text, gone.headers], `${id.slice(0, 30)}: a picture outside the snapshot is the unknown token’s 404, header for header`)
    }
    // Another share's picture is not served under this token.
    const bobToken = shareOf(await owner(projectRoute.GET, 'GET', { id: bobs.project.id }, BOB))?.token as string
    assert.equal((await open(publicImage.GET, { token: bobToken, imageId: alice.ids.cover })).status, 404)
    assert.equal((await open(publicImage.GET, { token, imageId: bobs.ids.cover })).status, 404)
    assert.equal((await open(publicImage.GET, { token: bobToken, imageId: bobs.ids.cover })).status, 200)

    // Later edits do not change what the link shows (section 2 changed a line after sharing; Update share has since retaken it).
    // Take another edit now, without updating.
    await store.updateProject(A, (p) => ({ ...p, chapters: p.chapters.map((c) => ({ ...c, cover: c.cover && { ...c.cover, title: 'A Different Title' }, pages: c.pages.map((pg, i) => (i === 0 ? { ...pg, panels: pg.panels.map((pn, j) => (j === 2 ? { ...pn, dialogue: 'Edited after the snapshot.' } : pn)) } : pg)) })) }))
    const later = (await open(publicJson.GET, { token })).json as MangaSnapshot
    assert.equal(later.title, 'The Last Train')
    assert.equal(later.pages[0].panels[2].dialogue, 'Not tonight.', 'the project changed; the link did not')
    const laterHtml = renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token }) }))
    assert.ok(!laterHtml.includes('Edited after the snapshot') && !laterHtml.includes('A Different Title'))
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: A }, ALICE))?.stale, true)
    await owner(projectRoute.PUT, 'PUT', { id: A }, ALICE)
    const updated = (await open(publicJson.GET, { token })).json as MangaSnapshot
    assert.equal(updated.title, 'A Different Title')
    assert.equal(updated.pages[0].panels[2].dialogue, 'Edited after the snapshot.', 'until the owner updates the share')

    // Even a stored record that carries more than the allow-list hands out only the allow-list.
    const stored = (await store.shares.get(token)) as ShareRecord
    const planted = { ...(stored.snapshot as MangaSnapshot), secret: SENTINEL, ownerId: ALICE, projectId: A, cost: COST, plan: { coverBrief: SENTINEL } } as unknown as MangaSnapshot
    planted.pages = planted.pages.map((pg) => ({ ...pg, panels: pg.panels.map((pn) => ({ ...pn, action: SENTINEL, dna: DNA, shot: SENTINEL })) })) as MangaSnapshot['pages']
    await store.shares.refresh(token, planted, new Date().toISOString())
    const dirtyJson = await open(publicJson.GET, { token })
    assertAllowList('JSON of a dirty record', dirtyJson.json)
    assertClean('JSON of a dirty record', dirtyJson.text, alice)
    const dirtyEl = await sharePage.default({ params: Promise.resolve({ token }) })
    assertClean('props of a dirty record', JSON.stringify((dirtyEl as { props: unknown }).props), alice)
    assertClean('page of a dirty record', renderToStaticMarkup(dirtyEl), alice)
    assertClean('metadata of a dirty record', JSON.stringify(await sharePage.generateMetadata({ params: Promise.resolve({ token }) })), alice)
    await owner(projectRoute.PUT, 'PUT', { id: A }, ALICE) // back to a clean snapshot
    ok('public: the JSON, the page’s props and HTML and the metadata hold none of the sentinel, DNA, pitch, plan, owner, project id, project title, cost, other versions, sheet, uploads — also when the STORED record is dirty; only the snapshot’s 9 pictures are served (bytes, no-store, nosniff) and every other id is the unknown token’s 404; a later edit does not change the link until Update share')

    // The preview image.
    asRequest({})
    const og = await preview.default({ params: Promise.resolve({ token }) })
    assert.equal(og.status, 200)
    const ogBytes = Buffer.from(await og.arrayBuffer())
    const ogMeta = await sharp(ogBytes).metadata()
    assert.deepEqual([ogMeta.format, ogMeta.width, ogMeta.height], ['png', 1200, 630], 'the cover, cropped to the card')
    assert.equal(og.headers.get('cache-control'), 'no-store')
    const noCover = await makeManga(ALICE)
    await store.updateProject(noCover.project.id, (p) => ({ ...p, chapters: p.chapters.map((c) => ({ ...c, cover: null })) }))
    const t2 = shareOf(await owner(projectRoute.POST, 'POST', { id: noCover.project.id }, ALICE))?.token as string
    const card = await preview.default({ params: Promise.resolve({ token: t2 }) })
    assert.equal(card.status, 200)
    const cardMeta = await sharp(Buffer.from(await card.arrayBuffer())).metadata()
    assert.deepEqual([cardMeta.format, cardMeta.width, cardMeta.height], ['png', 1200, 630], 'no cover → a paper card with the title')
    ok('preview image: the cover cropped to 1200x630 with sharp, a paper card of 1200x630 when there is no cover; never cached')
  }

  // =====================================================================================
  // 4. Revoke
  // =====================================================================================
  {
    const everything = async (t: string, id: string) => {
      asRequest({})
      const json = await open(publicJson.GET, { token: t })
      const img = await open(publicImage.GET, { token: t, imageId: id })
      const og = await preview.default({ params: Promise.resolve({ token: t }) })
      const ogReply = await reply(og)
      let pageOutcome = 'rendered'
      try {
        await sharePage.default({ params: Promise.resolve({ token: t }) })
      } catch (e) {
        pageOutcome = String((e as { digest?: string }).digest ?? e)
      }
      const meta = JSON.stringify(await sharePage.generateMetadata({ params: Promise.resolve({ token: t }) }))
      return { json, img, og: ogReply, pageOutcome, meta }
    }
    const oldIds = [...snapshotImageIds((await store.shares.get(token))!.snapshot as MangaSnapshot)]
    const live = await everything(token, oldIds[0])
    assert.equal(live.json.status, 200)
    assert.equal(live.pageOutcome, 'rendered')

    const r = await owner(byToken.DELETE, 'DELETE', { token }, ALICE, { body: {} })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { share: null })
    const dead = await everything(token, oldIds[0])
    const never = await everything(unknown, oldIds[0])
    for (const key of ['json', 'img', 'og'] as const) {
      assert.equal(dead[key].status, 404, key)
      assert.deepEqual([dead[key].status, dead[key].text, dead[key].headers], [never[key].status, never[key].text, never[key].headers], `${key}: a revoked share answers exactly like a token that never existed (status, body, headers)`)
    }
    assert.match(dead.pageOutcome, /NEXT_HTTP_ERROR_FALLBACK;404/, 'the page is notFound()')
    assert.equal(dead.pageOutcome, never.pageOutcome)
    assert.equal(dead.meta.replace(token, 'T'), never.meta.replace(unknown, 'T'), 'and so is its metadata')
    for (const id of oldIds) assert.equal((await open(publicImage.GET, { token, imageId: id })).status, 404, 'no picture of it is served')
    const malformed = await open(publicJson.GET, { token: 'x' })
    assert.deepEqual([malformed.status, malformed.text, malformed.headers], [never.json.status, never.json.text, never.json.headers], 'a malformed token is the same 404 too')

    // The record keeps no work.
    const file = JSON.parse(await readFile(join(dir, 'shares', `${token}.json`), 'utf8')) as ShareRecord
    assert.equal(file.snapshot, null)
    assert.ok(file.revokedAt)
    const raw = JSON.stringify(file)
    for (const needle of ['The Last Train', 'Mika', 'A Different Title', ...oldIds]) assert.ok(!raw.includes(needle), `the revoked record holds no "${needle}"`)
    assert.equal(await store.shares.activeForProject(A), null)
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: A }, ALICE)), null)
    assert.ok(!((await owner(listRoute.GET, 'GET', {}, ALICE)).json as { shares: ShareView[] }).shares.some((s) => s.token === token))

    // Unpublish is idempotent, from either door; the owner’s operations on a dead share say it is gone.
    assert.equal((await owner(byToken.DELETE, 'DELETE', { token }, ALICE)).status, 200, 'unpublish twice is not an error')
    assert.equal((await owner(projectRoute.DELETE, 'DELETE', { id: A }, ALICE)).status, 200)
    assert.equal((await owner(byToken.DELETE, 'DELETE', { token }, BOB)).status, 404, 'and still not bob’s')

    // A new share after a revoke has a NEW token; the old one stays dead.
    const again = await owner(projectRoute.POST, 'POST', { id: A }, ALICE)
    const second = shareOf(again)
    assert.equal(again.status, 200)
    assert.ok(second && second.token !== token, 'a new address')
    assert.equal((await open(publicJson.GET, { token })).status, 404, 'the old one is dead for good')
    assert.equal((await open(publicJson.GET, { token: second.token })).status, 200)
    assert.equal((await owner(projectRoute.PUT, 'PUT', { id: A }, ALICE)).status, 200)
    assert.equal(await store.shares.refresh(token, (await store.shares.get(second.token))!.snapshot!, at), null, 'a revoked token is never refreshed back to life')
    token = second.token

    // A link left by an EARLIER owner (`local`, from before accounts) on a project alice now owns: Unpublish takes it down all the same.
    const claimed = await makeManga(ALICE)
    const left = shareOf(await owner(projectRoute.POST, 'POST', { id: claimed.project.id }, ALICE))!
    const leftFile = join(dir, 'shares', `${left.token}.json`)
    await writeFile(leftFile, JSON.stringify({ ...(JSON.parse(await readFile(leftFile, 'utf8')) as ShareRecord), ownerId: 'local' }))
    assert.equal((await open(publicJson.GET, { token: left.token })).status, 200)
    assert.equal((await owner(projectRoute.DELETE, 'DELETE', { id: claimed.project.id }, ALICE)).status, 200)
    assert.equal((await open(publicJson.GET, { token: left.token })).status, 404, 'Unpublish on a project the caller owns revokes its link whoever recorded it')
    assert.equal(await store.shares.activeForProject(claimed.project.id), null)

    ok('revoke: the JSON, a picture, the preview, the page (notFound) and the metadata are byte-for-byte what an unknown token gets; a malformed token too; the record keeps no title, name or picture id; unpublish is idempotent; sharing again makes a NEW token and the old one stays dead')
  }

  // =====================================================================================
  // 4b. A redraw after sharing (CR-16 meets a share): a picture the live share lists is never deleted from under it
  // =====================================================================================
  {
    // A redraw writes the desk back, and a desk with a plan of no pages (the planted one) refuses to; these projects have no plan.
    const planless = async () => {
      const made = await makeManga(ALICE)
      await store.updateProject(made.project.id, (p) => ({ ...p, chapters: p.chapters.map((c) => ({ ...c, plan: null })) }))
      return made
    }
    const m = await planless()
    const P = m.project.id
    const here = async (id: string) => (await store.getBlob(id)) !== null
    const publicOk = async (t: string, id: string) => (await open(publicImage.GET, { token: t, imageId: id })).status
    const newPicture = () => store.putBlob(png, 'image/png', 'panel')
    const redrawPanel = async (pid = P) => {
      const id = await newPicture()
      await landImage(pid, id, (d, i) => attachPanelVersion(d, 0, i, new Date()), 0)
      return id
    }
    const redrawCover = async () => {
      const id = await newPicture()
      await landImage(P, id, (d, i) => attachCoverVersion(d, i, new Date()), 0)
      return id
    }
    const view = shareOf(await owner(projectRoute.POST, 'POST', { id: P }, ALICE))!
    const shared = m.ids.panels[0][0] // panel 0's picture when it was shared; the older version beneath it is not published
    const sharedCover = m.ids.cover

    // Panel 0 keeps 3 versions (MAX_PANEL_VERSIONS) and starts with 2: the second redraw pushes the unpublished older one out, the third the shared picture.
    const r1 = await redrawPanel()
    assert.equal(await here(m.ids.older), true, 'nothing is dropped yet')
    const r2 = await redrawPanel()
    assert.equal(await here(m.ids.older), false, 'a picture no share lists is deleted when a redraw pushes it out, as before')
    assert.equal(await here(shared), true, 'still there while it is in the window')
    const r3 = await redrawPanel()
    assert.equal(await here(shared), true, 'the picture the link shows is kept after the redraw that dropped it from the panel')
    assert.equal(await publicOk(view.token, shared), 200, 'and the link still serves it')
    assert.equal(await publicOk(view.token, m.ids.panels[0][1]), 200, 'as it does the others')
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: P }, ALICE))?.stale, true, 'the owner is told the page changed')
    assert.equal(await here(r1), true, 'the project’s own versions are untouched')

    // The cover too: three redraws drop the shared cover from its window.
    for (let i = 0; i < 3; i++) await redrawCover()
    assert.equal(await here(sharedCover), true, 'the shared cover survives a cover redraw that dropped it')
    assert.equal(await publicOk(view.token, sharedCover), 200)
    // The owner's route serves only what the project keeps, so Settings › Sharing shows the cover the link lists through the link's route.
    assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: P }, ALICE))?.cover, sharedCover, 'the owner’s view names the cover the link shows')
    assert.equal((await owner(ownerImage.GET, 'GET', { id: P, imageId: sharedCover }, ALICE)).status, 404, 'which the project no longer keeps')

    // Update share retakes the snapshot, and lets go of what only the old one held.
    const moved = shareOf(await owner(projectRoute.PUT, 'PUT', { id: P }, ALICE))!
    assert.equal(moved.token, view.token)
    assert.equal(await here(shared), false, 'Update share releases the picture the old snapshot held and nothing else does')
    assert.equal(await here(sharedCover), false)
    const now = publicManga((await store.shares.get(view.token))!.snapshot)!
    for (const id of snapshotImageIds(now)) assert.equal(await here(id), true, `${id} is in the bucket`)
    assert.equal(await here(r2), true)
    assert.equal(await here(r3), true)
    assert.equal(await publicOk(view.token, shared), 404, 'the link no longer lists it')

    // Unpublish releases what the share alone was holding. The link now shows r3; the next three redraws push it out of the window.
    assert.equal(now.pages[0].panels[0].imageId, r3)
    const r4 = await redrawPanel()
    const r5 = await redrawPanel()
    assert.equal(await here(r1), false, 'a picture the link does not list goes with the redraw that drops it')
    assert.equal(await here(r3), true, 'the one it lists stays while it is listed')
    const r6 = await redrawPanel()
    assert.equal(await here(r3), true)
    assert.equal(await publicOk(view.token, r3), 200)
    assert.equal((await owner(projectRoute.DELETE, 'DELETE', { id: P }, ALICE)).status, 200)
    assert.equal(await here(r3), false, 'Unpublish releases the picture only the link was holding')
    for (const id of [r4, r5, r6]) assert.equal(await here(id), true, 'and none the project still keeps')
    assert.equal(await publicOk(view.token, r4), 404)

    // The same through the token door (Settings › Sharing) and the account-deletion door.
    const again = shareOf(await owner(projectRoute.POST, 'POST', { id: P }, ALICE))!
    const shown = publicManga((await store.shares.get(again.token))!.snapshot)!.pages[0].panels[0].imageId
    assert.equal(shown, r6)
    for (let i = 0; i < 3; i++) await redrawPanel()
    assert.equal(await here(r6), true)
    assert.equal((await owner(byToken.DELETE, 'DELETE', { token: again.token }, ALICE)).status, 200)
    assert.equal(await here(r6), false, 'unpublishing from Settings releases it too')

    // A project that exists but cannot be read (damaged, no backup) is not guessed at: Unpublish must leave every picture the link listed,
    // because the project still names them and repairing it from a file backup would otherwise find its art gone.
    {
      const sick = await planless()
      const S = sick.project.id
      const link = shareOf(await owner(projectRoute.POST, 'POST', { id: S }, ALICE))!
      const listed = [...snapshotImageIds(publicManga((await store.shares.get(link.token))!.snapshot)!)]
      assert.ok(listed.length >= 2, 'the link lists panels and a cover')
      const file = join(dir, 'projects', S, 'project.json')
      await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), version: 1 }))
      await rm(join(dir, 'projects', S, 'project.json.bak'), { force: true })
      await assert.rejects(store.readProject(S), (e: unknown) => (e as { status?: number }).status === 500, 'the project cannot be read')
      const warn = console.warn
      console.warn = () => {}
      try {
        assert.equal((await owner(byToken.DELETE, 'DELETE', { token: link.token }, ALICE)).status, 200, 'the link can still be taken down')
      } finally {
        console.warn = warn
      }
      assert.equal((await store.shares.get(link.token))?.snapshot ?? null, null, 'and it is revoked')
      for (const id of listed) assert.equal(await here(id), true, `${id} stays: an unreadable project is not treated as gone`)
    }


    // A redraw that lands between the project being read and the snapshot being written is caught: the snapshot is taken again, and no
    // picture it lists is missing. (Update share first, then Share publicly.)
    const everyPictureHeld = async (t: string) => {
      const snap = publicManga((await store.shares.get(t))!.snapshot)!
      for (const id of snapshotImageIds(snap)) {
        assert.equal(await here(id), true, `${id} is in the bucket`)
        assert.equal(await publicOk(t, id), 200, `${id} is served`)
      }
    }
    const shares = store.shares as unknown as Record<'refresh' | 'create', (...a: unknown[]) => Promise<unknown>>
    {
      const racer = await planless()
      const R = racer.project.id
      const first = shareOf(await owner(projectRoute.POST, 'POST', { id: R }, ALICE))!
      await redrawPanel(R) // current now, and not what the link lists
      const realRefresh = shares.refresh
      let raced = false
      shares.refresh = async (...a) => {
        if (!raced) {
          raced = true
          for (let i = 0; i < 3; i++) await redrawPanel(R) // drops the picture the new snapshot was taken with
        }
        return realRefresh.apply(store.shares, a)
      }
      try {
        const res = await owner(projectRoute.PUT, 'PUT', { id: R }, ALICE)
        assert.equal(res.status, 200, res.text)
      } finally {
        shares.refresh = realRefresh
      }
      assert.ok(raced)
      await everyPictureHeld(first.token)
      assert.equal(shareOf(await owner(projectRoute.GET, 'GET', { id: R }, ALICE))?.stale, false, 'and the share is the project as it stands')
    }
    {
      const racer = await planless()
      const C = racer.project.id
      const realCreate = shares.create
      let raced = false
      shares.create = async (...a) => {
        if (!raced) {
          raced = true
          for (let i = 0; i < 3; i++) await redrawPanel(C)
        }
        return realCreate.apply(store.shares, a)
      }
      let made: ShareView
      try {
        const res = await owner(projectRoute.POST, 'POST', { id: C }, ALICE)
        assert.equal(res.status, 200, res.text)
        made = shareOf(res)!
      } finally {
        shares.create = realCreate
      }
      assert.ok(raced)
      await everyPictureHeld(made.token)
    }

    ok('redraw after sharing: a picture the link lists survives the redraws that drop it from its panel and from the cover; Update share releases it')
  }

  // =====================================================================================
  // 4c. The arrow keys turn the reader's pages, but never behind an open dialog (Share, Report)
  // =====================================================================================
  {
    const { turnKeyIndex } = await import('../lib/reader')
    // A stand-in for the one DOM method the decision uses: `closest` over a chain of ancestors, for the selector forms the list is written in.
    type Node = { tag: string; attrs?: Record<string, string> }
    const target = (...chain: Node[]) => ({
      closest(selector: string) {
        const matches = (n: Node, one: string) => {
          const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(one)
          return attr ? (attr[2] === undefined ? attr[1] in (n.attrs ?? {}) : n.attrs?.[attr[1]] === attr[2]) : n.tag === one
        }
        return chain.find((n) => selector.split(',').some((one) => matches(n, one.trim()))) ?? null
      },
    })
    const key = (k: string, t: ReturnType<typeof target> | null, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: t, ...mods })
    const body = target({ tag: 'body' })
    // Manga order: the left arrow is forward. Left to right: the right arrow is.
    assert.equal(turnKeyIndex(key('ArrowLeft', body), true, 1, 5), 2)
    assert.equal(turnKeyIndex(key('ArrowRight', body), true, 1, 5), 0)
    assert.equal(turnKeyIndex(key('ArrowRight', body), false, 1, 5), 2)
    assert.equal(turnKeyIndex(key('ArrowLeft', body), false, 0, 5), 0, 'the first page stays the first')
    assert.equal(turnKeyIndex(key('ArrowRight', body), false, 4, 5), 4, 'and the last the last')
    assert.equal(turnKeyIndex(key('ArrowDown', body), true, 1, 5), null, 'other keys do nothing')
    assert.equal(turnKeyIndex(key('ArrowLeft', body, { ctrlKey: true }), true, 1, 5), null, 'a shortcut is left to the browser')
    // Typing in a field is never a page turn…
    for (const tag of ['input', 'textarea']) assert.equal(turnKeyIndex(key('ArrowLeft', target({ tag }, { tag: 'body' })), true, 1, 5), null, tag)
    assert.equal(turnKeyIndex(key('ArrowLeft', target({ tag: 'div', attrs: { contenteditable: 'true' } })), true, 1, 5), null)
    // …and neither is a key pressed inside a modal dialog: on the Share dialog's buttons, the Report dialog's Close and Send.
    const modal = (...inner: Node[]) => target(...inner, { tag: 'div', attrs: { role: 'dialog', 'aria-modal': 'true' } }, { tag: 'body' })
    for (const inner of [{ tag: 'button' }, { tag: 'a' }, { tag: 'div' }]) {
      assert.equal(turnKeyIndex(key('ArrowLeft', modal(inner)), true, 1, 5), null, `${inner.tag} in a dialog`)
      assert.equal(turnKeyIndex(key('ArrowRight', modal(inner)), true, 1, 5), null, `${inner.tag} in a dialog`)
    }
    assert.equal(turnKeyIndex(key('ArrowLeft', null), true, 1, 5), 2, 'no target (a synthetic event) still turns')
    // …and neither is a key whose target is the body while a modal is open: a click on the dialog's plain text drops focus there, outside the dialog.
    assert.equal(turnKeyIndex({ ...key('ArrowLeft', body), modalOpen: true }, true, 1, 5), null, 'focus lost to the body behind an open dialog')
    assert.equal(turnKeyIndex({ ...key('ArrowLeft', body), modalOpen: false }, true, 1, 5), 2, 'no dialog open: it turns')
    // Both dialogs carry the attributes the guard looks for.
    for (const file of ['ShareDialog', 'ReportDialog']) {
      const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'components', `${file}.tsx`), 'utf8')
      assert.ok(source.includes('role="dialog"') && source.includes('aria-modal="true"'), `${file} is a role=dialog, aria-modal`)
    }
    ok('arrow keys: left/right turn pages in the reading order and clamp at the ends; a shortcut, a field and a key pressed inside a modal dialog (Share, Report) turn nothing')
  }

  // =====================================================================================
  // 5. The address windows
  // =====================================================================================
  {
    const ids = [...snapshotImageIds((await store.shares.get(token))!.snapshot as MangaSnapshot)]
    env.RATE_ANON_PER_MIN = '3'
    env.RATE_ANON_MEDIA_PER_MIN = '2'
    const A1 = '203.0.113.7'
    const A2 = '203.0.113.8'
    for (let i = 0; i < 3; i++) assert.equal((await open(publicJson.GET, { token }, A1)).status, 200)
    const limited = await open(publicJson.GET, { token }, A1)
    assert.equal(limited.status, 429, 'the snapshot route takes the anon window')
    assert.ok(Number(Object.fromEntries(limited.headers)['retry-after']) >= 1, 'with Retry-After')
    assert.ok(typeof (limited.json as { error: string }).error === 'string' && !limited.text.includes(token))
    assert.equal((await open(publicJson.GET, { token }, A2)).status, 200, 'another address has its own window')
    assert.equal((await open(publicJson.GET, { token: unknown }, A1)).status, 429, 'an unknown token takes it too — probing is counted, not free')
    // The page: the same window (A1 is spent), a calm page; another address reads.
    asRequest({ 'x-forwarded-for': A1 })
    const busy = renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token }) }))
    assert.ok(busy.includes('Too many visits just now.') && busy.includes('role="status"') && !busy.includes('The Last Train'), 'a calm page, nothing of the manga')
    // …and the page's metadata takes the same window: over the line the head is the bare one a dead link gets, and the store is not read.
    const spy = store.shares as unknown as { get: (t: string) => Promise<unknown> }
    const realGet = spy.get
    let reads = 0
    spy.get = (t) => {
      reads++
      return realGet(t)
    }
    try {
      const bare = JSON.stringify(await sharePage.generateMetadata({ params: Promise.resolve({ token: unknown }) }))
      const throttled = JSON.stringify(await sharePage.generateMetadata({ params: Promise.resolve({ token }) }))
      assert.equal(reads, 0, 'a throttled address’s metadata reads no share')
      assert.ok(!throttled.includes('A Different Title') && !throttled.includes('pages'), 'and carries nothing of the live share')
      assert.equal(throttled.replace(token, 'T'), bare.replace(unknown, 'T'), 'the same bare head a dead link gets, so live and dead cannot be told apart while the window is full')
    } finally {
      spy.get = realGet
    }
    asRequest({ 'x-forwarded-for': '203.0.113.9' })
    assert.equal((await sharePage.generateMetadata({ params: Promise.resolve({ token }) })).title, 'A Different Title', 'an address with room still gets the live metadata')
    asRequest({ 'x-forwarded-for': A2 })
    assert.ok(renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token }) })).includes('A Different Title'), 'another address reads the page')
    // Pictures: the media window, per address.
    const B1 = '203.0.113.20'
    for (let i = 0; i < 2; i++) assert.equal((await open(publicImage.GET, { token, imageId: ids[i] }, B1)).status, 200)
    const mediaLimited = await open(publicImage.GET, { token, imageId: ids[2] }, B1)
    assert.equal(mediaLimited.status, 429, 'the picture route takes the anonMedia window')
    assert.equal(Object.fromEntries(mediaLimited.headers)['cache-control'], 'no-store')
    assert.equal((await open(publicImage.GET, { token, imageId: ids[2] }, '203.0.113.21')).status, 200)
    // The preview image crops a cover on the CPU on every request, so it takes the strict page window (anon, 60 a minute),
    // not the picture window (anonMedia, 600 a minute, meant for streaming stored files): a spent picture window leaves it alone…
    asRequest({ 'x-forwarded-for': B1 })
    assert.equal((await preview.default({ params: Promise.resolve({ token }) })).status, 200, 'the picture window does not govern the preview')
    // …and the page window (3 here) does.
    const C1 = '203.0.113.30'
    asRequest({ 'x-forwarded-for': C1 })
    for (let i = 0; i < 3; i++) assert.equal((await preview.default({ params: Promise.resolve({ token }) })).status, 200)
    const ogLimited = await preview.default({ params: Promise.resolve({ token }) })
    assert.equal(ogLimited.status, 429, 'the preview takes the anon window')
    assert.equal(ogLimited.headers.get('cache-control'), 'no-store')
    // A caller can't escape a window by writing a different X-Forwarded-For to the left: the right-hand entry is the trusted hop’s.
    env.RATE_ANON_PER_MIN = '2'
    for (let i = 0; i < 2; i++) assert.equal((await open(publicJson.GET, { token }, `10.0.0.${i}, 198.51.100.9`)).status, 200)
    assert.equal((await open(publicJson.GET, { token }, '10.0.0.99, 198.51.100.9')).status, 429, 'a forged left-hand address does not buy a fresh window')
    env.RATE_ANON_PER_MIN = '100000'
    env.RATE_ANON_MEDIA_PER_MIN = '100000'
    ok('windows: the JSON route (anon), the pictures (anonMedia) and the preview and the page (anon, its metadata included: over the line the head is the dead link’s) are limited per address with a calm sentence and Retry-After; another address is untouched; unknown tokens count too; a forged left-hand X-Forwarded-For buys nothing')
  }

  // =====================================================================================
  // 6. Markup is text
  // =====================================================================================
  {
    // (A vertical share, because a paged reader shows one page at a time and its server HTML holds only the cover: the scroll renders every page.)
    const evil = await makeManga(ALICE, {
      style: 'manhwa-colour',
      coverTitle: '<img src=x onerror=alert(1)>',
      names: ['Mika "><script>alert(2)</script>', 'Ren & <b>Co</b>'],
      lines: ['<script>alert(3)</script> & "quoted"', '</div><svg onload=alert(4)>', '{{7*7}} ${process.env.X}', "'; DROP TABLE shares; --", 'a', 'b', 'c', 'd'],
    })
    const t = shareOf(await owner(projectRoute.POST, 'POST', { id: evil.project.id }, ALICE))?.token as string
    asRequest({})
    const el = await sharePage.default({ params: Promise.resolve({ token: t }) })
    const html = renderToStaticMarkup(el)
    for (const raw of ['<img src=x onerror', '<script>alert', '<svg onload', '<b>Co</b>', '"><script>']) assert.ok(!html.includes(raw), `the page holds no raw ${raw}`)
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the title is shown as the text it is')
    assert.ok(html.includes('&lt;script&gt;alert(3)&lt;/script&gt; &amp; &quot;quoted&quot;'), 'a line is shown as text')
    assert.ok(html.includes('{{7*7}}'), 'and template syntax is just letters')
    const json = (await open(publicJson.GET, { token: t })).json as MangaSnapshot
    assert.equal(json.title, '<img src=x onerror=alert(1)>', 'the data keeps the author’s characters; escaping is the renderer’s job')
    const meta = (await sharePage.generateMetadata({ params: Promise.resolve({ token: t }) })) as { title: string }
    assert.equal(meta.title, '<img src=x onerror=alert(1)>', 'metadata is data too: Next escapes it into the head')
    const bare = await makeManga(ALICE, { coverTitle: '<b>Tag</b> title' })
    await store.updateProject(bare.project.id, (p) => ({ ...p, chapters: p.chapters.map((c) => ({ ...c, cover: null })) }))
    const bareToken = shareOf(await owner(projectRoute.POST, 'POST', { id: bare.project.id }, ALICE))?.token as string
    asRequest({})
    const card = await preview.default({ params: Promise.resolve({ token: bareToken }) })
    assert.equal(card.status, 200, 'a title with markup still makes a preview card')
    ok('XSS-ish strings in the title, the speakers’ names and the lines render escaped (no raw tag in the page); the data keeps them as typed; markup in a title still makes a preview card')
  }

  // =====================================================================================
  // 7. A video share (slice 22): a snapshot of {kind,title,seconds,hasCaptions,takenAt}, the player on
  //    the public page, and the trailer's files served from the SHARE's own video — with Range
  // =====================================================================================
  {
    // --- A fake share: it names a video that does not exist. The page and the JSON are the snapshot's; no file is served.
    const fake = newShareToken()
    await store.shares.create({
      token: fake, ownerId: ALICE, kind: 'video', projectId: null, videoId: crypto.randomUUID(),
      snapshot: { kind: 'video', title: 'A trailer', seconds: 24, hasCaptions: false, takenAt: at }, createdAt: at, updatedAt: at, revokedAt: null,
    })
    const j = await open(publicJson.GET, { token: fake })
    assert.deepEqual(j.json, { kind: 'video', title: 'A trailer', seconds: 24, hasCaptions: false, takenAt: at }, 'the JSON is the five-key allow-list')
    assert.equal((await open(publicImage.GET, { token: fake, imageId: alice.ids.cover })).status, 404)
    asRequest({})
    const fakePage = renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token: fake }) }))
    assert.ok(fakePage.includes('A trailer'), 'the page carries the snapshot’s title')
    assert.ok(fakePage.includes('<video') && fakePage.includes(`/api/s/${fake}/file/final.mp4`), 'the page renders the SharedVideo player on the share’s own file route')
    assert.ok(fakePage.includes(`/api/s/${fake}/file/poster.jpg`), 'with the poster')
    assert.ok(!fakePage.includes('can’t be played') && !fakePage.includes('can&#x27;t be played'), 'and no longer says the trailer can’t be played')
    assert.ok(!fakePage.includes('<track'), 'no captions track when the snapshot has none')
    assert.ok(!fakePage.includes('captions.vtt'), 'and no captions address')
    const unknown = newShareToken()
    for (const name of ['final.mp4', 'poster.jpg', 'captions.vtt', 'other.txt']) {
      const gone = await open(fileRoute.GET, { token: unknown, name })
      assert.equal(gone.status, 404)
      const faked = await open(fileRoute.GET, { token: fake, name })
      assert.equal(faked.status, 404, `a share to a video that does not exist serves no ${name}`)
      assert.deepEqual([faked.status, faked.text, faked.headers], [gone.status, gone.text, gone.headers], `…and its 404 for ${name} is byte-identical to an unknown token’s`)
    }
    assert.equal((await preview.default({ params: Promise.resolve({ token: fake }) })).status, 404, 'no preview for a share whose video is gone')

    // --- A REAL video: a done record with a tiny real mp4 and jpg in the outputs store, under videoKeys(...).
    const panels = alice.project.chapters[0].pages[0].panels
    const plan = planTrailer({
      title: 'The Last Train',
      page: 0,
      panels,
      characters: alice.project.library.characters,
      model: 'bytedance/seedance-2.0',
      resolution: '480p',
      method: 'B',
    })
    const vid = crypto.randomUUID()
    const keys = videoKeys(ALICE, vid)
    const mp4Path = join(dir, 'tiny.mp4')
    await execFileAsync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=12:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mp4Path])
    const mp4 = await readFile(mp4Path)
    assert.ok(mp4.length > 1000, 'a real (tiny) mp4')
    const jpg = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#2040c0' } }).jpeg().toBuffer()
    const vtt = Buffer.from('WEBVTT\n\n00:00:03.000 --> 00:00:05.000\nThe train is late.\n')
    await store.outputs.put(keys.final, mp4, 'video/mp4')
    await store.outputs.put(keys.poster, jpg, 'image/jpeg')
    await store.outputs.put(keys.captions, vtt, 'text/vtt')
    const queued = newVideoRecord({ id: vid, ownerId: ALICE, projectId: alice.project.id, plan })
    await store.videos.put(queued)
    await assert.rejects(() => createVideoShare(ALICE, queued, 'http://check'), (err: unknown) => err instanceof Refused && err.status === 409, 'a trailer that is not done cannot be shared')
    const done = markVideoDone(queued, { finalKey: keys.final, posterKey: keys.poster, captionsKey: keys.captions, seconds: 2 }, new Date())
    assert.ok(done, 'the record can be finished')
    await store.videos.put(done)

    const view = await createVideoShare(ALICE, done, 'http://check')
    assert.equal(view.kind, 'video')
    assert.equal((await createVideoShare(ALICE, done, 'http://check')).token, view.token, 'sharing a trailer twice is one share')
    const t = view.token
    const snap = (await open(publicJson.GET, { token: t })).json as Record<string, unknown>
    assert.deepEqual(Object.keys(snap).sort(), ['hasCaptions', 'kind', 'seconds', 'takenAt', 'title'])
    assert.equal(snap.hasCaptions, true)
    assert.equal(snap.seconds, 2)
    assert.equal(snap.title, 'The Last Train · Page 1', 'the snapshot title is the project’s title and the page')
    for (const key of ['ownerId', 'videoId', 'projectId', 'plan', 'shots', 'costUsd', 'finalKey', 'posterKey']) assert.ok(!(key in snap), `the snapshot has no ${key}`)

    asRequest({})
    const page = renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token: t }) }))
    assert.ok(page.includes('<video') && page.includes(`/api/s/${t}/file/final.mp4`) && page.includes(`/api/s/${t}/file/poster.jpg`), 'the real share renders the player')
    assert.ok(page.includes('<track') && page.includes(`/api/s/${t}/file/captions.vtt`), 'with its captions track, because the snapshot says there are captions')
    assert.ok(!page.includes('can’t be played'))
    assert.ok(!page.includes(ALICE) && !page.includes(vid) && !page.includes(keys.folder) && !page.includes(alice.project.id), 'and nothing of the owner’s: not the owner, the video’s id, its keys or the project’s id')

    // The files: the whole file, then Range.
    type FileOpts = { range?: string; method?: 'GET' | 'HEAD'; address?: string }
    const file = async (token: string, name: string, opts: FileOpts = {}): Promise<Reply> => {
      const headers: Record<string, string> = {}
      if (opts.range) headers.range = opts.range
      if (opts.address) headers['x-forwarded-for'] = opts.address
      const handler = opts.method === 'HEAD' ? fileRoute.HEAD : fileRoute.GET
      return reply(await handler(new Request(`http://check/api/s/${token}/file/${name}`, { method: opts.method ?? 'GET', headers }), { params: Promise.resolve({ token, name }) }))
    }
    const header = (r: Reply, name: string) => Object.fromEntries(r.headers)[name]
    const whole = await file(t, 'final.mp4')
    assert.equal(whole.status, 200)
    assert.ok(whole.bytes.equals(mp4), 'final.mp4 is the stored file, byte for byte')
    assert.equal(header(whole, 'content-type'), 'video/mp4')
    assert.equal(header(whole, 'accept-ranges'), 'bytes')
    assert.equal(header(whole, 'x-content-type-options'), 'nosniff')
    assert.equal(header(whole, 'cache-control'), 'no-store')
    assert.equal(header(whole, 'content-length'), String(mp4.length))
    const first = await file(t, 'final.mp4', { range: 'bytes=0-99' })
    assert.equal(first.status, 206, 'a Range request is a 206 (iOS Safari will not play a video without it)')
    assert.equal(header(first, 'content-range'), `bytes 0-99/${mp4.length}`)
    assert.equal(header(first, 'content-length'), '100')
    assert.equal(header(first, 'accept-ranges'), 'bytes')
    assert.equal(header(first, 'content-type'), 'video/mp4')
    assert.ok(first.bytes.equals(mp4.subarray(0, 100)), 'and carries exactly those bytes')
    const probe = await file(t, 'final.mp4', { range: 'bytes=0-1' })
    assert.equal(probe.status, 206, 'the two-byte probe Safari sends first')
    assert.equal(header(probe, 'content-range'), `bytes 0-1/${mp4.length}`)
    const tail = await file(t, 'final.mp4', { range: 'bytes=500-' })
    assert.equal(tail.status, 206)
    assert.equal(header(tail, 'content-range'), `bytes 500-${mp4.length - 1}/${mp4.length}`)
    assert.ok(tail.bytes.equals(mp4.subarray(500)), 'an open-ended range runs to the end')
    const suffix = await file(t, 'final.mp4', { range: 'bytes=-64' })
    assert.equal(suffix.status, 206)
    assert.ok(suffix.bytes.equals(mp4.subarray(mp4.length - 64)), 'a suffix range is the last bytes')
    const past = await file(t, 'final.mp4', { range: `bytes=${mp4.length + 10}-` })
    assert.equal(past.status, 416, 'a range past the end is a 416')
    assert.equal(header(past, 'content-range'), `bytes */${mp4.length}`)
    const head = await file(t, 'final.mp4', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.bytes.length, 0, 'HEAD has no body')
    assert.equal(header(head, 'content-length'), String(mp4.length))

    const poster = await file(t, 'poster.jpg')
    assert.equal(poster.status, 200)
    assert.equal(header(poster, 'content-type'), 'image/jpeg')
    assert.equal(header(poster, 'x-content-type-options'), 'nosniff')
    assert.equal(header(poster, 'cache-control'), 'no-store')
    assert.ok(poster.bytes.equals(jpg), 'poster.jpg is the stored poster')
    const posterRange = await file(t, 'poster.jpg', { range: 'bytes=0-9' })
    assert.equal(posterRange.status, 206)
    assert.ok(posterRange.bytes.equals(jpg.subarray(0, 10)))
    const captions = await file(t, 'captions.vtt')
    assert.equal(captions.status, 200, 'the captions are served when the snapshot says there are some')
    assert.ok(captions.bytes.equals(vtt))
    assert.match(header(captions, 'content-type') ?? '', /^text\/vtt/)
    for (const name of ['other.txt', 'FINAL.MP4', '..%2Ffinal.mp4', 'shots', '']) assert.equal((await file(t, name)).status, 404, `a name off the list (${JSON.stringify(name)}) is a 404`)

    // The preview image is cut from the poster (a solid blue one), not the paper card.
    asRequest({})
    const card = await preview.default({ params: Promise.resolve({ token: t }) })
    assert.equal(card.status, 200, 'the preview image works from the poster')
    assert.equal(card.headers.get('content-type'), 'image/png')
    const cardBytes = Buffer.from(await card.arrayBuffer())
    const cardMeta = await sharp(cardBytes).metadata()
    assert.deepEqual([cardMeta.width, cardMeta.height], [1200, 630])
    const [r, g, b] = (await sharp(cardBytes).stats()).channels.map((c) => c.mean)
    assert.ok(Math.abs(r - 0x20) < 12 && Math.abs(g - 0x40) < 12 && Math.abs(b - 0xc0) < 12, `the preview is the poster’s colour (${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)}), not the paper card`)

    // Only the video of THAT share: a share owned by bob that names alice’s video serves nothing of it;
    // neither does a share to a video that has not finished.
    const stolen = newShareToken()
    await store.shares.create({
      token: stolen, ownerId: BOB, kind: 'video', projectId: null, videoId: vid,
      snapshot: { kind: 'video', title: 'Not bob’s', seconds: 2, hasCaptions: true, takenAt: at }, createdAt: at, updatedAt: at, revokedAt: null,
    })
    for (const name of ['final.mp4', 'poster.jpg', 'captions.vtt']) {
      const r2 = await file(stolen, name)
      const ref = await file(unknown, name)
      assert.deepEqual([r2.status, r2.text, r2.headers], [ref.status, ref.text, ref.headers], `bob’s share to alice’s video serves no ${name}: the dead link’s 404`)
    }
    assert.equal((await preview.default({ params: Promise.resolve({ token: stolen }) })).status, 404)
    const notDoneId = crypto.randomUUID()
    await store.videos.put(newVideoRecord({ id: notDoneId, ownerId: ALICE, projectId: alice.project.id, plan }))
    const early = newShareToken()
    await store.shares.create({
      token: early, ownerId: ALICE, kind: 'video', projectId: null, videoId: notDoneId,
      snapshot: { kind: 'video', title: 'Early', seconds: 2, hasCaptions: false, takenAt: at }, createdAt: at, updatedAt: at, revokedAt: null,
    })
    const earlyFile = await file(early, 'final.mp4')
    const refFile = await file(unknown, 'final.mp4')
    assert.deepEqual([earlyFile.status, earlyFile.text, earlyFile.headers], [refFile.status, refFile.text, refFile.headers], 'a share to a video that is not done serves nothing')

    // The owner’s list still has it; the window applies per address; then unpublish.
    const list = ((await owner(listRoute.GET, 'GET', {}, ALICE)).json as { shares: ShareView[] }).shares
    assert.equal(list.find((s) => s.token === t)?.kind, 'video')
    assert.equal(list.find((s) => s.token === t)?.stale, false)
    env.RATE_ANON_MEDIA_PER_MIN = '2'
    const D1 = '203.0.113.77'
    for (let i = 0; i < 2; i++) assert.equal((await file(t, 'final.mp4', { range: 'bytes=0-9', address: D1 })).status, 206)
    assert.equal((await file(t, 'final.mp4', { range: 'bytes=0-9', address: D1 })).status, 429, 'the file route takes the media window per address')
    assert.equal((await file(t, 'final.mp4', { range: 'bytes=0-9', address: '203.0.113.78' })).status, 206, 'another address is untouched')
    env.RATE_ANON_MEDIA_PER_MIN = '100000'

    // --- Unpublished: byte-identical to a token that never lived, on every public route.
    const revoked = await owner(byToken.DELETE, 'DELETE', { token: t }, ALICE)
    assert.equal(revoked.status, 200, 'it can be unpublished from the list')
    for (const name of ['final.mp4', 'poster.jpg', 'captions.vtt']) {
      for (const range of [undefined, 'bytes=0-99']) {
        const dead = await file(t, name, range ? { range } : {})
        const never = await file(unknown, name, range ? { range } : {})
        assert.equal(dead.status, 404)
        assert.deepEqual([dead.status, dead.text, dead.headers], [never.status, never.text, never.headers], `unpublished ${name}${range ? ' (Range)' : ''}: the same 404 as an unknown token`)
      }
    }
    const deadJson = await open(publicJson.GET, { token: t })
    const neverJson = await open(publicJson.GET, { token: unknown })
    assert.deepEqual([deadJson.status, deadJson.text, deadJson.headers], [neverJson.status, neverJson.text, neverJson.headers], 'the JSON too')
    const deadHead = await file(t, 'final.mp4', { method: 'HEAD' })
    assert.equal(deadHead.status, 404)
    const deadCard = await preview.default({ params: Promise.resolve({ token: t }) })
    const neverCard = await preview.default({ params: Promise.resolve({ token: unknown }) })
    assert.equal(deadCard.status, 404)
    assert.equal(await deadCard.text(), await neverCard.text())
    assert.equal((await owner(byToken.DELETE, 'DELETE', { token: fake }, ALICE)).status, 200, 'the fake share unpublishes too')
    await unpublishVideo(done)
    ok('a video share: the snapshot is {kind,title,seconds,hasCaptions,takenAt}; the page renders the player (poster, captions track only with captions); a real done video serves final.mp4 (200, and Range → 206/416, HEAD), poster.jpg and captions.vtt from the share’s own video only; the preview image is cut from the poster; a share to a missing, someone else’s or unfinished video, an unpublished token and an unknown one are the same 404 on every public route; the file route takes the media window')
  }

  // =====================================================================================
  // 8. The signed-in pages take the person's read window (after-audit #13): the desk (/) and the studio (/p/<id>) read
  //    the store on every render, so a render counts as an API read does; over the line the page says so, calmly,
  //    before it reads anything — and another person's window is their own.
  // =====================================================================================
  {
    const { DeskNotice } = await import('../components/DeskNotice')
    const { Dashboard } = await import('../components/Dashboard')
    const { Studio } = await import('../components/Studio')
    const deskPage = (await import('../app/page')).default as () => Promise<import('react').ReactElement<{ heading?: string; sentence?: string }>>
    const studioPage = (await import('../app/p/[projectId]/page')).default as (p: { params: Promise<{ projectId: string }> }) => Promise<import('react').ReactElement<{ heading?: string; sentence?: string }>>
    const READER = 'user_pagereader'
    const id = crypto.randomUUID()
    await store.createProject({ ...emptyProject({ id, chapterId: crypto.randomUUID(), title: 'Pages', stylePresetId: 'manga-bw', serverRunId: 'check' }), ownerId: READER })
    const studio = () => studioPage({ params: Promise.resolve({ projectId: id }) })
    const listed: string[] = []
    const realList = store.listProjects
    store.listProjects = async (owner) => {
      listed.push(owner)
      return realList.call(store, owner)
    }
    env.RATE_READ_PER_MIN = '3'
    try {
      asRequest({ 'x-inkdesk-test-user': READER })
      assert.equal((await deskPage()).type, Dashboard)
      assert.equal((await studio()).type, Studio)
      assert.equal((await deskPage()).type, Dashboard)
      const reads = listed.length
      for (const over of [await deskPage(), await studio()]) {
        assert.equal(over.type, DeskNotice, 'the fourth render in a minute is over the read window')
        assert.match(over.props.sentence ?? '', /^You’re going a little fast — try again in \d+ seconds\.$/)
      }
      assert.equal(listed.length, reads, 'and reads nothing')
      asRequest({ 'x-inkdesk-test-user': 'user_pageneighbour' })
      assert.equal((await deskPage()).type, Dashboard, 'another person’s window is their own')
    } finally {
      store.listProjects = realList
      delete env.RATE_READ_PER_MIN
      asRequest({})
    }
    ok('the desk and the studio take the person’s read window on every render: over the line they say so calmly and read nothing; another person is untouched')
  }

  assert.deepEqual(outbound, [], 'nothing left the machine')
  console.log('\n  share-check-sharing: all passed\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}
