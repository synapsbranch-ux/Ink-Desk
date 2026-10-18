// The trailer's record, as pure transitions (v3, slice 22). Pure and
// client-safe — no store, no clock of its own, no Node imports: every function is
// from a `VideoRecord` to the next one (or `null`, meaning "not allowed from
// here"), so the runner (`lib/video/run.ts`), the web (`lib/video/status.ts`, the
// retry route) and `check:video` all apply the same rules, and the store only has
// to make the swap atomic (`VideoStore.update`, compare-and-set on `rev`).
// See `devpost/spec.md > Animate a Page (v3)` and `> Failure Modes (v3)`.
//
// The one rule everything here serves is "nothing paid for is paid for twice":
//
//   queued ─► submitting ─► animating ─► done
//                │             │
//                │             └─► failed          (a person's Try again, only)
//                └─► orphaned                       (a crash between the paid POST
//                                                    and its answer being saved)
//
//   • `markSubmitting` is written BEFORE the POST and is refused from every state
//     but `queued`, so a shot that was ever submitted can never be submitted again
//     by the machine — a redelivered job finds it `submitting`, `recoverShots`
//     turns it `orphaned`, and only `queueRetry` (a person's Try again) puts it
//     back to `queued`.
//   • `markSubmitted` saves the provider's id straight after; from then on a
//     resumed run polls that same id.
//   • A `done` shot is never moved back; a part that is `done` stays `done`.
//   • Transitions are idempotent where a redelivery can repeat them (the same
//     provider id, the same clip, the same result): the second application is the
//     same record, and money is never added twice.
//   • `costUsd` on the record is always the sum of its parts — recomputed on every
//     transition, never incremented — so a retry of the CAS cannot double it.
//
// What the browser sees of a record is `viewOfVideo` / `summaryOfVideo`: states and
// sentences, never keys, costs or the owner.
import type { VideoRecord, VideoSummary } from '../share/types'
import { HOLD_MARGIN, MUSIC_USD, TTS_USD_PER_CHAR, shotUsd } from './cost'
import type { PartState, ShotRecord, ShotState, ShotView, TrailerPlan, VideoView } from './types'

// --- The sentences ---------------------------------------------------------------

/** A shot whose submission was cut off: it may or may not be with the provider, and may or may not be charged. */
export const ORPHANED_SHOT =
  'This shot was interrupted just as it was sent to the video model, so it may or may not have been charged. Try again starts it over and pays for it again.'
/** A shot left running when its job vanished (the studio restarted): no one is waiting for it any more. */
export const STOPPED_SHOT =
  'This shot was still being made when the studio restarted, so it may or may not have been charged. Try again starts it over and pays for it again.'
export const SHOT_DIDNT_FINISH = 'This shot didn’t finish.'
export const STUDIO_RESTARTED = 'The studio restarted before this finished. Try again.'
export const PARTS_LOST = 'Some of the voices or the music were still being made when the studio restarted, so they are left out.'

/** "2 of 4 shots didn't finish - try them again." — singular and plural right. The wording (plain apostrophe and hyphen) is the contract's, kept to the letter. */
export function shotsFailedSentence(failed: number, total: number): string {
  return failed === 1
    ? `1 of ${total} shots didn't finish - try it again.`
    : `${failed} of ${total} shots didn't finish - try them again.`
}

// --- Keys in the outputs store -------------------------------------------------------

export type VideoKeys = {
  /** The clip of panel `n` (zero-based). */
  shot(n: number): string
  /** The leveled voice clip of panel `n` (zero-based). */
  speech(n: number): string
  music: string
  final: string
  poster: string
  captions: string
  /** `videos/<ownerId>/<videoId>/` — the prefix that deletes the whole trailer. */
  folder: string
}

/**
 * Where a trailer's files live in the outputs store: `videos/<ownerId>/<videoId>/…`
 * (`lib/account/keys.ts > videoFolder(ownerId)` is the owner's folder, which account
 * deletion already empties). Spelled here so this module stays client-safe.
 */
export function videoKeys(ownerId: string, videoId: string): VideoKeys {
  const folder = `videos/${ownerId}/${videoId}`
  return {
    shot: (n) => `${folder}/shots/${n}.mp4`,
    speech: (n) => `${folder}/speech/${n}.mp3`,
    music: `${folder}/music.mp3`,
    final: `${folder}/final.mp4`,
    poster: `${folder}/poster.jpg`,
    captions: `${folder}/captions.vtt`,
    folder: `${folder}/`,
  }
}

// --- Building a record --------------------------------------------------------------------

