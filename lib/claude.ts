// Every prompt-specific text call. Each one is a prompt, a schema and a
// token budget handed to `ask()` in `lib/llm.ts`, which owns the providers:
// Claude first, the OpenRouter fallback when Claude cannot be used. See
// `devpost/spec.md > Text Provider and the Terra Fallback (v2)`.
import { ask } from './llm'
import { ProviderError } from './errors'
import {
  castPrompt,
  dnaPrompt,
  pageScriptPrompt,
  rerollPrompt,
  rewritePanelPrompt,
  synopsisPrompt,
  type CharacterText,
  type LockedCharacter,
  type PanelSlot,
} from './prompts'
import {
  CastSchema,
  CharacterProposalSchema,
  DnaSchema,
  pageScriptSchema,
  PanelRewriteSchema,
  SynopsisSchema,
  type CharacterProposal,
  type PageScriptOutput,
  type PanelRewrite,
  type SynopsisOutput,
} from './schemas'

export { ProviderError }

type SynopsisText = { title: string; body: string }

export function writeSynopsis(input: { pitch: string; genre: string; tone: string }): Promise<SynopsisOutput> {
  return ask(SynopsisSchema, synopsisPrompt(input), 1024, { label: 'synopsis' })
}

/** The accepted synopsis → two character proposals. */
export function writeCast(synopsis: SynopsisText): Promise<{ first: CharacterProposal; second: CharacterProposal }> {
  return ask(CastSchema, castPrompt(synopsis), 1024, { label: 'cast' })
}

/** Reroll: a fresh proposal for one character, the other held fixed. */
export function rewriteCharacter(
  synopsis: SynopsisText,
  keep: CharacterText,
  replace: CharacterText
): Promise<CharacterProposal> {
  return ask(CharacterProposalSchema, rerollPrompt(synopsis, keep, replace), 1024, { label: 'reroll' })
}

/** The card's words → the paragraph every image request will carry. */
export async function writeDna(character: CharacterText, synopsis: SynopsisText): Promise<string> {
  const { dna } = await ask(DnaSchema, dnaPrompt(character, synopsis), 1024, { label: 'dna' })
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
  cast: readonly [LockedCharacter, LockedCharacter]
): Promise<PageScriptOutput> {
  return ask(pageScriptSchema([cast[0].id, cast[1].id]), pageScriptPrompt(synopsis, cast), 2048, { label: 'script' })
}

/** A refused panel → calmer visuals. Only action, camera and background come
 *  back; the dialogue and the DNA are never Claude's to change here. */
export function rewritePanelVisuals(
  panel: { action: string; camera: string; background: string; dialogue: string },
  slot: PanelSlot,
  character: { name: string; role: string }
): Promise<PanelRewrite> {
  return ask(PanelRewriteSchema, rewritePanelPrompt(panel, slot, character), 1024, { label: 'rewrite' })
}
