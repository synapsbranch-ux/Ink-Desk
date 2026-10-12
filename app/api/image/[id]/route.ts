// Serves `data/images/<id>.<ext>`. The browser only ever sees ids, never
// image bytes in the chapter — see `devpost/spec.md > Components > Image
// Writer`. The Content-Type comes from the id's own extension, which came
// from the provider's `media_type`.
import { readImage } from '@/lib/images'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const image = await readImage(id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      // Ids are unique per generation and files are never rewritten, so a
      // redraw produces a new URL rather than a stale cache hit.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
