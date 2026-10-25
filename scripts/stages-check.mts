// The stage-line mapping is pure, so it is checked directly: the slice 5b
// acceptance says the line advances over time and never comes back empty.
// Run with `npm run check:stages`.
import assert from 'node:assert/strict'
import {
  formatElapsed,
  PANEL_STAGES,
  SHEET_FRESH_STAGES,
  SHEET_STAGES,
  stageLine,
  textStages,
  type Stages,
} from '../lib/stages'

// The three moments the checklist names: a panel's wait advances.
assert.equal(stageLine(PANEL_STAGES, 0), 'Sketching the pose…')
assert.equal(stageLine(PANEL_STAGES, 25), 'Adding screentone…')
assert.equal(stageLine(PANEL_STAGES, 70), 'Still inking — a dense scene takes longer…')

// Draw sheet starts with the AI writing the DNA (named by its role on screen since 6-ship, commit 873a6e4 — the
// hackathon's video rule); Redraw sheet starts drawing.
assert.equal(stageLine(SHEET_FRESH_STAGES, 0), 'The AI is writing the visual DNA…')
assert.match(stageLine(SHEET_STAGES, 0), /^Sketching/)

// A text wait opens with the caller's own line.
assert.equal(stageLine(textStages('Claude is reading your pitch…'), 3), 'Claude is reading your pitch…')

// Every kind has a non-empty line at any time, and the line only ever moves
// forward through its stages.
const all: Stages[] = [PANEL_STAGES, SHEET_STAGES, SHEET_FRESH_STAGES, textStages('Thinking…')]
for (const stages of all) {
  let last = -1
  for (let t = 0; t <= 300; t += 1) {
    const line = stageLine(stages, t)
    assert.ok(line.length > 0, `empty line at ${t}s`)
    const index = stages.findIndex(([, text]) => text === line)
    assert.ok(index >= last, `line went backwards at ${t}s`)
    last = index
  }
  // Past the last threshold it holds the final line forever.
  assert.equal(stageLine(stages, 10_000), stages[stages.length - 1][1])
}

// The elapsed count is real time, formatted m:ss.
assert.equal(formatElapsed(0), '0:00')
assert.equal(formatElapsed(7), '0:07')
assert.equal(formatElapsed(65), '1:05')
assert.equal(formatElapsed(600), '10:00')
assert.equal(formatElapsed(-3), '0:00')

console.log('  Stage line check passed.')
