// The Director's server half (v2, slice 11): the plan call, Generate page,
// Generate all, and the cover job. Server only. The rules are the pure
// functions in `lib/plan.ts`; this file reads what they need, makes the
// provider calls, and writes the outcome through the desk facade. See
// `devpost/spec.md > The Director (v2)`.
//
// Every page job still goes through `lib/panels.ts` — the v1 engine,
// addressed per page — so a page's failure can never touch another page, and
// the job's key (project : chapter : page : panel) keeps two pages from ever
// deduping against each other. The cover is one more job, keyed
// project : chapter : cover.

// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { read, update, updatePages } from './chapter'
import { summarizeScenario, writeChapterPlan } from './claude'
import { ProviderError, Refused } from './errors'
import { generateImage, imageConfig } from './image-provider'
import { fitsVision } from './assets'
import { chargeText, landImage, mediaTypeOf, readImage, saveImage } from './images'
import { textMeter, type AskImage } from './llm'
import { queueBlankPanels } from './panels'
import { assertPageDrawable, assertPlanWritable, attachCoverVersion, coverHasVersion, markCoverFailed, markCoverInking, newPlan, pageFromPlan } from './plan'
import { coverPrompt, type LockedCharacter, type PlanSource } from './prompts'
import { lockedPair } from './script'
import { tripCredits } from './queue/breaker'
import { enqueueJob, isQueued as keyIsQueued } from './queue/enqueue'
import { LOCAL_OWNER, PAUSED, coverKey } from './queue/jobs'
import { adhocRun, type JobRun, type Outcome } from './queue/run'
import { MAX_PLAN_REFERENCES, needsSummary, storyBrief } from './story'
import { stylePreset, styleRules } from './styles'
import type { Character, Desk, PageAddress } from './types'

function locked(c: Character): LockedCharacter {
  return { id: c.id, name: c.name, role: c.role, traits: c.traits, dna: c.dna ?? '' }
}

// --- The plan -------------------------------------------------------------------

/**
 * The Director writes the chapter plan: the story (the scenario — condensed
 * first past ~12 000 characters — or the accepted synopsis), the locked cast,
 * the style, and up to four ticked references as pictures. Everything that
 * could refuse is checked before the first call, so a refused request costs
 * nothing; `newPlan` runs the same rules again inside the lock. What the text
 * calls cost is added to the project's spend even when the plan itself fails.
 */
export async function writePlan(projectId: string, pageCount: number, replace: boolean): Promise<Desk> {
  const desk = await read(projectId)
  const [lead, counterpart] = assertPlanWritable(desk, replace)
  if (!storyBrief(desk)) throw new Refused(desk.storyMode === 'scenario' ? 'Save the scenario first.' : 'Accept a synopsis first.')

  const meter = textMeter()
  try {
    const source = await planSource(desk, meter)
    const references = await planReferences(desk)
    const style = stylePreset(desk.stylePresetId)
    const out = await writeChapterPlan(
      source,
      [locked(lead), locked(counterpart)],
      { label: style.label, blurb: style.blurb },
      pageCount,
      references,
      meter
    )
    const next = await update(projectId, (d) =>
      chargeText(newPlan(d, out, pageCount, { source: source.kind, summarized: source.summarized, replace }), meter)
    )
    console.log(
      `[plan] ${pageCount} pages + cover from the ${source.kind}${source.summarized ? ' (summarized first)' : ''}${references.length ? `, ${references.length} reference${references.length > 1 ? 's' : ''}` : ''}`
    )
    return next
  } catch (err) {
    if (meter.costUsd > 0) await update(projectId, (d) => chargeText(d, meter)).catch(() => {})
    throw err
  }
}

