// Process-level state that has to be genuinely single. Next.js re-evaluates
// module scope on every hot reload, and each route handler gets its own
// bundle, so a plain module-level `let` would quietly become several copies —
// a second lock brings the lost-update bug straight back, a second queue runs
// four generations instead of two. `globalThis` survives both.
// See `devpost/spec.md > Components > Singletons and the Dev Server`.
import { randomUUID } from 'node:crypto'
import { createQueue, type Queue } from './queue'

type InkDeskGlobals = {
  /** Stamped once per real process; changes on restart, not on hot reload. */
  serverRunId: string
  /** The tail of the chapter store's update chain. Reassigned by `update()`. */
  chapterLock: Promise<unknown>
  /** The panel queue, `PANEL_CONCURRENCY` wide. */
  queue: Queue
}

const g = globalThis as typeof globalThis & { __inkdesk?: InkDeskGlobals }

export const singletons: InkDeskGlobals = (g.__inkdesk ??= {
  serverRunId: randomUUID(),
  chapterLock: Promise.resolve(),
  queue: createQueue(Number(process.env.PANEL_CONCURRENCY ?? 2)),
})
