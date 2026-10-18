// The desk `check:responsive` measures (slice 23): a COPY of the filmed chapter
// (`data/filming-2026-10-14` — three finished pages, a cover, a locked cast)
// plus everything else a screen needs to show real content, seeded through the
// studio's own store and services, never by hand-written records:
//
//   • the chapter, owned by the check's person (`user_responsive`), a manhwa
//     copy of it (the vertical reader) and a blank project (the Story station's
//     empty state, the locked rail);
//   • a public share of the chapter (`createShare`) and of a finished trailer
//     (`createVideoShare`);
//   • two trailer records: page 1 DONE with tiny real files made by ffmpeg
//     (final.mp4 from testsrc with a tone, poster.jpg, captions.vtt) — the
//     dashboard's Videos, the Animate station's finished state and the trailer
//     share page; page 2 FAILED with two shots done and two not — the shot cards;
//   • two visitor reports (the admin list), the person's defaults and their
//     account record with an admin email (ADMIN_EMAILS names it).
//
// The tracked desks are only ever READ: the images are copied into the temp
// desk, and the project is written there through the store. The caller must
// have set INKDESK_DATA_DIR, INKDESK_STORAGE=local and dropped every credential
// before this module is imported (the store reads them at load).
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The person the check signs in as (test mode names them in a header), and the stranger with an empty desk. */
export const OWNER = 'user_responsive'
export const NEWCOMER = 'user_newcomer'
export const ADMIN_EMAIL = 'responsive-check@example.com'
export const BLANK_TITLE = 'A blank desk'
export const MANHWA_SUFFIX = ' (manhwa)'

