// Runs before every render (and the studio): reads what exists — the capture's
// timeline.json, narration.md, the narration manifest, music — resolves the
// edit to frames, and writes out/props.json for the compositions. Anything not
// final yet (a placeholder line, a slate where footage will go, a test capture
// at `low`, stand-in stills) is listed and stamped DRAFT on the render rather
// than failing it, so a draft is always watchable at the final timing. What
// would make the video wrong rather than unfinished — an unknown or
// out-of-order mark, a segment with no section in narration.md, music without
// its licence, an edit over three minutes — stops the render with a sentence.
// Music is composed by video/music/compose.mts or generated; until it is,
// that is a draft line too, as are the method beat's document stills until
// `npm run video:docs` has made them.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CUT, MOTION_PREVIEW } from './src/cut.ts'
import { MUSIC_BASE } from './src/mix.ts'
import type { DemoProps, DocsStills, NarrationClip } from './src/props.ts'
import {
  captionCues,
  narrationKey,
  parseNarration,
  type NarrationManifest,
  type NarrationSegment,
} from './src/script.ts'
import {
  checkMarks,
  FPS,
  MAX_SECONDS,
  NARRATION_LEAD_SECONDS,
  resolvePlan,
  type CaptureTimeline,
  type MoneyShotStills,
  type ResolvedPlan,
} from './src/timeline.ts'

const VIDEO = dirname(fileURLToPath(import.meta.url))
const ROOT = join(VIDEO, '..')
const PUBLIC = join(VIDEO, 'public')
const pub = (p: string) => join(PUBLIC, p)

function fail(sentence: string): never {
  console.error(`\nThe video cannot be prepared: ${sentence}\n`)
  process.exit(1)
}

const readJson = <T,>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null)

export type Prepared = { props: DemoProps & { motion: { plan: ResolvedPlan; captions: DemoProps['captions'] } } }

/** The committed v1 desk ("Return to Sender") stands in until a capture brings its own stills. */
function placeholderStills(): MoneyShotStills {
  type V1 = {
    synopsis?: { title?: string }
    cast: { id: string; name: string; sheetImageId: string | null }[]
    script: { index: number; characterId: string; versions: { imageId: string }[]; currentVersion: number }[]
  }
  const v1 = readJson<V1>(join(ROOT, 'data', 'chapter.json'))
  const lead = v1?.cast.find((c) => c.sheetImageId)
  if (!v1 || !lead?.sheetImageId) fail('there is no capture yet and no v1 desk in data/ to stand in for the money shot.')
  mkdirSync(pub('placeholder'), { recursive: true })
  const copy = (id: string) => {
    const from = join(ROOT, 'data', 'images', id)
    if (!existsSync(from)) fail(`the stand-in image data/images/${id} is missing.`)
    copyFileSync(from, pub(`placeholder/${id}`))
    return `placeholder/${id}`
  }
  const panels = v1.script
    .filter((p) => p.characterId === lead.id && p.versions[p.currentVersion])
    .map((p) => ({ src: copy(p.versions[p.currentVersion].imageId), page: 1, panel: p.index + 1 }))
  return {
    title: v1.synopsis?.title ?? 'Ink Desk',
    character: { name: lead.name, reference: copy(lead.sheetImageId), source: 'sheet' },
    panels,
    cover: null,
  }
}

function stillsExist(s: MoneyShotStills): boolean {
  const all = [s.character.reference, ...s.panels.map((p) => p.src), ...(s.cover ? [s.cover] : [])]
  return all.every((p) => existsSync(pub(p)))
}

