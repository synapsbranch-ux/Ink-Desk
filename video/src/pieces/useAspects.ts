// The money shot is laid out from the pictures' real shapes (an upload can be
// any aspect; panels are 3:2 or 1:1), which the props do not carry — so the
// render waits, once, until every picture has been measured.
import { useEffect, useState } from 'react'
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion'

export function useAspects(paths: readonly string[], fallback = 1.5): number[] | null {
  const key = paths.join('|')
  const [aspects, setAspects] = useState<number[] | null>(null)
  const [handle] = useState(() => delayRender('Measuring the money-shot pictures'))
  useEffect(() => {
    let live = true
    let released = false
    const release = () => {
      if (!released) continueRender(handle)
      released = true
    }
    Promise.all(
      paths.map(
        (p) =>
          new Promise<number>((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : fallback)
            img.onerror = () => reject(new Error(`A money-shot picture could not be opened: ${p}`))
            img.src = staticFile(p)
          }),
      ),
    ).then(
      (list) => {
        if (!live) return
        setAspects(list)
        release()
      },
      // A missing picture must stop the render, not leave an empty frame on camera.
      (err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))),
    )
    // Unmounted before the pictures answered (scrubbing in the studio): let
    // the frame go rather than hold the render until it times out.
    return () => {
      live = false
      release()
    }
    // `key` stands for `paths`; the handle is created once per mount.
  }, [key])
  return aspects
}
