'use client'

// One panel of the page: the pencil placeholder with its label, then the art
// inking in the moment it lands, with the speech bubble over it. Each panel
// owns its own status, so one landing never touches another.
// Implements `devpost/prd.md > Storyboard — The Main Studio`; the version
// stepper and the repair buttons arrive in slice 6.
import { useCallback, useState } from 'react'
import { PencilPlaceholder } from '@/components/PencilPlaceholder'
import { SpeechBubble } from '@/components/SpeechBubble'
import type { PanelSlot } from '@/lib/prompts'
import { bubbleCorner, currentImageId, panelLabel } from '@/lib/script'
import type { Character, Panel as PanelData } from '@/lib/types'

type Props = {
  slot: PanelSlot
  /** Null until the page script is written. */
  panel: PanelData | null
  character: Character | null
}

export function Panel({ slot, panel, character }: Props) {
  const imageId = panel ? currentImageId(panel) : null

  // Art already on the desk when this panel mounted shows at once; art that
  // lands afterwards plays the ink-in. A reload doesn't replay the reveal —
  // the reader does that on purpose, in slice 7.
  const [atMount] = useState(imageId)
  const [loaded, setLoaded] = useState<string | null>(null) // the id whose bytes are on screen
  const [inked, setInked] = useState<string | null>(null) // the id whose reveal has finished

  const arriving = imageId !== null && imageId !== atMount
  const showArt = imageId !== null && loaded === imageId
  const revealing = showArt && arriving && inked !== imageId
  // The pencil stays under the art until the ink wipe is done.
  const pencilUnder = !showArt || revealing
  const failed = panel?.status === 'failed' || panel?.status === 'refused'
  const still = !panel || failed

  const onLoad = useCallback(() => setLoaded(imageId), [imageId])
  // A cached image can be complete before `load` fires.
  const bind = useCallback(
    (el: HTMLImageElement | null) => {
      if (el?.complete && el.naturalWidth > 0) setLoaded(imageId)
    },
    [imageId]
  )

  const n = slot.index + 1
  const label = panel ? panelLabel(panel) : 'Waiting for the page script…'

  return (
    <figure
      className={`panel panel-${slot.shape}`}
      data-panel={slot.index}
      data-status={panel?.status ?? 'none'}
      data-inked={showArt && !revealing ? 'true' : undefined}
      aria-busy={panel?.status === 'inking' || undefined}
    >
      {pencilUnder && <PencilPlaceholder slot={slot} label={label} still={still} failed={failed} />}
      {imageId && (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own route as final bytes; this is the art the lock is judged on
        <img
          key={imageId}
          ref={bind}
          className={`panel-art${showArt ? '' : ' is-loading'}${revealing ? ' is-inking' : ''}`}
          src={`/api/image/${imageId}`}
          alt={character ? `${character.name}, ${slot.shot}` : `Panel ${n}`}
          onLoad={onLoad}
          onAnimationEnd={() => setInked(imageId)}
        />
      )}
      {panel && <SpeechBubble text={panel.dialogue} corner={bubbleCorner(panel)} faint={pencilUnder} />}
      <span className="panel-num" aria-hidden="true">
        {n}
      </span>
      <figcaption className="sr-only">
        Panel {n}
        {character ? `, ${character.name}` : ''}, {slot.shot}. {panel ? label || 'Inked.' : 'Waiting for the page script.'}
      </figcaption>
    </figure>
  )
}
