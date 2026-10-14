'use client'

// The studio for one project: the rail plus whichever station is open. React
// holds a copy of the desk for rendering; the project file is the truth,
// reached only through the route handlers under `/api/projects/<id>`. See
// `devpost/spec.md > Data Model` and `> Routing and the Dashboard (v2)`.
//
// Slice 11 adds the Director's requests — write the plan, generate a page,
// generate all, the cover — each with its own busy flag and sentence, the
// page switcher (a patch), and a poll that runs while the Director or the
// Page station has something to watch.
//
// Slice 18 makes every generation a job on the server's queue. The desk
// replies that report it carry `activity` (what is queued or drawing, what
// just failed, whether the queue is up); the studio keeps the latest in its
// own state, derives "Drawing…", "Inking…" and a failed sheet's sentence from
// it — never from a request being open — and polls only while something is
// active. See `devpost/spec.md > Queue and Worker (v3)`.
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CastStation } from '@/components/CastStation'
import { IDLE_CARD, type CardState } from '@/components/CharacterCard'
import { DirectorStation, type Starting } from '@/components/DirectorStation'
import { ReaderStation } from '@/components/ReaderStation'
import { StationRail, type SaveState } from '@/components/StationRail'
import { StoryStation, type SynopsisDraft } from '@/components/StoryStation'
import { StoryboardStation } from '@/components/StoryboardStation'
import { failedSheetJobs, failedSheetSentence, mergeActivity, pollWanted, queueNotice, sheetJob } from '@/lib/activity'
import { gates } from '@/lib/gates'
import { applyPatch, mergePatch, type ChapterPatch, type CharacterEdit, type PanelEdit } from '@/lib/patch'
import type { Activity } from '@/lib/queue/jobs'
import type { Chapter, Pitch, Station } from '@/lib/types'

const SAVE_DELAY_MS = 600
/** While a job is active (or a panel inks) the studio re-reads the desk this often. */
const POLL_MS = 1500
/** While the queue is down, how often an idle studio looks again. */
const QUEUE_RECHECK_MS = 10_000
/** A read that has not answered by now is given up on, so one hung request cannot stall the poll for good. */
const POLL_TIMEOUT_MS = 10_000
const UNREACHABLE = 'The studio couldn’t be reached. Is the dev server running?'

type Reply = Chapter | { error: string } | { draft: SynopsisDraft }

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Reply }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, status: res.status, data: (await res.json()) as Reply }
}

