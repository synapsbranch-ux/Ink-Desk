// The limits' clock (v3, slice 20). Everything that expires or resets reads the
// time here, so `check:limits` can move it: a window slides, a day rolls over,
// a reset arrives — without waiting for any of them. In the app it is
// `Date.now()`. Nothing else may call `setClock`.

type Pinned = { __inkdeskLimitsClock?: () => number }
const g = globalThis as typeof globalThis & Pinned

export const nowMs = (): number => (g.__inkdeskLimitsClock ? g.__inkdeskLimitsClock() : Date.now())

/** Replace the clock (`null` puts the real one back). For the checks. */
export function setClock(fn: (() => number) | null): void {
  g.__inkdeskLimitsClock = fn ?? undefined
}
