// Streams one stored image off the disk. The browser never carries image
// bytes around; every <img> points here by id. The id carries its extension,
// which is where the Content-Type comes from — see `lib/images.ts`.
import { mediaTypeOf, readImage } from '@/lib/images'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // `readImage` validates the id, so a path like `../chapter.json` is a 404
  // rather than a file read.
  const bytes = await readImage(id)
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
