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
//   2  saving       a PUT stores the two fields (and `voices` only once one is
//                   chosen) and stamps `updatedAt`; the same body twice leaves the
//                   same values and one record; null is a style (no preference);
//                   both directions; the answer is what a read now gives
//   3  strict       every body that is not {defaultStyle: known|null,
//                   readingDirection: 'rtl'|'ltr', voices?: {lead?, counterpart?}}
//                   is refused 400 with the route's sentence and changes nothing:
//                   an unknown style, a missing field, an extra key (userId,
//                   updatedAt, anything — also inside voices), an unknown or
//                   mistyped voice, wrong types, an array, a string, invalid JSON,
//                   an empty body; an oversized body is 413 and its stream is
//                   cancelled early
//   4  isolation    alice's defaults never reach bob and bob's save never changes
//                   alice's; there is no way to name another person's record
//   5  voices       voices are real settings (slice 22): every read and reply
//                   carries {lead, counterpart}, each a premade voice's name or
//                   null; a PUT's `voices` is a patch (absent keeps, null clears,
//                   a name sets); an unknown name is 400 and changes nothing; a
//                   voice this build no longer offers reads as none and is dropped
//                   by the next save; each person's voices are their own
//   6  no accounts  with sign-in off the one `local` owner has defaults too
//   7  copy         the words that make promises, read from source: Privacy and Terms say what
//                   slice 21 now does (public links, Report, export, Delete account) and no longer
//                   say it is coming; Defaults promises its direction only for the studio; the
//                   account menu links to Settings
//
// The cloud store cannot be exercised from here; this is the local half.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
const { VOICES } = await import('../lib/video/plan')
const { SIGN_IN_SENTENCE } = await import('../lib/auth/session')
const route = (await import('../app/api/settings/defaults/route')) as unknown as Record<'GET' | 'PUT', (req: Request) => Promise<Response>>

