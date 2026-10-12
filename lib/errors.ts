// The two error shapes route handlers translate into responses, and the one
// place that translation lives. The rule from `devpost/prd.md > Look and
// Feel`: no raw error codes on screen, ever. The terminal gets the cause;
// the browser gets a sentence.
//
// No Node imports here on purpose — `lib/cast.ts` throws `Refused` and is
// shared with the browser.

/**
 * A provider problem with a sentence the browser may show.
 *   config   — a missing key. Worth a specific sentence, because the fix is local.
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
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** A request the chapter's state does not allow: a locked card, a closed station. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message)
    this.name = 'Refused'
  }
}

/**
 * One translation for every route. `calm` is this surface's sentence for an
 * ordinary provider failure — "The sheet didn't come back, the studio is
 * busy." A config error or a refusal carries its own sentence instead.
 */
export function errorResponse(err: unknown, scope: string, calm: string): Response {
  if (err instanceof Refused) {
    return Response.json({ error: err.message }, { status: err.status })
  }
  if (err instanceof ProviderError) {
    console.error(`[${scope}] ${err.message}`, err.cause ?? '')
    return Response.json({ error: err.kind === 'provider' ? calm : err.message }, { status: 502 })
  }
  console.error(`[${scope}] unexpected failure:`, err)
  return Response.json({ error: calm }, { status: 500 })
}
