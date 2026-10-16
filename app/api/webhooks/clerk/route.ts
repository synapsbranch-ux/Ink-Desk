// Clerk's webhook (slice 19): the moment an account is made, changed or
// deleted, Clerk tells the studio, and the studio's own `users` record follows
// (`devpost/prd.md > Accounts and Sign-in (v3)`: "a new account exists in the
// app's own records the moment it is created").
//
// Public — it carries no session — so it proves itself instead: `verifyWebhook`
// (`@clerk/nextjs/webhooks`, Standard Webhooks, signed with
// CLERK_WEBHOOK_SIGNING_SECRET) checks the signature and refuses a timestamp
// more than five minutes off, so an old message cannot be replayed. A message
// delivered twice (Clerk retries) is recognised by its id and answered without
// a second write. A failure says 400 and nothing more: the body is never
// echoed, and the cause stays in the terminal.
//
// `user.deleted` marks the account deleted and starts the account-deletion job
// (slice 21, `lib/account/deletion.ts`) that removes its work. The job's dedupe
// key is the person (`delete-account:<id>`), so a replayed event, Clerk's own retry
// and the deletion the studio itself started from Settings all find the one job
// and start no second. If the job cannot be queued the event answers 503 and
// Clerk tries again later — like any other store failure — rather than leaving an
// account marked deleted whose work stays.
import type { UserJSON } from '@clerk/nextjs/server'
import { verifyWebhook, type WebhookEvent } from '@clerk/nextjs/webhooks'
import { NextRequest } from 'next/server'
import { readBytes } from '@/lib/body'
import { queueSettings } from '@/lib/config'
import { Refused } from '@/lib/errors'
import { enqueueAccountJob } from '@/lib/queue/enqueue'
import { store } from '@/lib/store'

export const runtime = 'nodejs'

/** Clerk's user events are a few kilobytes; anything near this is not one. */
const WEBHOOK_LIMIT_BYTES = 256 * 1024

/**
 * How long a message id is remembered. The signature check already refuses a
 * timestamp older than five minutes, so a replay outside this window is
 * refused there; within it, the id catches it.
 */
const SEEN_MS = 10 * 60 * 1000

const UNVERIFIED = 'That webhook couldn’t be verified.'

// --- Seen message ids -----------------------------------------------------------
//
// Shared through Redis when the studio has one (several web instances), else
// remembered in this process. Either way a duplicate that slips past is
// harmless: the store's upsert writes nothing for a record that has not
// changed, and a deleted account stays deleted.

const seenHere = new Map<string, number>()

function claimHere(id: string, now = Date.now()): boolean {
  for (const [key, until] of seenHere) if (until <= now) seenHere.delete(key)
  if (seenHere.has(id)) return false
  seenHere.set(id, now + SEEN_MS)
  return true
}

async function redisOrNull() {
  try {
    const queue = queueSettings()
    if (queue.mode !== 'bullmq' || !queue.redisUrl) return null
    const { producerRedis, redisKey, within } = await import('@/lib/queue/redis')
    return { redis: producerRedis(), key: (id: string) => redisKey('webhook', 'clerk', id), within }
  } catch {
    return null
  }
}

/** True when this message id is new (and now claimed); false when it was already handled. */
async function claim(id: string): Promise<boolean> {
  const shared = await redisOrNull()
  if (shared) {
    try {
      const set = await shared.within(shared.redis.set(shared.key(id), '1', 'PX', SEEN_MS, 'NX'))
      return set === 'OK'
    } catch (err) {
      console.warn('[webhook] Redis did not answer; remembering the message here:', err instanceof Error ? err.message : err)
    }
  }
  return claimHere(id)
}

/** Let a message go again, so Clerk's retry is handled after a failure. */
async function release(id: string): Promise<void> {
  seenHere.delete(id)
  const shared = await redisOrNull()
  if (!shared) return
  try {
    await shared.within(shared.redis.del(shared.key(id)))
  } catch {
    // The claim expires on its own.
  }
}

// --- The events -----------------------------------------------------------------

/**
 * The account's primary email, else its first, else none (a phone-only account) — counting only an address Clerk
 * does not say is unverified. The studio's allowlist is matched against this address, so an address a stranger merely
 * typed in must never be taken for the person it names; a payload that says nothing about verification is taken as it is.
 */
function emailOf(user: UserJSON): string {
  const addresses = (user.email_addresses ?? []).filter((a) => !a.verification?.status || a.verification.status === 'verified')
  const primary = addresses.find((a) => a.id === user.primary_email_address_id) ?? addresses[0]
  return primary?.email_address ?? ''
}

async function apply(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case 'user.created':
    case 'user.updated': {
      const user = event.data
      const createdAt = Number.isFinite(user.created_at) ? new Date(user.created_at).toISOString() : new Date().toISOString()
      await store.users.upsert({ id: user.id, email: emailOf(user), createdAt })
      return
    }
    case 'user.deleted': {
      const id = event.data.id
      if (!id) return
      await store.users.markDeleted(id)
      // The record is the tombstone; the job removes everything else. Asking again while it runs returns that job.
      await enqueueAccountJob({ ownerId: id, kind: 'delete-account' })
      return
    }
    default:
      // Other events are not subscribed to; one that arrives anyway is acknowledged and ignored.
      return
  }
}

export async function POST(req: Request) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    console.error('[webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set; Clerk’s events cannot be verified')
    return Response.json({ error: 'Webhooks aren’t set up on this studio.' }, { status: 503 })
  }

  // Read with a cap before anything parses it, then hand the verifier the same bytes.
  let body: string
  try {
    body = new TextDecoder().decode(await readBytes(req, WEBHOOK_LIMIT_BYTES))
  } catch (err) {
    const status = err instanceof Refused ? err.status : 400
    return Response.json({ error: UNVERIFIED }, { status })
  }

  let event: WebhookEvent
  try {
    // Only the signature's headers travel on: the original length and encoding headers describe a body already read.
    const headers = new Headers()
    for (const name of ['svix-id', 'svix-timestamp', 'svix-signature']) {
      const value = req.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    event = await verifyWebhook(new NextRequest(req.url, { method: 'POST', headers, body }))
  } catch (err) {
    console.warn('[webhook] refused:', err instanceof Error ? err.message : 'unverifiable')
    return Response.json({ error: UNVERIFIED }, { status: 400 })
  }

  // Verified, so the id header is present and part of what was signed.
  const messageId = (req.headers.get('svix-id') ?? '').trim()
  if (!(await claim(messageId))) return Response.json({ received: true, duplicate: true })

  try {
    await apply(event)
  } catch (err) {
    await release(messageId)
    if (err instanceof Refused && err.status < 500) {
      // An id the store will never accept: retrying cannot help.
      console.warn(`[webhook] ${event.type} not applied: ${err.message}`)
      return Response.json({ error: 'That event couldn’t be applied.' }, { status: 400 })
    }
    console.error(`[webhook] ${event.type} not applied; Clerk will retry:`, err instanceof Error ? err.message : err)
    return Response.json({ error: 'The studio couldn’t record that just now.' }, { status: 503 })
  }
  return Response.json({ received: true })
}
