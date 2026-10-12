'use client'

// Station 1 — the pitch desk. Pitch, genre, tone, "Try the sample", then
// Claude's synopsis in an editable card with Rewrite and Accept.
// Implements `devpost/prd.md > Story — The Pitch Desk`.
import type { ChapterPatch } from '@/lib/patch'
import { GENRES, SAMPLE_PITCH, TONES } from '@/lib/prompts'
import type { Chapter } from '@/lib/types'

type Props = {
  chapter: Chapter
  pending: boolean
  notice: string | null
  /** Typing: applied locally now, saved after a pause. */
  onEdit: (patch: ChapterPatch) => void
  /** Clicks: saved immediately. */
  onCommit: (patch: ChapterPatch) => void
  onPitch: () => void
  onGoCast: () => void
}

export function StoryStation({ chapter, pending, notice, onEdit, onCommit, onPitch, onGoCast }: Props) {
  const { pitch, synopsis } = chapter
  const ready = pitch.text.trim().length > 0 && pitch.genre !== '' && pitch.tone !== ''
  const accepted = synopsis?.accepted === true

  return (
    <main className="station">
      <div className="station-inner">
        <div className="station-head">
          <div className="eyebrow">Station 1 · The pitch desk</div>
          <h1 className="station-title">What’s your story?</h1>
        </div>

        <textarea
          className="input pitch-box"
          rows={3}
          placeholder="A line or two is enough. Who, where, and what goes wrong."
          value={pitch.text}
          onChange={(e) => onEdit({ pitch: { text: e.target.value } })}
          disabled={pending}
          aria-label="Your pitch"
        />
        <div className="pitch-aside">
          <span>Nothing to type on camera?</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onCommit({ pitch: { text: SAMPLE_PITCH } })}
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
                onClick={() => onCommit({ pitch: { genre: g } })}
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
                onClick={() => onCommit({ pitch: { tone: t } })}
                disabled={pending}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="action-row">
          <button type="button" className="btn btn-primary btn-lg" onClick={onPitch} disabled={!ready || pending}>
            {pending ? 'Pitching…' : synopsis ? 'Pitch it again' : 'Pitch it to Claude'}
          </button>
          <span className="helper">
            {ready
              ? 'A short synopsis comes back. You edit it, accept it, or ask for another.'
              : 'Write a pitch and pick a genre and a tone.'}
          </span>
        </div>

        {notice && (
          <div className="notice" role="alert">
            {notice}
          </div>
        )}

        <div className="hr" />

        {pending ? (
          <div className="sketch synopsis-loading" aria-busy="true">
            <span className="sketch-label">Claude is reading your pitch…</span>
          </div>
        ) : synopsis === null ? (
          <div className="synopsis-empty">
            <span>Your synopsis lands here — editable, never final.</span>
          </div>
        ) : (
          <article className="card synopsis-card">
            <div className="eyebrow">{accepted ? 'Synopsis · accepted' : 'Synopsis · draft · click to edit'}</div>
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
                  onChange={(e) => onEdit({ synopsis: { title: e.target.value } })}
                  aria-label="Chapter title"
                />
                <textarea
                  className="synopsis-body"
                  rows={5}
                  value={synopsis.body}
                  onChange={(e) => onEdit({ synopsis: { body: e.target.value } })}
                  aria-label="Synopsis"
                />
              </>
            )}
            <div className="synopsis-actions">
              {accepted ? (
                <button type="button" className="btn btn-primary btn-lg" onClick={onGoCast}>
                  Next: build the cast →
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => onCommit({ synopsis: { accepted: true } })}
                  disabled={synopsis.title.trim() === '' || synopsis.body.trim() === ''}
                >
                  Accept
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={onPitch} disabled={!ready}>
                Rewrite
              </button>
            </div>
            {accepted && <span className="stamp">Accepted</span>}
          </article>
        )}
      </div>
    </main>
  )
}
