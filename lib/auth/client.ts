'use client'

// The browser's way to Better Auth (the Better Auth revision): the same origin,
// `/api/auth` — the studio's own route (`app/api/auth/[...all]/route.ts`). Used
// by the sign-in form, the account menu's Sign out and Settings ›
// Account. Holds no secret.
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()

/** Better Auth's error codes, said the studio's way. Anything not listed gets the server's own message, or the fallback. */
const SENTENCES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password don’t match an account.',
  PASSWORD_TOO_SHORT: 'That password is too short — use at least 10 characters.',
  PASSWORD_TOO_LONG: 'That password is too long — use at most 128 characters.',
  INVALID_EMAIL: 'That doesn’t look like an email address.',
  INVALID_PASSWORD: 'That current password isn’t right.',
}

/** One calm sentence for a failed call. */
export function authSentence(
  error: { code?: string | null; message?: string | null; status?: number; error?: unknown } | null | undefined,
  fallback: string
): string {
  if (!error) return fallback
  // The studio's own refusals (the sign-in windows, a body too large) answer `{ error: sentence }`.
  if (typeof error.error === 'string' && error.error) return error.error
  if (error.status === 429) return error.message || 'You’re going a little fast — try again in a minute.'
  if (error.code && SENTENCES[error.code]) return SENTENCES[error.code]
  return error.message || fallback
}
