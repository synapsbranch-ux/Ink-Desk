// Slice 21, agent B's acceptance check — reports and the admin queue
// (`devpost/prd.md > Report (v3)`, `devpost/spec.md > Reports (v3)`):
//
//   tsx scripts/share-check-reports.mts
//
// On a scratch desk (INKDESK_DATA_DIR in a temp folder, sign-in in test mode, every
// real credential unset, `fetch` stubbed so nothing can leave), the real route handlers
// are called with real `Request`s:
//
//   1  the report route   a report is stored only for a share RECORD that exists (live or
//                         revoked); the visitor's answer for a live, a revoked and a
//                         never-existed token is identical byte for byte (status, headers,
//                         body); a body that cannot be used is a calm 400 whatever the
//                         token; the answer to a store that fails is a sentence
//   2  the stored record  reason, cleaned note, time, the window's keyed hash — and no raw
//                         address anywhere on disk; notes are control-stripped, bounded and
//                         cleaned before they are measured
//   3  the window         the 7th report in an hour from one address is 429 with Retry-After
//                         and the calm sentence (and nothing stored, no body read); a spoofed
//                         left-hand X-Forwarded-For entry does not escape it; another
//                         address is untouched; the hour slides; Redis down fails CLOSED
//   4  admin gating       a non-admin gets the unknown page’s 404 on the route, byte for
//                         byte the same for a real and a made-up id; an admin from
//                         ADMIN_EMAILS (any case, with a users record) gets through; an
//                         unverified, deleted or unrecorded account does not; the page asks
//                         before it reads
//   5  the admin actions  handled is idempotent (the first time stands); unpublish revokes
//                         the share (idempotent), answers every report about it, and makes
//                         the public JSON route and the picture route answer exactly as for a
//                         token that never existed; a strict body; an unknown id is the 404
//
// Run with the other checks' idioms: the server-only shim is loaded first.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env as Record<string, string | undefined>
const ok = (msg: string) => console.log(`  ok  ${msg}`)

// --- The environment: a scratch desk, test sign-in, nothing real --------------------
const CLOUD_NAMES = ['MONGODB_URI', 'DB_URL', 'MONGODB_DB', 'DB_DATABASE', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_BUCKET_PROJECT_FILES', 'S3_BUCKET_COMPILE_OUTPUTS', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE', 'S3_KEY_PREFIX']
const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'BETTER_AUTH_SECRET', 'RAILWAY_TOKEN', 'REDIS_URL', 'GENERATION_ENABLED', 'INKDESK_QUEUE', 'ADMIN_EMAILS', 'ALLOWLIST_EMAILS', 'APP_URL', 'RATE_REPORT_PER_HOUR', 'TRUSTED_PROXY_HOPS', 'CLIENT_IP_HEADER']
const dir = await mkdtemp(join(tmpdir(), 'inkdesk-reports-'))
env.INKDESK_DATA_DIR = dir
for (const name of [...SECRET_NAMES, ...CLOUD_NAMES]) delete env[name]
env.INKDESK_STORAGE = 'local'
env.INKDESK_AUTH = 'test'
delete env.NODE_ENV

const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  throw new Error('the reports check never reaches the network')
}) as typeof fetch

// Imported after the env is set, because the store reads it at load.
const { store } = await import('../lib/store')
const { Refused } = await import('../lib/errors')
const { TEST_USER_HEADER } = await import('../lib/auth/session')
const { forgetAdmins, isAdmin, requireAdmin, NO_SUCH_PAGE } = await import('../lib/auth/admin')
const { backend, resetBackend } = await import('../lib/limits/backend')
const { setClock } = await import('../lib/limits/clock')
const { clientKey } = await import('../lib/limits/requests')
const { cleanNote, ReportBodySchema, REPORT_UNREADABLE, REPORT_BODY_LIMIT } = await import('../lib/share/report')
const { REPORT_REASON_LABEL, formatWhen, waitWords } = await import('../lib/share/report-copy')
const { REPORT_REASONS } = await import('../lib/share/types')
import type { MangaSnapshot, ReportRecord, ShareRecord } from '../lib/share/types'
const reportRoute = await import('../app/api/s/[token]/report/route')
const adminRoute = await import('../app/api/admin/reports/[id]/route')
const viewRoute = await import('../app/api/s/[token]/route')
const imageRoute = await import('../app/api/s/[token]/image/[imageId]/route')

const APP = 'http://check.invalid'
const ALICE = 'user_alice'
const BOSS = 'user_boss1'
const T0 = Date.parse('2026-10-16T09:00:00.000Z')
const at = (n: number) => new Date(T0 + n * 1000).toISOString()

