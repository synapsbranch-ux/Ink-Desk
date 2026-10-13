// Every prompt in one file, including the frozen half of every image request.
// Keeping them together is what makes "the frozen half never changes"
// checkable rather than aspirational.
// See `devpost/spec.md > Components > Prompts and Schemas` and
// `devpost/scope.md > The Unique Kernel`.
//
// This file reads no environment and is safe to import from the browser —
// aspect ratios are resolved by the server code that sends the request.
import { DEFAULT_STYLE_PRESET_ID, STYLE_PRESETS } from './styles'

// --- Story station --------------------------------------------------------

/** "Try the sample" fills the pitch text only. Everything after is real. */
export const SAMPLE_PITCH =
  'A rooftop courier in a future Osaka delivers letters that haven’t been written yet.'

export const GENRES = ['Shonen', 'Romance', 'Horror', 'Slice of Life'] as const
export const TONES = ['Hopeful', 'Fast-paced', 'Melancholy', 'Comedic', 'Eerie'] as const

export function synopsisPrompt(input: { pitch: string; genre: string; tone: string }): string {
  return [
    'You are the story editor at Ink Desk, a small manga studio. A storyteller has',
    'pitched a one-page manga chapter. Write the synopsis the studio will build from.',
    '',
    `Pitch: ${input.pitch.trim()}`,
    `Genre: ${input.genre}`,
    `Tone: ${input.tone}`,
    '',
    'Requirements:',
    '- Exactly two named characters: a lead and a counterpart (a rival, an ally,',
    '  a foil). Name both in the synopsis. No third character with a speaking part.',
    '- One scene, one location, one dramatic beat. It has to fit on a single',
    '  four-panel page told shot/reverse-shot between the two characters.',
    '- Three to five sentences, present tense, plain prose. No dialogue, no',
    '  headings, no markdown, no bullet points.',
    '- The title is a short, evocative chapter title without quotation marks.',
    '- Match the genre and tone. Keep it suitable for a general audience.',
  ].join('\n')
}

// --- The frozen half of every image request -------------------------------
//
// Proven by `scripts/kernel-test.mjs` in slices 1–2 and ported verbatim.
// Since v2 the rules text comes from the project's locked style preset
// (`lib/styles.ts`); `STYLE_RULES` is the default preset's text, word for
// word what v1 pasted, and every prompt takes the project's rules as a
// defaulted parameter so the v1 checks still read the same prompt.

export const STYLE_RULES = STYLE_PRESETS[DEFAULT_STYLE_PRESET_ID].rules

/** A model sheet is drawn from the DNA alone — no references. */
export function sheetPrompt(dna: string, rules: string = STYLE_RULES): string {
  return [
    'A single character model sheet on one sheet of paper, for animation reference.',
    'One character only, shown three times in one frame: full-body front view,',
    'full-body three-quarter view, and a row of three head-and-shoulders expressions',
    '(neutral, determined, surprised). Plain light background, consistent lighting.',
    '',
    'The character:',
    dna,
    '',
    rules,
  ].join('\n')
}

// --- The page layout --------------------------------------------------------
//
// `devpost/spec.md > The Page Layout`: wide / square / square / wide. The
// shape is fixed per slot and passed in the request as `aspect_ratio`; the
// framing line goes in the prompt too, so the model composes for the shape it
// is drawing and nothing important sits where a crop would cut it.

export type PanelShape = 'wide' | 'square'

/** Where the figure stands in the frame. Drives the framing line, the pencil silhouette and the bubble corner. */
export type PanelStance = 'left' | 'medium' | 'close' | 'right'

export type PanelSlot = {
  index: 0 | 1 | 2 | 3
  /** Who is in this panel: the lead (`cast[0]`) or the counterpart (`cast[1]`). Shot / reverse-shot. */
  cast: 0 | 1
  shape: PanelShape
  stance: PanelStance
  shot: string
  framing: string
}

