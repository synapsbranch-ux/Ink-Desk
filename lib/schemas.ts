// Claude's output contracts, as zod schemas. `zodOutputFormat` turns each one
// into a JSON schema the API constrains the response to, so there is no prose
// parsing anywhere. See `devpost/spec.md > External Services and Dependencies
// > Anthropic — Claude (text)` for the three constraints that are a 400
// rather than a warning: every object closed (the helper does this), no
// recursion, no min/max on numbers or strings. Fixed counts are therefore
// expressed as named fields rather than array lengths.
import { z } from 'zod'

// --- Output contracts (what Claude returns) ---------------------------------

export const SynopsisSchema = z.object({
  title: z.string().describe('A short, evocative chapter title. No quotation marks.'),
  body: z
    .string()
    .describe('The synopsis: three to five sentences of present-tense prose naming both characters.'),
})
export type SynopsisOutput = z.infer<typeof SynopsisSchema>

export const CharacterProposalSchema = z.object({
  name: z.string(),
  role: z.string().describe('Their part in the story, e.g. "Lead · rooftop courier".'),
  traits: z.array(z.string()).describe('Three short personality traits.'),
  look: z.string().describe('A short description of how they look, two or three sentences.'),
})
export type CharacterProposal = z.infer<typeof CharacterProposalSchema>

/** Exactly two characters, by construction. */
export const CastSchema = z.object({
  first: CharacterProposalSchema,
  second: CharacterProposalSchema,
})

export const DnaSchema = z.object({
  dna: z
    .string()
    .describe(
      'The visual DNA: hair, eyes, face shape, skin, outfit, colors, and one or two distinguishing marks. Plain prose, no line breaks.'
    ),
})

/**
 * The page script. One locked character per panel is a schema constraint:
 * `characterId` is an enum of the two locked ids, so a panel naming an
 * unlocked character — or two — is rejected by the API, not caught later.
 */
export function pageScriptSchema(lockedIds: [string, string]) {
  const PanelLine = z.object({
    characterId: z.enum(lockedIds),
    action: z.string(),
    camera: z.string(),
    background: z.string(),
    dialogue: z.string().describe('One short speech-bubble line, under twelve words.'),
  })
  return z.object({
    panel1: PanelLine,
    panel2: PanelLine,
    panel3: PanelLine,
    panel4: PanelLine,
  })
}

// --- Request bodies (what the browser sends) --------------------------------

export const StationSchema = z.enum(['story', 'cast', 'storyboard', 'reader'])

/** One card's edit. `locked: true` is the Lock click; there is no unlock. */
const CharacterEditSchema = z
  .object({
    name: z.string(),
    role: z.string(),
    traits: z.array(z.string()),
    look: z.string(),
    locked: z.literal(true),
  })
  .partial()
  .strict()

export const ChapterPatchSchema = z
  .object({
    station: StationSchema.optional(),
    pitch: z.object({ text: z.string(), genre: z.string(), tone: z.string() }).partial().optional(),
    synopsis: z
      .object({ title: z.string(), body: z.string(), accepted: z.boolean() })
      .partial()
      .optional(),
    /** Keyed by character id. */
    cast: z.record(z.string(), CharacterEditSchema).optional(),
  })
  .strict()

export const SynopsisRequestSchema = z.object({
  pitch: z.string().trim().min(1),
  genre: z.string().min(1),
  tone: z.string().min(1),
})

export const RerollRequestSchema = z.object({ id: z.string().min(1) })

export const SheetRequestSchema = z.object({
  id: z.string().min(1),
  /** Redraw: keep the DNA on the card. Draw / after a look edit: write it fresh. */
  reuseDna: z.boolean().optional(),
})
