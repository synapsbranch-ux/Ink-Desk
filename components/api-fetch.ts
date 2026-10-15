// The browser's one way to `/api/*` (slice 19). A 401 means the session has
// ended — the studio's reply to a signed-out caller — so the browser goes to
// sign-in and comes back here afterwards. Unless Clerk still holds a session:
// its token lasts 60 seconds and cannot refresh while the machine sleeps, so
// the first poll after waking is a 401 for someone still signed in. Clerk is
// asked for a fresh token (which refreshes the cookie) and the request goes
// once more before anyone is sent away (S19-REG-2). A 404 with "There is no such
// project." means the project is not (or is no longer) this person's; the
// studio hears it as an event and shows the not-found state instead of an
// empty desk. Everything else is the caller's to read, exactly as before.
//
// Slice 20: a request that can spend (`isSpendingRequest`) announces itself on
// `window` as `inkdesk:usage-changed` once it has an answer — accepted or
// refused — so the quota meter, the disabled buttons and the Usage page read
// the counters again at once. A 429 or 503 carries the server's `RefusalBody`;
// the caller still reads its own copy of the reply, and the event only
// carries the parts the usage store needs (the code and how long to wait).
import { asRefusal, isSpendingRequest, USAGE_CHANGED_EVENT, type UsageChange } from '@/lib/limits/button'

/** The routes' word for a project that is missing or someone else's (`lib/auth/access.ts`). */
export const NO_SUCH_PROJECT = 'There is no such project.'

/** Dispatched on `window` with the request's URL when a reply says the project is not there. */
export const PROJECT_GONE_EVENT = 'inkdesk:no-such-project'

let leaving = false

/** Off to sign-in, once, with the way back. Never from the sign-in pages themselves. */
function toSignIn(): void {
  if (leaving || typeof window === 'undefined') return
  const { pathname, href } = window.location
  if (pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up')) return
  leaving = true
  // A full load, not a router push: this runs outside React, and sign-in starts the session fresh.
  const to = new URL('/sign-in', window.location.origin)
  to.searchParams.set('redirect_url', href)
  window.location.assign(to)
}

/** The little of clerk-js this needs; it sets `window.Clerk` once loaded (clerk mode only). */
type ClerkOnWindow = { session?: { getToken(options?: { skipCache?: boolean }): Promise<string | null> } | null }

/** Is the Clerk session alive after all? A fresh token also rewrites the session cookie. No Clerk, no session or a failed refresh: no. */
async function refreshedSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const session = (window as unknown as { Clerk?: ClerkOnWindow }).Clerk?.session
  if (!session) return false
  try {
    return Boolean(await session.getToken({ skipCache: true }))
  } catch {
    return false
  }
}

/** `fetch` for the studio's own API: same-origin, so the session cookie rides along. */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  // A route refuses a signed-out caller before it reads the body or does anything, so asking again is safe.
  if (res.status === 401 && (await refreshedSession())) res = await fetch(url, init)
  if (res.status === 401) toSignIn()
  else if (res.status === 404 && typeof window !== 'undefined') {
    // A clone, so the caller can still read the body.
    const data = (await res.clone().json().catch(() => null)) as { error?: unknown } | null
    if (data?.error === NO_SUCH_PROJECT) window.dispatchEvent(new CustomEvent(PROJECT_GONE_EVENT, { detail: url }))
  }
  if (typeof window !== 'undefined' && res.status !== 401) await announceSpend(url, init, res)
  return res
}

/** Tell the usage store a spending request has been answered (and, if it was refused, why). */
async function announceSpend(url: string, init: RequestInit | undefined, res: Response): Promise<void> {
  let pathname: string
  try {
    pathname = new URL(url, window.location.origin).pathname
  } catch {
    return
  }
  if (!isSpendingRequest(init?.method, pathname)) return
  const detail: UsageChange = { url, status: res.status }
  if (res.status === 429 || res.status === 503) {
    const body = asRefusal(await res.clone().json().catch(() => null))
    const header = Number(res.headers.get('Retry-After'))
    const wait = Number.isFinite(header) && header > 0 ? header : undefined
    if (body || wait) detail.refusal = { code: body?.code, resetsAt: body?.resetsAt, retryAfterSec: body?.retryAfterSec ?? wait }
  }
  window.dispatchEvent(new CustomEvent<UsageChange>(USAGE_CHANGED_EVENT, { detail }))
}