// A wide panel is a medium-wide shot, never a tiny figure in the distance:
// the figure takes at least a third of the panel's height so the face stays
// readable — a face too small to read would hide whether the lock held.
export const PANEL_LAYOUT: readonly PanelSlot[] = [
  {
    index: 0,
    cast: 0,
    shape: 'wide',
    stance: 'left',
    shot: 'wide establishing shot',
    framing:
      'Wide landscape panel, medium-wide shot. The character stands in the left third of the frame, their figure at least a third of the panel’s height and ideally half — face and outfit clearly readable, never a small figure in the distance — with clear margin on every side. The setting fills the rest of the frame.',
  },
  {
    index: 1,
    cast: 1,
    shape: 'square',
    stance: 'medium',
    shot: 'medium shot',
    framing:
      'Square panel. Frame the character from the waist up, centred, with headroom above and nothing important near the edges.',
  },
  {
    index: 2,
    cast: 0,
    shape: 'square',
    stance: 'close',
    shot: 'close-up',
    framing:
      'Square panel. Centre the character’s face in frame with headroom above and below; keep the eyes on the upper third line and nothing important near the edges.',
  },
  {
    index: 3,
    cast: 1,
    shape: 'wide',
    stance: 'right',
    shot: 'wide reaction shot',
    framing:
      'Wide landscape panel, medium-wide shot. The character stands in the right third of the frame, a three-quarter figure at least a third of the panel’s height and ideally half — face and expression clearly readable, never a small figure in the distance — with clear margin on every side. The setting fills the rest of the frame.',
  },
]

/**
 * A panel prompt: the locked DNA verbatim, the slot's framing, and Claude's
 * variable part. The locked sheet travels alongside it as `input_references`.
 * One person in the panel, always — shot / reverse-shot means the other
 * character is off-panel, and a second figure would have no reference.
 */
export function panelPrompt(
  dna: string,
  panel: { camera: string; action: string; background: string },
  slot: PanelSlot,
  rules: string = STYLE_RULES
): string {
  return [
    'A single manga panel with exactly one person in it: the character shown in the',
    'attached reference sheet. No other people, figures or silhouettes anywhere in',
    'the panel.',
    '',
    'Keep their face, hairstyle, eyes, outfit and distinguishing marks EXACTLY as the',
    'reference sheet shows. Do not restyle, age, or redesign them.',
    'Only their pose, expression and surroundings change.',
    '',
    'Their fixed appearance, for reference:',
    dna,
    '',
    `Framing: ${slot.framing}`,
    `Camera: ${panel.camera}`,
    `Action: ${panel.action}`,
    `Background: ${panel.background}`,
    '',
    rules,
  ].join('\n')
}

/**
 * Rewrite panel, for a refusal: the image model declined the description, so
 * Claude rephrases ONLY the visuals — action, camera, background. The
 * dialogue and the DNA are never Claude's to change here; the dialogue is
 * context only. `prd.md > States and Boundaries`.
 */
export function rewritePanelPrompt(
  panel: { action: string; camera: string; background: string; dialogue: string },
  slot: PanelSlot,
  character: { name: string; role: string }
): string {
  return [
    'You are the page director at Ink Desk, a small manga studio. The image model',
    'declined to draw one panel of the page as written. Rephrase ONLY that panel’s',
    'visual description so it can be drawn — calmer and more concrete, with nothing',
    'that could read as violent, unsafe, or against an image model’s content rules.',
    'Keep the same story beat and the same setting.',
    '',
    `The panel: panel ${slot.index + 1} — ${character.name} (${character.role}), ${slot.shot}.`,
    `Their spoken line stays exactly as written and is not yours to change: “${panel.dialogue}”.`,
    '',
    'The description that was declined:',
    `- action: ${panel.action}`,
    `- camera: ${panel.camera}`,
    `- background: ${panel.background}`,
    '',
    'Write the replacement:',
    '- action: what this character is doing and the expression on their face, in one',
    '  or two sentences an artist can draw as a single still frame. Exactly one',
    '  person in the panel.',
    `- camera: one short sentence, staying inside this shot size: ${slot.shot}. Never`,
    '  pull back to a distant wide, never cut in closer.',
    '- background: the same location seen from that camera, in one sentence,',
    '  specific and drawable, with no signs, posters or lettering of any kind.',
  ].join('\n')
}

// --- Page script ----------------------------------------------------------
//
// The variable half of every panel request, written once per page by Claude
// from the accepted synopsis and both locked DNAs. The layout is fixed, so
// the prompt states who is in each panel and at what shot size; the schema
// in `lib/schemas.ts` holds the model to the same assignment.

export type LockedCharacter = { id: string; name: string; role: string; traits: string[]; dna: string }

