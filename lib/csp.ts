// The Content Security Policy (v3; the nonce, slice 23). One policy in two forms:
//
//   • every page, from `proxy.ts`: a fresh nonce per request, and scripts only
//     from that nonce — 'strict-dynamic' lets the scripts it allows load their
//     own (Next's chunks, Clerk's UI, Turnstile). No 'unsafe-inline' for
//     scripts. Next reads the nonce from the request's policy and puts it on
//     its own scripts; the root layout hands it to Clerk's script tag.
//   • the static header in `next.config.ts`, for every response the proxy
//     does not shape (API answers, Next's own files, `public/`): the same
//     policy with no nonce, so no inline script runs there at all.
//
// 'unsafe-eval' in development only: React's dev build uses eval for its
// error stacks; production never does. See Next's guide,
// `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`,
// and `devpost/spec.md > Security Headers and CSP (v3)`.
//
// With sign-in through Clerk (`clerkHost`), its Frontend API host serves its
// script, API calls, images and frames; img.clerk.com its avatars;
// challenges.cloudflare.com its bot protection on sign-up (Turnstile); and
// blob: workers its session refresh. In script-src those hosts only matter to
// a browser too old for 'strict-dynamic' — a current one ignores them and
// trusts the nonce. Styles keep 'unsafe-inline': React's `style` attributes
// and Clerk's components need it, and a nonce there would switch it off.
//
// Pure, with no Node or Next imports: `next.config.ts` and `proxy.ts` both use it.

export type CspOptions = {
  /** The page's nonce; none for the static header. */
  nonce?: string
  /** `next dev`: adds 'unsafe-eval'. */
  dev?: boolean
  /** Clerk's Frontend API host, in clerk mode (`clerkHostForCsp`). */
  clerkHost?: string | null
}

export function contentSecurityPolicy({ nonce, dev = false, clerkHost = null }: CspOptions = {}): string {
  const fapi = clerkHost ? ` https://${clerkHost}` : ''
  const turnstile = clerkHost ? ' https://challenges.cloudflare.com' : ''
  const scripts = nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ''
  return [
    "default-src 'self'",
    `script-src 'self'${scripts}${dev ? " 'unsafe-eval'" : ''}${fapi}${turnstile}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${fapi}${clerkHost ? ' https://img.clerk.com' : ''}`,
    "font-src 'self' data:",
    `connect-src 'self'${fapi}`,
    "media-src 'self' blob:",
    ...(clerkHost ? [`frame-src 'self'${fapi}${turnstile}`, "worker-src 'self' blob:"] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** 128 random bits, base64: unguessable, and nothing in it HTML would need escaped. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}
