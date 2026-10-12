// The Image Writer. OpenRouter returns base64, never a URL; this decodes it
// once, writes the file under `data/images/`, and attaches the id to the
// chapter in the same `update()` that bumps `imageCount` — so every image
// written is counted exactly once, and a lost update would show up in the
// header as the spec's canary. See `devpost/spec.md > Components > Image
// Writer (lib/images.ts)`.
//
// The extension comes from `media_type`, never a hardcoded `.png`, and it is
// part of the id — so `/api/image/<id>` knows the Content-Type without
// opening the file. An unrecognised media type is a hard failure, not a guess.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR, update } from './chapter'
import { ProviderError } from './errors'
import type { Chapter } from './types'

export const IMAGES_DIR = join(DATA_DIR, 'images')

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}
const MEDIA_TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MEDIA_TYPE).map(([type, ext]) => [ext, type])
)

/** `<kind>-<uuid>.<ext>`. Strict on purpose: the id is used as a filename. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpg|webp)$/

export function isImageId(id: string): boolean {
  return ID_PATTERN.test(id)
}

export function mediaTypeOf(id: string): string {
  return MEDIA_TYPE_BY_EXT[id.slice(id.lastIndexOf('.') + 1)] ?? 'application/octet-stream'
}

function imagePath(id: string): string {
  if (!isImageId(id)) throw new Error(`Not an image id: ${id}`)
  return join(IMAGES_DIR, id)
}

/**
 * Write one generated image and record it. `attach` receives the freshest
 * chapter and the new id and returns the chapter that points at it; the
 * counter bump is added here so no caller can forget it.
 */
export async function saveImage(
  kind: 'sheet' | 'panel',
  b64: string,
  mediaType: string,
  attach: (chapter: Chapter, imageId: string) => Chapter
): Promise<{ chapter: Chapter; imageId: string }> {
  const ext = EXT_BY_MEDIA_TYPE[mediaType]
  if (!ext) {
    throw new ProviderError(
      'The image came back in a format the studio doesn’t keep.',
      'provider',
      `unrecognised media_type "${mediaType}" — add it to EXT_BY_MEDIA_TYPE rather than guessing`
    )
  }
  const imageId = `${kind}-${crypto.randomUUID()}.${ext}`
  await mkdir(IMAGES_DIR, { recursive: true })
  await writeFile(imagePath(imageId), Buffer.from(b64, 'base64'))

  const chapter = await update((c) => {
    const next = attach(c, imageId)
    return { ...next, imageCount: next.imageCount + 1 }
  })
  return { chapter, imageId }
}

/** The bytes of a stored image, or null if there is no such file. */
export async function readImage(id: string): Promise<Buffer | null> {
  if (!isImageId(id)) return null
  try {
    return await readFile(imagePath(id))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