const iso = (d: Date) => d.toISOString()
const round = (usd: number) => Math.round(usd * 1e6) / 1e6

/** The record Confirm writes FIRST, before the job is enqueued: every shot `queued`, a speech slot per spoken line, the music `queued`. */
export function newVideoRecord(input: { id: string; ownerId: string; projectId: string; plan: TrailerPlan; now?: Date }): VideoRecord {
  const at = iso(input.now ?? new Date())
  const { plan } = input
  return {
    id: input.id,
    ownerId: input.ownerId,
    projectId: input.projectId,
    page: plan.page,
    status: 'queued',
    seconds: plan.runSeconds,
    costUsd: 0,
    posterKey: null,
    finalKey: null,
    captionsKey: null,
    error: null,
    createdAt: at,
    updatedAt: at,
    rev: 0,
    plan,
    shots: plan.shots.map((s) => ({ panel: s.panel, state: 'queued', providerJobId: null, blobKey: null, costUsd: 0, attempts: 0, error: null, updatedAt: at })),
    speech: plan.shots.filter((s) => s.line !== null).map((s) => ({ panel: s.panel, state: 'queued', blobKey: null, seconds: null, costUsd: 0, error: null })),
    music: { state: 'queued', blobKey: null, seconds: null, costUsd: 0, error: null },
    phase: null,
    warnings: [],
  }
}

// --- Small helpers ---------------------------------------------------------------------------

/** What the providers billed in all: the sum of the parts, so it can never drift from them. */
export function totalCostOf(record: Pick<VideoRecord, 'shots' | 'speech' | 'music'>): number {
  const sum = record.shots.reduce((t, s) => t + s.costUsd, 0) + record.speech.reduce((t, s) => t + s.costUsd, 0) + record.music.costUsd
  return round(sum)
}

/**
 * What this trailer has cost since `baselineUsd` — what the providers billed, plus what is still with them and will
 * bill whether or not anyone collects it: a shot sent (`submitting`, `animating`) at the formula's price over the
 * hold's margin, a voice line or the music being made at theirs. The charge for a trailer job that something other
 * than its own runner ended (the ceiling, a dead lease let go, a cancel), read when its hold is settled
 * (`lib/limits/jobs.ts`); for a run that ended in order nothing is in flight and it is the record's own bill.
 */
export function owedSince(record: Pick<VideoRecord, 'costUsd' | 'plan' | 'shots' | 'speech' | 'music'>, baselineUsd: number): number {
  const { plan } = record
  let inFlight = 0
  for (const s of record.shots) {
    const planned = plan.shots.find((p) => p.panel === s.panel)
    if (planned && (s.state === 'submitting' || s.state === 'animating')) inFlight += shotUsd(plan.model, plan.resolution, planned.aspect, planned.seconds)
  }
  for (const p of record.speech) {
    if (p.state === 'working') inFlight += (plan.shots.find((s) => s.panel === p.panel)?.line?.chars ?? 0) * TTS_USD_PER_CHAR
  }
  if (record.music.state === 'working') inFlight += MUSIC_USD
  return round(Math.max(0, record.costUsd - baselineUsd) + inFlight * HOLD_MARGIN)
}

/** The record with `patch` applied, its cost re-summed and its clock set. Callers pass only what changed. */
function next(record: VideoRecord, patch: Partial<VideoRecord>, now: Date): VideoRecord {
  const merged = { ...record, ...patch }
  return { ...merged, costUsd: totalCostOf(merged), updatedAt: iso(now) }
}

const money = (usd: number | null | undefined): number => (typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : 0)

export const shotOf = (record: Pick<VideoRecord, 'shots'>, panel: number): ShotRecord | undefined => record.shots.find((s) => s.panel === panel)

/** Replace one shot; every other shot is carried as it is. */
function withShot(record: VideoRecord, panel: number, patch: (s: ShotRecord) => ShotRecord | null, now: Date, more: Partial<VideoRecord> = {}): VideoRecord | null {
  const current = shotOf(record, panel)
  if (!current) return null
  const changed = patch(current)
  if (!changed) return null
  return next(record, { ...more, shots: record.shots.map((s) => (s.panel === panel ? { ...changed, updatedAt: iso(now) } : s)) }, now)
}

/** A trailer that has ended does not take new work. */
const isOpen = (record: Pick<VideoRecord, 'status'>) => record.status === 'queued' || record.status === 'making'

// --- The trailer's own state ---------------------------------------------------------------------

