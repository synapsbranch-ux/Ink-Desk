// Rewrite panel, for a refusal: Claude rephrases ONLY this panel's action,
// camera and background — never the dialogue, never the DNA — and the panel
// is queued to redraw from the same locked sheet. A refusal is a wording
// problem, not a waiting problem, so it gets its own button and its own
// route. See `devpost/spec.md > Important Failure Modes`.
import { pageAt, read, update } from '@/lib/chapter'
import { rewritePanelVisuals } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { isQueued, queuePanel } from '@/lib/panels'
import { PANEL_LAYOUT } from '@/lib/prompts'
import { applyRewrite, findPanel } from '@/lib/script'

export const runtime = 'nodejs'

const CALM = 'The panel couldn’t be rewritten just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; n: string; i: string }> }) {
  const { id, n, i } = await params
  const index = /^[0-3]$/.test(i) ? Number(i) : -1
  if (index < 0) return Response.json({ error: 'There is no such panel.' }, { status: 404 })

  try {
    const addr = await pageAt(id, /^\d+$/.test(n) ? Number(n) : -1)
    const desk = await read(id, addr)
    const panel = findPanel(desk, index)
    if (panel.status !== 'refused') {
      throw new Refused(`Panel ${index + 1} wasn’t refused — Rewrite is for a panel the image model declined.`)
    }
    if (isQueued(addr, index)) throw new Refused(`Panel ${index + 1} is already waiting to ink.`)
    const character = desk.cast.find((c) => c.id === panel.characterId)
    if (!character) throw new Refused('That panel’s character isn’t on the desk any more. Reload the page.', 404)

    const visuals = await rewritePanelVisuals(panel, PANEL_LAYOUT[index], character)
    await update(id, (c) => applyRewrite(c, index, visuals), addr)
    console.log(`[p${addr.pageIndex + 1} panel ${index + 1}] rewritten — action, camera and background rephrased; dialogue untouched`)
    queuePanel(addr, index)
    return Response.json(await read(id, addr))
  } catch (err) {
    return errorResponse(err, 'rewrite', CALM)
  }
}
