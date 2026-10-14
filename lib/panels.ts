// The panel job and the queue around it. Server only.
//
// `POST /api/projects/[id]/pages/[n]/start` queues every blank panel of that
// page and responds at once; the jobs run afterwards, two at a time, in the
// long-lived dev process, and each writes to the project the moment it lands
// — so the browser's poll sees panels appear independently and out of order.
// This is the kernel inside the product: one locked sheet as the single
// `input_references` entry, that character's DNA verbatim, the slot's
// framing, Claude's variable part, and the project's frozen style rules. See
// `devpost/scope.md > The Unique Kernel` and `devpost/spec.md > Components >
// Panel Queue (lib/queue.ts)`.
//
// Since v2 every job is addressed by project / chapter / page, and the queue
// key carries the address, so two pages — or two projects — can never dedupe
// against each other.

// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { read, update } from './chapter'
import { ProviderError, Refused } from './errors'
import { generateImage, imageConfig } from './image-provider'
import { mediaTypeOf, readImage, saveImage } from './images'
import { PANEL_LAYOUT, panelPrompt } from './prompts'
import { attachPanelVersion, findPanel, markFailed, markInking } from './script'
import { singletons } from './singleton'
import { styleRules } from './styles'
import type { PageAddress } from './types'

const key = (a: PageAddress, index: number) => `${a.projectId}:${a.chapterId}:${a.pageIndex}:${index}`

/** Queue one panel of one page. False if it is already waiting or running. */
export function queuePanel(addr: PageAddress, index: number): boolean {
  return singletons.queue.enqueue(key(addr, index), () => inkPanel(addr, index))
}

export function isQueued(addr: PageAddress, index: number): boolean {
  return singletons.queue.has(key(addr, index))
}

/**
 * Queue every panel of a page without art, in page order. Safe to call again
 * — after a reload, say — because a panel already waiting or running is
 * skipped. Returns the indices this call actually queued.
 */
export async function queueBlankPanels(addr: PageAddress): Promise<number[]> {
  const desk = await read(addr.projectId, addr)
  if (!desk.script) throw new Refused('Write the page script first.')
  const queued: number[] = []
  for (const panel of desk.script) {
    if (panel.status === 'empty' && queuePanel(addr, panel.index)) queued.push(panel.index)
  }
  return queued
}

/** One generation, start to finish. Never throws: the outcome is written to the project. */
export async function inkPanel(addr: PageAddress, index: number): Promise<void> {
  const tag = `p${addr.pageIndex + 1} panel ${index + 1}`

  // Claim it inside the lock. A panel already inking, or one whose character
  // is not locked with a sheet, is refused here and nothing is drawn.
  let desk
  try {
    desk = await update(addr.projectId, (d) => markInking(d, index, singletons.serverRunId), addr)
  } catch (err) {
    console.warn(`[${tag}] not started: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  try {
    const panel = findPanel(desk, index)
    const character = desk.cast.find((c) => c.id === panel.characterId)
    if (!character?.dna || !character.sheetImageId) throw new Error('markInking let an unlocked character through')

    const sheet = await readImage(character.sheetImageId)
    if (!sheet) {
      throw new ProviderError(
        `${character.name}’s locked sheet is missing from the desk. Redraw and lock it before inking the page.`,
        'config',
        `image ${character.sheetImageId} not found`
      )
    }

    const slot = PANEL_LAYOUT[index]
    const cfg = imageConfig()
    console.log(`[${tag}] inking — ${character.name}, ${slot.shot}, ${slot.shape === 'wide' ? cfg.panelAspectWide : cfg.panelAspectSquare}`)

    const image = await generateImage({
      // The project's frozen style rules ride in place of v1's one constant.
      prompt: panelPrompt(character.dna, panel, slot, styleRules(desk.stylePresetId)),
      aspect: slot.shape === 'wide' ? cfg.panelAspectWide : cfg.panelAspectSquare,
      quality: cfg.panelQuality,
      // The kernel: exactly one reference, this character's locked sheet.
      references: [{ bytes: sheet, mediaType: mediaTypeOf(character.sheetImageId) }],
      label: `${tag} · ${character.name} · ${slot.shot}`,
    })

    await saveImage(
      addr.projectId,
      'panel',
      image.b64,
      image.mediaType,
      (d, imageId) => attachPanelVersion(d, index, imageId),
      image.costUsd,
      addr
    )
  } catch (err) {
    const status = err instanceof ProviderError && err.kind === 'refused' ? 'refused' : 'failed'
    if (err instanceof ProviderError) console.error(`[${tag}] ${status}: ${err.message}`, err.cause ?? '')
    else console.error(`[${tag}] ${status}:`, err)
    await update(addr.projectId, (d) => markFailed(d, index, status), addr).catch((e: unknown) =>
      console.error(`[${tag}] could not record the failure:`, e)
    )
  }
}