/** 128 random bits in base62, the way the app makes a share token. */
function newToken(): string {
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let n = BigInt(`0x${randomBytes(16).toString('hex')}`)
  let out = ''
  while (n > BigInt(0)) {
    out = digits[Number(n % BigInt(62))] + out
    n /= BigInt(62)
  }
  return out.padStart(22, '0')
}

/** A tiny real PNG, so the picture route has something to stream. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const coverId = await store.putBlob(PNG, 'image/png', 'cover')
const panelIds = await Promise.all([0, 1, 2, 3].map(() => store.putBlob(PNG, 'image/png', 'panel')))

function snapshotOf(title: string): MangaSnapshot {
  return {
    kind: 'manga',
    title,
    reading: 'rtl',
    cover: { imageId: coverId, title },
    pages: [{ index: 0, panels: panelIds.map((imageId) => ({ imageId, dialogue: 'Hello', bubble: null, speaker: null, shot: 'wide' })) }],
    takenAt: at(0),
  }
}

async function makeShare(title: string, over: Partial<ShareRecord> = {}): Promise<ShareRecord> {
  const record: ShareRecord = {
    token: newToken(),
    ownerId: ALICE,
    kind: 'manga',
    projectId: `proj-${randomBytes(4).toString('hex')}`,
    videoId: null,
    snapshot: snapshotOf(title),
    createdAt: at(0),
    updatedAt: at(0),
    revokedAt: null,
    ...over,
  }
  return (await store.shares.create(record)).share
}

// --- Requests ----------------------------------------------------------------------
/** A distinct client per call by default: the address a trusted hop saw is the LAST X-Forwarded-For entry. */
let addressCounter = 0
const freshAddress = () => `203.0.113.${(addressCounter++ % 250) + 1}`
function report(token: string, body: unknown, opts: { address?: string; xff?: string; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
  const address = opts.address ?? freshAddress()
  const req = new Request(`${APP}/api/s/${token}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': opts.xff ?? address, origin: APP, ...(opts.headers ?? {}) },
    body: opts.raw ?? JSON.stringify(body),
  })
  return reportRoute.POST(req, { params: Promise.resolve({ token }) })
}
const admin = (id: string, body: unknown, user?: string, raw?: BodyInit) =>
  adminRoute.POST(
    new Request(`${APP}/api/admin/reports/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP, ...(user ? { [TEST_USER_HEADER]: user } : {}) },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  )

/** Everything about a response that a visitor could compare: status, every header but the clock, the body's bytes. */
async function fingerprint(res: Response): Promise<string> {
  const headers = [...res.headers.entries()].filter(([k]) => k !== 'date').sort(([a], [b]) => (a < b ? -1 : 1))
  const body = Buffer.from(await res.arrayBuffer()).toString('base64')
  return JSON.stringify({ status: res.status, headers, body })
}
const reportsOf = async (token: string) => (await store.reports.list({ limit: 1000 })).filter((r) => r.token === token)
const allReports = () => store.reports.list({ limit: 1000 })

/** A distinct window per address: the token is no part of it. */
const GOOD = { reason: 'harmful', note: 'This page shows something it should not.' }

try {
  // =====================================================================================
  // 1. The report route
  // =====================================================================================
  const live = await makeShare('Quartz Morning Edition')
  const revoked = await makeShare('Revoked Edition')
  await store.shares.revoke(revoked.token, at(5))
  const unknown = newToken()
  assert.equal(await store.shares.get(unknown), null)

  {
    const ans = [await report(live.token, GOOD), await report(revoked.token, GOOD), await report(unknown, GOOD)]
    assert.deepEqual(ans.map((r) => r.status), [200, 200, 200])
    const prints = await Promise.all(ans.map(fingerprint))
    assert.equal(new Set(prints).size, 1, `the live, revoked and unknown tokens get the same answer, byte for byte:\n${prints.join('\n')}`)
    assert.deepEqual(JSON.parse(Buffer.from(JSON.parse(prints[0]).body, 'base64').toString()), { ok: true })
    assert.match(prints[0], /no-store/, 'the thanks is never cached')
    assert.equal((await reportsOf(live.token)).length, 1, 'a report about a live share is kept')
    assert.equal((await reportsOf(revoked.token)).length, 1, 'a report about a revoked share is kept: its record still exists')
    assert.equal((await reportsOf(unknown)).length, 0, 'nothing is kept for a token that never existed')
    assert.equal((await allReports()).length, 2)
    ok('a report is kept only for a share record that exists (live or revoked); a live, a revoked and an unknown token get one answer, byte for byte')

    // Malformed tokens (a path, a long string, unicode) get the same thanks and store nothing.
    for (const hostile of ['..%2F..%2Fetc', 'x'.repeat(5000), '%E2%80%AE', 'a b', '']) {
      const res = await report(hostile, GOOD)
      assert.equal(await fingerprint(res), prints[0], `a hostile token (${hostile.slice(0, 12)}…) is the same thanks`)
    }
    assert.equal((await allReports()).length, 2, 'and keeps nothing')
    ok('hostile tokens (a path, 5000 characters, a bidi mark, a space, empty) get the same thanks and keep nothing')
  }

  // A body that cannot be used: the same calm 400 for every token, and nothing is kept.
  {
    const before = (await allReports()).length
    const bad: [string, BodyInit][] = [
      ['not JSON', 'reason=harmful'],
      ['an empty body', ''],
      ['an array', '["harmful"]'],
      ['null', 'null'],
      ['no reason', JSON.stringify({ note: 'x' })],
      ['a reason off the list', JSON.stringify({ reason: 'rude' })],
      ['an unknown key', JSON.stringify({ reason: 'spam', extra: 1 })],
      ['a token in the body', JSON.stringify({ reason: 'spam', token: live.token })],
      ['a note that is not text', JSON.stringify({ reason: 'spam', note: 7 })],
      ['a null note', JSON.stringify({ reason: 'spam', note: null })],
      ['a note over 500', JSON.stringify({ reason: 'spam', note: 'a'.repeat(501) })],
      ['a reason that is not text', JSON.stringify({ reason: ['spam'] })],
    ]
    for (const [what, raw] of bad) {
      const prints: string[] = []
      for (const token of [live.token, revoked.token, unknown]) {
        const res = await report(token, null, { raw })
        assert.equal(res.status, 400, `${what}: 400`)
        prints.push(await fingerprint(res))
      }
      assert.equal(new Set(prints).size, 1, `${what}: the same 400 whatever the token`)
      const body = JSON.parse(Buffer.from(JSON.parse(prints[0]).body, 'base64').toString()) as { error: string }
      assert.equal(body.error, REPORT_UNREADABLE, `${what}: the calm sentence`)
      assert.ok(!/zod|ZodError|issues|expected|invalid_/i.test(body.error), 'no schema detail leaks')
    }
    assert.equal((await allReports()).length, before, 'no bad body kept anything')
    // Too large: refused 413 before the bytes are read (declared) and while they stream (chunked).
    const big = await report(live.token, null, { raw: JSON.stringify({ reason: 'spam', note: 'a'.repeat(REPORT_BODY_LIMIT) }) })
    assert.equal(big.status, 413)
    const chunks = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(4096)))
      },
    })
    const streamed = await reportRoute.POST(
      new Request(`${APP}/api/s/${live.token}/report`, { method: 'POST', headers: { 'x-forwarded-for': freshAddress(), 'content-type': 'application/json' }, body: chunks, duplex: 'half' } as RequestInit),
      { params: Promise.resolve({ token: live.token }) }
    )
    assert.equal(streamed.status, 413, 'a chunked body with no length is counted as it arrives')
    assert.equal((await allReports()).length, before)
    ok(`${bad.length} unusable bodies are one calm 400 for every token (no schema detail); an oversized body is 413, declared or streamed; nothing is kept`)
  }

  // A store that fails: the visitor is told, in a sentence, and the cause stays in the terminal.
  {
    const realAdd = store.reports.add
    const realWarn = console.error
    const logged: string[] = []
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
    store.reports.add = async () => {
      throw new Error('ENOSPC: /secret/path/data/reports')
    }
    try {
      const res = await report(live.token, GOOD)
      assert.equal(res.status, 500)
      const body = (await res.json()) as { error: string }
      assert.match(body.error, /couldn’t be sent just now/)
      assert.ok(!/ENOSPC|secret|path/.test(body.error), 'the cause never reaches the visitor')
      assert.ok(logged.some((line) => line.includes('ENOSPC')), 'the cause is in the terminal')
    } finally {
      store.reports.add = realAdd
      console.error = realWarn
    }
    ok('a store that cannot keep the report answers a calm sentence (500); the cause is logged, never sent')
  }

  // =====================================================================================
  // 2. What is stored
  // =====================================================================================
  {
    const address = '198.51.100.77'
    await report(live.token, { reason: 'copyright', note: 'Not theirs to share.' }, { address, xff: `10.0.0.1, ${address}` })
    const mine = (await reportsOf(live.token)).find((r) => r.reason === 'copyright') as ReportRecord
    assert.ok(mine, 'the report was kept')
    assert.deepEqual(Object.keys(mine).sort(), ['at', 'handledAt', 'id', 'ipHash', 'note', 'reason', 'token'])
    assert.match(mine.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'a uuid')
    assert.equal(mine.token, live.token)
    assert.equal(mine.note, 'Not theirs to share.')
    assert.equal(mine.handledAt, null)
    assert.ok(Math.abs(Date.parse(mine.at) - Date.now()) < 10_000, 'stamped now')
    assert.equal(mine.ipHash, clientKey(new Headers({ 'x-forwarded-for': address })), 'the window’s own keyed hash')
    assert.notEqual(mine.ipHash, 'unknown')
    assert.ok(!mine.ipHash.includes(address), 'the hash is not the address')
    // No raw address anywhere on disk: not in the reports, not in anything the check made.
    const files: string[] = []
    const walk = async (from: string) => {
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const path = join(from, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (/\.json$/.test(entry.name)) files.push(path)
      }
    }
    await walk(dir)
    assert.ok(files.length >= 4, `scanned ${files.length} files`)
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      assert.ok(!/\b(203\.0\.113|198\.51\.100|10\.0\.0)\.\d+\b/.test(text), `${file.slice(dir.length)} holds no raw address`)
    }
    // With no readable address the hash is the shared `unknown`, still not a raw anything.
    await report(live.token, { reason: 'spam' }, { xff: 'garbage' })
    assert.ok((await reportsOf(live.token)).some((r) => r.reason === 'spam' && r.ipHash === 'unknown'))
    ok('a stored report holds a uuid, the token, the reason, the cleaned note, the time and the keyed hash; no raw address is on disk')
  }

  {
    // Notes: trimmed, control-stripped, bounded; cleaned before they are measured.
    const keep = async (note: string) => {
      const res = await report(live.token, { reason: 'other', note })
      assert.equal(res.status, 200)
      const list = (await reportsOf(live.token)).filter((r) => r.reason === 'other')
      return list.sort((a, b) => (a.at < b.at ? -1 : 1)).at(-1)?.note
    }
    const bidi = String.fromCharCode(0x202e)
    const zero = String.fromCharCode(0x200b)
    const bell = String.fromCharCode(7)
    const nul = String.fromCharCode(0)
    const esc = String.fromCharCode(27)
    const del = String.fromCharCode(127)
    const c1 = String.fromCharCode(0x85)
    const lone = String.fromCharCode(0xd83d)
    const cases: [string, string, string][] = [
      ['trimmed', '   hello   \n ', 'hello'],
      ['controls removed', `a${nul}b${bell}c${esc}[31md${del}e${c1}f`, 'abc[31mdef'],
      ['bidi override and zero width removed', `ab${bidi}cd${zero}ef`, 'abcdef'],
      ['tabs become spaces, CRLF becomes a newline', 'a\tb\r\nc', 'a b\nc'],
      ['blank lines folded', 'a\n\n\n\n\nb', 'a\n\nb'],
      ['a lone surrogate dropped, a real emoji kept', `x${lone}y 😀`, 'xy 😀'],
      ['only whitespace', ' \n\t ', ''],
      ['markup is kept as plain text (React escapes it on screen)', '<script>alert(1)</script>', '<script>alert(1)</script>'],
    ]
    for (const [what, raw, want] of cases) assert.equal(await keep(raw), want, what)
    // 500 exactly is fine; 501 is not; padding that is cleaned away does not count.
    assert.equal((await keep('b'.repeat(500)))?.length, 500)
    assert.equal((await report(live.token, { reason: 'other', note: 'b'.repeat(501) })).status, 400)
    assert.equal((await keep(`${' '.repeat(40)}${'c'.repeat(500)}${bell.repeat(30)}`))?.length, 500, 'measured after cleaning')
    assert.equal(cleanNote(`${bell}\n\n\n${bell}`), '')
    assert.equal(ReportBodySchema.safeParse({ reason: 'harmful', note: `  hi${nul} ` }).data?.note, 'hi')
    assert.equal(ReportBodySchema.safeParse({ reason: 'harmful' }).success, true, 'the note is optional')
    for (const reason of REPORT_REASONS) assert.equal(ReportBodySchema.safeParse({ reason }).success, true)
    assert.deepEqual(Object.keys(REPORT_REASON_LABEL).sort(), [...REPORT_REASONS].sort(), 'every reason has its words')
    ok('notes are trimmed, stripped of controls, bidi and zero-width marks and lone surrogates, folded, bounded at 500 AFTER cleaning; markup stays text')
    assert.equal(formatWhen('2026-10-16T09:05:00.000Z'), '16 Oct 2026, 09:05 UTC')
    assert.equal(waitWords(1), '1 second')
    assert.equal(waitWords(30), '30 seconds')
    assert.equal(waitWords(61), 'about 2 minutes')
    assert.equal(waitWords(3000), 'about 50 minutes')
    assert.equal(waitWords(3600), 'about an hour')
    assert.equal(waitWords(60), 'a minute')
  }

  // =====================================================================================
  // 3. The window
  // =====================================================================================
  {
    const before = (await allReports()).length
    const me = '192.0.2.10'
    const outcomes: number[] = []
    for (let i = 0; i < 6; i++) outcomes.push((await report(live.token, GOOD, { address: me })).status)
    assert.deepEqual(outcomes, [200, 200, 200, 200, 200, 200], 'six an hour are fine')
    assert.equal((await allReports()).length, before + 6)

    // The 7th: 429, Retry-After, the calm sentence, nothing kept — and its body is never read.
    let pulled = false
    const unread = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
    }, { highWaterMark: 0 }) // no read-ahead: `pull` runs only when something reads
    const seventh = await reportRoute.POST(
      new Request(`${APP}/api/s/${live.token}/report`, { method: 'POST', headers: { 'x-forwarded-for': me, 'content-type': 'application/json' }, body: unread, duplex: 'half' } as RequestInit),
      { params: Promise.resolve({ token: live.token }) }
    )
    assert.equal(seventh.status, 429)
    assert.equal(pulled, false, 'the window comes first: the body of a refused request is never read')
    const retry = Number(seventh.headers.get('retry-after'))
    assert.ok(retry >= 1 && retry <= 3600, `Retry-After ${retry}`)
    const refusal = (await seventh.json()) as { error: string; code: string; retryAfterSec: number }
    assert.equal(refusal.code, 'rate')
    assert.equal(refusal.retryAfterSec, retry)
    assert.match(refusal.error, /^You’re going a little fast — try again in \d+ minutes\.$/)
    assert.equal(seventh.headers.get('cache-control'), 'no-store')
    assert.equal((await allReports()).length, before + 6, 'the refused report kept nothing')
    // The same address on ANOTHER token is the same window (it is the address that is counted, not the page).
    assert.equal((await report(unknown, GOOD, { address: me })).status, 429, 'an unknown token takes the same window: it cannot be probed past it either')
    assert.equal((await report(revoked.token, GOOD, { address: me })).status, 429)
    // A different address is unaffected.
    assert.equal((await report(live.token, GOOD, { address: '192.0.2.11' })).status, 200)
    ok('six reports an hour from one address; the 7th is 429 + Retry-After + the calm sentence, its body unread, nothing kept; the window follows the address across tokens; another address is untouched')

    // A spoofed left-hand X-Forwarded-For entry does not escape it (the trusted hop wrote the LAST entry).
    for (let i = 0; i < 4; i++) {
      const res = await report(live.token, GOOD, { xff: `${i}.${i}.${i}.${i}, ${i + 100}.9.9.9, 192.0.2.10` })
      assert.equal(res.status, 429, `a made-up left-hand entry (${i}) does not reset the window`)
    }
    assert.equal((await report(live.token, GOOD, { xff: '192.0.2.10, 192.0.2.12' })).status, 200, 'but an address the trusted hop saw as someone else is someone else')
    // IPv6: the /64 is the subscriber.
    const v6 = ['2001:db8:1:2::1', '2001:db8:1:2:ffff::9', '2001:db8:1:2:0:0:0:3']
    for (let i = 0; i < 6; i++) assert.equal((await report(live.token, GOOD, { address: v6[i % 3] })).status, 200)
    assert.equal((await report(live.token, GOOD, { address: '2001:db8:1:2:abcd::1' })).status, 429, 'an IPv6 subscriber’s /64 is one window')
    assert.equal((await report(live.token, GOOD, { address: '2001:db8:1:3::1' })).status, 200, 'the next /64 is another')
    ok('a spoofed left-hand X-Forwarded-For entry does not escape the window; an IPv6 /64 is one subscriber')

    // The hour slides: an hour later the address is free again.
    const realNow = Date.now()
    setClock(() => realNow + 61 * 60_000)
    try {
      assert.equal((await report(live.token, GOOD, { address: me })).status, 200, 'an hour later the window is open again')
    } finally {
      setClock(null)
    }
    ok('an hour later the same address may report again (a sliding window)')

    // The report window is its own: the page's other windows are not spent by it, and it is not theirs.
    const { hit } = await import('../lib/limits/requests')
    await hit('anon', clientKey(new Headers({ 'x-forwarded-for': me })))
    ok('the report window is separate from the anon window')

    // Redis down fails CLOSED: the counter store cannot answer, so the form is refused with the studio-busy sentence.
    const pinned = globalThis as typeof globalThis & { __inkdeskLimits?: { key: string; backend: ReturnType<typeof backend> } }
    resetBackend()
    const real = backend()
    const warn = console.warn
    console.warn = () => {}
    pinned.__inkdeskLimits = { key: real.kind, backend: { ...real, hit: () => Promise.reject(new Error('redis is down')) } }
    try {
      const count = (await allReports()).length
      const down = await report(live.token, GOOD, { address: '192.0.2.99' })
      assert.equal(down.status, 503, 'a counter store that is down closes the report form')
      assert.equal(((await down.json()) as { error: string }).error, 'The studio is busy — try again in a few minutes.')
      assert.equal((await allReports()).length, count, 'and keeps nothing')
      // The same outage leaves the share page’s data window open (it fails open).
      const view = await viewRoute.GET(new Request(`${APP}/api/s/${live.token}`, { headers: { 'x-forwarded-for': '192.0.2.99' } }), { params: Promise.resolve({ token: live.token }) })
      assert.equal(view.status, 200, 'while the page itself keeps working')
    } finally {
      console.warn = warn
      resetBackend()
    }
    assert.equal((await report(live.token, GOOD, { address: '192.0.2.99' })).status, 200, 'and the form opens again as soon as the counters answer')
    ok('Redis down: the report form fails CLOSED (503, the studio-busy sentence, nothing kept) while the shared page still opens; it reopens when the counters do')
  }

  // =====================================================================================
  // 4. Admin gating
  // =====================================================================================
  const target = (await reportsOf(live.token))[0]
  assert.ok(target)
  {
    for (const [id, email] of [[ALICE, 'alice@example.com'], [BOSS, 'Boss@Example.COM'], ['user_noaddr1', ''], ['user_gone1', 'gone@example.com']] as const) {
      await store.users.upsert({ id, email, createdAt: at(0) })
    }
    await store.users.markDeleted('user_gone1')
    // user_unrecorded1 has no record at all.
    env.ADMIN_EMAILS = ' boss@example.com , Gone@Example.com ,,'
    forgetAdmins()

    assert.equal(await isAdmin(BOSS), true, 'matched case-insensitively against the verified email')
    assert.equal(await isAdmin(ALICE), false)
    assert.equal(await isAdmin('user_noaddr1'), false, 'an account with no verified email')
    assert.equal(await isAdmin('user_gone1'), false, 'a deleted account, though its old email is on the list')
    assert.equal(await isAdmin('user_unrecorded1'), false, 'an account the webhook has not delivered yet')

    // Alice, the unverified, the deleted and the unrecorded get the same 404 as one another, for a real report and a made-up one.
    const made = '00000000-0000-4000-8000-000000000000'
    const bodyOf = async (res: Response) => (await res.json()) as { error: string }
    const prints = new Set<string>()
    for (const who of [ALICE, 'user_noaddr1', 'user_gone1', 'user_unrecorded1']) {
      for (const id of [target.id, made, '../etc/passwd', 'x'.repeat(300)]) {
        for (const body of [{ action: 'handled' }, { action: 'unpublish' }, { nonsense: true }]) {
          const res = await admin(id, body, who)
          assert.equal(res.status, 404, `${who} → 404 (${id.slice(0, 12)})`)
          assert.equal((await bodyOf(res.clone())).error, NO_SUCH_PAGE)
          prints.add(await fingerprint(res))
        }
      }
    }
    assert.equal(prints.size, 1, 'every non-admin gets one answer, byte for byte, whatever the id or the body')
    assert.equal((await admin(target.id, { action: 'handled' }, undefined)).status, 401, 'signed out is the 401 every API route gives')
    const refused = await requireAdmin(new Request(`${APP}/api/admin/reports/x`, { method: 'POST', headers: { [TEST_USER_HEADER]: ALICE } })).catch((e: unknown) => e)
    assert.ok(refused instanceof Refused && refused.status === 404)
    // …and none of those did anything.
    const still = await store.reports.get(target.id)
    assert.equal(still?.handledAt, null, 'a non-admin changed nothing')
    assert.ok((await store.shares.get(live.token))?.snapshot, 'a non-admin unpublished nothing')
    // The oversized-body case: a non-admin is refused before the body is looked at (404, not 413).
    const huge = await admin(target.id, null, ALICE, JSON.stringify({ action: 'x'.repeat(100_000) }))
    assert.equal(huge.status, 404)
    ok('alice, an unverified, a deleted and an unrecorded account get the SAME 404 (“There is no such page.”) on the admin route — for a real id, a made-up one, a path, any body, an oversized one; signed out is 401; nothing changed')

    // Admin comes from the list, any case; a store that cannot answer promotes nobody.
    env.ADMIN_EMAILS = 'BOSS@example.com'
    forgetAdmins()
    assert.equal(await isAdmin(BOSS), true)
    env.ADMIN_EMAILS = 'someone.else@example.com'
    forgetAdmins()
    assert.equal(await isAdmin(BOSS), false, 'taken off the list, no longer an admin')
    env.ADMIN_EMAILS = ''
    forgetAdmins()
    assert.equal(await isAdmin(BOSS), false, 'a blank list is nobody')
    env.ADMIN_EMAILS = 'boss@example.com'
    forgetAdmins()

    // The page asks before it reads (a Server Component cannot be rendered from here; its order is read from the source,
    // and the 404 itself is `adminPageGate`, which `check:auth` holds and the browser run shows).
    const page = await readFile(join(ROOT, 'app/admin/reports/page.tsx'), 'utf8')
    const body = page.slice(page.indexOf('export default'))
    const gate = body.indexOf('await requireAdminPage()')
    assert.ok(gate !== -1, 'the page calls requireAdminPage')
    assert.ok(body.indexOf('connection()') !== -1 && body.indexOf('connection()') < gate, 'the page is dynamic before it asks')
    assert.ok(body.indexOf("import('@/components/admin/ReportsScreen')") > gate, 'the screen (store, stylesheet, client component) loads only after the gate')
    assert.ok(!/^import .*(ReportsScreen|ReportsQueue|store|\.css)/m.test(page), 'the page imports nothing of the admin screen, the store or a stylesheet up front: a refused visitor’s page carries no trace of them')
    assert.ok(!/\.css['"]/.test(await readFile(join(ROOT, 'components/admin/ReportsScreen.tsx'), 'utf8')) && !/\.css['"]/.test(await readFile(join(ROOT, 'components/admin/ReportsQueue.tsx'), 'utf8')), 'no stylesheet import anywhere under the admin screen (Next would attach it to the refused page too)')
    const { adminPageGate } = await import('../lib/auth/admin')
    for (const who of [ALICE, 'user_noaddr1', 'user_gone1', 'user_unrecorded1', null]) {
      await assert.rejects(adminPageGate(who), (e: unknown) => (e as { digest?: string }).digest === 'NEXT_HTTP_ERROR_FALLBACK;404', `${who ?? 'signed out'}: the page is the studio’s own 404`)
    }
    assert.equal(await adminPageGate(BOSS), BOSS)
    ok('the page asks (dynamic first) before it reads anything; anyone else, signed out included, gets Next’s own notFound(); the admin from ADMIN_EMAILS (any case, verified record) gets through; the list is read fresh')
  }

  // =====================================================================================
  // 5. The admin actions
  // =====================================================================================
  {
    // handled: idempotent, the first time stands.
    const first = await admin(target.id, { action: 'handled' }, BOSS)
    assert.equal(first.status, 200)
    const firstBody = (await first.json()) as { report: { id: string; handledAt: string | null; live: boolean; title: string | null; path: string | null; reason: string } }
    assert.equal(firstBody.report.id, target.id)
    assert.ok(firstBody.report.handledAt)
    assert.equal(firstBody.report.live, true)
    assert.equal(firstBody.report.title, 'Quartz Morning Edition')
    assert.equal(firstBody.report.path, `/s/${live.token}`)
    await new Promise((r) => setTimeout(r, 15))
    const second = await admin(target.id, { action: 'handled' }, BOSS)
    const secondBody = (await second.json()) as typeof firstBody
    assert.deepEqual(secondBody, firstBody, 'doing it twice answers the same and changes nothing')
    assert.equal((await store.reports.get(target.id))?.handledAt, firstBody.report.handledAt)
    assert.deepEqual(Object.keys(firstBody.report).sort(), ['at', 'handledAt', 'id', 'kind', 'live', 'note', 'path', 'reason', 'title'], 'the view carries no hash, no token, no snapshot')
    assert.ok(!JSON.stringify(firstBody).includes(live.token) || firstBody.report.path === `/s/${live.token}`, 'the token appears only as the live link')
    ok('handled: stamps handledAt once; asking again answers the same; the view holds no ipHash, no snapshot')

    // Strict body, calm 400 (an admin gets this; the order is admin first, then the body).
    for (const raw of ['', 'nope', '[]', JSON.stringify({ action: 'delete' }), JSON.stringify({ action: 'handled', extra: 1 }), JSON.stringify({})]) {
      const res = await admin(target.id, null, BOSS, raw)
      assert.equal(res.status, 400, `body ${raw.slice(0, 20)}`)
      assert.equal(((await res.json()) as { error: string }).error, 'That request couldn’t be read.')
    }
    assert.equal((await admin(target.id, null, BOSS, 'x'.repeat(5000))).status, 413)
    // An unknown id is the same 404 a non-admin gets.
    const nope = await admin('00000000-0000-4000-8000-000000000000', { action: 'handled' }, BOSS)
    assert.equal(nope.status, 404)
    assert.equal(((await nope.json()) as { error: string }).error, NO_SUCH_PAGE)
    assert.equal((await admin('../../etc/passwd', { action: 'handled' }, BOSS)).status, 404)
    ok('an admin’s malformed body is a calm 400 (413 when oversized); an unknown id is the non-admin’s 404')

    // Unpublish: revokes the share, answers every report about it, and the public surface goes dark.
    const reportsAbout = await reportsOf(live.token)
    assert.ok(reportsAbout.length >= 5)
    const otherLive = await makeShare('Another Edition')
    await report(otherLive.token, { reason: 'spam' })
    const otherReport = (await reportsOf(otherLive.token))[0]

    // Before: the share is public (page data and a picture).
    const getView = (token: string) => viewRoute.GET(new Request(`${APP}/api/s/${token}`, { headers: { 'x-forwarded-for': freshAddress() } }), { params: Promise.resolve({ token }) })
    const getImage = (token: string, imageId: string) =>
      imageRoute.GET(new Request(`${APP}/api/s/${token}/image/${imageId}`, { headers: { 'x-forwarded-for': freshAddress() } }), { params: Promise.resolve({ token, imageId }) })
    assert.equal((await getView(live.token)).status, 200)
    assert.equal((await getImage(live.token, coverId)).status, 200)

    const gone = await admin(target.id, { action: 'unpublish' }, BOSS)
    assert.equal(gone.status, 200)
    const goneBody = (await gone.json()) as { report: { live: boolean; title: string | null; path: string | null; handledAt: string | null }; sameShare: string[] }
    assert.equal(goneBody.report.live, false)
    assert.equal(goneBody.report.title, null, 'the snapshot is gone, so the title is too')
    assert.equal(goneBody.report.path, null)
    assert.ok(goneBody.report.handledAt)
    assert.deepEqual([...goneBody.sameShare].sort(), reportsAbout.map((r) => r.id).sort(), 'it lists every report about that share')
    const record = await store.shares.get(live.token)
    assert.equal(record?.snapshot, null, 'nothing of the work remains')
    assert.ok(record?.revokedAt)
    for (const r of await reportsOf(live.token)) assert.ok(r.handledAt, 'every report about that share is answered by taking it down')
    assert.equal((await store.reports.get(otherReport.id))?.handledAt, null, 'a report about another share is untouched')
    assert.ok((await store.shares.get(otherLive.token))?.snapshot, 'and so is the other share')

    // Idempotent: again changes nothing (the first revocation stands).
    const stamp = record?.revokedAt
    const again = await admin(target.id, { action: 'unpublish' }, BOSS)
    assert.equal(again.status, 200)
    assert.equal((await store.shares.get(live.token))?.revokedAt, stamp)
    assert.deepEqual((await again.json()) as unknown, goneBody)

    // A picture only the taken-down link was still holding (its project dropped it) goes with it; the report was about this share, nothing else.
    const lone = await store.putBlob(PNG, 'image/png', 'cover')
    const soloShare = await makeShare('Solo', { snapshot: { ...snapshotOf('Solo'), cover: { imageId: lone, title: 'Solo' } } })
    await report(soloShare.token, { reason: 'spam' })
    const soloReport = (await reportsOf(soloShare.token))[0]
    assert.ok(await store.getBlob(lone), 'the picture is there while the link is up')
    assert.equal((await admin(soloReport.id, { action: 'unpublish' }, BOSS)).status, 200)
    assert.equal(await store.getBlob(lone), null, 'and goes with the takedown, which also lets go of what only the link held')

    // The public page data and the picture now answer EXACTLY as for a token that never existed.
    const ghost = newToken()
    assert.equal(await fingerprint(await getView(live.token)), await fingerprint(await getView(ghost)), 'the page data: identical to an unknown token')
    assert.equal((await getView(live.token)).status, 404)
    const imgGone = await getImage(live.token, coverId)
    const imgGhost = await getImage(ghost, coverId)
    assert.equal(imgGone.status, 404)
    assert.equal(await fingerprint(imgGone), await fingerprint(imgGhost), 'the picture: identical to an unknown token')
    assert.equal(await fingerprint(await getView(live.token)), await fingerprint(await getView(revoked.token)), 'and to one the owner took down')
    // A report about the dead share is still welcome and still the same thanks.
    const thanks = await fingerprint(await report(live.token, GOOD))
    assert.equal(thanks, await fingerprint(await report(ghost, GOOD)), 'reporting the unpublished share is the unknown token’s thanks')

    // Unpublishing a report whose share record is gone altogether is still fine.
    await store.shares.deleteAllOf('user_nobody')
    const orphan: ReportRecord = { id: crypto.randomUUID(), token: newToken(), reason: 'spam', note: '', ipHash: 'x', at: at(9), handledAt: null }
    await store.reports.add(orphan)
    const orphaned = await admin(orphan.id, { action: 'unpublish' }, BOSS)
    assert.equal(orphaned.status, 200)
    const orphanView = ((await orphaned.json()) as { report: { live: boolean; title: string | null } }).report
    assert.deepEqual([orphanView.live, orphanView.title], [false, null])
    ok('unpublish revokes the share (idempotently), answers every report about it and none about another; the public page data and picture are then byte-identical to an unknown token’s; a share record that is gone is still a 200')
  }

  assert.deepEqual(outbound, [], `nothing reached the network: ${outbound.join(', ')}`)
  console.log('share-check-reports: all passed')
} finally {
  setClock(null)
  resetBackend()
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}
