// A hand-inked manga head for the intro — the problem told in pictures. It is
// drawn from a handful of traits (hair, eyes, brows, jaw, a mole), so the
// "drifting" faces differ exactly where a reader would notice, and the locked
// ones share every trait and change only their expression. Shading is a dot
// screen, as a letterer would lay tone, never a gradient.
import { useId } from 'react'
import { color } from '../theme'

export type FaceTraits = {
  hair: 'spiky' | 'swept' | 'long' | 'crop'
  hairTone: 'ink' | 'grey'
  eye: 'round' | 'narrow' | 'wide'
  brow: 'calm' | 'stern' | 'raised'
  mouth: 'neutral' | 'smile' | 'open' | 'set'
  /** 0 is the reference jaw; positive is wider and heavier. */
  jaw: number
  mole: 'left' | 'right' | null
}

export const REFERENCE_FACE: FaceTraits = {
  hair: 'spiky',
  hairTone: 'ink',
  eye: 'round',
  brow: 'calm',
  mouth: 'neutral',
  jaw: 0,
  mole: 'right',
}

const INK = color.ink
const SKIN = color.neutral100
const CLOTH = color.neutral200

const HAIR_FRONT: Record<FaceTraits['hair'], string> = {
  // Unruly spikes and a ragged fringe — the reference character.
  spiky:
    'M52 124 Q44 104 47 94 Q53 99 57 100 Q47 82 51 70 Q57 76 63 77 Q57 58 62 48 Q70 56 77 58 Q76 40 82 30 Q88 42 95 47 Q101 30 110 22 Q112 36 115 45 Q124 36 134 32 Q132 44 131 54 Q142 50 151 50 Q146 62 143 72 Q151 76 157 82 Q150 89 147 96 Q154 104 154 112 Q151 118 148 124 ' +
    'Q146 112 142 104 Q140 112 136 119 Q133 104 128 94 Q124 104 118 113 Q114 100 108 90 Q104 101 98 111 Q94 100 88 92 Q85 104 80 115 Q77 104 72 96 Q69 106 64 117 Q62 108 60 100 Z',
  // Swept to one side, the fringe in long blades.
  swept:
    'M50 126 Q42 84 62 58 Q82 36 112 38 Q146 42 156 78 Q160 100 152 126 Q148 110 141 101 Q139 92 134 86 Q133 98 126 104 Q124 92 116 84 Q106 100 84 110 Q90 100 92 92 Q80 104 64 112 Q64 104 62 98 Q58 108 56 118 Z',
  // A heavy straight fringe over the brows.
  long:
    'M52 120 Q46 60 100 50 Q154 60 148 120 Q142 108 138 110 Q134 100 126 110 Q122 98 114 110 Q108 98 100 110 Q92 98 86 110 Q80 100 74 110 Q66 102 60 112 Z',
  // Cropped close to the head.
  crop: 'M58 106 Q54 56 100 52 Q146 56 142 106 Q136 90 122 86 Q100 80 78 86 Q64 90 58 106 Z',
}

/** The cut-in strands of shine, where the hair is long enough to carry them. */
const HAIR_SHINE: Partial<Record<FaceTraits['hair'], string>> = {
  spiky: 'M70 72 Q86 58 106 58 M78 80 Q92 70 112 70 M116 60 Q128 62 136 70',
  swept: 'M68 70 Q88 52 116 52 M80 80 Q100 66 126 64',
  long: 'M66 76 Q84 62 106 62 M112 62 Q128 64 138 76',
}

/** The long cut's back hair, drawn behind the face and down past the jaw. */
const HAIR_BACK_LONG =
  'M46 120 Q38 60 100 46 Q162 60 154 120 Q158 170 166 204 Q150 202 140 196 Q142 160 138 130 L62 130 Q58 160 60 196 Q50 202 34 204 Q42 170 46 120 Z'

