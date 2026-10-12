// Claude's output contracts, as zod schemas. `zodOutputFormat` turns each one
// into a JSON schema the API constrains the response to, so there is no prose
// parsing anywhere. See `devpost/spec.md > External Services and Dependencies
// > Anthropic — Claude (text)` for the three constraints that are a 400
// rather than a warning: every object closed (the helper does this), no
// recursion, no min/max on numbers or strings. Fixed counts are therefore
// expressed as named fields rather than array lengths.
import { z } from 'zod'
import { PANEL_LAYOUT, type PanelSlot } from './prompts'

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
 * The page script. One locked character per panel is a schema constraint,
 * and so is the alternation: each panel's `characterId` is an enum drawn from
 * the two locked ids, narrowed to the one the page layout puts in that slot
 * (lead, counterpart, lead, counterpart — shot / reverse-shot). A panel naming
 * an unlocked character, two characters, or the right character in the wrong
 * slot never reaches the desk.
 *
 * Where that is enforced, precisely: the SDK sends the API only its strict
 * subset of JSON Schema and lowers `enum` into the field's description, so the
 * model reads the allowed id as text; then `messages.parse` validates the
 * reply against this zod schema and throws on anything else, before
 * `parsed_output` exists. The rule is the schema's; the check runs in the
 * SDK, not in the API's grammar. See `scripts/page-check.mts`.
 */
export function pageScriptSchema(lockedIds: readonly [string, string]) {
  const line = (slot: PanelSlot) =>
    z.object({
      characterId: z.enum([lockedIds[slot.cast]]).describe('The id of the character in this panel, fixed by the layout.'),
      action: z.string().describe('What this character does and their expression, one or two sentences, a single still frame.'),
      camera: z.string().describe(`The angle for this panel’s ${slot.shot}, one short sentence.`),
      background: z.string().describe('The setting as seen from this camera, one sentence, no lettering of any kind.'),
      dialogue: z.string().describe('One line this character says out loud, under twelve words. No quotation marks.'),
    })
  return z.object({
    panel1: line(PANEL_LAYOUT[0]),
    panel2: line(PANEL_LAYOUT[1]),
    panel3: line(PANEL_LAYOUT[2]),
    panel4: line(PANEL_LAYOUT[3]),
  })
}
export type PageScriptOutput = z.infer<ReturnType<typeof pageScriptSchema>>
export type PanelLine = PageScriptOutput['panel1']

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
