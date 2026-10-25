// Slice 23's judge-account check, for `scripts/seed-judge.mts` — the $0 copy of a
// finished chapter (and its trailer) to the judges' demo account:
//
//   npm run check:judge   (or: npx tsx scripts/judge-check.mts)
//
// On a scratch desk copied from `data/filming-2026-10-14` (never the tracked one),
// with sign-in in test mode and `fetch` stubbed (nothing leaves this machine). The
// filmed project is claimed by user_learner and given a finished trailer whose
// files ffmpeg makes from `testsrc` (no provider), a newer failed one, a share, a
// report and a job. Then the script runs as the learner would run it, and:
//
//   1. --dry-run writes nothing: every file of the desk is byte-identical after;
//   2. the copy is user_judge's, under a new project id and new picture ids, is marked
//      a copy without naming the learner's ids (its data export would show them), and every picture of it is the source's picture byte for
//      byte, served by the owner-checked image route to the judge — and a 404 for a
//      third account and for the learner; the learner's own pictures stay a 404 to
//      the judge, through the copy's address or the source's;
//   3. the source is byte-identical (every file of it), and no share, report, job or
//      setting is the judge's;
//   4. a second run finds the copy and changes nothing (the whole desk is identical);
//   5. --with-trailer adds the latest FINISHED trailer: listed for the judge on the
//      copy, its three files served (whole and by range) and equal to the source's,
//      its plan's pictures the copy's, its files under the judge's folder; a third
//      account gets 404; a second run changes nothing;
//   6. the refusals: a target that is not an account, copying to the source's own
//      owner, cloud without INKDESK_JUDGE_CONFIRMED=yes; a source missing a picture
//      (nothing stored) and a trailer missing its poster (what it copied taken back);
//   7. the judge's account deletion removes the copy, its pictures, its trailer and
//      its files, and leaves the source exactly as it was; a deleted account is not
//      seeded again.
//   8. (optional) the cloud path, as the learner runs it in production: with a Mongo
//      URL and the S3 settings pointing at stand-ins ON THIS MACHINE (a mongod, moto)
//      and INKDESK_CHECK_CLOUD=yes, a child of this file stores the filmed project and
//      a finished trailer through the cloud store, on a scratch database dropped at the
//      end, and runs the script with INKDESK_STORAGE=cloud INKDESK_JUDGE_CONFIRMED=yes:
//      --dry-run writes nothing, the copy's pictures and trailer files serve to the
//      judge and 404 to a third account, a second run changes nothing. Skipped, and
//      said so, when either is unset; refused for a database or endpoint elsewhere.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DESK = join(ROOT, 'data', 'filming-2026-10-14')
const ok = (msg: string) => console.log(`  ok  ${msg}`)
const section = (n: number, title: string) => console.log(`\n${n}. ${title}`)

// --- The environment: a scratch desk, nothing real ----------------------------------------
const env = process.env as Record<string, string | undefined>
// Section 8 runs in a child of this file (`--cloud-child`), given only the cloud settings captured here, before the scrub.
const CLOUD_CHILD = process.argv[2] === '--cloud-child'
const CLOUD_NAMES = ['MONGODB_URI', 'DB_URL', 'MONGODB_DB', 'DB_DATABASE', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_BUCKET_PROJECT_FILES', 'S3_BUCKET_COMPILE_OUTPUTS', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE', 'S3_KEY_PREFIX']
const cloudGiven: Record<string, string> = Object.fromEntries(CLOUD_NAMES.filter((name) => env[name]?.trim()).map((name) => [name, env[name] as string]))
const checkCloud = env.INKDESK_CHECK_CLOUD === 'yes'
for (const name of Object.keys(env)) {
  if (CLOUD_CHILD && CLOUD_NAMES.includes(name)) continue
  if (/^(BETTER_AUTH_|S3_|DB_|MONGODB_|REDIS_|RAILWAY_|ANTHROPIC_|OPENROUTER_|ELEVENLABS_|INKDESK_|IMAGE_|QUOTA_|RATE_|USER_DAILY_|GLOBAL_|ALLOWLIST_|TRUSTED_|QUEUE_|GENERATION_|LLM_|VIDEO_)/.test(name)) delete env[name]
}
const work = await mkdtemp(join(tmpdir(), 'inkdesk-judge-'))
const dir = join(work, 'desk')
const media = join(work, 'media')
await cp(SOURCE_DESK, dir, { recursive: true })
env.INKDESK_DATA_DIR = dir
env.INKDESK_STORAGE = CLOUD_CHILD ? 'cloud' : 'local'
env.INKDESK_AUTH = 'test'
env.INKDESK_QUEUE = 'inline'
env.INKDESK_LIMITS = 'off'
delete env.NODE_ENV

const outbound: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  throw new Error('the judge check never reaches a provider')
}) as typeof fetch

