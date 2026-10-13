// Serves one stored image from the store — `data/images/` on a local desk,
// the bucket in cloud mode, which is never public. The browser never carries
// image bytes around; every <img> points here by id. The id carries its extension,
// which is where the Content-Type comes from — see `lib/images.ts`.
import { mediaTypeOf, readImage } from '@/lib/images'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // `readImage` validates the id, so a path like `../chapter.json` is a 404
  // rather than a file read.
  let bytes: Buffer | null
  try {
    bytes = await readImage(id)
  } catch (err) {
    // A bucket or a disk that can't be read: the panel shows its broken-image
    // state, and the cause goes to the terminal.
    console.error(`[image] ${id} couldn’t be read:`, err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502 })
  }
  if (!bytes) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': mediaTypeOf(id),
      'Content-Length': String(bytes.length),
      // Ids are unique per generation — a redraw gets a new one — so a
      // stored image never changes under its id.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
