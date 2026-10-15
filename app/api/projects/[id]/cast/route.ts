// The settled story → Claude → two characters on the desk. Called once,
// when the Library opens with nothing proposed yet; after that, Reroll. The
// story is the accepted synopsis (Pitch) or the saved scenario (Scenario,
// slice 11) — `storyBrief` reads either.
import { ownedProject } from '@/lib/auth/access'
import { requireUser } from '@/lib/auth/session'
import { proposeCast } from '@/lib/cast'
import { read } from '@/lib/chapter'
import { writeCast } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { updateCharging } from '@/lib/images'
import { spendText } from '@/lib/limits/text'
import { storyBrief } from '@/lib/story'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t propose a cast just now. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const userId = await requireUser(req)
    await ownedProject(userId, id) // before the flag, the body or any provider: someone else's project is a 404
    assertGenerationEnabled()
    // Checked before the call so a refused request costs nothing; the same
    // rules run again inside the lock, where they are authoritative.
    const current = await read(id)
    const story = storyBrief(current)
    if (!story) throw new Refused(current.storyMode === 'scenario' ? 'Save the scenario first.' : 'Accept a synopsis first.')
    if (current.cast.length > 0) throw new Refused('The cast is already proposed. Reroll a character instead.')

    const desk = await spendText(userId, 'cast', async (meter) => {
      const { first, second } = await writeCast(story, current.storyMode === 'scenario' ? 'scenario' : 'synopsis', meter)
      return updateCharging(id, meter, (c) => proposeCast(c, first, second))
    })
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'cast', CALM)
  }
}
