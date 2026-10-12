// Ink one panel, by its 0-based index. In this slice it is the single-panel
// entry to the same queue `start` fills four times; redrawing a panel that
// already has art, with the version history behind it, is slice 6.
import { read } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { queuePanel } from '@/lib/panels'
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
    if (panel.versions.length > 0) throw new Refused(`Panel ${index + 1} is already inked.`)
    queuePanel(index)
    return Response.json(await read())
  } catch (err) {
    return errorResponse(err, 'panel', CALM)
  }
}