async function planSource(desk: Desk, meter: { costUsd: number }): Promise<PlanSource> {
  const title = desk.title.trim() || desk.synopsis?.title.trim() || 'Untitled chapter'
  const names = (desk.scenario?.referenceAssetIds ?? [])
    .map((id) => desk.assets.find((a) => a.id === id)?.name)
    .filter((n): n is string => Boolean(n))
    .slice(0, MAX_PLAN_REFERENCES)
  if (desk.storyMode === 'scenario' && desk.scenario?.saved) {
    const { text, notes } = desk.scenario
    if (needsSummary(text)) {
      const summary = await summarizeScenario(text, notes, meter)
      return { kind: 'scenario', title, text: summary, notes, summarized: true, referenceNames: names }
    }
    return { kind: 'scenario', title, text, notes, summarized: false, referenceNames: names }
  }
  const synopsis = desk.synopsis
  if (!synopsis?.accepted) throw new Refused('Accept a synopsis first.')
  return { kind: 'synopsis', title: synopsis.title.trim() || title, text: synopsis.body, notes: '', summarized: false, referenceNames: [] }
}

/** The ticked references' bytes, in tick order, at most four; one missing from the desk is skipped and named in the terminal. */
async function planReferences(desk: Desk): Promise<AskImage[]> {
  if (desk.storyMode !== 'scenario') return []
  const out: AskImage[] = []
  for (const id of (desk.scenario?.referenceAssetIds ?? []).slice(0, MAX_PLAN_REFERENCES)) {
    const asset = desk.assets.find((a) => a.id === id)
    const bytes = asset ? await readImage(asset.blobId) : null
    if (!asset || !bytes) {
      console.warn(`[plan] reference ${id} is not on the shelf any more; planning without it`)
      continue
    }
    if (!fitsVision(bytes)) {
      // Uploaded before the limit was lowered: sending it would be a 400 with no fallback.
      console.warn(`[plan] reference “${asset.name}” is too large for the text model to read; planning without it`)
      continue
    }
    out.push({ bytes, mediaType: asset.mediaType })
  }
  return out
}

// --- Pages ------------------------------------------------------------------------

/**
 * Generate page: the plan's lines for page n become its panels (once), and
 * every blank panel is queued — the v1 `start`, per page. A page scripted
 * before the Director (a migrated desk) has no plan and is queued as it is.
 */
export async function startPage(addr: PageAddress): Promise<number[]> {
  const desk = await read(addr.projectId, addr)
  if (!desk.script) {
    if (!desk.plan) throw new Refused('Write the chapter plan in the Director first.')
    await update(addr.projectId, (d) => pageFromPlan(d), addr)
  }
  return queueBlankPanels(addr)
}

/**
 * Generate all: every page not yet written is written from the plan in ONE
 * write — all or nothing, so a blank line on page 4 refuses before page 2 is
 * touched — then every blank panel is queued in page order. Idempotent: a
 * written page is never rewritten and a queued panel is never queued twice.
 */
export async function startAll(projectId: string): Promise<{ written: number[]; queued: string[] }> {
  const desk = await read(projectId)
  const plan = desk.plan
  if (!plan) throw new Refused('Write the chapter plan in the Director first.')
  const unwritten = desk.pages.filter((p) => !p.written).map((p) => p.index)
  for (const n of unwritten) {
    const problem = plan.pages[n] ? assertPageDrawable(plan.pages[n], n) : `There is no page ${n + 1} in the plan.`
    if (problem) throw new Refused(problem)
  }
  if (unwritten.length > 0) await updatePages(projectId, unwritten, (d) => pageFromPlan(d))

  const queued: string[] = []
  for (const pg of desk.pages) {
    const addr: PageAddress = { projectId, chapterId: desk.address.chapterId, pageIndex: pg.index }
    for (const i of await queueBlankPanels(addr)) queued.push(`p${pg.index + 1}·${i + 1}`)
  }
  return { written: unwritten, queued }
}

// --- The cover ----------------------------------------------------------------------

const keyOfCover = (projectId: string, chapterId: string) => coverKey(projectId, chapterId)

export function isCoverQueued(projectId: string, chapterId: string): Promise<boolean> {
  return keyIsQueued(keyOfCover(projectId, chapterId))
}

