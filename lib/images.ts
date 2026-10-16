// The Image Writer. OpenRouter returns base64, never a URL; this decodes it
// once, stores the file through the store (`data/images/` locally), and
// attaches the id to the desk in the same `update()` that bumps the project's
// image count and spend — so every image written is counted exactly once, and
// a lost update would show up in the header as the spec's canary. See
// `devpost/spec.md > Components > Image Writer (lib/images.ts)`.
//
// The extension comes from `media_type`, never a hardcoded `.png`, and it is
// part of the id — so the image route knows the Content-Type without
// opening the file. An unrecognised media type is a hard failure, not a guess.
// Since slice 19 the browser asks for an image under its project's address
// (`lib/image-url.ts`), and the route checks the owner before `imageResponse`
// streams a byte.
//
// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import sharp from 'sharp'
import { update } from './chapter'
import { store, type BlobKind } from './store'
import { addAsset, checkUpload, MAX_UPLOAD_SIDE, NOT_A_PICTURE, TOO_MANY_PIXELS, UPLOAD_LIMIT_BYTES, type UPLOAD_TYPES } from './assets'
import { Refused } from './errors'
import { pinnedPictures } from './share/pins'
import type { JobRun } from './queue/run'
import type { Asset, Desk, PageRef } from './types'
import { isImageId, mediaTypeOf } from './store/local'

export { isImageId, mediaTypeOf }

const SERVED = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** On the image and its 304: an id's bytes never change. */
const IMAGE_HEADERS = {
  'Cache-Control': 'private, max-age=31536000, immutable',
  'X-Content-Type-Options': 'nosniff',
} as const

/** On every non-200: never kept, so the image shows once the store has it again, and a refusal is not cached. */
export const IMAGE_MISSING_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const

/** The 404 every image route gives — for an id that is malformed, missing, or not the caller's. */
export function imageNotFound(): Response {
  return new Response('Not found', { status: 404, headers: IMAGE_MISSING_HEADERS })
}

/** True when the browser's If-None-Match already names this image. */
function fresh(header: string | null, etag: string): boolean {
  if (!header) return false
  return header === '*' || header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)
}

/**
 * One stored image as a response, for a caller already allowed to see it.
 * Streamed, never held whole in memory (CR-17). An id is written once and
 * never changes — a redraw gets a new one — so the id is the ETag, and a
 * browser that already has the image gets a 304 without the store being asked.
 * The Content-Type comes only from the id's extension, and only for the three
 * formats the studio keeps; `nosniff` stops a browser guessing otherwise (SEC-05).
 */
export async function imageResponse(req: Request, id: string): Promise<Response> {
  // The id is checked before anything else, so a path like `../chapter.json`
  // is a 404 rather than a file read.
  const mediaType = isImageId(id) ? mediaTypeOf(id) : null
  if (!mediaType || !SERVED.has(mediaType)) return imageNotFound()
  const etag = `"${id}"`
  if (fresh(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers: { ...IMAGE_HEADERS, ETag: etag } })

  let blob
  try {
    blob = await store.openBlob(id)
  } catch (err) {
    // A bucket or a disk that can't be read: the panel shows its broken-image
    // state, and the cause goes to the terminal.
    console.error(`[image] ${id} couldn’t be read:`, err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502, headers: IMAGE_MISSING_HEADERS })
  }
  if (!blob) return imageNotFound()
  return new Response(blob.body, {
    headers: {
      ...IMAGE_HEADERS,
      'Content-Type': mediaType,
      ...(blob.bytes !== null ? { 'Content-Length': String(blob.bytes) } : {}),
      ETag: etag,
    },
  })
}

/**
 * Write one generated image and record it on a project's desk. `attach`
 * receives the freshest desk and the new id and returns the desk that points
 * at it; the counter and the cost bump are added here so no caller can forget
 * them. `costUsd` is the provider's reported `usage.cost` for this call.
 *
 * With a `run` (a job), the order is what makes a re-run free: the picture is
 * stored, its id and cost are saved on the job record, and only then is it
 * attached — so a worker that dies after paying finds the picture waiting and
 * attaches it (`landImage`) instead of drawing, and paying, again.
 */
export async function saveImage(
  projectId: string,
  kind: BlobKind,
  b64: string,
  mediaType: string,
  attach: (desk: Desk, imageId: string) => Desk,
  costUsd: number | null = null,
  at?: PageRef,
  run?: JobRun
): Promise<{ chapter: Desk; imageId: string }> {
  const imageId = await store.putBlob(Buffer.from(b64, 'base64'), mediaType, kind)
  if (run) await checkpointDurably(run, imageId, costUsd)
  return { chapter: await landImage(projectId, imageId, attach, costUsd, at), imageId }
}

