# Pulse shows only what has something to say

Owner, 2026-10-19: "the idea of pulse is not just to have a cockpit to monitor, it should
be smart as well. for example, in this view if no emails sent, no web answers cleaned then
owner does not need to see these. the cards should be dynamic and be visible when they really
have any data."

This reverses two earlier rules: Kept safe tiles "the same at zero and above" (DESIGN.md §7.27,
owner 2026-10-18) and "a quiet week shows zeros, says so" (team-performance.md). The new rule
replaces them for Pulse's top tiles; the reversal is the owner's.

## Approved direction (design review D3, 2026-10-19)

**Quiet chips (variant C).** A tile with nothing to show folds into a small chip in one row at
the foot of the tiles: its icon, its name and its zero ("emails sent 0"). A chip opens its tile.
Mockup: `~/.gstack/projects/agentvivekkumar-dontbemichael/designs/pulse-smart-tiles-20261019/`
(approved.json, variant C).

## Decisions (design review, 2026-10-19)

### Information architecture (Pass 1)

- **1A, what counts as data.** A tile shows when its number is above zero in this period, or,
  while Compare is on, in the span before. Otherwise it is a chip. A drop to zero therefore
  stays a tile with its two bars; toggling Compare can bring tiles back.
- **1B, Spent always shows**, in every period, with plan use on a Claude plan ($0.00 included).
- **1C, Team at work folds the quiet.** Members with no working time in the period fold into
  one last row, "9 more were quiet", which opens to show their rows. A member with any working
  time keeps a full row. The headline is unchanged.
- **1D, Recommendations before advice:** no card. One short `ink-3` line under the header:
  "Advice from Thu, Oct 29" before two weeks; "Nothing to change this week" after. The why sits
  behind the header's (i). Advice cards and Saved by your changes are unchanged. Later the
  same day (owner, 2026-10-19), Early look insight cards take this line's place before two
  weeks whenever the advice rules already see something (team-performance.md, Early patterns;
  DESIGN.md §7.27).
- **1E, one grid, one chip row.** Every tile with data flows into one grid under "What got
  done", in today's order: emails organized, emails sent, tasks finished, scheduled checks,
  questions to the internet, web answers cleaned, messages held, steps blocked, what the team
  learned, questions to you, Spent, your time. The Kept safe and row-of-four tiles keep their
  own builds. One chip row follows the grid, above Team at work, in the same order.

```
 Pulse  [Today v]  Compare ( )                         Collecting since ...
 Recommendations (i)
   Advice from Thu, Oct 29                    <- one ink-3 line, or advice cards
 What got done
   [emails organized 5] [Spent $0.01]          <- only tiles with data, today's order
   (send) emails sent 0  (check) tasks finished 0  (clock) scheduled checks 0  ...  <- chip row
 Team at work (i)
   headline
   Pam      ======================  $0.01
   Michael  ========                $0.00
   9 more were quiet  >                        <- opens to their rows
```

### States (Pass 2)

- **2A, opening a chip** puts its tile back in the grid at its usual place, with its zero, its
  (i) and, with Compare on, its bars. The chip leaves the row. Opened tiles stay until the
  period changes or the owner leaves Pulse; then the 1A rule applies again.
- **2B, a period with no activity** has no special state: the Spent tile, the chip row, and
  Team at work with everyone folded under the headline "Nobody has worked yet today" (per
  period: "this week", "this month").

| Part | Loading | Empty (no data) | Error | With data | Partial |
|---|---|---|---|---|---|
| A top tile | the existing skeleton | a chip in the row | the view's existing "unavailable" card | the tile | Compare on, before only: the tile with its two bars |
| Chip row | none until the snapshot lands | not shown when every tile has data | not shown | the chips, in grid order | shrinks as chips are opened |
| Spent | skeleton | always a tile ($0.00 included) | as today | as today | API key or no known price: as today |
| Recommendations | none | one `ink-3` line (1D) | as today | advice cards | as today |
| Team at work | as today | headline plus one folded row for everyone | as today | rows for members who worked, then "N more were quiet" | the folded row opens to the quiet rows |

