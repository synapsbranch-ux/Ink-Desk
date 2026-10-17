// A person's studio defaults (v3, slice 21), for Settings › Defaults:
//   GET → { settings: { defaultStyle, readingDirection, voices, updatedAt } }   what is saved, or the studio's own where nothing is
//   PUT → { settings }                                                  save the form; the same body twice ends the same
// The caller's own id is the only key — there is no one else's record to ask
// for — and a save is an ordinary edit (the edit window `requireUser` applies).
// The body is read with a small cap and parsed strictly: a known style or null,
// 'rtl' or 'ltr', and (slice 22) optionally `voices: { lead?, counterpart? }` —
// each a premade voice's name or null — nothing else, so it can never touch the
// id or the clock. A voice has no preview audio: that would cost money. Never
// cached. See `lib/settings.ts`.
import { requireUser } from '@/lib/auth/session'
import { parseJson } from '@/lib/body'
import { errorResponse } from '@/lib/errors'
import { DEFAULTS_BODY_LIMIT_BYTES, DEFAULTS_UNREADABLE, DefaultsSchema, readSettings, writeSettings } from '@/lib/settings'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: Request) {
  try {
    const userId = await requireUser(req)
    return Response.json({ settings: await readSettings(userId) }, { headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'settings', 'Your defaults couldn’t be read just now. Try again in a moment.')
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await requireUser(req)
    const input = await parseJson(req, DefaultsSchema, DEFAULTS_BODY_LIMIT_BYTES, DEFAULTS_UNREADABLE)
    return Response.json({ settings: await writeSettings(userId, input) }, { headers: NO_STORE })
  } catch (err) {
    return errorResponse(err, 'settings', 'Your defaults couldn’t be saved just now. Try again in a moment.')
  }
}
