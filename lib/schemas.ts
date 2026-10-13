// Claude's output contracts, as zod schemas. `zodOutputFormat` turns each one
// into a JSON schema the API constrains the response to, so there is no prose
// parsing anywhere. See `devpost/spec.md > External Services and Dependencies
// > Anthropic — Claude (text)` for the three constraints that are a 400
// rather than a warning: every object closed (the helper does this), no
// recursion, no min/max on numbers or strings. Fixed counts are therefore
// expressed as named fields rather than array lengths.
import { z } from 'zod'
import { Refused } from './errors'
import { PANEL_LAYOUT, type PanelSlot } from './prompts'
import { STYLE_PRESET_IDS } from './styles'

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
 * SDK, not in the API's grammar. See `scripts/page-check.mts`. On the
 * OpenRouter fallback the enum does reach the strict grammar, and `ask()`
 * validates the reply against this same schema (`lib/llm.ts`).
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

// --- The Director (slice 11) --------------------------------------------------

/** The page counts the Director accepts — `prd.md > Open Questions (v2)`: 3 to 6, tuned at the checkpoint. */
export const PAGE_COUNT_MIN = 3
export const PAGE_COUNT_MAX = 6
export const PAGE_COUNT_DEFAULT = 3

/**
 * The chapter plan: exactly `pageCount` pages, each the v1 page-script shape —
 * a per-slot `z.enum` of the one locked character that slot takes,
 * alternating — plus the cover brief. A fixed length is expressed as named
 * fields (`page1` … `pageN`), not an array length: both providers' strict
 * grammars accept closed objects, and neither enforces `minItems` (the same
 * reason the page script has `panel1` … `panel4`). Every page gets its own
 * schema instance, undecorated, so nothing is emitted as a shared `$ref`.
 *
 * A count outside 3–6 is refused before any call is made.
 */
export function chapterPlanSchema(lockedIds: readonly [string, string], pageCount: number) {
  if (!Number.isInteger(pageCount) || pageCount < PAGE_COUNT_MIN || pageCount > PAGE_COUNT_MAX) {
    throw new Refused(`A chapter plan has ${PAGE_COUNT_MIN} to ${PAGE_COUNT_MAX} pages.`, 400)
  }
  const shape: Record<string, z.ZodType> = {
    coverBrief: z
      .string()
      .describe(
        'The cover illustration, one paragraph: the lead character alone, their pose and expression, the setting behind them, the light and the mood. Drawable, no lettering of any kind.'
      ),
  }
  for (let n = 1; n <= pageCount; n++) {
    // No `.describe()` here: on a page object it makes `z.toJSONSchema(…, { reused: 'ref' })`
    // — which the Anthropic SDK uses — emit every panel line as a `$ref`. Plain is simpler on both wires.
    shape[`page${n}`] = pageScriptSchema(lockedIds)
  }
  return z.object(shape) as unknown as z.ZodType<ChapterPlanOutput>
}

/** `{ coverBrief, page1, page2, … }` — one page script per page. */
export type ChapterPlanOutput = { coverBrief: string } & { [page: `page${number}`]: PageScriptOutput }

/** The plan's pages in order, out of the named fields. */
export function planPages(out: ChapterPlanOutput, pageCount: number): PageScriptOutput[] {
  return Array.from({ length: pageCount }, (_, i) => out[`page${i + 1}`])
}

/** The summarize-first path: a long scenario condensed to the beats the plan is built from. */
export const ScenarioSummarySchema = z.object({
  summary: z
    .string()
    .describe(
      'The scenario condensed to its beats, in order: a numbered list in plain prose, keeping every name, place and turning point and the few lines of dialogue that matter.'
    ),
})

// --- Request bodies (what the browser sends) --------------------------------

/** Rewrite panel: only the visuals come back. No dialogue, no DNA, by shape. */
export const PanelRewriteSchema = z.object({
  action: z.string().min(1).describe('What the character does and their expression, drawable as one still frame.'),
  camera: z.string().min(1).describe('The camera angle, one short sentence, same shot size as before.'),
  background: z.string().min(1).describe('The same location from that camera, one drawable sentence, no lettering.'),
})
export type PanelRewrite = z.infer<typeof PanelRewriteSchema>

export const StationSchema = z.enum(['story', 'cast', 'director', 'storyboard', 'reader'])

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

