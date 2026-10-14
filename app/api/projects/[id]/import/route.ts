// Import reference (v2, slice 10), in one handler so the frozen pair cannot
// disagree — the drawn sheet's DNA-first argument, run from the picture:
//   (a) the picture — a shelf asset becomes this card's sheet, and the old
//                     DNA is retired in the same write;
//   (b) the words   — Claude (or the text fallback) reads that picture and
//                     writes the DNA from it, saved onto the card.
// If (b) fails the picture stays and the card says so; calling this again
// with the same asset is "Reread picture". Lock applies the v1 rule
// unchanged. See `devpost/prd.md > Library — Characters, Imported or Generated`.
import { JSON_LIMIT_BYTES, parseJson } from '@/lib/body'
import { assertUnlocked, findCharacter, importSheet, setDna } from '@/lib/cast'
import { read, update } from '@/lib/chapter'
import { writeDnaFromPicture } from '@/lib/claude'
import { findAsset, fitsVision, UPLOAD_LIMIT_BYTES } from '@/lib/assets'
import { errorResponse, Refused } from '@/lib/errors'
import { assertGenerationEnabled } from '@/lib/generation'
import { updateCharging, readImage } from '@/lib/images'
import { textMeter } from '@/lib/llm'
import { ImportRequestSchema } from '@/lib/schemas'
import { storyBrief } from '@/lib/story'

export const runtime = 'nodejs'

const CALM = 'The picture couldn’t be read just now. Try again in a moment.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  try {
    assertGenerationEnabled()
    const { id, assetId } = await parseJson(req, ImportRequestSchema, JSON_LIMIT_BYTES, 'That request couldn’t be read.')
    const current = await read(projectId)
    const synopsis = storyBrief(current)
    if (!synopsis) throw new Refused('Settle the story first.')
    assertUnlocked(findCharacter(current, id))
    const asset = findAsset(current, assetId)
    const bytes = await readImage(asset.blobId)
    if (!bytes) throw new Refused(`“${asset.name}” is missing from the desk. Upload it again.`, 404)
    if (!fitsVision(bytes)) {
      throw new Refused(`“${asset.name}” is too large for Claude to read. Upload a copy under ${UPLOAD_LIMIT_BYTES / (1024 * 1024)} MB and import that.`, 413)
    }

    // (a) the picture, the old words retired with it
    const desk = await update(projectId, (c) => importSheet(c, id, assetId))
    const character = findCharacter(desk, id)

    // (b) the words, from the picture
    const meter = textMeter()
    const dna = await writeDnaFromPicture(character, synopsis, { bytes, mediaType: asset.mediaType }, meter)
    const done = await updateCharging(projectId, meter, (c) => {
      // Only if the card still shows this picture — a second import or a draw
      // that landed meanwhile wins, and these words would describe the wrong art.
      if (findCharacter(c, id).sheetImageId !== asset.blobId) return c
      return setDna(c, id, dna)
    })
    console.log(`[import] ${character.name} — sheet from “${asset.name}”, DNA written from the picture`)
    return Response.json(done)
  } catch (err) {
    return errorResponse(err, 'import', CALM)
  }
}
