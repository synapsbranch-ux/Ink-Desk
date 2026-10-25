// The demo video's edit is pure data (video/src/timeline.ts, cut.ts,
// script.ts, mix.ts), so it is checked directly: marks become segments on
// both capture paths (a fresh project, a seeded chapter), the film stays
// under three minutes, every beat with words is captioned from the script
// at its word budget, the silent outro has no section, and the music ducks
// under the voice. Run with `npm run check:demo-timeline`. Spends nothing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beat, CUT, MOTION_PREVIEW } from '../video/src/cut'
import { DUCK_IN_FRAMES, DUCK_OUT_FRAMES, MUSIC_BASE, MUSIC_DUCKED, MUSIC_FADE_IN_FRAMES, MUSIC_FADE_OUT_FRAMES, musicVolumeAt } from '../video/src/mix'
import type { NarrationClip } from '../video/src/props'
import {
  captionCues,
  chunkCaption,
  MAX_CUE_CHARS,
  narrationKey,
  parseNarration,
  wordBudget,
  wordCount,
} from '../video/src/script'
import {
  budgetSeconds,
  checkMarks,
  FPS,
  markNames,
  MARKS,
  MAX_SECONDS,
  pickMark,
  resolvePlan,
  TimelineError,
  type Mark,
  type MarkName,
  type Segment,
} from '../video/src/timeline'

const sec = (frames: number) => frames / FPS
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1 / FPS + 1e-9, `${msg}: ${a} vs ${b}`)
const TOTAL = 167

// --- The real edit --------------------------------------------------------
// Under three minutes at its budget, which is the longest it can ever be:
// footage is only ever sped up to fit, never slowed down past it.
assert.ok(budgetSeconds(CUT) < MAX_SECONDS, `the edit is budgeted at ${budgetSeconds(CUT)} s`)
// The twelve beats of the learner's brief (6-ship), at their budgets: 167 s.
assert.equal(budgetSeconds(CUT), TOTAL, `the edit is budgeted at ${budgetSeconds(CUT)} s, not ${TOTAL}`)
assert.equal(CUT.length, 12, 'twelve beats')
assert.deepEqual(
  CUT.map((s) => s.id),
  ['intro', 'signin', 'project', 'library', 'director', 'pages', 'moneyshot', 'reader', 'share', 'method', 'learned', 'outro'],
  'the beats, in order',
)
assert.deepEqual(
  CUT.map((s) => s.shots.reduce((t, shot) => t + shot.seconds, 0)),
  [14, 10, 10, 20, 16, 22, 12, 12, 10, 22, 15, 4],
  'the budgets of the brief',
)
// How it was built, then what was learned, then the title card — the last words are the learner's.
const index = (id: string) => CUT.findIndex((s) => s.id === id)
assert.ok(index('method') === index('learned') - 1 && index('learned') === index('outro') - 1, 'method, learned, outro close the film')
assert.deepEqual(beat('method').shots, [{ kind: 'method', seconds: 22 }])
assert.deepEqual(beat('learned').shots, [{ kind: 'learned', seconds: 15 }])
assert.equal(beat('outro').silent, true, 'the outro is a silent title card')
assert.ok(CUT.filter((s) => s.silent).length === 1, 'only the outro is silent')
assert.throws(() => beat('nope'), /no beat/)
assert.ok(budgetSeconds(MOTION_PREVIEW) < budgetSeconds(CUT))
for (const kind of ['intro', 'section', 'moneyshot', 'method', 'learned', 'outro']) {
  assert.ok(MOTION_PREVIEW.some((s) => s.shots.some((shot) => shot.kind === kind)), `the motion preview shows the ${kind} piece`)
}
const names = new Set<string>(MARKS.map((m) => m.name))
const order = (name: MarkName) => MARKS.findIndex((m) => m.name === name)
const footageShots = CUT.flatMap((seg) => seg.shots.flatMap((shot) => (shot.kind === 'footage' ? [{ seg, shot }] : [])))
for (const { seg, shot } of footageShots) {
  for (const name of [...markNames(shot.from), ...markNames(shot.to)]) assert.ok(names.has(name), `${seg.id}: unknown mark "${name}"`)
  // Every way the shot can resolve runs forward through the journey, whichever path filmed it.
  for (const from of markNames(shot.from)) {
    for (const to of markNames(shot.to)) assert.ok(order(from) < order(to), `${seg.id}: "${shot.label}" could run backwards (${from} → ${to})`)
  }
}
// The share beat ends the journey on the public page, and the sign-in opens it.
assert.deepEqual(MARKS.slice(-3).map((m) => m.name), ['share-link', 'share-opened', 'end'])
assert.deepEqual(MARKS.slice(0, 3).map((m) => m.name), ['sign-in', 'signed-in', 'dashboard'])