### Motion (Pass 3)

- **3A, tiles arrive and leave with a short fade and slide**, about 150 ms on the app's ease, when
  a period change, Compare or a chip moves a tile between the grid and the chip row. Reduced
  motion snaps with no animation.

### Design system (Pass 5)

- **5A, the quiet chip** is a new DESIGN.md §7.27 entry: a 26 px pill, `neutral-soft` fill, no
  border; a 14 px `ink-3` icon; the name in `t-meta` `ink-2` and the count in mono `ink-3`. On
  hover it takes the `card` fill and a hairline border. Existing tokens only. The Kept safe,
  Learning and row-of-four tiles keep their builds.

### Accessibility (Pass 6)

- **6A, opening a chip moves focus to its tile.** The opened tile takes focus (it is focusable
  and labelled) and a polite announcement reads its name and number ("Emails sent, 0 today").
- **Chips are buttons**, in one wrapping row (no horizontal scroll), each labelled with its name,
  its number and the period, and a "Show tile" action ("Emails sent: 0 today. Show tile.").
- **"9 more were quiet" is a disclosure button** with `aria-expanded`; opening it keeps focus on
  the button and the quiet rows follow it in reading order.

- **Contrast holds:** chip name `ink-2` on `neutral-soft` is 7.9:1 (light) and 9.1:1 (dark); the
  count in `ink-3` is 4.7:1 and 5.7:1, all above 4.5:1. Chips are a pointer target in a desktop
  app; at 26 px they match the app's other pills.

### Responsive (Pass 6)

- **6B, the grid keeps its column count:** 4 columns wide (1100 px and up), 2 mid (760 px and
  up), 1 narrow, as today. Fewer tiles leave the end of the last row empty; a tile never
  stretches. The chip row wraps at every width.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Pulse, a quiet day | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/pulse-smart-tiles-20261019/pulse-smart-view.html | Quiet chips (variant C), updated after this review | App tokens, light and dark; chips open their tile with focus; folded quiet row; one-line Recommendations; 4, 2, 1 columns at 1100 and 760 px |

## NOT in scope

- Kept safe, Learning and row-of-four tile builds: unchanged (1E); they only move between the
  grid and the chip row.
- Advice cards and Saved by your changes: unchanged (1D).
- Remembering opened chips across visits: opened tiles last until the period changes or the
  owner leaves Pulse (2A), by design.
- An owner setting to pin or hide tiles: not asked for; the 1A rule decides.

## What already exists

- `StatTile`, `TileTitle`, `WeekBars`, `InfoTip` and the `card` style in
  `src/renderer/src/components/pulse/PulseView.tsx`: tiles, Compare bars and the (i).
- The `layout` breakpoints (`wide` 1100 px, `mid` 760 px) and `grid(n)` / `row4`: reused as is
  (6B).
- Tokens `--cth-neutral-soft`, `--cth-ink-2`, `--cth-ink-3`, `--cth-line-2`, `--cth-ease`,
  `--cth-r-pill`: the chip needs no new token (5A).
- The existing Pulse skeleton and "unavailable" card: the loading and error states (2B table).

## Implementation Tasks

Synthesized from the design review and the eng review (2026-10-19). Effort assumes feature work
at about 30x and tests at about 50x human to CC time. Merge main into the running branch first:
PulseView changed on main after 0.2.3 (PR 497, 9f9b1107).

Built 2026-10-19 on the running branch (main merged first as 7294eaaa; main had meanwhile
started the backfill when Pulse opens, 8854781d). Notes from the build:
- A tile or chip fades in when it arrives; one that leaves goes at once (its chip fades in in
  its place). React unmounts the leaving element, so a fade out would need a held copy; not
  worth it for 150 ms.
- The opened tile's wrapper is the focus target (`pulse-tile-<id>`, `tabIndex={-1}`, a named
  group), so no tile build changed.
