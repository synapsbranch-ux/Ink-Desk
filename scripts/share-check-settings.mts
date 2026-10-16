// Slice 21's SETTINGS check (Defaults), from `devpost/prd.md > Settings (v3)` and
// `devpost/spec.md > Settings, Usage, Terms and Privacy (v3)`:
//
//   npx tsx scripts/share-check-settings.mts
//
// On a scratch desk (INKDESK_DATA_DIR in a temp folder, sign-in in test mode —
// user_alice and user_bob —, the local store, every credential unset and `fetch`
// stubbed so nothing can leave) the route behind Settings › Defaults is held to:
//
//   1  reading      nobody named → 401 with the one sentence; a person who has
//                   never saved reads as "no style, right to left, never saved";
//                   a stored record naming a style this build does not know reads
//                   as no style; answers are never cached
//   2  saving       a PUT stores exactly the two fields and stamps `updatedAt`;
//                   the same body twice leaves the same values and one record;
//                   null is a style (no preference); both directions; the answer
//                   is what a read now gives
//   3  strict       every body that is not exactly {defaultStyle: known|null,
//                   readingDirection: 'rtl'|'ltr'} is refused 400 with the
//                   route's sentence and changes nothing: an unknown style, a
//                   missing field, an extra key (userId, updatedAt, voices, anything),
//                   wrong types, an array, a string, invalid JSON, an empty body;
//                   an oversized body is 413 and its stream is cancelled early
//   4  isolation    alice's defaults never reach bob and bob's save never changes
//                   alice's; there is no way to name another person's record
//   5  voices       the reserved `voices` survives a save untouched, and a body
//                   cannot write it
//   6  no accounts  with sign-in off the one `local` owner has defaults too
//
// The cloud store cannot be exercised from here; this is the local half.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const env = process.env as Record<string, string | undefined>
const ok = (msg: string) => console.log(`  ok  ${msg}`)

if (env.INKDESK_STORAGE?.trim() === 'cloud') {
  console.log('  --  this check runs on the local store only: the cloud half needs a MongoDB and a bucket on this machine')
  process.exit(1)
}

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-share-settings-'))
env.INKDESK_DATA_DIR = dir
for (const name of Object.keys(env)) {
  if (/^(CLERK_|NEXT_PUBLIC_CLERK_|S3_|DB_|MONGODB_|REDIS_|RAILWAY_)/.test(name)) delete env[name]
}
for (const name of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GENERATION_ENABLED', 'INKDESK_QUEUE', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'ADMIN_EMAILS']) delete env[name]
env.INKDESK_STORAGE = 'local'
env.INKDESK_AUTH = 'test'
env.INKDESK_QUEUE = 'inline'
env.RATE_EDIT_PER_MIN = '100000'
env.RATE_READ_PER_MIN = '100000'
delete env.NODE_ENV

const outbound: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push((typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).slice(0, 120))
  throw new Error('the settings check never reaches a provider')
}) as typeof fetch

const { store } = await import('../lib/store')
const { DEFAULTS_UNREADABLE, readSettings } = await import('../lib/settings')
const { SIGN_IN_SENTENCE } = await import('../lib/auth/session')
const route = (await import('../app/api/settings/defaults/route')) as unknown as Record<'GET' | 'PUT', (req: Request) => Promise<Response>>

const ALICE = 'user_alice'
const BOB = 'user_bob'
type View = { defaultStyle: string | null; readingDirection: string; updatedAt: string | null }
type Reply = { status: number; json: { settings?: View; error?: string } | null; headers: Headers; text: string }

async function call(method: 'GET' | 'PUT', who: string | null, body?: BodyInit | null, extra: Record<string, string> = {}): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra }
  if (who) headers['x-inkdesk-test-user'] = who
  const res = await route[method](new Request('http://check/api/settings/defaults', { method, headers, ...(body !== undefined && body !== null ? { body } : {}) }))
  const text = await res.text()
  let json: Reply['json'] = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, headers: res.headers, text }
}
const put = (who: string | null, body: unknown) => call('PUT', who, typeof body === 'string' ? body : JSON.stringify(body))
const view = (r: Reply): View => {
  assert.ok(r.json?.settings, `expected settings, got ${r.status} ${r.text.slice(0, 120)}`)
  return r.json.settings
}

