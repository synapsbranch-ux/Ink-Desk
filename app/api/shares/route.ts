// Everything the caller has published (v3, slice 21): their ACTIVE shares,
// newest first, for Settings › Sharing. Each is a `ShareView` — the link, the
// title, the page count and whether the project has changed since — never the
// snapshot. A revoked share is gone from here for good. No input; the caller's
// own id is the only filter.
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { listShareViews } from '@/lib/share/service'
import { shareOrigin } from '@/lib/share/url'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const userId = await requireUser(req)
    return Response.json({ shares: await listShareViews(userId, shareOrigin(req)) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err, 'shares', 'Your shared links couldn’t be listed just now. Try again in a moment.')
  }
}
