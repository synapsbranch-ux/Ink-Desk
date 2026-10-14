// Generate all (slice 11): every page the plan has that isn't written yet is
// written from it in one write — all or nothing — and every blank panel is
// queued in page order: page 1's, then page 2's, and so on, `PANEL_CONCURRENCY`
// at a time across the queue. Idempotent. A static `all` segment, matched
// before `pages/[n]`, whose own route only takes digits.
import { read } from '@/lib/chapter'
import { startAll } from '@/lib/director'
import { errorResponse } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'

export const runtime = 'nodejs'

const CALM = 'The chapter couldn’t start inking just now. Try again in a moment.'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    assertGenerationEnabled()
    const { written, queued } = await startAll(id)
    if (written.length > 0) console.log(`[chapter] wrote page ${written.map((n) => n + 1).join(', ')} from the plan`)
    if (queued.length > 0) console.log(`[chapter] queued ${queued.join(', ')}`)
    return Response.json(await read(id))
  } catch (err) {
    return errorResponse(err, 'chapter', CALM)
  }
}
