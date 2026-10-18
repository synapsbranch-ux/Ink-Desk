// The trailer job (v3, slice 22). Server only. One `trailer` job makes one whole
// trailer: the four shots side by side, each line of dialogue spoken beside them,
// the music, then the ffmpeg assembly — every part checkpointed on the VIDEO
// RECORD (`lib/share/types.ts > VideoRecord`) through `store.videos.update`
// (compare-and-set, so the web writing the record at the same moment — a person's
// Try again on another shot — never loses either write). Called by the processor
// (`lib/queue/processors.ts`) under the same claim and ending as the image jobs;
// the heartbeat is the caller's. See `devpost/spec.md > Animate a Page (v3)` and
// `> Failure Modes (v3)`.
//
// What makes it safe to run again (a crash, a redelivery, a worker that lost its
// lock) is the shot machine in `lib/video/record.ts`, in this order for each shot:
//
//   1. `markSubmitting` is written BEFORE the paid POST — a shot found `submitting`
//      with no provider id is `orphaned` on the next run and is NEVER sent again by
//      the machine; only a person's Try again (`queueRetry`) pays for it twice.
//   2. `markSubmitted` saves the provider's id straight after the POST answers. A
//      shot found `animating` is only polled, on the SAME id — no second POST.
//   3. A finished clip is downloaded at once (the provider's copy expires), put in
//      the outputs store, and only then is the shot `done` — with what the provider
//      billed. A `done` shot is skipped by every later run, and a shot that has
//      ENDED (`failed`, `orphaned`) is not started again by a redelivery either.
//
// Money: the job's `costUsd` is everything the record has billed less what it had
// already billed when THIS job first started (`baselineUsd`, saved on the job's
// payload before any paid work, so a redelivery counts only its own spend and a
// retry job is not charged for the shots the first one paid for). It is saved on
// the job after every write of the record (`owedSince`: billed, plus what is still
// with the providers), so an ending this run did not write — the worker's ceiling,
// a dead lease the web let go, a cancel, an account deletion — counts that money
// rather than giving the hold back at nothing. Such a run is no longer its job's
// (`run.isCurrent()`): it sends nothing new, and only collects what is already
// with the providers. A record that is gone (the trailer, or the whole account,
// was deleted while this ran) keeps no file: what this run put in the outputs
// store is removed, and its polls stop. The job ends
// `done` whenever the run completed in order — even with failed shots, whose
// failure lives on the record and whose generated seconds stay used — and
// `failed` (the hold is released) only when this run produced nothing and billed
// nothing: every shot refused, a setting that is wrong, the credit breaker.
//
// Voices and music are best effort: one that fails is a warning on the record and
// the trailer is assembled without it. A 402 anywhere trips the credit breaker
// (`lib/queue/breaker.ts`) and stops NEW paid work — shots already with the provider
// finish polling. The job never throws for a provider problem; it throws only when
// the store itself failed (then the queue runs it again and the record resumes
// exactly where it stood).
import 'server-only'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { MUSIC_PROMPT, makeMusic } from '../audio/music'
import { speak } from '../audio/tts'
import { ConfigError, videoSettings, type VideoSettings } from '../config'
import { ProviderError, configSentence, jobSentence } from '../errors'
import { API_BASE } from '../openrouter'
import { creditsBreakerOpen, tripCredits } from '../queue/breaker'
import { PAUSED, type JobRecord } from '../queue/jobs'
import type { JobRun, Outcome } from '../queue/run'
import type { VideoRecord } from '../share/types'
import { store } from '../store'
import { styleRules } from '../styles'
import type { Project } from '../types'
import { assembleTrailer } from './assemble'
import { shotUsd } from './cost'
import { frameJpeg, sheetJpeg } from './frames'
import { motionPrompt } from './prompt'
import {
  STUDIO_RESTARTED,
  addWarning,
  markAssembling,
  markMaking,
  markPart,
  markShotDone,
  markShotFailed,
  markSubmitted,
  markSubmitting,
  markVideoDone,
  markVideoFailed,
  owedSince,
  recoverShots,
  shotOf,
  shotsFailedSentence,
  videoKeys,
  type PartRef,
} from './record'
import { SHOT_REFUSED, downloadShot, pollShot, submitShot } from './seedance'
import type { ShotRecord, TrailerLine, TrailerPlan } from './types'

