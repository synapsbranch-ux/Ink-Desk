// Slice 16's request hardening, from `devpost/checklist.md > Slices > 16` and
// `devpost/security-report.md` SEC-03, SEC-04, CR-4, CR-5 — run against a
// scratch folder in local mode with `fetch` stubbed, so no provider, no
// database and no bucket is ever reached:
//
//   npm run check:hardening
//
// Every request schema has a ceiling on every string and list and refuses
// unknown keys; a string past its ceiling is a 400 before any provider call.
// Every body is read with a cap: a declared length over it is refused before
// a byte is read, and a chunked body with no length is cut off at the cap —
// a 413, the stream cancelled, never read to the end. The upload holds the
// same line. GENERATION_ENABLED=false — or unset in production — closes
// every route that can spend with a 503, before its body is read. Realistic
// requests, the shapes the studio sends, still pass.
//
// Slice 23 (the after-audit) adds two: the image optimizer is off, so
// `/_next/image` can never fetch and keep a share picture (#1); and every page
// carries a CSP with a fresh nonce from `proxy.ts`, with no 'unsafe-inline'
// for scripts (#3).
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
// As Next's own server starts: section 9's config loader installs Next's require hook, after which Next's modules
// expect the AsyncLocalStorage global this sets.
import 'next/dist/server/node-environment-baseline.js'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-hardening-'))
const env = process.env as Record<string, string | undefined>
env.INKDESK_DATA_DIR = dir
env.INKDESK_STORAGE = 'local'
// The cloud settings, whatever this shell holds, are never read here.
for (const name of [
  'MONGODB_URI',
  'DB_URL',
  'MONGODB_DB',
  'DB_DATABASE',
  'S3_ENDPOINT',
 
  'S3_REGION',
  'S3_BUCKET',
  'S3_BUCKET_PROJECT_FILES',
  'S3_BUCKET_COMPILE_OUTPUTS',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'ANTHROPIC_API_KEY',
  'GENERATION_ENABLED',
]) {
  delete env[name]
}
env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below; nothing leaves this machine
env.LLM_FALLBACK = 'always'
const NODE_ENV = env.NODE_ENV
delete env.NODE_ENV

// --- The stub: every outbound request is recorded and refused ---------------
const realFetch = globalThis.fetch
const outbound: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  throw new Error('the hardening check never reaches a provider')
}) as typeof fetch

// Imported after the env is set, because the store reads it at load.
const schemas = await import('../lib/schemas')
const { JSON_LIMIT_BYTES } = await import('../lib/body')
const { GENERATION_CLOSED } = await import('../lib/generation')
const { generationEnabled } = await import('../lib/config')
const { UPLOAD_LIMIT_BYTES } = await import('../lib/assets')
const { SAMPLE_PITCH } = await import('../lib/prompts')
const { SAMPLE_SCENARIO, SAMPLE_SCENARIO_NOTES } = await import('../lib/story')
const projects = await import('../app/api/projects/route')
const desk = await import('../app/api/projects/[id]/route')
const assets = await import('../app/api/projects/[id]/assets/route')
const routes = {
  synopsis: await import('../app/api/projects/[id]/synopsis/route'),
  cast: await import('../app/api/projects/[id]/cast/route'),
  reroll: await import('../app/api/projects/[id]/cast/reroll/route'),
  sheet: await import('../app/api/projects/[id]/sheet/route'),
  import: await import('../app/api/projects/[id]/import/route'),
  plan: await import('../app/api/projects/[id]/plan/route'),
  cover: await import('../app/api/projects/[id]/cover/route'),
  script: await import('../app/api/projects/[id]/pages/[n]/script/route'),
  start: await import('../app/api/projects/[id]/pages/[n]/start/route'),
  all: await import('../app/api/projects/[id]/pages/all/start/route'),
  panel: await import('../app/api/projects/[id]/pages/[n]/panels/[i]/route'),
  rewrite: await import('../app/api/projects/[id]/pages/[n]/panels/[i]/rewrite/route'),
}
const sharp = (await import('sharp')).default

import type { Desk } from '../lib/types'

const ok = (msg: string) => console.log(`  ok  ${msg}`)
const MB = 1024 * 1024
const big = (n: number) => 'a'.repeat(n)
const UUID = '0f7a0249-b249-43c3-8d2f-8b842ed72a94'
const ASSET = `asset-${UUID}.png`

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const call = (handler: unknown, req: Request, params: Record<string, string> = {}) =>
  (handler as Handler)(req, { params: Promise.resolve(params) })
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://check/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })

