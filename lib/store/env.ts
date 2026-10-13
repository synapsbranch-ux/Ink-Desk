// Which store this process runs on, and what cloud mode needs before it may
// start. Pure — read by `lib/store/index.ts`, by `instrumentation.ts` at
// server start, and by `check:store` — so the refusal names the same
// variables everywhere. See `devpost/spec.md > Storage Adapter (v2)`.

export type StorageMode = 'local' | 'cloud'

/** Everything cloud mode needs, all server-side. */
export const CLOUD_ENV = [
  'MONGODB_URI',
  'MONGODB_DB',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const

export type CloudEnvName = (typeof CLOUD_ENV)[number]

/** `INKDESK_STORAGE`, unset meaning local. Anything else is a typo, refused by name. */
export function storageMode(env: Record<string, string | undefined> = process.env): StorageMode {
  const mode = (env.INKDESK_STORAGE ?? '').trim() || 'local'
  if (mode === 'local' || mode === 'cloud') return mode
  throw new Error(`INKDESK_STORAGE is "${mode}"; this build knows "local" (the default) and "cloud".`)
}

/** The cloud variables that are missing or blank, in `CLOUD_ENV` order. */
export function missingCloudEnv(env: Record<string, string | undefined> = process.env): CloudEnvName[] {
  return CLOUD_ENV.filter((name) => !env[name]?.trim())
}

/** The one sentence for cloud mode started without its settings. */
export function missingCloudSentence(missing: readonly string[]): string {
  return `Cloud storage is switched on (INKDESK_STORAGE=cloud) but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. Add ${missing.length === 1 ? 'it' : 'them'} to .env, or set INKDESK_STORAGE=local, and restart the dev server.`
}