// Every beat with words is captioned: narration.md has exactly one section per
// spoken beat, in order, and none for the silent one. Each section's comment
// carries the beat's word budget, so the writer sees the right number.
const raw = readFileSync(new URL('../video/narration.md', import.meta.url), 'utf8')
const script = parseNarration(raw)
const spoken = CUT.filter((s) => !s.silent)
assert.deepEqual(
  script.map((s) => s.id),
  spoken.map((s) => s.id),
  'narration.md has one section per beat with words, in order, and none for the silent outro',
)
for (const s of script) assert.ok(s.text.length > 0, `narration.md "## ${s.id}" is empty — every beat with words is captioned`)
for (const seg of spoken) {
  const seconds = seg.shots.reduce((t, shot) => t + shot.seconds, 0)
  const m = new RegExp(`^## ${seg.id}\\s*\\n<!--[^\\n]*·\\s*(\\d+) s\\s*·\\s*about (\\d+) words\\s*-->`, 'm').exec(raw)
  assert.ok(m, `narration.md "## ${seg.id}" has no "<!-- … · N s · about N words -->" comment`)
  assert.equal(Number(m[1]), seconds, `"## ${seg.id}" says ${m[1]} s; the beat is ${seconds} s`)
  assert.equal(Number(m[2]), wordBudget(seconds), `"## ${seg.id}" says about ${m[2]} words; the budget for ${seconds} s is ${wordBudget(seconds)}`)
}
assert.ok(!/^## outro/m.test(raw), 'the silent outro has no section')

// --- Marks → segments, on two synthetic captures ---------------------------
// Fresh (a private studio, a new project generated on camera): every wait is
// real — a 3-minute page inking, a 40 s plan.
const fresh: Partial<Record<MarkName, number>> = {
  'sign-in': 1,
  'signed-in': 7, // 6 s real < 10 s budget → real speed, then a hold
  dashboard: 8,
  'project-created': 20,
  'scenario-ready': 36,
  'library-open': 39,
  'import-done': 66,
  'cast-locked': 111, // 72 s real → time-lapsed into 12.5 s
  'director-open': 114,
  'plan-ready': 156,
  'pages-queued': 166,
  'page1-inked': 346, // 180 s of inking → 8 s, 22.5×
  'bubble-edited': 358,
  'redraw-done': 426,
  'chapter-inked': 906,
  'reader-open': 911,
  'pdf-exported': 920, // 9 s real < 9.5 s → real speed
  'share-link': 926,
  'share-opened': 930,
  end: 933,
}
// Seeded (the finished chapter walked with --project): nothing generated.
const seeded: Partial<Record<MarkName, number>> = {
  'sign-in': 1,
  'signed-in': 7,
  dashboard: 8,
  'project-open': 14,
  'scenario-shown': 20,
  'library-shown': 34,
  'director-shown': 41,
  'pages-shown': 49,
  'bubble-edited': 56,
  'chapter-shown': 68,
  'reader-open': 71,
  'pdf-exported': 80,
  'share-link': 86,
  'share-opened': 90,
  end: 93,
}
const marksOf = (t: Partial<Record<MarkName, number>>): Mark[] => MARKS.flatMap((m) => (t[m.name] === undefined ? [] : [{ name: m.name, t: t[m.name]! }]))
const freshMarks = marksOf(fresh)
const seededMarks = marksOf(seeded)
checkMarks(freshMarks, 940)
checkMarks(seededMarks, 95)
const plan = resolvePlan(CUT, freshMarks, true)
const seededPlan = resolvePlan(CUT, seededMarks, true)
assert.ok(plan.seconds < MAX_SECONDS, `resolved film is ${plan.seconds} s`)
// Every shot keeps its budget, whatever the capture did: the film is exactly
// as long as the edit says.
near(plan.seconds, budgetSeconds(CUT), 'the resolved film is its budget')
near(seededPlan.seconds, budgetSeconds(CUT), 'the seeded film is its budget too')
for (const [i, seg] of plan.segments.entries()) {
  const budget = CUT[i].shots.reduce((s, shot) => s + shot.seconds, 0)
  near(sec(seg.durationInFrames), budget, `beat "${seg.id}" keeps its budget`)
}
// Neither path leaves a slate: every footage shot finds its marks on both.
for (const [name, p] of [['fresh', plan], ['seeded', seededPlan]] as const) {
  for (const s of p.segments.flatMap((g) => g.shots)) {
    if (s.kind === 'footage') assert.ok(!s.missing, `${name}: "${s.label}" is a slate`)
  }
}

const footage = plan.segments.flatMap((s) => s.shots).filter((s) => s.kind === 'footage')
const byLabel = (p: typeof plan, label: string) => {
  const shot = p.segments.flatMap((s) => s.shots).find((s) => s.kind === 'footage' && s.label === label)
  assert.ok(shot, label)
  return shot
}
// Fits → real speed for its real length, then holds its last frame: the shot
// keeps its budget, so the beat, the word budget and the captions agree.
const signin = byLabel(plan, 'Sign in')
assert.equal(signin.playbackRate, 1)
near(sec(signin.playFrames!), 6, 'a short span plays at its real length')
near(sec(signin.durationInFrames), 10, 'and holds to its budget')
assert.equal(signin.trimBefore, 1 * FPS)
assert.equal(signin.trimAfter, 7 * FPS)
assert.ok(!signin.missing)
// Overruns → time-lapsed to exactly its budget, and the real time is kept.
const inking = byLabel(plan, 'Page 1 inks in')
assert.equal(inking.playbackRate, 22.5)
near(sec(inking.durationInFrames), 8, 'a long wait is time-lapsed into its budget')
assert.equal(inking.playFrames, inking.durationInFrames, 'a time-lapse fills its shot, no hold')
assert.equal(inking.realSeconds, 180)
// Played source frames ≈ shown frames × rate: nothing is invented.
for (const s of footage) {
  const source = s.trimAfter! - s.trimBefore!
  assert.ok(Math.abs(s.playFrames! * s.playbackRate! - source) <= s.playbackRate! + 1, `${s.kind === 'footage' ? s.label : ''} covers its source span`)
  assert.ok(s.playFrames! <= s.durationInFrames)
  assert.ok(s.playbackRate! >= 1, 'never slow motion')
}
// Shots tile the film: no gap, no overlap.
let cursor = 0
for (const seg of plan.segments) {
  assert.equal(seg.startFrame, cursor)
  for (const shot of seg.shots) {
    assert.equal(shot.startFrame, cursor)
    cursor += shot.durationInFrames
  }
  assert.equal(cursor - seg.startFrame, seg.durationInFrames)
}
assert.equal(cursor, plan.durationInFrames)

// The same shot, resolved by each path's own marks (the first the capture has wins).
const rest = (p: typeof plan) => byLabel(p, 'The rest of the chapter')
assert.deepEqual([rest(plan).fromMark, rest(plan).toMark], ['bubble-edited', 'chapter-inked'])
assert.deepEqual([rest(seededPlan).fromMark, rest(seededPlan).toMark], ['bubble-edited', 'chapter-shown'])
assert.deepEqual([byLabel(seededPlan, 'The plan and the estimate').fromMark, byLabel(seededPlan, 'The plan and the estimate').toMark], ['library-shown', 'director-shown'])
assert.deepEqual([byLabel(plan, 'The plan and the estimate').fromMark, byLabel(plan, 'The plan and the estimate').toMark], ['director-open', 'pages-queued'])
assert.deepEqual([byLabel(seededPlan, 'The desk, and a project').fromMark, byLabel(seededPlan, 'The desk, and a project').toMark], ['signed-in', 'project-open'])
assert.equal(pickMark(['chapter-inked', 'chapter-shown', 'redraw-done'], new Map([['redraw-done', 5]]))?.name, 'redraw-done')
assert.equal(pickMark('end', new Map()), null)

// A short test capture (page 1 only): the rest of the chapter falls back to the redraw.
const short = freshMarks.filter((m) => m.name !== 'chapter-inked')
const partial = resolvePlan(CUT, short, true)
assert.deepEqual([rest(partial).fromMark, rest(partial).toMark], ['bubble-edited', 'redraw-done'], 'on --short the shot shows the redraw')
// A local app with INKDESK_AUTH=off: no sign-in marks, so the sign-in beat is a
// slate and the project beat starts on the dashboard instead.
const local = freshMarks.filter((m) => m.name !== 'sign-in' && m.name !== 'signed-in')
const localPlan = resolvePlan(CUT, local, true)
assert.ok(byLabel(localPlan, 'Sign in').missing, 'a shot whose marks were never reached is a slate')
near(sec(byLabel(localPlan, 'Sign in').durationInFrames), 10, 'a slate holds its budget')
assert.equal(byLabel(localPlan, 'The desk, and a project').fromMark, 'dashboard')
// No capture at all: every footage shot is a slate, the film is its budget.
const empty = resolvePlan(CUT, [], false)
assert.ok(empty.segments.flatMap((s) => s.shots).every((s) => s.kind !== 'footage' || s.missing))
near(empty.seconds, budgetSeconds(CUT), 'no capture → the budgeted length')
// Marks without the footage file: still slates, never a broken video.
assert.ok(resolvePlan(CUT, freshMarks, false).segments.flatMap((s) => s.shots).every((s) => s.kind !== 'footage' || s.missing))

// --- Bad marks are refused, by sentence ---------------------------------
const refuse = (m: Mark[], duration: number | null, pattern: RegExp) =>
  assert.throws(() => checkMarks(m, duration), (e: unknown) => e instanceof TimelineError && pattern.test(e.message))
refuse([{ name: 'nope' as MarkName, t: 1 }], null, /Unknown mark/)
refuse([{ name: 'project-created', t: 5 }, { name: 'dashboard', t: 6 }], null, /out of journey order/)
refuse([{ name: 'dashboard', t: 5 }, { name: 'dashboard', t: 6 }], null, /repeated/)
refuse([{ name: 'dashboard', t: 9 }, { name: 'project-created', t: 4 }], null, /earlier than/)
refuse([{ name: 'dashboard', t: 30 }], 10, /past the end/)
refuse([{ name: 'dashboard', t: -1 }], null, /invalid time/)
const backwards: Segment[] = [{ id: 'x', label: 'x', shots: [{ kind: 'footage', from: 'dashboard', to: 'project-created', seconds: 5, label: 'x' }] }]
assert.throws(() => resolvePlan(backwards, [{ name: 'dashboard', t: 5 }, { name: 'project-created', t: 5 }], true), TimelineError)
assert.throws(() => resolvePlan([CUT[0], CUT[0]], [], false), /appears twice/)

// --- Captions --------------------------------------------------------------
const doc = `# Title
<!-- a note for the writer, never spoken -->
## intro
Draw a character once. Keep them, in every single panel of every page, from the cover to the last speech bubble on page six!
## signin
[Your words: placeholder.]
## project
`
const parsed = parseNarration(doc)
assert.deepEqual(parsed.map((s) => [s.id, s.placeholder]), [['intro', false], ['signin', true], ['project', true]])
assert.ok(!parsed[0].text.includes('note'), 'comments are never spoken')
assert.throws(() => parseNarration('## a\nx\n## a\ny'), /two sections/)
// A half-written section that keeps the template's marker is still a draft —
// never sent to the voice, never final.
assert.ok(parseNarration('## a\nInk Desk keeps faces steady. [Your words: the lock.]')[0].placeholder)
assert.ok(!parseNarration('## a\nThe sheet [front, side, back] is locked.')[0].placeholder, 'brackets of your own are fine')
// The real file is all placeholders until the learner writes it, and never sent as it is.
assert.ok(script.every((s) => s.placeholder) || script.some((s) => !s.placeholder), 'the script parses either way')

const chunks = chunkCaption(parsed[0].text)
assert.equal(chunks.join(' '), parsed[0].text, 'captions are the words, in order, nothing lost')
for (const c of chunks) assert.ok(c.length <= MAX_CUE_CHARS, `"${c}" is longer than two lines`)
assert.ok(chunks.length >= 2)

const cuesPlan = resolvePlan(CUT, [], false)
const cues = captionCues(cuesPlan, parsed, {})
const intro = cuesPlan.segments[0]
const introCues = cues.filter((c) => c.segmentId === 'intro')
assert.equal(introCues.map((c) => c.text).join(' '), parsed[0].text)
for (let i = 0; i < introCues.length; i++) {
  const c = introCues[i]
  assert.ok(c.endFrame > c.startFrame)
  assert.ok(c.startFrame >= intro.startFrame && c.endFrame <= intro.startFrame + intro.durationInFrames, 'a cue stays inside its beat')
  if (i > 0) assert.equal(c.startFrame, introCues[i - 1].endFrame, 'cues follow one another without overlap')
}
// A measured narration length stretches the cues to it.
const measured = captionCues(cuesPlan, parsed, { intro: 11 })
const lastIntro = measured.filter((c) => c.segmentId === 'intro').at(-1)!
near(sec(lastIntro.endFrame - intro.startFrame), 11 + 0.4, 'cues end with the measured narration')
// …but never past the beat, even when the voice runs long.
const long = captionCues(cuesPlan, parsed, { intro: 99 })
assert.ok(long.filter((c) => c.segmentId === 'intro').every((c) => c.endFrame <= intro.startFrame + intro.durationInFrames))
// Placeholders are captioned as written (so a draft can be timed); empty is not.
assert.ok(cues.some((c) => c.segmentId === 'signin' && c.text.startsWith('[')))
assert.ok(!cues.some((c) => c.segmentId === 'project'))

// The real script, placeholder or not, captions every beat with words — and the silent one has none.
const real = captionCues(cuesPlan, script, {})
for (const seg of spoken) assert.ok(real.some((c) => c.segmentId === seg.id), `beat "${seg.id}" has a caption`)
assert.ok(!real.some((c) => c.segmentId === 'outro'), 'the silent outro has no caption')

// --- The music under the voice ------------------------------------------------
// A pure function of the frame: silent at the first frame, the base level
// away from the voice, ducked under a clip, silent again at the last frame.
const film = TOTAL * FPS
const clipA: NarrationClip = { segmentId: 'intro', src: 'narration/intro.mp3', startFrame: 12, seconds: 10 }
const clipB: NarrationClip = { segmentId: 'project', src: 'narration/project.mp3', startFrame: 600, seconds: 6 }
const clips = [clipA, clipB]
const vol = (frame: number) => musicVolumeAt(frame, clips, film)
const close = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)
assert.equal(vol(0), 0, 'silent at the first frame')
assert.ok(vol(MUSIC_FADE_IN_FRAMES / 2) > 0 && vol(MUSIC_FADE_IN_FRAMES / 2) < MUSIC_BASE, 'fading in')
const endA = clipA.startFrame + clipA.seconds * FPS
const endB = clipB.startFrame + clipB.seconds * FPS
close(vol(endA + DUCK_OUT_FRAMES + 20), MUSIC_BASE, 'base level away from any clip')
close(vol(endB + DUCK_OUT_FRAMES), MUSIC_BASE, 'back to base once the ramp out is done')
close(vol(150), MUSIC_DUCKED, 'ducked inside a clip')
close(vol(clipB.startFrame), MUSIC_DUCKED, 'already down when the voice starts')
close(vol(clipB.startFrame + 90), MUSIC_DUCKED, 'ducked inside the second clip')
assert.ok(vol(clipB.startFrame - DUCK_IN_FRAMES / 2) > MUSIC_DUCKED && vol(clipB.startFrame - DUCK_IN_FRAMES / 2) < MUSIC_BASE, 'ramping down before a clip')
assert.ok(vol(endB + DUCK_OUT_FRAMES / 2) > MUSIC_DUCKED && vol(endB + DUCK_OUT_FRAMES / 2) < MUSIC_BASE, 'ramping up after a clip')
close(vol(film - MUSIC_FADE_OUT_FRAMES), MUSIC_BASE, 'the fade-out starts from the base level')
assert.ok(vol(film - 45) > 0 && vol(film - 45) < MUSIC_BASE, 'fading out')
assert.equal(vol(film - 1), 0, 'silent at the last frame')
for (let frame = 0; frame < film; frame += 7) {
  const v = vol(frame)
  assert.ok(v >= 0 && v <= MUSIC_BASE, `volume in range at frame ${frame}`)
}
close(musicVolumeAt(400, [], film), MUSIC_BASE, 'no clips: the base level')
close(musicVolumeAt(400, clips, film, 0.5), 0.5, 'the base level comes from the props')

// --- The narration cache key ---------------------------------------------------
const k = narrationKey('Hello.', 'george', 'elevenlabs/eleven-v4')
assert.match(k, /^[0-9a-f]{14}$/)
assert.equal(k, narrationKey('Hello.', 'george', 'elevenlabs/eleven-v4'), 'stable')
assert.notEqual(k, narrationKey('Hello!', 'george', 'elevenlabs/eleven-v4'), 'a changed word is new audio')
assert.notEqual(k, narrationKey('Hello.', 'sarah', 'elevenlabs/eleven-v4'), 'a changed voice is new audio')
assert.notEqual(k, narrationKey('Hello.', 'george', 'elevenlabs/eleven-flash-v2.5'), 'a changed model is new audio')
assert.equal(wordCount('  one two\nthree '), 3)

console.log(`  Demo timeline check passed — the edit is ${budgetSeconds(CUT)} s, ${CUT.length} beats (${spoken.length} with words, 1 silent), both capture paths resolve without a slate.`)
