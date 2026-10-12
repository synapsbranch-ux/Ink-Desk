// Process-level state that has to be genuinely single. Next.js re-evaluates
// module scope on every hot reload, and each route handler gets its own
// bundle, so a plain module-level `let` would quietly become several copies —
// a second lock brings the lost-update bug straight back. `globalThis`
// survives both. See `devpost/spec.md > Components > Singletons and the Dev
// Server`. The panel queue joins this object in slice 5.
import { randomUUID } from 'node:crypto'

type InkDeskGlobals = {
  /** Stamped once per real process; changes on restart, not on hot reload. */
  serverRunId: string
  /** The tail of the chapter store's update chain. Reassigned by `update()`. */
  chapterLock: Promise<unknown>
}

const g = globalThis as typeof globalThis & { __inkdesk?: InkDeskGlobals }

export const singletons: InkDeskGlobals = (g.__inkdesk ??= {
  serverRunId: randomUUID(),
  chapterLock: Promise.resolve(),
})
