'use client'

// Scenario mode (slice 11): the Story station's other half. A long scenario
// and the storyteller's notes, a live character count that says plainly when
// the Director will plan from a summary, "Try the sample scenario", and the
// shelf references ticked for the Director (at most `MAX_PLAN_REFERENCES`),
// with the upload control and its rights notice right here so pictures can be
// shelved before the Library opens. "Use this scenario" is the explicit save —
// the scenario form of accepting a synopsis: the words go read-only under a
// "Saved" stamp, and it opens the Library. Once the cast exists the scenario
// is frozen; a new story is a new project.
// Implements `devpost/prd.md > Scenario Mode and References`.
import { AssetShelf } from '@/components/AssetShelf'
import type { ChapterPatch } from '@/lib/patch'
import { MAX_PLAN_REFERENCES, needsSummary, SAMPLE_SCENARIO, SAMPLE_SCENARIO_NOTES, SCENARIO_WHOLE_CHARS } from '@/lib/story'
import type { Chapter } from '@/lib/types'

type Props = {
  chapter: Chapter
  onEdit: (patch: ChapterPatch) => void
  onCommit: (patch: ChapterPatch) => void
  onNewProject: () => void
  uploading: boolean
  uploadNotice: string | null
  onUpload: (file: File) => void
  onUploadNotice: (sentence: string) => void
}

function count(n: number): string {
  return n.toLocaleString('en-US')
}

export function ScenarioDesk({
  chapter,
  onEdit,
  onCommit,
  onNewProject,
  uploading,
  uploadNotice,
  onUpload,
  onUploadNotice,
}: Props) {
  const scenario = chapter.scenario ?? { text: '', notes: '', referenceAssetIds: [], saved: false }
  const saved = scenario.saved
  const castBuilt = chapter.cast.length > 0
  const length = scenario.text.trim().length
  const long = needsSummary(scenario.text)

  const lengthLine = long
    ? `${count(length)} characters. Past ${count(SCENARIO_WHOLE_CHARS)}, the Director plans from a summary of the scenario rather than the whole text.`
    : `${count(length)} characters — the Director reads up to ${count(SCENARIO_WHOLE_CHARS)} whole.`

  return (
    <>
      {saved ? (
        <article className="card synopsis-card scenario-card">
          <div className="eyebrow">
            {castBuilt ? 'Scenario · saved — the cast was built from this' : 'Scenario · saved'}
          </div>
          <div className="scenario-text" tabIndex={0} aria-label="The saved scenario">
            {scenario.text}
          </div>
          {scenario.notes.trim() && (
            <p className="scenario-notes-text">
              <span className="eyebrow eyebrow-sm">Notes</span> {scenario.notes}
            </p>
          )}
          <p className="helper">{lengthLine}</p>
          <span className="stamp">Saved</span>
        </article>
      ) : (
        <>
          <textarea
            className="input scenario-box"
            rows={12}
            placeholder="Paste your scenario: who is in it, where it happens, scene by scene."
            value={scenario.text}
            onChange={(e) => onEdit({ scenario: { text: e.target.value } })}
            aria-label="Your scenario"
          />
          <div className="pitch-aside">
            <span className={`scenario-count${long ? ' is-long' : ''}`} aria-live="polite">
              {lengthLine}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onCommit({ scenario: { text: SAMPLE_SCENARIO, notes: SAMPLE_SCENARIO_NOTES } })}
            >
              Try the sample scenario
            </button>
          </div>

          <label className="field scenario-notes-field">
            <span className="field-label">Notes for the Director · optional</span>
            <textarea
              className="input scenario-notes"
              rows={3}
              placeholder="Tone, what to keep secret, what matters most."
              value={scenario.notes}
              onChange={(e) => onEdit({ scenario: { notes: e.target.value } })}
            />
          </label>
        </>
      )}

      <AssetShelf
        assets={chapter.assets}
        uploading={uploading}
        notice={uploadNotice}
        onUpload={onUpload}
        onNotice={onUploadNotice}
        title="References for the Director"
        lede={`Tick up to ${MAX_PLAN_REFERENCES} pictures — places, props, moods — for the Director to read with the scenario. Character drawings can also become locked sheets in the Library.`}
        selection={{
          selected: scenario.referenceAssetIds,
          max: MAX_PLAN_REFERENCES,
          lockedReason: chapter.plan ? 'The chapter plan is written — the references it read are fixed.' : null,
          onChange: (ids) => onCommit({ scenario: { referenceAssetIds: ids } }),
        }}
      />

      {!saved ? (
        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={length === 0}
            onClick={() => onCommit({ scenario: { saved: true } })}
          >
            Use this scenario
          </button>
          <span className="helper">
            {length === 0
              ? 'Write or paste a scenario, or try the sample.'
              : 'Saving fixes the words — the cast is built from them. The ticks stay editable until the plan is written.'}
          </span>
        </div>
      ) : castBuilt ? (
        <div className="notice cast-notice">
          <span>
            This project’s cast was built from the saved scenario, so its words are frozen. A new story is a new
            project — this one stays as it is.
          </span>
          <button type="button" className="btn btn-secondary" onClick={onNewProject}>
            New project…
          </button>
        </div>
      ) : null}
    </>
  )
}