// Imported after the environment is set, because the store reads it at load.
const { store } = await import('../lib/store')
const { projectImageIds, ownedProject } = await import('../lib/auth/access')
const { newVideoRecord, markVideoDone, markVideoFailed, videoKeys } = await import('../lib/video/record')
const { planTrailer } = await import('../lib/video/plan')
const { newJob, claim, deleteAccountKey } = await import('../lib/queue/jobs')
const { deleteAccount } = await import('../lib/account/deletion')
const imageRoute = await import('../app/api/projects/[id]/image/[imageId]/route')
const videosRoute = await import('../app/api/projects/[id]/videos/route')
const fileRoute = await import('../app/api/videos/[videoId]/file/[name]/route')
import type { Project } from '../lib/types'
import type { VideoRecord } from '../lib/share/types'
import type { VideoView } from '../lib/video/types'

const LEARNER = 'user_learner'
const JUDGE = 'user_judge'
const THIRD = 'user_third'

/** Every file under the desk, by path, with its sha256 — what "nothing changed" is measured against. */
async function tree(at = dir): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const walk = async (d: string) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) await walk(full)
      else found.set(relative(at, full), createHash('sha256').update(await readFile(full)).digest('hex'))
    }
  }
  await walk(at)
  return found
}
const same = (a: Map<string, string>, b: Map<string, string>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)
/** What differs between two snapshots, by path: what an assertion names when they are not the same. */
const changed = (a: Map<string, string>, b: Map<string, string>) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort()
/** Every file of `before` is still there with the same bytes. */
function kept(before: Map<string, string>, after: Map<string, string>, what: string): void {
  for (const [path, hash] of before) assert.equal(after.get(path), hash, `${what}: ${path} is unchanged`)
}

/** Run the script as the learner would. */
function seed(args: string[], extra: Record<string, string> = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...extra }
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'seed-judge.mts'), ...args], { cwd: ROOT, env: childEnv, encoding: 'utf8', timeout: 120_000 })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
async function call(handler: Handler, params: Record<string, string>, who: string, headers: Record<string, string> = {}, method = 'GET') {
  const res = await handler(new Request('http://check/api', { method, headers: { 'x-inkdesk-test-user': who, ...headers } }), { params: Promise.resolve(params) })
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) }
}

/** Source and copy pictures, paired by where they sit: sheets, uploads, cover versions, panel versions. */
function pairs(a: Project, b: Project): [string, string][] {
  const out: [string, string][] = []
  a.library.characters.forEach((c, i) => c.sheetImageId && out.push([c.sheetImageId, b.library.characters[i].sheetImageId ?? '']))
  a.library.assets.forEach((x, i) => out.push([x.blobId, b.library.assets[i].blobId]))
  a.chapters.forEach((ch, ci) => {
    ch.cover?.versions.forEach((v, vi) => out.push([v.imageId, b.chapters[ci].cover?.versions[vi].imageId ?? '']))
    ch.pages.forEach((p, pi) => p.panels.forEach((n, ni) => n.versions.forEach((v, vi) => out.push([v.imageId, b.chapters[ci].pages[pi].panels[ni].versions[vi].imageId]))))
  })
  return out
}

/** An account deletion as the worker runs it (no sign-in to end on a test desk, no counters to purge), then the processor's last step (`forgetDeletion`). */
async function deleteAccountOf(owner: string) {
  const job = claim(newJob({ key: deleteAccountKey(owner), ownerId: owner, projectId: '', kind: 'delete-account', payload: { kind: 'delete-account' } }, crypto.randomUUID(), new Date()), 'w-check', new Date())
  assert.ok(job)
  assert.equal((await store.jobs.insertJob(job)).created, true)
  const outcome = await deleteAccount(job, { signIn: null, purgeCounters: async () => 0, now: () => new Date() })
  await store.jobs.deleteJob(job.id)
  return outcome
}

const ff = (...args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args])

/** A finished trailer of `projectId` for `owner`, made by ffmpeg from a test pattern — no provider — with its
 *  shots, voices, music, poster and captions in the outputs store; then a newer one that failed. */