try {
  // 1. reading -------------------------------------------------------------------------
  {
    const nobody = await call('GET', null)
    assert.equal(nobody.status, 401)
    assert.equal(nobody.json?.error, SIGN_IN_SENTENCE)
    assert.equal((await put(null, { defaultStyle: null, readingDirection: 'ltr' })).status, 401, 'nobody saves either')
    const first = await call('GET', ALICE)
    assert.equal(first.status, 200)
    assert.deepEqual(view(first), { defaultStyle: null, readingDirection: 'rtl', updatedAt: null })
    assert.equal(first.headers.get('cache-control'), 'no-store')
    // A retired preset reads as no preference, so New project can never be preselected to something it cannot make.
    await store.settings.put({ userId: BOB, defaultStyle: 'retired-style' as never, readingDirection: 'ltr', updatedAt: '2026-10-01T00:00:00.000Z' })
    assert.deepEqual(view(await call('GET', BOB)), { defaultStyle: null, readingDirection: 'ltr', updatedAt: '2026-10-01T00:00:00.000Z' })
    await store.settings.delete(BOB)
    ok('nobody → 401 with the one sentence; a person who never saved reads as no style, right to left, never saved; a retired style reads as none; no-store')
  }

  // 2. saving ---------------------------------------------------------------------------
  {
    const body = { defaultStyle: 'manhwa-colour', readingDirection: 'ltr' }
    const a = await put(ALICE, body)
    assert.equal(a.status, 200)
    assert.equal(a.headers.get('cache-control'), 'no-store')
    const saved = view(a)
    assert.equal(saved.defaultStyle, 'manhwa-colour')
    assert.equal(saved.readingDirection, 'ltr')
    assert.ok(saved.updatedAt && !Number.isNaN(Date.parse(saved.updatedAt)))
    const stored = await store.settings.get(ALICE)
    assert.deepEqual(Object.keys(stored ?? {}).sort(), ['defaultStyle', 'readingDirection', 'updatedAt', 'userId'], 'exactly the record’s fields, no voices invented')
    assert.equal(stored?.userId, ALICE)
    assert.deepEqual(view(await call('GET', ALICE)), saved, 'a read gives what the save answered')

    const again = view(await put(ALICE, body))
    assert.equal(again.defaultStyle, saved.defaultStyle)
    assert.equal(again.readingDirection, saved.readingDirection)
    assert.deepEqual((await store.settings.get(ALICE))?.defaultStyle, 'manhwa-colour')
    assert.deepEqual(view(await call('GET', ALICE)), again, 'idempotent: the same body twice, the same values')

    const none = view(await put(ALICE, { defaultStyle: null, readingDirection: 'rtl' }))
    assert.deepEqual({ ...none, updatedAt: '' }, { defaultStyle: null, readingDirection: 'rtl', updatedAt: '' }, 'null is a choice: no preference')
    assert.equal((await readSettings(ALICE)).defaultStyle, null)
    assert.equal(view(await put(ALICE, { defaultStyle: 'manga-bw', readingDirection: 'rtl' })).defaultStyle, 'manga-bw')
    ok('a save stores exactly the two fields and stamps updatedAt; the same body twice ends the same; null (no preference), both styles and both directions work; the answer is what a read gives')
  }

  // 3. strict -----------------------------------------------------------------------------
  {
    const before = JSON.stringify(await store.settings.get(ALICE))
    const refused: [string, unknown][] = [
      ['an unknown style', { defaultStyle: 'watercolour', readingDirection: 'rtl' }],
      ['a style in the wrong case', { defaultStyle: 'MANGA-BW', readingDirection: 'rtl' }],
      ['an empty style', { defaultStyle: '', readingDirection: 'rtl' }],
      ['a missing style', { readingDirection: 'rtl' }],
      ['a missing direction', { defaultStyle: null }],
      ['an unknown direction', { defaultStyle: null, readingDirection: 'vertical' }],
      ['an extra key', { defaultStyle: null, readingDirection: 'rtl', extra: 1 }],
      ['a user id', { defaultStyle: null, readingDirection: 'rtl', userId: BOB }],
      ['a clock', { defaultStyle: null, readingDirection: 'rtl', updatedAt: '2000-01-01T00:00:00.000Z' }],
      ['reserved voices', { defaultStyle: null, readingDirection: 'rtl', voices: { lead: 'x' } }],
      ['wrong types', { defaultStyle: 3, readingDirection: true }],
      ['an array', [{ defaultStyle: null, readingDirection: 'rtl' }]],
      ['a string', '"manga-bw"'],
      ['null', 'null'],
      ['invalid JSON', '{"defaultStyle": '],
      ['an empty body', ''],
    ]
    for (const [what, body] of refused) {
      const r = await put(ALICE, body)
      assert.equal(r.status, 400, `${what}: ${r.status} ${r.text.slice(0, 100)}`)
      assert.equal(r.json?.error, DEFAULTS_UNREADABLE, what)
    }
    assert.equal(JSON.stringify(await store.settings.get(ALICE)), before, 'a refused body changes nothing')

    // Oversized: declared, and streamed with no length — the stream is cancelled, not read to the end.
    const big = await call('PUT', ALICE, JSON.stringify({ defaultStyle: null, readingDirection: 'rtl', pad: 'x'.repeat(5000) }))
    assert.equal(big.status, 413)
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (pulled >= 256 * 1024) return c.close()
          pulled += 8 * 1024
          c.enqueue(new Uint8Array(8 * 1024).fill(97))
        },
      },
      { highWaterMark: 0 }
    )
    const headers = { 'content-type': 'application/json', 'x-inkdesk-test-user': ALICE }
    const streamed = await route.PUT(new Request('http://check/api/settings/defaults', { method: 'PUT', headers, body: stream, duplex: 'half' } as RequestInit))
    assert.equal(streamed.status, 413)
    assert.ok(pulled <= 16 * 1024, `the stream was cancelled early (${pulled} bytes pulled)`)
    assert.equal(JSON.stringify(await store.settings.get(ALICE)), before)
    ok(`${refused.length} wrong bodies → 400 with the route’s sentence and nothing changed; a body over the cap → 413 (declared, and streamed: ${pulled} bytes pulled, not 256 KB)`)
  }

  // 4. isolation ----------------------------------------------------------------------------
  {
    const alice = view(await call('GET', ALICE))
    assert.equal(view(await call('GET', BOB)).updatedAt, null, 'bob has saved nothing of his own')
    const bobs = view(await put(BOB, { defaultStyle: 'manhwa-colour', readingDirection: 'ltr' }))
    assert.equal(bobs.defaultStyle, 'manhwa-colour')
    assert.deepEqual(view(await call('GET', ALICE)), alice, 'bob’s save never touches alice’s')
    // No parameter, query or header names another person's record.
    const sneaky = await call('GET', BOB, undefined, { 'x-inkdesk-test-user-2': ALICE })
    assert.deepEqual(view(sneaky), bobs)
    const res = await route.GET(new Request(`http://check/api/settings/defaults?userId=${ALICE}&user=${ALICE}`, { headers: { 'x-inkdesk-test-user': BOB } }))
    assert.deepEqual(((await res.json()) as { settings: View }).settings, bobs, 'a query string cannot name another record')
    assert.equal(JSON.stringify(await call('GET', BOB)).includes(ALICE), false)
    ok('alice’s defaults never reach bob, bob’s save never reaches alice, and nothing in the request can name another person’s record')
  }

  // 5. voices -----------------------------------------------------------------------------------
  {
    await store.settings.put({ userId: ALICE, defaultStyle: 'manga-bw', readingDirection: 'rtl', voices: { lead: 'voice-1', counterpart: 'voice-2' }, updatedAt: '2026-10-01T00:00:00.000Z' })
    const r = await put(ALICE, { defaultStyle: 'manhwa-colour', readingDirection: 'ltr' })
    assert.equal(r.status, 200)
    assert.equal(JSON.stringify(r.json).includes('voice'), false, 'the browser is never given the reserved voices')
    const stored = await store.settings.get(ALICE)
    assert.deepEqual(stored?.voices, { lead: 'voice-1', counterpart: 'voice-2' }, 'the reserved voices survive a save')
    assert.equal(stored?.defaultStyle, 'manhwa-colour')
    assert.notEqual(stored?.updatedAt, '2026-10-01T00:00:00.000Z', 'updatedAt moved')
    assert.equal((await put(ALICE, { defaultStyle: null, readingDirection: 'rtl', voices: { lead: 'evil' } })).status, 400, 'a body cannot write them')
    assert.deepEqual((await store.settings.get(ALICE))?.voices, { lead: 'voice-1', counterpart: 'voice-2' })
    ok('the reserved voices are carried through a save untouched, never sent to the browser, and cannot be written by a body')
  }

  // 6. no accounts ----------------------------------------------------------------------------------
  {
    env.INKDESK_AUTH = 'off'
    const first = await call('GET', null)
    assert.equal(first.status, 200)
    assert.equal(view(first).updatedAt, null)
    assert.equal(view(await put(null, { defaultStyle: 'manhwa-colour', readingDirection: 'ltr' })).defaultStyle, 'manhwa-colour')
    assert.equal((await store.settings.get('local'))?.userId, 'local', 'the one owner is `local`')
    env.INKDESK_AUTH = 'test'
    assert.equal(view(await call('GET', ALICE)).defaultStyle, 'manhwa-colour')
    ok('with sign-in off the one `local` owner saves and reads their own defaults')
  }

  assert.deepEqual(outbound, [], 'nothing left the machine')
  console.log('\n  share-check-settings: all passed\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}
