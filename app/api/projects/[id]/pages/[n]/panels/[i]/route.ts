// Ink one panel of page n, by its 0-based index — the single-panel entry to
// the same queue `start` fills four times. Since slice 6 this is also Redraw
// panel (a `done` panel grows a new version, capped at three) and Try again
// (a `failed` or `refused` panel reruns the same request). Only a panel
// already inking, or already waiting for a slot, is refused.
import { pageAt, read } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { isQueued, queuePanel } from '@/lib/panels'
import { findPanel } from '@/lib/script'

export const runtime = 'nodejs'

const CALM = 'The panel couldn’t start inking just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; n: string; i: string }> }) {
  const { id, n, i } = await params
  const index = /^[0-3]$/.test(i) ? Number(i) : -1
  if (index < 0) return Response.json({ error: 'There is no such panel.' }, { status: 404 })

  try {
    const addr = await pageAt(id, /^\d+$/.test(n) ? Number(n) : -1)
    const panel = findPanel(await read(id, addr), index)
    if (panel.status === 'inking') throw new Refused(`Panel ${index + 1} is already inking.`)
    if (isQueued(addr, index)) throw new Refused(`Panel ${index + 1} is already waiting to ink.`)
    queuePanel(addr, index)
    return Response.json(await read(id, addr))
  } catch (err) {
    return errorResponse(err, 'panel', CALM)
  }
}
