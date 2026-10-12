// Image bytes on disk. OpenRouter returns base64, never a URL, so this
// decodes once, writes the file, and returns only the id — which is why the
// browser only ever sees `/api/image/<id>` and never carries image bytes.
// See `devpost/spec.md > Components > Image Writer`.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR } from './chapter'

const IMAGE_DIR = join(DATA_DIR, 'images')

/** The id carries its extension, so serving it needs no second lookup. */
export type ImageId = string

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

/** Write one image and return its id. The caller bumps `imageCount` inside
 *  the same `update()` that stores the id, so the counter and the art can
 *  never disagree. */
export async function writeImage(bytes: Buffer, ext: string): Promise<ImageId> {
  await mkdir(IMAGE_DIR, { recursive: true })
  const id = `${randomUUID()}.${ext}`
  await writeFile(join(IMAGE_DIR, id), bytes)
  return id
}

/** Read one image back — for serving it, and for sending a locked sheet as a
 *  panel's reference in slice 5. */
export async function readImage(id: ImageId): Promise<{ bytes: Buffer; contentType: string } | null> {
  const contentType = CONTENT_TYPE_BY_EXT[id.split('.').pop() ?? '']
  // Ids are generated here, so anything with a path separator or an unknown
  // extension came from somewhere else and is not served.
  if (!contentType || id.includes('/') || id.includes('\\') || id.includes('..')) return null
  try {
    return { bytes: await readFile(join(IMAGE_DIR, id)), contentType }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
