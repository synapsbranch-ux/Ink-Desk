// One file of a shared trailer (v3, slice 22) — public, streamed, with HTTP Range, and only ever the video of THIS
// share: `final.mp4`, `poster.jpg`, and `captions.vtt` when the share says it has captions. A stranger holding the link
// has no session, so this route takes none and never calls `requireUser`. It takes the `anonMedia` client-address
// window FIRST (a player asks for one range at a time, so the window is the pictures' wide one), before the store is
// read. The token is checked by shape, the share is looked up, and the files are found through the share's own
// `videoId` — nothing in the address names a video, an owner or a key. A revoked token, an unknown one, a malformed
// one, a name off the list, captions the trailer does not have, and a file that is gone are ONE 404: the same body
// and headers, so the route cannot tell a stranger which links ever lived. Never cached (`no-store`: unpublishing
// takes effect at once), never sniffed. `HEAD` answers the same headers with no body.
import { Refused, refusalResponse } from '@/lib/errors'
import { IMAGE_MISSING_HEADERS } from '@/lib/images'
import { limitByAddress } from '@/lib/limits/requests'
import { lookupSharedVideo, shareNotFound } from '@/lib/share/public'
import { isVideoFileName, serveStored, VIDEO_FILE_TYPES } from '@/lib/video/serve'

export const runtime = 'nodejs'

type Params = { params: Promise<{ token: string; name: string }> }

/** The window said no: the same refusal as the pictures', never cached. Anything but a refusal is a real failure. */
function limited(err: unknown): Response {
  if (err instanceof Refused) return refusalResponse(err, IMAGE_MISSING_HEADERS)
  throw err
}

async function serve(req: Request, { token, name }: { token: string; name: string }): Promise<Response> {
  try {
    const shared = isVideoFileName(name) ? await lookupSharedVideo(token) : null
    if (!shared || !isVideoFileName(name)) return shareNotFound()
    const key = name === 'final.mp4' ? shared.video.finalKey : name === 'poster.jpg' ? shared.video.posterKey : shared.snapshot.hasCaptions ? shared.video.captionsKey : null
    if (!key) return shareNotFound()
    return (await serveStored(req, { key, contentType: VIDEO_FILE_TYPES[name], cacheControl: 'no-store' })) ?? shareNotFound()
  } catch (err) {
    // A bucket or a disk that can't be read: the cause in the terminal (the token stays out of the log), a calm 502 for the player.
    console.error('[share-file] a shared trailer’s file couldn’t be read:', err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502, headers: IMAGE_MISSING_HEADERS })
  }
}

export async function GET(req: Request, { params }: Params) {
  try {
    await limitByAddress(req, 'anonMedia')
  } catch (err) {
    return limited(err)
  }
  return serve(req, await params)
}

export async function HEAD(req: Request, { params }: Params) {
  try {
    await limitByAddress(req, 'anonMedia')
  } catch (err) {
    return limited(err)
  }
  return serve(req, await params)
}
