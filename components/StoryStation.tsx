'use client'

// Station 1 — the story, told one of two ways (slice 11): **Pitch** (v1 —
// pitch, genre, tone, "Try the sample", then Claude's synopsis in an editable
// card with Rewrite and Accept) or **Scenario** (a long text, notes and the
// shelf references the Director will read — `components/ScenarioDesk.tsx`).
// The mode is chosen with two chips while the story is unsettled.
// Implements `devpost/prd.md > Story — The Pitch Desk` and
// `> Scenario Mode and References`.
//
// Once the cast exists the desk's story is frozen (slice 6) — but a *new*
// story can still be pitched (slice 7): the pitch is typed into local state,
// the draft Claude returns never touches the desk, and accepting it starts a
// NEW project in the same style with that story (v2, slice 8) — this project
// is never cleared. `devpost/prd.md > Screens and Layout (v2)`.
//
// Slice 20: pitching and rewriting are paid text calls, shut — with the
// reason beside them — only while drawing is paused for everyone; accepting a
// new story starts a project, which today's project allowance counts.
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { GenerationStatus } from '@/components/GenerationStatus'
import { ScenarioDesk } from '@/components/ScenarioDesk'
import { SpendNote } from '@/components/SpendNote'
import { StationFooter } from '@/components/StationFooter'
import type { Gates } from '@/lib/gates'
import { useSpend } from '@/lib/limits/use-usage'
import type { ChapterPatch } from '@/lib/patch'
import { GENRES, SAMPLE_PITCH, TONES } from '@/lib/prompts'
// The request schemas' own ceilings, so a long field stops at the box rather than failing the whole save.
import { PITCH_MAX_CHARS, SYNOPSIS_BODY_MAX_CHARS, SYNOPSIS_TITLE_MAX_CHARS } from '@/lib/schemas'
import { textStages } from '@/lib/stages'
import type { Chapter, Pitch, Synopsis } from '@/lib/types'

export type SynopsisDraft = { title: string; body: string }

type Props = {
  chapter: Chapter
  gates: Gates
  pending: boolean
  notice: string | null
  /** A new-story draft held in the browser only — never on the desk. */
  draft: SynopsisDraft | null
  /** Typing: applied locally now, saved after a pause. */
  onEdit: (patch: ChapterPatch) => void
  /** Clicks: saved immediately. */
  onCommit: (patch: ChapterPatch) => void
  onPitch: (pitch: Pitch) => void
  onDraftChange: (draft: SynopsisDraft) => void
  /** The confirmed door (v2): a new project wakes with this story accepted; this one is untouched. */
  onAcceptNewStory: (pitch: Pitch, synopsis: SynopsisDraft) => Promise<void>
  /** The desk's New project door — a scenario project's only way to a new story. */
  onNewProject: () => void
  /** The reference shelf's upload, offered here so a scenario can tick pictures before the Library opens. */
  uploading: boolean
  uploadNotice: string | null
  onUpload: (file: File) => void
  onUploadNotice: (sentence: string) => void
  onGoCast: () => void
}

