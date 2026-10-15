// The v2 image route, kept only for a desk without accounts. Since slice 19
// every image is served under its project's address
// (`/api/projects/[id]/image/[imageId]`), where the owner is checked and the
// picture must be one of that project's own. This route can check neither, so
// with accounts on it answers a signed-in caller 404 for every id, exactly as
// for one that does not exist (SEC-06); a signed-out one gets the 401 first.
import { authMode } from '@/lib/auth/config'
import { requireUser } from '@/lib/auth/session'
import { Refused } from '@/lib/errors'
import { IMAGE_MISSING_HEADERS, imageNotFound, imageResponse } from '@/lib/images'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(req)
  } catch (err) {
    if (err instanceof Refused) return Response.json({ error: err.message }, { status: err.status, headers: IMAGE_MISSING_HEADERS })
    throw err
  }
  if (authMode() !== 'off') return imageNotFound()
  const { id } = await params
  return imageResponse(req, id)
}