- `pulse.safe.title`, `pulse.learning.title` and `pulse.work.none` left the locales: nothing
  reads them now.

- [x] **T1 (P1, human: ~3h / CC: ~10 min)** shared: the show or fold rule as a pure function
  - Surfaced by: design 1A, 1B, 1E; eng R2 (D2 A)
  - Files: src/shared/pulseTiles.ts (new), test/pulse-tiles.test.cjs (new)
  - Rule: `pulseTiles({ snapshot, keptSafe, learning, before, opened })` returns the tile ids
    shown, in today's order, and the quiet ones for the chip row. Web answers counts answers
    checked; Questions to you counts asks; Your time counts asks or the away share; every other
    tile its big number; Spent always; Compare's span before also keeps a tile; opened ids show.
  - Verify: `node --test test/pulse-tiles.test.cjs`, table driven rows for every tile at zero
    and above, Compare before only, opened, and an older snapshot with no keptSafe or learning
- [x] **T2 (P1, human: ~1h / CC: ~5 min)** shared: teamAtWork names only slow members as quiet
  - Surfaced by: eng R1 (D1 A)
  - Files: src/shared/teamPerformance.ts, test/team-performance.test.cjs
  - Verify: a row in the existing teamAtWork tests: a member with 0 ms gets no quiet chip and is
    not in `quiet`; a member under a quarter of the average still is
- [x] **T3 (P1, human: ~1 day / CC: ~30 min)** PulseView: one grid of tiles from T1 and one quiet
  chip row under it; columns stay 4, 2 or 1
  - Surfaced by: design 1E, 5A, 6B
  - Files: src/renderer/src/components/pulse/PulseView.tsx
  - Verify: test/pulse-view.test.cjs pins the chip build and that the grid reads T1; live check
- [x] **T4 (P1, human: ~3h / CC: ~10 min)** PulseView: a chip opens its tile, focus moves to it
  and a polite line reads it; opened tiles reset when the period changes (leaving Pulse unmounts
  the view, App.tsx:550)
  - Surfaced by: design 2A, 6A
  - Files: src/renderer/src/components/pulse/PulseView.tsx
  - Verify: live check by keyboard; pin the aria-live line and the period reset
- [x] **T5 (P1, human: ~3h / CC: ~10 min)** Team at work: members with no time fold into
  "N more were quiet" (a disclosure button with `aria-expanded`); with nobody working, the
  headline per period replaces `pulse.work.none`
  - Surfaced by: design 1C, 2B; eng R1
  - Files: src/renderer/src/components/pulse/PulseView.tsx
  - Verify: pins for the fold and the empty headline; live check
- [x] **T6 (P1, human: ~1h / CC: ~5 min)** Recommendations before advice: one `ink-3` line; the
  long reason moves behind the header's (i)
  - Surfaced by: design 1D
  - Files: src/renderer/src/components/pulse/PulseView.tsx
  - Verify: the adviceStarts pin rewritten for the short line (R3)
- [x] **T7 (P2, human: ~1h / CC: ~5 min)** 150 ms fade and slide on `--cth-ease`; reduced motion
  snaps
  - Surfaced by: design 3A
  - Files: src/renderer/src/components/pulse/PulseView.tsx, src/renderer/src/design/global.css
  - Verify: live check with Reduce motion on and off
- [x] **T8 (P1, human: ~2h / CC: ~10 min)** Locale strings (chip label, folded row, per period
  empty headline, the two Recommendations lines) in en, ar and zh-CN, no dashes
  - Surfaced by: design passes 1, 2, 6
  - Files: src/renderer/src/i18n/locales/en.json, ar.json, zh-CN.json
  - Verify: the locale parity test
- [x] **T9 (P1, human: ~1h / CC: ~10 min)** Docs: DESIGN.md §7.27 quiet chip and tile rule
  (replacing line 1279) with a 2026-10-19 change row; team-performance.md line 446
  - Surfaced by: the owner's reversal, design 5A
  - Files: branding/DESIGN.md, docs/designs/team-performance.md
  - Verify: read both against this plan
