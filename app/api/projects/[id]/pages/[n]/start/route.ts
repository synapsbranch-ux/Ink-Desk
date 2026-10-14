// Generate page n: with a plan, the plan's four lines become the page's
// panels (once) — then every blank panel of that page is queued and the
// route responds at once. The generations finish on their own, two at a
// time, and write to the project as they land; the browser polls
// `GET /api/projects/[id]` to watch them arrive. Safe to call again after a
// reload — a written page is not rewritten and a queued panel is skipped.
// See `lib/director.ts` and `lib/panels.ts`.
import { pageAt } from '@/lib/chapter'
import { startPage } from '@/lib/director'
import { errorResponse } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { readWithActivity } from '@/lib/queue/status'

export const runtime = 'nodejs'

const CALM = 'The page couldn’t start inking just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params
  try {
    assertGenerationEnabled()
    const addr = await pageAt(id, /^\d+$/.test(n) ? Number(n) : -1)
    const queued = await startPage(addr)
    if (queued.length > 0) console.log(`[p${addr.pageIndex + 1}] queued panel ${queued.map((i) => i + 1).join(', ')}`)
    // The open page, as every reply is — the studio renders whatever it gets.
    return Response.json(await readWithActivity(id))
  } catch (err) {
    return errorResponse(err, 'panels', CALM)
  }
}
