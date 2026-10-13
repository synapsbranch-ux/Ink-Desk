// Ink one panel, by its 0-based index — the single-panel entry to the same
// queue `start` fills four times. Since slice 6 this is also Redraw panel
// (a `done` panel grows a new version, capped at three) and Try again (a
// `failed` or `refused` panel reruns the same request). Only a panel already
// inking, or already waiting for a slot, is refused.
import { read } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { isQueued, queuePanel } from '@/lib/panels'
import { findPanel } from '@/lib/script'

export const runtime = 'nodejs'

const CALM = 'The panel couldn’t start inking just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ index: string }> }) {
  const { index: raw } = await params
  const index = /^[0-3]$/.test(raw) ? Number(raw) : -1
  if (index < 0) return Response.json({ error: 'There is no such panel.' }, { status: 404 })

  try {
    const panel = findPanel(await read(), index)
    if (panel.status === 'inking') throw new Refused(`Panel ${index + 1} is already inking.`)
    if (isQueued(index)) throw new Refused(`Panel ${index + 1} is already waiting to ink.`)
    queuePanel(index)
    return Response.json(await read())
  } catch (err) {
    return errorResponse(err, 'panel', CALM)
  }
}
