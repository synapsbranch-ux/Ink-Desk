// What the quota meter, the disabled buttons and the Usage page are shown
// (v3, slice 20): today's images, projects, video seconds and voice characters
// against the plan's limits, the spend today and this month from the providers'
// real costs, whether the studio is paused for everyone, and the first reason
// a spend would be refused. It is built from the SAME counters `reserve`
// checks (`lib/limits/usage.ts`), so what it shows is exactly what is enforced.
// Behind sign-in, read-rate-limited by `requireUser`, and never cached. See
// `devpost/prd.md > Limits and Usage (v3)`.
import { requireUser } from '@/lib/auth/session'
import { errorResponse } from '@/lib/errors'
import { usageView } from '@/lib/limits/usage'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const userId = await requireUser(req)
    return Response.json(await usageView(userId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err, 'usage', 'Your usage couldn’t be read just now. Try again in a moment.')
  }
}
