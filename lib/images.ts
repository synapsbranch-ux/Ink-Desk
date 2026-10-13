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
import { update } from './chapter'
import { store, type BlobKind } from './store'
import { addAsset, checkUpload } from './assets'
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

/**
 * Store one uploaded reference and put it on the project's shelf (slice 10).
 * The bytes were already checked by `checkUpload`; an upload is not a
 * generation, so it never counts toward the image counter or the spend.
 */
export async function saveAsset(
  projectId: string,
  bytes: Buffer,
  mediaType: string,
  name: string
): Promise<{ chapter: Desk; asset: Asset }> {
  const blobId = await store.putBlob(bytes, mediaType, 'asset')
  const asset: Asset = { id: blobId, kind: 'reference', name, blobId, mediaType, bytes: bytes.length, createdAt: new Date().toISOString() }
  const chapter = await update(projectId, (d) => {
    checkUpload(bytes, d.assets.length) // the shelf limit, rechecked inside the lock
    return addAsset(d, asset)
  })
  return { chapter, asset }
}

/** The bytes of a stored image, or null if there is no such file. */
export async function readImage(id: string): Promise<Buffer | null> {
  return (await store.getBlob(id))?.bytes ?? null
}

/** Dollar cents are the unit that matters; six decimals keeps sub-cent calls honest. */
function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6
}
