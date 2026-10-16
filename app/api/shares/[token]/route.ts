// Unpublish a share by its token (v3, slice 21) — the Settings › Sharing list's
// button. Owner only: a token that is someone else's, unknown or malformed is
// "There is no such share." before the body is read. Unpublishing twice is not
// an error (`includeRevoked`), so a retry after a dropped reply still ends well.
// The address is dead for good and the snapshot is dropped with it.
import { ownedShare } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { assertNoInput, unpublishToken } from '@/lib/share/service'

export const runtime = 'nodejs'

export async function DELETE(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const userId = await requireUser(req)
    await ownedShare(userId, token, { includeRevoked: true }) // before the body is read
    await assertNoInput(req)
    await unpublishToken(token)
    return Response.json({ share: null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err, 'shares', 'The share couldn’t be taken down just now. Try again in a moment.')
  }
}
