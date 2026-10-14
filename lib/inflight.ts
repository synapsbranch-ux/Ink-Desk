// A guard for the work that still runs inside a request (v3, slice 18):
// the Director's plan reads up to four pictures and holds tens of megabytes
// while it waits on the model (CR-18), and nothing stopped fifty of them at
// once. A guard lets one plan per project and a few across the process; the
// rest are told the studio is busy, before anything is read or paid for.
// Process-local on purpose — it only bounds this process's memory; money is
// bounded by the queue's caps and, from slice 20, the limits layer.
// Server only.
import 'server-only'
import { Refused } from './errors'
import { BUSY } from './queue/jobs'

type Pinned = { __inkdeskInflight?: Map<string, Set<string>> }
const g = globalThis as typeof globalThis & Pinned

/**
 * Take a slot for `key` in `scope` (at most `limit` keys at once, one holder
 * per key). Returns the release function — call it in `finally`. Throws
 * `Refused`: 409 with `again` when this key already holds one, 503 when the
 * scope is full.
 */
export function takeSlot(scope: string, key: string, limit: number, again: string): () => void {
  const scopes = (g.__inkdeskInflight ??= new Map())
  let held = scopes.get(scope)
  if (!held) scopes.set(scope, (held = new Set()))
  if (held.has(key)) throw new Refused(again, 409)
  if (held.size >= limit) throw new Refused(BUSY, 503)
  held.add(key)
  const slots = held
  let released = false
  return () => {
    if (released) return
    released = true
    slots.delete(key)
  }
}
