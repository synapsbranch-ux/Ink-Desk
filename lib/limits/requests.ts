// The request windows (v3, slice 20) — sliding-window rate limits, applied in
// ONE place. `requireUser(req)` already sees every API request, so it calls
// `limitRequest` and no route has to remember: the route's kind decides the
// window (`classify`), the signed-in person's id keys it, and a request over
// the line is refused 429 with a calm sentence and `Retry-After`. A route with
// no signed-in person (a share view, a report, sign-up) takes a window keyed by
// a hash of the client address (`limitByAddress`). A signed-out request to an
// API route gets its 401 and takes no window: that path touches no store and no
// provider, and a counter write per anonymous request would hand a flooder a
// way to load Redis. Server only.
//
// PUBLIC ROUTES (slice 21: `/api/s/*`, the share page's data). They never call
// `requireUser` — a stranger holding a link has no session — so `classify` never
// sees them, and the route itself takes its window FIRST, before it reads the
// store or a body: `limitByAddress(req, 'anon')` for the snapshot,
// `'anonMedia'` for a picture or a shared trailer's file (`/api/s/<token>/file/<name>`, slice 22 — a player asks one range at a time), `'report'` for the report form. The proxy still
// runs the Origin check on their writes (`/api/s/*` is NOT in
// `PUBLIC_API_PREFIXES`, which skips it), and `check:auth` walks `app/api` and
// fails a public route that takes no address window.
//
//   text     paid text calls                         10 a minute
//   image    paid image routes (a Generate all is one request; the quota counts the pictures) and, since slice 22,
//            Animate a page and a trailer's Try again (one request each; the quota counts the seconds)   6 a minute
//   upload   a picture put on the shelf              20 an hour
//   edit     every other change                      120 a minute
//   read     every other read                        240 a minute
//   media    pictures and trailer files served (a page of the reader is dozens; a player asks one range at a time)   1200 a minute
//   anon     routes with no signed-in person, per client address   60 a minute
//   anonMedia  a shared manga's pictures, per client address      600 a minute
//   report   the share page's report form, per client address     6 an hour
//
// Redis down: the windows that guard SPENDING (text, image, upload) fail
// CLOSED with the studio-busy sentence, and so does `report` — a form anyone can
// post to, with a store write behind it, must not become unlimited the moment
// the counter store is down; plain edits and reads, the signed-out `anon` window
// and the share page's pictures (`anonMedia`) fail OPEN, so a reader, and a
// shared manga that is being read, keep working
// (`devpost/spec.md > Failure Modes (v3)`).
//
// THE CLIENT ADDRESS. An address the caller can write is worthless as a key, so
// `X-Forwarded-For` is read from the RIGHT, not the left: each trusted proxy in
// front of the app appends the address of the peer it saw, so the entry
// `TRUSTED_PROXY_HOPS` from the end (default 1: Railway's edge) is the one a
// trusted hop wrote, and everything left of it is whatever the caller sent. A
// header with fewer entries than hops, an entry that is not an address, or
// TRUSTED_PROXY_HOPS=0 gives no address, and those requests share one
// "unknown" window — the safe direction, since it can only make a spoofer
// share a bucket, never escape one. `X-Real-IP` and `Forwarded` are not read by
// default: Railway documents X-Real-IP as "the client's remote IP" but does not
// document whether its edge overwrites a client-supplied one, nor how it treats
// X-Forwarded-For, so the default is the one rule that holds for any edge that
// appends. Once the learner has seen on the live domain that the edge overwrites
// X-Real-IP, CLIENT_IP_HEADER=x-real-ip switches to it. IPv6
// addresses are keyed by their /64 (one subscriber holds the whole prefix), and
// the key is an HMAC of the address, so a raw address is never written to Redis
// (the same key is the `ipHash` a report stores: never the address).
//
// For a public route the same rule has a consequence worth knowing: when no
// address can be read (TRUSTED_PROXY_HOPS=0, or an edge that does not append),
// every caller shares the one `unknown` key PER BUCKET — so, misconfigured, the
// whole world shares 6 reports an hour and 600 pictures a minute. That is the
// safe direction (it can only make strangers wait together, never escape), and
// the health of the address rule is a deploy check: open a share on the live
// domain from two networks and see them counted apart.
import 'server-only'
import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { generationEnabled, limitsSettings } from '../config'
import { Refused } from '../errors'
import { BUSY } from '../queue/jobs'
import { backend } from './backend'
import { rateSentence, type RateBucket } from './rules'

