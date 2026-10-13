'use client'

// The project's reference shelf (v2, slice 10): upload your own pictures;
// any of them can become a character's locked sheet from the card below.
// The limits are checked here first so a wrong file never travels, and
// again on the server, which is the one that decides.
// Implements `devpost/prd.md > Scenario Mode and References` (the assets half).
//
// Slice 11 gives it a selectable mode for the Story station's scenario: each
// tile carries a labelled tick box — the references the Director will read —
// capped at `maxSelected`, and the same upload control (with its rights
// notice), so a storyteller can shelve pictures before the Library opens.
import { useRef, useState } from 'react'
import { MAX_ASSETS, RIGHTS_NOTICE, sniffImage, UPLOAD_LIMIT_BYTES } from '@/lib/assets'
import type { Asset } from '@/lib/types'

/** The tick boxes, when the shelf is a picker. */
export type ShelfSelection = {
  selected: readonly string[]
  max: number
  /** Ticks can't change any more — the sentence says why. */
  lockedReason?: string | null
  onChange: (ids: string[]) => void
}

type Props = {
  assets: Asset[]
  uploading: boolean
  notice: string | null
  onUpload: (file: File) => void
  onNotice: (sentence: string) => void
  /** The head's eyebrow and sentence, when the shelf serves another purpose. */
  title?: string
  lede?: string
  selection?: ShelfSelection
}

export function AssetShelf({ assets, uploading, notice, onUpload, onNotice, title, lede, selection }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const full = assets.length >= MAX_ASSETS

  const take = async (file: File | undefined) => {
    if (!file) return
    if (file.size > UPLOAD_LIMIT_BYTES) {
      onNotice(`That picture is over ${UPLOAD_LIMIT_BYTES / (1024 * 1024)} MB. Save a smaller copy and upload that.`)
      return
    }
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    if (!sniffImage(head)) {
      onNotice('Only PNG, JPEG or WebP pictures can be uploaded as references.')
      return
    }
    onUpload(file)
  }

  return (
    <section className="asset-shelf" aria-label="Reference shelf">
      <div className="asset-shelf-head">
        <div>
          <span className="eyebrow eyebrow-sm">
            {title ?? 'Reference shelf'} · {assets.length} of {MAX_ASSETS}
            {selection && ` · ${selection.selected.length} of ${selection.max} ticked`}
          </span>
          <p className="asset-shelf-lede">
            {lede ?? 'Your own character drawings. Import one on a card below and it becomes that character’s locked sheet.'}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading || full}
          onClick={() => input.current?.click()}
          title={full ? 'The shelf is full.' : `PNG, JPEG or WebP, up to ${UPLOAD_LIMIT_BYTES / (1024 * 1024)} MB.`}
        >
          {uploading ? 'Uploading…' : 'Upload a reference'}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            void take(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      <div
        className={`asset-grid${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          if (uploading || full) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!uploading && !full) void take(e.dataTransfer.files?.[0])
        }}
      >
        {assets.length === 0 ? (
          <p className="asset-empty">Drop a picture here, or use Upload a reference.</p>
        ) : (
          assets.map((a) =>
            selection ? (
              <SelectableTile key={a.id} asset={a} selection={selection} />
            ) : (
              <figure key={a.id} className="asset-tile">
                {/* eslint-disable-next-line @next/next/no-img-element -- the stored bytes, served by id */}
                <img src={`/api/image/${a.blobId}`} alt={a.name} />
                <figcaption title={a.name}>{a.name}</figcaption>
              </figure>
            )
          )
        )}
      </div>

      {selection?.lockedReason && <p className="helper">{selection.lockedReason}</p>}
      <p className="rights-notice">{RIGHTS_NOTICE}</p>
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
    </section>
  )
}

/** One shelf picture with its tick box: the whole tile is the label, the box is always visible. */
function SelectableTile({ asset, selection }: { asset: Asset; selection: ShelfSelection }) {
  const ticked = selection.selected.includes(asset.id)
  const full = !ticked && selection.selected.length >= selection.max
  const locked = Boolean(selection.lockedReason)
  const disabled = locked || full
  return (
    <label
      className={`asset-tile is-selectable${ticked ? ' is-ticked' : ''}${disabled ? ' is-disabled' : ''}`}
      title={full ? `The Director reads at most ${selection.max} references. Untick one first.` : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the stored bytes, served by id */}
      <img src={`/api/image/${asset.blobId}`} alt="" />
      <span className="asset-tick">
        <input
          type="checkbox"
          checked={ticked}
          disabled={disabled}
          onChange={() =>
            selection.onChange(
              ticked ? selection.selected.filter((id) => id !== asset.id) : [...selection.selected, asset.id]
            )
          }
        />
        <span className="asset-tick-name" title={asset.name}>
          {asset.name}
        </span>
      </span>
    </label>
  )
}
