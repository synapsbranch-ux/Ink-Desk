// Uploaded references (v2, slice 10): the rules for what may land on a
// project's shelf, as pure functions shared by the browser and the server.
// See `devpost/prd.md > Scenario Mode and References` and
// `devpost/spec.md > Assets and Imported References (v2)`.
//
// The media type is read from the file's own first bytes, never trusted from
// the browser or the file name: a renamed `.exe` is refused, a PNG named
// `.jpg` is kept as the PNG it is.
//
// No Node imports: the browser checks the same limits before uploading.
import { Refused } from './errors'
import type { Asset, Desk } from './types'

/** 3.75 MB of bytes: Claude's 5 MB image limit is measured on the base64 it
 *  receives (4 characters for every 3 bytes), so this is the largest upload
 *  that is still readable by Claude — and by the fallback — once encoded.
 *  Slice 11's review lowered it from 5 MB (`checklist.md > Revisions`). The
 *  old wording, kept for the record: 5 MB, under the vision limit of both text providers, so every upload can
 *  also be read by Claude (or the fallback) when it becomes a sheet. */
export const UPLOAD_LIMIT_BYTES = (5 * 1024 * 1024 * 3) / 4

/** Claude's per-image limit, on the base64 it receives. */
export const VISION_LIMIT_BASE64 = 5 * 1024 * 1024

/** A picture a text provider can read: its base64 is within the vision limit.
 *  A shelf asset from before the limit was lowered can be over it. */
export function fitsVision(bytes: { length: number }): boolean {
  return Math.ceil(bytes.length / 3) * 4 <= VISION_LIMIT_BASE64
}

/** A shelf, not an archive. */
export const MAX_ASSETS = 24

export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** The rights rule, shown wherever a file can be uploaded. */
export const RIGHTS_NOTICE =
  'Only upload pictures you made or have permission to use. They become references every panel is drawn against.'

/** What the first bytes say the file is, or null if it is not a PNG, JPEG or WebP. */
export function sniffImage(bytes: Uint8Array): (typeof UPLOAD_TYPES)[number] | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp'
  }
  return null
}

/** The shelf's name for a file: its base name, tidied, never empty. */
export function assetName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{1,5}$/i, '')
  const clean = base.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return clean || 'Reference'
}

/** Refuses anything the shelf does not keep; returns the sniffed media type. */
export function checkUpload(bytes: Uint8Array, shelfSize: number): (typeof UPLOAD_TYPES)[number] {
  if (bytes.length === 0) throw new Refused('That file is empty.', 400)
  if (bytes.length > UPLOAD_LIMIT_BYTES) {
    throw new Refused(`That picture is over ${UPLOAD_LIMIT_BYTES / (1024 * 1024)} MB. Save a smaller copy and upload that.`, 413)
  }
  const type = sniffImage(bytes)
  if (!type) throw new Refused('Only PNG, JPEG or WebP pictures can be uploaded as references.', 415)
  if (shelfSize >= MAX_ASSETS) throw new Refused(`The shelf holds ${MAX_ASSETS} references. This build has no delete yet.`)
  return type
}

/** The asset lands on the shelf. Its id is its stored image id. */
export function addAsset(desk: Desk, asset: Asset): Desk {
  if (desk.assets.some((a) => a.id === asset.id)) return desk
  return { ...desk, assets: [...desk.assets, asset] }
}

export function findAsset(desk: Desk, assetId: string): Asset {
  const asset = desk.assets.find((a) => a.id === assetId)
  if (!asset) throw new Refused('That reference isn’t on this project’s shelf.', 404)
  return asset
}
