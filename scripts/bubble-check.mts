// The speech-bubble rules, checked without a browser: the derived default
// sits in the corner the camera leaves free, the clamp keeps every layout
// inside the panel, the tail path is a real SVG path, a panel edit replaces
// the dialogue and stores percentages, and an edit before the script exists
// is refused, not dropped. Run with `npm run check:bubble`.
import assert from 'node:assert/strict'
import { bubbleLayout, clampBubble, defaultBubble, tailPath } from '../lib/bubble'
import { Refused } from '../lib/errors'
import { applyPatch, mergePatch } from '../lib/patch'
import { BubbleLayoutSchema, ChapterPatchSchema } from '../lib/schemas'
import { bubbleCorner, findPanel } from '../lib/script'
import { emptyChapter, type Chapter, type Panel } from '../lib/types'

function panel(index: 0 | 1 | 2 | 3, camera = 'eye level'): Panel {
  return {
    index,
    characterId: `c${index % 2}`,
    action: 'stands',
    camera,
    background: 'rooftop',
    dialogue: `Line ${index + 1}`,
    versions: [],
    currentVersion: 0,
    status: 'empty',
    startedAt: null,
    startedByRun: null,
  }
}

const chapter: Chapter = { ...emptyChapter('run'), script: [panel(0), panel(1), panel(2), panel(3)] }

// --- The derived default ---------------------------------------------------
// Panel 1's figure stands left, eye level → bubble top-right; looking down →
// it drops to the bottom. The default layout lands in that corner.
assert.equal(bubbleCorner(panel(0)), 'top-right')
assert.equal(bubbleCorner(panel(0, 'high angle, looking down')), 'bottom-right')
const d = defaultBubble(panel(0))
assert.ok(d.x > 50, 'top-right default sits in the right half')
assert.ok(d.y < 20, 'top-right default sits near the top')
assert.ok(d.tailY > d.y + d.h, 'the default tail reaches down toward the figure')
// A panel with no stored bubble renders the derived default, unchanged.
assert.deepEqual(bubbleLayout(panel(0)), d)
// A stored bubble wins over the default.
const placed = { x: 10, y: 60, w: 30, h: 20, tailX: 55, tailY: 50 }
assert.deepEqual(bubbleLayout({ ...panel(0), bubble: placed }), placed)

// --- The clamp -------------------------------------------------------------
const wild = clampBubble({ x: 95, y: -10, w: 300, h: 1, tailX: 180, tailY: -40 })
assert.ok(wild.x >= 0 && wild.x + wild.w <= 100, 'clamped inside horizontally')
assert.ok(wild.y >= 0 && wild.y + wild.h <= 100, 'clamped inside vertically')
assert.ok(wild.w >= 16 && wild.h >= 12, 'clamped above the readable minimum')
assert.ok(wild.tailX <= 100 && wild.tailY >= 0, 'tail tip clamped to the panel')

// --- The tail path ---------------------------------------------------------
// A real open SVG path: starts with M, one Q out to the tip, one Q back.
const path = tailPath(d)
assert.match(path, /^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ Q/)
assert.ok(path.includes(`${d.tailX}`), 'the path passes through the tail tip')

// --- The patch, through the real schema ------------------------------------
const parsed = ChapterPatchSchema.parse({
  panels: { '2': { dialogue: 'My line now.', bubble: placed } },
})
const edited = applyPatch(chapter, parsed)
assert.equal(edited.script![2].dialogue, 'My line now.', 'the user’s line replaces Claude’s')
assert.deepEqual(edited.script![2].bubble, placed, 'percentages stored on the panel')
assert.equal(edited.script![1].dialogue, 'Line 2', 'other panels untouched')
assert.equal(edited.script![2].versions.length, 0, 'art state untouched')

// Typing then dragging merges into one patch, newest edit winning.
const merged = mergePatch(
  { panels: { '2': { dialogue: 'First' } } },
  { panels: { '2': { bubble: placed }, '0': { dialogue: 'Other' } } }
)
assert.deepEqual(merged.panels!['2'], { dialogue: 'First', bubble: placed })
assert.equal(merged.panels!['0'].dialogue, 'Other')

// The schema turns away what the clamp shouldn't have to see.
assert.ok(!BubbleLayoutSchema.safeParse({ ...placed, x: 140 }).success, 'out-of-range % refused at the wire')
assert.ok(!ChapterPatchSchema.safeParse({ panels: { '7': { dialogue: 'x' } } }).success, 'panel 7 is not a panel')

// --- Refused before the script exists --------------------------------------
// The route checks every edited panel with findPanel; with no script that is
// a Refused, never a silent drop.
assert.throws(() => findPanel(emptyChapter('run'), 2), Refused)
// And the pure applyPatch ignores it rather than crashing (the browser side).
const ignored = applyPatch(emptyChapter('run'), parsed)
assert.equal(ignored.script, null)

console.log('  Speech bubble check passed.')
