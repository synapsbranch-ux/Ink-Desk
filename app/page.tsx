'use client'

// The studio: the rail plus whichever station is open. React holds a copy of
// the chapter for rendering; `data/chapter.json` is the truth, reached only
// through the route handlers. See `devpost/spec.md > Data Model`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CastStation } from '@/components/CastStation'
import { IDLE_CARD, type CardState } from '@/components/CharacterCard'
import { ReaderStation } from '@/components/ReaderStation'
import { StationRail, type SaveState } from '@/components/StationRail'
import { StoryStation, type SynopsisDraft } from '@/components/StoryStation'
import { StoryboardStation } from '@/components/StoryboardStation'
import { gates } from '@/lib/gates'
import { applyPatch, mergePatch, type ChapterPatch, type CharacterEdit, type PanelEdit } from '@/lib/patch'
import type { Chapter, Pitch, Station } from '@/lib/types'

const SAVE_DELAY_MS = 600
/** While any panel is in flight the studio re-reads the desk this often. */
const POLL_MS = 1500
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

export default function Studio() {
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Cast: the first proposal in flight, and per-card activity — a reroll or
  // a draw running, and the last sentence the server sent back for that card.
  const [proposing, setProposing] = useState(false)
  const [proposeNotice, setProposeNotice] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})

  // Storyboard: the page script in flight, and the last sentence it sent back.
  const [scripting, setScripting] = useState(false)
  const [scriptNotice, setScriptNotice] = useState<string | null>(null)

  // Edits still waiting to be saved, merged across keystrokes.
  const queued = useRef<ChapterPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/chapter')
      .then((r) => r.json())
      .then((c: Chapter) => setChapter(c))
      .catch(() => setNotice('The desk couldn’t be opened. Is the dev server running?'))
  }, [])

  /** The desk's copy, with whatever is still being typed kept on top. */
  const accept = useCallback((saved: Chapter) => {
    setChapter(applyPatch(saved, queued.current))
    setSaveState('saved')
  }, [])

  /** A fresh read of the desk, with whatever is still being typed kept on
   *  top — and without touching the save label, which belongs to saves. */
  const absorb = useCallback((saved: Chapter) => {
    setChapter(applyPatch(saved, queued.current))
  }, [])

  /** After a refused save, the browser's optimistic copy is wrong: re-read. */
  const refresh = useCallback(async () => {
    const res = await fetch('/api/chapter')
    if (res.ok) absorb((await res.json()) as Chapter)
  }, [absorb])

  const send = useCallback(
    async (patch: ChapterPatch) => {
      setSaveState('saving')
      try {
        const { ok, data } = await postJson('/api/chapter', patch)
        if (!ok || !('version' in data)) throw new Error('error' in data ? data.error : 'save failed')
        // Whatever was typed while this was in flight stays on top of the saved copy.
        accept(data)
      } catch {
        setSaveState('error')
        void refresh().catch(() => {})
      }
    },
    [accept, refresh]
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

  const goTo = useCallback((station: Station) => commit({ station }), [commit])

  // A new-story draft (slice 7): held here only — the desk's story is frozen
  // once the cast exists, so the draft never touches the chapter until the
  // confirmed clear.
  const [draft, setDraft] = useState<SynopsisDraft | null>(null)

  const pitch = useCallback(
    async (p: Pitch) => {
      setPending(true)
      setNotice(null)
      try {
        const { ok, data } = await postJson('/api/synopsis', {
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
    [accept]
  )

  /** A fresh chapter replaces everything: queued edits, drafts and per-card
   *  state all belonged to the old one. */
  const adoptFresh = useCallback((fresh: Chapter) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    queued.current = {}
    setChapter(fresh)
    setSaveState('saved')
    setDraft(null)
    setCards({})
    setNotice(null)
    setProposeNotice(null)
    setScriptNotice(null)
  }, [])

  /** New chapter, both doors: the reader's button clears to a blank desk;
   *  accepting a new synopsis clears to a desk with that story accepted.
   *  Each sits behind its own ConfirmDialog. */
  const newChapter = useCallback(async () => {
    const res = await fetch('/api/chapter', { method: 'DELETE' })
    if (!res.ok) throw new Error('reset failed')
    adoptFresh((await res.json()) as Chapter)
  }, [adoptFresh])

  const acceptNewStory = useCallback(
    async (p: Pitch, synopsis: SynopsisDraft) => {
      const { ok, data } = await postJson('/api/chapter/new', { pitch: p, synopsis })
      if (!ok || !('version' in data)) throw new Error('error' in data ? data.error : 'new chapter failed')
      adoptFresh(data)
    },
    [adoptFresh]
  )

  // --- Cast ---------------------------------------------------------------

  const propose = useCallback(async () => {
    setProposing(true)
    setProposeNotice(null)
    try {
      const { ok, data } = await postJson('/api/cast', {})
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
  }, [accept])

  const setCard = useCallback((id: string, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE_CARD), ...patch } }))
  }, [])

  /** One generation request for one card: a reroll or a draw. */
  const cardRequest = useCallback(
    async (id: string, busy: CardState['busy'], url: string, body: unknown, fallback: string) => {
      setCard(id, { busy, notice: null })
      try {
        const { ok, data } = await postJson(url, body)
        if (!ok || !('version' in data)) {
          setCard(id, { notice: 'error' in data ? data.error : fallback })
          return
        }
        accept(data)
      } catch {
        setCard(id, { notice: UNREACHABLE })
      } finally {
        setCard(id, { busy: null })
      }
    },
    [accept, setCard]
  )

  const reroll = useCallback(
    (id: string) =>
      cardRequest(id, 'rerolling', '/api/cast/reroll', { id }, 'The studio couldn’t reroll that character just now.'),
    [cardRequest]
  )
  const draw = useCallback(
    (id: string, reuseDna: boolean) =>
      cardRequest(
        id,
        reuseDna ? 'redrawing' : 'drawing',
        '/api/sheet',
        { id, reuseDna },
        'The sheet didn’t come back, the studio is busy.'
      ),
    [cardRequest]
  )
  const editCard = useCallback((id: string, e: CharacterEdit) => edit({ cast: { [id]: e } }), [edit])
  const commitCard = useCallback((id: string, e: CharacterEdit) => commit({ cast: { [id]: e } }), [commit])
  const lock = useCallback((id: string) => commit({ cast: { [id]: { locked: true } } }), [commit])

  // --- Storyboard ---------------------------------------------------------

  const writeScript = useCallback(async () => {
    setScripting(true)
    setScriptNotice(null)
    try {
      const { ok, data } = await postJson('/api/script', {})
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
  }, [accept])

  /** A bubble placed, a tail pointed, a line retyped, a version stepped:
   *  saved at once. */
  const editPanel = useCallback((index: number, e: PanelEdit) => commit({ panels: { [index]: e } }), [commit])

  /** Redraw panel / Try again / Rewrite panel. Redraw queues and returns at
   *  once; rewrite holds while Claude rephrases. The desk's poll (below)
   *  watches the panel claim a slot, ink, and land. */
  const [panelBusy, setPanelBusy] = useState<Record<number, 'redraw' | 'rewrite' | null>>({})
  const panelRequest = useCallback(
    async (index: number, kind: 'redraw' | 'rewrite', url: string) => {
      setPanelBusy((b) => ({ ...b, [index]: kind }))
      try {
        const { ok, data } = await postJson(url, {})
        if (ok && 'version' in data) absorb(data)
        else {
          console.warn(`[panel] ${kind} refused:`, 'error' in data ? data.error : data)
          await refresh()
        }
      } catch {
        console.warn(`[panel] ${kind}:`, UNREACHABLE)
      } finally {
        setPanelBusy((b) => ({ ...b, [index]: null }))
      }
    },
    [absorb, refresh]
  )
  const redrawPanel = useCallback(
    (index: number) => panelRequest(index, 'redraw', `/api/panels/${index}`),
    [panelRequest]
  )
  const rewritePanel = useCallback(
    (index: number) => panelRequest(index, 'rewrite', `/api/panels/${index}/rewrite`),
    [panelRequest]
  )

  /** Queue the blank panels; the server responds at once and the poll
   *  watches them land. A refusal here is a sentence in the terminal — the
   *  panel-level repair buttons are slice 6. */
  const startPanels = useCallback(async () => {
    try {
      const { ok, data } = await postJson('/api/panels/start', {})
      if (ok && 'version' in data) absorb(data)
      else console.warn('[panels] start refused:', 'error' in data ? data.error : data)
    } catch {
      console.warn('[panels] start:', UNREACHABLE)
    }
  }, [absorb])

  // While any panel is in flight — or the storyboard is open at all, since a
  // redraw sits briefly in the queue before it reads `inking` — re-read the
  // desk every ~1.5s so panels appear independently and out of order.
  // Polling rather than a live connection, see `spec.md > What Was
  // Simplified and Why`.
  const inFlight =
    (chapter?.script?.some((p) => p.status === 'inking' || p.status === 'empty') ?? false) ||
    (chapter?.station === 'storyboard' && chapter.script !== null)
  useEffect(() => {
    if (!inFlight) return
    const tick = () => {
      fetch('/api/chapter')
        .then((r) => (r.ok ? (r.json() as Promise<Chapter>) : null))
        .then((c) => {
          if (c) absorb(c)
        })
        .catch(() => {})
    }
    const timer = setInterval(tick, POLL_MS)
    return () => clearInterval(timer)
  }, [inFlight, absorb])

  if (!chapter) {
    return (
      <div className="studio">
        <div className="studio-opening">{notice ?? 'Opening the desk…'}</div>
      </div>
    )
  }

  const g = gates(chapter)

  return (
    <div className="studio">
      <StationRail chapter={chapter} gates={g} saveState={saveState} onGo={goTo} />
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
          onGoCast={() => goTo('cast')}
        />
      ) : chapter.station === 'cast' ? (
        <CastStation
          chapter={chapter}
          gates={g}
          proposing={proposing}
          proposeNotice={proposeNotice}
          cards={cards}
          onPropose={propose}
          onEdit={editCard}
          onCommit={commitCard}
          onReroll={reroll}
          onDraw={draw}
          onLock={lock}
          onGoStoryboard={() => goTo('storyboard')}
        />
      ) : chapter.station === 'storyboard' ? (
        <StoryboardStation
          chapter={chapter}
          gates={g}
          scripting={scripting}
          scriptNotice={scriptNotice}
          onWriteScript={writeScript}
          onStartPanels={startPanels}
          onPanelEdit={editPanel}
          panelBusy={panelBusy}
          onRedraw={redrawPanel}
          onRewrite={rewritePanel}
          onGoReader={() => goTo('reader')}
        />
      ) : (
        <ReaderStation chapter={chapter} onGoStoryboard={() => goTo('storyboard')} onNewChapter={newChapter} />
      )}
    </div>
  )
}
