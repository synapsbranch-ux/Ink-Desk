// One picture of a shared manga (v3, slice 21) — public, streamed, and only
// ever a picture the share's snapshot lists. The browser never learns a bucket
// key or a signed URL: this route reads the bytes from the store and streams
// them. The token is checked by shape, then the snapshot is read, then the
// image id (also checked by shape, before the store is asked for anything) must
// be one of the snapshot's — a cover, or a panel of a complete page. Anything
// else — an unknown or revoked token, a picture of the same project that the
// snapshot does not hold (an older version, a character sheet, an upload), a
// malformed id — is one and the same 404 with the same body and headers.
// Never cached (`no-store`: unpublishing takes effect at once), never sniffed.
// It takes the `anonMedia` address window first: a reader page is dozens of
// pictures, so the window is wider than the snapshot's.
import { Refused, refusalResponse } from '@/lib/errors'
import { IMAGE_MISSING_HEADERS } from '@/lib/images'
import { limitByAddress } from '@/lib/limits/requests'
import { lookupManga, shareNotFound } from '@/lib/share/public'
import { snapshotImageIds } from '@/lib/share/snapshot'
import { store } from '@/lib/store'
import { isImageId, mediaTypeOf } from '@/lib/store/local'

export const runtime = 'nodejs'

/** The three formats the studio keeps; the type comes from the id's extension and nothing else. */
const SERVED = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function GET(req: Request, { params }: { params: Promise<{ token: string; imageId: string }> }) {
  try {
    await limitByAddress(req, 'anonMedia')
  } catch (err) {
    if (err instanceof Refused) return refusalResponse(err, IMAGE_MISSING_HEADERS)
    throw err
  }
  const { token, imageId } = await params
  try {
    const manga = isImageId(imageId) ? await lookupManga(token) : null
    if (!manga || !snapshotImageIds(manga).has(imageId)) return shareNotFound()
    const mediaType = mediaTypeOf(imageId)
    if (!SERVED.has(mediaType)) return shareNotFound()
    const blob = await store.openBlob(imageId)
    if (!blob) return shareNotFound()
    return new Response(blob.body, {
      headers: {
        ...IMAGE_MISSING_HEADERS, // no-store, nosniff
        'Content-Type': mediaType,
        'Content-Disposition': 'inline',
        ...(blob.bytes !== null ? { 'Content-Length': String(blob.bytes) } : {}),
      },
    })
  } catch (err) {
    // A bucket or a disk that can't be read: the broken-image state, the cause in the terminal (the token stays out of the log).
    console.error('[share-image] a shared picture couldn’t be read:', err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502, headers: IMAGE_MISSING_HEADERS })
  }
}