/** A worker took the job: `making`, in the shots phase. Idempotent; refused once the trailer has ended. */
export function markMaking(record: VideoRecord, now: Date): VideoRecord | null {
  if (!isOpen(record)) return null
  if (record.status === 'making' && record.phase === 'shots') return record
  return next(record, { status: 'making', phase: record.phase ?? 'shots', error: null }, now)
}

/** Every shot has its clip: the trailer is being put together. Idempotent. */
export function markAssembling(record: VideoRecord, now: Date): VideoRecord | null {
  if (!isOpen(record)) return null
  if (record.status === 'making' && record.phase === 'assembling') return record
  return next(record, { status: 'making', phase: 'assembling' }, now)
}

export type FinishedFiles = { finalKey: string; posterKey: string; captionsKey: string | null; seconds: number }

/** The trailer exists. Idempotent for the same files; a `failed` one can only be re-opened by `queueRetry`. */
export function markVideoDone(record: VideoRecord, files: FinishedFiles, now: Date): VideoRecord | null {
  if (record.status === 'done') return record.finalKey === files.finalKey ? record : null
  if (!isOpen(record)) return null
  return next(record, { status: 'done', phase: null, error: null, finalKey: files.finalKey, posterKey: files.posterKey, captionsKey: files.captionsKey, seconds: files.seconds }, now)
}

/** The trailer ended without being made, with the sentence the card shows. A finished trailer is never failed after the fact. */
export function markVideoFailed(record: VideoRecord, error: string, now: Date): VideoRecord | null {
  if (record.status === 'done') return null
  if (record.status === 'failed') return record
  return next(record, { status: 'failed', phase: null, error }, now)
}

/** A calm note about a part that did not make it. The same note is kept once. */
export function addWarning(record: VideoRecord, warning: string, now: Date): VideoRecord {
  return record.warnings.includes(warning) ? record : next(record, { warnings: [...record.warnings, warning] }, now)
}

// --- The shot machine -----------------------------------------------------------------------------

/**
 * `queued → submitting`, written BEFORE the paid POST. Refused from every other
 * state — a shot that was ever submitted is never submitted again by the machine.
 * Counts the attempt.
 */
export function markSubmitting(record: VideoRecord, panel: number, now: Date): VideoRecord | null {
  if (!isOpen(record)) return null
  return withShot(record, panel, (s) => (s.state === 'queued' ? { ...s, state: 'submitting', providerJobId: null, attempts: s.attempts + 1, error: null } : null), now)
}

/** `submitting → animating` with the provider's job id, straight after the POST answered. Idempotent for the same id. */
export function markSubmitted(record: VideoRecord, panel: number, providerJobId: string, now: Date): VideoRecord | null {
  if (providerJobId === '') return null
  const shot = shotOf(record, panel)
  if (shot?.state === 'animating' && shot.providerJobId === providerJobId) return record
  return withShot(record, panel, (s) => (s.state === 'submitting' ? { ...s, state: 'animating', providerJobId } : null), now)
}

/**
 * `animating → done` with the clip's key and what the provider billed for this
 * attempt (added to the shot's total). Idempotent for the same clip — the cost is
 * never added twice. A shot that is not `animating` (it failed, was orphaned, was
 * never sent) is not made `done` by a stray answer.
 */
export function markShotDone(record: VideoRecord, panel: number, done: { blobKey: string; costUsd: number }, now: Date): VideoRecord | null {
  const shot = shotOf(record, panel)
  if (shot?.state === 'done') return shot.blobKey === done.blobKey ? record : null
  return withShot(record, panel, (s) => (s.state === 'animating' ? { ...s, state: 'done', blobKey: done.blobKey, costUsd: round(s.costUsd + money(done.costUsd)), error: null } : null), now)
}

/**
 * The shot ended without a clip: `failed`, with a sentence the browser may show and
 * whatever the provider billed for it (a shot can bill and still fail to download).
 * Allowed from `queued` (refused before anything was sent — counts the attempt, so
 * VIDEO_FAIL_SHOT fails only the first), `submitting` (the POST was refused) and
 * `animating`. A `done` shot is never moved back; one already `failed` or `orphaned`
 * stays as it is.
 */
export function markShotFailed(record: VideoRecord, panel: number, error: string, costUsd: number | null | undefined, now: Date): VideoRecord | null {
  return withShot(
    record,
    panel,
    (s) => {
      if (s.state !== 'queued' && s.state !== 'submitting' && s.state !== 'animating') return null
      return {
        ...s,
        state: 'failed',
        error: error || SHOT_DIDNT_FINISH,
        costUsd: round(s.costUsd + money(costUsd)),
        attempts: s.state === 'queued' ? s.attempts + 1 : s.attempts,
      }
    },
    now
  )
}

