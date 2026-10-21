# Per-agent schedules

Status: draft, under design review (2026-09-25).

## Proposal (owner, 2026-09-25)

Right now the trigger UI is only reachable through Michael. That doesn't make sense.
Each agent should have its own trigger UI. That also removes the need for an
"Assigned to" option in the trigger UI, because a trigger belongs to the agent that
creates it.

## What exists today (from the code)

- The only trigger editor that's switched on is Schedules
  (`src/renderer/src/components/triggers/SchedulesSection.tsx`), inside Michael's
  `CommandCenterPanel` (`triggers` tab, `CommandCenterPanel.tsx:77-78`). It is rendered
  only for the god agent (`AgentDetailPanel.tsx:96`, `FullscreenTerminal.tsx:569-576`).
- Entry points: Michael's Triggers tab; the wall calendar in the CEO office
  (`scene/office/OfficeFloor.tsx:302-318`); voice `create_schedule` / `edit_schedule`
  (voice is off in this build).
- "Assigned to" is the GOES TO select, which writes `ScheduledMission.to`: an agent id,
  `'god'`, or `'broadcast'` (`SchedulesSection.tsx:160-166, 300-306`). No schedule records
  who created it.
- Webhooks, Slack and org triggers always route to Michael and are configured in
  Settings → Connections. Trigger History is Michael-only and appears only when a
  webhook exists.
- Built-in schedules: `OPS_STANDUP_MISSION` (to god, on), `HEARTBEAT_MISSION`
  (to god, off).
- Office packs already define per-agent `starterMissions: {agentId, title, schedule}`
  (`src/shared/officePack.ts:76-98`). They are validated but never seeded.
- Per-agent surfaces: the agent detail panel tab strip (`SidebarTabs.tsx`,
  terminal / messages / traces); the Edit Agent dialog (`EditAgentModal.tsx`, a
  two-column form with no tabs); `AgentCard` in the strip.

## Design decisions

### D2. Placement: a Schedules tab in each agent's panel (approved 2026-09-25)

- Add a `schedules` tab to the agent detail panel tab strip (`SidebarTabs.tsx`), after
  `messages`: terminal / messages / schedules / traces. It persists like the other tabs
  (`SidebarTab` in `store.ts`).
- The tab lists only that agent's schedules. There is no GOES TO field: a schedule
  created on Pam's tab belongs to Pam.
- The agent's card in the strip (`AgentCard`) shows the next run ("next: Mon 9:00")
  when the agent has an enabled schedule.
- Wireframe: `~/.gstack/projects/agentvivekkumar-dontbemichael/designs/per-agent-schedules-20260925/placements.html`, variant A.

### 1A. Office-wide view: read-only list on Michael's Triggers tab (approved 2026-09-25)

- Michael's `triggers` tab keeps a read-only **office schedule**: every enabled and
  paused schedule in the office, grouped by agent (roster order), rows sorted by next run.
- Clicking a row selects that agent and opens its Schedules tab with that row expanded.
  Read-only rows have no toggle and no inline editor.
- The CEO-office wall calendar keeps its entry point: it selects Michael and opens this
  tab (the existing `requestCommandCenterTab('triggers')`).

### 2A. Michael's own schedules: editable section at the top of his Triggers tab (approved 2026-09-25)

Michael's Triggers tab, top to bottom:

```
┌ TRIGGERS ─────────────────────────────────────────┐
│ {{godName}}'s jobs            (editable rows)       │
│   [DAILY 9:00] Morning standup        [on]          │
│   [♥ beat]     Heartbeat              [off]         │
│   add a schedule for {{godName}}                    │
├─────────────────────────────────────────────────────┤
│ Office schedule               (read-only, grouped)  │
│   Pam                                                │
│     [MON 9:00] Triage the inbox   next in 40m   ›   │
│   Oscar                                              │
│     [1ST 8:00] Close last month   next in 6d    ›   │
└─────────────────────────────────────────────────────┘
```

The editable section reuses the per-agent row component. Read-only rows end in a `›`
jump affordance instead of a toggle.

### 3A. "Everyone" schedules: Michael owns them and relays (approved 2026-09-25)

- GOES TO is removed everywhere. No schedule is ever addressed to "everyone".
- Migration: each existing schedule with `to: 'broadcast'` becomes one of Michael's
  jobs with the same label, schedule and enabled state.
- When it fires, the run body tells Michael to hand the job to each team member it
  applies to. The owner sees one row, under Michael.

### 4A. Delete asks first, inline (approved 2026-09-25)

Delete turns into `Sure? [delete it] [keep]` in place, the same pattern as webhook
delete. Esc or `keep` cancels, and focus returns to Delete.

### 5A. Empty state with starter jobs from the pack (approved 2026-09-25)

- Copy: "{{name}} has no jobs on a clock yet." Primary button: "add a schedule for {{name}}".
- If the office pack has `starterMissions` for this agent, show up to 3 below the button
  as "Suggested: <title>, <schedule>" rows, each with an `add` button. Adding one creates
  a **paused** schedule, so nothing runs until the owner turns it on.
- Render parsed schedules in the owner's language. Keep the remaining starters visible
  while all existing jobs match this member's pack starters; a custom job hides them.
- Use a hired member's source card, or the office business type then core for an original member.
- No pack, or no starters for this agent: copy and button only.

### 6A. Closed (archived) agents: pause and keep (approved 2026-09-25)

- Closing an agent that has enabled schedules warns first: "{{name}} has {{count}}
  schedules. They'll pause."
- When the owner closes the agent, all of its schedules are set to off and kept. "Closed"
  means the new `closedByOwner` flag (eng review R1), never `archived`: PTY exits and boot
  orphaning archive agents too, and must not pause anything.
- Michael's office list shows them under "{{name}} (closed)" with "{{name}} is closed, so
  these are paused." Rows are read-only, with no jump.
- Reopening the agent brings its schedules back, still paused.
- Migration: nothing is paused. No agent has `closedByOwner` yet, and `archived` is true for
  every non-running agent at boot (eng review R1).

### 7A. Honest loading, saving and errors (approved 2026-09-25)

- Loading: "One sec..." in place of the list.
- Load failure: "Couldn't load {{name}}'s schedules." plus a `Try again` button.
- `missions:save` returns success or failure. Save and the toggle show a pending state
  until it answers.
- On failure the row reverts to the saved state, keeps the unsaved edit, and shows
  "Didn't save. Try again." in coral with the alert icon (never color alone).

### Interaction states