export type Fixture = {
  projectId: string
  manhwaId: string
  blankId: string
  mangaToken: string
  videoToken: string
  doneVideoId: string
  failedVideoId: string
  /** A token no share ever had: the share not-found page. */
  missingToken: string
}

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 120_000 })
  if (r.error) throw new Error(`ffmpeg could not run (${r.error.message}) — the fixture's trailer needs it on the PATH`)
  if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}: ${r.stderr.toString().trim().split('\n').slice(-3).join(' ')}`)
}

/** Builds the desk at INKDESK_DATA_DIR from `sourceDesk` (read only). `scratch` takes the media files. */
export async function buildFixture(root: string, sourceDesk: string, scratch: string, origin: string): Promise<Fixture> {
  const dataDir = process.env.INKDESK_DATA_DIR
  if (!dataDir) throw new Error('INKDESK_DATA_DIR must be set before the fixture is built')

  // The pictures: copied, never linked, so nothing the studio does can reach the tracked desk.
  await mkdir(join(dataDir, 'images'), { recursive: true })
  await cp(join(sourceDesk, 'images'), join(dataDir, 'images'), { recursive: true })

  const { store } = await import(join(root, 'lib/store/index.ts'))
  const { emptyProject } = await import(join(root, 'lib/types.ts'))
  const { createShare, createVideoShare } = await import(join(root, 'lib/share/service.ts'))
  const { planFor } = await import(join(root, 'lib/video/animate.ts'))
  const rec = await import(join(root, 'lib/video/record.ts'))

  // The chapter, as the check's person's project.
  const [projectDir] = await readdir(join(sourceDesk, 'projects'))
  const source = JSON.parse(await readFile(join(sourceDesk, 'projects', projectDir, 'project.json'), 'utf8'))
  const projectId: string = source.id
  await store.createProject({ ...source, ownerId: OWNER, station: 'reader', openPage: 0 })

  // The same chapter in a manhwa style: the reader's vertical scroll.
  const manhwaId = randomUUID()
  await store.createProject({
    ...structuredClone(source),
    id: manhwaId,
    ownerId: OWNER,
    title: `${source.title}${MANHWA_SUFFIX}`,
    stylePresetId: 'manhwa-colour',
    chapters: source.chapters.map((c: { id: string }) => ({ ...structuredClone(c), id: randomUUID() })),
    station: 'reader',
    openPage: 0,
  })

  // A blank project: the Story station before anything is written, every later station locked.
  const blankId = randomUUID()
  await store.createProject({ ...emptyProject({ id: blankId, chapterId: randomUUID(), title: BLANK_TITLE, stylePresetId: 'manga-bw', serverRunId: 'responsive' }), ownerId: OWNER })

  const now = new Date()
  const iso = (msAgo = 0) => new Date(now.getTime() - msAgo).toISOString()

  // The person: an account record (the admin check reads its email) and their defaults.
  await store.users.upsert({ id: OWNER, email: ADMIN_EMAIL, createdAt: iso(86_400_000) })
  await store.settings.put({ userId: OWNER, defaultStyle: 'manga-bw', readingDirection: 'rtl', updatedAt: iso() })

  // The public share of the chapter.
  const project = await store.readProject(projectId)
  const mangaShare = await createShare(OWNER, project, origin)

  // A finished trailer of page 1, with tiny real files.
  await mkdir(scratch, { recursive: true })
  const final = join(scratch, 'final.mp4')
  const poster = join(scratch, 'poster.jpg')
  const captions = join(scratch, 'captions.vtt')
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=22',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=22',
    // VP9 and Opus in the MP4: Playwright's Chromium has no H.264 or AAC, and a trailer it can't play shows the error state.
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '150k', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '32k', '-shortest', '-movflags', '+faststart', final,
  ])
  ffmpeg(['-ss', '3', '-i', final, '-frames:v', '1', '-q:v', '5', poster])
  await writeFile(
    captions,
    'WEBVTT\n\n00:00:03.000 --> 00:00:06.500\nThe last delivery before dawn.\n\n00:00:08.000 --> 00:00:11.000\nWho sends a letter to a rooftop?\n',
  )

  const plan0 = await planFor(OWNER, project, 0)
  const doneVideoId = randomUUID()
  const keys = rec.videoKeys(OWNER, doneVideoId)
  await store.outputs.put(keys.final, final, 'video/mp4')
  await store.outputs.put(keys.poster, poster, 'image/jpeg')
  await store.outputs.put(keys.captions, captions, 'text/vtt')
  const base = rec.newVideoRecord({ id: doneVideoId, ownerId: OWNER, projectId, plan: plan0, now: new Date(now.getTime() - 3_600_000) })
  const done = {
    ...base,
    status: 'done',
    seconds: 22,
    posterKey: keys.poster,
    finalKey: keys.final,
    captionsKey: keys.captions,
    phase: null,
    updatedAt: iso(3_000_000),
    shots: base.shots.map((s: { panel: number }) => ({ ...s, state: 'done', blobKey: keys.shot(s.panel), costUsd: 0.6, attempts: 1, updatedAt: iso(3_000_000) })),
    speech: base.speech.map((s: { panel: number }) => ({ ...s, state: 'done', blobKey: keys.speech(s.panel), seconds: 1.6, costUsd: 0.001 })),
    music: { ...base.music, state: 'done', blobKey: keys.music, seconds: 22, costUsd: 0.04 },
  }
  done.costUsd = rec.totalCostOf(done)
  await store.videos.put(done)
  const videoShare = await createVideoShare(OWNER, await store.videos.get(doneVideoId), origin)

  // A trailer of page 2 that ended with two shots missing: the shot cards, one failed with Try again.
  const plan1 = await planFor(OWNER, project, 1)
  const failedVideoId = randomUUID()
  const fkeys = rec.videoKeys(OWNER, failedVideoId)
  const fbase = rec.newVideoRecord({ id: failedVideoId, ownerId: OWNER, projectId, plan: plan1, now: new Date(now.getTime() - 600_000) })
  const failed = {
    ...fbase,
    status: 'failed',
    error: rec.shotsFailedSentence(2, 4),
    phase: null,
    updatedAt: iso(500_000),
    shots: fbase.shots.map((s: { panel: number }, i: number) =>
      i % 2 === 0
        ? { ...s, state: 'done', blobKey: fkeys.shot(s.panel), costUsd: 0.6, attempts: 1, updatedAt: iso(500_000) }
        : { ...s, state: 'failed', error: rec.SHOT_DIDNT_FINISH, costUsd: 0, attempts: 1, updatedAt: iso(500_000) },
    ),
    speech: fbase.speech.map((s: object) => ({ ...s, state: 'done', seconds: 1.4, costUsd: 0.001 })),
    music: { ...fbase.music, state: 'done', seconds: 22, costUsd: 0.04 },
  }
  failed.costUsd = rec.totalCostOf(failed)
  await store.videos.put(failed)

  // What visitors reported: one about each share, one already handled.
  await store.reports.add({ id: randomUUID(), token: mangaShare.token, reason: 'copyright', note: 'This looks like a page from a manga I own. Could someone check where the art came from?', ipHash: 'unknown', at: iso(7_200_000), handledAt: null })
  await store.reports.add({ id: randomUUID(), token: videoShare.token, reason: 'spam', note: '', ipHash: 'unknown', at: iso(1_800_000), handledAt: null })

  return {
    projectId,
    manhwaId,
    blankId,
    mangaToken: mangaShare.token,
    videoToken: videoShare.token,
    doneVideoId,
    failedVideoId,
    missingToken: '0000000000000000000000',
  }
}

/**
 * The same ids, read back from a running fixture server (`--url`): its projects by title and its shares by kind.
 * `get` is a JSON GET as the check's person.
 */
export async function discoverFixture(get: (path: string) => Promise<unknown>): Promise<Fixture> {
  const { projects } = (await get('/api/projects')) as { projects: { id: string; title: string; stylePresetId: string }[] }
  const { shares } = (await get('/api/shares')) as { shares: { token: string; kind: string; projectId: string | null }[] }
  const blank = projects.find((p) => p.title === BLANK_TITLE)
  const manhwa = projects.find((p) => p.title.endsWith(MANHWA_SUFFIX))
  const main = projects.find((p) => p !== blank && p !== manhwa && p.stylePresetId !== 'manhwa-colour')
  const manga = shares.find((s) => s.kind === 'manga' && s.projectId === main?.id)
  const video = shares.find((s) => s.kind === 'video')
  if (!main || !blank || !manhwa || !manga || !video) {
    throw new Error('the server at --url does not hold the responsive fixture (start one with --serve, which prints its --url)')
  }
  const videos = (await get(`/api/projects/${main.id}/videos`).catch(() => ({ videos: [] }))) as { videos?: { id: string; page: number; status: string }[] }
  const list = videos.videos ?? []
  return {
    projectId: main.id,
    manhwaId: manhwa.id,
    blankId: blank.id,
    mangaToken: manga.token,
    videoToken: video.token,
    doneVideoId: list.find((v) => v.status === 'done')?.id ?? '',
    failedVideoId: list.find((v) => v.status === 'failed')?.id ?? '',
    missingToken: '0000000000000000000000',
  }
}
