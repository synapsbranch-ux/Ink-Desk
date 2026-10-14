// The Image Writer. OpenRouter returns base64, never a URL; this decodes it
// once, stores the file through the store (`data/images/` locally), and
// attaches the id to the desk in the same `update()` that bumps the project's
// image count and spend — so every image written is counted exactly once, and
// a lost update would show up in the header as the spec's canary. See
// `devpost/spec.md > Components > Image Writer (lib/images.ts)`.
//
// The extension comes from `media_type`, never a hardcoded `.png`, and it is
// part of the id — so `/api/image/<id>` knows the Content-Type without
// opening the file. An unrecognised media type is a hard failure, not a guess.
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
import type { Asset, Desk, PageRef } from './types'

export { isImageId, mediaTypeOf } from './store/local'

/**
 * Write one generated image and record it on a project's desk. `attach`
 * receives the freshest desk and the new id and returns the desk that points
 * at it; the counter and the cost bump are added here so no caller can forget
 * them. `costUsd` is the provider's reported `usage.cost` for this call.
 */
export async function saveImage(
  projectId: string,
  kind: BlobKind,
  b64: string,
  mediaType: string,
  attach: (desk: Desk, imageId: string) => Desk,
  costUsd: number | null = null,
  at?: PageRef
): Promise<{ chapter: Desk; imageId: string }> {
  const imageId = await store.putBlob(Buffer.from(b64, 'base64'), mediaType, kind)
  const chapter = await update(
    projectId,
    (d) => {
      const next = attach(d, imageId)
      return { ...next, imageCount: next.imageCount + 1, costUsd: round(next.costUsd + (costUsd ?? 0)) }
    },
    at
  )
  return { chapter, imageId }
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
