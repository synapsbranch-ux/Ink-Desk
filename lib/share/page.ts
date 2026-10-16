// What the public page, its preview image and its metadata share (v3, slice 21):
// the client-address window for a page view, and the one origin links are built
// on. Server only. `headers()` is how a page sees the request; the windows want
// a `Request`, so one is made from the same headers — only the headers are used.
import 'server-only'
import { headers } from 'next/headers'
import { appOrigin } from '../auth/config'
import { Refused } from '../errors'
import { limitByAddress } from '../limits/requests'
import type { RateBucket } from '../limits/rules'

/**
 * Take the caller's address window for a page view. Returns the `Refused` (429
 * with the calm rate sentence, or 503 when the counter store is down and the
 * bucket fails closed) for the page to show; anything else is a real failure and
 * throws.
 */
export async function takeWindow(bucket: RateBucket): Promise<Refused | null> {
  try {
    await limitByAddress(new Request('http://share.invalid/', { headers: await headers() }), bucket)
    return null
  } catch (err) {
    if (err instanceof Refused && (err.status === 429 || err.status === 503)) return err
    throw err
  }
}

/** A host a link may be built on: letters, digits, dots, hyphens and a port. Nothing the caller could use to put markup into a meta tag. */
const HOST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/

/** The origin for absolute URLs in metadata: APP_URL, else the host this request came to, else localhost. */
export async function metadataOrigin(): Promise<string> {
  const configured = appOrigin()
  if (configured) return configured
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') === 'https' ? 'https' : 'http'
  return host && HOST.test(host) ? `${proto}://${host}` : 'http://localhost:3000'
}