- [x] **T10 (P1, human: ~2h / CC: ~15 min)** Regression proof: rewrite the section order and
  adviceStarts pins, run the full suite, then one live check of a quiet day and a busy day,
  light and dark
  - Surfaced by: eng R3 (D3 A)
  - Files: test/pulse-view.test.cjs
  - Verify: `npm test`; the live check notes in the ship report

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                     |
  +====================================================================+
  | System Audit         | DESIGN.md §7.27 present; Pulse view only    |
  | Step 0               | 3/10; rules for tiles, chips, team, states  |
  | Pass 1  (Info Arch)  | 4/10 -> 9/10 after fixes                    |
  | Pass 2  (States)     | 3/10 -> 9/10 after fixes                    |
  | Pass 3  (Journey)    | 5/10 -> 9/10 after fixes                    |
  | Pass 4  (AI Slop)    | 8/10 -> 8/10, no issues                     |
  | Pass 5  (Design Sys) | 6/10 -> 9/10 after fixes                    |
  | Pass 6  (Responsive) | 5/10 -> 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 1 resolved (grid layout), 0 deferred        |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 generated, 1 approved (variant C, updated)|
  | Decisions made       | 12 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 -> 8/10                                |
  +====================================================================+
```

Unresolved decisions: none.

## Eng review (2026-10-19)

Target: this plan, `docs/designs/pulse-smart-view.md`, checked against
`src/renderer/src/components/pulse/PulseView.tsx`, `src/shared/teamPerformance.ts`,
`src/shared/teamLearning.ts` and `test/pulse-view.test.cjs` at d8b230d4.

### Scope Challenge

- Files the plan changes: PulseView.tsx, global.css, en/ar/zh-CN json, DESIGN.md,
  team-performance.md, test/pulse-view.test.cjs (8). Arrangement (owner rule: no arrangement
  questions): the show or fold rule goes in a new pure `src/shared/pulseTiles.ts`, tested by
  behavior through `test/load-ts.cjs`, so 9 files and no new service.
- Main has moved: PR 497 (pulse pixel buttons) and 9f9b1107 changed PulseView on main after
  0.2.3. Merge main into the running branch before building.
- Cross reference: TODOS.md "Backfill when Pulse first opens". On the first open after an
  update every count is zero for up to 30 s, so every tile shows as a chip until the backfill
  lands. Kept as that TODO; no change here.
- Correction (no behavior change): Pulse has no loading skeleton; before the first snapshot the
  body is empty (`PulseView.tsx:229`). The state table's "existing skeleton" reads "nothing, as
  today".

| Premise | Claim | Receipt | Verdict |
|---|---|---|---|
| Kept safe "same at zero" rule | DESIGN.md §7.27 | branding/DESIGN.md:1279 | true |
| "shows zeros, says so" | team-performance.md | docs/designs/team-performance.md:446 | true |
| Breakpoints 1100 and 760 px | layout | PulseView.tsx:66 | true |
| Today's tile order | outcomes order | teamPerformance.ts:328 | true |
| Plan use sits in Spent | headroom bar | PulseView.tsx:400 | true |
| "Unavailable" card is the error state | failed view | PulseView.tsx:220 | true |
| Loading uses a skeleton | loading | PulseView.tsx:229 | false (corrected above) |
| Folded members have no working time | team quiet | teamPerformance.ts:425 | conflict, R1 |

unverified=0

REALITY: premise-table finding 1 false claim corrected, 1 conflict to R1 PulseView.tsx:229
REALITY: already-done pass no quiet tile work on main; PulseView changed by PR 497, merge first PulseView.tsx:1
REALITY: surface-check n/a no CLI or route named; IPC pulse:snapshot unchanged PulseView.tsx:139
REALITY: binding-decisions pass Pulse reads only harness.db; no new store pulse-smart-view.md:23
REALITY: numbers pass breakpoints and contrast re-derived [measured: tokens.css:21] PulseView.tsx:66
REALITY: deferred-asks pass no linked issue pulse-smart-view.md:3
REALITY: pr-count pass one PR, the next ship of the running branch pulse-smart-view.md:127

Scope Challenge result: scope accepted as-is.

## Decision ledger

### R1: Team at work headline when quiet members fold
Finding: 1, P1, confidence 9/10, src/shared/teamPerformance.ts:425, eng review
Plan baseline: 1C, "The headline is unchanged" (approved, design review 2026-10-19)
Runtime evidence: `else if (m.busyMs < avgMs * 0.25) { chips[m.agentId] = { kind: 'quiet' }; quiet.push(m.agentId); }` so members with zero time are in `quiet`, and the headline reads "{{names}} were mostly quiet." (en.json pulse.work.headQuiet) with every name.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 headline quiet names | every member under a quarter of the average, zero time included | only members with some time under a quarter of the average; zero time members are counted by the folded row only | unchanged, every name, folded ones too |
| R2 what counts as data in a two number tile | pending | pending | pending |
Question D1:
D1: Should the Team at work headline still name members who did nothing? <gstack-qid:plan-eng-review-quiet-headline>
Project/branch/task: smart Pulse plan, eng review Scope Challenge, Team at work (decision 1C).
ELI10: Today the headline under Team at work names everyone who worked less than a quarter of the team average, as in "Pete, Angela, Oscar and 7 more were mostly quiet". Members who did nothing at all are in that list too. The plan now folds those zero members into one row, "9 more were quiet", and says the headline stays as it is, so the same people would be named twice, and members who did nothing would be called "mostly" quiet.
Stakes if we pick wrong: the headline becomes a long list of names that repeats the folded row, or it calls idle members "mostly quiet".
Recommendation: A, because each fact then shows once: the headline names the slow members, the folded row counts the idle ones.
Note: options differ in kind, not coverage; no completeness score.
Pros / cons:
A) Name only the slow ones (recommended) (human: ~1h / CC: ~5 min)
  ✅ The headline stays one short line even when most of the team was idle
  ✅ "Mostly quiet" stays true: it only names members who did some work
  ❌ Changes a shared rule (teamAtWork) that the headline and the row chips both use
B) Keep the headline as it is
  ✅ No change to the shared teamAtWork rule or to its existing tests
  ❌ With 9 idle members the headline lists 9 names right above "9 more were quiet"
Net: one clean line per fact versus leaving the shared rule untouched.
Header: Quiet names
Options:
A) Name only the slow ones (recommended)
The headline names members who worked a little ("Oscar was mostly quiet"); members with no time are only in "9 more were quiet".
B) Keep the headline as it is
The headline keeps naming everyone under a quarter of the average, including the members folded below.

State: approved
Actual answer: A) Name only the slow ones (D1, 2026-10-19)
Accepted scope: teamAtWork's `quiet` list and its "mostly quiet" headline name only members with busyMs > 0 under a quarter of the average; members with no time get no quiet chip from it and are counted only by the folded row (1C). Tests updated to match.
History: none

### R2: What counts as data in a tile with two numbers
Finding: 2, P1, confidence 9/10, src/renderer/src/components/pulse/PulseView.tsx:354, eng review
Plan baseline: 1A, "A tile shows when its number is above zero in this period, or, while Compare is on, in the span before" (approved, design review 2026-10-19)
Runtime evidence: `<StatTile icon="search" value={safe.webAnswers.clean} of={answers} ... open={answers > 0 ? ...` (web answers: the big number is cleaned, the list opens on checked); Questions to you shows `rate !== null ? rate.toFixed(1) : '…'` (PulseView.tsx:377), a rate that is null under 20 requests (teamLearning.ts:51); Your time holds two numbers, `s.yourTime.asks` and `s.awayShare` (PulseView.tsx:425, 432).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 headline quiet names | approved D1 A | approved D1 A | approved D1 A |
| R2 web answers cleaned | always shown | shows when any answer was checked (the "of N") | shows only when one was cleaned |
| R2 questions to you | always shown | shows when you were asked at least once | shows only when the rate is above 0 (null counts as none) |
| R2 your time | always shown | shows when you were asked, or the away share is above 0 | shows only when you were asked |
| R2 with Compare on | not applicable | the same measure in the span before | the same measure in the span before |
Question D2:
D2: In a tile with two numbers, which one decides whether it shows? <gstack-qid:plan-eng-review-tile-data-rule>
Project/branch/task: smart Pulse plan, eng review Scope Challenge, the show or fold rule (decision 1A).
ELI10: The plan says a tile shows when "its number" is above zero. Three tiles carry two numbers. Web answers shows "0 of 3": none cleaned, but 3 were checked, and its "See each answer" list opens on the 3. Questions to you shows a rate per 100 requests, blank under 20 requests. Your time shows how often you were asked and how much work happened while you were away. Option A counts the number that means something happened; option B counts only the big number.
Stakes if we pick wrong: a tile with real activity folds away (and its list with it), or a tile with nothing to say stays up.
Recommendation: A, because it keeps a tile whenever something actually happened in it, which is the owner's test ("visible when they really have any data").
Note: options differ in kind, not coverage; no completeness score.
Pros / cons:
A) Count what happened (recommended) (human: ~2h / CC: ~10 min)
  ✅ "0 of 3 web answers cleaned" stays up, and its list of the 3 checked answers stays one click away
  ✅ A day the team worked while you were away keeps Your time up even if nobody asked you
  ❌ A tile can show a 0 big number, which looks like the zeros the owner wanted gone
B) Only the big number
  ✅ Simplest rule to explain: a big 0 always becomes a chip
  ❌ "0 of 3" folds away, and the 3 checked answers are reachable only by opening the chip
Net: keep tiles where something happened versus a strict rule on the big number.
Header: Data rule
Options:
A) Count what happened (recommended)
Web answers shows when any answer was checked; Questions to you when you were asked; Your time when you were asked or work happened while you were away.
B) Only the big number
Each tile shows only when its big number is above zero; a blank rate counts as zero.

State: approved
Actual answer: A) Count what happened (D2, 2026-10-19)
Accepted scope: Web answers shows when any answer was checked (clean + pass > 0); Questions to you when you were asked (asks > 0); Your time when you were asked (yourTime.asks > 0) or the away share is above 0; every other tile on its big number; with Compare on, the same measure in the span before also keeps the tile; Spent always (1B).
History: none

### R3: Regression contract and how deep to verify
Finding: 3, P1, confidence 9/10, test/pulse-view.test.cjs:35, eng review
Plan baseline: T1 to T7 Verify lines (design review 2026-10-19): pins in test/pulse-view.test.cjs and a look in the app
Runtime evidence: `const order = ['pulse.recommendations', 'pulse.whatGotDone', 'pulse.safe.title', 'pulse.learning.title', 'pulse.whereMoneyWent', 'pulse.work.title']` and `assert.match(en.pulse.adviceStarts, /\{\{day\}\}[\s\S]*two full weeks/)` pin the layout this plan changes; Pulse tests are source pins, with behavior tests only for shared code (test/team-performance.test.cjs loads teamPerformance.ts through load-ts.cjs).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1, R2 | approved | approved | approved |
| R3 behavior to keep | unstated | each tile's number, words, (i), Compare bars, amber held and list buttons are the same whether it was shown at once or opened from a chip | same |
| R3 intended changes | unstated | section order pin and adviceStarts pin rewritten to the new layout | same |
| R3 proof | pins only | behavior tests for the new pulseTiles rule and the teamAtWork change, updated pins, and one live check of a quiet day and a busy day in the dev app | behavior tests and updated pins, no live check |
Question D3:
D3: How should we prove nothing else on Pulse changed? <gstack-qid:plan-eng-review-pulse-regression>
Project/branch/task: smart Pulse plan, eng review Section 3 (tests).
ELI10: Tiles now move between the grid and the chip row, so each tile must look and act exactly the same however it got there: its number, words, (i), Compare bars, the amber held tile and its list buttons. Two existing test pins describe the old layout (the section order and the long "Recommendations start" sentence) and will be rewritten. Both options add behavior tests for the new show or fold rule and the quiet headline change. Option A also runs the dev app once on a quiet day and a busy day to look at it; B stops at the tests.
Stakes if we pick wrong: a tile opened from a chip loses its Compare bars or list button and only the owner notices.
Recommendation: A, because Pulse tests read the source, not the screen, and the Dock More bug (2026-10-17) was found only by watching the real app.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Tests plus a live check (recommended) (human: ~3h / CC: ~20 min)
  ✅ Sees the real grid, chip row, focus move and fold in the running app, light and dark
  ✅ Catches what source pins cannot, like a tile that renders but lost its list button
  ❌ About 10 more CC minutes driving the dev app
B) Tests only (human: ~2h / CC: ~10 min)
  ✅ Faster, and the rule itself is fully covered by behavior tests
  ❌ Layout, focus and animation stay unchecked until the owner opens Pulse
Net: a one time look at the real screen versus closing on tests alone.
Header: Proof
Options:
A) Tests plus a live check (recommended)
Behavior tests for pulseTiles and the teamAtWork change, the two old pins rewritten, and one live check of a quiet and a busy day in the dev app.
B) Tests only
Behavior tests for pulseTiles and the teamAtWork change and the two old pins rewritten; no live check.

State: approved
Actual answer: A) Tests plus a live check (D3, 2026-10-19)
Accepted scope: keep each tile's number, words, (i), Compare bars, amber held tile and list buttons the same whether shown at once or opened from a chip; rewrite the section order pin and the adviceStarts pin to the new layout; behavior tests for pulseTiles and the teamAtWork change; one live check of a quiet day and a busy day in the dev app, light and dark.
History: none

Approval readiness: PASS (R1 D1 A, R2 D2 A, R3 D3 A, all 2026-10-19)

## Eng Review Body

### 1. Architecture

No issues found. The rule is a pure function over the snapshot the view already loads, so Pulse
still reads only `pulse:snapshot` (harness.db, owner 2026-10-15) and no new store, IPC or main
process work is added.

```
 pulse:snapshot(period, compare) ──► PulseView
                                       │ view.snapshot, view.keptSafe, view.learning,
                                       │ view.compare (before), opened (local state)
                                       ▼
                         pulseTiles()  (src/shared/pulseTiles.ts, pure)
                           ├─ Spent ─────────────────────────────► shown
                           ├─ now > 0, or before > 0 with Compare ─► shown
                           ├─ id in opened ──────────────────────► shown
                           └─ otherwise ─────────────────────────► quiet (chip)
                                       ▼
            one grid (4 | 2 | 1 cols)        chip row (wraps)
                 ▲                                │ click
                 └──── opened.add(id), focus tile, aria-live line
 period change ─► opened cleared        leave Pulse ─► view unmounts, opened gone
```

### 2. Code quality

No issues found. Each tile keeps its build (StatTile, the Learning, Spent and Your time tiles);
only where it renders changes. The grid cell wrapper takes the id and `tabIndex={-1}` for focus,
so no tile build changes.

### 3. Tests

```
CODE PATHS                                         USER FLOWS
[+] src/shared/pulseTiles.ts (new)                 [+] A quiet day
  ├── [GAP] each tile at 0 and above  ── T1          ├── [GAP] [→live] chips under the grid ── T10
  ├── [GAP] web answers 0 of 3 shows  ── T1          ├── [GAP] [→live] open a chip, focus moves ── T10
  ├── [GAP] your time on away share   ── T1          └── [GAP] [→live] fold opens quiet rows ── T10
  ├── [GAP] Compare before only shows ── T1        [+] A busy day
  ├── [GAP] opened id shows           ── T1          └── [GAP] [→live] no chip row ── T10
  └── [GAP] older snapshot, no keptSafe ── T1      [+] Period change
[+] teamAtWork (teamPerformance.ts:393)              └── [GAP] opened tiles reset ── T4 pin
  ├── [★★ TESTED] quiet under a quarter ── team-performance.test.cjs
  └── [GAP] zero time is not "mostly quiet" ── T2
[+] PulseView.tsx
  ├── [★ pin] section order  ── rewrite (R3)
  └── [★ pin] adviceStarts   ── rewrite (R3)

COVERAGE: 1/14 paths tested today | GAPS: 13, each mapped to T1, T2, T4 or T10
```

Regression contract (R3, D3 A): each tile's number, words, (i), Compare bars, amber held tile
and list buttons stay the same whether shown at once or opened from a chip.

Test plan artifact: `~/.gstack/projects/agentvivekkumar-dontbemichael/moblizeit-mit-1-1-scroll-expanded-response-f89475-eng-review-test-plan-*.md`.

### 4. Performance

No issues found. The rule checks 12 tiles per render; Pulse reloads only on open, period or
Compare change, `pulse:updated` and local midnight (PulseView.tsx:139 to 156).

### Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| pulseTiles on an older snapshot | `keptSafe` or `learning` missing after a restart | T1 row; existing fallbacks (PulseView.tsx:236, 242) | those tiles as chips at 0, no crash |
| First open after an update | counts are 0 until the backfill | 8854781d (main) starts the backfill when Pulse opens | chips, then tiles arrive (3A) |
| Chip opened, then `pulse:updated` | the tile now has data | T1 opened row | the tile stays, number updates |
| Focus target missing | tile id not rendered yet | T4 live check | focus stays on the page, no error |

Critical gaps: 0.

### Outside voice

Skipped by the owner's standing rule: Codex runs only as the adversarial pass at ship, with no
native replacement (owner, 2026-10-01).

### TODOS.md updates

None proposed. "Backfill when Pulse first opens" already covers the first open gap.

### Parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| T1, T2 | src/shared, test | merge main |
| T3 to T8 | src/renderer (pulse, design, i18n) | T1, T2 |
| T9 | branding, docs/designs | none |
| T10 | test, the dev app | T1 to T8 |

Lane A: T1, T2 then T3 to T8 then T10 (one view file, sequential). Lane B: T9 (independent).
Launch A and B together; T10 last.

### NOT in scope (eng)

- Starting the backfill from `pulse:snapshot`: kept as its TODO.
- Any change to what `pulse:snapshot` returns: the rule reads today's fields only.

### What already exists (eng)

- `test/load-ts.cjs` loads shared TypeScript for behavior tests (as team-performance.test.cjs
  does); pulseTiles uses it.
- `teamAtWork` (teamPerformance.ts:393) already sorts and marks quiet members; T2 narrows it.
- The view already unmounts when you leave Pulse (App.tsx:550), so opened tiles reset there with
  no extra code.

## Eng Review Completion Summary

- Step 0: Scope Challenge, scope accepted as-is
- Reality rows: 7/7 emitted, 0 unverified premises (1 false claim corrected)
- Architecture Review: 0 issues found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 13 gaps identified, all mapped to tasks; 1 finding (R3)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, skipped (owner rule: adversarial pass only)
- Parallelization: 2 lanes, 1 parallel / 1 sequential
- Lake Score: 1/1

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | codex, plan review and design phases | Independent 2nd opinion | 6 | skipped | owner rule (adversarial pass only) and D2 of the design review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 4 | ISSUES OPEN | 1 issues, 0 critical gaps (all decided, mapped to T1 to T10) |
| Design Review | `/plan-design-review` | UI/UX gaps | 5 | CLEAR | score: 3/10 -> 8/10, 12 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** codex, plan review phase, skipped (owner rule); design phase, skipped (design review D2); no findings.
- **VERDICT:** DESIGN CLEARED; eng review complete with every finding decided and mapped to tasks (status issues_open counts mapped work, not open questions). Ready to implement.

NO UNRESOLVED DECISIONS
