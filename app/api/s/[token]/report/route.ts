// POST a report about a shared page (v3, slice 21). Public: the visitor holds a
// link, not a session, so this route takes no sign-in and asks for none. What it
// takes instead, FIRST and before it reads a byte of the body, is the report
// window of the visitor's address (`limitByAddress`: 6 an hour by default, a
// hash of the trusted-hop address as the key, and — because it is a form anyone
// can post to with a store write behind it — it fails CLOSED if the counter
// store is down). The proxy has already run its Origin check on this write.
//
// THE VISITOR IS NEVER TOLD THE OUTCOME (`devpost/prd.md > Report (v3)`). The
// answer is the same `200 { ok: true }` — the same body, the same headers — for
// a share that is published, one that was unpublished and a token that never
// existed, and for a report that was kept and one that was not. So the form
// cannot be used to probe which links are live; a token is 128 random bits and
// guessing one gains nothing, but the route would not be a leak even if it were
// short. Only a share record that EXISTS (revoked ones included — a report about
// something already taken down is still worth reading) gets a report stored.
//
// A body that cannot be used (not JSON, an unknown key, a reason off the list, a
// note over 500 characters after it is cleaned) is a calm 400, the same whatever
// the token is. If the counter or the store is unavailable the visitor hears so
// in a sentence (503/500) and may try again: the report was not kept, and
// saying "thanks" for it would be a lie. A stored report holds the reason, the
// cleaned note, the time and the window's keyed hash of the address — never the
// address (`lib/share/report.ts`).
import { parseJson } from '@/lib/body'
import { errorResponse } from '@/lib/errors'
import { limitByAddress } from '@/lib/limits/requests'
import { REPORT_BODY_LIMIT, REPORT_THANKS, REPORT_UNREADABLE, ReportBodySchema, reportRecord } from '@/lib/share/report'
import { store } from '@/lib/store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ token: string }> }

export async function POST(req: Request, { params }: Params) {
  try {
    await limitByAddress(req, 'report') // first: a stranger's request costs the store nothing until it has a window
    const body = await parseJson(req, ReportBodySchema, REPORT_BODY_LIMIT, REPORT_UNREADABLE)
    const { token } = await params
    const share = await store.shares.get(token)
    if (share) await store.reports.add(reportRecord(req, token, body))
    return Response.json(REPORT_THANKS, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err, 'report', 'Your report couldn’t be sent just now. Try again in a little while.')
  }
}
