// Process-level state that has to be genuinely single. Next.js re-evaluates
// module scope on every hot reload, and each route handler gets its own
// bundle, so a plain module-level `let` would quietly become several copies —
// a second lock brings the lost-update bug straight back, a second queue runs
// four generations instead of two. `globalThis` survives both.
// See `devpost/spec.md > Components > Singletons and the Dev Server`.
import { randomUUID } from 'node:crypto'
import { generationTimeoutMs, panelConcurrency } from './config'
import { createQueue, type Queue } from './queue'

type InkDeskGlobals = {
  /** Stamped once per real process; changes on restart, not on hot reload. */
  serverRunId: string
  /** The tail of each project's update chain, keyed by project id (v2: one
   *  lock per project, so two projects never wait on each other). Reassigned
   *  by the store's `updateProject()`. */
  locks: Map<string, Promise<unknown>>
  /** The panel queue, `PANEL_CONCURRENCY` wide, shared by every project. */
  queue: Queue
}

const g = globalThis as typeof globalThis & { __inkdesk?: InkDeskGlobals }

export const singletons: InkDeskGlobals = (g.__inkdesk ??= {
  serverRunId: randomUUID(),
  locks: new Map(),
  // Validated in `lib/config.ts` (CR-15): a blank value is the default, not 0.
  // The ceiling (CR-6) is past a job's own retried image call, so it only
  // ever frees a slot that something stuck is holding.
  queue: createQueue(panelConcurrency(), 2 * generationTimeoutMs() + 60_000),
})
