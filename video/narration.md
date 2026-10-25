# Ink Desk — narration script

<!--
  The words spoken over the demo, and the burned-in English captions (the same
  words, so they never disagree). They are YOURS: the hackathon's shipping skill
  says the narration is the learner's own: every line below was written by the
  learner (2026-10-25), not drafted. Then run `npm run video:narrate` — only the sections whose words changed
  are recorded again.

  One `## <id>` section per beat of the edit that has words (src/cut.ts);
  keep the ids. The outro is a silent title card and has no section. A section
  left as a [bracketed placeholder] is a draft: it is captioned as written so
  you can judge the timing, and never sent to the voice. Comments like this one
  are never spoken.

  The word budget is what fits the beat at a calm pace (≈ 2.2 words a second,
  src/script.ts wordBudget): the voice starts 0.4 s into its beat and must end
  before the beat does. Stay at or under it — shorter is safer than longer.
  `npm run video:narrate` measures the real audio and says if a beat runs long.
  Rules from the hackathon: no third-party trademarks, under three minutes,
  English. Applied here: name no provider or brand ("the AI", "an image model",
  "the hackathon's Learn Skill Pack"), and claim only what the app does.
-->

## intro
<!-- Problem and audience · 14 s · about 28 words -->
For storytellers and manga fans who have ideas but can't draw. In most AI comic tools, the hero's face changes every panel. Ink Desk keeps one face. Watch.

## signin
<!-- Sign in to the studio · 10 s · about 19 words -->
I sign in, and I'm in the studio. The desk holds every project. Mine is empty, for now.

## project
<!-- The desk, and a project · 10 s · about 19 words -->
I pick a title and a style: manga, black and white. That style stays fixed. Create: the studio opens.

## library
<!-- The scenario, the library and the locked cast · 20 s · about 41 words -->
I paste the scenario. The AI proposes two characters. For the lead, my own drawing becomes the sheet. The AI writes its visual DNA beside it. Lock freezes both: the sheet, and the DNA, pasted word for word into every panel.

## director
<!-- The Director's plan and its estimate · 16 s · about 33 words -->
The Director plans the chapter: pages and a cover, one locked character per panel, with action, camera, setting and dialogue. Every line is editable. The estimate shows before any drawing. Generate all.

## pages
<!-- Pages ink in, a bubble edit · 22 s · about 46 words -->
Panels ink in. Every request carries the locked sheet and the DNA, word for word. The AI picks action and angle. The look is locked. Bubbles are overlaid by the app, never drawn by the model. I retype one. Redraw repeats the request, earlier version kept.

## moneyshot
<!-- The money shot · 12 s · about 24 words -->
My drawing, six panels, the cover. Nothing retouched. Compare the faces. The face held. I claim a proof of concept, not a guarantee.

## reader
<!-- The reader and the PDF export · 12 s · about 24 words -->
The reader opens on the cover, then the pages, right to left. Export PDF binds the whole chapter into one file, bubbles included.

## share
<!-- A public link, opened signed out · 10 s · about 19 words -->
Share publicly: a link anyone opens, no account. The visitor sees the chapter and Report. Nothing else of mine.

## method
<!-- How it was built: the Learn Skill Pack, step by step · 22 s · about 46 words -->
Under the hackathon's Learn Skill Pack, the AI interviewed me before any code: scope, PRD, spec, each approved. Then 23 slices, each verified by a check script, committed, and checked hands-on. Every mid-build change sits in Revisions, in my words, so docs and code never drift.

## learned
<!-- What I learned, and how the skill helped · 15 s · about 30 words -->
What I learned about consistent character art across AI panels: one sheet, one DNA text, every request. The flipped workflow? Worth teaching. An honest proof of concept, not a guarantee.
