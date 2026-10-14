// The generation flag (v3, slice 16): until sign-in and limits exist, a
// public deploy must not spend. Every route that can reach a paid provider
// calls `assertGenerationEnabled()` first — before it reads the body — so a
// closed studio costs nothing and says so in one calm sentence. Plain edits,
// reads and project creation never ask. The flag itself is read in
// `lib/config.ts` (GENERATION_ENABLED; off by default in production).
import { generationEnabled } from './config'
import { Refused } from './errors'

export const GENERATION_CLOSED = 'Generation isn’t open on this studio yet.'

export function assertGenerationEnabled(): void {
  if (!generationEnabled()) throw new Refused(GENERATION_CLOSED, 503)
}
