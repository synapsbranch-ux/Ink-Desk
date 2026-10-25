# Ink Desk — narration script

<!--
  The words spoken over the demo, and the burned-in English captions (the same
  words, so they never disagree). Rewrite any line in your own words, then run
  `npm run video:narrate` — only the sections whose words changed are recorded
  again.

  One `## <id>` section per spoken beat of the edit (src/cut.ts); keep the ids.
  The final card is mute: it has no section here. A section left as a
  [bracketed placeholder] is a draft: it is captioned as written so you can
  judge the timing, and never sent to the voice. Comments like this one are
  never spoken.

  The word budget is what fits the beat at a calm pace (src/script.ts
  wordBudget): the voice starts 0.4 s into its beat and must end before the
  beat does. Stay at or under it — shorter is safer than longer; the check
  (`npm run check:demo-timeline`) refuses a section over its budget, and
  `npm run video:narrate` measures the real audio and says if a beat runs long.
  Rules from the hackathon: no third-party trademarks, under three minutes.
  Applied here: no provider or brand is named ("the AI", "an image model",
  "the hackathon's Learn Skill Pack"), and only what the app does is claimed:
  the face that holds across the panels, never more.
-->

## intro
<!-- The title card · 14 s · 28 words -->
For storytellers and manga fans who have ideas but can't draw. In most AI comic tools, the hero's face changes every panel. Ink Desk keeps one face. Watch.

## signin
<!-- The sign-in card, then the empty desk with New project · 10 s · 19 words -->
I sign in, and I'm in the studio. The desk holds every project. Mine is empty, for now.

## project
<!-- New project: the title, the style, the estimate, Create, the studio opens · 10 s · 19 words -->
I pick a title and a style: manga, black and white. That style stays fixed. Create: the studio opens.

## library
<!-- The scenario pasted, two characters proposed, my drawing, Use as sheet, the DNA, Lock, the second sheet, both locked · 20 s · 41 words -->
I paste the scenario. The AI proposes two characters. For the lead, my own drawing becomes the sheet. The AI writes its visual DNA beside it. Lock freezes both: the sheet, and the DNA, pasted word for word into every panel.

## director
<!-- The estimate before any drawing, the plan of page 1, the cover, Generate all · 16 s · 33 words -->
The Director plans the chapter: pages and a cover, one locked character per panel, with action, camera, setting and dialogue. Every line is editable. The estimate shows before any drawing. Generate all.

## pages
<!-- Panels inking one by one (time-lapsed), a bubble retyped, Redraw of panel 2, pages 2 and 3, the cover · 22 s · 46 words -->
Panels ink in. Every request carries the locked sheet and the DNA, word for word. The AI picks action and angle. The look is locked. Bubbles are overlaid by the app, never drawn by the model. I retype one. Redraw repeats the request, earlier version kept.

## moneyshot
<!-- My drawing, six panels and the cover, nothing retouched · 12 s · 24 words -->
My drawing, six panels, the cover. Nothing retouched. Compare the faces. The face held. I claim a proof of concept, not a guarantee.

## reader
<!-- The cover, then the pages right to left, Export PDF, the download · 12 s · 24 words -->
The reader opens on the cover, then the pages, right to left. Export PDF binds the whole chapter into one file, bubbles included.

## share
<!-- Share publicly, the link copied, the public page in a signed-out window with Report · 10 s · 19 words -->
Share publicly: a link anyone opens, no account. The visitor sees the chapter and Report. Nothing else of mine.

## method
<!-- The chain 1-start → 6-ship, the real scope, PRD and spec, the checklist with 23 slices ticked, the git log · 22 s · 46 words -->
Under the hackathon's Learn Skill Pack, the AI interviewed me before any code: scope, PRD, spec, each approved. Then 23 slices, each verified by a check script, committed, and checked hands-on. Every mid-build change sits in Revisions, in my words, so docs and code never drift.

## learned
<!-- The locked sheet beside a panel drawn from it; the last words of the film · 15 s · 30 words -->
What I learned about consistent character art across AI panels: one sheet, one DNA text, every request. The flipped workflow? Worth teaching. An honest proof of concept, not a guarantee.
