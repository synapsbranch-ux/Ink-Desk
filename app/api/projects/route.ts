// The desk's shelf: GET lists every project (and runs the one-time v1
// migration on first read); POST starts a new project with its locked style
// — optionally with a story already accepted, which is how "accepting a new
// synopsis starts a new chapter" reads in v2: a new project, the old one
// untouched. See `devpost/prd.md > Dashboard` and `> New Project and Style
// Presets`.
import { createProject, listProjects } from '@/lib/chapter'
import { errorResponse } from '@/lib/errors'
import { NewProjectSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

export async function GET() {
  try {
    return Response.json({ projects: await listProjects() })
  } catch (err) {
    return errorResponse(err, 'projects', 'The desk couldn’t be read.')
  }
}

export async function POST(req: Request) {
  const parsed = NewProjectSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'A new project needs a title and a style.' }, { status: 400 })
  }
  try {
    return Response.json(await createProject(parsed.data))
  } catch (err) {
    return errorResponse(err, 'projects', 'The desk couldn’t start the new project.')
  }
}
