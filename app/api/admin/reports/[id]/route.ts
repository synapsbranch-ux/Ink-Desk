// POST an action on one report (v3, slice 21): `{ action: 'unpublish' | 'handled' }`.
// Behind `requireAdmin`, called FIRST, before the body is read or the report
// looked up: anyone who is not an admin — a signed-in stranger, an account whose
// email left ADMIN_EMAILS — gets 404 and the unknown page's sentence, word for
// word, whether the report exists or not, so nothing here says that it is there.
// (A signed-out caller gets the 401 every API route gives.)
//
//   handled    stamps `handledAt` on the report; the first time stands, so doing
//              it twice changes nothing and answers the same.
//   unpublish  revokes the share the report is about (`unpublishToken`, which
//              drops the snapshot, lets go of the pictures only the link still
//              held, and is idempotent: the page, the pictures and the preview
//              image then answer exactly as for a link that never existed) and marks every report about that share handled — the one
//              action answers them all, and the queue should not keep asking about
//              a page that is gone (the answer lists their ids as `sameShare`, so
//              the screen can update those rows). A share that no longer exists is
//              already as unpublished as it gets: still 200.
//
// An unknown report id is the non-admin's 404. The answer is the report as the
// list shows it, so the screen can update that row.
import { NO_SUCH_PAGE, requireAdmin } from '@/lib/auth/admin'
import { parseJson } from '@/lib/body'
import { errorResponse, Refused } from '@/lib/errors'
import { ADMIN_ACTION_LIMIT, ADMIN_ACTION_UNREADABLE, AdminActionSchema, adminReportView } from '@/lib/share/report'
import { unpublishToken } from '@/lib/share/service'
import { store } from '@/lib/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  try {
    await requireAdmin(req) // before the body is read, the id looked at, or a store asked
    const { action } = await parseJson(req, AdminActionSchema, ADMIN_ACTION_LIMIT, ADMIN_ACTION_UNREADABLE)
    const { id } = await params
    const report = await store.reports.get(id)
    if (!report) throw new Refused(NO_SUCH_PAGE, 404)
    const now = new Date().toISOString()
    // The other reports about the same share, which an unpublish answers too (the screen updates them without asking again).
    let sameShare: string[] = []
    if (action === 'unpublish') {
      await unpublishToken(report.token) // the link dies, and so do the pictures only it held
      const all = await store.reports.list({ limit: 1000 })
      sameShare = all.filter((other) => other.token === report.token).map((other) => other.id)
      for (const other of sameShare) await store.reports.markHandled(other, now)
    } else {
      await store.reports.markHandled(id, now)
    }
    const after = (await store.reports.get(id)) ?? report
    const share = await store.shares.get(after.token)
    return Response.json({ report: adminReportView(after, share), ...(action === 'unpublish' ? { sameShare } : {}) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err, 'admin-reports', 'That couldn’t be done just now. Try again in a moment.')
  }
}
