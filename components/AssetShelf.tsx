'use client'

// The project's reference shelf (v2, slice 10): upload your own pictures;
// any of them can become a character's locked sheet from the card below.
// The limits are checked here first so a wrong file never travels, and
// again on the server, which is the one that decides.
// Implements `devpost/prd.md > Scenario Mode and References` (the assets half).
import { useRef, useState } from 'react'
import { MAX_ASSETS, RIGHTS_NOTICE, sniffImage, UPLOAD_LIMIT_BYTES } from '@/lib/assets'
import type { Asset } from '@/lib/types'

type Props = {
  assets: Asset[]
  uploading: boolean
  notice: string | null
  onUpload: (file: File) => void
  onNotice: (sentence: string) => void
}

export function AssetShelf({ assets, uploading, notice, onUpload, onNotice }: Props) {
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
          <span className="eyebrow eyebrow-sm">Reference shelf · {assets.length} of {MAX_ASSETS}</span>
          <p className="asset-shelf-lede">
            Your own character drawings. Import one on a card below and it becomes that character’s locked sheet.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading || full}
          onClick={() => input.current?.click()}
          title={full ? 'The shelf is full.' : 'PNG, JPEG or WebP, up to 5 MB.'}
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
          assets.map((a) => (
            <figure key={a.id} className="asset-tile">
              {/* eslint-disable-next-line @next/next/no-img-element -- the stored bytes, served by id */}
              <img src={`/api/image/${a.blobId}`} alt={a.name} />
              <figcaption title={a.name}>{a.name}</figcaption>
            </figure>
          ))
        )}
      </div>

      <p className="rights-notice">{RIGHTS_NOTICE}</p>
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
    </section>
  )
}
