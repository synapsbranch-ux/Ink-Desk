// A shared manga's snapshot as JSON (v3, slice 21) — public: a stranger holding
// the link has no session, so this route takes none and never calls
// `requireUser`. It takes the client-address window FIRST (`limitByAddress`,
// 60 a minute), before the store is read. What it returns is the snapshot's
// allow-list and nothing more (`publicManga`, or `publicVideo` for a trailer): the title, the reading
// direction, the cover, the complete pages' pictures, lines, bubbles, speakers
// and shot labels. An unknown token, a revoked one and a malformed one are the
// same 404, byte for byte. Never cached: unpublishing takes effect at once.
import { Refused, refusalResponse, errorResponse } from '@/lib/errors'
import { limitByAddress } from '@/lib/limits/requests'
import { lookupShare, shareNotFound } from '@/lib/share/public'
import { publicManga, publicVideo } from '@/lib/share/snapshot'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await limitByAddress(req, 'anon')
    const { token } = await params
    const share = await lookupShare(token)
    if (!share) return shareNotFound()
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    const manga = publicManga(share.snapshot)
    if (manga) return Response.json(manga, { headers })
    // A trailer (slice 22): its allow-listed snapshot — title, length, captions — and nothing else; its files have their own route.
    const video = publicVideo(share.snapshot)
    if (video) return Response.json(video, { headers })
    return shareNotFound()
  } catch (err) {
    if (err instanceof Refused && (err.status === 429 || err.status === 503)) return refusalResponse(err, { 'X-Content-Type-Options': 'nosniff' })
    return errorResponse(err, 'share-view', 'This page couldn’t be opened just now. Try again in a moment.')
  }
}