async function seedTrailer(owner: string, projectId: string, project: Project) {
  await mkdir(media, { recursive: true })
  const mp4 = join(media, 'final.mp4')
  const clip = join(media, 'shot.mp4')
  const jpg = join(media, 'poster.jpg')
  const mp3 = join(media, 'tone.mp3')
  const vtt = join(media, 'captions.vtt')
  ff('-f', 'lavfi', '-i', 'testsrc=size=128x72:rate=12:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', mp4)
  ff('-f', 'lavfi', '-i', 'testsrc=size=96x96:rate=12:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip)
  ff('-ss', '1', '-i', mp4, '-frames:v', '1', jpg)
  ff('-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-c:a', 'libmp3lame', mp3)
  await writeFile(vtt, 'WEBVTT\n\n00:00.500 --> 00:02.000\nThe last delivery.\n')

  const chapter = project.chapters[0]
  const plan = planTrailer({
    title: project.title,
    page: 0,
    panels: chapter.pages[0].panels,
    characters: project.library.characters,
    model: 'bytedance/seedance-2.0',
    resolution: '480p',
    method: 'B',
  })
  const videoId = crypto.randomUUID()
  const keys = videoKeys(owner, videoId)
  await store.outputs.put(keys.final, mp4, 'video/mp4')
  await store.outputs.put(keys.poster, jpg, 'image/jpeg')
  await store.outputs.put(keys.captions, vtt, 'text/vtt')
  for (const shot of plan.shots) await store.outputs.put(keys.shot(shot.panel), clip, 'video/mp4')
  for (const shot of plan.shots) if (shot.line) await store.outputs.put(keys.speech(shot.panel), mp3, 'audio/mpeg')
  await store.outputs.put(keys.music, mp3, 'audio/mpeg')
  const made = newVideoRecord({ id: videoId, ownerId: owner, projectId, plan, now: new Date('2026-10-16T10:00:00.000Z') })
  const parts: VideoRecord = {
    ...made,
    status: 'making',
    shots: made.shots.map((s) => ({ ...s, state: 'done', providerJobId: `or-${s.panel}`, blobKey: keys.shot(s.panel), costUsd: 0.12, attempts: 1 })),
    speech: made.speech.map((s) => ({ ...s, state: 'done', blobKey: keys.speech(s.panel), seconds: 1 })),
    music: { ...made.music, state: 'done', blobKey: keys.music, seconds: 1 },
  }
  const done = markVideoDone(parts, { finalKey: keys.final, posterKey: keys.poster, captionsKey: keys.captions, seconds: 3 }, new Date('2026-10-16T10:05:00.000Z'))
  assert.ok(done)
  await store.videos.put(done)
  const failedVideo = markVideoFailed(newVideoRecord({ id: crypto.randomUUID(), ownerId: owner, projectId, plan, now: new Date('2026-10-17T10:00:00.000Z') }), 'A shot did not finish.', new Date('2026-10-17T10:01:00.000Z'))
  assert.ok(failedVideo)
  await store.videos.put(failedVideo)
  assert.deepEqual((await store.videos.listOf(owner)).map((v) => v.status), ['failed', 'done'], 'the newest trailer is the failed one')
  return { videoId, keys, plan, mp4, jpg, vtt }
}

if (CLOUD_CHILD) {
  let code = 0
  try {
    await cloudRun()
  } catch (err) {
    console.error(err)
    code = 1
  } finally {
    await (await import('../lib/store/cloud')).closeCloud()
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
  process.exit(code)
}

let failed = false
try {
  // =========================================================================================
  section(0, 'The scratch desk: the filmed project, claimed by the learner, with a finished trailer, a share, a report and a job')
  // =========================================================================================
  const ids = (await readdir(join(dir, 'projects'))).filter((n) => !n.startsWith('.') && !n.endsWith('.json'))
  assert.equal(ids.length, 1, 'the filmed desk holds one project')
  const SOURCE = ids[0]
  assert.equal(await store.claimProject(SOURCE, LEARNER), 'claimed')
  const source = await store.readProject(SOURCE)
  const sourceImages = projectImageIds(source)
  assert.ok(sourceImages.size >= 10, `the filmed project has its pictures (${sourceImages.size})`)

  // A finished trailer, made by ffmpeg from a test pattern — no provider — and a newer one that failed.
  const { videoId, keys, plan, mp4, jpg, vtt } = await seedTrailer(LEARNER, SOURCE, source)

  // What must never travel: a share and a report about it, a job.
  const at = new Date().toISOString()
  const token = 'Judgecheck' + 'A'.repeat(12)
  await store.shares.create({ token, ownerId: LEARNER, kind: 'manga', projectId: SOURCE, videoId: null, snapshot: { kind: 'manga', title: source.title, reading: 'rtl', cover: null, pages: [], takenAt: at }, createdAt: at, updatedAt: at, revokedAt: null })
  await store.reports.add({ id: crypto.randomUUID(), token, reason: 'spam', note: '', ipHash: 'check', at, handledAt: null })
  await store.jobs.insertJob(newJob({ key: `${SOURCE}:sheet:x`, ownerId: LEARNER, projectId: SOURCE, kind: 'sheet', payload: { kind: 'sheet', characterId: 'x', reuseDna: false, redraw: false } }, crypto.randomUUID()))
  const seeded = await tree()
  ok(`project ${SOURCE.slice(0, 8)}… is the learner’s, with ${sourceImages.size} pictures, a finished trailer (${plan.shots.length} shots, voices, music) and a newer failed one, a share, a report and a job`)

  // A static look: the script writes no share, report, job, setting or counter.
  const script = await readFile(join(ROOT, 'scripts', 'seed-judge.mts'), 'utf8')
  assert.doesNotMatch(script, /store\.(shares|reports|jobs|settings)\b|lib\/limits|account\/counters/, 'the script never touches shares, reports, jobs, settings or counters')
  ok('the script names no share, report, job, setting or counter store')

  // =========================================================================================
  section(1, '--dry-run writes nothing')
  // =========================================================================================
  const dry = seed(['--from', SOURCE, '--to', JUDGE, '--with-trailer', '--dry-run', '--data-dir', dir])
  assert.equal(dry.status, 0, dry.out)
  assert.match(dry.out, /would copy\s+\S+\s+“The Last Delivery Before Dawn”/)
  assert.match(dry.out, /would copy\s+trailer/)
  assert.match(dry.out, /Dry run: nothing was written/)
  assert.ok(same(seeded, await tree()), 'every file of the desk is byte-identical after a dry run')
  ok('a dry run says what it would copy, chapter and trailer, and not one file of the desk changed')

  // =========================================================================================
  section(2, 'The copy: the judge’s, new ids, every picture readable by the judge only')
  // =========================================================================================
  const first = seed(['--from', SOURCE, '--to', JUDGE, '--data-dir', dir])
  assert.equal(first.status, 0, first.out)
  assert.match(first.out, /copied\s+\S+/)
  const mine = await store.projectsOf(JUDGE)
  assert.equal(mine.length, 1, 'the judge holds one project')
  const COPY = mine[0].id
  assert.notEqual(COPY, SOURCE, 'under a new id')
  const copy = (await ownedProject(JUDGE, COPY)) as Project & { copiedFrom?: Record<string, unknown> }
  assert.equal(copy.ownerId, JUDGE)
  // Marked a copy, but nothing of the learner's: the judge's data export holds the project as stored.
  assert.deepEqual(Object.keys(copy.copiedFrom ?? {}).sort(), ['at', 'by'], 'the copy is marked a copy')
  assert.equal(copy.copiedFrom?.by, 'seed-judge')
  for (const theirs of [SOURCE, LEARNER]) assert.ok(!JSON.stringify(copy).includes(theirs), `the judge’s record never names ${theirs}`)
  assert.equal(copy.title, source.title)
  assert.equal(copy.migratedFrom, undefined)
  const copyImages = projectImageIds(copy)
  assert.equal(copyImages.size, sourceImages.size, 'as many pictures as the source')
  for (const id of copyImages) assert.ok(!sourceImages.has(id), `picture ${id} is a new id`)
  const paired = pairs(source, copy)
  assert.equal(new Set(paired.map(([, b]) => b)).size, copyImages.size)
  for (const [from, to] of paired) {
    const original = await store.getBlob(from)
    assert.ok(original)
    const mineRes = await call(imageRoute.GET as Handler, { id: COPY, imageId: to }, JUDGE)
    assert.equal(mineRes.status, 200, `the judge reads ${to}`)
    assert.ok(mineRes.bytes.equals(original.bytes), `${to} is ${from}, byte for byte`)
    for (const who of [THIRD, LEARNER]) assert.equal((await call(imageRoute.GET as Handler, { id: COPY, imageId: to }, who)).status, 404, `${who} gets 404 for ${to}`)
    assert.equal((await call(imageRoute.GET as Handler, { id: COPY, imageId: from }, JUDGE)).status, 404, 'the source’s picture is not in the copy')
    assert.equal((await call(imageRoute.GET as Handler, { id: SOURCE, imageId: from }, JUDGE)).status, 404, 'the source is not the judge’s')
  }
  assert.equal((await call(imageRoute.GET as Handler, { id: SOURCE, imageId: paired[0][0] }, LEARNER)).status, 200, 'the learner still reads their own')
  // The copy is the same chapter: story, cast, pages, words, bubbles.
  const strip = (p: Project) => JSON.stringify({ ...p, id: '', ownerId: '', createdAt: '', updatedAt: '', serverRunId: '', copiedFrom: undefined, migratedFrom: undefined }, (k, v: unknown) => (typeof v === 'string' && (sourceImages.has(v) || copyImages.has(v)) ? '<image>' : v))
  assert.equal(strip(copy), strip(source), 'the copy is the chapter itself, picture ids aside')
  ok(`project ${COPY.slice(0, 8)}… is user_judge’s and says it came from the source; ${copyImages.size} pictures, each a new id with the source’s bytes, 200 to the judge and 404 to a third account and to the learner; the learner’s own pictures stay 404 to the judge`)

  // =========================================================================================
  section(3, 'The source is untouched, and nothing but the chapter travelled')
  // =========================================================================================
  const afterFirst = await tree()
  kept(seeded, afterFirst, 'after the copy')
  assert.deepEqual(await store.jobs.listJobs({ ownerId: JUDGE }), [], 'no job is the judge’s')
  assert.deepEqual(await store.shares.listActiveOf(JUDGE), [], 'no share is the judge’s')
  assert.equal((await store.reports.list()).length, 1, 'the one report is still the only one')
  assert.equal(await store.settings.get(JUDGE), null, 'no settings')
  assert.deepEqual(await store.videos.listOf(JUDGE), [], 'no trailer without --with-trailer')
  ok('every file of the source desk is byte-identical; no job, share, report, setting or trailer is the judge’s')

  // =========================================================================================
  section(4, 'A second run is a no-op')
  // =========================================================================================
  const second = seed(['--from', SOURCE, '--to', JUDGE, '--data-dir', dir])
  assert.equal(second.status, 0, second.out)
  assert.match(second.out, /already copied/)
  assert.ok(same(afterFirst, await tree()), 'the whole desk is identical after the second run')
  ok('the second run finds the copy and not one file changes')

  // =========================================================================================
  section(5, '--with-trailer: the latest finished trailer, the judge’s')
  // =========================================================================================
  const withTrailer = seed(['--from', SOURCE, '--to', JUDGE, '--with-trailer', '--data-dir', dir])
  assert.equal(withTrailer.status, 0, withTrailer.out)
  assert.match(withTrailer.out, /already copied/, 'the chapter is not copied twice')
  assert.match(withTrailer.out, new RegExp(`copied\\s+trailer ${videoId}`), 'the finished trailer, not the newer failed one')
  assert.equal((await store.projectsOf(JUDGE)).length, 1)
  const judgeVideos = await store.videos.listOf(JUDGE)
  assert.equal(judgeVideos.length, 1)
  const jv = judgeVideos[0] as VideoRecord & { copiedFrom?: Record<string, unknown> }
  assert.notEqual(jv.id, videoId, 'a new video id')
  assert.deepEqual([jv.ownerId, jv.projectId, jv.status, jv.copiedFrom?.by], [JUDGE, COPY, 'done', 'seed-judge'])
  for (const theirs of [videoId, SOURCE, LEARNER]) assert.ok(!JSON.stringify(jv).includes(theirs), `the judge’s trailer never names ${theirs}`)
  const judgeFolder = videoKeys(JUDGE, jv.id).folder
  const named = [jv.finalKey, jv.posterKey, jv.captionsKey, ...jv.shots.map((s) => s.blobKey), ...jv.speech.map((s) => s.blobKey), jv.music.blobKey]
  for (const key of named) assert.ok(key?.startsWith(judgeFolder), `${key} is in the judge’s folder`)
  assert.ok(jv.shots.every((s) => s.providerJobId === null), 'no provider job id travels')
  for (const shot of jv.plan.shots) assert.ok(copyImages.has(shot.imageId), `shot ${shot.panel}’s picture is the copy’s`)
  const listed = await call(videosRoute.GET as Handler, { id: COPY }, JUDGE)
  assert.equal(listed.status, 200)
  const views = (JSON.parse(listed.bytes.toString()) as { videos: VideoView[] }).videos
  assert.deepEqual(views.map((v) => [v.id, v.status]), [[jv.id, 'done']], 'the judge’s project lists the trailer')
  assert.equal(views[0].videoUrl, `/api/videos/${jv.id}/file/final.mp4`)
  assert.equal((await call(videosRoute.GET as Handler, { id: COPY }, THIRD)).status, 404, 'a third account gets the missing project’s 404')
  const files: [string, string][] = [['final.mp4', mp4], ['poster.jpg', jpg], ['captions.vtt', vtt]]
  for (const [name, path] of files) {
    const original = await readFile(path)
    const whole = await call(fileRoute.GET as Handler, { videoId: jv.id, name }, JUDGE)
    assert.equal(whole.status, 200, `${name} serves`)
    assert.ok(whole.bytes.equals(original), `${name} is the source’s file`)
    const part = await call(fileRoute.GET as Handler, { videoId: jv.id, name }, JUDGE, { range: 'bytes=0-9' })
    assert.deepEqual([part.status, part.headers.get('content-range')], [206, `bytes 0-9/${original.length}`], `${name} by range`)
    assert.equal((await call(fileRoute.GET as Handler, { videoId: jv.id, name }, THIRD)).status, 404, `a third account gets 404 for ${name}`)
    assert.equal((await call(fileRoute.GET as Handler, { videoId: videoId, name }, JUDGE)).status, 404, `the learner’s ${name} stays theirs`)
  }
  const afterTrailer = await tree()
  kept(seeded, afterTrailer, 'after the trailer')
  const again = seed(['--from', SOURCE, '--to', JUDGE, '--with-trailer', '--data-dir', dir])
  assert.equal(again.status, 0, again.out)
  assert.match(again.out, /already copied\s+trailer/)
  assert.ok(same(afterTrailer, await tree()), 'the whole desk is identical after running it again')
  ok(`the finished trailer (not the newer failed one) is the judge’s under a new id, on the copy, its ${named.filter(Boolean).length} files in videos/user_judge/…; its plan shows the copy’s pictures; final.mp4, poster.jpg and captions.vtt serve whole and by range with the source’s bytes; 404 to a third account; a second run changes nothing`)

  // =========================================================================================
  section(6, 'The refusals')
  // =========================================================================================
  for (const bad of ['local', 'judge', 'user_', 'user_a/b', '../x']) {
    const r = seed(['--from', SOURCE, '--to', bad, '--data-dir', dir])
    assert.equal(r.status, 1, `--to ${bad}`)
    assert.match(r.out, /--to must be an account id/)
  }
  const self = seed(['--from', SOURCE, '--to', LEARNER, '--data-dir', dir])
  assert.equal(self.status, 1)
  assert.match(self.out, /already belongs to user_learner/)
  const missing = seed(['--from', crypto.randomUUID(), '--to', JUDGE, '--data-dir', dir])
  assert.equal(missing.status, 1)
  assert.match(missing.out, /There is no project/)
  const cloud = seed(['--from', SOURCE, '--to', JUDGE], { INKDESK_STORAGE: 'cloud' })
  assert.equal(cloud.status, 1)
  assert.match(cloud.out, /INKDESK_JUDGE_CONFIRMED=yes/, 'cloud is refused without the confirmation')
  const cloudDir = seed(['--from', SOURCE, '--to', JUDGE, '--data-dir', dir], { INKDESK_STORAGE: 'cloud', INKDESK_JUDGE_CONFIRMED: 'yes' })
  assert.equal(cloudDir.status, 1)
  assert.match(cloudDir.out, /--data-dir is for the local store/)
  assert.ok(same(afterTrailer, await tree()), 'no refusal wrote anything')
  ok('a target that is not an account id, the source’s own owner, a missing project, cloud without INKDESK_JUDGE_CONFIRMED=yes and cloud with --data-dir are each refused with a sentence, and nothing is written')

  // A source with a picture missing is refused before anything is stored; a trailer with a file missing is not copied, and
  // the files it had already copied are taken back.
  const OTHER = 'user_other'
  const lost = join(dir, 'images', paired[paired.length - 1][0])
  await rename(lost, `${lost}.away`)
  const noPicture = seed(['--from', SOURCE, '--to', OTHER, '--data-dir', dir])
  await rename(`${lost}.away`, lost)
  assert.equal(noPicture.status, 1, noPicture.out)
  assert.match(noPicture.out, /is missing from the store; nothing was copied/)
  assert.ok(same(afterTrailer, await tree()), 'a refused copy stored nothing')
  const poster = join(dir, 'outputs', keys.poster)
  await rename(poster, `${poster}.away`)
  const noPoster = seed(['--from', SOURCE, '--to', OTHER, '--with-trailer', '--data-dir', dir])
  await rename(`${poster}.away`, poster)
  assert.equal(noPoster.status, 1, noPoster.out)
  assert.match(noPoster.out, /poster\.jpg is missing; the trailer was not copied/)
  assert.equal((await store.projectsOf(OTHER)).length, 1, 'the chapter was copied before the trailer was refused')
  assert.deepEqual(await store.videos.listOf(OTHER), [], 'no trailer record')
  assert.deepEqual(await store.outputs.list(`videos/${OTHER}/`), [], 'the final.mp4 it had copied was taken back')
  assert.deepEqual(await deleteAccountOf(OTHER), { outcome: 'done' })
  const afterOther = await tree()
  assert.ok(same(afterTrailer, new Map([...afterOther].filter(([path]) => path !== `users/${OTHER}.json`))), 'once user_other is deleted, the desk is as it was')
  ok('a source with a missing picture is refused with nothing stored; a trailer missing its poster is refused and the file it had copied is taken back')

  // =========================================================================================
  section(7, 'The judge’s account deletion removes the copy completely and leaves the source')
  // =========================================================================================
  assert.deepEqual(await deleteAccountOf(JUDGE), { outcome: 'done' })
  assert.deepEqual(await store.projectsOf(JUDGE), [], 'the copy is gone')
  for (const id of copyImages) assert.equal(await store.getBlob(id), null, `picture ${id} is gone`)
  assert.deepEqual(await store.videos.listOf(JUDGE), [], 'the trailer’s record is gone')
  assert.deepEqual(await store.outputs.list(judgeFolder), [], 'the trailer’s files are gone')
  const afterDeletion = await tree()
  kept(seeded, afterDeletion, 'after the deletion')
  const extra = [...afterDeletion.keys()].filter((path) => !seeded.has(path)).sort()
  assert.deepEqual(extra, [`users/${JUDGE}.json`, 'users/user_other.json'], 'nothing of the copies is left on the desk but the two tombstones')
  assert.equal((await ownedProject(LEARNER, SOURCE)).id, SOURCE, 'the learner’s project still opens')
  const revived = seed(['--from', SOURCE, '--to', JUDGE, '--with-trailer', '--data-dir', dir])
  assert.equal(revived.status, 1)
  assert.match(revived.out, /deleted account/)
  ok('deleteAccount(user_judge): the copy, all its pictures, the trailer and its files are gone, every file of the source is byte-identical, only the tombstone is new; a deleted account is not seeded again')

  // =========================================================================================
  section(8, 'The cloud path: MongoDB and the buckets, on stand-ins on this machine (optional)')
  // =========================================================================================
  const { NAMES } = await import('../lib/config')
  const inEffect = (names: readonly string[]) => names.find((name) => cloudGiven[name])
  const urlVar = inEffect(NAMES.mongoUrl)
  const dbVar = inEffect(NAMES.mongoDb)
  if (!urlVar) {
    console.log('  --  skipped: neither MONGODB_URI nor DB_URL is set (point them, the database and the S3 settings at a local mongod and S3 stand-in, with INKDESK_CHECK_CLOUD=yes)')
  } else if (!checkCloud) {
    console.log('  --  skipped: a Mongo URL is set, but this section writes, so it runs only with INKDESK_CHECK_CLOUD=yes')
  } else {
    // Only stand-ins on this machine: this shell may carry another app's database and bucket.
    assert.ok(dbVar && localStandIns(cloudGiven[urlVar], cloudGiven.S3_ENDPOINT), 'the cloud section writes, so it runs only against a MongoDB and an S3 endpoint on localhost')
    const scratch = `${cloudGiven[dbVar]}-judge-${crypto.randomUUID().slice(0, 8)}`
    const base = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter((name) => env[name]).map((name) => [name, env[name] as string]))
    const childEnv = { ...base, ...cloudGiven, [dbVar]: scratch } as NodeJS.ProcessEnv
    const r = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--cloud-child'], { cwd: ROOT, env: childEnv, encoding: 'utf8', timeout: 300_000 })
    process.stdout.write(`${r.stdout}${r.stderr}`)
    assert.equal(r.status, 0, 'the cloud section passed')
  }

  assert.deepEqual(outbound, [], 'nothing left this machine')
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => undefined)
}

