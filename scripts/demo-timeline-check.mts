// The demo video's edit is pure data (video/src/timeline.ts, cut.ts,
// script.ts, mix.ts), so it is checked directly: marks become segments, the
// film stays under three minutes, every beat of the edit is captioned from
// the script, and the music ducks under the voice. Run with
// `npm run check:demo-timeline`. Spends nothing.
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
  MARKS,
  MAX_SECONDS,
  resolvePlan,
  TimelineError,
  type Mark,
  type MarkName,
  type Segment,
} from '../video/src/timeline'

const sec = (frames: number) => frames / FPS
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1 / FPS + 1e-9, `${msg}: ${a} vs ${b}`)

// --- The real edit --------------------------------------------------------
// Under three minutes at its budget, which is the longest it can ever be:
// footage is only ever sped up to fit, never slowed down past it.
assert.ok(budgetSeconds(CUT) < MAX_SECONDS, `the edit is budgeted at ${budgetSeconds(CUT)} s`)
// The v3 film: eleven spoken beats and the mute final card, at their budgets: 173 s.
assert.equal(budgetSeconds(CUT), 173, `the edit is budgeted at ${budgetSeconds(CUT)} s, not 173`)
assert.equal(CUT.length, 12, 'eleven spoken beats and the final card')
assert.deepEqual(
  CUT.map((s) => s.id),
  ['intro', 'signin', 'project', 'library', 'director', 'pages', 'moneyshot', 'reader', 'share', 'method', 'learned', 'outro'],
  'the beats, in order',
)
// How it was made, then what was learned — the last words of the film — then the mute card.
const index = (id: string) => CUT.findIndex((s) => s.id === id)
assert.ok(index('method') === index('learned') - 1 && index('learned') === index('outro') - 1, 'method, learned, outro close the film')
assert.deepEqual(beat('method').shots, [{ kind: 'method', seconds: 22 }])
assert.deepEqual(beat('learned').shots, [{ kind: 'learned', seconds: 15 }])
assert.ok(beat('outro').mute === true && CUT.filter((s) => s.mute).length === 1, 'only the final card is mute')
// The word budgets narration.md quotes, from the beats' seconds.
const seconds = (id: string) => beat(id).shots.reduce((t, shot) => t + shot.seconds, 0)
assert.deepEqual(
  CUT.filter((s) => !s.mute).map((s) => wordBudget(seconds(s.id))),
  [28, 19, 19, 41, 33, 46, 24, 24, 19, 46, 30],
  'the word budget of each spoken beat',
)
assert.throws(() => beat('nope'), /no beat/)
assert.ok(budgetSeconds(MOTION_PREVIEW) < budgetSeconds(CUT))
assert.ok(MOTION_PREVIEW.some((s) => s.shots.some((shot) => shot.kind === 'method')), 'the motion preview shows the method piece')
const names = new Set<string>(MARKS.map((m) => m.name))
for (const seg of CUT) {
  for (const shot of seg.shots) {
    if (shot.kind !== 'footage') continue
    assert.ok(names.has(shot.from) && names.has(shot.to), `${seg.id}: unknown mark`)
    const order = MARKS.findIndex((m) => m.name === shot.from) < MARKS.findIndex((m) => m.name === shot.to)
    assert.ok(order, `${seg.id}: "${shot.label}" runs backwards through the journey`)
  }
}

// Every beat is captioned: narration.md has exactly one section per beat.
const script = parseNarration(readFileSync(new URL('../video/narration.md', import.meta.url), 'utf8'))
assert.deepEqual(
  script.map((s) => s.id),
  CUT.filter((s) => !s.mute).map((s) => s.id),
  'narration.md has one section per spoken beat of the edit, in order, and none for the mute card',
)
for (const s of script) assert.ok(s.text.length > 0, `narration.md "## ${s.id}" is empty — every spoken beat is captioned`)
// …and no section runs past what its beat can carry at a calm pace.
for (const s of script) {
  assert.ok(wordCount(s.text) <= wordBudget(seconds(s.id)), `narration.md "## ${s.id}" has ${wordCount(s.text)} words; its beat fits ${wordBudget(seconds(s.id))}`)
}

// --- Marks → segments, on a synthetic capture ------------------------------
// A capture where every wait is real: a 3-minute page inking, a 40 s plan.
const t: Record<MarkName, number> = {
  'sign-in': 1, // 1 s real < 10 s budget → real speed
  dashboard: 2,
  'project-created': 14, // 12 s real > 10 s budget → time-lapsed, 1.2×
  'scenario-ready': 30,
  'library-open': 33,
  'import-done': 60,
  'cast-locked': 105, // 72 s real → time-lapsed into 19.5 s
  'director-open': 108,
  'plan-ready': 150,
  'pages-queued': 160,
  'page1-inked': 340, // 180 s of inking → 12 s, 15×
  'bubble-edited': 352,
  'redraw-done': 420,
  'chapter-inked': 900,
  'reader-open': 905,
  'pdf-exported': 914, // 9 s real < 9.5 s → real speed
  'share-open': 918,
  'link-copied': 922,
  'share-public': 926,
  end: 930,
}
const marks: Mark[] = MARKS.map((m) => ({ name: m.name, t: t[m.name] }))
checkMarks(marks, 935)
const plan = resolvePlan(CUT, marks, true)
assert.ok(plan.seconds < MAX_SECONDS, `resolved film is ${plan.seconds} s`)
// Every shot keeps its budget, whatever the capture did: the film is exactly
// as long as the edit says.
near(plan.seconds, budgetSeconds(CUT), 'the resolved film is its budget')
for (const [i, seg] of plan.segments.entries()) {
  const budget = CUT[i].shots.reduce((s, shot) => s + shot.seconds, 0)
  near(sec(seg.durationInFrames), budget, `beat "${seg.id}" keeps its budget`)
}