export function pageScriptPrompt(
  synopsis: { title: string; body: string },
  cast: readonly [LockedCharacter, LockedCharacter]
): string {
  const [lead, counterpart] = cast
  return [
    'You are the page director at Ink Desk, a small manga studio. The cast is locked;',
    'write the script for the single four-panel page that tells this chapter.',
    '',
    `Title: ${synopsis.title}`,
    `Synopsis: ${synopsis.body}`,
    '',
    'The cast. Their looks are locked and will be drawn exactly as written here:',
    `- ${lead.name} (id ${lead.id}) — ${lead.role}. ${lead.traits.join(', ')}.`,
    `  Appearance: ${lead.dna}`,
    `- ${counterpart.name} (id ${counterpart.id}) — ${counterpart.role}. ${counterpart.traits.join(', ')}.`,
    `  Appearance: ${counterpart.dna}`,
    '',
    'The page layout is fixed: shot / reverse-shot, exactly one character in each',
    'panel, never both. The other character is off-panel — spoken to, or reacted to.',
    ...PANEL_LAYOUT.map(
      (s) =>
        `- Panel ${s.index + 1}: ${cast[s.cast].name}, ${s.shot} (${s.shape === 'wide' ? 'landscape' : 'square'}). ${s.framing}`
    ),
    '',
    'For each panel write:',
    '- characterId: the id given above for the character in that panel.',
    '- action: what this character is doing and the expression on their face, in one',
    '  or two sentences an artist can draw as a single still frame. Only this',
    '  character is in the panel. Use their outfit and marks where it helps — the',
    '  scarf catching the wind, the glasses pushed up.',
    '- camera: the angle for that panel’s shot, in one short sentence — "slight low',
    '  angle, looking up", "eye level, three-quarter view". Stay inside the shot',
    '  size given above: never pull back to a distant wide, never cut in closer.',
    '- background: the setting as seen from that camera, in one sentence. One',
    '  location for the whole page, a different part or angle of it in each panel.',
    '  Specific and drawable, with no signs, posters or lettering of any kind.',
    '- dialogue: one line this character says out loud, under twelve words, in their',
    '  own voice. Plain speech — no sound effects, no narration, no quotation marks.',
    '',
    'The four panels read in order as one beat: the setup, the response, the turn,',
    'the reaction. Match the synopsis’s genre and tone. Keep it suitable for a',
    'general audience.',
  ].join('\n')
}

// --- Cast station ---------------------------------------------------------
//
// Three text calls. The cast and reroll prompts produce the editable words on
// a card; the DNA prompt produces the paragraph that is frozen at lock and
// pasted verbatim into every image request — the words half of the kernel.

export type CharacterText = { name: string; role: string; traits: string[]; look: string }

const CHARACTER_RULES = [
  '- role: their part in the story in a few words, e.g. "Lead · rooftop courier".',
  '- traits: three short personality traits, one or two words each.',
  '- look: two or three sentences describing only what can be seen — apparent age',
  '  and build, hair, eyes, face, skin, clothes — ending with one or two',
  '  distinguishing marks an artist could spot from across the street: a scar, a',
  '  scarf, an eyepatch, a cap. Those marks are what keep a character recognizable',
  '  between a close-up and a wide shot, so make them specific.',
  '- Plain prose, no markdown, suitable for a general audience.',
]

export function castPrompt(synopsis: { title: string; body: string }): string {
  return [
    'You are the character designer at Ink Desk, a small manga studio. The story',
    'editor has accepted this synopsis for a one-page, four-panel chapter. Propose',
    'the two characters it names, for the artist to draw model sheets from.',
    '',
    `Title: ${synopsis.title}`,
    `Synopsis: ${synopsis.body}`,
    '',
    'Requirements:',
    '- Exactly two characters: "first" is the lead, "second" is the counterpart.',
    '  Use the names the synopsis gives them.',
    '- Make the two easy to tell apart at a glance: different builds, hair and',
    '  clothing, not two variations of one design.',
    ...CHARACTER_RULES,
  ].join('\n')
}

