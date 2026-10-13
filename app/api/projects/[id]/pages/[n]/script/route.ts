// Both sheets locked → Claude → the four-panel page script for page n,
// written once. The schema is built from the two locked ids, so one locked
// character per panel, alternating, is enforced by the API rather than
// checked afterwards. (The Director's chapter plan replaces this entry point
// in slice 11; the v1 journey still needs it.)
import { pageAt, read, update } from '@/lib/chapter'
import { writePageScript } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import type { LockedCharacter } from '@/lib/prompts'
import { lockedPair, newScript } from '@/lib/script'
import type { Character } from '@/lib/types'

export const runtime = 'nodejs'

const CALM = 'The page script didn’t come back, the studio is busy. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params
  try {
    const addr = await pageAt(id, /^\d+$/.test(n) ? Number(n) : -1)
    // Checked before the call so a refused request costs nothing; `newScript`
    // runs the same rules again inside the lock, where they are authoritative.
    const current = await read(id, addr)
    const synopsis = current.synopsis
    if (!synopsis) throw new Refused('Pitch a story first.')
    const [lead, counterpart] = lockedPair(current)
    if (current.script) throw new Refused('The page script is already written.')

    const out = await writePageScript(synopsis, [locked(lead), locked(counterpart)])
    const desk = await update(id, (c) => newScript(c, out), addr)
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'script', CALM)
  }
}

/** `lockedPair` has already proven the DNA is there. */
function locked(c: Character): LockedCharacter {
  return { id: c.id, name: c.name, role: c.role, traits: c.traits, dna: c.dna ?? '' }
}
