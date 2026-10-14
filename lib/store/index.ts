// The storage seam (v2). One interface, chosen by `INKDESK_STORAGE`:
//   • `local` (default) — files under `data/`, the way v1 worked. A clone runs
//     with nothing but the two API keys.
//   • `cloud` — MongoDB for project state and two S3-compatible buckets
//     (slice 13, `cloud.ts`; two buckets since v3): project files — images and
//     uploads — and outputs. The learner's variable names are mapped in
//     `lib/config.ts`. Loaded on first use, so a local desk
//     never loads either driver. Started without its settings, every call is
//     refused with the sentence naming the missing variables — never a quiet
//     fall back to the local desk. `instrumentation.ts` refuses the same thing
//     once, at server start.
// See `devpost/spec.md > Storage Adapter (v2)`.
//
// The mode is read once, at module load, like `INKDESK_DATA_DIR`: the checks
// set the environment before their first dynamic import.
//
// Server only (SEC-15): importing this from a client component is a build
// error. The checks run under tsx, where `scripts/server-only.mts` resolves the
// package the way Next's server does.
import 'server-only'
import { ProviderError } from '../errors'
import { missingCloudEnv, missingCloudSentence, storageMode } from './env'
import { localStore } from './local'
import type { Project, ProjectSummary } from '../types'

export type BlobKind = 'sheet' | 'panel' | 'cover' | 'asset'

/** One stored image, ready to stream: never held whole in memory (CR-17). */
export type BlobStream = { body: ReadableStream<Uint8Array>; bytes: number | null; mediaType: string }

/** What `/api/health` reports for each outside system: `n/a` where the mode doesn't use it. */
export type Check = 'ok' | 'down' | 'n/a'
export type StoreHealth = { mongo: Check; bucket: Check }

export interface Store {
  /** Every project on the desk, newest first. Runs the one-time v1 migration. */
  listProjects(): Promise<ProjectSummary[]>
  /** The one-time v1 migration on its own: the project it made, or the
   *  sentence that says why the v1 file was left alone. Nulls when there is
   *  nothing to migrate. */
  migrateLegacy(): Promise<{ projectId: string | null; problem: string | null }>
  readProject(id: string): Promise<Project>
  /** Refuses if the id exists. */
  createProject(project: Project): Promise<void>
  /** Read → `fn` → write, serialized per project, atomic on disk. */
  updateProject(id: string, fn: (project: Project) => Project): Promise<Project>
  /** Store one image; returns its id, `<kind>-<uuid>.<ext>`, extension from the media type. */
  putBlob(bytes: Buffer, mediaType: string, kind: BlobKind): Promise<string>
  getBlob(id: string): Promise<{ bytes: Buffer; mediaType: string } | null>
  /** The same image as a stream, for the image route; null if there is no such image. */
  openBlob(id: string): Promise<BlobStream | null>
  /** Is everything this mode needs reachable, each answer within `timeoutMs`? Never throws. */
  health(timeoutMs: number): Promise<StoreHealth>
}

function refusing(sentence: string): Store {
  const refuse = () => Promise.reject(new ProviderError(sentence, 'config'))
  return {
    listProjects: refuse,
    migrateLegacy: refuse,
    readProject: refuse,
    createProject: refuse,
    updateProject: refuse,
    putBlob: refuse,
    getBlob: refuse,
    openBlob: refuse,
    health: async () => ({ mongo: 'down', bucket: 'down' }),
  }
}

/** The cloud store behind a dynamic import: `mongodb` and the S3 client load on the first call. */
function lazyCloud(): Store {
  const load = () => import('./cloud').then((m) => m.cloudStore)
  return {
    listProjects: async () => (await load()).listProjects(),
    migrateLegacy: async () => (await load()).migrateLegacy(),
    readProject: async (id) => (await load()).readProject(id),
    createProject: async (project) => (await load()).createProject(project),
    updateProject: async (id, fn) => (await load()).updateProject(id, fn),
    putBlob: async (bytes, mediaType, kind) => (await load()).putBlob(bytes, mediaType, kind),
    getBlob: async (id) => (await load()).getBlob(id),
    openBlob: async (id) => (await load()).openBlob(id),
    health: async (timeoutMs) => (await load()).health(timeoutMs),
  }
}

function choose(): Store {
  if (storageMode() === 'local') return localStore
  const missing = missingCloudEnv()
  return missing.length > 0 ? refusing(missingCloudSentence(missing)) : lazyCloud()
}

export const store: Store = choose()
