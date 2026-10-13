// Style presets: the frozen rules text a project is locked to (v2). A preset
// is chosen once, at New project, and its rules are pasted verbatim into every
// sheet, panel and cover request for that project — the same job v1's single
// `STYLE_RULES` constant did, generalised. See `devpost/spec.md > Image Models
// and Style Presets (v2)` and `devpost/scope.md > The Unique Kernel (v2)`.
//
// A preset is rules text, not a reference picture: it needs no kernel test.
// Holding a *reference image* of a style steady is a candidate lock until its
// own test passes (slice 15). Rules never name a real work, artist or
// publisher — they describe a look.
//
// No imports and no environment: safe in the browser and in every check.

export type StylePresetId = 'manga-bw' | 'manhwa-colour'

export type StylePreset = {
  id: StylePresetId
  label: string
  /** One short line for the New-project dialog and the project card. */
  blurb: string
  /** Pasted verbatim at the end of every image prompt for the project. */
  rules: string
  colour: boolean
  /** How the finished chapter reads (slice 12): paged right-to-left, or one vertical scroll. */
  reading: 'paged-rtl' | 'vertical'
}

const NO_TEXT =
  'ABSOLUTELY NO TEXT, no speech bubbles, no sound effects, no signatures, no watermarks and no panel borders anywhere in the image.'

export const STYLE_PRESETS: Record<StylePresetId, StylePreset> = {
  'manga-bw': {
    id: 'manga-bw',
    label: 'Manga — black and white',
    blurb: 'Inked line, screentone, strong blacks. Reads right to left.',
    // v1's STYLE_RULES, word for word — proven by the kernel test in slices 1–2.
    rules: [
      'Black and white manga artwork, screentone shading, confident inked linework.',
      'Seinen style, detailed backgrounds, strong use of blacks.',
      NO_TEXT,
    ].join(' '),
    colour: false,
    reading: 'paged-rtl',
  },
  'manhwa-colour': {
    id: 'manhwa-colour',
    label: 'Manhwa — colour',
    blurb: 'Full colour, clean digital line, soft cel shading. Reads as one vertical scroll.',
    rules: [
      'Full-colour manhwa artwork, clean digital linework, soft cel shading with a bright key light,',
      'saturated but natural colours, detailed backgrounds, generous vertical framing.',
      NO_TEXT,
    ].join(' '),
    colour: true,
    reading: 'vertical',
  },
}

export const STYLE_PRESET_IDS = ['manga-bw', 'manhwa-colour'] as const satisfies readonly StylePresetId[]

export const DEFAULT_STYLE_PRESET_ID: StylePresetId = 'manga-bw'

export function isStylePresetId(id: string): id is StylePresetId {
  return (STYLE_PRESET_IDS as readonly string[]).includes(id)
}

/** The preset, falling back to the default for an id this build doesn't know. */
export function stylePreset(id: string): StylePreset {
  return isStylePresetId(id) ? STYLE_PRESETS[id] : STYLE_PRESETS[DEFAULT_STYLE_PRESET_ID]
}

/** The frozen rules text for a project. */
export function styleRules(id: string): string {
  return stylePreset(id).rules
}