/** The method beat's documents (capture/docs.mts), when every picture the index names is here. */
function docsStills(draft: string[]): DocsStills | null {
  const docs = readJson<DocsStills>(pub('capture/docs/docs.json'))
  if (!docs) {
    draft.push('The method beat has no stills of the planning documents yet — run `npm run video:docs` (free, offline).')
    return null
  }
  const paths = [
    docs.scope?.top, docs.scope?.full, docs.prd?.top, docs.prd?.full, docs.spec?.top, docs.spec?.full,
    docs.checklist?.slices, docs.checklist?.v3, docs.checklist?.review, docs.log, docs.skills,
  ]
  const missing = paths.filter((p) => typeof p !== 'string' || !existsSync(pub(p)))
  if (missing.length) {
    draft.push(`capture/docs/docs.json names ${missing.length} picture${missing.length === 1 ? '' : 's'} that ${missing.length === 1 ? 'is' : 'are'} not here — run \`npm run video:docs\` again.`)
    return null
  }
  return docs
}

function narrationClips(
  plan: ResolvedPlan,
  sections: readonly NarrationSegment[],
  draft: string[],
): { clips: NarrationClip[]; spoken: Record<string, number> } {
  const manifest = readJson<NarrationManifest>(pub('narration/manifest.json'))
  const clips: NarrationClip[] = []
  const spoken: Record<string, number> = {}
  let missing = 0
  for (const seg of plan.segments) {
    const words = sections.find((s) => s.id === seg.id)
    if (!words || words.placeholder) continue
    const clip = manifest?.segments[seg.id]
    const fresh = clip && clip.key === narrationKey(words.text, manifest.voice, manifest.model) && existsSync(pub(clip.src))
    if (!clip || !fresh) {
      missing++
      continue
    }
    const room = seg.durationInFrames / FPS - NARRATION_LEAD_SECONDS
    if (clip.seconds > room) {
      draft.push(`The narration for "${seg.id}" runs ${clip.seconds.toFixed(1)} s; its beat has room for ${room.toFixed(1)} s. Trim the words or lengthen the beat in src/cut.ts.`)
    }
    spoken[seg.id] = clip.seconds
    clips.push({
      segmentId: seg.id,
      src: clip.src,
      startFrame: seg.startFrame + Math.round(NARRATION_LEAD_SECONDS * FPS),
      seconds: clip.seconds,
    })
  }
  if (missing) draft.push(`${missing} written section${missing === 1 ? ' has' : 's have'} no current narration — run \`npm run video:narrate\`.`)
  return { clips, spoken }
}

