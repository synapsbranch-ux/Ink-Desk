---
doc: learner-profile
---

# Learner Profile

## Initial Idea
**Ink Desk — an AI manga creator studio.** The user pitches a story idea and the app helps them turn it into a manga page. Claude Sonnet generates the story, characters, and dialogue; an OpenAI image model generates character art, backgrounds, and panels.

Intended feel: "a real manga studio but stay beginner friendly," via a guided four-stage flow — **Story → Cast → Storyboard → Ink & Publish**.

- The learner says they **already have a UI concept** for it (not yet shared/reviewed).
- Stated as a *later* ambition, explicitly not part of the first build: integrating external comic APIs such as **LlamaGen**.

Intended users: "storytellers and manga fans who have ideas but can't draw, and want to see their story as a real manga page."

This is a starting point, not approved scope. `2-scope` should shape and cut this idea rather than run idea discovery — and should test whether a full page, the four-stage flow, and both model integrations fit a proof of concept.

## Demonstrated Technical and Agent Experience
**Reported:** Experienced professional full-stack developer who also teaches web development. Named stack: Express.js, Angular, Next.js, MongoDB, AWS. Uses AI coding agents "regularly, including Claude Code, on real projects."

**Observed in this conversation:** Arrived with a structured idea including a named flow, a model-per-concern split (text vs. image), and an explicit later-phase integration — consistent with the reported experience level.

Evidence: "I'm a professional full-stack developer (Express.js, Angular, Next.js, MongoDB, AWS) and I also teach web development."

Calibration: skip web-fundamentals explanations and setup hand-holding. Technical tradeoffs can be discussed directly in professional terms.

## Planning-Workflow Experience
**Familiar with planning first, new to flipped interaction.** Writes architecture and design docs for their own projects but has not used a formal flipped-interaction workflow.

Evidence: "I write architecture and design docs for my projects, but I haven't followed a formal flipped-interaction workflow like this one."

Note: planning-document experience is established; the unfamiliar element is the *interview dynamic itself*, not the concept of specifying before building. Keep familiar planning material concise; do not waive reviews or sign-offs.

## Desired Learning Outcome
Two intentions, both in their words:

1. **"How to keep character art consistent across AI-generated panels."** A concrete technical capability, and a live design question for `4-spec` — not a side topic.
2. **"Whether this flipped workflow is worth teaching."** They teach web development, so they are evaluating the method itself with a view to reusing it with students.

`5-build`'s learning wrap-up should speak to both: what actually produced character consistency, and an honest read on the workflow.

## Learning Moments
- `1-start`: Named character consistency across panels unprompted as the thing they want to understand, before any technical discussion — so it's a genuine curiosity, not a reaction to a constraint I raised.

## Interests, Inspirations, and Goals
- **Audience-facing, not personal:** built for storytellers and manga fans "who have ideas but can't draw."
- **Hackathon entry:** "it needs to work end to end and look good in a demo video." Two hard requirements fall out of this — a complete end-to-end path (no dead-end stages), and visual quality good enough to film. Both should constrain scope decisions in `2-scope` and `3-prd`.
- Teaches web development, which is why the workflow evaluation matters to them.

Optional deeper discovery (interests/inspirations) was skipped in line with their concise-onboarding preference; goals and audience were captured directly.

## Vocabulary and Concepts Likely to Need Explanation
**Assume known:** web app architecture, APIs, state management, data modeling, deployment, framework tradeoffs, agent-assisted development.

**Worth explaining or exploring together (domain-specific, not general):**
- Techniques for character/style consistency in image generation — reference images, seeds, character sheets, prompt anchoring, image-to-image, inpainting. This is their stated learning goal, so explore options with them rather than deciding silently.
- Manga page conventions if they come up (panel grid, gutters, reading order, speech-balloon placement) — unknown whether they know these; ask rather than assume.
- Flipped interaction as a *facilitation method*, since they're assessing it for teaching.

Not mentioning a term is not evidence they don't know it.

## Collaboration and Communication Preferences
**Volunteered explicitly:** "Keep explanations concise and batch related questions where it makes sense."

Apply in all later skills: concise explanations, small batches of closely related questions (2–3 max), no re-explaining familiar ground. Preferences do not waive verification or approval gates.

## Areas Where the Learner Wants Ownership
Not explicitly stated. Two reasonable inferences to **confirm rather than assume**: the UI concept they already have (they may want its design honored), and model/prompting choices around character consistency (their stated learning goal — they likely want to make that call themselves rather than have it decided for them).

## Likely Support Needs
- **Known:** Guidance on the flipped-interaction method itself, since it's new to them — including why a question is being asked, given they're evaluating it for teaching.
- **Known:** Scope discipline. The idea spans two model providers, a four-stage flow, and a full manga page; demo-quality output is also required. Highest-value support in `2-scope` is an honest cut, not encouragement.
- **Known:** Thinking partnership on character consistency approaches.
- **Open question:** Whether they want the existing UI concept followed closely or treated as loose inspiration.
- **Open question:** Image-model cost and rate limits on a hackathon budget — not raised yet, but relevant once panel counts are decided in `3-prd`/`4-spec`.

## Review Format

<!-- Ask at the first planning-document review in the planning skills, unless already volunteered.
     `markdown` = review in the terminal.
     `html` = also create a visual HTML planning companion with meaningful diagrams
     and structured interactive reveals. Markdown stays canonical.
     Applies to scope, PRD, and spec only—never create an HTML build checklist. -->

`html`

Chosen at the `2-scope` review: "HTML companion, please. I'm evaluating this workflow for teaching, so I want to see what the visual review looks like. Markdown stays canonical." Generate an HTML companion for `prd.md` and `spec.md` too, and regenerate it after revisions. Never for the build checklist.

## Notes and Open Questions
- They have a **UI concept not yet shared**. `2-scope` or `3-prd` should ask to see or hear it before designing an interface — don't invent one over it.
- **LlamaGen / external comic APIs** are explicitly a later ambition. Keep out of proof-of-concept scope unless they argue for it; note it as a future direction so it isn't lost.
- Two providers (Anthropic text + OpenAI images) means two sets of keys, costs, and failure modes. Credentials belong in a local `.env` — never in chat, never committed.
- The demo-video requirement means the end-to-end path matters more than depth in any single stage. Useful tiebreaker when cutting scope.
- Workspace prepared in `1-start`: `devpost/` created; `.gitignore` written covering `/devpost/learner-profile.md`, `.env`, and `.env.*` with `!.env.example`. Nothing was tracked by git at that point, so no remediation was needed.