/**
 * Save the picture's id on the job. A store that blips here must not lose a
 * picture that is already paid for and in the bucket: try a few times, and if
 * it still will not take it, carry on and attach the picture now — the cost is
 * counted by the same write, and only a second failure right after would leave
 * a re-run without the id.
 */
async function checkpointDurably(run: JobRun, imageId: string, costUsd: number | null): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await run.checkpoint(imageId, costUsd)
      return
    } catch (err) {
      if (attempt >= 3) {
        console.error(`[images] could not save ${imageId} on its job after ${attempt} tries; attaching it anyway:`, err instanceof Error ? err.message : err)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
    }
  }
}

/**
 * Attach a picture that is already in the bucket and count it once.
 *   • `alreadyThere` (a re-run after a crash): if the picture already landed
 *     before the crash, nothing is written — the count was in that same write.
 *   • A refusal (the card was locked meanwhile, the panel was reset and the
 *     claim lost — CR-1) does not lose the money: the cost is still added to
 *     the project's spend, and the orphaned picture is deleted (CR-16). Any
 *     other failure leaves the picture where it is; the job record knows it.
 *   • A redraw that pushes a fourth version out deletes the version it
 *     dropped, which nothing can reach any more (CR-16) — unless the project's
 *     live share still lists it (`lib/share/pins.ts`).
 */
export async function landImage(
  projectId: string,
  imageId: string,
  attach: (desk: Desk, imageId: string) => Desk,
  costUsd: number | null,
  at?: PageRef,
  alreadyThere?: (desk: Desk, imageId: string) => boolean
): Promise<Desk> {
  let before = undefined as Desk | undefined
  let after = undefined as Desk | undefined
  try {
    const chapter = await update(
      projectId,
      (d) => {
        before = after = undefined
        if (alreadyThere?.(d, imageId)) return d
        before = d
        const next = attach(d, imageId)
        after = next
        return { ...next, imageCount: next.imageCount + 1, costUsd: round(next.costUsd + (costUsd ?? 0)) }
      },
      at
    )
    if (before && after) {
      for (const id of await unpinned(projectId, droppedPictures(before, after))) {
        await store.deleteBlob(id).catch((e: unknown) => console.warn(`[images] could not delete ${id}:`, e))
      }
    }
    return chapter
  } catch (err) {
    if (err instanceof Refused) {
      if ((costUsd ?? 0) > 0) {
        await update(projectId, (d) => ({ ...d, costUsd: round(d.costUsd + (costUsd ?? 0)) }), at).catch(() => {})
      }
      await store.deleteBlob(imageId).catch((e: unknown) => console.warn(`[images] could not delete ${imageId}:`, e))
    }
    throw err
  }
}

/**
 * Of the pictures a redraw dropped, the ones no live share lists: a share keeps what it published until it is updated, taken down or
 * deleted, and lets go of it then. If the share cannot be read right now nothing is deleted — a picture that stays is a leak, one that
 * goes is a blank panel on a public page.
 */
async function unpinned(projectId: string, dropped: string[]): Promise<string[]> {
  if (dropped.length === 0) return dropped
  try {
    const pinned = await pinnedPictures(projectId)
    return dropped.filter((id) => !pinned.has(id))
  } catch (err) {
    console.warn('[images] could not read the share; kept the dropped pictures:', err)
    return []
  }
}

/** Every panel and cover picture a desk's current page and cover keep. */
function keptPictures(d: Desk): Set<string> {
  const ids = new Set<string>()
  for (const panel of d.script ?? []) for (const v of panel.versions) ids.add(v.imageId)
  for (const v of d.cover?.versions ?? []) ids.add(v.imageId)
  return ids
}

/** Pictures `before` kept that `after` does not — a redraw's dropped oldest version. Sheets and uploads are never in this set. */
export function droppedPictures(before: Desk, after: Desk): string[] {
  const kept = keptPictures(after)
  return [...keptPictures(before)].filter((id) => !kept.has(id))
}

type UploadType = (typeof UPLOAD_TYPES)[number]

const SHARP_FORMAT: Record<UploadType, 'png' | 'jpeg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
}

const TOO_LARGE_CLEANED = 'That picture is too large to keep once it’s cleaned up. Save a smaller copy and upload that.'