/** The viewer's left eye; the right is its mirror. Outer corner at x≈66. */
const Eye: React.FC<{ kind: FaceTraits['eye']; tone: string; clip: string }> = ({ kind, tone, clip }) => {
  // One drawing, opened or narrowed about its centre, so the variants keep
  // the hand of the reference and differ only in what a reader would notice.
  const t =
    kind === 'narrow' ? 'translate(0 40.32) scale(1 0.68)' : kind === 'wide' ? 'translate(-18.26 -27.72) scale(1.22)' : undefined
  const white = 'M67 124 Q79 113 96 119 Q93 131 82 132.5 Q72 131.5 67 124 Z'
  return (
    <g transform={t}>
      <clipPath id={clip}>
        <path d={white} />
      </clipPath>
      <path d={white} fill={SKIN} />
      <g clipPath={`url(#${clip})`}>
        {/* A dark iris lit from below through a dot screen, the way a manga eye is toned. */}
        <circle cx={83} cy={125} r={7.6} fill={kind === 'wide' ? color.neutral700 : INK} />
        <path d="M76 127 Q83 133.5 90 127 Q89 132.6 83 132.6 Q77 132.6 76 127 Z" fill={`url(#${tone})`} />
        <circle cx={83} cy={124.5} r={3.4} fill={INK} />
        <path d="M70 116 Q82 112 96 117 L96 121 Q82 117 70 121 Z" fill={INK} opacity={0.35} />
      </g>
      <circle cx={85.6} cy={121.6} r={2.3} fill={SKIN} />
      <circle cx={80.2} cy={128.4} r={1} fill={SKIN} />
      {/* The upper lash line, heavy to the outer corner, with its flick. */}
      <path d="M62 121.5 Q65 121 67.5 121.5 Q79 109 97 117.5 Q97.5 120 95.5 120.2 Q80 114 68.5 125.5 Q66 123 62 121.5 Z" fill={INK} />
      <path d="M71 130.5 Q75 132.6 80 133" stroke={INK} strokeWidth={1.2} fill="none" strokeLinecap="round" />
      <path d="M73 113.5 Q83 108.5 93 112" stroke={INK} strokeWidth={0.9} fill="none" strokeLinecap="round" />
    </g>
  )
}

const BROW: Record<FaceTraits['brow'], string> = {
  calm: 'M66 105 Q80 96 96 101 Q81 99.5 66.5 107 Z',
  stern: 'M66 99 Q82 100 97 108 Q82 103 66 101.5 Z',
  raised: 'M66 100 Q80 89 96 95 Q81 93 66.5 102.5 Z',
}

const Mouth: React.FC<{ kind: FaceTraits['mouth'] }> = ({ kind }) => {
  if (kind === 'open') {
    return (
      <g>
        <path d="M93.5 163 Q100 160.5 106.5 163 Q105.5 172.5 100 172.5 Q94.5 172.5 93.5 163 Z" fill={color.neutral800} />
        <path d="M96 169.5 Q100 168 104 169.5 Q102.5 172 100 172 Q97.5 172 96 169.5 Z" fill={color.neutral500} />
      </g>
    )
  }
  const d = { neutral: 'M94 165 Q100 166.4 106 164.6', smile: 'M91 162.5 Q100 170 109 162', set: 'M93 166 Q100 165 107 166' }[kind]
  return <path d={d} stroke={INK} strokeWidth={1.8} fill="none" strokeLinecap="round" />
}

