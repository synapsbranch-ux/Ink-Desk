// Every prompt in one file, including the frozen half of every image request.
// Keeping them together is what makes "the frozen half never changes"
// checkable rather than aspirational.
// See `devpost/spec.md > Components > Prompts and Schemas` and
// `devpost/scope.md > The Unique Kernel`.
//
// This file reads no environment and is safe to import from the browser —
// aspect ratios are resolved by the server code that sends the request.

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
// STYLE_RULES is pasted into every sheet and panel prompt unchanged.

export const STYLE_RULES = [
  'Black and white manga artwork, screentone shading, confident inked linework.',
  'Seinen style, detailed backgrounds, strong use of blacks.',
  'ABSOLUTELY NO TEXT, no speech bubbles, no sound effects, no signatures,',
  'no watermarks and no panel borders anywhere in the image.',
].join(' ')

/** A model sheet is drawn from the DNA alone — no references. */
export function sheetPrompt(dna: string): string {
  return [
    'A single character model sheet on one sheet of paper, for animation reference.',
    'One character only, shown three times in one frame: full-body front view,',
    'full-body three-quarter view, and a row of three head-and-shoulders expressions',
    '(neutral, determined, surprised). Plain light background, consistent lighting.',
    '',
    'The character:',
    dna,
    '',
    STYLE_RULES,
  ].join('\n')
}

// --- The page layout --------------------------------------------------------
//
// `devpost/spec.md > The Page Layout`: wide / square / square / wide. The
// shape is fixed per slot and passed in the request as `aspect_ratio`; the
// framing line goes in the prompt too, so the model composes for the shape it
// is drawing and nothing important sits where a crop would cut it.

export type PanelShape = 'wide' | 'square'

export type PanelSlot = {
  index: 0 | 1 | 2 | 3
  shape: PanelShape
  shot: string
  framing: string
}

export const PANEL_LAYOUT: readonly PanelSlot[] = [
  {
    index: 0,
    shape: 'wide',
    shot: 'wide establishing shot',
    framing:
      'Wide landscape panel. Place the character off-centre in the left third, full body inside the frame with clear margin on every side.',
  },
  {
    index: 1,
    shape: 'square',
    shot: 'medium shot',
    framing:
      'Square panel. Frame the character from the waist up, centred, with headroom above and nothing important near the edges.',
  },
  {
    index: 2,
    shape: 'square',
    shot: 'close-up',
    framing:
      'Square panel. Centre the character’s face in frame with headroom above and below; keep the eyes on the upper third line and nothing important near the edges.',
  },
  {
    index: 3,
    shape: 'wide',
    shot: 'wide reaction shot',
    framing:
      'Wide landscape panel. Place the character off-centre in the right third, full body or three-quarter figure inside the frame with clear margin on every side.',
  },
]

/**
 * A panel prompt: the locked DNA verbatim, the slot's framing, and Claude's
 * variable part. The locked sheet travels alongside it as `input_references`.
 */
export function panelPrompt(
  dna: string,
  panel: { camera: string; action: string; background: string },
  slot: PanelSlot
): string {
  return [
    'A single manga panel.',
    '',
    'The character in this panel is shown in the attached reference sheet.',
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
    STYLE_RULES,
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