/**
 * An upload, decoded and drawn again in its own format (v3, SEC-05). Only the
 * pixels survive: sharp writes no EXIF, GPS, ICC or XMP unless asked, and
 * anything appended after the image is never part of the decode. `.rotate()`
 * bakes the camera's orientation into the pixels, since the tag that carried
 * it is dropped. The size is read from the header and refused before the
 * decode, so a small file cannot inflate into a huge bitmap. Anything that
 * does not decode as the type its first bytes claimed gets the shelf's
 * ordinary sentence; the decoder's own words go to the terminal.
 */
export async function cleanUpload(bytes: Uint8Array, mediaType: UploadType): Promise<Buffer> {
  const format = SHARP_FORMAT[mediaType]
  const input = { limitInputPixels: MAX_UPLOAD_SIDE * MAX_UPLOAD_SIDE, failOn: 'warning' as const }
  let out: Buffer
  try {
    const meta = await sharp(bytes, input).metadata()
    if (meta.format !== format) throw new Error(`decodes as ${String(meta.format)}, not ${format}`)
    if ((meta.width ?? 0) > MAX_UPLOAD_SIDE || (meta.height ?? 0) > MAX_UPLOAD_SIDE) {
      throw new Refused(TOO_MANY_PIXELS, 413)
    }
    const image = sharp(bytes, input).rotate()
    out =
      format === 'png'
        ? await image.png({ compressionLevel: 9 }).toBuffer()
        : format === 'jpeg'
          ? await image.jpeg({ quality: 90 }).toBuffer()
          : await image.webp({ quality: 90 }).toBuffer()
  } catch (err) {
    if (err instanceof Refused) throw err
    const why = err instanceof Error ? err.message.split('\n')[0] : String(err)
    if (/pixel limit/i.test(why)) throw new Refused(TOO_MANY_PIXELS, 413)
    console.warn(`[assets] upload refused: ${why}`)
    throw new Refused(NOT_A_PICTURE, 415)
  }
  // Re-encoding can grow a tightly packed file; the vision limit still holds.
  if (out.length > UPLOAD_LIMIT_BYTES) throw new Refused(TOO_LARGE_CLEANED, 413)
  return out
}

/**
 * Store one uploaded reference and put it on the project's shelf (slice 10).
 * The bytes were already checked by `checkUpload`; what is stored — and what
 * a text model later reads — is the cleaned copy, never the bytes as sent.
 * An upload is not a generation, so it never counts toward the image counter
 * or the spend.
 */
export async function saveAsset(
  projectId: string,
  bytes: Buffer,
  mediaType: UploadType,
  name: string
): Promise<{ chapter: Desk; asset: Asset }> {
  const clean = await cleanUpload(bytes, mediaType)
  const blobId = await store.putBlob(clean, mediaType, 'asset')
  const asset: Asset = { id: blobId, kind: 'reference', name, blobId, mediaType, bytes: clean.length, createdAt: new Date().toISOString() }
  const chapter = await update(projectId, (d) => {
    checkUpload(clean, d.assets.length) // the shelf limit, rechecked inside the lock
    return addAsset(d, asset)
  })
  return { chapter, asset }
}

/** The bytes of a stored image, or null if there is no such file. */
export async function readImage(id: string): Promise<Buffer | null> {
  return (await store.getBlob(id))?.bytes ?? null
}

/**
 * A route's text calls, added to the project's spend in the same write as
 * their result (slice 11 — the header used to count images only). Not a
 * generated image, so the image counter is untouched.
 */
export function chargeText(desk: Desk, meter: { costUsd: number }): Desk {
  return meter.costUsd > 0 ? { ...desk, costUsd: round(desk.costUsd + meter.costUsd) } : desk
}

/**
 * The write that lands a text call's result, with its cost — and, when that
 * write is refused (the card was locked meanwhile, the cast already proposed
 * by another tab), the cost still lands on its own: the provider was paid
 * either way. Rethrows the refusal.
 */
export async function updateCharging(
  projectId: string,
  meter: { costUsd: number },
  fn: (desk: Desk) => Desk,
  at?: PageRef
): Promise<Desk> {
  try {
    return await update(projectId, (d) => chargeText(fn(d), meter), at)
  } catch (err) {
    if (meter.costUsd > 0) await update(projectId, (d) => chargeText(d, meter), at).catch(() => {})
    throw err
  }
}

/** Dollar cents are the unit that matters; six decimals keeps sub-cent calls honest. */
function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6
}