export function Studio({ projectId }: { projectId: string }) {
  const router = useRouter()
  const api = `/api/projects/${projectId}`

  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Cast: the first proposal in flight, and per-card activity — a reroll or
  // a draw running, and the last sentence the server sent back for that card.
  const [proposing, setProposing] = useState(false)
  const [proposeNotice, setProposeNotice] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  /** Failed sheet jobs whose sentence the user has moved past by drawing again (by job id). */
  const [dismissed, setDismissed] = useState<string[]>([])

  // Storyboard: the page script in flight, and the last sentence it sent back.
  const [scripting, setScripting] = useState(false)
  const [scriptNotice, setScriptNotice] = useState<string | null>(null)

  // Edits still waiting to be saved, merged across keystrokes — and the ones
  // on the wire, so a poll landing mid-save never shows the old words.
  const queued = useRef<ChapterPatch>({})
  const sending = useRef<ChapterPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The server's sentence for a refused edit (a page that can't be dropped, a tick past the plan). */
  const [refusal, setRefusal] = useState<string | null>(null)

  // What the queue is doing, as of the last reply that said (slice 18). Held
  // beside the desk, not inside it: a reply without `activity` (an edit, the
  // plan, the cast) says nothing new, so the last one stands.
  const [activity, setActivity] = useState<Activity | undefined>(undefined)
  /** Counts the replies taken in, so a poll that was on the wire when a newer
   *  reply landed can tell its answer is the older one and drop it. */
  const epoch = useRef(0)

  /** Take `activity` off a desk reply; what is left is the chapter. */
  const unwrap = useCallback((reply: Chapter): Chapter => {
    const { activity: next, ...desk } = reply
    setActivity((prev) => mergeActivity(prev, next))
    epoch.current += 1
    return desk
  }, [])

  /** The desk's copy, with whatever is still being typed kept on top. */
  const accept = useCallback(
    (saved: Chapter) => {
      setChapter(applyPatch(unwrap(saved), queued.current))
      setSaveState('saved')
    },
    [unwrap]
  )

  /** A fresh read of the desk, with whatever is still being typed (or
   *  saved) kept on top — and without touching the save label, which
   *  belongs to saves. */
  const absorb = useCallback(
    (saved: Chapter) => {
      setChapter(applyPatch(unwrap(saved), mergePatch(sending.current, queued.current)))
    },
    [unwrap]
  )

  useEffect(() => {
    fetch(api)
      .then((r) => r.json())
      .then((c: Chapter) => absorb(c))
      .catch(() => setNotice('The desk couldn’t be opened. Is the dev server running?'))
  }, [api, absorb])

  /** After a refused save, the browser's optimistic copy is wrong: re-read. */
  const refresh = useCallback(async () => {
    const res = await fetch(api)
    if (res.ok) absorb((await res.json()) as Chapter)
  }, [api, absorb])

  const send = useCallback(
    async (patch: ChapterPatch) => {
      setSaveState('saving')
      sending.current = mergePatch(sending.current, patch)
      try {
        const { ok, data } = await postJson(api, patch)
        sending.current = {}
        if (!ok || !('version' in data)) {
          if ('error' in data) setRefusal(data.error)
          throw new Error('save refused')
        }
        // Whatever was typed while this was in flight stays on top of the saved copy.
        accept(data)
      } catch {
        sending.current = {}
        setSaveState('error')
        void refresh().catch(() => {})
      }
    },
    [api, accept, refresh]
  )

  /** Typing: apply locally now, save after a pause. The label says
   *  "Saving…" from the first keystroke, so it never claims a save that
   *  hasn't happened yet. */
  const edit = useCallback(
    (patch: ChapterPatch) => {
      setChapter((c) => (c ? applyPatch(c, patch) : c))
      setSaveState('saving')
      queued.current = mergePatch(queued.current, patch)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        const p = queued.current
        queued.current = {}
        void send(p)
      }, SAVE_DELAY_MS)
    },
    [send]
  )

  /** Clicks: flush anything queued and save now. */
  const commit = useCallback(
    (patch: ChapterPatch) => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const p = mergePatch(queued.current, patch)
      queued.current = {}
      setChapter((c) => (c ? applyPatch(c, patch) : c))
      void send(p)
    },
    [send]
  )

  /** Before a generation request: whatever is still waiting to be saved goes
   *  first, so the server draws from the words on screen. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const p = queued.current
    queued.current = {}
    if (Object.values(p).some((v) => v !== undefined)) await send(p)
  }, [send])

  const goTo = useCallback(
    (station: Station) => {
      setRefusal(null)
      commit({ station })
    },
    [commit]
  )

  // A new-story draft (slice 7): held here only — the desk's story is frozen
  // once the cast exists, so the draft never touches the project. Accepting
  // it starts a NEW project with this story (v2); this one stays as it is.
  const [draft, setDraft] = useState<SynopsisDraft | null>(null)

  const pitch = useCallback(
    async (p: Pitch) => {
      setPending(true)
      setNotice(null)
      try {
        const { ok, data } = await postJson(`${api}/synopsis`, {
          pitch: p.text,
          genre: p.genre,
          tone: p.tone,
        })
        if (ok && 'draft' in data) {
          setDraft(data.draft)
          return
        }
        if (!ok || !('version' in data)) {
          setNotice('error' in data ? data.error : 'The studio couldn’t write a synopsis just now.')
          return
        }
        accept(data)
      } catch {
        setNotice(UNREACHABLE)
      } finally {
        setPending(false)
      }
    },
    [api, accept]
  )

  /** Accepting a new synopsis while this project is built: a new project in
   *  the same style wakes with the story accepted, and the studio moves there. */
  const acceptNewStory = useCallback(
    async (p: Pitch, synopsis: SynopsisDraft) => {
      if (!chapter) return
      const { ok, data } = await postJson('/api/projects', {
        // The project title is the schema's: at most 120 characters.
        title: (synopsis.title.trim() || 'Untitled project').slice(0, 120),
        stylePresetId: chapter.stylePresetId,
        story: { pitch: p, synopsis },
      })
      if (!ok || !('version' in data)) {
        throw new Error('error' in data ? data.error : 'The desk couldn’t start the new project just now.')
      }
      router.push(`/p/${data.address.projectId}`)
    },
    [chapter, router]
  )

  /** The reader's door to the desk: nothing here is cleared. */
  const newProject = useCallback(() => router.push('/?new=1'), [router])

  // --- Cast ---------------------------------------------------------------

  const propose = useCallback(async () => {
    setProposing(true)
    setProposeNotice(null)
    try {
      const { ok, data } = await postJson(`${api}/cast`, {})
      if (!ok || !('version' in data)) {
        setProposeNotice('error' in data ? data.error : 'The studio couldn’t propose a cast just now.')
        return
      }
      accept(data)
    } catch {
      setProposeNotice(UNREACHABLE)
    } finally {
      setProposing(false)
    }
  }, [api, accept])

  const setCard = useCallback((id: string, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE_CARD), ...patch } }))
  }, [])

  /** One request for one card: a reroll or an import (held open), or the
   *  start of a draw (answered at once — the sheet is a queued job). */
  const cardRequest = useCallback(
    async (id: string, busy: CardState['busy'], url: string, body: unknown, fallback: string) => {
      setCard(id, { busy, notice: null })
      try {
        const { ok, data } = await postJson(url, body)
        if (!ok || !('version' in data)) {
          setCard(id, { notice: 'error' in data ? data.error : fallback })
          void refresh().catch(() => {}) // what the server did before it refused is worth a look
          return
        }
        accept(data)
      } catch {
        setCard(id, { notice: UNREACHABLE })
      } finally {
        setCard(id, { busy: null })
      }
    },
    [accept, setCard, refresh]
  )

  const reroll = useCallback(
    (id: string) =>
      cardRequest(id, 'rerolling', `${api}/cast/reroll`, { id }, 'The studio couldn’t reroll that character just now.'),
    [api, cardRequest]
  )
  const draw = useCallback(
    (id: string, reuseDna: boolean) => {
      // Starting a new draw clears the last one's failure sentence for good.
      const past = failedSheetJobs(activity, id, dismissed).map((j) => j.id)
      if (past.length > 0) setDismissed((d) => [...d, ...past])
      return cardRequest(
        id,
        reuseDna ? 'redrawing' : 'drawing',
        `${api}/sheet`,
        { id, reuseDna },
        'The sheet couldn’t be started just now.'
      )
    },
    [api, cardRequest, activity, dismissed]
  )
  /** What each card shows: the request in flight here, else the sheet job the
   *  server holds for it — so a reload, a second tab or a slow queue still
   *  reads "Drawing…" — and the failed job's sentence until the next draw. */
  const cast = chapter?.cast
  const cardViews = useMemo(() => {
    const views: Record<string, CardState> = {}
    for (const c of cast ?? []) {
      const local = cards[c.id] ?? IDLE_CARD
      views[c.id] = {
        busy: sheetJob(activity, c.id)?.busy ?? local.busy,
        notice: local.notice ?? failedSheetSentence(activity, c.id, dismissed),
      }
    }
    return views
  }, [cast, cards, activity, dismissed])
  const editCard = useCallback((id: string, e: CharacterEdit) => edit({ cast: { [id]: e } }), [edit])
  const commitCard = useCallback((id: string, e: CharacterEdit) => commit({ cast: { [id]: e } }), [commit])
  const lock = useCallback((id: string) => commit({ cast: { [id]: { locked: true } } }), [commit])

  /** Import reference: a shelf picture becomes the sheet, the DNA is read from it. */
  const importSheet = useCallback(
    (id: string, assetId: string) =>
      cardRequest(id, 'importing', `${api}/import`, { id, assetId }, 'The picture couldn’t be read just now.'),
    [api, cardRequest]
  )

  // The reference shelf: one upload at a time, the server's sentence on refusal.
  const [uploading, setUploading] = useState(false)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)
  const upload = useCallback(
    async (file: File) => {
      setUploading(true)
      setUploadNotice(null)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`${api}/assets`, { method: 'POST', body: form })
        const data = (await res.json()) as Reply
        if (!res.ok || !('version' in data)) {
          setUploadNotice('error' in data ? data.error : 'The reference couldn’t be put on the shelf just now.')
          return
        }
        accept(data)
      } catch {
        setUploadNotice(UNREACHABLE)
      } finally {
        setUploading(false)
      }
    },
    [api, accept]
  )

  // --- Director -----------------------------------------------------------

  /** One generation request: the desk on success, else the server's sentence. */
  const call = useCallback(
    async (url: string, body: unknown, fallback: string): Promise<{ desk: Chapter } | { error: string }> => {
      try {
        const { ok, data } = await postJson(url, body)
        if (ok && 'version' in data) return { desk: data }
        // A refused request can still have started part of its work (Generate all queued some panels
        // before the cap said no): read the desk again so the poll picks up whatever is drawing.
        void refresh().catch(() => {})
        return { error: 'error' in data ? data.error : fallback }
      } catch {
        return { error: UNREACHABLE }
      }
    },
    [refresh]
  )

  // Write the chapter plan / Ask the Director again: one text call, held open.
  const [planning, setPlanning] = useState(false)
  const [planNotice, setPlanNotice] = useState<string | null>(null)
  const writePlan = useCallback(
    async (pageCount: number, replace: boolean) => {
      await flush()
      setPlanning(true)
      setPlanNotice(null)
      const r = await call(`${api}/plan`, { pageCount, replace }, 'The Director couldn’t write the plan just now.')
      if ('desk' in r) accept(r.desk)
      else setPlanNotice(r.error)
      setPlanning(false)
    },
    [api, call, accept, flush]
  )

  // Generate page n / Generate all: they respond at once; the poll watches the ink.
  const [starting, setStarting] = useState<Starting>(null)
  const [startNotice, setStartNotice] = useState<string | null>(null)
  /** The server's sentence for a panel request it refused (you already have a lot inking, the studio is busy…). */
  const [panelNotice, setPanelNotice] = useState<string | null>(null)
  const startPage = useCallback(
    async (n: number, watch: boolean) => {
      await flush()
      setStarting(n)
      setStartNotice(null)
      const r = await call(`${api}/pages/${n}/start`, {}, `Page ${n + 1} couldn’t be started just now.`)
      setStarting(null)
      if ('error' in r) {
        setStartNotice(r.error)
        return
      }
      absorb(r.desk)
      // From the Director: open the page so the storyteller watches it ink.
      if (watch) commit({ page: n, station: 'storyboard' })
    },
    [api, call, absorb, commit, flush]
  )
  const startAll = useCallback(async () => {
    await flush()
    setStarting('all')
    setStartNotice(null)
    const r = await call(`${api}/pages/all/start`, {}, 'The chapter couldn’t be started just now.')
    setStarting(null)
    if ('desk' in r) absorb(r.desk)
    else setStartNotice(r.error)
  }, [api, call, absorb, flush])

  // Generate cover / Redraw cover / Try again: queued, then polled.
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverNotice, setCoverNotice] = useState<string | null>(null)
  const generateCover = useCallback(async () => {
    await flush()
    setCoverBusy(true)
    setCoverNotice(null)
    const r = await call(`${api}/cover`, {}, 'The cover couldn’t be started just now.')
    setCoverBusy(false)
    if ('desk' in r) absorb(r.desk)
    else setCoverNotice(r.error)
  }, [api, call, absorb, flush])

  /** The page switcher: the reply is already the new page's desk. */
  const pickPage = useCallback(
    (n: number) => {
      setStartNotice(null)
      setPanelNotice(null)
      commit({ page: n })
    },
    [commit]
  )

  // --- Storyboard ---------------------------------------------------------

  // The open page: every page-scoped request names it.
  const page = chapter?.address.pageIndex ?? 0
  const pageApi = `${api}/pages/${page}`

  const writeScript = useCallback(async () => {
    setScripting(true)
    setScriptNotice(null)
    try {
      const { ok, data } = await postJson(`${pageApi}/script`, {})
      if (!ok || !('version' in data)) {
        setScriptNotice('error' in data ? data.error : 'The studio couldn’t write the page script just now.')
        return
      }
      accept(data)
    } catch {
      setScriptNotice(UNREACHABLE)
    } finally {
      setScripting(false)
    }
  }, [pageApi, accept])

  /** A bubble placed, a tail pointed, a line retyped, a version stepped:
   *  saved at once. */
  /** Each panel edit names the page it was made on, so it lands there even
   *  if the open page moves before it arrives (another tab, a switch in flight). */
  const editPanel = useCallback(
    (index: number, e: PanelEdit) => commit({ panels: { [index]: e }, at: page }),
    [commit, page]
  )

  /** Redraw panel / Try again / Rewrite panel. Redraw queues and returns at
   *  once; rewrite holds while Claude rephrases. The desk's poll (below)
   *  watches the panel claim a slot, ink, and land. */
  const [panelBusy, setPanelBusy] = useState<Record<number, 'redraw' | 'rewrite' | null>>({})
  const panelRequest = useCallback(
    async (index: number, kind: 'redraw' | 'rewrite', url: string) => {
      setPanelBusy((b) => ({ ...b, [index]: kind }))
      setPanelNotice(null)
      try {
        const { ok, data } = await postJson(url, {})
        if (ok && 'version' in data) absorb(data)
        else {
          console.warn(`[panel] ${kind} refused:`, 'error' in data ? data.error : data)
          if ('error' in data) setPanelNotice(data.error)
          await refresh()
        }
      } catch {
        console.warn(`[panel] ${kind}:`, UNREACHABLE)
        setPanelNotice(UNREACHABLE)
      } finally {
        setPanelBusy((b) => ({ ...b, [index]: null }))
      }
    },
    [absorb, refresh]
  )
  const redrawPanel = useCallback(
    (index: number) => panelRequest(index, 'redraw', `${pageApi}/panels/${index}`),
    [pageApi, panelRequest]
  )
  const rewritePanel = useCallback(
    (index: number) => panelRequest(index, 'rewrite', `${pageApi}/panels/${index}/rewrite`),
    [pageApi, panelRequest]
  )

  /** Queue the blank panels; the server responds at once and the poll
   *  watches them land. A refusal shows the server's sentence above the page,
   *  and the blank panels keep a button to try again. */
  const [panelsStarting, setPanelsStarting] = useState(false)
  const startPanels = useCallback(async () => {
    setPanelsStarting(true)
    setPanelNotice(null)
    try {
      const { ok, data } = await postJson(`${pageApi}/start`, {})
      if (ok && 'version' in data) absorb(data)
      else {
        console.warn('[panels] start refused:', 'error' in data ? data.error : data)
        if ('error' in data) setPanelNotice(data.error)
        void refresh().catch(() => {})
      }
    } catch {
      console.warn('[panels] start:', UNREACHABLE)
      setPanelNotice(UNREACHABLE)
    } finally {
      setPanelsStarting(false)
    }
  }, [pageApi, absorb, refresh])

  // Poll the desk while anything is being drawn: an active job in `activity`,
  // or a panel, page or cover the desk itself says is inking. Polling rather
  // than a live connection, see `spec.md > What Was Simplified and Why`. An
  // idle, finished project does not poll at all. It pauses while the tab is
  // hidden (and reads at once when the tab comes back), never starts a read
  // while the last is still out (CR-8), and takes one more read after the last
  // job ends so the finished art is picked up. A failed read is silent.
  const live = pollWanted(chapter, activity)
  const reading = useRef(false)
  const owed = useRef(false)
  const poll = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    const seen = epoch.current
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
      if (!res.ok) return
      const desk = (await res.json()) as Chapter
      // A reply that landed while this read was on the wire is newer than it.
      if (epoch.current === seen) absorb(desk)
    } catch {
      // silent: the next tick tries again
    } finally {
      reading.current = false
    }
  }, [api, absorb])
  useEffect(() => {
    if (live) owed.current = true
    else if (!owed.current) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (!live) {
        // The one extra read after the last job ended.
        if (!owed.current) return
        owed.current = false
      }
      void poll()
    }
    const timer = live ? setInterval(tick, POLL_MS) : null
    document.addEventListener('visibilitychange', tick)
    if (!live) tick()
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [live, poll])

  // While the status line says the queue is down or has no worker, look again
  // now and then so it clears itself when the queue is back — slowly, and only
  // while the tab can be seen. (While something is drawing, the faster poll above already does it.)
  const queueDown = queueNotice(activity) !== null
  useEffect(() => {
    if (!queueDown || live) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll()
    }, QUEUE_RECHECK_MS)
    return () => clearInterval(timer)
  }, [queueDown, live, poll])

  if (!chapter) {
    return (
      <div className="studio">
        <div className="studio-opening">{notice ?? 'Opening the desk…'}</div>
      </div>
    )
  }

  const g = gates(chapter)
  const queueLine = queueNotice(activity)

  return (
    <div className="studio">
      <StationRail chapter={chapter} gates={g} saveState={saveState} onGo={goTo} />
      {queueLine && (
        <p className="studio-queue notice" role="status">
          {queueLine}
        </p>
      )}
      {refusal && (
        <div className="studio-refusal notice" role="alert">
          <span>{refusal}</span>
          <button type="button" className="btn btn-secondary" onClick={() => setRefusal(null)}>
            Dismiss
          </button>
        </div>
      )}
      {chapter.station === 'story' ? (
        <StoryStation
          chapter={chapter}
          gates={g}
          pending={pending}
          notice={notice}
          draft={draft}
          onEdit={edit}
          onCommit={commit}
          onPitch={(p) => void pitch(p)}
          onDraftChange={setDraft}
          onAcceptNewStory={acceptNewStory}
          onNewProject={newProject}
          uploading={uploading}
          uploadNotice={uploadNotice}
          onUpload={(f) => void upload(f)}
          onUploadNotice={setUploadNotice}
          onGoCast={() => goTo('cast')}
        />
      ) : chapter.station === 'cast' ? (
        <CastStation
          chapter={chapter}
          gates={g}
          proposing={proposing}
          proposeNotice={proposeNotice}
          cards={cardViews}
          onPropose={propose}
          onEdit={editCard}
          onCommit={commitCard}
          onReroll={reroll}
          onDraw={draw}
          onLock={lock}
          onImport={importSheet}
          uploading={uploading}
          uploadNotice={uploadNotice}
          onUpload={(f) => void upload(f)}
          onUploadNotice={setUploadNotice}
          onGoDirector={() => goTo('director')}
        />
      ) : chapter.station === 'director' ? (
        <DirectorStation
          chapter={chapter}
          gates={g}
          planning={planning}
          planNotice={planNotice}
          starting={starting}
          startNotice={startNotice}
          coverBusy={coverBusy}
          coverNotice={coverNotice}
          activity={activity}
          onEdit={edit}
          onCommit={commit}
          onWritePlan={(n, replace) => void writePlan(n, replace)}
          onStartPage={(n) => void startPage(n, true)}
          onStartAll={() => void startAll()}
          onGenerateCover={() => void generateCover()}
          onGoPage={() => goTo('storyboard')}
        />
      ) : chapter.station === 'storyboard' ? (
        <StoryboardStation
          key={chapter.address.pageIndex}
          chapter={chapter}
          gates={g}
          scripting={scripting}
          scriptNotice={scriptNotice}
          activity={activity}
          onWriteScript={writeScript}
          onStartPanels={startPanels}
          panelsStarting={panelsStarting}
          panelNotice={panelNotice}
          onPanelEdit={editPanel}
          panelBusy={panelBusy}
          onRedraw={redrawPanel}
          onRewrite={rewritePanel}
          onPickPage={pickPage}
          onGeneratePage={() => void startPage(page, false)}
          starting={starting === page}
          startNotice={startNotice}
          onGoReader={() => goTo('reader')}
        />
      ) : (
        <ReaderStation chapter={chapter} onGoStoryboard={() => goTo('storyboard')} onNewProject={newProject} />
      )}
    </div>
  )
}
