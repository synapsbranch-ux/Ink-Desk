// Reroll one character: a fresh proposal from Claude replaces exactly that
// card, with the other character held fixed in the prompt and untouched on
// the desk. Text only — the sheet and DNA start over.
import { assertUnlocked, findCharacter, replaceCharacter } from '@/lib/cast'
import { read } from '@/lib/chapter'
import { rewriteCharacter } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { updateCharging } from '@/lib/images'
import { textMeter } from '@/lib/llm'
import { RerollRequestSchema } from '@/lib/schemas'
import { storyBrief } from '@/lib/story'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t reroll that character just now. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const parsed = RerollRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'That request couldn’t be read.' }, { status: 400 })
  const { id } = parsed.data

  try {
    const current = await read(projectId)
    const synopsis = storyBrief(current)
    if (!synopsis) throw new Refused(current.storyMode === 'scenario' ? 'Save the scenario first.' : 'Accept a synopsis first.')
    const target = assertUnlocked(findCharacter(current, id))
    const keep = current.cast.find((c) => c.id !== id)
    if (!keep) throw new Refused('The cast isn’t complete yet.')

    const meter = textMeter()
    const proposal = await rewriteCharacter(synopsis, keep, target, meter)
    const desk = await updateCharging(projectId, meter, (c) => replaceCharacter(c, id, proposal))
    return Response.json(desk)
  } catch (err) {
    return errorResponse(err, 'cast/reroll', CALM)
  }
}