export function prepare(): Prepared {
  const draft: string[] = []

  // The capture.
  const timeline = readJson<CaptureTimeline>(join(VIDEO, 'timeline.json'))
  if (!timeline || timeline.version !== 1) fail('video/timeline.json is missing or not version 1.')
  try {
    checkMarks(timeline.marks, timeline.duration)
  } catch (err) {
    fail(`timeline.json — ${(err as Error).message}`)
  }
  const footage = timeline.footage && existsSync(pub(timeline.footage)) ? timeline.footage : null
  if (!timeline.footage) draft.push('No capture yet — every footage shot is a slate. Run `npm run video:capture`.')
  else if (!footage) draft.push(`timeline.json names ${timeline.footage}, which is not on this machine (captures are not committed) — footage shots are slates.`)
  // A fresh capture generates on camera, so its quality is the film's; a seeded one draws nothing (the chapter's art is whatever it was drawn at).
  if (footage && timeline.path !== 'seeded' && timeline.quality !== 'high') {
    draft.push(`The capture ran at \`${timeline.quality ?? 'unknown'}\` quality; the film is captured at \`high\`.`)
  }

  let plan: ResolvedPlan
  try {
    plan = resolvePlan(CUT, footage ? timeline.marks : [], footage !== null)
  } catch (err) {
    fail(`timeline.json — ${(err as Error).message}`)
  }
  if (plan.seconds >= MAX_SECONDS) fail(`the edit runs ${plan.seconds.toFixed(1)} s; the rule is under ${MAX_SECONDS} s.`)
  const slates = plan.segments.flatMap((s) => s.shots).filter((s) => s.missing)
  if (footage && slates.length) {
    draft.push(`${slates.length} footage shot${slates.length === 1 ? '' : 's'} not in this capture yet: ${slates.map((s) => (s.kind === 'footage' ? s.label : '')).join(', ')}.`)
  }

  // The words.
  const narrationPath = join(VIDEO, 'narration.md')
  if (!existsSync(narrationPath)) fail('video/narration.md is missing.')
  const sections = parseNarration(readFileSync(narrationPath, 'utf8'))
  // Every beat with words has its section; a silent beat (the outro's title card) has none.
  const spokenBeats = new Set(CUT.filter((s) => !s.silent).map((s) => s.id))
  const silentBeats = new Set(CUT.filter((s) => s.silent).map((s) => s.id))
  for (const seg of CUT) {
    if (!seg.silent && !sections.some((s) => s.id === seg.id)) fail(`narration.md has no "## ${seg.id}" section — every beat with words is captioned.`)
  }
  for (const s of sections) {
    if (silentBeats.has(s.id)) fail(`narration.md has a "## ${s.id}" section, but that beat is a silent title card (src/cut.ts) — remove the section.`)
    if (!spokenBeats.has(s.id)) fail(`narration.md has a "## ${s.id}" section that is not a beat of the edit (src/cut.ts).`)
  }
  const placeholders = sections.filter((s) => s.placeholder).map((s) => s.id)
  if (placeholders.length) draft.push(`narration.md still has placeholders in: ${placeholders.join(', ')}.`)

  const { clips, spoken } = narrationClips(plan, sections, draft)
  const captions = captionCues(plan, sections, spoken)

  // The money shot.
  let stills = timeline.stills
  let stillsArePlaceholder = false
  // A capture that stopped before page 1 inked has a reference but no panels —
  // nothing to show beside it yet.
  if (!stills || stills.panels.length === 0 || !stillsExist(stills)) {
    stills = placeholderStills()
    stillsArePlaceholder = true
    draft.push('The money shot uses the v1 desk ("Return to Sender") until a capture brings its own stills.')
  }

  // The method beat's documents.
  const docs = docsStills(draft)

  // Music: the repository's own composition (video/music/compose.mts), with
  // its licence file, or none. Never a track without one. The volume here is
  // the base level; Demo.tsx shapes it under the voice (src/mix.ts).
  let music: DemoProps['music'] = null
  if (existsSync(pub('music/track.mp3'))) {
    if (!existsSync(pub('music/LICENSE.txt'))) fail('public/music/track.mp3 has no LICENSE.txt beside it — only royalty-free music with its licence goes in the video.')
    music = { src: 'music/track.mp3', volume: MUSIC_BASE }
  } else {
    draft.push('No music yet — run `npm run video:music:generate` (a music model) or `npm run video:music` (composed by video/music/compose.mts).')
  }

  const motionPlan = resolvePlan(MOTION_PREVIEW, [], false)
  const props = {
    plan,
    captions,
    narration: clips,
    music,
    footage,
    stills,
    stillsArePlaceholder,
    docs,
    draft,
    motion: { plan: motionPlan, captions: captionCues(motionPlan, sections, spoken) },
  }
  return { props }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { props } = prepare()
  mkdirSync(join(VIDEO, 'out'), { recursive: true })
  writeFileSync(join(VIDEO, 'out', 'props.json'), JSON.stringify(props, null, 2))
  console.log(`Edit: ${props.plan.seconds.toFixed(1)} s · ${props.plan.segments.length} beats · ${props.captions.length} captions · ${props.narration.length} narration clips · music ${props.music ? 'on' : 'none'} · documents ${props.docs ? 'on' : 'none'}`)
  if (props.draft.length) {
    console.log(`DRAFT — not final yet:\n${props.draft.map((d) => `  · ${d}`).join('\n')}`)
  } else {
    console.log('Final: every beat has its footage, words and voice.')
  }
}