```
FEATURE              | LOADING    | EMPTY                        | ERROR                         | SUCCESS            | PARTIAL
---------------------|------------|------------------------------|-------------------------------|--------------------|------------------------
Agent Schedules tab  | "One sec..."| 5A copy + add + starters     | 7A load error + Try again      | list, summary line | some rows paused (chip off)
Row toggle           | pending    | n/a                          | revert + "Didn't save."        | chip on/off        | n/a
Row edit + Save      | pending    | Save disabled until changed  | keep edit + "Didn't save."     | "saved" flash      | Add disabled w/o label or days
Row delete           | n/a        | n/a                          | revert + "Didn't save."        | row removed        | "Sure?" confirm (4A)
Michael office list  | "One sec..."| "No one runs jobs on a clock yet." | load error + Try again   | grouped list       | "(closed)" groups (6A)
Agent card next run  | hidden     | hidden                       | hidden                        | "next: Mon 9:00"   | hidden when all paused
```

### 8A. Agents can create and edit only their own schedules (approved 2026-09-25; amended by eng review D7)

**Amended (owner, eng review D7):** chat never changes a schedule directly. When the owner
asks Pam in chat, Pam sends a request, and it reaches the owner in ASK ME for approval.
Only the owner's approval adds, changes or deletes the schedule. The bullets below
describe the request's scope (its own schedules only) and the "added by" line on the
approved row.

- A hive tool lets an agent add, change, pause or delete **its own** schedules when the
  owner asks in chat ("Pam, check the invoices every Friday"). It can never read or
  change another agent's. Michael follows the same rule for his own jobs.
- `ScheduledMission` gains a `createdBy`: `'owner'` or the agent id. Existing rows
  migrate as `'owner'`.
- The row sub-line says who added it: "added by you" or "added by Pam". Everything an
  agent adds is visible on the tab and can be paused or deleted by the owner.

### 9B. No "editing moved" notice (owner choice 2026-09-25)

No one-time note on Michael's Triggers tab. The `›` jump on every read-only row is the
wayfinding. (Recommended 9A was declined: risk accepted that an owner may first try to
toggle a read-only row.)

### Journey storyboard

```
STEP | USER DOES                               | USER FEELS                 | PLAN SPECIFIES
1    | Opens app after update, clicks Michael  | "where did editing go?"    | 9B: rows jump with ›
2    | Clicks a row, lands on Pam's tab         | oriented                   | 1A jump, D2 tab
3    | Empty tab on a new agent, taps a starter | relieved, easy             | 5A (added paused)
4    | Turns it on; card shows "next: Mon 9:00" | in control                 | D2, 7A
5    | Tells Pam in chat "every Friday too"     | expects it done            | 8A, row says "added by Pam"
6    | Monday: row shows "fired 2h ago"         | trust                      | existing fired/next line
7    | Closes Pam for the season                | cautious                   | 6A warning, jobs pause
```

### 10A. Rows are a divided list, not boxed tiles (approved 2026-09-25)

- One `ink-100` hairline between rows. No per-row border or fill.
- The whole row is the click target: hover fill `cream-200`, focus ring per DESIGN.md §12.
- The expanded row uses the §6.1 `inset` variant (`cream-200` fill, `ink-100` inset).
- Row anatomy: when chip | job name (`body-md`) over sub-line (`body-sm`, `ink-500`:
  "fired 2h ago, next in 40m, added by you") | `Toggle`.

### 11A. Delete styling (approved 2026-09-25)

`Delete` stays a ghost `MiniButton` with coral text. In the 4A confirm, `delete it`
uses the DESIGN.md §7.2 destructive variant (coral fill, `on-accent` text) and `keep`
is secondary. Add a `destructive` tone to `MiniButton`.

### Design system notes (prior owner decisions, applied)

- 14px floor for owner-read text (owner decision 2026-09-16): the when chip uses
  Pixelify Sans 14px, not 8px Press Start 2P. Status and sub-line text is at least 13px
  per §4.2 `body-sm`, and owner-read copy is 14px.
- Every new string is in en, zh-CN and ar, uses `{{godName}}` for Michael (test
  `i18n-god-name`) and `{{name}}` for the agent, and has no dashes (test `no-dashes`).
- Reuse: `Toggle`, `MiniButton`, `SchedulePicker`, `Chip` from `triggers/ui.tsx`;
  `SidebarTabs` for the tab.

### 12A. Keyboard and screen reader (approved 2026-09-25)

- A row header is a `<button>` with `aria-expanded`. Enter or Space expands and collapses it.
- The shared `Toggle` (`triggers/ui.tsx:83`) becomes `role="switch"` with `aria-checked`
  and a label, e.g. "Run Triage the inbox". Re-test every screen that uses it.
- Office-list rows are buttons labeled "Open {{name}}'s schedules: <job>".
- Esc closes the 4A confirm and the row editor. Focus returns to the control that opened it.
- Closed, paused and error states are stated in text as well as color (§3.4, §12).
- Tab order within a row: header, toggle, then (expanded) fields, Save, Delete.

### 13B. Office list empty copy (owner choice 2026-09-25)

"No one on the team runs jobs on a clock yet." Statement only, no pointer.

### 14C. Tab labels to 14px in this change (approved 2026-09-25)

`SidebarTabs.tsx:50-51` labels move from 10px Press Start 2P to Pixelify Sans 14px, to
meet the 14px floor. Check that four tabs fit the 360px panel. If they don't, the strip
scrolls sideways with the selected tab kept in view; labels are not abbreviated.

## NOT in scope

- Webhooks, Slack and org triggers: they stay on Michael (Settings → Connections), and
  so does the History tab. They route to Michael by design.
- Voice `create_schedule` / `edit_schedule`: voice is off in this build. When it
  returns it follows 8A (owner-created, `createdBy: 'owner'`).
- The heartbeat's unsent PROMPT box: already tracked in TODOS.md ("Make the heartbeat's
  description honest").
- A week-grid calendar view (1C declined).
- Office hours / lunch pause for schedules: already TODOS.md (`officeHours`).

## What already exists (reuse)

