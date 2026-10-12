// The accepted synopsis → Claude → two characters on the desk. Called once,
// when Cast opens with nothing proposed yet; after that, Reroll.
import { proposeCast } from '@/lib/cast'
import { read, update } from '@/lib/chapter'
import { writeCast } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t propose a cast just now. Try again in a moment.'

export async function POST() {
  try {
    // Checked before the call so a refused request costs nothing; the same
    // rules run again inside the lock, where they are authoritative.
    const current = await read()
    if (current.synopsis?.accepted !== true) throw new Refused('Accept a synopsis first.')
    if (current.cast.length > 0) throw new Refused('The cast is already proposed. Reroll a character instead.')

    const { first, second } = await writeCast(current.synopsis)
    const chapter = await update((c) => proposeCast(c, first, second))
    return Response.json(chapter)
  } catch (err) {
    return errorResponse(err, 'cast', CALM)
  }
}
