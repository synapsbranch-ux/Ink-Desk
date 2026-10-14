// Draw sheet as a job (v3, slice 18). Server only.
//
// Before slice 18 the sheet route held the browser's request open through
// Claude and then the image model — minutes, outside the queue's limits, lost
// with the connection (CR-11). It is now a job like a panel: the route checks
// what it can check at once, queues, and answers; the worker does the same two
// steps in the same order, so the frozen pair cannot disagree:
//   (a) the words  — Claude writes the DNA from the card's description, and it
//                    is saved before the picture is attempted, so a failed
//                    draw keeps the words and "Try again" reuses them;
//   (b) the picture — the sheet is generated from exactly that DNA, with no
//                    reference image (there is nothing to reference yet), in
//                    the project's locked style;
//   (c) the pair   — DNA and image land on the card together, counted once.
// `reuseDna: true` is Redraw sheet: same words, new picture. Editing the look
// retires the DNA (`lib/cast.ts`), so the next draw writes it fresh either way.
// See `devpost/prd.md > Cast — Model Sheets` for why DNA-first is load-bearing.
//
// A job that runs again after its worker died picks up where it was: once the
// words are saved the job's payload says `reuseDna`, and once the picture is
// stored its id is on the job — neither is paid for twice.
import 'server-only'
import { assertUnlocked, attachSheet, findCharacter, setDna } from './cast'
import { read } from './chapter'
import { writeDna } from './claude'
import { ProviderError, Refused, jobSentence } from './errors'
import { generateImage, imageConfig } from './image-provider'
import { landImage, readImage, saveImage, updateCharging } from './images'
import { textMeter } from './llm'
import { tripCredits } from './queue/breaker'
import { enqueueJob } from './queue/enqueue'
import { LOCAL_OWNER, PAUSED, sheetKey } from './queue/jobs'
import { adhocRun, type JobRun, type Outcome } from './queue/run'
import { sheetPrompt } from './prompts'
import { storyBrief } from './story'
import { styleRules } from './styles'

const CALM = 'The sheet didn’t come back, the studio is busy. Try again in a moment.'

/**
 * Queue a sheet. The checks that need no provider run here, so a refusal is a
 * sentence now rather than a failed job later: the story is settled, the card
 * exists and is not locked. Throws `Refused` if it is already drawing.
 */
export async function queueSheet(projectId: string, characterId: string, reuseDna: boolean): Promise<void> {
  const current = await read(projectId)
  if (!storyBrief(current)) throw new Refused('Settle the story first.')
  assertUnlocked(findCharacter(current, characterId))
  const { created } = await enqueueJob({
    key: sheetKey(projectId, characterId),
    ownerId: LOCAL_OWNER,
    projectId,
    kind: 'sheet',
    payload: { kind: 'sheet', characterId, reuseDna, redraw: reuseDna },
  })
  if (!created) throw new Refused('That sheet is already being drawn.')
}

/** One sheet, start to finish. Never throws past a store outage after the picture is paid for (the job retries). */
export async function drawSheet(projectId: string, characterId: string, reuseDna: boolean, run: JobRun = adhocRun()): Promise<Outcome> {
  const meter = textMeter()
  let stored = run.resultImageId !== null
  try {
    const current = await read(projectId)
    const synopsis = storyBrief(current)
    if (!synopsis) throw new Refused('Settle the story first.')
    const target = assertUnlocked(findCharacter(current, characterId))

    // (a) the words — unless a previous run of this job already saved them
    let dna = reuseDna ? target.dna : null
    if (!dna) {
      dna = await writeDna(target, synopsis, meter)
      const words = dna
      await updateCharging(projectId, meter, (c) => setDna(c, characterId, words))
      await run.patchPayload({ reuseDna: true })
    }
    const pair = dna

    // A previous run already paid for the picture and stored it: attach it, don't draw.
    if (run.resultImageId && (await readImage(run.resultImageId))) {
      console.log(`[sheet] ${target.name} — picking up the picture a previous run stored; not drawing again`)
      await landImage(projectId, run.resultImageId, (c, imageId) => attachSheet(c, characterId, pair, imageId), run.costUsd, undefined, (c, id) => c.cast.some((x) => x.id === characterId && x.sheetImageId === id))
      return { outcome: 'done', costUsd: run.costUsd + meter.costUsd }
    }

    // (b) the picture, from exactly those words, in the project's style
    const cfg = imageConfig()
    const image = await generateImage({
      prompt: sheetPrompt(pair, styleRules(current.stylePresetId)),
      aspect: cfg.sheetAspect,
      quality: cfg.sheetQuality,
      label: `sheet · ${target.name}`,
    })

    // (c) the pair, onto the card, counted once
    await saveImage(
      projectId,
      'sheet',
      image.b64,
      image.mediaType,
      (c, imageId) => attachSheet(c, characterId, pair, imageId),
      image.costUsd,
      undefined,
      {
        ...run,
        checkpoint: async (imageId, cost) => {
          stored = true // the picture is in the bucket the moment this is called, whether or not the job can say so
          await run.checkpoint(imageId, cost)
        },
      }
    )
    return { outcome: 'done', costUsd: (image.costUsd ?? 0) + meter.costUsd }
  } catch (err) {
    if (stored && !(err instanceof Refused)) throw err
    if (err instanceof Refused) {
      // The card was locked, the story changed, the character is gone: a sentence, not a crash.
      return { outcome: 'failed', error: err.message }
    }
    const credits = err instanceof ProviderError && err.code === 'credits'
    if (credits) await tripCredits()
    if (err instanceof ProviderError) {
      console.error(`[sheet] ${err.kind === 'refused' ? 'refused' : 'failed'}: ${err.message}`, err.cause ?? '')
      return {
        outcome: err.kind === 'refused' ? 'refused' : 'failed',
        error: credits ? PAUSED : jobSentence(err, CALM),
      }
    }
    // Not a provider problem: the store, or a bug. Retried if it was the store and the words are not lost either way.
    console.error('[sheet] failed:', err)
    return { outcome: 'failed', error: CALM }
  }
}