- `SchedulesSection.tsx` (`MissionRow`, add flow, older-instructions block), `triggers/ui.tsx`
  (`Toggle`, `MiniButton`, `Chip`, `SchedulePicker`, `SubCard`), `SidebarTabs.tsx`,
  `CommandCenterPanel.tsx` tab routing and `requestCommandCenterTab`, `missions:list` /
  `missions:save` IPC plus the `missions:updated` push, `scheduleMessage.ts` run body,
  `officePack.ts` `starterMissions`, and the webhook delete confirm pattern in `SettingsModal.tsx`.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Agent panel Schedules tab | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/per-agent-schedules-20260925/placements.html (variant A) | Fourth tab in the agent panel, next run on the card | HTML wireframe (the image designer's OpenAI key was rejected). Final pixels follow 10A (divided rows), 11A (destructive confirm), 14C and the 14px chip font, which the wireframe predates. |

## Implementation Tasks

_Superseded by the eng review task list below; kept for history._

- [ ] **T1 (P1, human: ~1d / CC: ~30min)**: data model: add `createdBy` to `ScheduledMission`; migrate `broadcast` → Michael (3A), rows for archived agents → paused (6A), existing rows → `createdBy: 'owner'`; remove `to` from the UI.
  - Files: `src/main/config.ts`, `src/main/index.ts` (`syncMissions`, migrations), `src/shared/scheduleMessage.ts`
  - Verify: `node --test test/*.test.cjs`, new migration test
- [ ] **T2 (P1, human: ~1d / CC: ~30min)**: per-agent Schedules tab (D2, 10A, 11A): new `schedules` `SidebarTab`, a list filtered to the agent, no GOES TO, next run on `AgentCard`.
  - Files: `SidebarTabs.tsx`, `store.ts`, `AgentDetailPanel.tsx`, `triggers/SchedulesSection.tsx` (split out a per-agent list), `AgentCard.tsx`, `triggers/ui.tsx`
- [ ] **T3 (P1, human: ~4h / CC: ~20min)**: Michael's Triggers tab (1A, 2A, 13B): editable "{{godName}}'s jobs" section plus a read-only office list grouped by agent, `›` jump to the agent tab with the row expanded, and "(closed)" groups.
  - Files: `triggers/TriggersTab.tsx`, `CommandCenterPanel.tsx`, `store.ts`
- [ ] **T4 (P1, human: ~4h / CC: ~20min)**: states (4A, 7A): inline Sure? delete, loading and load-error copy, `missions:save` returns a result, pending and revert on failure.
  - Files: `index.ts` IPC, `preload/index.ts`, `SchedulesSection.tsx`
- [x] **T5 (P1, human: ~4h / CC: ~20min)**: empty state with pack starters (5A), added paused.
  - Files: `officePack.ts` read path, `SchedulesSection.tsx`
- [ ] **T6 (P1, human: ~1d / CC: ~40min)**: agent self-scheduling tool (8A): add/edit/pause/delete own schedules only; "added by" on the sub-line; agents told about it in their briefing.
  - Files: `src/main/hive.ts` (tool plus ownership check), `SchedulesSection.tsx`
  - Verify: a test that an agent cannot touch another agent's schedule
- [ ] **T7 (P1, human: ~2h / CC: ~10min)**: close-agent warning and pause-on-archive (6A); reopen keeps them paused.
- [ ] **T8 (P1, human: ~3h / CC: ~15min)**: accessibility (12A) on rows, the shared `Toggle` and office rows; re-test Settings toggles.
- [ ] **T9 (P2, human: ~1h / CC: ~5min)**: tab labels to Pixelify Sans 14px (14C); check fit at 360px.
- [ ] **T10 (P1, human: ~3h / CC: ~15min)**: strings in en, zh-CN and ar with `{{godName}}` / `{{name}}` and no dashes; update the regex tests that match `SchedulesSection.tsx`, `TriggersTab`, `michael-tabs`, `hidden-surfaces`, `standup-on-open`; update `docs/ARCHITECTURE.md` (Triggers on Michael) and `branding/DESIGN.md` §7 with the schedule row.
  - Verify: `node --test test/*.test.cjs`, `npm run typecheck`

## Completion Summary

```
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | branding/DESIGN.md canonical; UI scope yes  |
| Step 0               | 3/10 initial; all 7 passes + mockups        |
| Pass 1  (Info Arch)  | 4/10 → 9/10 after fixes                     |
| Pass 2  (States)     | 2/10 → 9/10 after fixes                     |
| Pass 3  (Journey)    | 3/10 → 8/10 after fixes (9B declined)       |
| Pass 4  (AI Slop)    | 7/10 → 9/10 after fixes                     |
| Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                     |
| Pass 6  (Responsive) | 4/10 → 9/10 after fixes                     |
| Pass 7  (Decisions)  | 1 resolved, 0 deferred                      |
+--------------------------------------------------------------------+
| NOT in scope         | written (5 items)                           |
| What already exists  | written                                     |
| TODOS.md updates     | 0 items (the one proposal is built now, 14C)|
| Approved Mockups     | 3 wireframed, 1 approved (A)                |
| Decisions made       | 15 added to plan                            |
| Decisions deferred   | 0                                           |
| Overall design score | 2/10 → 8/10                                 |
+====================================================================+
```

Outside voices: skipped by the owner. Image mockups: the gstack designer failed
(the OpenAI key in `~/.gstack/openai.json` was rejected), so an HTML wireframe stood in.

## Unresolved Decisions

None.

## Eng review (2026-09-25)

Target: `docs/designs/per-agent-schedules.md`. Report file: this plan.

### Scope record

feature answers: D1 = A (keep 8A, the agent self-schedule verb, in this PR; recommended B declined);
structure: D2 = B, smaller arrangement; accepted scope: every design decision above, built as
`src/shared/missions.ts` (pure: `migrateMissions`, `missionsFor(agentId)`, `nextRunAt`,
`canEdit(actor, mission)`) plus one `ScheduleList` component with modes `agent` | `office`;
pending remedies: R1, R2.

## Decision ledger

### R1: When do an agent's schedules pause for "closed"? (reopens design 6A)
Finding: 1, P1, confidence 9/10, `src/main/index.ts:504` and `:881`, reviewer: plan-eng-review (in-host)
Plan baseline: 6A (approved 2026-09-25): "On archive, all of that agent's schedules are set to off and kept."
Runtime evidence: `archived` is not an owner action. `index.ts:504` archives an agent whenever its PTY
dies (`hive.setArchived(agentId, true)` in the PTY exit path). `archiveOrphanedAgents()` (`index.ts:872-885`)
archives every non-god agent with no live PTY at boot. So "on archive" would pause every schedule after
a crash, a quit and relaunch, or any PTY exit, and 6A keeps them paused on reopen.
Comparison grid:
| Choice | Current (6A as written) | A | B |
|---|---|---|---|
| Pause trigger | any `setArchived(true)` | owner close only (the renderer close action and voice `archive`); PTY exit and boot orphaning never pause | no pausing; schedules keep firing into the inbox and run when the agent next starts |
| Close warning copy | "{{name}} has {{count}} schedules. They'll pause." | kept, owner close only | removed |
| "(closed)" group in office list | yes | yes, driven by a new `closedByOwner` flag, not `archived` | shows "(not running)" when no PTY, rows still on |
| Reopen behavior | stay paused | stay paused | n/a |
Question D3:
D3 — When should an agent's schedules pause because it was "closed"? (reopens design 6A) <gstack-qid:plan-eng-review-pause-trigger>
Project/branch/task: dontbemichael, per-agent schedules, design decision 6A.
ELI10: Design 6A says an agent's schedules pause when the agent is archived. In the code, archived does not mean "the owner closed Pam": index.ts:504 archives an agent whenever its terminal process exits, and archiveOrphanedAgents (index.ts:872-885) archives every agent without a live terminal at startup. As written, every quit, crash or relaunch would silently turn off every schedule in the office, and they would stay off.
Stakes if we pick wrong: the owner restarts the Mac and every job (inbox triage, invoice reminders, the month close) quietly stops running.
Recommendation: A because it keeps the owner's intent from 6A (closing Pam pauses her jobs) without tying it to process lifecycle (engineering preference: explicit over clever).
Completeness: A=9/10, B=7/10
Pros / cons:
A) Pause only when the owner closes the agent (recommended)
  ✅ A new closedByOwner flag is set only by the owner's close action (renderer close and voice archive); PTY exits and boot orphaning never pause anything
  ✅ Keeps 6A's warning, '(closed)' group and paused-on-reopen exactly as designed
  ❌ One more flag on the registry entry, and every close path must set it, with a test per path (human: ~4h / CC: ~20min)
