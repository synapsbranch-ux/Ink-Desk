// Where a share lives (v3, slice 21): the address a link is built from, and the
// shape a token must have before anything is asked of the store. Pure and
// client-safe — the dialog and the settings list build their links from the
// `ShareView` the server sends, but the public page and its routes use the
// same two checks, so a path like `../chapter.json` or a 5 000-character token
// is the unknown share's 404 without a single store call.
// See `devpost/spec.md > Sharing (v3)`.
import { appOrigin } from '../auth/config'

/**
 * What a token looks like: base62, and the store's own bounds (8 to 64). The
 * studio mints 128 random bits, which is 22 characters; the range only keeps
 * this check from disagreeing with the store about what a filename may be.
 */
const SHARE_TOKEN = /^[A-Za-z0-9]{8,64}$/

export function isShareToken(token: unknown): token is string {
  return typeof token === 'string' && SHARE_TOKEN.test(token)
}

/** `/s/<token>` — the public page. */
export function sharePath(token: string): string {
  return `/s/${token}`
}

/** `/api/s/<token>/image/<imageId>` — the one way a shared picture reaches a browser (it is streamed; no bucket key or signed URL is ever handed out). */
export function shareImageUrl(token: string, imageId: string): string {
  return `/api/s/${encodeURIComponent(token)}/image/${encodeURIComponent(imageId)}`
}

/** An origin we are willing to put in a link: http(s) only, nothing else of the URL. */
function originOfUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The origin a share link is built on: the studio's own address from `APP_URL`
 * when it is set (always, in production), else the origin the request came to —
 * a development desk, where the link only has to work on this machine.
 */
export function shareOrigin(req: Request, env: Record<string, string | undefined> = process.env): string {
  return appOrigin(env) ?? originOfUrl(req.url) ?? 'http://localhost:3000'
}

/** The absolute link for a token. */
export function shareUrl(origin: string, token: string): string {
  return `${origin}${sharePath(token)}`
}
