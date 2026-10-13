// Accepting a new synopsis while a chapter is on the desk — the confirmed
// clear from `devpost/prd.md > Screens and Layout` ("Back to Story and
// accepting a new synopsis starts a new chapter"). One atomic write: the desk
// returns to first use and wakes with the new story already accepted. The
// plain New-chapter button (no new story) is `DELETE /api/chapter`.
import { newChapter } from '@/lib/chapter'
import { errorResponse } from '@/lib/errors'
import { NewChapterSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const parsed = NewChapterSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'A new chapter needs its pitch and an accepted synopsis.' }, { status: 400 })
  }
  try {
    return Response.json(await newChapter(parsed.data))
  } catch (err) {
    return errorResponse(err, 'chapter', 'The desk couldn’t start the new chapter.')
  }
}