B) Never pause; runs queue until the agent starts
  ✅ Simplest: no flag, and no hooks on close or archive
  ✅ A job that fires while Pam isn't running waits in her inbox and runs when she starts again
  ❌ Drops 6A: closing Pam for the season leaves her jobs piling up in her inbox, and the owner has no single 'stop her work' action
Net: honor the owner's close explicitly (A) or drop pausing (B).
Header: Pause trigger
Options:
A) Owner close only (recommended)
closedByOwner flag set only by the owner's close; PTY exit and boot never pause; 6A warning and (closed) group kept
B) Never pause
No pausing; jobs queue in the inbox until the agent runs; 6A's close warning and pause are dropped

State: approved
Actual answer: A) Owner close only (recommended), D3 answer 2026-09-25
Accepted scope: add `closedByOwner` to the registry entry, set only by the owner's close (renderer close action, voice `archive`) and cleared on reopen; pause that agent's schedules only on that flag; PTY exit (`index.ts:504`) and `archiveOrphanedAgents` never pause; 6A warning, "(closed)" group and paused-on-reopen kept; one test per close path plus a test that PTY exit and boot orphaning leave schedules on.
History: 6A approved in design review; reopened here on new runtime evidence.

### R2: How does the renderer save schedules?
Finding: 2, P1, confidence 9/10, `src/main/index.ts:4254-4269`, reviewer: plan-eng-review (in-host)
Plan baseline: 7A says `missions:save` returns success or failure; the save shape is unchanged (whole array).
Runtime evidence: `missions:save` takes the renderer's whole array and writes `incoming.map(...)`. Any
mission missing from that array is deleted. After this plan, main adds missions on its own (8A agent
verb, 5A starters from main, 3A and 6A migrations) and two views hold copies (agent tab, office list).
An owner saving from a tab loaded before Pam added a job deletes Pam's job.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Save API | `missions:save(array)` | `missions:upsert(mission)`, `missions:delete(id)`, `missions:setEnabled(id, on)`; main applies each to the current config; `missions:save` removed | keep `missions:save(array)` plus a `rev` counter; main rejects a stale rev and the UI reloads |
| Result shape (7A) | `{ ok: true }` always | `{ ok, error? }` per op | `{ ok, error?, stale? }` |
| Tests | none for loss | a test that an upsert never drops a mission it didn't name | a test that a stale rev is refused |
Question D4:
D4 — Replace the whole-list schedule save with per-schedule operations? <gstack-qid:plan-eng-review-missions-save-api>
Project/branch/task: dontbemichael, per-agent schedules, missions:save (index.ts:4254-4269).
ELI10: Today the screen sends back the entire list of schedules and the app writes exactly that list. Anything missing from it is deleted. That was fine with one screen. After this plan the app also adds schedules on its own (Pam's chat verb, migrations) and two screens hold copies, so saving from a screen opened five minutes ago deletes whatever Pam added since.
Stakes if we pick wrong: an owner pauses one job and silently wipes out a schedule an agent created, with no error anywhere.
Recommendation: A because each operation names the one schedule it changes, so a stale screen can't delete what it never saw (engineering preference: explicit over clever; thorough edge cases).
Completeness: A=10/10, B=8/10
Pros / cons:
A) Per-schedule operations (recommended)
  ✅ missions:upsert(one), missions:delete(id), missions:setEnabled(id, on), each applied by main to the current config and returning { ok, error? } for 7A
  ✅ The agent verb reuses the same three operations, so UI and chat can't disagree; the whole-list save is removed
  ❌ Three IPC handlers and preload methods replace one, and the store's save path is rewritten (human: ~4h / CC: ~20min)
B) Keep the whole-list save, add a revision number
  ✅ Smallest change: main refuses a save whose revision is stale and the screen reloads
  ✅ One handler stays; the existing merge-by-id logic is kept
  ❌ A refused save means the owner's click is thrown away and must be redone, and the agent verb still needs its own write path
Net: precise edits that can't clobber (A) or a staleness check that bounces (B).
Header: Save API
Options:
A) Per-schedule ops (recommended)
upsert/delete/setEnabled by id, applied to current config, { ok, error? } result; whole-list save removed; agent verb reuses them
B) Whole list + revision
Keep missions:save(array); reject stale revisions and reload the screen; agent verb gets a separate write path

State: approved
Actual answer: A) Per-schedule ops (recommended), D4 answer 2026-09-25
Accepted scope: replace `missions:save(array)` with `missions:upsert(mission)`, `missions:delete(id)`, `missions:setEnabled(id, on)`; main applies each to the config it reads at that moment and returns `{ ok, error? }` (7A); the whole-list save and its preload method are removed; the 8A agent verb calls the same three functions; tests that an op never drops a mission it didn't name and that a failed write returns `ok: false`.
History: none

### R3: How does an agent send a schedule change (8A mechanism)?
Finding: 3, P1, confidence 9/10, `src/main/hive.ts:2032` and `:1849`, reviewer: plan-eng-review (in-host)
Plan baseline: 8A (approved): "A hive tool lets an agent add, change, pause or delete its own schedules." Mechanism unspecified.
Runtime evidence: agents act by writing JSON into their own `outbox/`; the router sets `msg.from = id; // sender is authoritative — the owning directory` (`hive.ts:2032`). Messages to `scheduler` are dropped today as replies to a system sender (`hive.ts:1849`). Note: agents run with bypassPermissions and, outside business mode, `folderCheck` returns early (`hooks.ts:535`), so an agent could write into another agent's outbox or config.json; the ownership check stops honest mistakes, not a hostile agent (same ceiling as the 2026-09-24 enforcement deferral).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Transport | none | outbox message `"to": "scheduler"`, `"act": "request"`, with a `schedule` object `{op: add/update/pause/resume/delete, id?, label, when}`; router handles it before the drop | a bundled CLI (like the docText helper) the agent runs; it calls main over the hook socket with `AGENT_ID` |
| Actor identity | n/a | `msg.from` (owning directory) | `AGENT_ID` env of the calling process |
| Ownership rule | n/a | `canEdit(actor, m)`: `m.to === actor`; add forces `to = actor`, `createdBy = actor` | same |
| Writes | n/a | R2 ops | R2 ops |
| Reply to agent | n/a | inform message back: "Added: Check invoices, Fri 9:00" or the refusal reason | CLI stdout |
| Tests | n/a | router tests: add, edit own, refuse other's, malformed payload, unknown op | CLI + socket tests |
Question D5:
D5 — How does an agent send a schedule change? <gstack-qid:plan-eng-review-agent-schedule-transport>
Project/branch/task: dontbemichael, per-agent schedules, design 8A (agents manage their own schedules).
ELI10: 8A says Pam can add or pause her own jobs when the owner asks in chat, but not how. Agents already talk to the app by dropping a JSON message in their own outbox folder, and the app trusts the folder, not the message, for who sent it (hive.ts:2032). The other way is a small command-line helper the agent runs.
Stakes if we pick wrong: a second channel that identifies agents differently could let Pam's request land on Oscar's schedule, or give every provider a new tool to install.
Recommendation: A because it reuses the one channel every provider already uses and its trusted sender identity (Layer 1: reuse what exists).
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Outbox message to "scheduler" (recommended)
  ✅ Works for every agent provider today, since all of them already write outbox JSON; sender comes from the folder, not the message
  ✅ The router replies with a plain inform ("Added: Check invoices, Fri 9:00" or why not), so the agent can tell the owner
  ❌ The router gains a special recipient, and PROTOCOL.md plus both briefing templates need the new message shape (human: ~1d / CC: ~40min)