/** Percentages of the panel; the shared clamp tightens them further. */
const pct = z.number().min(0).max(100)
export const BubbleLayoutSchema = z
  .object({ x: pct, y: pct, w: pct, h: pct, tailX: pct, tailY: pct })
  .strict()

export const PanelEditSchema = z
  .object({
    dialogue: z.string().max(500).optional(),
    bubble: BubbleLayoutSchema.optional(),
    /** The displayed version; clamped to the panel's history (max 3 kept). */
    version: z.number().int().min(0).max(2).optional(),
  })
  .strict()

/** One plan line's edit (slice 11). The character in a slot is the layout's, never editable. */
const PlanLineEditSchema = z
  .object({
    action: z.string().max(600),
    camera: z.string().max(300),
    background: z.string().max(600),
    dialogue: z.string().max(500),
  })
  .partial()
  .strict()

/** The longest scenario the desk keeps; past `SCENARIO_WHOLE_CHARS` it is summarized before planning. */
export const SCENARIO_MAX_CHARS = 100_000

export const ChapterPatchSchema = z
  .object({
    station: StationSchema.optional(),
    /** Pitch or Scenario, chosen before the story is accepted or saved. */
    storyMode: z.enum(['pitch', 'scenario']).optional(),
    scenario: z
      .object({
        text: z.string().max(SCENARIO_MAX_CHARS),
        notes: z.string().max(5000),
        referenceAssetIds: z.array(z.string().min(1).max(200)).max(24),
        /** "Use this scenario" — there is no un-save, as there is no un-accept. */
        saved: z.literal(true),
      })
      .partial()
      .strict()
      .optional(),
    plan: z
      .object({
        pageCount: z.number().int().min(PAGE_COUNT_MIN).max(PAGE_COUNT_MAX),
        coverBrief: z.string().max(2000),
        /** Keyed by page index, then by panel index "0"–"3". */
        pages: z.record(z.string().regex(/^[0-5]$/), z.record(z.string().regex(/^[0-3]$/), PlanLineEditSchema)),
      })
      .partial()
      .strict()
      .optional(),
    /** The cover's title — lettered by the app over the art, never by the model. */
    cover: z
      .object({ title: z.string().max(120), version: z.number().int().min(0).max(2) })
      .partial()
      .strict()
      .optional(),
    /** The page switcher: the page this project has open. */
    page: z.number().int().min(0).max(PAGE_COUNT_MAX - 1).optional(),
    pitch: z.object({ text: z.string(), genre: z.string(), tone: z.string() }).partial().optional(),
    synopsis: z
      .object({ title: z.string(), body: z.string(), accepted: z.boolean() })
      .partial()
      .optional(),
    /** Keyed by character id. */
    cast: z.record(z.string(), CharacterEditSchema).optional(),
    /** Keyed by panel index, "0"–"3". */
    panels: z.record(z.string().regex(/^[0-3]$/), PanelEditSchema).optional(),
  })
  .strict()

export const SynopsisRequestSchema = z.object({
  pitch: z.string().trim().min(1),
  genre: z.string().min(1),
  tone: z.string().min(1),
})

/** A new project (`POST /api/projects`): a title and a locked style preset.
 *  With a story — the v2 form of "accepting a new synopsis starts a new
 *  chapter" — it wakes with that synopsis accepted. */
export const NewProjectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  stylePresetId: z.enum(STYLE_PRESET_IDS),
  story: z
    .object({
      pitch: z.object({ text: z.string().trim().min(1), genre: z.string().min(1), tone: z.string().min(1) }),
      synopsis: z.object({ title: z.string().trim().min(1), body: z.string().trim().min(1) }),
    })
    .optional(),
})

export const RerollRequestSchema = z.object({ id: z.string().min(1) })

export const SheetRequestSchema = z.object({
  id: z.string().min(1),
  /** Redraw: keep the DNA on the card. Draw / after a look edit: write it fresh. */
  reuseDna: z.boolean().optional(),
})

/** Write the chapter plan. `replace` is "Ask the Director again" — only while no page is written. */
export const PlanRequestSchema = z.object({
  pageCount: z.number().int().min(PAGE_COUNT_MIN).max(PAGE_COUNT_MAX),
  replace: z.boolean().optional(),
})

/** Import reference: this card's sheet becomes that shelf asset. */
export const ImportRequestSchema = z.object({ id: z.string().min(1), assetId: z.string().min(1) })
