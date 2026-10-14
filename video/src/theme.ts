// The brand, for the video. Values copied from app/globals.css (which ported
// them from the learner's mockup) — spec.md > The Demo Video Pipeline (v2).
// Keep the two in step by hand: the video is not the app and does not import
// its CSS.
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion'

export const color = {
  paper: '#f3f2f2',
  surface: '#eae9e9',
  ink: '#201f1d',
  hanko: '#b5382e', // the single brand red — primary actions and the seal only
  hanko100: '#fcecea',
  hanko200: '#f6d0cc',
  hanko300: '#eba49d',
  hanko400: '#d9746b',
  hanko500: '#c24a3f',
  hanko600: '#a2352b',
  hanko700: '#82281f',
  hanko800: '#5f1d17',
  hanko900: '#3e140f',
  neutral100: '#f8f4f4',
  neutral200: '#eae7e7',
  neutral300: '#d7d3d3',
  neutral400: '#bab6b6',
  neutral500: '#9b9797',
  neutral600: '#7d7979',
  neutral700: '#605d5d',
  neutral800: '#444141',
  neutral900: '#2d2b2b',
  divider: 'rgba(32, 31, 29, 0.16)',
} as const

export const font = {
  heading: "'Cormorant Garamond', 'Times New Roman', serif",
  body: "'Lora', Georgia, serif",
  letter: "'Comic Neue', 'Comic Sans MS', cursive", // dialogue lettering only
  headingWeight: 600,
} as const

// The mockup's halftone, in pure CSS (globals.css --halftone-*), scaled for a
// 1920×1080 frame.
export const halftone = {
  dots: `radial-gradient(circle, ${color.neutral400} 1.2px, transparent 1.8px) 0 0 / 8px 8px`,
  dotsFine: `radial-gradient(circle, ${color.neutral700} 1.1px, transparent 1.6px) 0 0 / 6px 6px`,
  bands: `repeating-linear-gradient(0deg, ${color.neutral300} 0 1px, transparent 1px 6px)`,
  sketch: `repeating-linear-gradient(25deg, ${color.neutral300} 0 1px, transparent 1px 11px)`,
} as const

export const shadow = {
  sm: '0 1px 2px rgba(45, 43, 43, 0.14)',
  md: '0 3px 10px rgba(45, 43, 43, 0.16)',
  lg: '0 12px 32px rgba(45, 43, 43, 0.22)',
} as const

/** --ink-speed in the app: the pencil → ink reveal. */
export const INK_SPEED_SECONDS = 1.4

export const brand = {
  mark: 'brand/inkdesk-mark.svg',
  logo: 'brand/inkdesk-logo.svg',
  logoDark: 'brand/inkdesk-logo-dark.svg',
} as const

// The three families, from the OFL files in public/fonts (licences beside
// them). Local files, so a render never depends on reaching Google Fonts.
const FACES: { family: string; file: string; style: string; weight: string }[] = [
  { family: 'Cormorant Garamond', file: 'fonts/CormorantGaramond.ttf', style: 'normal', weight: '300 700' },
  { family: 'Cormorant Garamond', file: 'fonts/CormorantGaramond-Italic.ttf', style: 'italic', weight: '300 700' },
  { family: 'Lora', file: 'fonts/Lora.ttf', style: 'normal', weight: '400 700' },
  { family: 'Lora', file: 'fonts/Lora-Italic.ttf', style: 'italic', weight: '400 700' },
  { family: 'Comic Neue', file: 'fonts/ComicNeue-Regular.ttf', style: 'normal', weight: '400' },
  { family: 'Comic Neue', file: 'fonts/ComicNeue-Bold.ttf', style: 'normal', weight: '700' },
]

let loading: Promise<void> | null = null

/** Registers the fonts once and holds the render until they are ready. */
export function loadFonts(): void {
  if (loading || typeof document === 'undefined') return
  const handle = delayRender('Loading the brand fonts')
  loading = Promise.all(
    FACES.map(async (f) => {
      const face = new FontFace(f.family, `url(${staticFile(f.file)})`, { style: f.style, weight: f.weight })
      await face.load()
      document.fonts.add(face)
    }),
  ).then(
    () => continueRender(handle),
    (err: unknown) => {
      // A missing font must not silently fall back to a system face on camera.
      cancelRender(new Error(`A brand font did not load: ${String(err)}`))
    },
  )
}