B) Bundled command-line helper
  ✅ Immediate answer on stdout, so the agent knows at once whether it worked
  ✅ Keeps the router untouched
  ❌ New binary per platform, a socket auth path keyed on an env var, and providers without shell tools can't use it
Net: reuse the trusted mail channel (A) or add a new tool path (B).
Header: Agent verb
Options:
A) Outbox to scheduler (recommended)
Agent writes {"to":"scheduler","schedule":{op,...}}; actor = owning folder; canEdit(to === actor); R2 ops; inform reply
B) CLI helper
Bundled command calls main over the hook socket with AGENT_ID; same ownership rule and R2 ops; stdout reply

State: approved, amended by D7
Actual answer: A) Outbox to scheduler (recommended), D5 answer 2026-09-25; amended by the owner's D7 answer
Accepted scope: agents send `{"to":"scheduler","act":"request","schedule":{op: add|update|pause|resume|delete, id?, label?, when?}}` from their own outbox; the router handles `scheduler` requests before the reply drop at `hive.ts:1849`; actor = `msg.from` (owning folder); `canEdit(actor, m)` is `m.to === actor`; add forces `to = actor`, `createdBy = actor`; writes go through the R2 ops; the router answers with an inform to the agent ("Added: <label>, <when>" or the refusal reason); PROTOCOL.md and both briefing templates (`hive.ts:268`, `:286`) document it; router tests for add, edit own, refuse another's, malformed payload, unknown op.
History: D7 (2026-09-25) reversed the direct-write part of 8A. The outbox-to-scheduler transport, actor = owning folder and `canEdit` still hold, but a `schedule` request no longer calls the R2 ops. It creates a pending proposal that the owner approves in ASK ME (R6), and only the owner's approval applies the op. The router replies to the agent "Asked {{godName}}'s owner..." wording is settled under R6.

### R4: Regression contract for the scheduler
Finding: 7, P1 (CRITICAL regression), confidence 9/10, `src/main/index.ts:732-800` (`syncMissions`), reviewer: plan-eng-review (in-host)
Plan baseline: no regression contract in the plan.
Runtime evidence: `syncMissions` arms interval and weekly schedules from `lastFiredAt`, sends `hive.send({ to: m.to, ... }, 'scheduler')`, stamps `lastFiredAt`, and delays the standup until office open. Tests: `standup-on-open.test.cjs` matches the send line by regex; `weekly-schedule.test.cjs` covers the pure weekly helpers; nothing arms or fires missions (`business-mode-office-packs.md:657`). This plan changes the save path (R2), `to` values (3A migration), pausing (R1) and adds agent writes (R3), all of which feed `syncMissions`.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Behavior preserved | untested | standup to Michael on open then every interval; heartbeat arming; weekly slots and catch-up; interval honors `lastFiredAt`; disabled never fires; `lastFiredAt` never lost by a UI op | same list |
| Intended changes | n/a | `broadcast` rows become Michael's with a relay body; owner-closed agents' rows are off | same |
| How it's proven | regex on one line | extract the per-mission decision (`armPlan(m, now)`: skip / interval delay / weekly delay / heartbeat) and the fire payload (`firePayload(m, godId)`) into `shared/missions.ts`; unit tests with fake clocks for every row above; keep the regex test | drive the real `syncMissions` under Electron with fake timers in an integration test |
| Effort | n/a | human ~1d / CC ~30min | human ~2d / CC ~1h, slower CI |
Question D6:
D6 — How do we prove the scheduler still fires correctly after this change? <gstack-qid:plan-eng-review-scheduler-regression>
Project/branch/task: dontbemichael, per-agent schedules, syncMissions (index.ts:732-800).
ELI10: The scheduler is the heart of this feature: it decides when each job fires and who gets it. Today almost nothing tests it (one test checks a single line by pattern). This plan changes everything that feeds it: how schedules are saved, who owns them, when they pause, and agents adding their own. We must lock in what it does now before changing it.
Behavior to preserve: standup to Michael on office open then every interval; heartbeat arming; weekly slots including a missed slot's catch-up; intervals honoring lastFiredAt; disabled schedules never fire; lastFiredAt never lost. Intended changes: 'everyone' rows fire to Michael with a relay body; owner-closed agents' rows are off.
Stakes if we pick wrong: a job silently stops firing or fires twice, and nobody notices until an invoice is missed.
Recommendation: A because pure functions with fake clocks cover every branch in milliseconds, and the Electron glue left in index.ts shrinks to a loop (tests non-negotiable, explicit over clever).
Completeness: A=9/10, B=9/10
Pros / cons:
A) Extract the decision, unit test it (recommended)
  ✅ armPlan(m, now) and firePayload(m, godId) in shared/missions.ts, tested with node --test and fake clocks for every preserved behavior and both intended changes
  ✅ Fits the D2 structure and the existing weekly-schedule test style; fast and deterministic
  ❌ The thin setTimeout loop left in syncMissions stays untested except by the existing regex (human: ~1d / CC: ~30min)
B) Integration test of the real syncMissions
  ✅ Exercises the actual timers and config writes end to end
  ✅ Catches glue bugs a pure test can't, like a missed missions:updated push
  ❌ Needs an Electron test harness this repo doesn't have yet; slower and flakier CI (human: ~2d / CC: ~1h)
Net: fast complete unit proof (A) or slower end-to-end proof (B).
Header: Regression
Options:
A) Extract + unit test (recommended)
armPlan/firePayload in shared/missions.ts; fake-clock unit tests for every preserved behavior and both intended changes; keep regex test
B) Electron integration test
Run real syncMissions with fake timers in a new Electron test harness; same behavior list

