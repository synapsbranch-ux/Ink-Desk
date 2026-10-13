// The one text call. Server only — every prompt-specific function in
// `lib/claude.ts` goes through `ask()`. See `devpost/spec.md > Text Provider
// and the Terra Fallback (v2)`.
//
// Claude first, exactly as v1 called it. When Claude cannot be used — no
// ANTHROPIC_API_KEY, a 402, or a 5xx / 529 / 429 / dropped connection that
// survives the SDK's single retry — the same schema goes to the fallback
// model through OpenRouter's chat completions, and the reply is validated
// with the same zod schema before anything is returned. The terminal names
// the provider that answered; the browser's sentences never change.
//
//   LLM_FALLBACK        auto (default) · always (skip Claude) · never
//   LLM_FALLBACK_MODEL  default openai/gpt-5.6-terra
import Anthropic, { APIConnectionError, APIError } from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { ProviderError } from './errors'

const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions'

export type AskImage = { bytes: Buffer; mediaType: string }
export type AskOptions = {
  /** For the terminal line and the fallback's schema name, e.g. "synopsis". */
  label?: string
  /** Sent ahead of the prompt — the DNA-from-picture call. */
  images?: AskImage[]
}

type FallbackMode = 'auto' | 'always' | 'never'

/** Read at call time, so a `.env` edit needs only a dev-server restart. */
export function textConfig() {
  const mode = process.env.LLM_FALLBACK
  const fallback: FallbackMode = mode === 'always' || mode === 'never' ? mode : 'auto'
  return {
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
    fallbackModel: process.env.LLM_FALLBACK_MODEL ?? 'openai/gpt-5.6-terra',
    fallback,
  }
}

const NO_CLAUDE_KEY =
  'The studio isn’t connected to Claude yet. Add ANTHROPIC_API_KEY to .env and restart the dev server.'
const NO_OPENROUTER_KEY =
  'The studio isn’t connected to the fallback text model yet. Add OPENROUTER_API_KEY to .env and restart the dev server.'
const CLAUDE_BUSY = 'Claude didn’t answer just now. Try again in a moment.'
const FALLBACK_BUSY = 'The text model didn’t answer just now. Try again in a moment.'

export async function ask<S extends z.ZodType>(
  schema: S,
  prompt: string,
  maxTokens: number,
  opts: AskOptions = {}
): Promise<z.infer<S>> {
  const cfg = textConfig()
  const label = opts.label ?? 'reply'

  if (cfg.fallback === 'always') return askFallback(schema, prompt, maxTokens, label, opts.images, 'LLM_FALLBACK=always')

  const started = Date.now()
  try {
    const out = await askClaude(schema, prompt, maxTokens, cfg.model, opts.images)
    console.log(`[text] ${label} — anthropic/${cfg.model} · ${seconds(started)}`)
    return out
  } catch (err) {
    const why = claudeUnavailable(err)
    if (!why || cfg.fallback === 'never' || !process.env.OPENROUTER_API_KEY) {
      if (why) console.warn(`[text] ${label} — Claude unavailable (${why}); no fallback (${fallbackOffReason(cfg.fallback)})`)
      throw err
    }
    console.warn(`[text] ${label} — Claude unavailable (${why}); asking openrouter/${cfg.fallbackModel}`)
    return askFallback(schema, prompt, maxTokens, label, opts.images, why)
  }
}

// --- Primary: Anthropic, unchanged from v1 ---------------------------------
//
// Verified against claude-sonnet-5-5 in slice 1 (`scripts/kernel-test.mjs`):
//   • structured output via output_config.format works;
//   • thinking is turned off with { type: 'between_tools' } — `disabled` is a
//     400 on this model;
//   • temperature / top_p / top_k are rejected, so none are sent.

let client: Anthropic | null = null

function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ProviderError(NO_CLAUDE_KEY, 'config')
  // One retry, not the SDK's default two: past it, the fallback is the faster answer.
  return (client ??= new Anthropic({ maxRetries: 1 }))
}

type ClaudeImage = { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }

