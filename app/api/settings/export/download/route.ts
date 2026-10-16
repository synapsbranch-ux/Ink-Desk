// The export itself (v3, slice 21): the caller's latest ready zip, streamed from the
// outputs store. The key is built from the CALLER'S id (`exports/<userId>/…`), so no
// parameter can name another person's file — there is none to name — and a caller with
// no export gets the same calm 404 as anyone. It is an attachment (the browser saves
// it, never renders it), `no-store` (it holds a person's whole desk), `nosniff`, and
// named `ink-desk-export-<date>.zip` after the day it was made. The zip is streamed,
// never read whole. See `lib/account/export.ts`.
import { requireUser } from '@/lib/auth/session'
import { latestExport } from '@/lib/account/state'
import { errorResponse } from '@/lib/errors'
import { store } from '@/lib/store'

export const runtime = 'nodejs'

const NONE = 'There is no export to download yet. Make one first.'

export async function GET(req: Request) {
  try {
    const userId = await requireUser(req)
    const latest = await latestExport(userId)
    const body = latest ? await store.outputs.open(latest.key) : null
    if (!latest || !body) return Response.json({ error: NONE }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    const day = latest.modifiedAt.slice(0, 10)
    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="ink-desk-export-${day}.zip"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    if (body.bytes !== null) headers['Content-Length'] = String(body.bytes)
    return new Response(body.body, { status: 200, headers })
  } catch (err) {
    return errorResponse(err, 'export', 'Your export couldn’t be downloaded just now. Try again in a moment.')
  }
}