// --- The sentences (what a browser may see; the cause is in the terminal) ------------

const SHOT_BUSY = 'The video model didn’t answer just now. Try this shot again in a moment.'
const SHOT_TOO_SLOW = 'The video model took too long on this shot. Try again starts it over, and the video model may charge for it again.'
const PICTURE_GONE = 'This panel’s picture is no longer on the desk, so it can’t be animated.'
const SHEET_GONE = 'This character’s locked sheet is no longer on the desk, so the shot can’t be animated.'
const PROJECT_GONE = 'This project is no longer on the desk.'
const SHOT_NOT_PREPARED = 'The studio couldn’t prepare this panel’s picture for the video model.'
const CLIP_NOT_FETCHED = 'The shot finished, but its clip couldn’t be fetched. Try this shot again.'
const ASSEMBLY_FAILED = 'The shots are ready, but the studio couldn’t put the trailer together. Try again in a little while.'
const NO_SUCH_VIDEO = 'There is no such video.'
const voiceLost = (panel: number) => `The voice for panel ${panel + 1}’s line didn’t come back, so the trailer plays that line with its bubble alone.`
const MUSIC_LOST = 'The music didn’t come back, so the trailer plays without it.'

// --- Small things ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const round = (usd: number) => Math.round(usd * 1e6) / 1e6

/** After this many polls in a row that could not be read, the shot is asked after half as often (it is still bounded by its timeout). */
const POLL_ERRORS_BEFORE_SLOWING = 3
/** A clip that will not download is tried this many times, a moment apart, before the shot fails — the clip is paid for. */
const DOWNLOAD_TRIES = 3
/** The write that saves a provider's job id is the one that must not be lost: it is tried this many times. */
const CHECKPOINT_TRIES = 5