const ALICE = 'user_alice'
const BOB = 'user_bob'
type Voices = { lead: string | null; counterpart: string | null }
type View = { defaultStyle: string | null; readingDirection: string; voices: Voices; updatedAt: string | null }
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
    assert.deepEqual(view(first), { defaultStyle: null, readingDirection: 'rtl', voices: { lead: null, counterpart: null }, updatedAt: null })
    assert.equal(first.headers.get('cache-control'), 'no-store')
    // A retired preset reads as no preference, so New project can never be preselected to something it cannot make.
    await store.settings.put({ userId: BOB, defaultStyle: 'retired-style' as never, readingDirection: 'ltr', updatedAt: '2026-10-01T00:00:00.000Z' })
    assert.deepEqual(view(await call('GET', BOB)), { defaultStyle: null, readingDirection: 'ltr', voices: { lead: null, counterpart: null }, updatedAt: '2026-10-01T00:00:00.000Z' })
    await store.settings.delete(BOB)
    ok('nobody → 401 with the one sentence; a person who never saved reads as no style, right to left, no voices, never saved; a retired style reads as none; no-store')
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
    assert.deepEqual(Object.keys(stored ?? {}).sort(), ['defaultStyle', 'readingDirection', 'updatedAt', 'userId'], 'exactly the record’s fields: no voices are invented until one is chosen')
    assert.deepEqual(saved.voices, { lead: null, counterpart: null }, 'and the reply still says so, as nulls')
    assert.equal(stored?.userId, ALICE)
    assert.deepEqual(view(await call('GET', ALICE)), saved, 'a read gives what the save answered')

    const again = view(await put(ALICE, body))
    assert.equal(again.defaultStyle, saved.defaultStyle)
    assert.equal(again.readingDirection, saved.readingDirection)
    assert.deepEqual((await store.settings.get(ALICE))?.defaultStyle, 'manhwa-colour')
    assert.deepEqual(view(await call('GET', ALICE)), again, 'idempotent: the same body twice, the same values')

    const none = view(await put(ALICE, { defaultStyle: null, readingDirection: 'rtl' }))
    assert.deepEqual({ ...none, updatedAt: '' }, { defaultStyle: null, readingDirection: 'rtl', voices: { lead: null, counterpart: null }, updatedAt: '' }, 'null is a choice: no preference')
    assert.equal((await readSettings(ALICE)).defaultStyle, null)
    assert.equal(view(await put(ALICE, { defaultStyle: 'manga-bw', readingDirection: 'rtl' })).defaultStyle, 'manga-bw')
    ok('a save stores the two fields (no voices until one is chosen) and stamps updatedAt; the same body twice ends the same; null (no preference), both styles and both directions work; the answer is what a read gives')
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
      ['an unknown lead voice', { defaultStyle: null, readingDirection: 'rtl', voices: { lead: 'x' } }],
      ['an unknown counterpart voice', { defaultStyle: null, readingDirection: 'rtl', voices: { counterpart: 'morgan' } }],
      ['a voice in the wrong case', { defaultStyle: null, readingDirection: 'rtl', voices: { lead: 'GEORGE' } }],
      ['an empty voice name', { defaultStyle: null, readingDirection: 'rtl', voices: { lead: '' } }],
      ['a voice that is not a string', { defaultStyle: null, readingDirection: 'rtl', voices: { lead: 3 } }],
      ['a voice list', { defaultStyle: null, readingDirection: 'rtl', voices: { lead: ['george'] } }],
      ['a third voice', { defaultStyle: null, readingDirection: 'rtl', voices: { lead: 'george', narrator: 'adam' } }],
      ['voices that are null', { defaultStyle: null, readingDirection: 'rtl', voices: null }],
      ['voices as a string', { defaultStyle: null, readingDirection: 'rtl', voices: 'george' }],
      ['voices as an array', { defaultStyle: null, readingDirection: 'rtl', voices: ['george', 'sarah'] }],
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
    const [V1, V2, V3] = [VOICES[0], VOICES[8], VOICES[3]]
    const none: Voices = { lead: null, counterpart: null }
    const base = { defaultStyle: 'manga-bw', readingDirection: 'rtl' }
    // Start from a clean record for alice, with no voices.
    await store.settings.delete(ALICE)
    assert.deepEqual(view(await call('GET', ALICE)).voices, none, 'nothing chosen reads as two nulls')

    // A name sets (both parts), and the reply is what a read gives.
    const both = await put(ALICE, { ...base, voices: { lead: V1, counterpart: V2 } })
    assert.equal(both.status, 200)
    assert.deepEqual(view(both).voices, { lead: V1, counterpart: V2 })
    assert.deepEqual((await store.settings.get(ALICE))?.voices, { lead: V1, counterpart: V2 }, 'both are stored')
    assert.deepEqual(view(await call('GET', ALICE)), view(both), 'the GET carries the voices')
    assert.deepEqual((await readSettings(ALICE)).voices, { lead: V1, counterpart: V2 })

    // Absent keeps: a save of the style and direction alone (or with empty voices) never drops a voice.
    const kept = await put(ALICE, { defaultStyle: 'manhwa-colour', readingDirection: 'ltr' })
    assert.deepEqual(view(kept).voices, { lead: V1, counterpart: V2 }, 'absent `voices` keeps both')
    assert.equal(view(kept).defaultStyle, 'manhwa-colour')
    assert.equal(view(kept).readingDirection, 'ltr')
    assert.deepEqual(view(await put(ALICE, { ...base, voices: {} })).voices, { lead: V1, counterpart: V2 }, 'an empty `voices` keeps both')
    assert.deepEqual(view(await put(ALICE, { ...base, voices: { lead: V3 } })).voices, { lead: V3, counterpart: V2 }, 'one named part changes only that part')
    assert.deepEqual(view(await put(ALICE, { ...base, voices: { counterpart: V1 } })).voices, { lead: V3, counterpart: V1 }, 'and the other way round')
    assert.deepEqual(view(await put(ALICE, { ...base, voices: { lead: V3, counterpart: V1 } })).voices, { lead: V3, counterpart: V1 }, 'the same voices twice end the same')

    // Null clears exactly that part; the stored record keeps no key for a part that is none.
    const cleared = await put(ALICE, { ...base, voices: { lead: null } })
    assert.deepEqual(view(cleared).voices, { lead: null, counterpart: V1 }, 'null clears the lead and leaves the counterpart')
    assert.deepEqual((await store.settings.get(ALICE))?.voices, { counterpart: V1 }, 'and the stored record keeps no lead')
    assert.deepEqual(view(await call('GET', ALICE)).voices, { lead: null, counterpart: V1 })
    assert.deepEqual(view(await put(ALICE, { ...base })).voices, { lead: null, counterpart: V1 }, 'a cleared part stays cleared when `voices` is absent')
    const empty = await put(ALICE, { ...base, voices: { counterpart: null } })
    assert.deepEqual(view(empty).voices, none)
    assert.deepEqual(Object.keys((await store.settings.get(ALICE)) ?? {}).sort(), ['defaultStyle', 'readingDirection', 'updatedAt', 'userId'], 'with both cleared the record holds no voices key at all')
    await put(ALICE, { ...base, voices: { lead: V1, counterpart: V2 } })
    assert.deepEqual(view(await put(ALICE, { ...base, voices: { lead: null, counterpart: null } })).voices, none, 'both can be cleared in one save')

    // An unknown name is a 400 and changes nothing — not the voices, not the style, not the clock.
    await put(ALICE, { ...base, voices: { lead: V1, counterpart: V2 } })
    const before = JSON.stringify(await store.settings.get(ALICE))
    for (const bad of ['morgan', 'George', 'voice-1', '', ' george', 'george ']) {
      const r = await put(ALICE, { defaultStyle: 'manhwa-colour', readingDirection: 'ltr', voices: { lead: V3, counterpart: bad } })
      assert.equal(r.status, 400, `${JSON.stringify(bad)} is not a voice`)
      assert.equal(r.json?.error, DEFAULTS_UNREADABLE)
    }
    assert.equal(JSON.stringify(await store.settings.get(ALICE)), before, 'a refused save changes nothing (the good half of the body is not applied either)')

    // A voice this build no longer offers reads as none, and the next save drops it (keeping the valid part).
    await store.settings.put({ userId: ALICE, defaultStyle: 'manga-bw', readingDirection: 'rtl', voices: { lead: 'voice-1', counterpart: V2 }, updatedAt: '2026-10-01T00:00:00.000Z' })
    assert.deepEqual(view(await call('GET', ALICE)).voices, { lead: null, counterpart: V2 }, 'a retired voice reads as none')
    const dropped = await put(ALICE, { defaultStyle: 'manhwa-colour', readingDirection: 'ltr' })
    assert.deepEqual(view(dropped).voices, { lead: null, counterpart: V2 })
    const stored = await store.settings.get(ALICE)
    assert.deepEqual(stored?.voices, { counterpart: V2 }, 'the retired voice is dropped from the record by the next save')
    assert.equal(stored?.defaultStyle, 'manhwa-colour')
    assert.notEqual(stored?.updatedAt, '2026-10-01T00:00:00.000Z', 'updatedAt moved')

    // Each person's voices are their own.
    await store.settings.delete(BOB)
    assert.deepEqual(view(await put(BOB, { ...base, voices: { lead: V3 } })).voices, { lead: V3, counterpart: null })
    assert.deepEqual(view(await call('GET', ALICE)).voices, { lead: null, counterpart: V2 }, 'bob’s voices never reach alice')
    assert.deepEqual(view(await call('GET', BOB)).voices, { lead: V3, counterpart: null }, 'nor alice’s bob')
    ok('voices: every read and reply carries {lead, counterpart}; a name sets, absent keeps, null clears (no key kept for none); an unknown name (any case or spacing) is 400 and changes nothing; a retired voice reads as none and the next save drops it; each person’s voices are their own')
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

  // 7. copy ---------------------------------------------------------------------------------------
  {
    const root = join(import.meta.dirname, '..')
    const read = (file: string) => readFile(join(root, file), 'utf8')
    const privacy = await read('app/privacy/page.tsx')
    const terms = await read('app/terms/page.tsx')
    // Slice 21 shipped sharing, the Report button, the export and Delete account: neither page may still say they are coming.
    assert.doesNotMatch(privacy, /later version|next version|by hand|is coming/i, 'Privacy no longer says sharing or deletion is still to come')
    assert.doesNotMatch(terms, /is coming|until then/i, 'Terms no longer say the report button is still to come')
    assert.match(privacy, /anyone with the link|without signing in/i, 'Privacy says a shared page is readable without signing in')
    assert.match(privacy, /\/s\//, 'Privacy names the public link')
    assert.match(privacy, /Settings/, 'Privacy points at Settings for the export and deletion')
    assert.match(privacy, /Delete my account/, 'Privacy names the Delete my account button as Settings labels it')
    assert.doesNotMatch(privacy, /keeps only its own|Nothing of yours/i, 'Privacy does not claim nothing stays')
    assert.match(privacy, /backups/i, 'Privacy says backups and logs outlive the deletion')
    assert.match(privacy, /Clerk user id|record of the account/i, 'Privacy names the minimal record that stays')
    const deleteDialog = await read('components/SettingsDelete.tsx')
    assert.doesNotMatch(deleteDialog, /Nothing of yours|ends the sign-in early/, 'The delete dialog does not claim nothing stays, nor the old order')
    assert.match(deleteDialog, /backups/i, 'The delete dialog names backups among what stays')
    assert.match(privacy, /export/i, 'Privacy says what an export file is and where it is kept')
    assert.match(privacy, /outputs/i, 'Privacy says the export files are kept in the outputs bucket')
    assert.match(privacy, /report/i, 'Privacy says what a report keeps')
    assert.match(privacy, /hash/i, 'Privacy says the report keeps a hash of the address, not the address')
    assert.match(terms, /Report/, 'Terms point at the Report button')
    // The date moves with the words (the slice-19 text was dated 14 October 2026).
    for (const [name, text] of [['Privacy', privacy], ['Terms', terms]] as const) {
      const updated = /const UPDATED = '([^']+)'/.exec(text)?.[1]
      assert.ok(updated && updated !== '14 October 2026', `${name} has a new UPDATED date`)
    }
    // A share's direction comes from its style (a manga opens right to left), not from the owner's default: the Defaults page must not say otherwise.
    const defaults = await read('components/SettingsDefaults.tsx')
    assert.doesNotMatch(defaults, /on a page you share/i, 'Defaults does not promise the direction reaches a shared page')
    assert.match(defaults, /shared page opens right to left/i, 'Defaults says a shared page opens right to left')
    // The user menu is a way into Settings (PRD Core Journey step 7), not only Clerk's own profile modal.
    const auth = await read('components/AuthControls.tsx')
    assert.match(auth, /<UserButton[^>]*userProfileUrl="\/settings\/account"/, 'the account menu opens Settings, not a second account modal')
    ok('copy: Privacy and Terms describe public links, reports, export and deletion as they are; Defaults promises the direction for the studio only; the user menu opens Settings')
  }

  assert.deepEqual(outbound, [], 'nothing left the machine')
  console.log('\n  share-check-settings: all passed\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}
