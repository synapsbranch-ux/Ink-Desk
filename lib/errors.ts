// The two error shapes route handlers translate into responses, and the one
// place that translation lives. The rule from `devpost/prd.md > Look and
// Feel`: no raw error codes on screen, ever. The terminal gets the cause;
// the browser gets a sentence.
//
// No Node imports here on purpose — `lib/cast.ts` throws `Refused` and is
// shared with the browser. (`lib/auth/config.ts` imports nothing at all.)
import { isProduction } from './auth/config'

/**
 * A provider problem with a sentence the browser may show.
 *   config   — a missing key or an unreachable store. Worth a specific
 *              sentence on a development desk, because the fix is local; a
 *              production studio shows `UNAVAILABLE` instead (SEC-11).
 *   provider — anything else from Claude or OpenRouter: a 5xx, a 429, a 402,
 *              a timeout. The browser gets the calling surface's calm sentence.
 *   refused  — the image model declined the description. A wording problem,
 *              not a waiting problem, so the sentence points at the words.
 * The raw cause is logged by the route handler, never sent to the browser.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'provider' | 'refused',
    readonly cause?: unknown,
    /** A provider failure that means more than "try again": `credits` is a 402 —
     *  the account is out, so every waiting job would fail the same way. */
    readonly code?: 'credits'
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * What a refusal of a spend adds to its sentence (slice 20, `RefusalBody` in
 * `lib/limits/view.ts`): `code` says which kind — `quota` (a daily limit),
 * `rate` (too fast), `paused` (the studio's cap or breaker), `spend` (the
 * person's own dollar cap) — `resetsAt` when it lifts, `retryAfterSec` how long
 * a rate limit asks the caller to wait. The browser reads these; it never
 * parses the sentence.
 */
export type RefusalExtra = {
  code?: 'quota' | 'rate' | 'paused' | 'spend'
  resetsAt?: string
  retryAfterSec?: number
}

/** A request the chapter's state does not allow: a locked card, a closed station. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly extra: RefusalExtra = {}
  ) {
    super(message)
    this.name = 'Refused'
  }
}

/** What a production studio says when its own setup is the problem. */
export const UNAVAILABLE = 'The studio isn’t available just now. Try again in a little while.'

/**
 * The sentence a config problem may show (SEC-11). Those sentences name
 * variables and services — never values — which helps on a development desk
 * and tells a stranger how the server is built, so production says
 * `UNAVAILABLE` and the terminal keeps the specific one. Pages that catch a
 * config error show this, not `err.message`.
 */
export function configSentence(err: ProviderError): string {
  // The one rule for production (S19-SEC-1): a staging or test server is a public one too.
  return isProduction() ? UNAVAILABLE : err.message
}

/**
 * The sentence a failed JOB may carry to the browser (its record is polled by
 * anyone who can open the project): a provider problem gets the surface's calm
 * sentence, a config problem the production-safe one (SEC-11), a refusal its
 * own words. Never the cause.
 */
export function jobSentence(err: ProviderError, calm: string): string {
  return err.kind === 'provider' ? calm : err.kind === 'config' ? configSentence(err) : err.message
}

/**
 * A refusal as a response: the sentence as `error`, and — when it is a limit —
 * `code`, `resetsAt` and `retryAfterSec` beside it (the `RefusalBody` the
 * browser reads), with `Retry-After` when a rate limit says how long to wait.
 * Never cached.
 */
export function refusalResponse(err: Refused, headers: Record<string, string> = {}): Response {
  const { code, resetsAt, retryAfterSec } = err.extra
  const body = { error: err.message, ...(code ? { code } : {}), ...(resetsAt ? { resetsAt } : {}), ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) }
  const out: Record<string, string> = { ...headers }
  if (retryAfterSec !== undefined) out['Retry-After'] = String(Math.max(1, Math.ceil(retryAfterSec)))
  if (code) out['Cache-Control'] = 'no-store'
  return Response.json(body, { status: err.status, headers: out })
}

/** A short id that ties a sentence on screen to its line in the log. */
function reference(): string {
  return globalThis.crypto.randomUUID().slice(0, 8)
}

/**
 * One translation for every route. `calm` is this surface's sentence for an
 * ordinary provider failure — "The sheet didn't come back, the studio is
 * busy." A refusal carries its own sentence; a config error carries its own
 * only on a development desk. Nothing else from the cause — a model id, a
 * host, a provider's message, a path, a stack — reaches the browser: it is
 * logged here with a reference, which the response carries in a header.
 */
export function errorResponse(err: unknown, scope: string, calm: string): Response {
  if (err instanceof Refused) {
    return refusalResponse(err)
  }
  const ref = reference()
  if (err instanceof ProviderError) {
    console.error(`[${scope}] ref ${ref}: ${err.message}`, err.cause ?? '')
    const error = err.kind === 'provider' ? calm : err.kind === 'config' ? configSentence(err) : err.message
    return Response.json({ error }, { status: 502, headers: { 'X-Error-Ref': ref } })
  }
  console.error(`[${scope}] ref ${ref}: unexpected failure:`, err)
  return Response.json({ error: calm }, { status: 500, headers: { 'X-Error-Ref': ref } })
}
