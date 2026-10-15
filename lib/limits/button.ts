// What a button that spends says when it cannot (v3, slice 20) — the browser's
// half of the limits: PURE, no Node imports, no store, so the same sentences
// are shared by every screen and a check can run them.
//
// The one rule from `view.ts` holds here too: the screens never recompute a
// limit. `spendBlock` reads the server's `UsageView` — `paused`, `blocked` and
// the four meters the server itself counts — and answers "may this button be
// pressed, and if not, why". A request the server refuses anyway (two tabs, a
// race) comes back as a `RefusalBody`; `refusalSentence` turns it into the one
// calm sentence the card shows, and the usage is read again.
// See `devpost/prd.md > Limits and Usage (v3)` (disabled buttons give the
// reason and the reset time) and `devpost/spec.md > Limits, Quotas and the
// Kill Switch (v3)`.
import type { Chapter } from '@/lib/types'
import { PANELS_PER_PAGE } from '@/lib/cost'
import { type Meter, type RefusalBody, type SpendKind, type UsageView } from './view'

// --- What an action takes --------------------------------------------------------

/**
 * What pressing a button would spend. `images` is how many pictures the
 * action draws (a sheet, a panel, a cover, a page's blank panels); `project`
 * starts a project. `text` is a paid text call that no daily quota counts —
 * a paused studio still refuses it, so any need at all (even `{}`) is
 * "spending" for the pause.
 */
export type Need = {
  images?: number
  project?: boolean
  videoSeconds?: number
  audioChars?: number
  text?: boolean
}

/** Why a button is shut. `rate` is a short wait after a "too many requests" reply. */
export type BlockCause = SpendKind | 'all' | 'rate'

export type SpendBlock = {
  blocked: boolean
  /** One calm sentence with the reset time, for under the button and for its title; null when the button may be pressed. */
  reason: string | null
  /** The same in a few words, for a tight place (a panel's bar, a card's caption); null when not blocked. */
  short: string | null
  cause: BlockCause | null
}

export const NOT_BLOCKED: SpendBlock = { blocked: false, reason: null, short: null, cause: null }

// --- The window event the usage store listens to ---------------------------------

/** Dispatched on `window` after any request that spends (and after a job ends): the usage is read again. */
export const USAGE_CHANGED_EVENT = 'inkdesk:usage-changed'

/** The event's `detail`: the request that caused it, and — for a refused one — what the server said. */
export type UsageChange = { url?: string; status?: number; refusal?: Pick<RefusalBody, 'code' | 'retryAfterSec' | 'resetsAt'> }

/**
 * Is this request one that can spend? Reserved on the server before it starts,
 * so the meter has moved by the time it answers. Edits (`POST /api/projects/<id>`),
 * reads and uploads are not: they would make the meter poll on every keystroke.
 */
const SPENDING_PATH =
  /^\/api\/projects(?:\/[^/]+\/(?:synopsis|cast(?:\/reroll)?|sheet|import|plan|cover|pages\/(?:\d+|all)\/(?:start|script)|pages\/\d+\/panels\/\d+(?:\/rewrite)?))?$/

export function isSpendingRequest(method: string | undefined, pathname: string): boolean {
  return (method ?? 'GET').toUpperCase() === 'POST' && SPENDING_PATH.test(pathname)
}

// --- The sentences ---------------------------------------------------------------

/**
 * The reset time as a clock reading on the UTC clock ("00:00 UTC"); '' when there is none. UTC, not the
 * viewer's zone, so a screen's own words say the same thing as the server's sentences ("It resets at 00:00 UTC,
 * in about 3 hours."): one meter, one clock. The instant itself is in `resetsAt` for anyone who wants it local.
 */
