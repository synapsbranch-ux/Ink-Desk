// The panel queue. At most `concurrency` jobs run at once; the rest wait in
// arrival order, and a key that is already waiting or running is not added a
// second time — so `POST /api/panels/start` can be called again after a reload
// without doubling a generation. Each job owns its own failure handling; a
// rejection that escapes is logged, never thrown into the pump.
// See `devpost/spec.md > Components > Panel Queue (lib/queue.ts)`.
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

export function createQueue(concurrency: number): Queue {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`PANEL_CONCURRENCY must be a whole number of at least 1, got ${String(concurrency)}`)
  }

  const waiting: { key: string; job: Job }[] = []
  const active = new Set<string>()

  function pump(): void {
    while (active.size < concurrency) {
      const next = waiting.shift()
      if (!next) return
      active.add(next.key)
      Promise.resolve()
        .then(next.job)
        .catch((err: unknown) => console.error(`[queue] ${next.key} failed outside its own handler:`, err))
        .finally(() => {
          active.delete(next.key)
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
    running: () => [...active],
    waiting: () => waiting.map((w) => w.key),
  }
}
