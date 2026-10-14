// Serves one stored image from the store — `data/images/` on a local desk,
// the project-files bucket in cloud mode, which is never public. The browser
// never carries image bytes around; every <img> points here by id.
//
// Streamed, never held whole in memory (CR-17). An id is written once and
// never changes — a redraw gets a new one — so the id is the ETag, and a
// browser that already has the image gets a 304 without the store being asked.
// The Content-Type comes only from the id's extension, and only for the three
// formats the studio keeps; `nosniff` stops a browser guessing otherwise (SEC-05).
import { isImageId, mediaTypeOf } from '@/lib/images'
import { store } from '@/lib/store'

export const runtime = 'nodejs'

const SERVED = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** On the image and its 304: an id's bytes never change. */
const HEADERS = {
  'Cache-Control': 'private, max-age=31536000, immutable',
  'X-Content-Type-Options': 'nosniff',
} as const

/** On a 404 or 502: never kept, so the image shows once the store has it again. */
const MISSING = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const

/** True when the browser's If-None-Match already names this image. */
function fresh(header: string | null, etag: string): boolean {
  if (!header) return false
  return header === '*' || header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // The id is checked before anything else, so a path like `../chapter.json`
  // is a 404 rather than a file read.
  const mediaType = isImageId(id) ? mediaTypeOf(id) : null
  if (!mediaType || !SERVED.has(mediaType)) return new Response('Not found', { status: 404, headers: MISSING })
  const etag = `"${id}"`
  if (fresh(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers: { ...HEADERS, ETag: etag } })

  let blob
  try {
    blob = await store.openBlob(id)
  } catch (err) {
    // A bucket or a disk that can't be read: the panel shows its broken-image
    // state, and the cause goes to the terminal.
    console.error(`[image] ${id} couldn’t be read:`, err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502, headers: MISSING })
  }
  if (!blob) return new Response('Not found', { status: 404, headers: MISSING })
  return new Response(blob.body, {
    headers: {
      ...HEADERS,
      'Content-Type': mediaType,
      ...(blob.bytes !== null ? { 'Content-Length': String(blob.bytes) } : {}),
      ETag: etag,
    },
  })
}
