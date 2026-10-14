// The panel job. Server only.
//
// `POST /api/projects/[id]/pages/[n]/start` queues every blank panel of that
// page and responds at once. Since slice 18 each panel is a JOB (`lib/queue/`):
// a record in the store, put on the queue, run by a worker — or by this
// process on the inline queue — and written to the project the moment it lands,
// so the browser's poll sees panels appear independently and out of order.
// This is the kernel inside the product: one locked sheet as the single
// `input_references` entry, that character's DNA verbatim, the slot's
// framing, Claude's variable part, and the project's frozen style rules. See
// `devpost/scope.md > The Unique Kernel` and `devpost/spec.md > Queue and
// Worker (v3)`.
//
// Every job is addressed by project / chapter / page / panel, and the job's key
// carries the address, so two pages — or two projects — can never dedupe
// against each other.

// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { read, update } from './chapter'
import { ProviderError, Refused, jobSentence } from './errors'
import { generateImage, imageConfig } from './image-provider'
import { landImage, mediaTypeOf, readImage, saveImage } from './images'
import { tripCredits } from './queue/breaker'
import { enqueueJob, isQueued as keyIsQueued } from './queue/enqueue'
import { LOCAL_OWNER, PAUSED, panelKey } from './queue/jobs'
import { adhocRun, type JobRun, type Outcome } from './queue/run'
import { PANEL_LAYOUT, panelPrompt } from './prompts'
import { attachPanelVersion, findPanel, hasVersion, markFailed, markInking } from './script'
import { styleRules } from './styles'
import type { PageAddress } from './types'

const keyOf = (a: PageAddress, index: number) => panelKey(a.projectId, a.chapterId, a.pageIndex, index)

/** Queue one panel of one page. False if it is already waiting or running. Throws `Refused` when the studio can't take it (busy, paused, too many in flight). */
export async function queuePanel(addr: PageAddress, index: number): Promise<boolean> {
  const { created } = await enqueueJob({
    key: keyOf(addr, index),
    ownerId: LOCAL_OWNER,
    projectId: addr.projectId,
    kind: 'panel',
    payload: { kind: 'panel', chapterId: addr.chapterId, pageIndex: addr.pageIndex, index },
  })
  return created
}

export function isQueued(addr: PageAddress, index: number): Promise<boolean> {
  return keyIsQueued(keyOf(addr, index))
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
    if (panel.status === 'empty' && (await queuePanel(addr, panel.index))) queued.push(panel.index)
  }
  return queued
}

/**
 * One generation, start to finish. Never throws: the outcome is written to the
 * project and returned to the job. A direct call (a check) draws under a
 * claim of its own and records nothing on any job.
 */
export async function inkPanel(addr: PageAddress, index: number, run: JobRun = adhocRun()): Promise<Outcome> {
  const tag = `p${addr.pageIndex + 1} panel ${index + 1}`

  // A re-run whose picture already landed (the worker died after the attach, before it could say so) has nothing
  // left to do — and must not claim the panel again, or a finished panel would read "inking" with no job behind it.
  if (run.resultImageId && hasVersion(await read(addr.projectId, addr), index, run.resultImageId)) {
    console.log(`[${tag}] its picture is already on the panel; nothing to do`)
    return { outcome: 'done', costUsd: run.costUsd }
  }

  // Claim it inside the store's atomic update. A panel already inking under
  // another claim, or one whose character is not locked with a sheet, is
  // refused here and nothing is drawn.
  let desk
  try {
    desk = await update(addr.projectId, (d) => markInking(d, index, run.jobId), addr)
  } catch (err) {
    // A refusal is the panel's own state (already inking, character not locked): nothing to draw.
    // Anything else is the store being unreachable — the job is tried again, not dropped.
    if (!(err instanceof Refused)) throw err
    console.warn(`[${tag}] not started: ${err.message}`)
    return { outcome: 'skipped', error: err.message }
  }

  // Once the picture is stored, a failure that is not a refusal is the store
  // hiccuping, not the picture failing: the job is tried again and attaches it.
  let stored = run.resultImageId !== null
  const tracked: JobRun = {
    ...run,
    checkpoint: async (imageId, cost) => {
      stored = true // the picture is in the bucket the moment this is called, whether or not the job can say so
      await run.checkpoint(imageId, cost)
    },
  }

  try {
    // A previous run of this job already paid for the picture and stored it:
    // attach it and finish. Nothing is drawn, nothing is billed again.
    if (run.resultImageId && (await readImage(run.resultImageId))) {
      const imageId = run.resultImageId
      console.log(`[${tag}] picking up the picture a previous run stored (${imageId}); not drawing again`)
      await landImage(addr.projectId, imageId, (d, id) => attachPanelVersion(d, index, id, new Date(), run.jobId), run.costUsd, addr, (d, id) => hasVersion(d, index, id))
      return { outcome: 'done', costUsd: run.costUsd }
    }

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
      (d, imageId) => attachPanelVersion(d, index, imageId, new Date(), run.jobId),
      image.costUsd,
      addr,
      tracked
    )
    return { outcome: 'done', costUsd: image.costUsd ?? 0 }
  } catch (err) {
    if (stored && !(err instanceof Refused)) throw err
    const credits = err instanceof ProviderError && err.code === 'credits'
    if (credits) await tripCredits()
    const status = err instanceof ProviderError && err.kind === 'refused' ? 'refused' : 'failed'
    if (err instanceof ProviderError) console.error(`[${tag}] ${status}: ${err.message}`, err.cause ?? '')
    else console.error(`[${tag}] ${status}:`, err)
    await update(addr.projectId, (d) => markFailed(d, index, status, run.jobId), addr).catch((e: unknown) =>
      console.error(`[${tag}] could not record the failure:`, e)
    )
    return { outcome: status, error: credits ? PAUSED : err instanceof ProviderError && err.kind !== 'provider' ? jobSentence(err, '') : undefined }
  }
}