async function askClaude<S extends z.ZodType>(
  schema: S,
  prompt: string,
  maxTokens: number,
  model: string,
  images: AskImage[] | undefined
): Promise<z.infer<S>> {
  const content = images?.length
    ? [
        ...images.map(
          (img): ClaudeImage => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType as ClaudeImage['source']['media_type'], data: img.bytes.toString('base64') },
          })
        ),
        { type: 'text' as const, text: prompt },
      ]
    : prompt
  let res
  try {
    res = await anthropic().messages.parse({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'between_tools' }, // short calls; latency is on camera
      output_config: {
        effort: 'low',
        format: zodOutputFormat(schema),
      },
      // Deliberately no temperature / top_p / top_k.
      messages: [{ role: 'user', content }],
    })
  } catch (err) {
    if (err instanceof ProviderError) throw err
    throw new ProviderError(CLAUDE_BUSY, 'provider', err)
  }
  if (res.parsed_output == null) throw new ProviderError(CLAUDE_BUSY, 'provider', res)
  return res.parsed_output
}

/** Why Claude cannot be used for this call, or null when the failure is not one the fallback should cover. */
function claudeUnavailable(err: unknown): string | null {
  if (!(err instanceof ProviderError)) return null
  if (err.kind === 'config') return 'no ANTHROPIC_API_KEY'
  const cause = err.cause
  if (cause instanceof APIConnectionError) return 'no connection after one retry'
  if (cause instanceof APIError && typeof cause.status === 'number') {
    if (cause.status === 402) return '402'
    if (cause.status === 429 || cause.status >= 500) return `${cause.status} after one retry`
  }
  return null
}

function fallbackOffReason(mode: FallbackMode): string {
  return mode === 'never' ? 'LLM_FALLBACK=never' : 'no OPENROUTER_API_KEY'
}

// --- Fallback: OpenRouter chat completions ---------------------------------

type ChatResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]
  usage?: { cost?: number }
  error?: { code?: number; message?: string }
}

/** One fetch's outcome: a validated reply, or a failure and whether one retry is worth it. */
type Attempt<T> = { ok: true; value: T; cost: number | null } | { ok: false; retry: boolean; cause: string }

async function askFallback<S extends z.ZodType>(
  schema: S,
  prompt: string,
  maxTokens: number,
  label: string,
  images: AskImage[] | undefined,
  why: string
): Promise<z.infer<S>> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    // Both providers unavailable: with no Claude key either, Claude's sentence names the fix.
    throw new ProviderError(why === 'no ANTHROPIC_API_KEY' ? NO_CLAUDE_KEY : NO_OPENROUTER_KEY, 'config')
  }
  const { fallbackModel } = textConfig()
  const body = fallbackBody(schema, prompt, maxTokens, label, images, fallbackModel)
  const started = Date.now()

  // One retry on the fallback, for a transient failure or a reply the schema refuses.
  // A 402 never retries; it will not pass on its own.
  let last = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await fallbackAttempt(schema, key, body, label)
    if (result.ok) {
      const cost = result.cost == null ? '' : ` · $${result.cost.toFixed(4)}`
      console.log(`[text] ${label} — openrouter/${fallbackModel} · ${seconds(started)}${cost}`)
      return result.value
    }
    last = result.cause
    if (!result.retry || attempt === 2) break
    console.warn(`[text] ${label} — fallback failed (${result.cause.slice(0, 120)}), retrying once`)
  }
  throw new ProviderError(FALLBACK_BUSY, 'provider', `openrouter/${fallbackModel}: ${last}`)
}

/** The wire body, exported for `check:llm`. */
export function fallbackBody(
  schema: z.ZodType,
  prompt: string,
  maxTokens: number,
  label: string,
  images: AskImage[] | undefined,
  model: string
) {
  const content = images?.length
    ? [
        ...images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: `data:${img.mediaType};base64,${img.bytes.toString('base64')}` },
        })),
        { type: 'text' as const, text: prompt },
      ]
    : prompt
  return {
    model,
    // Reasoning tokens count against the completion budget on this model, so
    // the fallback gets headroom above what Claude needs for the same reply.
    max_tokens: maxTokens + FALLBACK_REASONING_HEADROOM,
    reasoning: { effort: 'low' },
    messages: [{ role: 'user', content }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName(label), strict: true, schema: strictJsonSchema(schema).schema },
    },
    // Only route to endpoints that honour every parameter above — above all,
    // the strict schema. Never a silent 200 of the wrong shape.
    provider: { require_parameters: true },
  }
}