const footage = plan.segments.flatMap((s) => s.shots).filter((s) => s.kind === 'footage')
const byLabel = (label: string) => {
  const shot = footage.find((s) => s.kind === 'footage' && s.label === label)
  assert.ok(shot, label)
  return shot
}
// Fits → real speed for its real length, then holds its last frame: the shot
// keeps its budget, so the beat, the word budget and the captions agree.
const signIn = byLabel('Sign in')
assert.equal(signIn.playbackRate, 1)
near(sec(signIn.playFrames!), 1, 'a short span plays at its real length')
near(sec(signIn.durationInFrames), 10, 'and holds to its budget')
assert.equal(signIn.trimBefore, 1 * FPS)
assert.equal(signIn.trimAfter, 2 * FPS)
assert.ok(!signIn.missing)
// Overruns → time-lapsed to exactly its budget, and the real time is kept.
const newProject = byLabel('New project and its style')
near(newProject.playbackRate!, 1.2, 'a slight overrun is sped up just enough')
near(sec(newProject.durationInFrames), 10, 'into its budget')
const inking = byLabel('Page 1 inks in')
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

// A short test capture (page 1 only): later shots become slates of their budget.
const short = marks.filter((m) => m.name !== 'chapter-inked')
const partial = resolvePlan(CUT, short, true)
const rest = partial.segments.flatMap((s) => s.shots).find((s) => s.kind === 'footage' && s.label === 'The rest of the chapter')
assert.ok(rest?.missing, 'a shot whose mark was never reached is a slate')
near(sec(rest.durationInFrames), 4, 'a slate holds its budget')
// No capture at all: every footage shot is a slate, the film is its budget.
const empty = resolvePlan(CUT, [], false)
assert.ok(empty.segments.flatMap((s) => s.shots).every((s) => s.kind !== 'footage' || s.missing))
near(empty.seconds, budgetSeconds(CUT), 'no capture → the budgeted length')
// Marks without the footage file: still slates, never a broken video.
assert.ok(resolvePlan(CUT, marks, false).segments.flatMap((s) => s.shots).every((s) => s.kind !== 'footage' || s.missing))

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
## library
`
const parsed = parseNarration(doc)
assert.deepEqual(parsed.map((s) => [s.id, s.placeholder]), [['intro', false], ['signin', true], ['library', true]])
assert.ok(!parsed[0].text.includes('note'), 'comments are never spoken')
assert.throws(() => parseNarration('## a\nx\n## a\ny'), /two sections/)
// A half-written section that keeps the template's marker is still a draft —
// never sent to the voice, never final.
assert.ok(parseNarration('## a\nInk Desk keeps faces steady. [Your words: the lock.]')[0].placeholder)
assert.ok(!parseNarration('## a\nThe sheet [front, side, back] is locked.')[0].placeholder, 'brackets of your own are fine')

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
const measured = captionCues(cuesPlan, parsed, { intro: 10 })
const lastIntro = measured.filter((c) => c.segmentId === 'intro').at(-1)!
near(sec(lastIntro.endFrame - intro.startFrame), 10 + 0.4, 'cues end with the measured narration')
// …but never past the beat, even when the voice runs long.
const long = captionCues(cuesPlan, parsed, { intro: 99 })
assert.ok(long.filter((c) => c.segmentId === 'intro').every((c) => c.endFrame <= intro.startFrame + intro.durationInFrames))
// Placeholders are captioned as written (so a draft can be timed); empty is not.
assert.ok(cues.some((c) => c.segmentId === 'signin' && c.text.startsWith('[')))
assert.ok(!cues.some((c) => c.segmentId === 'library'))

// The real script, placeholder or not, captions every spoken beat — and never the mute card.
const real = captionCues(cuesPlan, script, {})
for (const seg of CUT) {
  if (seg.mute) assert.ok(!real.some((c) => c.segmentId === seg.id), `the mute "${seg.id}" has no caption`)
  else assert.ok(real.some((c) => c.segmentId === seg.id), `beat "${seg.id}" has a caption`)
}

// --- The music under the voice ------------------------------------------------
// A pure function of the frame: silent at the first frame, the base level
// away from the voice, ducked under a clip, silent again at the last frame.
const film = 173 * FPS
const clipA: NarrationClip = { segmentId: 'intro', src: 'narration/intro.mp3', startFrame: 12, seconds: 10 }
const clipB: NarrationClip = { segmentId: 'signin', src: 'narration/signin.mp3', startFrame: 600, seconds: 6 }
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

console.log(`  Demo timeline check passed — the edit is ${budgetSeconds(CUT)} s, ${CUT.length} beats, every spoken one captioned within its budget.`)
