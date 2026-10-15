// The desk's shelf: GET lists the caller's projects — and nobody else's (on a
// desk without accounts it also runs the one-time v1 migration on first
// read); POST starts a new project with its locked style
// — optionally with a story already accepted, which is how "accepting a new
// synopsis starts a new chapter" reads in v2: a new project, the old one
// untouched, owned by whoever started it (slice 19). See `devpost/prd.md > Dashboard` and `> New Project and Style
// Presets`.
import { requireUser } from '@/lib/auth/session'
import { JSON_LIMIT_BYTES, parseJson } from '@/lib/body'
import { createProject, listProjects } from '@/lib/chapter'
import { errorResponse } from '@/lib/errors'
import { NewProjectSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const userId = await requireUser(req)
    return Response.json({ projects: await listProjects(userId) })
  } catch (err) {
    return errorResponse(err, 'projects', 'The desk couldn’t be read.')
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUser(req) // before the body is read
    const input = await parseJson(req, NewProjectSchema, JSON_LIMIT_BYTES, 'A new project needs a title and a style.')
    return Response.json(await createProject(input, userId))
  } catch (err) {
    return errorResponse(err, 'projects', 'The desk couldn’t start the new project.')
  }
}