State: approved
Actual answer: A) Extract + unit test (recommended), D6 answer 2026-09-25
Accepted scope: move the per-mission decision into `shared/missions.ts` as `armPlan(m, now)` (skip / interval delay honoring lastFiredAt / weekly delay with catch-up / heartbeat / standup waits for office open) and `firePayload(m, godId)` (target and body, relay body for migrated broadcasts); `syncMissions` becomes a loop over `armPlan`; fake-clock unit tests for every preserved behavior (standup, heartbeat, weekly and catch-up, interval, disabled, lastFiredAt kept) and both intended changes (broadcast relay to Michael, owner-closed rows off); keep `standup-on-open.test.cjs`, updated to the new call site.
History: none

### R5: Duplicate jobs added by the agent verb
Finding: 8, P3, confidence 7/10, proposed R3 `add` op, reviewer: outside voice (ollama gpt-oss:20b), verified by plan-eng-review
Plan baseline: R3 add creates a schedule with no duplicate check.
Runtime evidence: nothing in `missions:save` or the proposed ops rejects a second mission with the same owner and label. An owner who repeats "Pam, check invoices every Friday" in two chats gets two rows that both fire.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| Agent `add` with same owner + label (case-insensitive) | creates a second row | refused; router replies "{{name}} already has <label>. Update it instead." | creates a second row | unchanged pending a look at real chat logs | this proposal left unresolved |
| Owner UI add | allows duplicates | unchanged (owner can name rows freely) | unchanged | unchanged | unchanged |
Question D7:
D7 — Should Pam's chat verb refuse to add a job she already has? <gstack-qid:plan-eng-review-agent-add-duplicate>
Project/branch/task: dontbemichael, per-agent schedules, agent schedule verb (R3).
ELI10: If the owner says "Pam, check invoices every Friday" twice, maybe in two chats a week apart, Pam will add two identical schedules and do the job twice every Friday. The outside reviewer flagged this and I confirmed nothing stops it. The owner's own Add button is left alone either way.
Stakes if we pick wrong: doubled work and doubled cost from a job the owner thinks exists once.
Recommendation: A because a one-line check in canEdit's neighbor stops a silent double-run and tells Pam to update instead (thorough edge cases).
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply: refuse a duplicate agent add (recommended)
  ✅ Same owner and same label (ignoring case) is refused, and the router tells Pam to update the existing one
  ✅ One check plus one router test; the owner's UI is untouched (human: ~1h / CC: ~5min)
  ❌ An agent that really wants two same-named jobs at different times must name them differently
B) Keep: allow duplicates
  ✅ No extra rule; the owner sees both rows labeled "added by Pam" and can delete one
  ✅ Zero work now
  ❌ Double-fires silently until the owner happens to look at the tab
C) Investigate before choosing
  ✅ Check real chat transcripts for how often owners repeat schedule requests
  ✅ Avoids a rule nobody needs
  ❌ The verb ships with no check meanwhile; the remedy stays pending
D) Defer this proposed change only
  ✅ Leaves the rest of R3 exactly as approved
  ✅ Can be picked up after launch with real usage
  ❌ Recorded as an unresolved decision in the report
Net: a tiny guard now (A) versus trusting the owner to notice (B).
Header: Duplicates
Options:
A) Apply this change (recommended)
Agent add refuses same owner + same label (case-insensitive); router tells the agent to update instead; owner UI unchanged
B) Keep current value
Agent add allows duplicate rows; owner sees both with 'added by' and can delete one
C) Investigate before choosing
Review real chat logs for repeated schedule requests; ship R3 without a check meanwhile; remedy stays pending
D) Defer this proposed change only
Leave this proposal unresolved; rest of R3 unchanged

State: approved (owner's own answer, none of A to D)
Actual answer: Other, D7 answer 2026-09-25: "do not let chat drive new scheduler addition or deletion or update. this should bubble up to business owner in ask me"
Accepted scope: the duplicate check is moot. No chat request changes a schedule directly; every add, update, pause, resume or delete an agent asks for becomes an owner approval in ASK ME (see R3 History and R6).
History: none

### R6: How does the owner approve an agent's schedule request in ASK ME?
Finding: 9, P1, confidence 9/10, `src/renderer/src/components/AskMeTab.tsx:13-29`, reviewer: plan-eng-review (in-host), from the owner's D7 answer
Plan baseline: D7 (owner): agent schedule changes "bubble up to business owner in ask me".
Runtime evidence: ASK ME shows blocked task cards from `hive/tasks.json` with `humanQA` entries; the owner answers in free text, which is written onto the card and mailed to Michael (`AskMeTab.tsx:24-28`). There's no approve/decline control, and per D7 neither Michael nor an agent may apply the change from a text answer.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Card | text Q&A only | new ASK ME card kind "schedule request": "{{name}} wants to add: <label>, <when>" (or change / pause / delete, with before and after) | ordinary ASK ME card with the request text and a "Open {{name}}'s schedules" button |
| Owner action | type an answer | `Approve` (primary) applies exactly the proposed op through R2; `Decline` (secondary) | owner makes the change by hand on the tab; the card is dismissed |
| Storage | tasks.json humanQA | pending requests in config `scheduleRequests[]` (id, agentId, op, payload, createdAt), not tasks.json | tasks.json card only |
| Agent told | answer mailed to Michael | router informs the agent: "Approved: ..." or "Declined: ..." | nothing automatic |
| Stale request | n/a | if the target schedule changed or was deleted since the request, Approve is disabled with "This changed since {{name}} asked." | n/a |
| Tests | n/a | request creates a pending item and never writes missions; approve applies once; decline writes nothing; stale target blocks approve; only own schedules can be requested | card created |
Question D8:
D8 — How does the owner approve an agent's schedule request in ASK ME? <gstack-qid:plan-eng-review-schedule-request-approval>
Project/branch/task: dontbemichael, per-agent schedules, your D7 answer (chat changes go to ASK ME).
ELI10: You decided Pam can only ask; you approve in ASK ME. Today ASK ME cards take a typed answer that goes to Michael, and nothing there can change a schedule. So we need either real Approve and Decline buttons on a schedule request card, or a card that sends you to Pam's Schedules tab to make the change yourself.
Stakes if we pick wrong: either approving is fiddly and requests pile up unanswered, or a typed 'yes' gets interpreted by an agent, which is exactly what you ruled out.
Recommendation: A because one click applies exactly what Pam asked for and nothing else, and no agent ever interprets your answer (explicit over clever).
Completeness: A=10/10, B=7/10
Pros / cons:
A) Approve and Decline buttons on a schedule request card (recommended)
  ✅ The card shows exactly what changes (before and after); Approve applies that one operation, Decline tells Pam, and nothing is ever parsed from text
  ✅ Requests are stored apart from tasks.json, so they never block the task board; a request whose schedule changed since is disabled, not applied
  ❌ A new card kind in AskMeTab plus a small request store and its IPC (human: ~1.5d / CC: ~45min)