/**
 * What a resume does with what it finds, before any work is chosen:
 *   • `submitting` with no provider id → `orphaned` (the POST may or may not have
 *     been sent or billed; never auto-resubmitted);
 *   • a voice or music part left `working` goes back to `queued` — it is cheap, and
 *     is made again by the run that picks the record up.
 * Everything else — `done`, `failed`, `queued`, a live `animating` — is untouched.
 *
 * With `jobGone` (the web found the trailer's job dead: nothing will ever poll or
 * run again) it also ends what was left in flight, so a person can Try again:
 * `animating` → `orphaned` (it may finish and bill with nobody to collect it),
 * `queued` → `failed` ("the studio restarted"), and a voice line or the music that
 * never finished → `failed` with a warning (the trailer is whole without them).
 *
 * Total and idempotent: returns the SAME object when there is nothing to recover.
 */
export function recoverShots(record: VideoRecord, now: Date, opts: { jobGone?: boolean } = {}): VideoRecord {
  const gone = opts.jobGone === true
  const shots = record.shots.map((s): ShotRecord => {
    if (s.state === 'submitting' && !s.providerJobId) return { ...s, state: 'orphaned', error: ORPHANED_SHOT, updatedAt: iso(now) }
    if (gone && (s.state === 'animating' || s.state === 'submitting')) return { ...s, state: 'orphaned', error: STOPPED_SHOT, updatedAt: iso(now) }
    if (gone && s.state === 'queued') return { ...s, state: 'failed', error: STUDIO_RESTARTED, updatedAt: iso(now) }
    return s
  })
  const endPart = <T extends { state: PartState; error: string | null }>(p: T): T => {
    if (p.state === 'done' || p.state === 'failed') return p
    return gone ? { ...p, state: 'failed', error: STUDIO_RESTARTED } : p.state === 'working' ? { ...p, state: 'queued' } : p
  }
  const speech = record.speech.map(endPart)
  const music = endPart(record.music)
  const changed = shots.some((s, i) => s !== record.shots[i]) || speech.some((p, i) => p !== record.speech[i]) || music !== record.music
  if (!changed) return record
  const lost = gone && (speech.some((p, i) => p !== record.speech[i]) || music !== record.music)
  const recovered = next(record, { shots, speech, music }, now)
  return lost ? addWarning(recovered, PARTS_LOST, now) : recovered
}

/**
 * A person's Try again on one shot. A `failed` or `orphaned` shot of a trailer that has
 * ended `failed` (nothing is running) goes back to `queued`, and the trailer with it:
 * `queued` again, its old sentence cleared. The attempt is counted when the shot is sent.
 * `null` for anything else — a shot that is waiting, running or done is not re-queued, and
 * neither is any shot while the trailer is still being made.
 */
export function queueRetry(record: VideoRecord, panel: number, now: Date): VideoRecord | null {
  if (record.status !== 'failed') return null
  return withShot(
    record,
    panel,
    (s) => (s.state === 'failed' || s.state === 'orphaned' ? { ...s, state: 'queued', providerJobId: null, error: null } : null),
    now,
    { status: 'queued', phase: null, error: null }
  )
}

/**
 * Put the trailer together again when every shot has its clip and only the
 * assembly failed (ffmpeg gave up): `failed → queued`, no shot touched. `null` unless
 * the trailer is `failed` with every shot `done` — there is nothing else to re-make.
 * The job that follows is a `trailer` job with `only: []`, which makes no shot.
 */
export function queueReassemble(record: VideoRecord, now: Date): VideoRecord | null {
  if (record.status !== 'failed' || record.shots.length === 0 || !record.shots.every((s) => s.state === 'done')) return null
  return next(record, { status: 'queued', phase: null, error: null }, now)
}

// --- The voice and music parts -------------------------------------------------------------------

export type PartRef = { kind: 'speech'; panel: number } | { kind: 'music' }
export type PartResult = { blobKey?: string; seconds?: number; costUsd?: number; error?: string }

const PART_EDGES: Record<PartState, readonly PartState[]> = {
  queued: ['working', 'failed'],
  working: ['working', 'done', 'failed'],
  done: [],
  failed: [],
}

/**
 * One voice line or the music clip changes state: `queued → working → done | failed`.
 * A `done` part is never moved back and a `failed` one stays failed (a retry of a
 * shot does not remake voices). Idempotent for the same result: a `done` part told
 * `done` with its own key is the same record, its cost not added again.
 */