/** A body that arrives in 16 KB chunks with no Content-Length, counting what was pulled. */
function chunked(prefix: string, total: number) {
  const seen = { pulled: 0, cancelled: false, ended: false }
  const head = new TextEncoder().encode(prefix)
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (seen.pulled >= total) {
          seen.ended = true
          c.close()
          return
        }
        const chunk = seen.pulled === 0 ? head : new Uint8Array(Math.min(16 * 1024, total - seen.pulled)).fill(0x61)
        seen.pulled += chunk.byteLength
        c.enqueue(chunk)
      },
      cancel() {
        seen.cancelled = true
      },
    },
    { highWaterMark: 0 }
  )
  return { stream, seen }
}
const streamed = (stream: ReadableStream<Uint8Array>, type = 'application/json') =>
  new Request('http://check/api', { method: 'POST', body: stream, headers: { 'content-type': type }, duplex: 'half' } as RequestInit)

async function expectError(res: Response, status: number, sentence?: string | RegExp) {
  const body = (await res.json()) as { error?: string }
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
  assert.equal(typeof body.error, 'string', 'every refusal carries a sentence')
  if (typeof sentence === 'string') assert.equal(body.error, sentence)
  else if (sentence) assert.match(body.error as string, sentence)
}

try {
  // A project to aim at, through the route the dashboard uses.
  const created = await call(projects.POST, post({ title: 'Hardening check', stylePresetId: 'manga-bw' }))
  assert.equal(created.status, 200)
  const pid = ((await created.json()) as Desk).address.projectId

  // 1. Schemas: a 1 MB string in any field, an unknown key, a bad id, a long list — refused.
  const MEG = big(MB)
  const refusedBySchema: [string, { safeParse: (v: unknown) => { success: boolean } }, unknown][] = [
    ['synopsis · pitch', schemas.SynopsisRequestSchema, { pitch: MEG, genre: 'Shonen', tone: 'Hopeful' }],
    ['synopsis · genre', schemas.SynopsisRequestSchema, { pitch: 'p', genre: MEG, tone: 'Hopeful' }],
    ['synopsis · tone', schemas.SynopsisRequestSchema, { pitch: 'p', genre: 'Shonen', tone: MEG }],
    ['synopsis · extra key', schemas.SynopsisRequestSchema, { pitch: 'p', genre: 'Shonen', tone: 'Hopeful', model: 'x' }],
    ['new project · title', schemas.NewProjectSchema, { title: MEG, stylePresetId: 'manga-bw' }],
    [
      'new project · story pitch',
      schemas.NewProjectSchema,
      { title: 't', stylePresetId: 'manga-bw', story: { pitch: { text: MEG, genre: 'g', tone: 't' }, synopsis: { title: 't', body: 'b' } } },
    ],
    [
      'new project · story synopsis',
      schemas.NewProjectSchema,
      { title: 't', stylePresetId: 'manga-bw', story: { pitch: { text: 'p', genre: 'g', tone: 't' }, synopsis: { title: 't', body: MEG } } },
    ],
    ['new project · extra key', schemas.NewProjectSchema, { title: 't', stylePresetId: 'manga-bw', ownerId: 'someone' }],
    ['patch · pitch text', schemas.ChapterPatchSchema, { pitch: { text: MEG } }],
    ['patch · pitch genre', schemas.ChapterPatchSchema, { pitch: { genre: big(61) } }],
    ['patch · pitch extra key', schemas.ChapterPatchSchema, { pitch: { text: 'p', padding: 'x' } }],
    ['patch · synopsis title', schemas.ChapterPatchSchema, { synopsis: { title: big(201) } }],
    ['patch · synopsis body', schemas.ChapterPatchSchema, { synopsis: { body: MEG } }],
    ['patch · synopsis extra key', schemas.ChapterPatchSchema, { synopsis: { body: 'b', padding: 'x' } }],
    ['patch · cast name', schemas.ChapterPatchSchema, { cast: { [UUID]: { name: big(81) } } }],
    ['patch · cast role', schemas.ChapterPatchSchema, { cast: { [UUID]: { role: big(121) } } }],
    ['patch · cast look', schemas.ChapterPatchSchema, { cast: { [UUID]: { look: MEG } } }],
    ['patch · cast trait', schemas.ChapterPatchSchema, { cast: { [UUID]: { traits: [big(61)] } } }],
    ['patch · cast traits', schemas.ChapterPatchSchema, { cast: { [UUID]: { traits: Array(10_000).fill('kind') } } }],
    ['patch · cast keys', schemas.ChapterPatchSchema, { cast: { a: {}, b: {}, c: {} } }],
    ['patch · cast key shape', schemas.ChapterPatchSchema, { cast: { '../../x': { name: 'n' } } }],
    ['patch · scenario text', schemas.ChapterPatchSchema, { scenario: { text: big(schemas.SCENARIO_MAX_CHARS + 1) } }],
    ['patch · scenario reference id', schemas.ChapterPatchSchema, { scenario: { referenceAssetIds: ['../secret.png'] } }],
    ['patch · extra key', schemas.ChapterPatchSchema, { usage: { costUsd: 0 } }],
    ['reroll · id', schemas.RerollRequestSchema, { id: MEG }],
    ['reroll · id shape', schemas.RerollRequestSchema, { id: '../../etc/passwd' }],
    ['reroll · extra key', schemas.RerollRequestSchema, { id: UUID, padding: 'x' }],
    ['sheet · id', schemas.SheetRequestSchema, { id: MEG }],
    ['sheet · extra key', schemas.SheetRequestSchema, { id: UUID, prompt: 'x' }],
    ['import · asset id', schemas.ImportRequestSchema, { id: UUID, assetId: MEG }],
    ['import · extra key', schemas.ImportRequestSchema, { id: UUID, assetId: ASSET, bytes: 'x' }],
    ['plan · extra key', schemas.PlanRequestSchema, { pageCount: 3, brief: 'x' }],
  ]
  for (const [what, schema, body] of refusedBySchema) {
    assert.equal(schema.safeParse(body).success, false, `${what} must be refused`)
  }
  ok(`${refusedBySchema.length} padded, unknown or malformed fields refused by the schemas, a 1 MB string in each`)

  // 2. Realistic requests — the shapes the studio sends — still pass.
  const PITCH_PARAGRAPH = `${SAMPLE_PITCH} ${big(3000).replace(/a/g, 'word ').slice(0, 3000)}`
  const SYNOPSIS = {
    title: 'The Letter Not Yet Written',
    body: 'Kai runs the rooftops of a future Osaka. One night a letter arrives addressed to him, in his own hand. Mira, who sorts the mail nobody sends, knows where it came from.',
  }
  const LOOK = 'Lean and wind-burned, with a shock of dark hair under a cracked visor. A courier jacket patched at the elbows, a satchel strapped across the chest, a thin scar through one eyebrow.'
  const realistic: [string, { safeParse: (v: unknown) => { success: boolean } }, unknown][] = [
    ['new project', schemas.NewProjectSchema, { title: 'Rooftop Letters', stylePresetId: 'manga-bw' }],
    [
      'new project with a story',
      schemas.NewProjectSchema,
      { title: SYNOPSIS.title, stylePresetId: 'manhwa-colour', story: { pitch: { text: SAMPLE_PITCH, genre: 'Slice of Life', tone: 'Melancholy' }, synopsis: SYNOPSIS } },
    ],
    ['synopsis', schemas.SynopsisRequestSchema, { pitch: SAMPLE_PITCH, genre: 'Shonen', tone: 'Hopeful' }],
    ['synopsis, a long pitch', schemas.SynopsisRequestSchema, { pitch: PITCH_PARAGRAPH, genre: 'Shonen', tone: 'Fast-paced' }],
    ['patch · pitch', schemas.ChapterPatchSchema, { pitch: { text: SAMPLE_PITCH, genre: 'Horror', tone: 'Eerie' } }],
    ['patch · accept', schemas.ChapterPatchSchema, { synopsis: { ...SYNOPSIS, accepted: true }, station: 'cast' }],
    [
      'patch · card',
      schemas.ChapterPatchSchema,
      { cast: { [UUID]: { name: 'Kai Mori', role: 'Lead · rooftop courier', traits: ['restless', 'loyal', 'quick-tongued'], look: LOOK } } },
    ],
    ['patch · lock', schemas.ChapterPatchSchema, { cast: { [UUID]: { locked: true } } }],
    [
      'patch · bubble',
      schemas.ChapterPatchSchema,
      { at: 0, panels: { '0': { dialogue: 'It’s in my handwriting.', bubble: { x: 10, y: 8, w: 40, h: 20, tailX: 30, tailY: 40 } } } },
    ],
    [
      'patch · scenario',
      schemas.ChapterPatchSchema,
      { storyMode: 'scenario', scenario: { text: SAMPLE_SCENARIO, notes: SAMPLE_SCENARIO_NOTES, referenceAssetIds: [ASSET], saved: true } },
    ],
    ['patch · whole scenario', schemas.ChapterPatchSchema, { scenario: { text: '話'.repeat(schemas.SCENARIO_MAX_CHARS) } }],
    [
      'patch · plan',
      schemas.ChapterPatchSchema,
      { plan: { pageCount: 4, coverBrief: 'Kai alone on a rooftop at dusk.', pages: { '0': { '1': { action: 'Mira looks up.' } } } }, page: 1 },
    ],
    ['patch · cover', schemas.ChapterPatchSchema, { cover: { title: 'Rooftop Letters', version: 1 } }],
    ['reroll', schemas.RerollRequestSchema, { id: UUID }],
    ['sheet', schemas.SheetRequestSchema, { id: UUID, reuseDna: true }],
    ['plan', schemas.PlanRequestSchema, { pageCount: 3, replace: true }],
    ['import', schemas.ImportRequestSchema, { id: UUID, assetId: ASSET }],
  ]
  for (const [what, schema, body] of realistic) {
    assert.equal(schema.safeParse(body).success, true, `${what} must still pass`)
  }
  ok(`${realistic.length} realistic requests still pass, a 3,000-character pitch and a 100,000-character CJK scenario among them`)

  // 3. Through the routes: a string past its ceiling is a 400, a 1 MB one is
  //    stopped by the cap first — either way before any provider call.
  await expectError(
    await call(routes.synopsis.POST, post({ pitch: big(schemas.PITCH_MAX_CHARS + 1), genre: 'Shonen', tone: 'Hopeful' }), { id: pid }),
    400,
    'Write a pitch and pick a genre and a tone first.'
  )
  await expectError(await call(routes.sheet.POST, post({ id: big(129) }), { id: pid }), 400, 'That request couldn’t be read.')
  await expectError(await call(desk.POST, post({ synopsis: { body: big(5000) } }), { id: pid }), 400, 'That edit couldn’t be read.')
  await expectError(await call(projects.POST, post({ title: 'x', stylePresetId: 'manga-bw', extra: 1 })), 400, 'A new project needs a title and a style.')
  await expectError(await call(routes.synopsis.POST, post({ pitch: MEG, genre: 'Shonen', tone: 'Hopeful' }), { id: pid }), 413, 'That request is too large.')
  await expectError(await call(desk.POST, post({ pitch: { text: MEG } }), { id: pid }), 413, 'That request is too large.')
  await expectError(await call(routes.reroll.POST, post({ id: MEG }), { id: pid }), 413)
  assert.equal(outbound.length, 0, 'no refused request may reach a provider')
  ok('a field past its ceiling → 400 with the route’s sentence; a 1 MB field → 413 at the cap; no provider called')

  // 4. A declared body over the cap: refused before a byte is read.
  {
    const { stream, seen } = chunked('{"pitch":"', 4 * MB)
    const req = new Request('http://check/api', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/json', 'content-length': String(4 * MB) },
      duplex: 'half',
    } as RequestInit)
    await expectError(await call(routes.synopsis.POST, req, { id: pid }), 413, 'That request is too large.')
    assert.equal(seen.pulled, 0, 'a declared length over the cap is refused unread')
    const patch = new Request('http://check/api', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': String(schemas.PATCH_LIMIT_BYTES + 1) },
    })
    await expectError(await call(desk.POST, patch, { id: pid }), 413)
  }
  ok(`a Content-Length over the cap (${JSON_LIMIT_BYTES / 1024} KB; ${Math.round(schemas.PATCH_LIMIT_BYTES / 1024)} KB for the edit route) → 413, nothing read`)

  // 5. A chunked body with no Content-Length: cut off at the cap, never read to the end.
  for (const [what, handler, cap] of [
    ['synopsis', routes.synopsis.POST, JSON_LIMIT_BYTES],
    ['edit', desk.POST, schemas.PATCH_LIMIT_BYTES],
    ['new project', projects.POST, JSON_LIMIT_BYTES],
  ] as const) {
    const total = 8 * MB
    const { stream, seen } = chunked('{"pitch":{"text":"', total)
    await expectError(await call(handler, streamed(stream), { id: pid }), 413, 'That request is too large.')
    assert.ok(!seen.ended && seen.pulled < total, `${what}: the stream must not be read to the end`)
    assert.ok(seen.pulled <= cap + 64 * 1024, `${what}: read ${seen.pulled} bytes, past the cap by more than a chunk or two`)
    assert.ok(seen.cancelled, `${what}: the stream is cancelled at the cap`)
  }
  assert.equal(outbound.length, 0)
  ok('a chunked JSON body with no Content-Length → 413 at the cap, the stream cancelled, 8 MB never read')

  // 6. The upload: over the cap declared, or chunked with no length — 413, not buffered.
  const TOO_BIG = /^That picture is over 3\.75 MB\./
  const FORM_CAP = UPLOAD_LIMIT_BYTES + 64 * 1024
  {
    const boundary = 'hardeningcheck'
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.png"\r\nContent-Type: image/png\r\n\r\n`
    const total = 64 * MB
    const { stream, seen } = chunked(prefix, total)
    await expectError(await call(assets.POST, streamed(stream, `multipart/form-data; boundary=${boundary}`), { id: pid }), 413, TOO_BIG)
    assert.ok(!seen.ended && seen.pulled <= FORM_CAP + 64 * 1024, `the upload read ${seen.pulled} bytes of 64 MB`)
    assert.ok(seen.cancelled, 'the upload stream is cancelled at the cap')

    const declared = chunked(prefix, total)
    const req = new Request('http://check/api', {
      method: 'POST',
      body: declared.stream,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(total) },
      duplex: 'half',
    } as RequestInit)
    await expectError(await call(assets.POST, req, { id: pid }), 413, TOO_BIG)
    assert.equal(declared.seen.pulled, 0, 'a declared upload over the cap is refused unread')
  }
  // A real picture under the cap still lands — through a chunked body too.
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#d8c9a8' } }).png().toBuffer()
  const form = new FormData()
  form.append('file', new File([new Uint8Array(png)], 'reference.png', { type: 'image/png' }))
  const uploaded = await call(assets.POST, new Request('http://check/api', { method: 'POST', body: form }), { id: pid })
  assert.equal(uploaded.status, 200, `a small picture must land: ${await uploaded.clone().text()}`)
  const shelf = ((await uploaded.json()) as Desk).assets
  assert.equal(shelf.length, 1)
  // One serialization, so the boundary in the type matches the bytes.
  const encoded = new Request('http://check/api', { method: 'POST', body: form })
  const formType = encoded.headers.get('content-type') ?? ''
  const formBytes = new Uint8Array(await encoded.arrayBuffer())
  const pieces = new ReadableStream<Uint8Array>({
    start(c) {
      for (let at = 0; at < formBytes.length; at += 1000) c.enqueue(formBytes.slice(at, at + 1000))
      c.close()
    },
  })
  const again = await call(assets.POST, streamed(pieces, formType), { id: pid })
  assert.equal(again.status, 200, `a chunked small picture must land: ${await again.clone().text()}`)
  assert.equal(outbound.length, 0)
  ok(`an upload over ${UPLOAD_LIMIT_BYTES / MB} MB → 413 whether declared or chunked, never buffered whole; a real picture still lands`)

  // 7. Valid requests still reach the work: the edit route saves; a paid route reaches the provider.
  const saved = await call(desk.POST, post({ pitch: { text: SAMPLE_PITCH, genre: 'Shonen', tone: 'Hopeful' } }), { id: pid })
  assert.equal(saved.status, 200)
  assert.equal(((await saved.json()) as Desk).pitch.text, SAMPLE_PITCH)
  const scenarioProject = ((await (await call(projects.POST, post({ title: 'Long scenario', stylePresetId: 'manga-bw' }))).json()) as Desk).address
    .projectId
  const longScenario = '話'.repeat(schemas.SCENARIO_MAX_CHARS)
  const kept = await call(desk.POST, post({ storyMode: 'scenario', scenario: { text: longScenario } }), { id: scenarioProject })
  assert.equal(kept.status, 200, `a whole CJK scenario (${Buffer.byteLength(longScenario)} bytes) must fit the edit cap`)
  // Validation passes, then the stubbed provider fails: the calm sentence, and the call was made.
  const reached = await call(routes.synopsis.POST, post({ pitch: SAMPLE_PITCH, genre: 'Shonen', tone: 'Hopeful' }), { id: pid })
  assert.ok(reached.status >= 500, `expected the stubbed provider's failure, got ${reached.status}`)
  assert.ok(outbound.length > 0, 'a valid synopsis request reaches the provider')
  outbound.length = 0
  // Real ids pass the id rules: refused by the desk's state, not by the schema.
  const assetId = shelf[0].id
  await expectError(await call(routes.import.POST, post({ id: UUID, assetId }), { id: pid }), 409, 'Settle the story first.')
  await expectError(await call(routes.sheet.POST, post({ id: UUID, reuseDna: false }), { id: pid }), 409, 'Settle the story first.')
  assert.equal(outbound.length, 0)
  ok('valid edits save (a whole 100,000-character CJK scenario too); a valid synopsis request reaches the provider; real ids pass')

  // 8. The generation flag: every route that can spend says so with a 503, unread and unsent.
  const paid: [string, unknown, Record<string, string>][] = [
    ['synopsis', routes.synopsis.POST, { id: pid }],
    ['cast', routes.cast.POST, { id: pid }],
    ['cast/reroll', routes.reroll.POST, { id: pid }],
    ['sheet', routes.sheet.POST, { id: pid }],
    ['import', routes.import.POST, { id: pid }],
    ['plan', routes.plan.POST, { id: pid }],
    ['cover', routes.cover.POST, { id: pid }],
    ['pages/[n]/script', routes.script.POST, { id: pid, n: '0' }],
    ['pages/[n]/start', routes.start.POST, { id: pid, n: '0' }],
    ['pages/all/start', routes.all.POST, { id: pid }],
    ['pages/[n]/panels/[i]', routes.panel.POST, { id: pid, n: '0', i: '0' }],
    ['pages/[n]/panels/[i]/rewrite', routes.rewrite.POST, { id: pid, n: '0', i: '0' }],
  ]
  const closedEverywhere = async (label: string) => {
    for (const [what, handler, params] of paid) {
      const { stream, seen } = chunked('{"id":"', 1 * MB)
      await expectError(await call(handler, streamed(stream), params), 503, GENERATION_CLOSED)
      assert.equal(seen.pulled, 0, `${what}: the body is not read while generation is closed (${label})`)
    }
    assert.equal(outbound.length, 0, `no provider call while generation is closed (${label})`)
  }
  env.GENERATION_ENABLED = 'false'
  await closedEverywhere('GENERATION_ENABLED=false')
  // Plain edits, reads, uploads and new projects stay open.
  assert.equal((await call(desk.POST, post({ pitch: { tone: 'Eerie' } }), { id: pid })).status, 200)
  assert.equal((await call(desk.GET, new Request('http://check/api'), { id: pid })).status, 200)
  assert.equal((await call(projects.POST, post({ title: 'Still open', stylePresetId: 'manga-bw' }))).status, 200)
  delete env.GENERATION_ENABLED
  // Slice 19: production always signs in (Better Auth, on its MongoDB) before
  // the flag is read — so the routes are not called in production here (check:ownership holds the sign-in order, in test mode). The flag’s
  // production default is held directly.
  assert.equal(generationEnabled({ NODE_ENV: 'production' }), false, 'GENERATION_ENABLED unset is closed in production')
  assert.equal(generationEnabled({ NODE_ENV: 'production', GENERATION_ENABLED: 'true' }), true, 'GENERATION_ENABLED=true opens it in production')
  ok(`GENERATION_ENABLED=false → 503 on all ${paid.length} paid routes, body unread, no provider call; unset in production is closed; edits stay open`)

  // 9. Slice 23 (#1): the image optimizer is off. Left open, /_next/image fetched the studio's own /api/** and /s/**
  // routes and kept each answer in its disk cache, so a share picture outlived its unpublishing, a takedown and the
  // deletion of the account. Held with Next's own config loader and its own parameter check.
  {
    const { default: loadConfig } = await import('next/dist/server/config.js')
    const { PHASE_PRODUCTION_SERVER } = await import('next/constants.js')
    const { ImageOptimizerCache } = await import('next/dist/server/image-optimizer.js')
    const config = await loadConfig(PHASE_PRODUCTION_SERVER, ROOT, { silent: true })
    // With the optimizer off, Next answers every /_next/image request 404 before it reads a parameter (next-server.js, handleNextImageRequest).
    assert.equal(config.images.unoptimized, true, 'the image optimizer is off: /_next/image fetches nothing')
    // Were it ever switched back on, it would still refuse anything but the brand marks.
    const req = { headers: {} } as IncomingMessage
    const shareRoutes = ['/api/s/tok123/image/panel-1.png', '/s/tok123/opengraph-image', '/api/s/tok123/file/poster.jpg', '/api/image/img-1.png', '/p/abc', '/api/projects']
    for (const url of shareRoutes) {
      const result = ImageOptimizerCache.validateParams(req, { url, w: '640', q: '75' }, config, false)
      assert.deepEqual(result, { errorMessage: '"url" parameter is not allowed' }, `/_next/image?url=${url} is refused`)
    }
    assert.ok(!('errorMessage' in ImageOptimizerCache.validateParams(req, { url: '/brand/inkdesk-mark.svg', w: '64', q: '75' }, config, false)))
    // Nothing is lost: every <Image> the app renders is a brand mark, an SVG the optimizer never touched anyway.
    const { execFileSync } = await import('node:child_process')
    const users = execFileSync('grep', ['-rlE', "from 'next/image'", 'app', 'components', 'lib'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')
    for (const file of users) {
      const source = await readFile(join(ROOT, file), 'utf8')
      for (const tag of source.match(/<Image\b[^>]*>/g) ?? []) assert.match(tag, /src="\/brand\/[^"]+\.svg"/, `${file}: ${tag}`)
    }
    ok(`the image optimizer is off: /_next/image refuses /api/s/…/image/…, /s/…/opengraph-image and the other ${shareRoutes.length - 2} routes; the ${users.length} files using <Image> show only brand SVGs`)
  }

  // 10. Slice 23 (#3): every page carries a CSP with a fresh nonce from proxy.ts — scripts only from that nonce and
  // what it loads ('strict-dynamic'), never 'unsafe-inline'; 'unsafe-eval' in development only. Next reads the nonce
  // from the request's policy and puts it on its own scripts. Sign-in is the studio's own: no outside host anywhere.
  {
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('../proxy')
    const nextConfig = (await import('../next.config')).default
    const APP = 'https://inkdesk.example'
    const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
      const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]))
      for (const [k, v] of Object.entries(vars)) if (v === undefined) delete env[k]
      else env[k] = v
      try {
        await fn()
      } finally {
        for (const [k, v] of Object.entries(saved)) if (v === undefined) delete env[k]
        else env[k] = v
      }
    }
    const directives = (policy: string) => new Map(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]))
    const visit = (url: string, headers: Record<string, string> = {}) =>
      proxy(new NextRequest(url, { headers: { host: new URL(url).host, accept: 'text/html', 'sec-fetch-dest': 'document', ...headers } }))
    /** The page's nonce, after holding the response's policy against what the page's render is handed. */
    const nonceOf = (res: Response, what: string) => {
      const policy = res.headers.get('content-security-policy') ?? ''
      const script = directives(policy).get('script-src') ?? []
      const nonces = script.filter((v) => /^'nonce-[A-Za-z0-9+/=]+'$/.test(v))
      assert.equal(nonces.length, 1, `${what}: one nonce in script-src (policy: ${policy || 'none'})`)
      const nonce = nonces[0].slice(7, -1)
      assert.ok(Buffer.from(nonce, 'base64').length >= 16, `${what}: 128 random bits at least`)
      assert.equal(script[0], "'self'")
      assert.ok(script.includes("'strict-dynamic'"), `${what}: 'strict-dynamic'`)
      assert.ok(!script.includes("'unsafe-inline'"), `${what}: no 'unsafe-inline' for scripts`)
      // NextResponse.next({ request: { headers } }): the render sees both, and Next takes the nonce from the policy.
      assert.equal(res.headers.get('x-middleware-request-x-nonce'), nonce, `${what}: the render is handed the nonce`)
      assert.equal(res.headers.get('x-middleware-request-content-security-policy'), policy, `${what}: and the policy`)
      const overrides = (res.headers.get('x-middleware-override-headers') ?? '').split(',')
      assert.ok(overrides.includes('x-nonce') && overrides.includes('content-security-policy'), `${what}: as request headers`)
      return { nonce, policy, script }
    }
    /** Everything but script-src is the static policy's, word for word. */
    const sameOtherwise = (policy: string, staticPolicy: string, what: string) => {
      const a = directives(policy)
      const b = directives(staticPolicy)
      assert.deepEqual([...a.keys()], [...b.keys()], `${what}: the same directives as the static policy`)
      for (const [name, values] of b) if (name !== 'script-src') assert.deepEqual(a.get(name), values, `${what}: ${name}`)
    }
    const staticPolicyOf = async () => {
      const rules = await nextConfig.headers!()
      return rules.find((r) => r.source === '/:path*')!.headers.find((h) => h.key === 'Content-Security-Policy')!.value
    }
    const PAGES = ['/', '/p/abc', '/s/tok123', '/s/tok123/opengraph-image', '/settings/usage', '/admin/reports', '/terms', '/sign-in']

    // The static header (next.config.ts) covers what the proxy does not shape: API answers, Next's own files, public/.
    // No nonce there, so no inline script runs at all.
    const staticPolicy = await staticPolicyOf()
    assert.deepEqual(directives(staticPolicy).get('script-src'), ["'self'"], 'the static policy: scripts from this origin only, nothing inline')
    for (const [name, values] of [
      ['default-src', ["'self'"]],
      ['style-src', ["'self'", "'unsafe-inline'"]],
      ['img-src', ["'self'", 'data:', 'blob:']],
      ['media-src', ["'self'", 'blob:']],
      ['connect-src', ["'self'"]],
      ['object-src', ["'none'"]],
      ['base-uri', ["'self'"]],
      ['form-action', ["'self'"]],
      ['frame-ancestors', ["'none'"]],
    ] as const) assert.deepEqual(directives(staticPolicy).get(name), values, `the static policy keeps ${name}`)

    for (const mode of ['off', 'test'] as const) {
      await withEnv({ INKDESK_AUTH: mode, NODE_ENV: undefined, APP_URL: undefined }, async () => {
        const seen = new Set<string>()
        for (const path of PAGES) {
          const what = `${mode}: ${path}`
          const { nonce, policy, script } = nonceOf(await visit(`http://localhost:3000${path}`, { 'x-inkdesk-test-user': 'user_check' }), what)
          assert.ok(!script.includes("'unsafe-eval'"), `${what}: no 'unsafe-eval' outside development`)
          sameOtherwise(policy, staticPolicy, what)
          seen.add(nonce)
        }
        assert.equal(seen.size, PAGES.length, `${mode}: a fresh nonce for every request`)
        // An API answer is not a page: the proxy leaves it the static policy.
        const api = await visit('http://localhost:3000/api/projects', { 'x-inkdesk-test-user': 'user_check' })
        assert.equal(api.headers.get('content-security-policy'), null, `${mode}: an API call keeps the static policy`)
        assert.equal(api.headers.get('x-middleware-request-x-nonce'), null)
      })
    }
    // Development adds 'unsafe-eval' (React's dev build uses eval for its error stacks); nothing else changes.
    await withEnv({ INKDESK_AUTH: 'off', NODE_ENV: 'development' }, async () => {
      const { script } = nonceOf(await visit('http://localhost:3000/'), 'development')
      assert.ok(script.includes("'unsafe-eval'"), "development: 'unsafe-eval'")
    })
    // Production signs in through Better Auth (fake settings, offline): the policy is the same — no outside host joins it,
    // signed in or out — and a signed-out visitor sent to sign-in is still answered by the proxy.
    await withEnv(
      { NODE_ENV: 'production', INKDESK_AUTH: 'better', BETTER_AUTH_SECRET: 'c'.repeat(32), MONGODB_URI: 'mongodb://check.invalid:27017/', MONGODB_DB: 'check', APP_URL: APP },
      async () => {
        for (const [path, cookie] of [['/sign-in', ''], ['/s/tok123', ''], ['/s/tok123/opengraph-image', ''], ['/terms', ''], ['/p/abc', '__Secure-inkdesk.session_token=x'], ['/settings/account', '__Secure-inkdesk.session_token=x']] as const) {
          const what = `better: ${path}`
          const res = await visit(`${APP}${path}`, cookie ? { cookie } : {})
          const { policy, script } = nonceOf(res, what)
          assert.ok(!script.includes("'unsafe-eval'"), `${what}: no 'unsafe-eval' in production`)
          assert.ok(!/https?:\/\//.test(policy), `${what}: no outside host in the policy`)
          sameOtherwise(policy, staticPolicy, what)
        }
        const signedOut = await visit(`${APP}/p/abc`)
        assert.equal(signedOut.status, 307, `a signed-out page still goes to sign-in, got ${signedOut.status}`)
        assert.ok(signedOut.headers.get('content-security-policy'), 'and the redirect carries the policy too')
      }
    )
    assert.deepEqual(outbound, [], 'nothing reached the network')
    // Every page renders per request, so each one gets its own nonce: the root layout reads the request's headers
    // (a static page would carry no nonce, and its scripts would be refused).
    const layout = await readFile(join(ROOT, 'app/layout.tsx'), 'utf8')
    assert.match(layout, /await headers\(\)/, 'the root layout reads the request, so no page is prerendered without a nonce')
    ok(`CSP: ${PAGES.length} pages in off and test mode and 6 in better mode each get a fresh nonce, 'strict-dynamic' and no 'unsafe-inline'; the render is handed both; 'unsafe-eval' only in development; API answers keep the static policy, which allows no inline script`)
  }

  console.log('\n  Request hardening check passed.\n')
} finally {
  globalThis.fetch = realFetch
  if (NODE_ENV === undefined) delete env.NODE_ENV
  else env.NODE_ENV = NODE_ENV
  await rm(dir, { recursive: true, force: true })
}