B) Card links to Pam's Schedules tab
  ✅ Reuses the existing ASK ME card; the owner edits on the real tab with every 7A state
  ✅ Smaller build: no new store or approve path
  ❌ The owner must retype what Pam proposed, and deletes or changes are easy to get wrong by hand
Net: one-click exact approval (A) or a pointer plus manual edit (B).
Header: Approve flow
Options:
A) Approve/Decline card (recommended)
New ASK ME schedule-request card with before/after; Approve applies the exact op via R2; Decline informs the agent; stale requests disabled; stored in config scheduleRequests
B) Link to Schedules tab
Ordinary ASK ME card with the request text and a button to Pam's Schedules tab; owner makes the change by hand

State: approved
Actual answer: A) Approve/Decline card (recommended), D8 answer 2026-09-25
Accepted scope: an agent's `schedule` request (R3 transport, own schedules only via `canEdit`) creates a pending item in config `scheduleRequests[]` `{id, agentId, op, payload, createdAt}` and never writes missions; ASK ME shows a schedule-request card ("{{name}} wants to add: <label>, <when>", before and after for change, pause or delete) with `Approve` (primary, applies exactly that op through R2 once, `createdBy = agentId`) and `Decline` (secondary); the router informs the agent "Approved: ..." or "Declined: ..."; if the target schedule changed or was deleted since the request, Approve is disabled with "This changed since {{name}} asked."; requests are kept out of tasks.json; tests: request never writes missions, approve applies once, decline writes nothing, stale target blocks approve, another agent's schedule can't be requested.
History: none

Approval readiness: PASS (R1 D3-A, R2 D4-A, R3 D5-A amended by D7, R4 D6-A, R5 D7 owner answer, R6 D8-A; scope record D1-A, D2-B)

## Eng review outputs

### NOT in scope (eng)

- Hardening agent folder isolation outside business mode (`hooks.ts:535` returns early): the
  ownership check stops honest mistakes, not a hostile agent. Covered by the enforcement work
  already deferred on 2026-09-24.
- An Electron integration harness for `syncMissions` (D6 chose pure-function proof).
- Duplicate-label checks (D7 made them moot: the owner approves every agent request).

### What already exists (reuse)

`syncMissions` timer loop, `weeklyDelayMs` and `normalizeWeekly` (weekly-schedule tests), the
router's authoritative sender (`hive.ts:2032`) and system-sender drop (`hive.ts:1849`), the
`*Seeded` once-only migration convention (`index.ts:950`), `AskMeTab` card list and polling,
`triggers/ui` primitives, `SidebarTabs`, `requestCommandCenterTab`.

### Flow diagram

```
 OWNER UI (agent tab / Michael's own jobs)          AGENT (chat request)
   upsert / delete / setEnabled  ──┐                 outbox {"to":"scheduler", schedule:{op..}}
                                    │                          │  router: actor = folder owner
                                    │                          ▼  canEdit(actor, target)?
                                    │                 no ─► inform "Can't: not your schedule"
                                    │                 yes ─► scheduleRequests[] (pending)
                                    │                          │
                                    │                 ASK ME card: before / after
                                    │                  Approve ─┤   Decline ─► inform "Declined"
                                    │                  (stale target → Approve disabled)
                                    ▼                          ▼
                     missions ops in main (read current config, apply one op, write, {ok,error?})
                                    │
                         syncMissions → armPlan(m, now) per mission → setTimeout
                                    │
                         fire → firePayload(m, godId) → hive.send(..., 'scheduler')
                         (broadcast-migrated rows → Michael with relay body)

 Owner closes agent ─► closedByOwner = true ─► its missions setEnabled(false)
 PTY exit / boot orphaning ─► archived only, schedules untouched
```

### Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Mission op write | config write throws | `{ok:false}` + 7A revert, unit test | "Didn't save. Try again." |
| Stale owner tab | owner saves after an approved agent request | R2 ops name one id, unit test | nothing lost |
| Agent request | malformed JSON / unknown op | router test | agent gets refusal inform; nothing written |
| Agent request | targets another agent's schedule | `canEdit` test | agent gets refusal; owner never bothered |
| Approve | target changed since request | stale check, test | Approve disabled with reason |
| Relaunch / crash | PTY exits archive every agent | R1 flag, test | schedules keep running |
| Migration | runs twice | `*Seeded` flag, idempotence test | no duplicates |
| Fire | disabled or owner-closed row armed | `armPlan` tests | never fires |

No failure mode is untested, unhandled and silent: **0 critical gaps**.

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| S1 rules + regression tests | `src/shared/`, `test/` | — |
| S2 main: ops IPC, migration, closedByOwner, scheduleRequests, router verb | `src/main/`, `src/preload/` | S1 |
| S3 renderer: ScheduleList, agent tab, Michael tab, card next-run, a11y, tab font | `src/renderer/src/components/`, `store/` | S1 (types) |
| S4 ASK ME schedule-request card | `src/renderer/src/components/` (AskMeTab) | S2 IPC shape |
| S5 strings, protocol docs, regex tests | `src/renderer/src/i18n/`, `src/main/hive.ts` (briefing text), `docs/`, `test/` | S2, S3, S4 |

