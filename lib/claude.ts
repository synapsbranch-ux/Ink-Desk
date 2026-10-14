// Every prompt-specific text call. Each one is a prompt, a schema and a
// token budget handed to `ask()` in `lib/llm.ts`, which owns the providers:
// Claude first, the OpenRouter fallback when Claude cannot be used. See
// `devpost/spec.md > Text Provider and the Terra Fallback (v2)`.
//
// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { ask, type AskImage, type TextMeter } from './llm'
import { ProviderError } from './errors'
import {
  castPrompt,
  dnaFromPicturePrompt,
  dnaPrompt,
  pageScriptPrompt,
  planPrompt,
  rerollPrompt,
  rewritePanelPrompt,
  summarizePrompt,
  synopsisPrompt,
  type CharacterText,
  type LockedCharacter,
  type PanelSlot,
  type PlanSource,
} from './prompts'
import {
  CastSchema,
  chapterPlanSchema,
  CharacterProposalSchema,
  DnaSchema,
  pageScriptSchema,
  PanelRewriteSchema,
  ScenarioSummarySchema,
  SynopsisSchema,
  type ChapterPlanOutput,
  type CharacterProposal,
  type PageScriptOutput,
  type PanelRewrite,
  type SynopsisOutput,
} from './schemas'

export { ProviderError }

type SynopsisText = { title: string; body: string }

export function writeSynopsis(input: { pitch: string; genre: string; tone: string }, meter?: TextMeter): Promise<SynopsisOutput> {
  return ask(SynopsisSchema, synopsisPrompt(input), 1024, { label: 'synopsis', meter })
}

/** The accepted synopsis → two character proposals. */
export function writeCast(
  synopsis: SynopsisText,
  kind: 'synopsis' | 'scenario' = 'synopsis',
  meter?: TextMeter
): Promise<{ first: CharacterProposal; second: CharacterProposal }> {
  return ask(CastSchema, castPrompt(synopsis, kind), 1024, { label: 'cast', meter })
}

/** Reroll: a fresh proposal for one character, the other held fixed. */
export function rewriteCharacter(
  synopsis: SynopsisText,
  keep: CharacterText,
  replace: CharacterText,
  meter?: TextMeter
): Promise<CharacterProposal> {
  return ask(CharacterProposalSchema, rerollPrompt(synopsis, keep, replace), 1024, { label: 'reroll', meter })
}

/** The card's words → the paragraph every image request will carry. */
export async function writeDna(character: CharacterText, synopsis: SynopsisText, meter?: TextMeter): Promise<string> {
  const { dna } = await ask(DnaSchema, dnaPrompt(character, synopsis), 1024, { label: 'dna', meter })
  return dna.replace(/\s*\n\s*/g, ' ').trim()
}

/** An imported picture → the paragraph every image request will carry,
 *  written from the picture itself (slice 10). */
export async function writeDnaFromPicture(
  character: CharacterText,
  synopsis: SynopsisText,
  picture: { bytes: Buffer; mediaType: string },
  meter?: TextMeter
): Promise<string> {
  const { dna } = await ask(DnaSchema, dnaFromPicturePrompt(character, synopsis), 1024, {
    label: 'dna-from-picture',
    images: [picture],
    meter,
  })
  return dna.replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * The synopsis and both locked DNAs → the four-panel page script. The schema
 * is built per call from the two locked ids, so a reply naming anyone else
 * fails validation and never reaches the desk — one locked character
 * per panel, alternating. (Enforced by zod after the reply: the SDK's on the Claude
 * path, `ask()`'s own on the fallback. See `lib/schemas.ts`.)
 */
export function writePageScript(
  synopsis: SynopsisText,
  cast: readonly [LockedCharacter, LockedCharacter],
  meter?: TextMeter
): Promise<PageScriptOutput> {
  return ask(pageScriptSchema([cast[0].id, cast[1].id]), pageScriptPrompt(synopsis, cast), 2048, { label: 'script', meter })
}

/** A refused panel → calmer visuals. Only action, camera and background come
 *  back; the dialogue and the DNA are never Claude's to change here. */
export function rewritePanelVisuals(
  panel: { action: string; camera: string; background: string; dialogue: string },
  slot: PanelSlot,
  character: { name: string; role: string },
  meter?: TextMeter
): Promise<PanelRewrite> {
  return ask(PanelRewriteSchema, rewritePanelPrompt(panel, slot, character), 1024, { label: 'rewrite', meter })
}

/** The summarize-first path (slice 11): a scenario too long to plan from whole → its beats. */
export async function summarizeScenario(text: string, notes: string, meter?: TextMeter): Promise<string> {
  const { summary } = await ask(ScenarioSummarySchema, summarizePrompt(text, notes), 3072, { label: 'summary', meter })
  return summary.trim()
}

/**
 * The Director (slice 11): the story, the locked cast and the style → a plan
 * of `pageCount` four-panel pages and the cover brief, in one call. The
 * schema is built from the two locked ids and the page count, so a page that
 * names anyone else, or a plan of the wrong length, never reaches the desk.
 * Up to four ticked shelf references travel as pictures ahead of the prompt.
 */
export function writeChapterPlan(
  source: PlanSource,
  cast: readonly [LockedCharacter, LockedCharacter],
  style: { label: string; blurb: string },
  pageCount: number,
  references: AskImage[],
  meter?: TextMeter
): Promise<ChapterPlanOutput> {
  // ~110 tokens a panel line in the measured page scripts; 2× headroom, plus the brief.
  const maxTokens = 1024 + pageCount * 4 * 220
  return ask(chapterPlanSchema([cast[0].id, cast[1].id], pageCount), planPrompt(source, cast, style, pageCount), maxTokens, {
    label: 'plan',
    images: references.length ? references : undefined,
    meter,
  })
}
