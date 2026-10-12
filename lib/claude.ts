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
import { synopsisPrompt } from './prompts'
import { SynopsisSchema, type SynopsisOutput } from './schemas'

export const TEXT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'

/**
 * A provider problem with a sentence the browser may show. `kind: 'config'`
 * is a missing key — worth a specific sentence, because the fix is local.
 * The raw cause is logged by the route handler, never sent to the browser.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'provider',
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

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

export function writeSynopsis(input: { pitch: string; genre: string; tone: string }): Promise<SynopsisOutput> {
  return ask(SynopsisSchema, synopsisPrompt(input), 1024)
}
