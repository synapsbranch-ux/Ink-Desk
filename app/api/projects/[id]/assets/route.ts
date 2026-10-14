// Upload a reference to the project's shelf (v2, slice 10). Multipart, one
// file in the `file` field. The bytes decide the type — PNG, JPEG or WebP —
// never the browser's label or the file name; anything else, anything empty
// and anything over the limit is refused with a sentence and nothing is
// stored. See `devpost/spec.md > Assets and Imported References (v2)`.
import { assetName, checkUpload, UPLOAD_LIMIT_BYTES } from '@/lib/assets'
import { readForm } from '@/lib/body'
import { read } from '@/lib/chapter'
import { errorResponse, Refused } from '@/lib/errors'
import { saveAsset } from '@/lib/images'

export const runtime = 'nodejs'

const CALM = 'The reference couldn’t be put on the shelf just now. Try again in a moment.'
const TOO_LARGE = `That picture is over ${UPLOAD_LIMIT_BYTES / (1024 * 1024)} MB. Save a smaller copy and upload that.`
/** One picture plus the multipart envelope around it. */
const FORM_LIMIT_BYTES = UPLOAD_LIMIT_BYTES + 64 * 1024

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // Route handlers have no body-size limit of their own (the Next 16 docs
    // say so). A declared length over the cap is refused before anything is
    // read; a chunked body with no length is counted as it streams and cut
    // off at the cap — never buffered whole (SEC-04, CR-4).
    const declared = Number(req.headers.get('content-length') ?? 0)
    if (declared > FORM_LIMIT_BYTES) throw new Refused(TOO_LARGE, 413)
    const desk = await read(id) // a 404 for an unknown project, before the body is read

    const form = await readForm(req, FORM_LIMIT_BYTES, {
      tooLarge: TOO_LARGE,
      unreadable: 'That upload couldn’t be read. Choose the picture again.',
    })
    const file = form.get('file')
    if (!(file instanceof File)) throw new Refused('Choose a picture to upload.', 400)
    if (file.size > UPLOAD_LIMIT_BYTES) throw new Refused(TOO_LARGE, 413)
    const bytes = Buffer.from(await file.arrayBuffer())
    const mediaType = checkUpload(bytes, desk.assets.length)
    const { chapter, asset } = await saveAsset(id, bytes, mediaType, assetName(file.name))
    console.log(`[assets] ${asset.id} on the shelf — “${asset.name}”, ${mediaType}, ${(asset.bytes / 1024).toFixed(0)} KB`)
    return Response.json(chapter)
  } catch (err) {
    return errorResponse(err, 'assets', CALM)
  }
}
