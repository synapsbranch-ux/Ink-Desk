'use client'

// A dialog under 480 px is a full-height sheet (app/responsive/shell.css). A
// phone's keyboard shrinks only the visual viewport, so `100dvh` alone can leave
// the primary button under the keys: this keeps `--sheet-top` and `--sheet-h`
// on the overlay matched to what is actually visible. Nothing changes where the
// browser has no visualViewport, or on a wider screen (the CSS ignores them).
import { useEffect, type RefObject } from 'react'

export function useSheetViewport(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!el || !vv) return
    const fit = () => {
      el.style.setProperty('--sheet-top', `${vv.offsetTop}px`)
      el.style.setProperty('--sheet-h', `${vv.height}px`)
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
    }
  }, [ref])
}
