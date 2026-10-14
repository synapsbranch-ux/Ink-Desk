// The panel queue. At most `concurrency` jobs run at once; the rest wait in
// arrival order, and a key that is already waiting or running is not added a
// second time — so `POST /api/panels/start` can be called again after a reload
// without doubling a generation. Each job owns its own failure handling; a
// rejection that escapes is logged, never thrown into the pump. A job still
// running past `ceilingMs` gives its slot and its key back (CR-6): whatever it
// is stuck on can hold that one job, never the queue. By then the desk's
// stale-inking floor has shown the panel as failed, so Try again works.
// This is the INLINE queue (`INKDESK_QUEUE=inline`, slice 18): the in-process
// runner for a bare dev desk and the checks. Under `bullmq` a worker service
// runs the jobs. See `devpost/spec.md > Queue and Worker (v3)`.
//
// No Node imports: the one instance is pinned to `globalThis` in
// `lib/singleton.ts`, and the acceptance check builds its own.

export type Job = () => Promise<void>

export type Queue = {
  /** Add `job` under `key`. Returns false, and does nothing, if that key is already waiting or running. */
  enqueue(key: string, job: Job): boolean
  has(key: string): boolean
  /** Keys running right now. */
  running(): string[]
  /** Keys waiting for a slot, in order. */
  waiting(): string[]
  readonly concurrency: number
}

export function createQueue(concurrency: number, ceilingMs = Infinity): Queue {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`PANEL_CONCURRENCY must be a whole number of at least 1, got ${String(concurrency)}`)
  }

  const waiting: { key: string; job: Job }[] = []
  // Each run holds a token, so a job the watchdog let go that ends later
  // never frees the slot of a newer run under the same key.
  const active = new Map<string, symbol>()

  function pump(): void {
    while (active.size < concurrency) {
      const next = waiting.shift()
      if (!next) return
      const token = Symbol(next.key)
      active.set(next.key, token)
      let timer: ReturnType<typeof setTimeout> | undefined
      const ran = Promise.resolve()
        .then(next.job)
        .catch((err: unknown) => console.error(`[queue] ${next.key} failed outside its own handler:`, err))
      const ceiling = Number.isFinite(ceilingMs)
        ? new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              console.error(`[queue] ${next.key} ran past ${ceilingMs} ms; its slot is freed`)
              resolve()
            }, ceilingMs)
          })
        : null
      void (ceiling ? Promise.race([ran, ceiling]) : ran).finally(() => {
        clearTimeout(timer)
        if (active.get(next.key) === token) active.delete(next.key)
        pump()
      })
    }
  }

  return {
    concurrency,
    enqueue(key, job) {
      if (active.has(key) || waiting.some((w) => w.key === key)) return false
      waiting.push({ key, job })
      pump()
      return true
    },
    has(key) {
      return active.has(key) || waiting.some((w) => w.key === key)
    },
    running: () => [...active.keys()],
    waiting: () => waiting.map((w) => w.key),
  }
}
