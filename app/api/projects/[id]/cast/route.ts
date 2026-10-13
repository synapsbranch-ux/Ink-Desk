// The settled story → Claude → two characters on the desk. Called once,
// when the Library opens with nothing proposed yet; after that, Reroll. The
// story is the accepted synopsis (Pitch) or the saved scenario (Scenario,
// slice 11) — `storyBrief` reads either.
import { proposeCast } from '@/lib/cast'
import { read, update } from '@/lib/chapter'
import { writeCast } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { chargeText } from '@/lib/images'
import { textMeter } from '@/lib/llm'
import { storyBrief } from '@/lib/story'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t propose a cast just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // Checked before the call so a refused request costs nothing; the same
    // rules run again inside the lock, where they are authoritative.
    const current = await read(id)
    const story = storyBrief(current)
    if (!story) throw new Refused(current.storyMode === 'scenario' ? 'Save the scenario first.' : 'Accept a synopsis first.')
    if (current.cast.length > 0) throw new Refused('The cast is already proposed. Reroll a character instead.')

    const meter = textMeter()
    const { first, second } = await writeCast(story, current.storyMode === 'scenario' ? 'scenario' : 'synopsis', meter)
    const desk = await update(id, (c) => chargeText(proposeCast(c, first, second), meter))
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'cast', CALM)
  }
}
