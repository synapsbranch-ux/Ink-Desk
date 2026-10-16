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
//   7  a video      a video share does not break the page, the JSON or the list
//
// The cloud store cannot be exercised from here; this script is the local half.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const env = process.env as Record<string, string | undefined>
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
const { newShareToken, NOT_SHARED } = await import('../lib/share/service')
const { isShareToken } = await import('../lib/share/url')
const { PANEL_LAYOUT } = await import('../lib/prompts')
import type { Panel, Project } from '../lib/types'
import type { MangaSnapshot, ShareRecord, ShareView } from '../lib/share/types'

const projectRoute = (await import('../app/api/projects/[id]/share/route')) as unknown as Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>
const listRoute = (await import('../app/api/shares/route')) as unknown as Record<'GET', Handler>
const byToken = (await import('../app/api/shares/[token]/route')) as unknown as Record<'DELETE', Handler>
const publicJson = (await import('../app/api/s/[token]/route')) as unknown as Record<'GET', Handler>
const publicImage = (await import('../app/api/s/[token]/image/[imageId]/route')) as unknown as Record<'GET', Handler>
const sharePage = (await import('../app/s/[token]/page')) as unknown as {
  default: (p: { params: Promise<{ token: string }> }) => Promise<import('react').ReactElement>
  generateMetadata: (p: { params: Promise<{ token: string }> }) => Promise<Record<string, unknown>>
}
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
    ok('revoke: the JSON, a picture, the preview, the page (notFound) and the metadata are byte-for-byte what an unknown token gets; a malformed token too; the record keeps no title, name or picture id; unpublish is idempotent; sharing again makes a NEW token and the old one stays dead')
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
    asRequest({ 'x-forwarded-for': A2 })
    assert.ok(renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token }) })).includes('A Different Title'), 'another address reads the page')
    // Pictures: the media window, per address.
    const B1 = '203.0.113.20'
    for (let i = 0; i < 2; i++) assert.equal((await open(publicImage.GET, { token, imageId: ids[i] }, B1)).status, 200)
    const mediaLimited = await open(publicImage.GET, { token, imageId: ids[2] }, B1)
    assert.equal(mediaLimited.status, 429, 'the picture route takes the anonMedia window')
    assert.equal(Object.fromEntries(mediaLimited.headers)['cache-control'], 'no-store')
    assert.equal((await open(publicImage.GET, { token, imageId: ids[2] }, '203.0.113.21')).status, 200)
    // The preview image: the same media window.
    asRequest({ 'x-forwarded-for': B1 })
    const ogLimited = await preview.default({ params: Promise.resolve({ token }) })
    assert.equal(ogLimited.status, 429)
    // A caller can't escape a window by writing a different X-Forwarded-For to the left: the right-hand entry is the trusted hop’s.
    env.RATE_ANON_PER_MIN = '2'
    for (let i = 0; i < 2; i++) assert.equal((await open(publicJson.GET, { token }, `10.0.0.${i}, 198.51.100.9`)).status, 200)
    assert.equal((await open(publicJson.GET, { token }, '10.0.0.99, 198.51.100.9')).status, 429, 'a forged left-hand address does not buy a fresh window')
    env.RATE_ANON_PER_MIN = '100000'
    env.RATE_ANON_MEDIA_PER_MIN = '100000'
    ok('windows: the JSON route (anon), the pictures and the preview (anonMedia) and the page (anon) are limited per address with a calm sentence and Retry-After; another address is untouched; unknown tokens count too; a forged left-hand X-Forwarded-For buys nothing')
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
  // 7. A video share (slice 22 makes them; nothing here may break on one)
  // =====================================================================================
  {
    const t = newShareToken()
    await store.shares.create({
      token: t, ownerId: ALICE, kind: 'video', projectId: null, videoId: crypto.randomUUID(),
      snapshot: { kind: 'video', title: 'A trailer', posterImageId: null, seconds: 24, takenAt: at }, createdAt: at, updatedAt: at, revokedAt: null,
    })
    const j = await open(publicJson.GET, { token: t })
    assert.deepEqual(j.json, { kind: 'video', title: 'A trailer', seconds: 24, takenAt: at })
    assert.equal((await open(publicImage.GET, { token: t, imageId: alice.ids.cover })).status, 404)
    asRequest({})
    const page = renderToStaticMarkup(await sharePage.default({ params: Promise.resolve({ token: t }) }))
    assert.ok(page.includes('A trailer') && page.includes('can’t be played'))
    assert.equal((await preview.default({ params: Promise.resolve({ token: t }) })).status, 404, 'no manga preview for a video (slice 22 brings its own)')
    const list = ((await owner(listRoute.GET, 'GET', {}, ALICE)).json as { shares: ShareView[] }).shares
    assert.equal(list.find((s) => s.token === t)?.kind, 'video')
    assert.equal(list.find((s) => s.token === t)?.stale, false)
    assert.equal((await owner(byToken.DELETE, 'DELETE', { token: t }, ALICE)).status, 200, 'and it can be unpublished from the list')
    ok('a video share: the JSON gives title and length only, the page says the trailer can’t be played yet, no picture is served for it, it lists and unpublishes')
  }

  assert.deepEqual(outbound, [], 'nothing left the machine')
  console.log('\n  share-check-sharing: all passed\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}
