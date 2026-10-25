// Where to go after signing in (the Better Auth revision). The proxy and the
// pages send a signed-out visitor to `/sign-in?next=<where they were going>`;
// the sign-in form sends them back there. `next` is something anyone can put in
// a link, so it is only ever a path on THIS studio — never another site
// (`//evil.example`, `/\evil.example`, `https://…`) and never the sign-in or
// sign-up page. Anything else is the desk. Pure: the proxy, the pages and the
// browser all use it.

import { SIGN_IN_PATH, SIGN_UP_PATH } from './config'

/** A safe place to return to: a same-site path, else `/`. */
export function safeNext(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/'
  let url: URL
  try {
    url = new URL(value, 'http://studio.invalid')
  } catch {
    return '/'
  }
  if (url.origin !== 'http://studio.invalid') return '/'
  if (url.pathname === SIGN_IN_PATH || url.pathname === SIGN_UP_PATH || url.pathname.startsWith('/api/')) return '/'
  return `${url.pathname}${url.search}${url.hash}`
}

/** The sign-in page's address, carrying the way back. */
export function signInHref(next?: string | null): string {
  const back = safeNext(next)
  return back === '/' ? SIGN_IN_PATH : `${SIGN_IN_PATH}?next=${encodeURIComponent(back)}`
}
