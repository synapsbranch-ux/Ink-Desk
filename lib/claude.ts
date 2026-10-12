// The Anthropic client and every text call. Server only — this is one of the
// two files that see an API key. See `devpost/spec.md > External Services and
// Dependencies > Anthropic — Claude (text)`.
//
// Verified against claude-sonnet-5-5 in slice 1 (`scripts/kernel-test.mjs`):
//   • structured output via output_config.format works;
//   • thinking is turned off with { type: 'between_tools' } — `disabled` is a
//     400 on this model;
//   • temperature / top_p / top_k are rejected, so none are sent.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { ProviderError } from './errors'
import {
  castPrompt,
  dnaPrompt,
  pageScriptPrompt,
  rerollPrompt,
  synopsisPrompt,
  type CharacterText,
  type LockedCharacter,
} from './prompts'
import {
  CastSchema,
  CharacterProposalSchema,
  DnaSchema,
  pageScriptSchema,
  SynopsisSchema,
  type CharacterProposal,
  type PageScriptOutput,
  type SynopsisOutput,
} from './schemas'

export { ProviderError }

export const TEXT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'

let client: Anthropic | null = null

function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ProviderError(
      'The studio isn’t connected to Claude yet. Add ANTHROPIC_API_KEY to .env and restart the dev server.',
      'config'
    )
  }
  return (client ??= new Anthropic())
}

async function ask<S extends z.ZodType>(schema: S, prompt: string, maxTokens: number): Promise<z.infer<S>> {
  let res
  try {
    res = await anthropic().messages.parse({
      model: TEXT_MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'between_tools' }, // short calls; latency is on camera
      output_config: {
        effort: 'low',
        format: zodOutputFormat(schema),
      },
      // Deliberately no temperature / top_p / top_k.
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    if (err instanceof ProviderError) throw err
    throw new ProviderError('Claude didn’t answer just now. Try again in a moment.', 'provider', err)
  }
  if (res.parsed_output == null) {
    throw new ProviderError('Claude didn’t answer just now. Try again in a moment.', 'provider', res)
  }
  return res.parsed_output
}

type SynopsisText = { title: string; body: string }

export function writeSynopsis(input: { pitch: string; genre: string; tone: string }): Promise<SynopsisOutput> {
  return ask(SynopsisSchema, synopsisPrompt(input), 1024)
}

/** The accepted synopsis → two character proposals. */
export function writeCast(synopsis: SynopsisText): Promise<{ first: CharacterProposal; second: CharacterProposal }> {
  return ask(CastSchema, castPrompt(synopsis), 1024)
}

/** Reroll: a fresh proposal for one character, the other held fixed. */
export function rewriteCharacter(
  synopsis: SynopsisText,
  keep: CharacterText,
  replace: CharacterText
): Promise<CharacterProposal> {
  return ask(CharacterProposalSchema, rerollPrompt(synopsis, keep, replace), 1024)
}

/** The card's words → the paragraph every image request will carry. */
export async function writeDna(character: CharacterText, synopsis: SynopsisText): Promise<string> {
  const { dna } = await ask(DnaSchema, dnaPrompt(character, synopsis), 1024)
  return dna.replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * The synopsis and both locked DNAs → the four-panel page script. The schema
 * is built per call from the two locked ids, so a reply naming anyone else
 * fails `messages.parse` and never reaches the desk — one locked character
 * per panel, alternating. (Enforced by the SDK's zod validation; the API
 * only sees the ids as description text. See `lib/schemas.ts`.)
 */
export function writePageScript(
  synopsis: SynopsisText,
  cast: readonly [LockedCharacter, LockedCharacter]
): Promise<PageScriptOutput> {
  return ask(pageScriptSchema([cast[0].id, cast[1].id]), pageScriptPrompt(synopsis, cast), 2048)
}
