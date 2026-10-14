// A lock between processes, for the local desk (CR-3). The web service, the
// worker and a check script can all write the same `data/` folder now, and the
// per-project promise chain only orders writers inside ONE process. This is the
// guard across them:
//
//   • the lock is a directory made with `mkdir` — atomic on every filesystem —
//     holding `owner.json` (pid, host, a token, the time);
//   • a holder that is slow keeps the directory's mtime fresh (a heartbeat), so
//     only a holder that is gone looks old;
//   • a lock is taken over when its owner's process is gone (same host), or when
//     nothing has touched it for `LOCK_STALE_MS` — a crash must never wedge a
//     project for good;
//   • waiting is a jittered, growing pause, never a spin, for at most
//     `LOCK_WAIT_MS`, then a calm failure;
//   • it is always released in `finally`, and only if it is still ours.
//
// An in-process gate per lock path comes first, so two writers in one process
// never poll the disk against each other; nothing relies on it for
// correctness. The window left — two contenders both judging a long-dead lock
// stale in the same instant — needs a crashed holder AND a sub-millisecond tie,
// and the re-check before the takeover narrows it further; the writes it guards
// are whole-file renames either way, so the worst case is the lost update the
// lock exists to prevent, not a torn file.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { ProviderError } from '../errors'

/** How long a writer waits for a lock before giving up. */
export const LOCK_WAIT_MS = 10_000
/** A lock nobody has touched for this long is taken over. */
export const LOCK_STALE_MS = 30_000

const OWNER_FILE = 'owner.json'

export type LockOptions = {
  waitMs?: number
  staleMs?: number
  /** The sentence for a writer that waited out `waitMs`. */
  busy?: string
}

type Owner = { pid: number; host: string; token: string; at: string }

const gates = new Map<string, Promise<void>>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Growing, jittered: 5 ms, 8, 11 … capped at 100 ms, times a factor in [0.5, 1.5). */
function backoff(attempt: number): number {
  return Math.min(5 * 1.5 ** attempt, 100) * (0.5 + Math.random())
}

/** Is this process still running? Only asked about a pid on this host. */
function alive(pid: number): boolean {
  if (pid === process.pid) return true // a second copy of this module in one process (a hot reload) is still us
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH' // EPERM: it exists, it is just not ours
  }
}

async function readOwner(lockPath: string): Promise<Owner | null> {
  try {
    return JSON.parse(await readFile(join(lockPath, OWNER_FILE), 'utf8')) as Owner
  } catch {
    return null // not written yet, or gone
  }
}

/**
 * If the lock is stale, take it over and say so; true when the caller should
 * try to make the lock straight away (it was taken over, or has just vanished).
 */
async function clearIfStale(lockPath: string, staleMs: number): Promise<boolean> {
  let seen
  try {
    seen = await stat(lockPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true // released between our mkdir and now
    throw err
  }
  let why: string | null = null
  if (Date.now() - seen.mtimeMs > staleMs) why = `untouched for ${Math.round((Date.now() - seen.mtimeMs) / 1000)} s`
  else {
    const owner = await readOwner(lockPath)
    if (owner && owner.host === hostname() && !alive(owner.pid)) why = `its owner, process ${owner.pid}, is gone`
  }
  if (!why) return false
  // Still the very lock we judged? If it was released and made again while we
  // looked, it is somebody's live lock and not ours to remove.
  const again = await stat(lockPath).catch(() => null)
  if (!again) return true
  if (again.ino !== seen.ino || again.mtimeMs !== seen.mtimeMs) return false
  const graveyard = `${lockPath}.stale-${randomUUID()}`
  try {
    await rename(lockPath, graveyard) // atomic: one contender wins the takeover
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw err
  }
  await rm(graveyard, { recursive: true, force: true }).catch(() => {})
  console.warn(`[store] took over a stale lock (${why}): ${basename(lockPath)}`)
  return true
}

/** Make the lock directory, or wait for whoever holds it. Resolves to this holder's token. */
async function acquire(lockPath: string, options: Required<LockOptions>): Promise<string> {
  const token = `${process.pid}.${randomUUID()}`
  const deadline = Date.now() + options.waitMs
  await mkdir(dirname(lockPath), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(lockPath)
      const owner: Owner = { pid: process.pid, host: hostname(), token, at: new Date().toISOString() }
      try {
        await writeFile(join(lockPath, OWNER_FILE), JSON.stringify(owner))
      } catch (err) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => {}) // never leave a lock with no owner behind
        throw err
      }
      return token
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        await mkdir(dirname(lockPath), { recursive: true }) // the folder was removed under us; make it and go round again
        continue
      }
      if (code !== 'EEXIST') throw err
    }
    if (await clearIfStale(lockPath, options.staleMs)) continue
    if (Date.now() >= deadline) {
      const owner = await readOwner(lockPath)
      throw new ProviderError(
        options.busy,
        'provider',
        `${basename(lockPath)}: still held after ${options.waitMs} ms${owner ? ` by process ${owner.pid} since ${owner.at}` : ''}`
      )
    }
    await sleep(backoff(attempt))
  }
}

/** Let go of the lock — but only if it is still the one we made. */
async function release(lockPath: string, token: string): Promise<void> {
  try {
    const owner = await readOwner(lockPath)
    if (owner && owner.token !== token) return // taken over after we ran too long; it is somebody else's now
    await rm(lockPath, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[store] couldn’t release ${basename(lockPath)}:`, err instanceof Error ? err.message : err)
  }
}

/**
 * Run `fn` while holding the cross-process lock at `lockPath` (a path that
 * does not exist when nobody holds it). `fn` should be short — a read, a
 * change, a write.
 */
export function withFileLock<T>(lockPath: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const settings: Required<LockOptions> = {
    waitMs: options.waitMs ?? LOCK_WAIT_MS,
    staleMs: options.staleMs ?? LOCK_STALE_MS,
    busy: options.busy ?? 'The desk is busy with another change to this project.',
  }
  const run = async (): Promise<T> => {
    const token = await acquire(lockPath, settings)
    // A holder that is merely slow is not stale: keep the directory fresh.
    const beat = setInterval(() => {
      const now = new Date()
      utimes(lockPath, now, now).catch(() => {})
    }, Math.max(1_000, Math.floor(settings.staleMs / 3)))
    beat.unref()
    try {
      return await fn()
    } finally {
      clearInterval(beat)
      await release(lockPath, token)
    }
  }
  // The in-process gate: first come, first served, and a failure never blocks the next.
  const previous = gates.get(lockPath) ?? Promise.resolve()
  const result = previous.then(run, run)
  const tail = result.then(
    () => {},
    () => {}
  )
  gates.set(lockPath, tail)
  void tail.then(() => {
    if (gates.get(lockPath) === tail) gates.delete(lockPath)
  })
  return result
}
