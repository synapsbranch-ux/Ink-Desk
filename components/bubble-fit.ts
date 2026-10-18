'use client'

// Two small helpers for the speech bubble on any screen size (v3, slice 23).
//
// `useLetteringFit`: the lettering starts at a size taken from the panel
// (container units, `app/responsive/page.css`), so a small panel has small
// lettering, as the export does. A long line in a small bubble can still run
// past its box, so the size is then stepped down until every word fits — never
// cut off, never broken mid-word. Only when even the floor size cannot fit is
// the text let out of its box (`is-overfull`), still whole.
//
// `useCoarsePointer`: true on a touch screen, where the bubble is edited
// through a sheet rather than dragged. False on the server and on a mouse.
import { useCallback, useLayoutEffect, useSyncExternalStore, type RefObject } from 'react'

/** The smallest lettering the fit will set, in px. */
const FLOOR = 6

function fits(el: HTMLElement) {
  return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1
}

/** Size one lettering element to its box. Safe to call often: a few layouts at most. */
export function fitLettering(el: HTMLElement | null) {
  if (!el || !el.isConnected) return
  el.style.fontSize = ''
  el.classList.remove('is-overfull')
  if (fits(el)) return
  const base = parseFloat(getComputedStyle(el).fontSize) || 11
  el.style.fontSize = `${FLOOR}px`
  if (!fits(el)) {
    el.classList.add('is-overfull')
    return
  }
  // Largest size that fits, to a tenth of a pixel.
  let lo = FLOOR
  let hi = base
  for (let i = 0; i < 8 && hi - lo > 0.1; i++) {
    const mid = (lo + hi) / 2
    el.style.fontSize = `${mid}px`
    if (fits(el)) lo = mid
    else hi = mid
  }
  el.style.fontSize = `${Math.floor(lo * 10) / 10}px`
}

/** Fits `ref`'s lettering whenever `deps` change and once the web fonts land.
 *  Returns a refit for edits the DOM makes on its own (typing). */
export function useLetteringFit(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  const refit = useCallback(() => fitLettering(ref.current), [ref])
  useLayoutEffect(() => {
    refit()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what changes the box or the words
  }, deps)
  useLayoutEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts) return
    let live = true
    void fonts.ready.then(() => live && refit())
    fonts.addEventListener('loadingdone', refit)
    return () => {
      live = false
      fonts.removeEventListener('loadingdone', refit)
    }
  }, [refit])
  return refit
}

const COARSE = '(pointer: coarse)'

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(COARSE)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE).matches,
    () => false
  )
}
