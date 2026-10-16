// A project's public share, for its owner (v3, slice 21):
//   GET     → { share: ShareView | null }   the active share, if there is one
//   POST    → { share }                     Share publicly — idempotent: the active share if it exists
//   PUT     → { share }                     Update share — the snapshot retaken; 409 if there is none to update
//   DELETE  → { share: null }               Unpublish — idempotent; the address is dead for good
// The caller must own the project (someone else's is the missing project's 404,
// before any body is read). None of the writes takes input: the project is the
// one in the address. Every reply carries a token, so none is ever cached.
// See `lib/share/service.ts` and `devpost/spec.md > Sharing (v3)`.
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { assertNoInput, createShare, refreshShare, shareViewOfProject, unpublishProject } from '@/lib/share/service'
import { shareOrigin } from '@/lib/share/url'
import type { ShareView } from '@/lib/share/types'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

const reply = (share: ShareView | null) => Response.json({ share }, { headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: Request, { params }: Params) {
  const { id } = await params
  try {
    const userId = await requireUser(req)
    const project = await ownedProject(userId, id)
    return reply(await shareViewOfProject(userId, project, shareOrigin(req)))
  } catch (err) {
    return errorResponse(err, 'share', 'The share couldn’t be read just now. Try again in a moment.')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  try {
    const userId = await requireUser(req)
    const project = await ownedProject(userId, id) // before the body is read
    await assertNoInput(req)
    return reply(await createShare(userId, project, shareOrigin(req)))
  } catch (err) {
    return errorResponse(err, 'share', 'The share couldn’t be made just now. Try again in a moment.')
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params
  try {
    const userId = await requireUser(req)
    const project = await ownedProject(userId, id)
    await assertNoInput(req)
    return reply(await refreshShare(userId, project, shareOrigin(req)))
  } catch (err) {
    return errorResponse(err, 'share', 'The share couldn’t be updated just now. Try again in a moment.')
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params
  try {
    const userId = await requireUser(req)
    const project = await ownedProject(userId, id)
    await assertNoInput(req)
    await unpublishProject(userId, project)
    return reply(null)
  } catch (err) {
    return errorResponse(err, 'share', 'The share couldn’t be taken down just now. Try again in a moment.')
  }
}
