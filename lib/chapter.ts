// The only code that reads or writes `data/chapter.json`.
// See `devpost/spec.md > Components > Chapter Store`.
//
// Two guarantees, for two different problems:
//   1. No torn files   — write to a temp file, then rename() over the real one.
//   2. No lost updates — every mutation goes through one `update()` that is
//      serialized on a single promise chain, so read-modify-write never
//      interleaves. With PANEL_CONCURRENCY=2 two panels can finish within
//      milliseconds of each other; without this the second write would erase
//      the first panel's result.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { singletons } from './singleton'
import { emptyChapter, type Chapter, type Pitch } from './types'

// Overridable so the acceptance check can run against a scratch folder.
export const DATA_DIR = process.env.INKDESK_DATA_DIR ?? 'data'
const CHAPTER_FILE = join(DATA_DIR, 'chapter.json')
const CHAPTER_TMP = join(DATA_DIR, 'chapter.json.tmp')

/** Read the chapter. No file yet means a fresh, first-use chapter. */
export async function read(): Promise<Chapter> {
  let raw: string
  try {
    raw = await readFile(CHAPTER_FILE, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyChapter(singletons.serverRunId)
    }
    throw err
  }
  const chapter = JSON.parse(raw) as Chapter
  if (chapter.version !== 1) {
    throw new Error(
      `${CHAPTER_FILE} is version ${String(chapter.version)}; this build reads version 1. ` +
        'Move the file aside to start a new chapter.'
    )
  }
  return chapter
}

async function writeAtomic(chapter: Chapter): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(CHAPTER_TMP, JSON.stringify(chapter, null, 2))
  await rename(CHAPTER_TMP, CHAPTER_FILE)
}

/**
 * Apply one change to the chapter and persist it.
 *
 * `fn` receives the freshest chapter and returns the next one. Callers must
 * not close over a chapter they read earlier — that reintroduces exactly the
 * stale read this lock exists to prevent. Throwing inside `fn` rejects this
 * call and leaves the file untouched; the chain itself never wedges.
 */
export function update(fn: (chapter: Chapter) => Chapter): Promise<Chapter> {
  const run = async (): Promise<Chapter> => {
    const current = await read() // fresh read, inside the lock
    const next: Chapter = {
      ...fn(current),
      serverRunId: singletons.serverRunId,
      updatedAt: new Date().toISOString(),
    }
    await writeAtomic(next) // tmp + rename
    return next
  }
  // `.then(run, run)` so one failed update doesn't block the next.
  const result = singletons.chapterLock.then(run, run)
  singletons.chapterLock = result.catch(() => {})
  return result
}

/** New chapter: back to the first-use state. */
export function reset(): Promise<Chapter> {
  return update(() => emptyChapter(singletons.serverRunId))
}

/**
 * The other way a chapter starts over (slice 7): accepting a *new* synopsis
 * while a chapter is on the desk. One atomic write — the desk returns to
 * first use and wakes with the new story already accepted, never a half-state
 * where a new synopsis sits over an old cast. Generated image files stay on
 * disk: the desk never shows them again, and deleting the learner's art
 * automatically is not this function's call.
 */
export function newChapter(story: { pitch: Pitch; synopsis: { title: string; body: string } }): Promise<Chapter> {
  return update(() => ({
    ...emptyChapter(singletons.serverRunId),
    pitch: story.pitch,
    synopsis: { title: story.synopsis.title, body: story.synopsis.body, accepted: true },
  }))
}
