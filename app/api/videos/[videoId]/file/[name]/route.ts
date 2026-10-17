// A trailer's file, for its owner (v3, slice 22): `final.mp4`, `poster.jpg` or `captions.vtt` — nothing else.
// Streamed from the outputs store with HTTP Range (206, `Accept-Ranges: bytes`, `Content-Range`, 416), because iOS
// Safari will not play a video without it and every browser seeks by it (`lib/video/serve.ts`). `HEAD` answers the
// same headers with no body. The browser never learns a bucket key or a signed URL.
// The caller must own the trailer: someone else's, an unknown id and a malformed one are the missing video's 404; so
// is a name off the list and a file that does not exist yet (a trailer still being made has none). The type is the
// file's own, `nosniff`, and `Cache-Control: private, no-store`: a trailer can be removed at any moment.
import { ownedVideo } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { errorResponse, Refused } from '@/lib/errors'
import { isVideoFileName, serveStored, VIDEO_FILE_TYPES, type VideoFileName } from '@/lib/video/serve'
import type { VideoRecord } from '@/lib/share/types'

export const runtime = 'nodejs'

const NO_SUCH_FILE = 'That file isn’t there.'

/** The record's own key for a file, never one built from the address. */
function keyOf(video: VideoRecord, name: VideoFileName): string | null {
  return name === 'final.mp4' ? video.finalKey : name === 'poster.jpg' ? video.posterKey : video.captionsKey
}

type Params = { params: Promise<{ videoId: string; name: string }> }

async function serve(req: Request, userId: string, { videoId, name }: { videoId: string; name: string }): Promise<Response> {
  const video = await ownedVideo(userId, videoId)
  if (!isVideoFileName(name)) throw new Refused(NO_SUCH_FILE, 404)
  const key = keyOf(video, name)
  if (!key) throw new Refused(NO_SUCH_FILE, 404)
  const response = await serveStored(req, { key, contentType: VIDEO_FILE_TYPES[name], cacheControl: 'private, no-store' })
  if (!response) throw new Refused(NO_SUCH_FILE, 404)
  return response
}

const CALM = 'The file couldn’t be read just now. Try again in a moment.'

export async function GET(req: Request, { params }: Params) {
  try {
    const userId = await requireUser(req)
    return await serve(req, userId, await params)
  } catch (err) {
    return errorResponse(err, 'video-file', CALM)
  }
}

export async function HEAD(req: Request, { params }: Params) {
  try {
    const userId = await requireUser(req)
    return await serve(req, userId, await params)
  } catch (err) {
    return errorResponse(err, 'video-file', CALM)
  }
}