export const MangaFace: React.FC<{ traits: FaceTraits; style?: React.CSSProperties }> = ({ traits, style }) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const tone = `tone${uid}`
  const toneLight = `toneLight${uid}`
  const j = traits.jaw
  const hairFill = traits.hairTone === 'ink' ? INK : `url(#${tone})`
  // A manga jaw: straight planes to a narrow chin.
  const chinY = 186 + j * 0.4
  const face = `M${60 - j} 96 C${60 - j} 120 ${63 - j} 140 ${71 - j * 0.6} 156 L94 ${chinY - 2} Q100 ${chinY + 2} 106 ${chinY - 2} L${129 + j * 0.6} 156 C${137 + j} 140 ${140 + j} 120 ${140 + j} 96 L140 70 Q100 40 60 70 Z`
  // The shadow side of the face, inside the jaw line.
  const shade = `M${132 + j} 104 C${136 + j} 124 ${134 + j} 142 ${127 + j * 0.6} 156 L108 ${chinY - 4} Q120 160 ${126 + j * 0.6} 136 Q${130 + j} 118 ${132 + j} 104 Z`
  return (
    <svg viewBox="0 0 200 240" style={style}>
      <defs>
        <pattern id={tone} width={3.2} height={3.2} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={3.2} height={3.2} fill={color.neutral400} />
          <circle cx={1.6} cy={1.6} r={1.05} fill={INK} />
        </pattern>
        <pattern id={toneLight} width={3} height={3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <circle cx={1.5} cy={1.5} r={0.62} fill={INK} />
        </pattern>
      </defs>
      {/* Hoodie and shoulders, after the reference sheet. */}
      <path d="M12 240 Q18 210 84 198 L100 222 L116 198 Q182 210 188 240 Z" fill={CLOTH} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="M128 202 Q178 212 188 240 L136 240 Q138 220 128 202 Z" fill={`url(#${toneLight})`} />
      <path d="M66 202 Q78 228 100 235 Q122 228 134 202" stroke={INK} strokeWidth={1.8} fill="none" />
      <path d="M92 231 L90 240 M108 231 L110 240" stroke={INK} strokeWidth={1.4} />
      {traits.hair === 'long' ? <path d={HAIR_BACK_LONG} fill={hairFill} stroke={INK} strokeWidth={1.2} /> : null}
      {/* Neck, with the jaw's shadow across it. */}
      <path d="M87 168 L113 168 L115 206 Q100 213 85 206 Z" fill={SKIN} stroke={INK} strokeWidth={1.8} />
      <path d="M86 180 L94 186 Q100 192 106 186 L114 180 L114.6 198 Q100 205 85.4 198 Z" fill={`url(#${toneLight})`} />
      {/* Ears. */}
      <path d={`M${61 - j} 110 C${51 - j} 106 ${50 - j} 131 ${63 - j} 136`} fill={SKIN} stroke={INK} strokeWidth={1.8} />
      <path d={`M${139 + j} 110 C${149 + j} 106 ${150 + j} 131 ${137 + j} 136`} fill={SKIN} stroke={INK} strokeWidth={1.8} />
      <path d={`M${57 - j} 116 Q${55 - j} 122 ${59 - j} 128`} stroke={INK} strokeWidth={1} fill="none" />
      <path d={face} fill={SKIN} />
      <path d={shade} fill={`url(#${toneLight})`} />
      <path d={face.replace(/ L140 70 Q100 40 60 70 Z$/, '')} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      {/* The fringe's shadow on the forehead. */}
      <path d="M62 104 Q100 98 140 104 L140 114 Q100 104 62 114 Z" fill={`url(#${toneLight})`} opacity={0.8} />
      <path d={HAIR_FRONT[traits.hair]} fill={hairFill} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      {traits.hairTone === 'ink' && HAIR_SHINE[traits.hair] ? (
        <path d={HAIR_SHINE[traits.hair]} stroke={color.neutral500} strokeWidth={1.3} fill="none" strokeLinecap="round" />
      ) : null}
      <path d={BROW[traits.brow]} fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      <g transform="translate(200 0) scale(-1 1)">
        <path d={BROW[traits.brow]} fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      </g>
      <Eye kind={traits.eye} tone={tone} clip={`eyeL${uid}`} />
      <g transform="translate(200 0) scale(-1 1)">
        <Eye kind={traits.eye} tone={tone} clip={`eyeR${uid}`} />
      </g>
      <path d="M101.5 137 Q100.5 145 98 149.5 Q100 150.6 102.5 150" stroke={INK} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Mouth kind={traits.mouth} />
      {traits.mole ? <circle cx={traits.mole === 'left' ? 88 : 113} cy={143} r={1.6} fill={INK} /> : null}
    </svg>
  )
}
