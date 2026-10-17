// The small kit every OpenRouter surface beyond pictures shares (v3, slice 22):
// the key, the one POST with its sparing retry, and the translation of a failed
// answer into a `ProviderError`. Seedance (`lib/video/seedance.ts`), the voices
// (`lib/audio/tts.ts`) and the music (`lib/audio/music.ts`) all stand on it, so
// a 402, a refusal and a timeout mean the same thing on each of them as they do
// for a picture (`lib/image-provider.ts`, whose retry pause is reused).
//
// Server only: it reads the key. The key is read at call time, sent only as the
// bearer header, and never put in a log line, an error message or a cause. The
// terminal gets the cause (trimmed); the browser gets the sentence the caller
// names. See `devpost/spec.md > Failure Modes (v3)`.
import 'server-only'
import { ProviderError } from './errors'
import { retryDelayMs } from './image-provider'

export const API_BASE = 'https://openrouter.ai/api/v1'

/**
 * The key, or a `config` error: a missing key is the developer's to fix, so it
 * says so on a development desk (`configSentence` hides the words in production).
 */
export function openRouterKey(what: string): string {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    throw new ProviderError(`The studio isn’t connected to the ${what} yet. Add OPENROUTER_API_KEY to .env and restart the dev server.`, 'config')
  }
  return key
}

/** The provider's message on one line and short enough to read (a port of `video/openrouter.ts > providerMessage`). Terminal only. */
export async function providerText(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  let message = body
  try {
    const j = JSON.parse(body) as { error?: { message?: string; metadata?: { raw?: unknown } } }
    message = j.error?.message ?? body
    const raw = j.error?.metadata?.raw
    if (typeof raw === 'string' && raw && !message.includes(raw)) message = `${message} (${raw})`
  } catch {
    // Not JSON: the text itself is the best summary there is.
  }
  message = message.replace(/\s+/g, ' ').trim()
  return message.length > 240 ? `${message.slice(0, 237)}...` : message || 'no reason given'
}

/**
 * Does a provider's reason read as a content decision — the picture, the words
 * or a real person's likeness turned down — rather than a hiccup? A refusal is a
 * wording problem and points the person at the panel; anything else is "busy".
 */
export const looksRefused = (text: string): boolean =>
  /moderation|safety|content[_ ]polic|policy|refus|not allowed|prohibit|inappropriate|sensitive|guideline|violat|nsfw|\bfaces?\b|likeness|real (?:person|people)|celebrit|public figure|\bminors?\b|copyright/i.test(text)

/** Error codes that say the request was still being sent (or never left): safe to send again. */
const SENT_SIGNALS = new Set(['ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'EPIPE'])

const causeCode = (err: unknown): string => {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause
  return typeof cause?.code === 'string' ? cause.code : ''
}

/**
 * A fetch that rejected: could the server have already acted on it? A timeout
 * or a connection dropped mid-flight might have — a paid POST is not repeated
 * after one. A refused or unresolvable connection never arrived, and is.
 */
function neverArrived(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return false
  return !SENT_SIGNALS.has(causeCode(err))
}

const describe = (err: unknown): string => {
  const name = err instanceof Error ? err.name : 'error'
  const code = causeCode(err)
  return `${name}${code ? ` ${code}` : ''}`
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type PostOptions = {
  url: string
  key: string
  /** The JSON, already stringified. */
  body: string
  timeoutMs: number
  /** For the terminal log only, e.g. "shot 2". */
  label: string
  /** The calm sentence when nothing came back. */
  busy: string
  /** Total attempts, first included. Default 3. */
  maxAttempts?: number
}

/**
 * One JSON POST, sent again only on a 429 or on a connection that never
 * arrived — and only BEFORE any answer comes back. A 2xx, a 4xx or a 5xx is
 * returned to the caller untouched and never repeated here: a POST that was
 * answered may already have been paid for. A timeout is not retried either.
 */
export async function postJson(o: PostOptions): Promise<Response> {
  const attempts = o.maxAttempts ?? 3
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await fetch(o.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.key}`, 'Content-Type': 'application/json' },
        body: o.body,
        signal: AbortSignal.timeout(o.timeoutMs),
      })
    } catch (err) {
      if (attempt < attempts && neverArrived(err)) {
        console.warn(`[openrouter] ${o.label} — didn’t connect (${describe(err)}), trying again`)
        await pause(retryDelayMs(null))
        continue
      }
      throw new ProviderError(o.busy, 'provider', describe(err))
    }
    if (res.status === 429 && attempt < attempts) {
      const waitMs = retryDelayMs(res.headers.get('retry-after'))
      console.warn(`[openrouter] ${o.label} — rate-limited (429), trying again in ${(waitMs / 1000).toFixed(1)}s`)
      await res.body?.cancel().catch(() => undefined)
      await pause(waitMs)
      continue
    }
    return res
  }
}

export type FailureOptions = {
  label: string
  /** The calm sentence for "it didn't work" — also what a 402 shows (the breaker explains the rest in the log). */
  busy: string
  /** The sentence for a refusal; absent means this surface has none and a 400 is just busy. */
  refused?: string
  /** What the key is for, in the 401 sentence: "video model". */
  what: string
}

/**
 * A non-2xx answer as a `ProviderError`. 401 is a `config` problem; 402 is
 * `credits` (the account is out, so the queue's breaker trips on it); a 400 or
 * 422 that reads as a content decision is `refused`; the rest is `provider`.
 * The raw text goes in the cause, for the terminal.
 */
export async function failureOf(res: Response, o: FailureOptions): Promise<ProviderError> {
  const text = await providerText(res)
  if (res.status === 401) {
    return new ProviderError(`The ${o.what} refused the studio’s key. Check OPENROUTER_API_KEY and restart the dev server.`, 'config', `401 ${text.slice(0, 200)}`)
  }
  if (res.status === 402) {
    console.error(`✗ OpenRouter returned 402 — out of credits (${o.label}). Top up at https://openrouter.ai/settings/credits and try again.`)
    return new ProviderError(o.busy, 'provider', `402 ${text.slice(0, 300)}`, 'credits')
  }
  if (o.refused && (res.status === 400 || res.status === 422) && looksRefused(text)) {
    return new ProviderError(o.refused, 'refused', `${res.status} ${text.slice(0, 400)}`)
  }
  return new ProviderError(o.busy, 'provider', `HTTP ${res.status} ${text.slice(0, 400)}`)
}

/** An https URL on OpenRouter's own host, or null. The bearer key is only ever sent to one of these. */
export function openRouterUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) ? url : null
  } catch {
    return null
  }
}
