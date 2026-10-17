// The pictures a shot is sent with (v3, slice 22). Seedance has no 3:2, so a wide
// panel (3:2) is cut to 16:9 — a centre crop that loses a little off the top and
// bottom — and a square panel (1:1) goes as it is. Every picture travels as a
// base64 JPEG data URI inside the request (no URL, so no way for the provider to
// be pointed at a host of ours): long edge at most 1280 px, quality about 88,
// which Seedance accepted for both `frame_images` and `input_references` in
// slice 17 (`scripts/kernel-test.mjs`).
//
// `cropBox` is pure; the rest uses sharp. Server only (sharp is a server-side
// dependency of the studio).
import 'server-only'
import sharp from 'sharp'
import type { ShotAspect } from './types'

/** The longest side a picture is sent at. Seedance renders 720p; anything larger is bytes for nothing. */
export const FRAME_LONG_EDGE = 1280
export const FRAME_JPEG_QUALITY = 88

const ASPECT_RATIO: Record<ShotAspect, number> = { '16:9': 16 / 9, '1:1': 1 }

export type CropBox = { left: number; top: number; width: number; height: number }

/**
 * The centre crop of a `width` × `height` picture to `aspect`: the whole picture
 * when it already is that shape, otherwise the largest centred box of that
 * shape. A 3:2 panel to 16:9 keeps its full width and loses rows; a picture
 * wider than the target loses columns instead. Whole pixels, inside the picture.
 */
export function cropBox(width: number, height: number, aspect: ShotAspect): CropBox {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const target = ASPECT_RATIO[aspect]
  const ratio = w / h
  // A hair of tolerance, so a 1025×1024 "square" is left alone rather than shaved to 1024×1024.
  if (Math.abs(ratio - target) / target < 0.003) return { left: 0, top: 0, width: w, height: h }
  if (ratio > target) {
    const cropW = Math.min(w, Math.max(1, Math.round(h * target)))
    return { left: Math.floor((w - cropW) / 2), top: 0, width: cropW, height: h }
  }
  const cropH = Math.min(h, Math.max(1, Math.round(w / target)))
  return { left: 0, top: Math.floor((h - cropH) / 2), width: w, height: cropH }
}

const UNREADABLE = 'That picture couldn’t be read.'

/** Decode, flatten any transparency onto white, optionally crop, fit the long edge, encode. */
async function toJpeg(image: Buffer, aspect: ShotAspect | null): Promise<Buffer> {
  try {
    let pipeline = sharp(image).rotate()
    if (aspect) {
      // Dimensions after the orientation is applied, which is what the crop is worked on.
      // A lossless intermediate, so the crop costs the picture nothing before its one JPEG encode.
      const { data, info } = await pipeline.png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true })
      const box = cropBox(info.width, info.height, aspect)
      pipeline = sharp(data).extract(box)
    }
    return await pipeline
      .resize({ width: FRAME_LONG_EDGE, height: FRAME_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: FRAME_JPEG_QUALITY })
      .toBuffer()
  } catch (err) {
    throw new Error(UNREADABLE, { cause: err })
  }
}

/** A panel's picture as the shot's first frame or opening reference: cropped to the shot's ratio, long edge ≤ 1280, JPEG. */
export function frameJpeg(image: Buffer, aspect: ShotAspect): Promise<Buffer> {
  return toJpeg(image, aspect)
}

/** The character's model sheet as a reference (method B): not cropped — every view on it matters — long edge ≤ 1280, JPEG. */
export function sheetJpeg(image: Buffer): Promise<Buffer> {
  return toJpeg(image, null)
}
