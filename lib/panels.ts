// The panel job and the queue around it. Server only.
//
// `POST /api/panels/start` queues every blank panel and responds at once; the
// jobs run afterwards, two at a time, in the long-lived dev process, and each
// writes to `chapter.json` the moment it lands — so the browser's poll sees
// panels appear independently and out of order. This is the kernel inside
// the product: one locked sheet as the single `input_references` entry, that
// character's DNA verbatim, the slot's framing, Claude's variable part, and
// the frozen style rules. See `devpost/scope.md > The Unique Kernel` and
// `devpost/spec.md > Components > Panel Queue (lib/queue.ts)`.
import { read, update } from './chapter'
import { ProviderError, Refused } from './errors'
import { generateImage, imageConfig } from './image-provider'
import { mediaTypeOf, readImage, saveImage } from './images'
import { PANEL_LAYOUT, panelPrompt } from './prompts'
import { attachPanelVersion, findPanel, markFailed, markInking } from './script'
import { singletons } from './singleton'

const key = (index: number) => `panel-${index}`

/** Queue one panel. False if it is already waiting or running. */
export function queuePanel(index: number): boolean {
  return singletons.queue.enqueue(key(index), () => inkPanel(index))
}

export function isQueued(index: number): boolean {
  return singletons.queue.has(key(index))
}

/**
 * Queue every panel without art, in page order. Safe to call again — after a
 * reload, say — because a panel already waiting or running is skipped.
 * Returns the indices this call actually queued.
 */
export async function queueBlankPanels(): Promise<number[]> {
  const chapter = await read()
  if (!chapter.script) throw new Refused('Write the page script first.')
  const queued: number[] = []
  for (const panel of chapter.script) {
    if (panel.status === 'empty' && queuePanel(panel.index)) queued.push(panel.index)
  }
  return queued
}

/** One generation, start to finish. Never throws: the outcome is written to the chapter. */
export async function inkPanel(index: number): Promise<void> {
  const tag = `panel ${index + 1}`

  // Claim it inside the lock. A panel already inking, or one whose character
  // is not locked with a sheet, is refused here and nothing is drawn.
  let chapter
  try {
    chapter = await update((c) => markInking(c, index, singletons.serverRunId))
  } catch (err) {
    console.warn(`[${tag}] not started: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  try {
    const panel = findPanel(chapter, index)
    const character = chapter.cast.find((c) => c.id === panel.characterId)
    if (!character?.dna || !character.sheetImageId) throw new Error('markInking let an unlocked character through')

    const sheet = await readImage(character.sheetImageId)
    if (!sheet) {
      throw new ProviderError(
        `${character.name}’s locked sheet is missing from the desk. Redraw and lock it before inking the page.`,
        'config',
        `data/images/${character.sheetImageId} not found`
      )
    }

    const slot = PANEL_LAYOUT[index]
    const cfg = imageConfig()
    console.log(`[${tag}] inking — ${character.name}, ${slot.shot}, ${slot.shape === 'wide' ? cfg.panelAspectWide : cfg.panelAspectSquare}`)

    const image = await generateImage({
      prompt: panelPrompt(character.dna, panel, slot),
      aspect: slot.shape === 'wide' ? cfg.panelAspectWide : cfg.panelAspectSquare,
      quality: cfg.panelQuality,
      // The kernel: exactly one reference, this character's locked sheet.
      references: [{ bytes: sheet, mediaType: mediaTypeOf(character.sheetImageId) }],
      label: `${tag} · ${character.name} · ${slot.shot}`,
    })

    await saveImage('panel', image.b64, image.mediaType, (c, imageId) => attachPanelVersion(c, index, imageId))
  } catch (err) {
    const status = err instanceof ProviderError && err.kind === 'refused' ? 'refused' : 'failed'
    if (err instanceof ProviderError) console.error(`[${tag}] ${status}: ${err.message}`, err.cause ?? '')
    else console.error(`[${tag}] ${status}:`, err)
    await update((c) => markFailed(c, index, status)).catch((e: unknown) =>
      console.error(`[${tag}] could not record the failure:`, e)
    )
  }
}
