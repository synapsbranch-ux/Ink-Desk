// The Seedance client (v3, slice 22): OpenRouter's video API, as the trailer's
// runner needs it — submit a shot, ask how it is doing, download the clip. Three
// small calls and no loop: the runner owns the waiting, the checkpointing and
// the resume (`lib/video/run.ts`), and persists the provider's job id the moment
// `submitShot` returns so a crash never pays for a shot twice.
//
// The request shapes are the ones verified in slice 17 (`scripts/kernel-test.mjs`
// `submitMotionJob` / `waitMotionJob` / `downloadMotionJob`, `spec.md > Verified
// for v3`):
//   POST /api/v1/videos  {model, prompt, duration, resolution, aspect_ratio,
//        generate_audio:false, seed, session_id, user, frame_images | input_references}
//        → 202 {id, polling_url}.  Images are base64 JPEG data URIs: there is no
//        URL for the provider to fetch, so no way to point it at one of ours.
//   GET  polling_url → {status: pending|in_progress|completed|failed|cancelled|
//        expired, usage:{cost}, unsigned_urls, error}.
//   GET  /api/v1/videos/{id}/content?index=0 (bearer) → the mp4. OpenRouter's copy
//        expires, so it is downloaded at once.
// There is no webhook (the dev domain is not public); polling only.
//
// Money rules: `submitShot` makes ONE paid POST per call. It sends again only on
// a 429 or on a connection that never arrived, and never after an answer — a POST
// that returned may already be billed. A 402 is a `ProviderError` with
// `code: 'credits'` (the queue's breaker trips on it); a content refusal is kind
// `refused`; everything else is `provider` with a calm sentence. Server only: the
// key is read from `OPENROUTER_API_KEY` at call time, sent only as the bearer
// header, and never logged — nor is a prompt.
import 'server-only'
import { createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { ProviderError } from '../errors'
import { API_BASE, failureOf, looksRefused, openRouterKey, openRouterUrl, postJson, providerText } from '../openrouter'
import type { MotionMethod, ShotAspect } from './types'

const VIDEOS = `${API_BASE}/videos`
/** The POST carries one or two JPEGs of a few hundred KB as base64; the provider answers once the job is queued. */
const SUBMIT_TIMEOUT_MS = 60_000
const POLL_TIMEOUT_MS = 30_000
/** A clip is a few MB; this is a ceiling on a stalled stream, not an expectation. */
const DOWNLOAD_TIMEOUT_MS = 180_000

const BUSY = 'The video model didn’t answer just now.'
export const SHOT_REFUSED = 'The video model wouldn’t animate this panel as drawn. Change the picture or its description, then try again.'
const SHOT_FAILED = 'The video model couldn’t finish this shot.'
const SHOT_STOPPED = 'This shot was stopped before it finished.'
const SHOT_EXPIRED = 'The video model took too long on this shot.'
const SHOT_GONE = 'The video model no longer has this shot.'
const NO_CLIP = 'The shot finished, but its clip couldn’t be fetched.'

export type SubmitInput = {
  model: string
  prompt: string
  seconds: number
  resolution: string
  aspect: ShotAspect
  seed: number
  /** Groups a trailer's calls on the provider's side: the video's id. */
  sessionId: string
  /** The person, as an opaque id (`user` on the request). */
  userId: string
  method: MotionMethod
  /** The panel, as a JPEG (`frames.ts > frameJpeg`). */
  frame: Buffer
  /** The character's sheet, as a JPEG (`frames.ts > sheetJpeg`); method B only. */
  sheet?: Buffer
}

const jpegDataUri = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString('base64')}`

/**
 * The exact JSON of a submit. Method A sends the panel as the `first_frame`;
 * method B sends the panel then the sheet as `input_references` (a B shot with
 * no sheet sends the panel alone).
 */
export function submitBody(input: SubmitInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    duration: input.seconds,
    resolution: input.resolution,
    aspect_ratio: input.aspect,
    generate_audio: false,
    seed: input.seed,
    session_id: input.sessionId,
    user: input.userId,
  }
  const panel = { type: 'image_url', image_url: { url: jpegDataUri(input.frame) } }
  if (input.method === 'A') {
    body.frame_images = [{ ...panel, frame_type: 'first_frame' }]
  } else {
    body.input_references = input.sheet ? [panel, { type: 'image_url', image_url: { url: jpegDataUri(input.sheet) } }] : [panel]
  }
  return body
}

/** A job id is used inside a URL path: held to a plain token. */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,200}$/

/**
 * Starts one shot. ONE paid POST: retried only on a 429 or a connection that
 * never arrived, before any answer, and never after one. Throws a
 * `ProviderError`. If the provider answers 2xx but without a usable job id, the
 * error says so and nothing is sent again (the shot may be billed; the runner
 * marks it, and only a person's Try again pays for another).
 */
export async function submitShot(input: SubmitInput): Promise<{ providerJobId: string; pollingUrl: string }> {
  const key = openRouterKey('video model')
  const res = await postJson({
    url: VIDEOS,
    key,
    body: JSON.stringify(submitBody(input)),
    timeoutMs: SUBMIT_TIMEOUT_MS,
    label: `shot · ${input.aspect} ${input.seconds}s`,
    busy: BUSY,
  })
  if (!res.ok) throw await failureOf(res, { label: 'shot', busy: BUSY, refused: SHOT_REFUSED, what: 'video model' })

  // From here the shot may be billed: nothing below sends the POST again.
  let json: { id?: unknown; polling_url?: unknown }
  try {
    json = (await res.json()) as typeof json
  } catch (err) {
    throw new ProviderError(BUSY, 'provider', `${res.status} with an unreadable answer (${err instanceof Error ? err.name : 'error'})`)
  }
  const id = typeof json.id === 'string' ? json.id : ''
  if (!SAFE_ID.test(id)) throw new ProviderError(BUSY, 'provider', `${res.status} without a job id: ${JSON.stringify(json).slice(0, 300)}`)
  // The poll sends the bearer key to this address, so it must be OpenRouter's own; else the documented path for the id.
  const given = typeof json.polling_url === 'string' ? openRouterUrl(json.polling_url) : null
  const pollingUrl = given ? given.toString() : `${VIDEOS}/${id}`
  console.log(`[video] shot · ${input.aspect} ${input.seconds}s · ${input.model} ${input.resolution} · method ${input.method} — job ${id}`)
  return { providerJobId: id, pollingUrl }
}

export type ShotStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired'

export type ShotPoll = {
  status: ShotStatus
  /** What the provider billed, once it says (a failed job may be billed nothing). */
  costUsd: number | null
  /** For a failed, cancelled or expired job: a calm sentence the browser may show. Never the provider's words. */
  error: string | null
  unsignedUrls: string[]
  /** The failure was a content decision about the panel, not a hiccup — the runner ends it with `ProviderError` kind `refused` (`shotFailure`). */
  refused?: boolean
  /** The provider's reason, trimmed, for the terminal only. */
  detail?: string | null
}

const STATUSES: readonly ShotStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'expired']

/** The provider's `error` is a string or an object with a message. */
function reasonOf(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String((raw as { message?: unknown }).message ?? JSON.stringify(raw)) : ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * One GET of the polling address. A transient problem (a 429, a 5xx, a dropped
 * connection, an unreadable answer) throws `ProviderError` kind `provider` for
 * the caller to try again; a 402 carries `code: 'credits'`. A job that is gone
 * (404/410) or whose address is refused (other 4xx) comes back as `failed`.
 */
export async function pollShot(pollingUrl: string): Promise<ShotPoll> {
  const key = openRouterKey('video model')
  // The address came from the provider and sits in our store; the key goes only to OpenRouter's own host.
  const url = openRouterUrl(pollingUrl)
  if (!url) throw new ProviderError(BUSY, 'provider', 'the polling address is not on openrouter.ai')
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
  } catch (err) {
    throw new ProviderError(BUSY, 'provider', err instanceof Error ? err.name : 'error')
  }
  if (res.status === 402 || res.status === 401 || res.status === 429 || res.status >= 500) throw await failureOf(res, { label: 'shot poll', busy: BUSY, what: 'video model' })
  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel().catch(() => undefined)
    return { status: 'failed', costUsd: null, error: SHOT_GONE, unsignedUrls: [], detail: `HTTP ${res.status}` }
  }
  if (!res.ok) {
    const detail = await providerText(res)
    return { status: 'failed', costUsd: null, error: SHOT_FAILED, unsignedUrls: [], detail: `HTTP ${res.status} ${detail.slice(0, 200)}` }
  }
  let json: { status?: unknown; usage?: { cost?: unknown }; unsigned_urls?: unknown; error?: unknown }
  try {
    json = (await res.json()) as typeof json
  } catch (err) {
    throw new ProviderError(BUSY, 'provider', `200 with an unreadable answer (${err instanceof Error ? err.name : 'error'})`)
  }
  const status = STATUSES.find((s) => s === json.status)
  if (!status) throw new ProviderError(BUSY, 'provider', `200 with an unknown status: ${String(json.status).slice(0, 40)}`)
  const cost = json.usage?.cost
  const costUsd = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
  const unsignedUrls = Array.isArray(json.unsigned_urls) ? json.unsigned_urls.filter((u): u is string => typeof u === 'string') : []
  if (status === 'failed' || status === 'cancelled' || status === 'expired') {
    const reason = reasonOf(json.error)
    const refused = status === 'failed' && looksRefused(reason)
    const error = refused ? SHOT_REFUSED : status === 'cancelled' ? SHOT_STOPPED : status === 'expired' ? SHOT_EXPIRED : SHOT_FAILED
    return { status, costUsd, error, unsignedUrls, refused, detail: reason || null }
  }
  return { status, costUsd, error: null, unsignedUrls }
}

/** A finished poll as the error the runner records: `refused` for a content decision, else `provider`. Its message is the sentence; the provider's words are the cause. */
export function shotFailure(poll: ShotPoll): ProviderError {
  return new ProviderError(poll.error ?? SHOT_FAILED, poll.refused ? 'refused' : 'provider', poll.detail ?? poll.status)
}

/** An mp4/mov ('ftyp' at byte 4) or a webm/mkv (EBML header): enough to tell a clip from an error page. */
async function looksLikeVideo(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(12)
    const { bytesRead } = await handle.read(head, 0, 12, 0)
    if (bytesRead < 12) return false
    return head.subarray(4, 8).toString('latin1') === 'ftyp' || head.readUInt32BE(0) === 0x1a45dfa3
  } finally {
    await handle.close()
  }
}

/** A fallback address from the provider: https, a name (not an IP literal) and not the machine itself. */
function plainHttps(raw: string): URL | null {
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    const literal = host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    return url.protocol === 'https:' && !literal && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.internal') ? url : null
  } catch {
    return null
  }
}

/** Streams one response into `part`; returns the byte count, or null if it was not a usable clip (the file is gone). */
async function streamClip(res: Response, part: string): Promise<number | null> {
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (!res.ok || !res.body || /json|html|text/.test(type)) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream<Uint8Array>), createWriteStream(part))
  const { size } = await stat(part)
  if (size === 0 || !(await looksLikeVideo(part))) {
    await rm(part, { force: true })
    return null
  }
  return size
}

/**
 * Downloads a finished shot to `destPath` and returns its size in bytes. Tries
 * `/videos/{id}/content?index=0` with the bearer key, then — if that does not
 * give a clip — the `unsignedUrl` the poll named (the key goes along only when it
 * is OpenRouter's own host). The body streams to a temp file beside the
 * destination and is moved into place only when it is a real, non-empty video; an
 * empty or non-video answer is rejected, never saved.
 */
export async function downloadShot(providerJobId: string, destPath: string, unsignedUrl?: string): Promise<number> {
  const key = openRouterKey('video model')
  if (!SAFE_ID.test(providerJobId)) throw new ProviderError(NO_CLIP, 'provider', 'the job id is not a plain token')
  await mkdir(dirname(destPath), { recursive: true })
  const part = `${destPath}.part`
  const tries: { label: string; url: URL; bearer: boolean }[] = [{ label: 'content', url: new URL(`${VIDEOS}/${providerJobId}/content?index=0`), bearer: true }]
  const fallback = unsignedUrl ? plainHttps(unsignedUrl) : null
  if (fallback) tries.push({ label: 'signed url', url: fallback, bearer: openRouterUrl(fallback.toString()) !== null })
  const why: string[] = []
  for (const t of tries) {
    try {
      const res = await fetch(t.url, { headers: t.bearer ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
      const status = res.status
      const bytes = await streamClip(res, part)
      if (bytes !== null) {
        await rename(part, destPath)
        console.log(`[video] shot ${providerJobId} — downloaded ${(bytes / 1_000_000).toFixed(1)} MB (${t.label})`)
        return bytes
      }
      why.push(`${t.label}: HTTP ${status}, no usable clip`)
    } catch (err) {
      await rm(part, { force: true })
      why.push(`${t.label}: ${err instanceof Error ? err.name : 'error'}`)
    }
  }
  throw new ProviderError(NO_CLIP, 'provider', why.join('; '))
}
