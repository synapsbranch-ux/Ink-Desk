// Queue every blank panel and respond at once. The generations finish on
// their own, two at a time, and write to `chapter.json` as they land; the
// browser polls `GET /api/chapter` to watch them arrive. Safe to call again
// after a reload — a panel already queued is skipped. See `lib/panels.ts`.
import { read } from '@/lib/chapter'
import { errorResponse } from '@/lib/errors'
import { queueBlankPanels } from '@/lib/panels'

export const runtime = 'nodejs'

const CALM = 'The page couldn’t start inking just now. Try again in a moment.'

export async function POST() {
  try {
    const queued = await queueBlankPanels()
    if (queued.length > 0) console.log(`[panels] queued panel ${queued.map((i) => i + 1).join(', ')}`)
    return Response.json(await read())
  } catch (err) {
    return errorResponse(err, 'panels', CALM)
  }
}
