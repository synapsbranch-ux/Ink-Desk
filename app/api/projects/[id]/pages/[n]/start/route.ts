// Queue every blank panel of page n and respond at once. The generations
// finish on their own, two at a time, and write to the project as they land;
// the browser polls `GET /api/projects/[id]` to watch them arrive. Safe to
// call again after a reload — a panel already queued is skipped. See
// `lib/panels.ts`.
import { pageAt, read } from '@/lib/chapter'
import { errorResponse } from '@/lib/errors'
import { queueBlankPanels } from '@/lib/panels'

export const runtime = 'nodejs'

const CALM = 'The page couldn’t start inking just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params
  try {
    const addr = await pageAt(id, /^\d+$/.test(n) ? Number(n) : -1)
    const queued = await queueBlankPanels(addr)
    if (queued.length > 0) console.log(`[p${addr.pageIndex + 1}] queued panel ${queued.map((i) => i + 1).join(', ')}`)
    return Response.json(await read(id, addr))
  } catch (err) {
    return errorResponse(err, 'panels', CALM)
  }
}