Lane A: S1 → S2. Lane B: S3 (after S1's types land). Then S4 (needs S2), then S5.
Conflict flags: S2 and S5 both touch `hive.ts` (sequence them); S3 and S4 both touch
`components/` (different files, coordinate on `triggers/ui.tsx`).

### Implementation Tasks (eng review, authoritative)

- [ ] **E1 (P1, human: ~1d / CC: ~30min)** — shared/missions.ts — pure rules: `migrateMissions`, `missionsFor`, `nextRunAt`, `canEdit`, `armPlan`, `firePayload`
  - Surfaced by: D2 structure, D6 regression contract
  - Files: `src/shared/missions.ts`, `test/missions.test.cjs`
  - Verify: `node --test test/missions.test.cjs` (fake clocks: standup, heartbeat, weekly and catch-up, interval, disabled, lastFiredAt, relay, owner-closed)
- [ ] **E2 (P1, human: ~4h / CC: ~20min)** — main IPC — replace `missions:save` with upsert/delete/setEnabled returning `{ok, error?}`
  - Surfaced by: R2 / D4
  - Files: `src/main/index.ts`, `src/preload/index.ts`
  - Verify: unit test that an op never drops an unnamed mission; failed write returns ok:false
- [ ] **E3 (P1, human: ~4h / CC: ~20min)** — migration + scheduler loop — `migrateMissions` under a `*Seeded` flag; `syncMissions` loops over `armPlan`
  - Surfaced by: finding 5, 3A, D6
  - Files: `src/main/index.ts`, `src/main/config.ts`, `test/standup-on-open.test.cjs`
- [ ] **E4 (P1, human: ~4h / CC: ~20min)** — closedByOwner — set on owner close paths only, clear on reopen, pause on flag
  - Surfaced by: R1 / D3
  - Files: `src/main/index.ts`, `src/main/hive.ts`, `src/main/realtimeActions.ts`
  - Verify: test per close path; PTY exit and `archiveOrphanedAgents` leave schedules on
- [ ] **E5 (P1, human: ~1d / CC: ~40min)** — router schedule requests — `to:"scheduler"` handling, `canEdit`, `scheduleRequests[]`, inform replies, PROTOCOL.md and briefing text
  - Surfaced by: R3 / D5, D7, R6 / D8
  - Files: `src/main/hive.ts`, `src/main/config.ts`
  - Verify: router tests: request never writes missions, other agent's refused, malformed, unknown op
- [ ] **E6 (P1, human: ~1.5d / CC: ~45min)** — ASK ME schedule-request card — before/after, Approve (applies once via E2), Decline, stale disable
  - Surfaced by: R6 / D8
  - Files: `src/renderer/src/components/AskMeTab.tsx`, `src/main/index.ts` (approve/decline IPC)
  - Verify: approve applies once; decline writes nothing; stale target disables Approve
- [ ] **E7 (P1, human: ~1d / CC: ~30min)** — renderer — `ScheduleList` (agent | office modes), agent tab, Michael's tab, AgentCard next run, names from registry incl. archived
  - Surfaced by: D2, finding 4, design D2/1A/2A/5A/7A/10A/11A
  - Files: `SidebarTabs.tsx`, `store.ts`, `AgentDetailPanel.tsx`, `triggers/*`, `AgentCard.tsx`
- [ ] **E8 (P1, human: ~3h / CC: ~15min)** — a11y and tab font — design 12A and 14C
  - Files: `triggers/ui.tsx`, `SidebarTabs.tsx`
- [ ] **E9 (P1, human: ~3h / CC: ~15min)** — strings in en, zh-CN, ar (`{{godName}}`, no dashes) and regex test updates (`michael-tabs`, `hidden-surfaces`, `schedule-message`, `standup-on-open`); `docs/ARCHITECTURE.md`, `branding/DESIGN.md` §7
  - Verify: `node --test test/*.test.cjs`, `npm run typecheck`, `npx electron-vite build`

### Unresolved decisions (eng)

None.

### Completion summary (eng)

- Step 0: Scope Challenge — scope accepted as-is (D1 kept the agent verb; D2 smaller arrangement)
- Architecture Review: 3 issues found (R1 pause trigger, R2 save API, R3 agent transport)
- Code Quality Review: 3 issues found (findings 4, 5, 6; required by approved decisions)
- Test Review: diagram produced, 23 gaps identified (all accepted as required proof; regression contract D6)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: ollama gpt-oss:20b (owner's standing rule in place of Codex), completed, 20 findings, 1 survived verification (R5)
- Parallelization: 2 lanes, 2 parallel / 3 sequential
- Lake Score: 4/5 = 10/10 choices / answered coverage choices (D3, D4, D6, D8 chose full; D7 owner's own answer)

## Build notes (2026-09-25, feat/per-agent-schedules)

Where the build differs from the plan, and why:

- **5A starter jobs built (2026-10-18).** Valid pack starters appear as up to three
  suggestions, with localized schedule wording and one-click paused creation. Remaining
  starters stay available after adding one; a custom job hides the suggestions.
- **Font for chips and tab labels.** The 14px-floor decision named Pixelify Sans, but the app no longer
  bundles it (`design/tokens.css`). Chips and the agent tab labels use Inter (`--cth-font-ui`) at 14px.
- **Agents can `list` their schedules.** A request needs the schedule's id, so `op: "list"` answers
  directly with the agent's own ids. It changes nothing.
- **Owner notification.** ASK ME has no badge, so filing a request shows a desktop notification when
  notifications are on.
- **Voice.** Voice-created schedules are stamped `createdBy: 'owner'`, and a voice `archive` counts as the
  owner closing the agent.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | ollama gpt-oss:20b (eng outside voice, in place of codex) | Independent 2nd opinion | 1 | completed | 20 findings, 1 survived verification |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 29 issues (6 review findings + 23 test gaps), 0 critical gaps; all resolved in plan |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 2/10 → 8/10, 15 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** design phase: codex, skipped (owner declined). Eng phase: ollama gpt-oss:20b, completed, 20 findings, 1 survived (duplicate agent adds, then made moot by the owner's D7 answer).
- **VERDICT:** DESIGN CLEARED. Eng review is ISSUES OPEN by the log rule (29 issues found, every one resolved in the plan and mapped to tasks E1 to E9, 0 unresolved, 0 critical gaps); eng review required to show CLEAR.

NO UNRESOLVED DECISIONS

## Change: schedules merged into Capabilities (owner, 2026-09-26)

Research on comparable products (Copilot Studio, Paperclip, Relevance AI, Lindy)
and on how scheduled agents are run in practice (one regular check plus a few
exact-time jobs per agent, since every run costs usage) showed a schedule is set
next to the agent's tools, not on its own tab. Owner chose option A:

- The per-agent Schedules tab is gone. Every agent's Capabilities tab has two
  sections, **Email** and **On a schedule**, each folding separately; the fold is
  remembered per viewer in localStorage (convenience only). The schedule list and
  editor are unchanged.
- Michael's own jobs moved to his Capabilities tab like everyone's. His old
  Schedules tab is now **Office schedule**: the read-only list of everyone's jobs,
  Michael's included. The wall calendar still opens it.
- An office schedule row opens that agent's Capabilities tab with On a schedule
  unfolded and the row focused. A saved Schedules tab reopens as Capabilities.

## Update (owner, 2026-09-27): Michael decides schedule requests

"all office management decisions should be handled by michael only. owner should be engaged only when it cannot truly be resolved based on avaialble facts, or something conflicting based on different sources, or of a sensitive nature". This replaces R6's owner-approves-every-request flow:

- A team member's request goes to Michael as a "Schedule request from <name>" message (what would change, why, the id). He answers the scheduler with `approve`, `decline` (with a note), or `ask-owner` (with a note on what he can't settle). `pending` lists what waits.
- Only `ask-owner` requests show in ASK ME, with Michael's note; that is also the only time Michael toasts the owner. The owner's decision is sent to the agent and to Michael.
- Michael's own requests apply at once. A row set by a request he approved reads "added by Nick, approved by Michael".
- Every request must say why (the message body), shown to Michael and on the owner's card. Two requests from one agent about one job merge into one.
- One job can have several "when" lines (src/shared/scheduleTimes.ts); a day an "every" line runs on belongs to it alone.