export function rerollPrompt(
  synopsis: { title: string; body: string },
  keep: CharacterText,
  replace: CharacterText
): string {
  return [
    'You are the character designer at Ink Desk, a small manga studio. The',
    'storyteller wants a fresh take on one of the two characters in this synopsis.',
    '',
    `Title: ${synopsis.title}`,
    `Synopsis: ${synopsis.body}`,
    '',
    `Keep this character exactly as they are: ${keep.name} — ${keep.role}.`,
    '',
    `Replace this proposal for ${replace.name}:`,
    `  role: ${replace.role}`,
    `  traits: ${replace.traits.join(', ')}`,
    `  look: ${replace.look}`,
    '',
    'Requirements:',
    `- Keep the name ${replace.name}, since the story uses it. Everything else is a`,
    '  genuinely different proposal: a new look with new distinguishing marks, a',
    '  different set of traits, a fresh role line.',
    `- Still easy to tell apart from ${keep.name} at a glance.`,
    ...CHARACTER_RULES,
  ].join('\n')
}

/**
 * The DNA prompt. The paragraph it returns is the sheet prompt's subject and,
 * once locked, is pasted word for word into every panel request — see
 * `devpost/scope.md > The Unique Kernel`. It asks for exactly the things the
 * kernel test showed hold across shots: a full outfit and one or two marks
 * visible from any distance.
 */
export function dnaPrompt(character: CharacterText, synopsis: { title: string; body: string }): string {
  return [
    'You are the character designer at Ink Desk, a small manga studio. Write the',
    `visual DNA for ${character.name}: one paragraph that will be pasted, word for`,
    'word, into every image request this character appears in, so the artist',
    'draws the same person on the model sheet and in every panel after it.',
    '',
    `Story: ${synopsis.title} — ${synopsis.body}`,
    '',
    'The character, as the storyteller described them:',
    `  name: ${character.name}`,
    `  role: ${character.role}`,
    `  traits: ${character.traits.join(', ')}`,
    `  look: ${character.look}`,
    '',
    'Requirements:',
    '- Start with their name, apparent age and sex. Then hair (length, cut, colour,',
    '  how it falls), eyes, face shape, skin tone, build, and the full outfit from',
    '  head to foot with its colours.',
    '- End with one or two distinguishing marks that stay visible from a distance',
    '  and from any angle — a scar, a scarf, a cap, an eyepatch, a pendant. These',
    '  are what hold the character together between a close-up and a wide shot.',
    '- Only what can be drawn. No personality, no backstory, no motion, no setting.',
    '- Keep everything the storyteller’s look says; add only what it leaves out.',
    '  Nothing that contradicts it.',
    '- One paragraph of plain prose, no line breaks, no lists, no markdown.',
    '  Suitable for a general audience.',
  ].join('\n')
}

/**
 * DNA from a picture (v2, slice 10). The storyteller uploaded their own
 * reference; it becomes the locked sheet, and this paragraph is written FROM
 * it, so the two frozen artifacts agree by construction — the picture wins
 * wherever the card's words disagree with it. Same output contract as
 * `dnaPrompt`: one drawable paragraph, pasted verbatim into every panel.
 */
export function dnaFromPicturePrompt(character: CharacterText, synopsis: { title: string; body: string }): string {
  return [
    'You are the character designer at Ink Desk, a small manga studio. The',
    `storyteller uploaded the attached picture as their own reference for ${character.name}.`,
    'It becomes this character’s locked model sheet: every panel they appear in is',
    'drawn against it. Write their visual DNA — one paragraph that will be pasted,',
    'word for word, into every one of those image requests.',
    '',
    `Story: ${synopsis.title} — ${synopsis.body}`,
    '',
    'The character, as the storyteller described them:',
    `  name: ${character.name}`,
    `  role: ${character.role}`,
    `  traits: ${character.traits.join(', ')}`,
    `  look: ${character.look}`,
    '',
    'Requirements:',
    '- Describe the person the picture shows. Where the look above and the picture',
    '  disagree, the picture wins — it is what every panel is drawn against.',
    '- If the picture shows several people, describe the most prominent one only.',
    '- Start with their name, apparent age and sex. Then hair (length, cut, colour,',
    '  how it falls), eyes, face shape, skin tone, build, and the full outfit from',
    '  head to foot with its colours, as far as the picture shows them.',
    '- End with one or two distinguishing marks that are visible in the picture and',
    '  would stay visible from a distance — a scar, a scarf, a cap, glasses, a pendant.',
    '- Only what can be drawn. No art-style words (the project has its own style),',
    '  no personality, no backstory, no setting, no pose.',
    '- Never say who a real person in the picture might be.',
    '- One paragraph of plain prose, no line breaks, no lists, no markdown.',
    '  Suitable for a general audience.',
  ].join('\n')
}
