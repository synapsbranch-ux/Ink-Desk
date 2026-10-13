// The storage seam (v2). One interface, chosen by `INKDESK_STORAGE`:
//   • `local` (default) — files under `data/`, the way v1 worked. A clone runs
//     with nothing but the two API keys.
//   • `cloud` — MongoDB for project state and an S3-compatible bucket for
//     images. Arrives in slice 13; until then the switch refuses by name.
// See `devpost/spec.md > Storage Adapter (v2)`.
//
// The mode is read once, at module load, like `INKDESK_DATA_DIR`: the checks
// set the environment before their first dynamic import.
import { ProviderError } from '../errors'
import { localStore } from './local'
import type { Project, ProjectSummary } from '../types'

export type BlobKind = 'sheet' | 'panel' | 'cover' | 'asset'

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
}

const MODE = process.env.INKDESK_STORAGE ?? 'local'

function notYet(): Store {
  const refuse = () =>
    Promise.reject(
      new ProviderError(
        'The studio’s cloud storage isn’t available in this build. Set INKDESK_STORAGE=local (or leave it unset) and restart the dev server.',
        'config',
        `INKDESK_STORAGE=${MODE} — the MongoDB + bucket store is slice 13`
      )
    )
  return {
    listProjects: refuse,
    migrateLegacy: refuse,
    readProject: refuse,
    createProject: refuse,
    updateProject: refuse,
    putBlob: refuse,
    getBlob: refuse,
  }
}

export const store: Store =
  MODE === 'local'
    ? localStore
    : MODE === 'cloud'
      ? notYet()
      : (() => {
          throw new Error(`INKDESK_STORAGE is "${MODE}"; this build knows "local" (default) and, from slice 13, "cloud".`)
        })()