// --- Which window a request takes ---------------------------------------------------

const PROJECT = '^/api/projects/[^/]+'
const TEXT_ROUTES = [new RegExp(`${PROJECT}/(synopsis|cast|cast/reroll|plan|import)$`), new RegExp(`${PROJECT}/pages/[^/]+/script$`)]
const IMAGE_ROUTES = [
  new RegExp(`${PROJECT}/(sheet|cover)$`),
  new RegExp(`${PROJECT}/pages/[^/]+/start$`),
  new RegExp(`${PROJECT}/pages/[^/]+/panels/[^/]+$`),
]
/** Rewrite asks Claude to rephrase, then draws: it takes a window of each. */
const REWRITE = new RegExp(`${PROJECT}/pages/[^/]+/panels/[^/]+/rewrite$`)
const UPLOAD = new RegExp(`${PROJECT}/assets$`)
/**
 * The trailer's paid POSTs (slice 22), taken from the IMAGE window: Animate a page (a trailer's seconds, voices and
 * music are held for the whole plan when it is confirmed) and a trailer's Try again on one shot (`POST /api/videos/<id>`,
 * body `{action: 'retry'}`). By METHOD as well as path, because `DELETE /api/videos/<id>` shares the second one's path
 * and spends nothing: it is an edit. The estimate (`GET …/animate`) and the polls (`GET /api/videos/**`) are reads.
 */
const PAID_POSTS = [new RegExp(`${PROJECT}/pages/[^/]+/animate$`), /^\/api\/videos\/[^/]+$/]
/** The pictures and the trailer's files (`final.mp4`, `poster.jpg`, `captions.vtt`) are served from the media window: a player asks for a file again and again, one range at a time. */
const MEDIA = [/^\/api\/image\/[^/]+$/, new RegExp(`${PROJECT}/image/[^/]+$`), /^\/api\/videos\/[^/]+\/file\/[^/]+$/]

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The windows a request takes, in the order they are tried. An unknown route
 * is an edit (a change) or a read (anything safe), so a route added later is
 * limited from its first day; `check:limits` walks `app/api` and fails if a
 * route that can spend is not named here.
 */
export function classify(method: string, pathname: string): RateBucket[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (SAFE.has(method.toUpperCase())) return MEDIA.some((re) => re.test(path)) ? ['media'] : ['read']
  if (method.toUpperCase() === 'POST' && PAID_POSTS.some((re) => re.test(path))) return ['image']
  if (REWRITE.test(path)) return ['text', 'image']
  if (TEXT_ROUTES.some((re) => re.test(path))) return ['text']
  if (IMAGE_ROUTES.some((re) => re.test(path))) return ['image']
  if (UPLOAD.test(path)) return ['upload']
  return ['edit']
}

/** The windows that guard spending, and the report form (a public write): Redis down closes them. */
const FAIL_CLOSED = new Set<RateBucket>(['text', 'image', 'upload', 'report'])

// --- The client address ---------------------------------------------------------------

/** The IPv6 prefix a subscriber holds (/64), as a stable string; an IPv4-mapped address is the IPv4 one. */
function canonical(address: string): string | null {
  let ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)
  const family = isIP(ip)
  if (family === 4) return ip
  if (family !== 6) return null
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  if (mapped && isIP(mapped[1]) === 4) return mapped[1]
  // Expand "::" and keep the first four groups.
  const [head, tail] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail === undefined ? [] : tail ? tail.split(':') : []
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - left.length - right.length)).fill('0')
  const groups = [...left, ...fill, ...right].map((group) => group.replace(/^0+(?=.)/, ''))
  return groups.length === 8 ? `${groups.slice(0, 4).join(':')}::/64` : null
}