/** Queue the cover — Generate, Redraw and Try again are the same request. False if it is already waiting or running. */
export async function queueCover(projectId: string, chapterId: string): Promise<boolean> {
  const { created } = await enqueueJob({
    key: keyOfCover(projectId, chapterId),
    ownerId: LOCAL_OWNER,
    projectId,
    kind: 'cover',
    payload: { kind: 'cover', chapterId },
  })
  return created
}

/**
 * One cover generation, start to finish. Never throws (past a store outage
 * after the picture is paid for, which the job retries): the outcome is
 * written to the chapter and returned. Drawn like a panel — the lead's locked
 * sheet as the single reference, the DNA verbatim, the project's rules — from
 * the Director's brief. The title is the app's lettering and never enters the
 * prompt. Two sheets as references would need the two-character kernel test,
 * which v2 does not run, so the lead alone is the honest default.
 */
export async function inkCover(projectId: string, run: JobRun = adhocRun()): Promise<Outcome> {
  let desk: Desk
  try {
    desk = await update(projectId, (d) => markCoverInking(d, run.jobId))
  } catch (err) {
    if (!(err instanceof Refused)) throw err
    console.warn(`[cover] not started: ${err.message}`)
    return { outcome: 'skipped', error: err.message }
  }

  let stored = run.resultImageId !== null
  const tracked: JobRun = {
    ...run,
    checkpoint: async (imageId, cost) => {
      await run.checkpoint(imageId, cost)
      stored = true
    },
  }

  try {
    if (run.resultImageId && (await readImage(run.resultImageId))) {
      console.log(`[cover] picking up the picture a previous run stored (${run.resultImageId}); not drawing again`)
      await landImage(projectId, run.resultImageId, (d, id) => attachCoverVersion(d, id, new Date(), run.jobId), run.costUsd, undefined, coverHasVersion)
      return { outcome: 'done', costUsd: run.costUsd }
    }

    const [lead] = lockedPair(desk)
    const brief = desk.cover?.brief ?? ''
    const sheet = lead.sheetImageId ? await readImage(lead.sheetImageId) : null
    if (!sheet || !lead.sheetImageId || !lead.dna) {
      throw new ProviderError(
        `${lead.name}’s locked sheet is missing from the desk, so the cover can’t be drawn against it.`,
        'config',
        `image ${lead.sheetImageId} not found`
      )
    }
    const cfg = imageConfig()
    console.log(`[cover] inking — ${lead.name}, ${cfg.coverAspect}`)
    const image = await generateImage({
      prompt: coverPrompt(lead.dna, brief, styleRules(desk.stylePresetId)),
      aspect: cfg.coverAspect,
      quality: cfg.panelQuality,
      references: [{ bytes: sheet, mediaType: mediaTypeOf(lead.sheetImageId) }],
      label: `cover · ${lead.name}`,
    })
    await saveImage(projectId, 'cover', image.b64, image.mediaType, (d, imageId) => attachCoverVersion(d, imageId, new Date(), run.jobId), image.costUsd, undefined, tracked)
    return { outcome: 'done', costUsd: image.costUsd ?? 0 }
  } catch (err) {
    if (stored && !(err instanceof Refused)) throw err
    const credits = err instanceof ProviderError && err.code === 'credits'
    if (credits) await tripCredits()
    const status = err instanceof ProviderError && err.kind === 'refused' ? 'refused' : 'failed'
    if (err instanceof ProviderError) console.error(`[cover] ${status}: ${err.message}`, err.cause ?? '')
    else console.error(`[cover] ${status}:`, err)
    await update(projectId, (d) => markCoverFailed(d, status, run.jobId)).catch((e: unknown) => console.error('[cover] could not record the failure:', e))
    return { outcome: status, error: credits ? PAUSED : err instanceof ProviderError && err.kind !== 'provider' ? err.message : undefined }
  }
}
