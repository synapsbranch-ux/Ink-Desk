// Rewrite panel, for a refusal: Claude rephrases ONLY this panel's action,
// camera and background — never the dialogue, never the DNA — and the panel
// is queued to redraw from the same locked sheet. A refusal is a wording
// problem, not a waiting problem, so it gets its own button and its own
// route. See `devpost/spec.md > Important Failure Modes`.
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { pageAt, read } from '@/lib/chapter'
import { rewritePanelVisuals } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { updateCharging } from '@/lib/images'
import { preflight } from '@/lib/limits/hold'
import { imageEstimateUsd, TEXT_ESTIMATE_USD } from '@/lib/limits/estimate'
import { spendText } from '@/lib/limits/text'
import { limitsEnabled } from '@/lib/config'
import { isQueued, queuePanel } from '@/lib/panels'
import { assertCanEnqueue } from '@/lib/queue/enqueue'
import { readWithActivity } from '@/lib/queue/status'
import { PANEL_LAYOUT } from '@/lib/prompts'
import { applyRewrite, findPanel } from '@/lib/script'

export const runtime = 'nodejs'

const CALM = 'The panel couldn’t be rewritten just now. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string; n: string; i: string }> }) {
  const { id, n, i } = await params
  try {
    const userId = await requireUser(req)
    await ownedProject(userId, id) // before the flag, the body or any provider: someone else's project is a 404
    assertGenerationEnabled()
    const index = /^[0-3]$/.test(i) ? Number(i) : -1
    if (index < 0) throw new Refused('There is no such panel.', 404)
    const addr = await pageAt(id, /^\d+$/.test(n) ? Number(n) : -1)
    const desk = await read(id, addr)
    const panel = findPanel(desk, index)
    if (panel.status !== 'refused') {
      throw new Refused(`Panel ${index + 1} wasn’t refused — Rewrite is for a panel the image model declined.`)
    }
    if (await isQueued(addr, index)) throw new Refused(`Panel ${index + 1} is already waiting to ink.`)
    const character = desk.cast.find((c) => c.id === panel.characterId)
    if (!character) throw new Refused('That panel’s character isn’t on the desk any more. Reload the page.', 404)

    // Ask whether the queue will take the panel BEFORE paying Claude to rephrase it: a refusal after the
    // rewrite would leave a rephrased panel that can only be drawn by paying again.
    await assertCanEnqueue(userId)
    // The same goes for the picture the rewrite is for: its quota unit and dollars must fit, or the paid rephrase is wasted (slice 20).
    if (limitsEnabled()) await preflight(userId, { image: 1 }, imageEstimateUsd('panel') + TEXT_ESTIMATE_USD.rewrite)

    await spendText(userId, 'rewrite', async (meter) => {
      const visuals = await rewritePanelVisuals(panel, PANEL_LAYOUT[index], character, meter)
      await updateCharging(id, meter, (c) => applyRewrite(c, index, visuals), addr)
    })
    console.log(`[p${addr.pageIndex + 1} panel ${index + 1}] rewritten — action, camera and background rephrased; dialogue untouched`)
    await queuePanel(addr, index)
    return Response.json(await readWithActivity(id))
  } catch (err) {
    return errorResponse(err, 'rewrite', CALM)
  }
}