if (failed) {
  console.error('\njudge-check: FAILED')
  process.exit(1)
}
console.log('\njudge-check: all passed')
process.exit(0)

/** Both the database and the bucket endpoint are on this machine. */
function localStandIns(mongoUrl: string | undefined, s3Endpoint: string | undefined): boolean {
  const local = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
  const hosts = (mongoUrl ?? '').replace(/^mongodb(\+srv)?:\/\//, '').split(/[/?]/)[0].split('@').pop() ?? ''
  let s3Host = ''
  try {
    s3Host = new URL(s3Endpoint ?? '').host
  } catch {}
  return /^mongodb:\/\//.test(mongoUrl ?? '') && hosts.split(',').every(local) && local(s3Host)
}

/** Section 8, in the child: the cloud store, a scratch database, the stand-in buckets. */
async function cloudRun(): Promise<void> {
  const { cloudSettings } = await import('../lib/config')
  const settings = cloudSettings()
  assert.ok(localStandIns(settings.mongoUrl, settings.endpoint), 'only stand-ins on this machine')
  assert.match(settings.mongoDb, /-judge-[0-9a-f]{8}$/, 'a scratch database')
  const { CreateBucketCommand, DeleteObjectCommand, ListObjectsV2Command, S3Client } = await import('@aws-sdk/client-s3')
  const { MongoClient } = await import('mongodb')
  const { mediaTypeOf } = await import('../lib/store/local')
  const { BUCKET_PROBE_KEY } = await import('../lib/store/cloud')
  const s3 = new S3Client({ endpoint: settings.endpoint, region: settings.region, forcePathStyle: true, credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } })
  const mongo = new MongoClient(settings.mongoUrl)
  const buckets = [...new Set([settings.projectFilesBucket, settings.outputsBucket])]
  // A stand-in bucket may be fresh (moto keeps nothing): made here, on localhost only (checked above).
  for (const bucket of buckets) {
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((e: unknown) => {
      if (!/BucketAlready/.test((e as Error).name)) throw e
    })
  }
  const keysIn = async (bucket: string) => {
    const out: { key: string; tag: string }[] = []
    let token: string | undefined
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: settings.keyPrefix, ContinuationToken: token }))
      for (const o of page.Contents ?? []) out.push({ key: o.Key as string, tag: `${o.ETag}:${o.Size}` })
      token = page.NextContinuationToken
    } while (token)
    return out
  }
  /** Every document of the scratch database and every object under the prefix, hashed: what "nothing changed" is measured
   *  against. Not the store's connect probe (a stamp in `connect_check`, a probe object), which every connection rewrites. */
  async function world(): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    const db = mongo.db(settings.mongoDb)
    for (const { name } of await db.listCollections().toArray()) {
      if (name === 'connect_check') continue
      for (const doc of await db.collection(name).find({}).toArray()) found.set(`${name}/${String(doc._id)}`, createHash('sha256').update(JSON.stringify(doc)).digest('hex'))
    }
    for (const bucket of buckets) for (const o of await keysIn(bucket)) if (o.key !== settings.keyPrefix + BUCKET_PROBE_KEY) found.set(`${bucket}/${o.key}`, o.tag)
    return found
  }
  const before = new Set<string>()
  for (const bucket of buckets) for (const o of await keysIn(bucket)) before.add(`${bucket}/${o.key}`)
  try {
    // The source: the filmed project, every picture stored through the cloud store, the learner's.
    const filmed = (await readdir(join(dir, 'projects'))).filter((n) => !n.startsWith('.') && !n.endsWith('.json'))[0]
    const local = JSON.parse(await readFile(join(dir, 'projects', filmed, 'project.json'), 'utf8')) as Project
    const moved = new Map<string, string>()
    for (const id of projectImageIds(local)) {
      const kind = (['sheet', 'panel', 'cover'] as const).find((k) => id.startsWith(`${k}-`)) ?? 'asset'
      moved.set(id, await store.putBlob(await readFile(join(dir, 'images', id)), mediaTypeOf(id), kind))
    }
    const SOURCE = crypto.randomUUID()
    const remapped = JSON.parse(JSON.stringify(local), (_k, v: unknown) => (typeof v === 'string' && moved.has(v) ? moved.get(v) : v)) as Project
    await store.createProject({ ...remapped, id: SOURCE, ownerId: LEARNER })
    const source = await store.readProject(SOURCE)
    const sourceImages = projectImageIds(source)
    const { videoId, mp4, jpg, vtt } = await seedTrailer(LEARNER, SOURCE, source)
    const seeded = await world()
    ok(`cloud: project ${SOURCE.slice(0, 8)}… is the learner’s in MongoDB (${settings.mongoDb}), its ${sourceImages.size} pictures and a finished trailer in the stand-in buckets`)

    const confirmed = { INKDESK_JUDGE_CONFIRMED: 'yes' }
    const args = ['--from', SOURCE, '--to', JUDGE, '--with-trailer']
    const dry = seed([...args, '--dry-run'], confirmed)
    assert.equal(dry.status, 0, dry.out)
    assert.match(dry.out, /would copy\s+\S+\s+“The Last Delivery Before Dawn”/)
    assert.match(dry.out, /would copy\s+trailer/)
    assert.match(dry.out, /Dry run: nothing was written/)
    assert.deepEqual(changed(seeded, await world()), [], 'every document and object is unchanged after a dry run')
    ok('cloud: --dry-run says what it would copy, chapter and trailer, and not one document or object changed')

    const first = seed(args, confirmed)
    assert.equal(first.status, 0, first.out)
    assert.match(first.out, /copied\s+\S+/)
    assert.match(first.out, new RegExp(`copied\\s+trailer ${videoId}`))
    const mine = await store.projectsOf(JUDGE)
    assert.equal(mine.length, 1, 'the judge holds one project')
    const COPY = mine[0].id
    const copy = (await ownedProject(JUDGE, COPY)) as Project & { copiedFrom?: Record<string, unknown> }
    assert.notEqual(COPY, SOURCE)
    assert.deepEqual(Object.keys(copy.copiedFrom ?? {}).sort(), ['at', 'by'])
    for (const theirs of [SOURCE, LEARNER]) assert.ok(!JSON.stringify(copy).includes(theirs), `the judge’s record never names ${theirs}`)
    const copyImages = projectImageIds(copy)
    assert.equal(copyImages.size, sourceImages.size)
    for (const [from, to] of pairs(source, copy)) {
      assert.ok(!sourceImages.has(to), `${to} is a new id`)
      const original = await store.getBlob(from)
      assert.ok(original)
      const res = await call(imageRoute.GET as Handler, { id: COPY, imageId: to }, JUDGE)
      assert.equal(res.status, 200, `the judge reads ${to}`)
      assert.ok(res.bytes.equals(original.bytes), `${to} is ${from}, byte for byte`)
      assert.equal((await call(imageRoute.GET as Handler, { id: COPY, imageId: to }, THIRD)).status, 404, `a third account gets 404 for ${to}`)
      assert.equal((await call(imageRoute.GET as Handler, { id: SOURCE, imageId: from }, JUDGE)).status, 404, 'the source is not the judge’s')
    }
    const [jv, ...more] = await store.videos.listOf(JUDGE)
    assert.deepEqual([more.length, jv.projectId, jv.status], [0, COPY, 'done'])
    for (const theirs of [videoId, SOURCE, LEARNER]) assert.ok(!JSON.stringify(jv).includes(theirs), `the judge’s trailer never names ${theirs}`)
    for (const shot of jv.plan.shots) assert.ok(copyImages.has(shot.imageId), `shot ${shot.panel}’s picture is the copy’s`)
    for (const [name, path] of [['final.mp4', mp4], ['poster.jpg', jpg], ['captions.vtt', vtt]] as const) {
      const original = await readFile(path)
      const whole = await call(fileRoute.GET as Handler, { videoId: jv.id, name }, JUDGE)
      assert.equal(whole.status, 200, `${name} serves`)
      assert.ok(whole.bytes.equals(original), `${name} is the source’s file`)
      const part = await call(fileRoute.GET as Handler, { videoId: jv.id, name }, JUDGE, { range: 'bytes=0-9' })
      assert.deepEqual([part.status, part.headers.get('content-range')], [206, `bytes 0-9/${original.length}`], `${name} by range`)
      assert.equal((await call(fileRoute.GET as Handler, { videoId: jv.id, name }, THIRD)).status, 404, `a third account gets 404 for ${name}`)
    }
    const afterCopy = await world()
    kept(seeded, afterCopy, 'cloud, after the copy')
    ok(`cloud: the copy and its trailer are user_judge’s, marked a copy and naming nothing of the learner’s; its ${copyImages.size} pictures and the trailer’s files serve to the judge with the source’s bytes (whole and by range) and 404 to a third account; every source document and object is unchanged`)

    const again = seed(args, confirmed)
    assert.equal(again.status, 0, again.out)
    assert.match(again.out, /already copied\s+\S+\s+“/)
    assert.match(again.out, /already copied\s+trailer/)
    assert.deepEqual(changed(afterCopy, await world()), [], 'every document and object is unchanged after the second run')
    ok('cloud: a second run finds the copy and its trailer, and not one document or object changes')
    assert.deepEqual(outbound, [], 'nothing left this machine')
  } finally {
    // Only what this section made: its scratch database, and the objects that were not in the stand-in buckets before it.
    await mongo.db(settings.mongoDb).dropDatabase().catch(() => undefined)
    for (const bucket of buckets) {
      for (const o of await keysIn(bucket).catch(() => [])) {
        if (!before.has(`${bucket}/${o.key}`)) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.key })).catch(() => undefined)
      }
    }
    await mongo.close()
    s3.destroy()
  }
}