/** A stable seed per shot and attempt: the same shot sent again is a different draw, the same attempt the same one. */
function seedFor(videoId: string, panel: number, attempt: number): number {
  let h = 2166136261
  for (const ch of `${videoId}:${panel}:${attempt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) % 2_147_483_647
}

/** At most `limit` at a time, in the order asked. A slot is handed straight to the next waiter, so the limit holds under any interleaving. */
function limiter(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < limit) active++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await fn()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

type Ctx = {
  tag: string
  run: JobRun
  /** What the record had billed when this job first started; the job is charged for what it billed past it. */
  baselineUsd: number
  /** The last figure saved on the job (`tally`), so an unchanged one is not written again. */
  tallied: number | null
  /** The job was ended by something else: nothing new is sent (`mayPay`). */
  stopped: boolean
  videoId: string
  ownerId: string
  projectId: string
  plan: TrailerPlan
  settings: VideoSettings
  /** Temp files live under here and nowhere else; removed at the end, always. */
  dir: string
  /** A 402 was seen (here or by anyone): nothing NEW is sent to a paid provider. */
  creditsOut: boolean
  /** What this run itself finished (shots, voices, music, the assembly) — a run that made nothing and billed nothing is `failed`. */
  made: number
  project: Promise<Project | null> | null
  /** Store failures: the run finishes what it can, then throws the first so the queue runs it again. */
  infra: unknown[]
}

/** One compare-and-set write of the record. `applied` is whether `fn` allowed the change on the record it finally ran against; `record` is what is stored now (null if the video is gone). */
async function change(ctx: Ctx, fn: (v: VideoRecord) => VideoRecord | null): Promise<{ applied: boolean; record: VideoRecord | null }> {
  let applied = false
  const result = await store.videos.update(ctx.videoId, (v) => {
    const out = fn(v)
    applied = out !== null
    return out
  })
  if (applied) {
    await tally(ctx, result)
    return { applied, record: result }
  }
  return { applied, record: result ?? (await store.videos.get(ctx.videoId)) }
}

/**
 * Save on the job what this run has cost so far — billed, and still with the providers — so an ending written by
 * anything else counts it. Best effort: a job store that blips here leaves the figure a step behind, and the run's own
 * ending carries the exact one.
 */
async function tally(ctx: Ctx, record: VideoRecord | null): Promise<void> {
  if (!record) return
  const owed = owedSince(record, ctx.baselineUsd)
  if (owed === ctx.tallied) return
  try {
    await ctx.run.spent(owed)
    ctx.tallied = owed
  } catch (err) {
    console.warn(`[${ctx.tag}] could not save what it has spent on its job yet:`, err instanceof Error ? err.message : err)
  }
}

/**
 * May this run start something new that is paid for? Not once its job was ended by something else (the worker's
 * ceiling, a lapsed lease the web let go, a cancel, an account deletion): that ending has settled the hold, and nothing
 * new may be spent past it. What is already with the providers is still collected.
 */
async function mayPay(ctx: Ctx): Promise<boolean> {
  if (!ctx.stopped && !(await ctx.run.isCurrent())) {
    ctx.stopped = true
    console.warn(`[${ctx.tag}] its job was ended elsewhere; nothing new is sent, and what is with the providers is only collected`)
  }
  return !ctx.stopped
}

/** A file this run kept for a record that is gone (the trailer, or the whole account, was deleted meanwhile) is removed at once. */
async function dropOrphan(ctx: Ctx, key: string, out: { record: VideoRecord | null }): Promise<void> {
  if (out.record) return
  console.warn(`[${ctx.tag}] its record is gone; removing ${key.split('/').slice(-2).join('/')}`)
  await store.outputs.delete(key)
}

/** The record is gone: everything under the trailer's folder goes, whatever this or an earlier run kept there. */
async function forgetFiles(ownerId: string, videoId: string, tag: string): Promise<void> {
  console.warn(`[${tag}] its record is gone; removing whatever files it kept`)
  await store.outputs.deletePrefix(videoKeys(ownerId, videoId).folder)
}

const projectOf = (ctx: Ctx): Promise<Project | null> => (ctx.project ??= store.readProject(ctx.projectId).catch(() => null))

/** The terminal gets the cause; the record gets the sentence. */
function describe(tag: string, err: unknown): { sentence: string; credits: boolean } {
  if (err instanceof ProviderError) {
    console.error(`[${tag}] ${err.kind}: ${err.message}`, err.cause ?? '')
    return { sentence: err.code === 'credits' ? PAUSED : jobSentence(err, SHOT_BUSY), credits: err.code === 'credits' }
  }
  console.error(`[${tag}] failed:`, err)
  return { sentence: SHOT_BUSY, credits: false }
}

/** Is paid work stopped — by a 402 seen here, or by the breaker another job (or worker) opened? */
async function creditsStopped(ctx: Ctx): Promise<boolean> {
  if (!ctx.creditsOut && (await creditsBreakerOpen())) ctx.creditsOut = true
  return ctx.creditsOut
}

async function stopForCredits(ctx: Ctx): Promise<void> {
  if (ctx.creditsOut) return
  ctx.creditsOut = true
  await tripCredits()
}

/** A store failure must not abandon the other shots mid-flight: it is kept, they finish, and the run throws it at the end. */
async function guarded(ctx: Ctx, label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.error(`[${ctx.tag}] ${label} stopped on a store problem; the run will be tried again:`, err)
    ctx.infra.push(err)
  }
}

// --- One shot ----------------------------------------------------------------------------------

async function endShot(ctx: Ctx, panel: number, error: string, costUsd = 0): Promise<void> {
  await change(ctx, (v) => markShotFailed(v, panel, error, costUsd, new Date()))
}

/** Everything a shot is sent from, or the sentence for why it cannot be. Nothing has been sent or billed when this says no. */
async function prepare(ctx: Ctx, panel: number): Promise<{ frame: Buffer; sheet?: Buffer; prompt: string } | { problem: string }> {
  const planShot = ctx.plan.shots.find((s) => s.panel === panel)
  const proj = await projectOf(ctx)
  if (!planShot || !proj) return { problem: PROJECT_GONE }
  const character = proj.library.characters.find((c) => c.id === planShot.characterId)
  if (!character?.dna) return { problem: SHEET_GONE }
  const picture = await store.getBlob(planShot.imageId)
  if (!picture) return { problem: PICTURE_GONE }
  let sheetPicture: { bytes: Buffer } | null = null
  if (ctx.plan.method === 'B') {
    sheetPicture = character.sheetImageId ? await store.getBlob(character.sheetImageId) : null
    if (!sheetPicture) return { problem: SHEET_GONE }
  }
  try {
    const frame = await frameJpeg(picture.bytes, planShot.aspect)
    const sheet = sheetPicture ? await sheetJpeg(sheetPicture.bytes) : undefined
    // The character's locked words go in exactly as drawn, with the project's frozen style rules.
    const prompt = motionPrompt({ method: ctx.plan.method, seconds: planShot.seconds, shot: planShot, dna: character.dna, styleRules: styleRules(proj.stylePresetId) })
    return { frame, sheet, prompt }
  } catch (err) {
    console.error(`[${ctx.tag} panel ${panel + 1}] could not prepare the pictures:`, err)
    return { problem: SHOT_NOT_PREPARED }
  }
}

/** Save the provider's job id. Retried, because losing it would leave a shot that is paid for reading as interrupted. */
async function saveProviderId(ctx: Ctx, panel: number, providerJobId: string, tag: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = await change(ctx, (v) => markSubmitted(v, panel, providerJobId, new Date()))
      if (!out.applied) console.warn(`[${tag}] the record would not take the provider id ${providerJobId} (the shot was moved meanwhile); polling it anyway`)
      return
    } catch (err) {
      if (attempt >= CHECKPOINT_TRIES) {
        console.error(`[${tag}] COULD NOT SAVE the provider job id ${providerJobId}; the shot is paid for and will read as interrupted:`, err)
        throw err
      }
      await sleep(250 * attempt)
    }
  }
}

/**
 * Start one queued shot: the development switch, the breaker, the pictures, then
 * `markSubmitting` → POST → `markSubmitted`. Returns the provider's job id and
 * address, or null when the shot ended here (its failure is on the record).
 */
async function startShot(ctx: Ctx, shot: ShotRecord, tag: string): Promise<{ id: string; pollingUrl: string } | null> {
  const { panel } = shot
  const planShot = ctx.plan.shots.find((s) => s.panel === panel)
  if (!planShot) return null

  // The development switch: this panel's FIRST attempt is refused before anything is sent or spent.
  if (ctx.settings.failShot === panel && shot.attempts === 0) {
    console.log(`[${tag}] VIDEO_FAIL_SHOT — failing this first attempt before anything is sent`)
    await endShot(ctx, panel, SHOT_REFUSED)
    return null
  }
  if (await creditsStopped(ctx)) {
    await endShot(ctx, panel, PAUSED)
    return null
  }
  const prepared = await prepare(ctx, panel)
  if ('problem' in prepared) {
    await endShot(ctx, panel, prepared.problem)
    return null
  }

  // A job ended elsewhere sends nothing new: its hold is settled already.
  if (!(await mayPay(ctx))) {
    await endShot(ctx, panel, STUDIO_RESTARTED)
    return null
  }
  // The checkpoint BEFORE the paid POST: from here a crash leaves the shot `submitting`, which is never sent again.
  // (`change` saves it on the job too, at its price, before a cent is spent.)
  const marked = await change(ctx, (v) => markSubmitting(v, panel, new Date()))
  if (!marked.applied || !marked.record) return null
  const attempt = shotOf(marked.record, panel)?.attempts ?? 1

  let sent: { providerJobId: string; pollingUrl: string }
  try {
    sent = await submitShot({
      model: ctx.plan.model,
      prompt: prepared.prompt,
      seconds: planShot.seconds,
      resolution: ctx.plan.resolution,
      aspect: planShot.aspect,
      seed: seedFor(ctx.videoId, panel, attempt),
      sessionId: ctx.videoId,
      userId: ctx.ownerId,
      method: ctx.plan.method,
      frame: prepared.frame,
      sheet: prepared.sheet,
    })
  } catch (err) {
    // The provider refused the request, or never took it: nothing was billed.
    const { sentence, credits } = describe(tag, err)
    if (credits) await stopForCredits(ctx)
    await endShot(ctx, panel, sentence)
    return null
  }
  await saveProviderId(ctx, panel, sent.providerJobId, tag)
  return { id: sent.providerJobId, pollingUrl: sent.pollingUrl }
}

/** The finished clip, from the provider into a temp file and on into the outputs store. A clip that will not download after a few tries is null; a store that will not keep it throws. */
async function keepClip(ctx: Ctx, panel: number, providerJobId: string, unsignedUrl: string | undefined, tag: string): Promise<string | null> {
  const temp = join(ctx.dir, `shot-${panel}.mp4`)
  let downloaded = false
  for (let attempt = 1; attempt <= DOWNLOAD_TRIES && !downloaded; attempt++) {
    try {
      await downloadShot(providerJobId, temp, unsignedUrl)
      downloaded = true
    } catch (err) {
      console.error(`[${tag}] could not fetch the clip (try ${attempt} of ${DOWNLOAD_TRIES}):`, err instanceof ProviderError ? (err.cause ?? err.message) : err)
      if (attempt < DOWNLOAD_TRIES) await sleep(Math.min(2000, ctx.settings.pollMs) * attempt)
    }
  }
  if (!downloaded) return null
  const key = videoKeys(ctx.ownerId, ctx.videoId).shot(panel)
  await store.outputs.put(key, temp, 'video/mp4')
  return key
}

/** Poll one submitted shot until it ends, then keep its clip. The shot ends `done` or `failed` here; only a store failure throws. */
async function collectShot(ctx: Ctx, panel: number, providerJobId: string, pollingUrl: string, tag: string): Promise<void> {
  const planShot = ctx.plan.shots.find((s) => s.panel === panel)
  if (!planShot) return
  // The shot was sent, so the provider bills it whether or not it is collected. A shot that ends here without
  // the provider's figure (a timeout, a job gone, a setting) is counted at the formula's price, never $0 (after-audit #9).
  const formulaUsd = shotUsd(ctx.plan.model, ctx.plan.resolution, planShot.aspect, planShot.seconds)
  const startedAt = Date.now()
  let unreadable = 0
  for (;;) {
    // Deleted while it was with the provider (the trailer, or the whole account): there is no one left to collect it for.
    if (!(await store.videos.get(ctx.videoId))) {
      console.warn(`[${tag}] its record is gone; no longer asking after job ${providerJobId}`)
      return
    }
    if (Date.now() - startedAt > ctx.settings.shotTimeoutMs) {
      console.error(`[${tag}] gave up waiting for job ${providerJobId} after ${Math.round((Date.now() - startedAt) / 1000)}s`)
      await endShot(ctx, panel, SHOT_TOO_SLOW, formulaUsd)
      return
    }
    let poll
    try {
      poll = await pollShot(pollingUrl)
      unreadable = 0
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err
      const { sentence, credits } = describe(tag, err)
      if (credits) await stopForCredits(ctx) // nothing new is sent, but this shot is already paid for: keep polling
      // A setting that is wrong will not right itself. Anything else (a 429, a 5xx, a dropped connection) is the provider
      // having a moment while the shot goes on being made — and billed — on its side: it is asked after until its timeout.
      if (err.kind === 'config') {
        await endShot(ctx, panel, sentence, formulaUsd)
        return
      }
      await sleep(ctx.settings.pollMs * (++unreadable > POLL_ERRORS_BEFORE_SLOWING ? 2 : 1))
      continue
    }

    if (poll.status === 'completed') {
      const billed = poll.costUsd ?? formulaUsd
      const key = await keepClip(ctx, panel, providerJobId, poll.unsignedUrls[0], tag)
      if (!key) {
        await endShot(ctx, panel, CLIP_NOT_FETCHED, billed)
        return
      }
      const done = await change(ctx, (v) => markShotDone(v, panel, { blobKey: key, costUsd: billed }, new Date()))
      if (done.applied) ctx.made++
      else if (done.record) console.warn(`[${tag}] the clip is kept, but the record would not mark the shot done`)
      await dropOrphan(ctx, key, done)
      return
    }
    if (poll.status === 'failed' || poll.status === 'cancelled' || poll.status === 'expired') {
      console.error(`[${tag}] job ${providerJobId} ${poll.status}${poll.detail ? `: ${poll.detail}` : ''}`)
      await endShot(ctx, panel, poll.error ?? SHOT_BUSY, poll.costUsd ?? (poll.unknown ? formulaUsd : 0))
      return
    }
    await sleep(ctx.settings.pollMs)
  }
}

/** One shot, start to end — or, found `animating` on a resume, straight to polling the SAME id. */
async function runShot(ctx: Ctx, panel: number): Promise<void> {
  const tag = `${ctx.tag} panel ${panel + 1}`
  const shot = shotOf((await store.videos.get(ctx.videoId)) ?? { shots: [] }, panel)
  if (!shot) return
  if (shot.state === 'queued') {
    const started = await startShot(ctx, shot, tag)
    if (started) await collectShot(ctx, panel, started.id, started.pollingUrl, tag)
  } else if (shot.state === 'animating' && shot.providerJobId) {
    console.log(`[${tag}] resuming job ${shot.providerJobId}; not sending it again`)
    await collectShot(ctx, panel, shot.providerJobId, `${API_BASE}/videos/${shot.providerJobId}`, tag)
  }
}

// --- Voices and music (best effort) ------------------------------------------------------------

/** A part that did not make it: it ends `failed` (billed or not) and the trailer carries a warning. */
async function loseParts(ctx: Ctx, part: PartRef, error: string, warning: string, costUsd = 0): Promise<void> {
  await change(ctx, (v) => {
    const failed = markPart(v, part, 'failed', { error, costUsd }, new Date())
    return failed ? addWarning(failed, warning, new Date()) : null
  })
}

async function makePart(
  ctx: Ctx,
  part: PartRef,
  tag: string,
  warning: string,
  key: string,
  mediaType: string,
  fileName: string,
  make: (destPath: string) => Promise<{ seconds: number; costUsd: number }>
): Promise<void> {
  const rec = await store.videos.get(ctx.videoId)
  const current = rec && (part.kind === 'music' ? rec.music : rec.speech.find((p) => p.panel === part.panel))
  if (!current || current.state !== 'queued') return
  if (await creditsStopped(ctx)) return loseParts(ctx, part, PAUSED, warning)
  if (!(await mayPay(ctx))) return loseParts(ctx, part, STUDIO_RESTARTED, warning)
  const started = await change(ctx, (v) => markPart(v, part, 'working', {}, new Date()))
  if (!started.applied) return
  let billed = 0
  try {
    const dest = join(ctx.dir, fileName)
    const made = await make(dest)
    billed = made.costUsd
    await store.outputs.put(key, dest, mediaType)
    const done = await change(ctx, (v) => markPart(v, part, 'done', { blobKey: key, seconds: made.seconds, costUsd: made.costUsd }, new Date()))
    if (done.applied) ctx.made++
    await dropOrphan(ctx, key, done)
  } catch (err) {
    const { sentence, credits } = describe(tag, err)
    if (credits) await stopForCredits(ctx)
    await loseParts(ctx, part, sentence, warning, billed)
  }
}

const speakLine = (ctx: Ctx, line: TrailerLine) =>
  makePart(
    ctx,
    { kind: 'speech', panel: line.panel },
    `${ctx.tag} voice ${line.panel + 1}`,
    voiceLost(line.panel),
    videoKeys(ctx.ownerId, ctx.videoId).speech(line.panel),
    'audio/mpeg',
    `speech-${line.panel}.mp3`,
    (destPath) => speak({ text: line.text, voice: line.voice, model: ctx.settings.ttsModel, destPath })
  )

const makeMusicClip = (ctx: Ctx) =>
  makePart(ctx, { kind: 'music' }, `${ctx.tag} music`, MUSIC_LOST, videoKeys(ctx.ownerId, ctx.videoId).music, 'audio/mpeg', 'music.mp3', (destPath) =>
    makeMusic({ model: ctx.settings.musicModel, prompt: MUSIC_PROMPT, destPath })
  )

// --- The assembly ---------------------------------------------------------------------------------

/** A stored object into a file. */
async function pull(key: string, dest: string): Promise<void> {
  const blob = await store.outputs.open(key)
  if (!blob) throw new Error(`${key} is not in the outputs store`)
  await mkdir(dirname(dest), { recursive: true })
  await pipeline(Readable.fromWeb(blob.body as unknown as NodeReadableStream<Uint8Array>), createWriteStream(dest))
}

/** Every shot has its clip: put the trailer together and keep its files. Ends the record `done`, or `failed` with the shots still `done` (assembling again is then possible). */
async function assemble(ctx: Ctx, record: VideoRecord): Promise<VideoRecord | null> {
  if (!(await change(ctx, (v) => markAssembling(v, new Date()))).record) {
    await forgetFiles(ctx.ownerId, ctx.videoId, ctx.tag)
    return null
  }
  const inDir = join(ctx.dir, 'in')
  const keys = videoKeys(ctx.ownerId, ctx.videoId)
  let made: Awaited<ReturnType<typeof assembleTrailer>>
  try {
    const clips: Record<number, string> = {}
    for (const shot of record.shots) {
      if (!shot.blobKey) throw new Error(`shot ${shot.panel} is done but names no clip`)
      clips[shot.panel] = join(inDir, `shot-${shot.panel}.mp4`)
      await pull(shot.blobKey, clips[shot.panel])
    }
    const speech: Record<number, { path: string; seconds: number }> = {}
    for (const line of record.speech) {
      if (line.state !== 'done' || !line.blobKey || !line.seconds) continue
      const path = join(inDir, `speech-${line.panel}.mp3`)
      await pull(line.blobKey, path)
      speech[line.panel] = { path, seconds: line.seconds }
    }
    let music: { path: string; seconds: number } | null = null
    if (record.music.state === 'done' && record.music.blobKey && record.music.seconds) {
      const path = join(inDir, 'music.mp3')
      await pull(record.music.blobKey, path)
      music = { path, seconds: record.music.seconds }
    }
    made = await assembleTrailer({ plan: record.plan, clips, speech, music, workDir: join(ctx.dir, 'work'), outDir: join(ctx.dir, 'out') })
  } catch (err) {
    console.error(`[${ctx.tag}] could not assemble the trailer:`, err)
    return (await change(ctx, (v) => markVideoFailed(v, ASSEMBLY_FAILED, new Date()))).record
  }

  // Keeping the files is the store's business: a failure here throws and the run is tried again.
  await store.outputs.put(keys.final, made.finalPath, 'video/mp4')
  await store.outputs.put(keys.poster, made.posterPath, 'image/jpeg')
  const hasCaptions = record.plan.shots.some((s) => s.line !== null)
  if (hasCaptions) await store.outputs.put(keys.captions, Buffer.from(made.captions, 'utf8'), 'text/vtt')
  const done = await change(ctx, (v) =>
    markVideoDone(v, { finalKey: keys.final, posterKey: keys.poster, captionsKey: hasCaptions ? keys.captions : null, seconds: made.seconds }, new Date())
  )
  if (done.applied) ctx.made++
  if (!done.record) await forgetFiles(ctx.ownerId, ctx.videoId, ctx.tag)
  return done.record
}

// --- The job -----------------------------------------------------------------------------------------

/** What this job cost: everything the record has billed less what it had billed when this job began. */
const spentSince = (record: VideoRecord | null, baselineUsd: number): number => round(Math.max(0, (record?.costUsd ?? 0) - baselineUsd))

/**
 * Make one trailer. Never throws for a provider problem — a failure is the
 * record's and the outcome's; it throws only when the store failed, and then the
 * queue runs it again and the record resumes exactly where it stood.
 */
export async function runTrailer(job: JobRecord, run: JobRun): Promise<Outcome> {
  const payload = job.payload
  if (payload.kind !== 'trailer') return { outcome: 'refused', error: NO_SUCH_VIDEO }
  const tag = `trailer ${payload.videoId.slice(0, 8)}`

  // 1. Whose is it? A record that is not this job's owner's is not touched, and says nothing about whose it is.
  const found = await store.videos.get(payload.videoId)
  if (!found || found.ownerId !== job.ownerId) {
    console.warn(`[${tag}] no such video for this job's owner; nothing to do`)
    // Deleted (a crash between an upload and the deletion's sweep, an earlier run of this job): the owner's folder for it stays empty.
    if (!found) await forgetFiles(job.ownerId, payload.videoId, tag)
    return { outcome: 'refused', error: NO_SUCH_VIDEO }
  }

  // 2. The settings. A malformed one stops everything before anything is spent.
  let settings: VideoSettings
  try {
    settings = videoSettings()
  } catch (err) {
    const sentence = err instanceof ConfigError ? configSentence(new ProviderError(err.message, 'config')) : configSentence(new ProviderError('The studio’s video settings need fixing.', 'config'))
    console.error(`[${tag}] ${err instanceof Error ? err.message : err}`)
    await store.videos.update(found.id, (v) => markVideoFailed(v, sentence, new Date()))
    return { outcome: 'failed', error: sentence }
  }

  // 3. The baseline, saved BEFORE any paid work so a redelivery counts only its own spend.
  let baselineUsd = payload.baselineUsd
  if (baselineUsd === undefined) {
    baselineUsd = found.costUsd
    await run.patchPayload({ baselineUsd })
  }

  // A redelivery of a job whose trailer is already made has nothing left to do.
  if (found.status === 'done') return { outcome: 'done', costUsd: spentSince(found, baselineUsd) }

  const dir = await mkdtemp(join(tmpdir(), 'inkdesk-trailer-'))
  try {
    const ctx: Ctx = {
      tag,
      run,
      baselineUsd,
      tallied: null,
      stopped: false,
      videoId: found.id,
      ownerId: found.ownerId,
      projectId: found.projectId,
      plan: found.plan,
      settings,
      dir,
      creditsOut: false,
      made: 0,
      project: null,
      infra: [],
    }

    // 4. Take the record: `making`, and whatever a crash left half-sent is recovered (submitting with no id → orphaned, never re-sent).
    const began = await change(ctx, (v) => {
      const taken = markMaking(v, new Date())
      return taken ? recoverShots(taken, new Date()) : null
    })
    if (!began.record) return { outcome: 'failed', error: NO_SUCH_VIDEO }
    if (!began.applied) {
      // The record has ended while this job still ran (the web let the job go as dead): nothing new is sent.
      console.warn(`[${tag}] its record is already ${began.record.status}; leaving it`)
      return { outcome: 'skipped', error: began.record.error ?? undefined, costUsd: spentSince(began.record, baselineUsd) }
    }

    // 5. The work: every target shot not done, the voices and the music beside them, in ONE Promise.all.
    const panels = new Set(found.plan.shots.map((s) => s.panel))
    const targets = payload.only ? new Set(payload.only.filter((n) => panels.has(n))) : panels
    const record = began.record
    const shotPool = limiter(Math.max(1, settings.shotParallel))
    const work: Promise<void>[] = []
    for (const shot of record.shots) {
      if (!targets.has(shot.panel)) continue
      // Only a shot that is waiting, or already with the provider, is run: one that has ENDED is a person's Try again to start.
      if (shot.state !== 'queued' && !(shot.state === 'animating' && shot.providerJobId)) continue
      work.push(shotPool(() => guarded(ctx, `shot ${shot.panel + 1}`, () => runShot(ctx, shot.panel))))
    }
    // A retry of one shot has no voices and no music to remake.
    if (!payload.only) {
      for (const shot of found.plan.shots) {
        const line = shot.line
        if (line && record.speech.some((p) => p.panel === shot.panel && p.state === 'queued')) work.push(guarded(ctx, `voice ${shot.panel + 1}`, () => speakLine(ctx, line)))
      }
      if (record.music.state === 'queued') work.push(guarded(ctx, 'music', () => makeMusicClip(ctx)))
    }
    await Promise.all(work)
    if (ctx.infra.length > 0) throw ctx.infra[0]

    // 6. Every shot of the plan done → put the trailer together; else it ends failed, and the shots keep their own sentences.
    const after = await store.videos.get(ctx.videoId)
    if (!after) {
      await forgetFiles(ctx.ownerId, ctx.videoId, tag)
      return { outcome: 'failed', error: NO_SUCH_VIDEO, costUsd: ctx.tallied ?? 0 }
    }
    const notDone = after.shots.filter((s) => s.state !== 'done')
    let ended: VideoRecord | null
    if (notDone.length === 0) ended = await assemble(ctx, after)
    else {
      ended = (await change(ctx, (v) => markVideoFailed(v, shotsFailedSentence(notDone.length, v.plan.shots.length), new Date()))).record
      if (!ended) await forgetFiles(ctx.ownerId, ctx.videoId, tag)
    }
    if (ctx.infra.length > 0) throw ctx.infra[0]

    // 7. The outcome. `done` whenever this run completed in order, even with failed shots; `failed` only when it produced and billed nothing.
    const final = ended ?? after
    const costUsd = spentSince(final, baselineUsd)
    if (final.status === 'done' || ctx.made > 0 || costUsd > 0) {
      console.log(`[${tag}] ${final.status} — $${costUsd.toFixed(4)} this run`)
      return { outcome: 'done', costUsd }
    }
    const why = ctx.creditsOut ? PAUSED : (final.shots.find((s) => s.error)?.error ?? final.error ?? SHOT_BUSY)
    console.log(`[${tag}] nothing made and nothing billed — failed`)
    return { outcome: 'failed', error: why, costUsd: 0 }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