/** The client's address as the `hops`-th trusted proxy saw it, or null when it cannot be known. */
export function clientAddress(headers: Headers, hops: number, header: 'x-forwarded-for' | 'x-real-ip' = 'x-forwarded-for'): string | null {
  if (hops <= 0) return null
  // X-Real-IP is one address the edge writes (Railway documents it as "the client's remote IP"); with it, trusting the edge at all (hops > 0) is the whole decision.
  if (header === 'x-real-ip') return canonical(headers.get('x-real-ip') ?? '')
  const forwarded = headers.get('x-forwarded-for')
  if (!forwarded) return null
  const entries = forwarded.split(',').map((part) => part.trim()).filter(Boolean)
  if (entries.length < hops) return null
  return canonical(entries[entries.length - hops])
}

/** What a client's window is keyed by: an HMAC of its address (so no raw address is stored), or `unknown`. */
export function clientKey(headers: Headers, hops?: number, header?: 'x-forwarded-for' | 'x-real-ip'): string {
  const settings = limitsSettings()
  const address = clientAddress(headers, hops ?? settings.trustedProxyHops, header ?? settings.clientIpHeader)
  if (!address) return 'unknown'
  return createHmac('sha256', process.env.CLERK_SECRET_KEY || 'inkdesk-client-address').update(address).digest('base64url').slice(0, 22)
}

// --- Taking a hit ----------------------------------------------------------------------

let lastWarned = 0
function warnOnce(err: unknown, bucket: RateBucket): void {
  if (Date.now() - lastWarned < 30_000) return
  lastWarned = Date.now()
  console.warn(`[limits] the ${bucket} window could not be checked (${FAIL_CLOSED.has(bucket) ? 'refusing' : 'letting it through'}):`, err instanceof Error ? err.message : err)
}

/** Take one hit in `bucket` for `id`; throws `Refused` (429, with `Retry-After`) when the window is full. */
export async function hit(bucket: RateBucket, id: string): Promise<void> {
  const { limit, windowMs } = limitsSettings().rates[bucket]
  let result
  try {
    result = await backend().hit(bucket, id, limit, windowMs)
  } catch (err) {
    warnOnce(err, bucket)
    if (FAIL_CLOSED.has(bucket)) throw new Refused(BUSY, 503)
    return
  }
  if (!result.ok) {
    const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
    throw new Refused(rateSentence(retryAfterSec), 429, { code: 'rate', retryAfterSec })
  }
}

/**
 * The signed-in caller's windows for this request. While generation is closed the paid windows are not taken (the
 * route says so in its own words, and spends nothing), but the request is still an ordinary edit: it reads the project
 * before it answers, so it takes that window rather than none.
 */
export async function limitRequest(req: Request, userId: string): Promise<void> {
  const buckets = classify(req.method, new URL(req.url).pathname)
  const open = generationEnabled()
  const taken = open ? buckets : buckets.filter((bucket) => bucket !== 'text' && bucket !== 'image')
  for (const bucket of taken.length > 0 ? taken : (['edit'] as const)) await hit(bucket, userId)
}

/**
 * A window keyed by the client's address, for routes with no signed-in person (a share view, a report, sign-up).
 * `anon` for data, `anonMedia` for pictures, `report` for the report form; any bucket works (it is the key that
 * differs: a hash of the trusted-hop address, never the caller's own claim). Throws `Refused` — 429 with
 * `Retry-After` when the window is full, 503 when the counter store is down and the bucket fails closed.
 */
export async function limitByAddress(req: Request, bucket: RateBucket = 'anon'): Promise<void> {
  await hit(bucket, clientKey(req.headers))
}
