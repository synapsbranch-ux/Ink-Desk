// Which store this process runs on, and what cloud mode needs before it may
// start. Read by `lib/store/index.ts`, by `instrumentation.ts` (through
// `lib/config.ts`) and by `check:store`, so the refusal names the same
// variables everywhere. The names and their mapping live in `lib/config.ts`:
// each setting is named by every name it accepts — `MONGODB_URI (or DB_URL)` —
// never by its value. See `devpost/spec.md > Store v3 — Mongo and the Buckets (v3)`.
//
// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { CLOUD_REQUIRED, NAMES, missingCloud, nameOf, type StorageMode } from '../config'

export type { StorageMode }

/** Every setting cloud mode needs, as the sentences name it. */
export const CLOUD_ENV: readonly string[] = CLOUD_REQUIRED.map((key) => nameOf(NAMES[key]))

/** `INKDESK_STORAGE`, unset meaning local. Anything else is a typo, refused by name. */
export function storageMode(env: Record<string, string | undefined> = process.env): StorageMode {
  const mode = (env.INKDESK_STORAGE ?? '').trim() || 'local'
  if (mode === 'local' || mode === 'cloud') return mode
  throw new Error(`INKDESK_STORAGE is "${mode}"; this build knows "local" (the default) and "cloud".`)
}

/** The cloud settings that are missing or blank, in `CLOUD_ENV` order. */
export function missingCloudEnv(env: Record<string, string | undefined> = process.env): string[] {
  return missingCloud(env)
}

/** The one sentence for cloud mode started without its settings. */
export function missingCloudSentence(missing: readonly string[]): string {
  return `Cloud storage is switched on (INKDESK_STORAGE=cloud) but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. Add ${missing.length === 1 ? 'it' : 'them'} to .env, or set INKDESK_STORAGE=local, and restart the dev server.`
}