export function markPart(record: VideoRecord, part: PartRef, state: PartState, result: PartResult, now: Date): VideoRecord | null {
  const current = part.kind === 'music' ? record.music : record.speech.find((p) => p.panel === part.panel)
  if (!current) return null
  if (current.state === 'done' && state === 'done' && current.blobKey === (result.blobKey ?? null)) return record
  if (current.state === state && state !== 'working') return null
  if (!PART_EDGES[current.state].includes(state)) return null
  const updated = {
    ...current,
    state,
    ...(state === 'done' ? { blobKey: result.blobKey ?? null, seconds: result.seconds ?? null, error: null } : {}),
    ...(state === 'failed' ? { error: result.error ?? null } : {}),
    costUsd: round(current.costUsd + money(result.costUsd)),
  }
  return part.kind === 'music'
    ? next(record, { music: updated }, now)
    : next(record, { speech: record.speech.map((p) => (p.panel === part.panel ? { ...updated, panel: p.panel } : p)) }, now)
}

// --- What the browser sees --------------------------------------------------------------------------

const SHOT_WEIGHT: Record<ShotState, number> = { queued: 0, submitting: 0.1, animating: 0.5, done: 1, failed: 1, orphaned: 1 }
const PART_WEIGHT: Record<PartState, number> = { queued: 0, working: 0.5, done: 1, failed: 1 }

/**
 * How far along a trailer being made is, 0..1: the shots are most of it (80%),
 * the voices and music a tenth, the assembly the last tenth. Ended shots —
 * `failed` too — count as finished work, so the bar never waits on a shot that
 * has already stopped. Null once the trailer is no longer being made.
 */
export function progressOf(record: VideoRecord): number | null {
  if (!isOpen(record)) return null
  if (record.phase === 'assembling') return 0.95
  const shotFrac = record.shots.length === 0 ? 1 : record.shots.reduce((t, s) => t + SHOT_WEIGHT[s.state], 0) / record.shots.length
  const parts = [...record.speech.map((p) => p.state), record.music.state]
  const partFrac = parts.reduce((t, s) => t + PART_WEIGHT[s], 0) / parts.length
  return Math.round((0.8 * shotFrac + 0.1 * partFrac) * 100) / 100
}

const fileUrl = (id: string, name: string) => `/api/videos/${id}/file/${name}`

/**
 * A trailer as the studio and the dashboard poll it (`VideoView`): shot states in the
 * four words a card shows, sentences, and the three file addresses once the files exist.
 * `opts.running` is whether a trailer job for this video is alive right now — the caller
 * knows (`lib/video/status.ts`); Try again is offered only when it is `false`. Never
 * carries a key, a cost or the owner.
 */
export function viewOfVideo(record: VideoRecord, opts: { running?: boolean } = {}): VideoView {
  const open = isOpen(record)
  const canRetryAny = opts.running === false && record.status === 'failed'
  const shots: ShotView[] = record.shots.map((s) => {
    const planned = record.plan.shots.find((p) => p.panel === s.panel)
    const failed = s.state === 'failed' || s.state === 'orphaned'
    return {
      panel: s.panel,
      state: s.state === 'done' ? 'done' : failed ? 'failed' : s.state === 'queued' ? 'queued' : 'animating',
      seconds: planned?.seconds ?? 0,
      imageId: planned?.imageId ?? '',
      error: s.state === 'orphaned' ? (s.error ?? ORPHANED_SHOT) : s.state === 'failed' ? (s.error ?? SHOT_DIDNT_FINISH) : null,
      canRetry: canRetryAny && failed,
    }
  })
  return {
    id: record.id,
    projectId: record.projectId,
    page: record.page,
    status: record.status,
    phase: open ? record.phase : null,
    seconds: record.seconds,
    progress: progressOf(record),
    shots,
    warnings: [...record.warnings],
    error: record.status === 'failed' ? record.error : null,
    videoUrl: record.finalKey ? fileUrl(record.id, 'final.mp4') : null,
    posterUrl: record.posterKey ? fileUrl(record.id, 'poster.jpg') : null,
    captionsUrl: record.captionsKey ? fileUrl(record.id, 'captions.vtt') : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** What the dashboard lists for a trailer (`VideoSummary`): the poster's address once there is a poster, and the progress while it is being made. */
export function summaryOfVideo(record: VideoRecord): VideoSummary {
  return {
    id: record.id,
    projectId: record.projectId,
    page: record.page,
    status: record.status,
    seconds: record.seconds,
    createdAt: record.createdAt,
    posterUrl: record.posterKey ? fileUrl(record.id, 'poster.jpg') : null,
    progress: progressOf(record),
  }
}
