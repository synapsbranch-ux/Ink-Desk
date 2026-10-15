// One stored image, for its project's owner (v3, slice 19). The caller must
// be signed in, must own the project, and the picture must be one the project
// holds — a sheet, a panel or cover version, an upload — or the answer is the
// same 404 as for an image that does not exist (SEC-01, SEC-06). Then it
// streams exactly as before: ETag, 304, `no-store` on every non-200, nosniff.
import { assertImageInProject, ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { Refused } from '@/lib/errors'
import { IMAGE_MISSING_HEADERS, imageNotFound, imageResponse } from '@/lib/images'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const { id, imageId } = await params
  try {
    const userId = await requireUser(req)
    assertImageInProject(await ownedProject(userId, id), imageId)
  } catch (err) {
    if (err instanceof Refused && err.status === 401) return Response.json({ error: err.message }, { status: 401, headers: IMAGE_MISSING_HEADERS })
    if (err instanceof Refused && err.status < 500) return imageNotFound()
    // A project that can't be read, a store that is down: the broken-image state, the cause in the terminal.
    console.error(`[image] ${id}/${imageId} couldn’t be checked:`, err instanceof Error ? err.message : err)
    return new Response('Unavailable', { status: 502, headers: IMAGE_MISSING_HEADERS })
  }
  return imageResponse(req, imageId)
}
