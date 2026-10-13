// Cost before spending (v2, slice 11): what a chapter will cost in images,
// worked out before a single one is generated. Pure — no environment, no
// imports — so the Director, the New-project dialog and `check:plan` all run
// the same arithmetic. See `devpost/spec.md > The Director (v2)` and
// `> Quality, Cost and Budget (v2)`.
//
// The figures are per image at each `quality`, from the spec's table:
//   • `low` and `medium` are measured — the slice 5 and slice 10 live runs
//     came back at $0.019–$0.025 per panel at `low`, and the kernel test's
//     `medium` panels at $0.024–$0.027;
//   • `high`, `xhigh` and `max` are the spec's estimates (OpenRouter bills
//     image tokens, and a dense scene costs about twice a plain one), so the
//     Director labels the number an estimate, always.
// The cover is one image at the panel quality, priced like a panel.

export type QualityFigure = { usd: number; measured: boolean }

export const PER_IMAGE_USD: Record<string, QualityFigure> = {
  low: { usd: 0.02, measured: true },
  medium: { usd: 0.026, measured: true },
  high: { usd: 0.09, measured: false },
  xhigh: { usd: 0.16, measured: false },
  max: { usd: 0.36, measured: false },
}

/** A quality this table doesn't know is priced as `high`, so an estimate is never optimistic by accident. */
export function perImage(quality: string): QualityFigure & { quality: string } {
  const known = PER_IMAGE_USD[quality]
  return known ? { ...known, quality } : { ...PER_IMAGE_USD.high, measured: false, quality }
}

/** Four panels a page — the one layout this build has. */
export const PANELS_PER_PAGE = 4

/** pageCount × 4 × the per-panel figure + the cover, in dollars. */
export function estimateChapterUsd(pageCount: number, quality: string): number {
  return round(chapterImages(pageCount) * perImage(quality).usd)
}

/** Every image a chapter needs: four panels a page, and the cover. */
export function chapterImages(pageCount: number): number {
  return Math.max(0, Math.trunc(pageCount)) * PANELS_PER_PAGE + 1
}

/** One page's four panels. */
export function estimatePageUsd(quality: string): number {
  return round(PANELS_PER_PAGE * perImage(quality).usd)
}

/** The estimate as one line for the screen — always called an estimate. */
export function estimateLine(pageCount: number, quality: string): string {
  const f = perImage(quality)
  const basis = f.measured ? `measured ≈ $${f.usd.toFixed(3)} an image` : `≈ $${f.usd.toFixed(2)} an image, not yet measured`
  return `Estimate: ≈ ${usd(estimateChapterUsd(pageCount, quality))} for ${pageCount} pages and the cover — ${chapterImages(pageCount)} images at ${quality} (${basis}).`
}

export function usd(n: number): string {
  return n > 0 && n < 0.005 ? '< $0.01' : `$${n.toFixed(2)}`
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