const FALLBACK_REASONING_HEADROOM = 2048

async function fallbackAttempt<S extends z.ZodType>(
  schema: S,
  key: string,
  body: unknown,
  label: string
): Promise<Attempt<z.infer<S>>> {
  let res: Response
  try {
    res = await fetch(OPENROUTER_CHAT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    return { ok: false, retry: true, cause: `no answer (${err instanceof Error ? err.name : 'error'})` }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 402) logOutOfCredits(label)
    return { ok: false, retry: res.status === 429 || res.status >= 500, cause: `HTTP ${res.status} ${text.slice(0, 400)}` }
  }

  let json: ChatResponse
  try {
    json = (await res.json()) as ChatResponse
  } catch {
    return { ok: false, retry: true, cause: 'a reply that was not JSON' }
  }
  if (json.error) {
    const code = json.error.code ?? 0
    if (code === 402) logOutOfCredits(label)
    return { ok: false, retry: code === 429 || code >= 500, cause: `error ${code} ${json.error.message ?? ''}`.slice(0, 400) }
  }
  const message = json.choices?.[0]?.message
  if (message?.refusal) return { ok: false, retry: false, cause: `refused: ${message.refusal.slice(0, 300)}` }

  let parsed: unknown
  try {
    parsed = JSON.parse(message?.content ?? '')
  } catch {
    return { ok: false, retry: true, cause: `content was not JSON (finish_reason ${json.choices?.[0]?.finish_reason ?? '?'})` }
  }
  // The SDK validated Claude's reply; here the app does it, with the same schema.
  const checked = schema.safeParse(parsed)
  if (!checked.success) {
    return { ok: false, retry: true, cause: `reply refused by the schema: ${checked.error.message.slice(0, 300)}` }
  }
  return { ok: true, value: checked.data, cost: json.usage?.cost ?? null }
}

function logOutOfCredits(label: string) {
  console.error(
    [
      `✗ OpenRouter returned 402 — out of credits (text fallback · ${label}).`,
      '  The balance is at or below $1, which is where OpenRouter stops serving.',
      '  Top up at https://openrouter.ai/settings/credits and try again.',
    ].join('\n')
  )
}

// --- Strict JSON schema -----------------------------------------------------
//
// Strict structured outputs accept a subset of JSON Schema: every object closed
// (`additionalProperties: false`), every property required, and no length or
// range keywords. `z.toJSONSchema` already closes objects and lists required
// properties; the length and range keywords are lowered here — dropped from
// the wire, still enforced by the zod schema the reply is validated against,
// exactly as the Anthropic SDK lowers them for Claude. An optional property
// cannot be expressed at all: write it `.nullable()` instead, and this throws
// naming it rather than sending a schema the endpoint would refuse.

const LOWERED = [
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
] as const

type JsonSchema = { [key: string]: unknown }

export function strictJsonSchema(schema: z.ZodType): { schema: JsonSchema; lowered: string[] } {
  const raw = z.toJSONSchema(schema) as JsonSchema
  delete raw.$schema
  const lowered: string[] = []
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
    if (!node || typeof node !== 'object') return
    const obj = node as JsonSchema
    for (const k of LOWERED) {
      if (k in obj) {
        lowered.push(`${path || '(root)'}.${k}`)
        delete obj[k]
      }
    }
    if (obj.type === 'object') {
      const props = Object.keys((obj.properties as JsonSchema | undefined) ?? {})
      const required = new Set((obj.required as string[] | undefined) ?? [])
      const optional = props.filter((p) => !required.has(p))
      if (optional.length) {
        throw new Error(`strict schema: ${path || '(root)'} has optional ${optional.join(', ')} — make it .nullable() instead`)
      }
      obj.additionalProperties = false
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'properties' && v && typeof v === 'object') {
        for (const [name, child] of Object.entries(v as JsonSchema)) walk(child, `${path}.${name}`)
      } else if (typeof v === 'object') {
        walk(v, `${path}.${k}`)
      }
    }
  }
  walk(raw, '')
  return { schema: raw, lowered }
}

/** `json_schema.name` allows letters, digits, `_` and `-`, up to 64. */
function schemaName(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64) || 'reply'
}

function seconds(started: number): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`
}