export function clockOf(resetsAt: string | null | undefined): string {
  if (!resetsAt) return ''
  const at = new Date(resetsAt)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`
}

/** " It resets at 00:00 UTC, in about 3 hours." — the server's wording for a reset, for a screen's own sentence; '' when there is no reset. */
export function resetClause(resetsAt: string | null | undefined, now: Date = new Date()): string {
  const clock = clockOf(resetsAt)
  if (!clock) return ''
  const hours = Math.max(1, Math.round((new Date(resetsAt as string).getTime() - now.getTime()) / 3_600_000))
  return ` It resets at ${clock}, in about ${hours} hour${hours === 1 ? '' : 's'}.`
}

/** Does the sentence already say when the limit lifts? The server's own do ("It resets at 00:00 UTC…", "It will open again at …"). */
export function mentionsReset(sentence: string): boolean {
  return /\breset|open again|\bUTC\b/i.test(sentence)
}

/** `sentence` with the reset time after it, unless it already says when it resets. */
export function withReset(sentence: string, resetsAt: string | null | undefined, now: Date = new Date()): string {
  if (!resetsAt || mentionsReset(sentence)) return sentence
  return `${sentence}${resetClause(resetsAt, now)}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function wants(need: Need, kind: SpendKind): boolean {
  switch (kind) {
    case 'image':
      return (need.images ?? 0) > 0
    case 'project':
      return need.project === true
    case 'videoSeconds':
      return (need.videoSeconds ?? 0) > 0
    case 'audioChars':
      return (need.audioChars ?? 0) > 0
  }
}

/** The few words for a shut quota — or, by `code`, for the person's own dollar limit, or the counters being away. */
function shortFor(kind: BlockCause, resetsAt: string | null | undefined, code?: NonNullable<UsageView['blocked']>['code']): string {
  const until = clockOf(resetsAt)
  const tail = until ? ` until ${until}` : ' for today'
  if (code === 'busy') return 'Busy, try again soon'
  if (code === 'spend') return `Spending limit reached${tail}`
  switch (kind) {
    case 'all':
      return 'Paused for everyone'
    case 'rate':
      return 'Too many requests'
    case 'image':
      return `Out of images${tail}`
    case 'project':
      return `No new project${tail}`
    case 'videoSeconds':
      return `Out of video${tail}`
    case 'audioChars':
      return `Out of voice${tail}`
  }
}

/** The sentence for a quota the person has used up (or does not have). */
function exhausted(kind: SpendKind, m: Meter): string {
  const none = m.limit <= 0
  switch (kind) {
    case 'image':
      return none ? 'Drawing isn’t included in your plan.' : `You’ve used all ${plural(m.limit, 'image')} for today.`
    case 'project':
      return none
        ? 'Starting a project isn’t included in your plan.'
        : `You’ve started ${m.limit === 1 ? 'your one project' : `all ${m.limit.toLocaleString('en-US')} of your projects`} for today.`
    case 'videoSeconds':
      return none ? 'Video isn’t included in your plan.' : `You’ve used all ${plural(m.limit, 'second')} of video for today.`
    case 'audioChars':
      return none ? 'Voice isn’t included in your plan.' : `You’ve used all ${plural(m.limit, 'character')} of voice for today.`
  }
}

const KIND_OF: Record<SpendKind, { meter: (u: UsageView) => Meter; need: (n: Need) => number }> = {
  image: { meter: (u) => u.images, need: (n) => n.images ?? 0 },
  project: { meter: (u) => u.projects, need: (n) => (n.project ? 1 : 0) },
  videoSeconds: { meter: (u) => u.videoSeconds, need: (n) => n.videoSeconds ?? 0 },
  audioChars: { meter: (u) => u.audioChars, need: (n) => n.audioChars ?? 0 },
}

const KINDS = Object.keys(KIND_OF) as SpendKind[]

/**
 * May a button that takes `need` be pressed right now — and if not, why?
 *
 * In order: a short wait after a rate-limit reply; the studio paused for
 * everyone (the server's own message, word for word — it is the one message);
 * the server's own `blocked` when it concerns this action; then the meters,
 * for an action that takes more than is left (Generate all with 21 images to
 * draw and 8 left). With no usage yet, a failed read or limits off, nothing
 * is blocked — the server still decides, and a refusal is shown when it comes.
 */
export function spendBlock(
  usage: UsageView | null | undefined,
  need: Need,
  opts: { now?: Date; waitSec?: number } = {}
): SpendBlock {
  const now = opts.now ?? new Date()
  const wait = Math.ceil(opts.waitSec ?? 0)
  if (wait > 0) {
    return {
      blocked: true,
      reason: `That was a lot of requests at once. Try again in about ${plural(wait, 'second')}.`,
      short: `Try again in ${wait} s`,
      cause: 'rate',
    }
  }
  if (!usage || !usage.metering) return NOT_BLOCKED

  // A studio that is not open yet refuses every paid route, but starting a project costs nothing and the server takes it.
  const projectOnly = need.project === true && !need.images && !need.text && !need.videoSeconds && !need.audioChars
  const closedForOthers = usage.paused?.reason === 'closed' && projectOnly

  if (usage.paused && !closedForOthers) {
    return {
      blocked: true,
      reason: withReset(usage.paused.message, usage.paused.resetsAt, now),
      short: shortFor('all', usage.paused.resetsAt),
      cause: 'all',
    }
  }

  const blocked = closedForOthers ? null : usage.blocked
  if (blocked && (blocked.kind === 'all' || wants(need, blocked.kind))) {
    // A busy counter store clears when it answers, not at the reset: the daily reset is no way forward from it.
    const resets = blocked.code === 'busy' ? null : (blocked.resetsAt ?? usage.resetsAt)
    return {
      blocked: true,
      reason: withReset(blocked.message, resets, now),
      short: shortFor(blocked.kind, resets, blocked.code),
      cause: blocked.kind,
    }
  }

  for (const kind of KINDS) {
    const wanted = KIND_OF[kind].need(need)
    if (wanted <= 0) continue
    const meter = KIND_OF[kind].meter(usage)
    const left = Math.max(0, meter.limit - meter.used)
    if (wanted <= left) continue
    const sentence =
      left === 0 || meter.limit <= 0
        ? exhausted(kind, meter)
        : kind === 'image'
          ? `This takes ${plural(wanted, 'image')} and you have ${left.toLocaleString('en-US')} left today.`
          : `This takes ${wanted.toLocaleString('en-US')} and you have ${left.toLocaleString('en-US')} left today.`
    const until = clockOf(usage.resetsAt)
    return {
      blocked: true,
      reason: withReset(sentence, usage.resetsAt, now),
      short: left === 0 || meter.limit <= 0 ? shortFor(kind, usage.resetsAt) : `Needs ${wanted}, ${left} left${until ? ` until ${until}` : ''}`,
      cause: kind,
    }
  }
  return NOT_BLOCKED
}

/**
 * "Uses 4 of your 20 images today (16 left after)." — what an estimate costs against the day's allowance, for the
 * Director's estimate, a page's start button and the New-project dialog. The figure in brackets is what is left once
 * the action has drawn, and an action that does not fit in what is left says so. `lead` names the action when the
 * sentence stands beside an estimate of something else (the Director's chapter and Generate all). Empty when nothing is
 * counted (limits off, usage not read yet) or the plan draws no images.
 */
export function usesLine(usage: UsageView | null | undefined, images: number, lead = 'Uses'): string {
  if (!usage || !usage.metering || images <= 0) return ''
  const { used, limit } = usage.images
  if (limit <= 0) return ''
  if (images > limit) {
    return `That is more than the ${plural(limit, 'image')} a day your plan allows, so it takes more than one day.`
  }
  const left = Math.max(0, limit - used)
  if (images > left) return `This takes ${plural(images, 'image')} and you have ${left.toLocaleString('en-US')} left today.`
  return `${lead} ${images.toLocaleString('en-US')} of your ${limit.toLocaleString('en-US')} images today (${(left - images).toLocaleString('en-US')} left after).`
}

// --- What the Director's buttons take --------------------------------------------

/** Pictures Generate page n draws: all four for a page not written yet, else its blank panels. */
export function imagesToStartPage(chapter: Pick<Chapter, 'pages'>, pageIndex: number): number {
  const page = chapter.pages.find((p) => p.index === pageIndex)
  return !page || !page.written ? PANELS_PER_PAGE : page.blank
}

/** Pictures Generate all draws: every page not written (four each) and every blank panel on the written ones. The cover is its own button. */
export function imagesToStartAll(chapter: Pick<Chapter, 'pages'>): number {
  return chapter.pages.reduce((n, p) => n + (p.written ? p.blank : PANELS_PER_PAGE), 0)
}

// --- A refused request, as one sentence -----------------------------------------

/** A reply body that is a refusal's shape (`error` a string), else null. */
export function asRefusal(data: unknown): RefusalBody | null {
  if (!data || typeof data !== 'object') return null
  const { error, code, resetsAt, retryAfterSec } = data as Record<string, unknown>
  if (typeof error !== 'string' || error === '') return null
  return {
    error,
    code: code === 'quota' || code === 'rate' || code === 'paused' || code === 'spend' ? code : undefined,
    resetsAt: typeof resetsAt === 'string' ? resetsAt : undefined,
    retryAfterSec: typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
  }
}

/**
 * The sentence a refused spend shows on its card: the server's own, with
 * the reset time after it when a quota or the pause lifts at a known hour and
 * the sentence does not already say so, and the wait when a rate limit asks
 * for one. Nothing else is read from the body — never a code.
 */
export function refusalSentence(body: RefusalBody, now: Date = new Date()): string {
  switch (body.code) {
    case 'quota':
    case 'paused':
    case 'spend':
      return withReset(body.error, body.resetsAt, now)
    case 'rate': {
      const sec = Math.ceil(body.retryAfterSec ?? 0)
      return sec > 0 && !/\bagain\b|\bsecond|\bminute/i.test(body.error)
        ? `${body.error} Try again in about ${plural(sec, 'second')}.`
        : body.error
    }
    default:
      return body.error
  }
}
