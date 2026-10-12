// Draw sheet / Redraw sheet. ONE handler writes the visual DNA and then draws
// the sheet from that DNA, which is the ordering `devpost/prd.md > Cast —
// Model Sheets` calls load-bearing: the sheet is a picture of the DNA by
// construction, so the two artifacts frozen at lock cannot contradict each
// other. A contradiction here would be sent to the image model on every panel
// — exactly the drift the kernel exists to prevent.
//
// Both land in a single `update()` at the end. If the drawing fails, no DNA is
// stored either, so the card never shows words that no picture was made from.
import { read, update } from '@/lib/chapter'
import { ProviderError, writeDna } from '@/lib/claude'
import { generateImage, SHEET_ASPECT, SHEET_QUALITY } from '@/lib/image-provider'
import { writeImage } from '@/lib/images'
import { sheetPrompt } from '@/lib/prompts'
import { SheetRequestSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

const CALM = 'The studio couldn’t draw that sheet just now. Try again in a moment.'

export async function POST(req: Request) {
  const parsed = SheetRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'That character couldn’t be read.' }, { status: 400 })
  const { characterId, reuseDna } = parsed.data

  const chapter = await read()
  const character = chapter.cast.find((c) => c.id === characterId)
  if (!character) return Response.json({ error: 'That character isn’t on the desk.' }, { status: 404 })
  if (character.locked) {
    return Response.json({ error: 'That sheet is locked. Locking is final in this version.' }, { status: 409 })
  }
  if (character.look.trim() === '') {
    return Response.json({ error: 'Describe how they look before drawing the sheet.' }, { status: 409 })
  }

  try {
    // Redraw reuses the DNA on screen; a first draw, or one after the
    // description changed (which cleared it), writes it fresh.
    const dna = reuseDna && character.dna ? character.dna : await writeDna(character)

    const image = await generateImage({
      prompt: sheetPrompt(dna),
      aspect: SHEET_ASPECT,
      quality: SHEET_QUALITY,
      label: `sheet · ${character.name}`,
    })
    const sheetImageId = await writeImage(image.bytes, image.ext)

    const updated = await update((c) => ({
      ...c,
      // Re-read inside the lock, and refuse a lock that landed meanwhile.
      cast: c.cast.map((x) => (x.id === characterId && !x.locked ? { ...x, dna, sheetImageId } : x)),
      imageCount: c.imageCount + 1,
    }))
    return Response.json(updated)
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error(`[sheet] ${err.message}`, err.cause ?? '')
      return Response.json({ error: err.kind === 'config' ? err.message : err.message }, { status: 502 })
    }
    console.error('[sheet] unexpected failure:', err)
    return Response.json({ error: CALM }, { status: 502 })
  }
}
