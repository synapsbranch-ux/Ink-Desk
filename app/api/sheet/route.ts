// Draw sheet, in one handler so the two frozen artifacts cannot disagree:
//   (a) the words  — Claude writes the DNA from the card's description, and it
//                    is saved before the picture is attempted, so a failed
//                    draw keeps the words and "Try again" reuses them;
//   (b) the picture — the sheet is generated from exactly that DNA, with no
//                    reference image (there is nothing to reference yet);
//   (c) the pair   — DNA and image land on the card together, counted once.
// `reuseDna: true` is Redraw sheet: same words, new picture. Editing the look
// retires the DNA (`lib/cast.ts`), so the next draw writes it fresh either way.
// See `devpost/prd.md > Cast — Model Sheets` for why DNA-first is load-bearing.
import { assertUnlocked, attachSheet, findCharacter, setDna } from '@/lib/cast'
import { read, update } from '@/lib/chapter'
import { writeDna } from '@/lib/claude'
import { errorResponse, Refused } from '@/lib/errors'
import { generateImage, imageConfig } from '@/lib/image-provider'
import { saveImage } from '@/lib/images'
import { sheetPrompt } from '@/lib/prompts'
import { SheetRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The sheet didn’t come back, the studio is busy. Try again in a moment.'

export async function POST(req: Request) {
  const parsed = SheetRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'That request couldn’t be read.' }, { status: 400 })
  const { id, reuseDna = false } = parsed.data

  try {
    const current = await read()
    const synopsis = current.synopsis
    if (!synopsis) throw new Refused('Pitch a story first.')
    const target = assertUnlocked(findCharacter(current, id))

    // (a) the words
    let dna = reuseDna ? target.dna : null
    if (!dna) {
      dna = await writeDna(target, synopsis)
      await update((c) => setDna(c, id, dna as string))
    }

    // (b) the picture, from exactly those words
    const cfg = imageConfig()
    const image = await generateImage({
      prompt: sheetPrompt(dna),
      aspect: cfg.sheetAspect,
      quality: cfg.sheetQuality,
      label: `sheet · ${target.name}`,
    })

    // (c) the pair, onto the card, counted once
    const { chapter } = await saveImage('sheet', image.b64, image.mediaType, (c, imageId) =>
      attachSheet(c, id, dna as string, imageId)
    )
    return Response.json(chapter)
  } catch (err) {
    return errorResponse(err, 'sheet', CALM)
  }
}