export function StoryStation({
  chapter,
  gates,
  pending,
  notice,
  draft,
  onEdit,
  onCommit,
  onPitch,
  onDraftChange,
  onAcceptNewStory,
  onNewProject,
  uploading,
  uploadNotice,
  onUpload,
  onUploadNotice,
  onGoCast,
}: Props) {
  const { synopsis } = chapter
  const textSpend = useSpend({ text: true })
  const projectSpend = useSpend({ project: true })
  const askWhy = textSpend.blocked ? (textSpend.reason ?? undefined) : undefined
  const accepted = synopsis?.accepted === true
  const castBuilt = chapter.cast.length > 0
  const scenarioMode = chapter.storyMode === 'scenario'
  // The mode moves only while nothing is settled: no accepted synopsis, no saved scenario, no cast.
  const settled = accepted || chapter.scenario?.saved === true || castBuilt

  // With a cast on the desk, typing edits this local pitch — the desk's own
  // pitch stays exactly as the chapter was built from it.
  const [newPitch, setNewPitch] = useState<Pitch>(() => ({ ...chapter.pitch }))
  const pitch = castBuilt ? newPitch : chapter.pitch
  const setPitch = (p: Partial<Pitch>) =>
    castBuilt ? setNewPitch((prev) => ({ ...prev, ...p })) : onEdit({ pitch: p })
  const choosePitch = (p: Partial<Pitch>) =>
    castBuilt ? setNewPitch((prev) => ({ ...prev, ...p })) : onCommit({ pitch: p })

  const ready = pitch.text.trim().length > 0 && pitch.genre !== '' && pitch.tone !== ''

  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearNotice, setClearNotice] = useState<string | null>(null)
  const acceptNewStory = async () => {
    if (!draft) return
    setClearing(true)
    setClearNotice(null)
    try {
      await onAcceptNewStory(newPitch, draft)
      setConfirming(false)
    } catch (err) {
      // The desk's own sentence when it refused; the reachability sentence
      // only when nothing answered at all.
      const refused = err instanceof Error && err.name !== 'TypeError' && err.message
      setClearNotice(refused || 'The desk couldn’t start the new project. Is the dev server running?')
      setConfirming(false)
    } finally {
      setClearing(false)
    }
  }

  return (
    <main className="station">
      <div className="station-inner">
        <div className="station-head">
          <div className="eyebrow">Station 1 · Pitch or scenario</div>
          <h1 className="station-title">
            {scenarioMode ? (castBuilt ? 'The scenario' : 'What’s your story?') : castBuilt ? 'Tell a different story?' : 'What’s your story?'}
          </h1>
          {castBuilt && !scenarioMode && (
            <p className="station-lede">
              This project is built — its story is frozen below. Pitch a new one here: nothing changes until you
              accept the new synopsis, and that starts a new project in the same style. This one stays as it is.
            </p>
          )}
          {scenarioMode && !castBuilt && (
            <p className="station-lede">
              Paste the story as you have it — scenes, beats, a whole script. The Director plans the chapter from
              it once both characters are locked.
            </p>
          )}
        </div>

        {!castBuilt && (
          <div className="mode-row">
            <div className="chip-row" role="radiogroup" aria-label="How to tell the story">
              {(
                [
                  ['pitch', 'Pitch'],
                  ['scenario', 'Scenario'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={chapter.storyMode === mode}
                  className={`chip${chapter.storyMode === mode ? ' is-selected' : ''}`}
                  disabled={settled || pending}
                  onClick={() => {
                    if (chapter.storyMode !== mode) onCommit({ storyMode: mode })
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="helper">
              {settled
                ? 'The story is settled, so the way it is told is fixed. Telling it the other way is a new project.'
                : scenarioMode
                  ? 'Your own long scenario, with notes and references.'
                  : 'A line or two; Claude turns it into a synopsis you edit.'}
            </span>
          </div>
        )}

        {scenarioMode ? (
          <ScenarioDesk
            chapter={chapter}
            onEdit={onEdit}
            onCommit={onCommit}
            onNewProject={onNewProject}
            uploading={uploading}
            uploadNotice={uploadNotice}
            onUpload={onUpload}
            onUploadNotice={onUploadNotice}
          />
        ) : (
          <>
            <textarea
              className="input pitch-box"
              rows={3}
              placeholder="A line or two is enough. Who, where, and what goes wrong."
              value={pitch.text}
              maxLength={PITCH_MAX_CHARS}
              onChange={(e) => setPitch({ text: e.target.value })}
              disabled={pending}
              aria-label="Your pitch"
            />
            <div className="pitch-aside">
              <span>Nothing to type on camera?</span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => choosePitch({ text: SAMPLE_PITCH })}
                disabled={pending}
              >
                Try the sample
              </button>
            </div>

            <div className="options-grid">
              <div className="eyebrow">Genre</div>
              <div className="chip-row" role="radiogroup" aria-label="Genre">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={pitch.genre === g}
                    className={`chip${pitch.genre === g ? ' is-selected' : ''}`}
                    onClick={() => choosePitch({ genre: g })}
                    disabled={pending}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <div className="eyebrow">Tone</div>
              <div className="chip-row" role="radiogroup" aria-label="Tone">
                {TONES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={pitch.tone === t}
                    className={`chip chip-tone${pitch.tone === t ? ' is-selected' : ''}`}
                    onClick={() => choosePitch({ tone: t })}
                    disabled={pending}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => onPitch(pitch)}
                disabled={!ready || pending || textSpend.blocked}
                title={askWhy}
              >
                {pending ? 'Pitching…' : castBuilt ? (draft ? 'Pitch it again' : 'Pitch a new story') : synopsis ? 'Pitch it again' : 'Pitch it to Claude'}
              </button>
              <span className="helper">
                {castBuilt
                  ? 'The new synopsis arrives as a draft. Accepting it starts a new project in the same style — after a confirmation; this one stays as it is.'
                  : ready
                    ? 'A short synopsis comes back. You edit it, accept it, or ask for another.'
                    : 'Write a pitch and pick a genre and a tone.'}
              </span>
            </div>

            <SpendNote spend={textSpend} />
            {notice && (
              <div className="notice" role="alert">
                {notice}
              </div>
            )}
            {clearNotice && (
              <div className="notice" role="alert">
                {clearNotice}
              </div>
            )}

            <div className="hr" />

            {pending ? (
              <div className="sketch synopsis-loading" aria-busy="true">
                <GenerationStatus stages={textStages('Claude is reading your pitch…')} />
              </div>
            ) : castBuilt && draft ? (
              <article className="card synopsis-card">
                <div className="eyebrow">New story · draft · click to edit — accepting starts a new project</div>
                <input
                  className="synopsis-title"
                  value={draft.title}
                  maxLength={SYNOPSIS_TITLE_MAX_CHARS}
                  onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
                  aria-label="New project title"
                />
                <textarea
                  className="synopsis-body"
                  rows={5}
                  value={draft.body}
                  maxLength={SYNOPSIS_BODY_MAX_CHARS}
                  onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
                  aria-label="New synopsis"
                />
                <div className="synopsis-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={() => setConfirming(true)}
                    disabled={draft.title.trim() === '' || draft.body.trim() === '' || projectSpend.blocked}
                    title={
                      projectSpend.blocked
                        ? (projectSpend.reason ?? undefined)
                        : 'Starts a new project with this story — it asks first. Nothing here is cleared.'
                    }
                  >
                    Accept — new project…
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onPitch(pitch)}
                    disabled={!ready || textSpend.blocked}
                    title={askWhy}
                  >
                    Rewrite
                  </button>
                </div>
                <SpendNote spend={projectSpend} />
              </article>
            ) : synopsis === null ? (
              <div className="synopsis-empty">
                <span>Your synopsis lands here — editable, never final.</span>
              </div>
            ) : (
              <CurrentSynopsis
                synopsis={synopsis}
                accepted={accepted}
                castBuilt={castBuilt}
                ready={ready}
                pending={pending}
                onEdit={onEdit}
                onCommit={onCommit}
                onRewrite={() => onPitch(pitch)}
                rewriteBlocked={askWhy}
              />
            )}

            {confirming && draft && (
              <ConfirmDialog
                title={`Start a new project with “${draft.title.trim()}”?`}
                body="Accepting this synopsis opens a new project on the desk, in the same style, with this story already accepted. This project — its cast, their locked sheets and its page — stays exactly as it is."
                confirmLabel="Accept and start the project"
                busy={clearing}
                onConfirm={() => void acceptNewStory()}
                onCancel={() => setConfirming(false)}
              />
            )}
          </>
        )}

        <StationFooter
          gate={gates.cast}
          label="Next: Library"
          ready={scenarioMode ? 'Scenario saved — the library is open.' : 'Synopsis accepted — the library is open.'}
          onGo={onGoCast}
        />
      </div>
    </main>
  )
}

/** The desk's own synopsis: editable until accepted, read-only after, and
 *  explicitly the frozen source of the chapter once the cast exists. */
function CurrentSynopsis({
  synopsis,
  accepted,
  castBuilt,
  ready,
  pending,
  onEdit,
  onCommit,
  onRewrite,
  rewriteBlocked,
}: {
  synopsis: Synopsis
  accepted: boolean
  castBuilt: boolean
  ready: boolean
  pending: boolean
  onEdit: (patch: ChapterPatch) => void
  onCommit: (patch: ChapterPatch) => void
  onRewrite: () => void
  /** Why Rewrite is shut for a limit (a paused studio), else undefined. */
  rewriteBlocked: string | undefined
}) {
  return (
    <article className="card synopsis-card">
      <div className="eyebrow">
        {castBuilt
          ? 'Synopsis · accepted — the cast and page were built from this'
          : accepted
            ? 'Synopsis · accepted'
            : 'Synopsis · draft · click to edit'}
      </div>
      {accepted ? (
        <>
          <h2 className="synopsis-title">{synopsis.title}</h2>
          <p className="synopsis-text">{synopsis.body}</p>
        </>
      ) : (
        <>
          <input
            className="synopsis-title"
            value={synopsis.title}
            maxLength={SYNOPSIS_TITLE_MAX_CHARS}
            onChange={(e) => onEdit({ synopsis: { title: e.target.value } })}
            aria-label="Chapter title"
          />
          <textarea
            className="synopsis-body"
            rows={5}
            value={synopsis.body}
            maxLength={SYNOPSIS_BODY_MAX_CHARS}
            onChange={(e) => onEdit({ synopsis: { body: e.target.value } })}
            aria-label="Synopsis"
          />
        </>
      )}
      {!castBuilt && (
        <div className="synopsis-actions">
          {!accepted && (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => onCommit({ synopsis: { accepted: true } })}
              disabled={synopsis.title.trim() === '' || synopsis.body.trim() === ''}
            >
              Accept
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRewrite}
            disabled={!ready || pending || rewriteBlocked !== undefined}
            title={rewriteBlocked}
          >
            Rewrite
          </button>
        </div>
      )}
      {accepted && <span className="stamp">Accepted</span>}
    </article>
  )
}
