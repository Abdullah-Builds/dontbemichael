# Team performance and cost: one view, with recommendations

Status: CEO review in progress (/plan-ceo-review, 2026-10-15). Scope decisions D1 to D13 are approved by the owner (see the ledger); the design below is pending document approval.

## The ask (owner, 2026-10-15)

Business owners want to know how each team member performs and what it costs.
One view that shows how much work each agent does and the dollar value it uses to
run, plus recommendations to tune the office:

- a scheduled job that runs too rarely or too often for its workload;
- an agent on a needlessly expensive model for the kind of work it does;
- a model change that would improve an agent's quality;
- research into other non technical measures an owner would value.

This is the dashboard the owner described on 2026-10-10 (memory: model choice comes
from the office's own cost and performance data, never automatic, never at setup).

## What the office records today (receipts)

| Fact | Receipt |
|---|---|
| Per agent dollars at API prices, every 30 s, kept forever (403,830 rows since 2026-09-26) | `src/main/hive.ts:5274` appendCostLedger; `src/main/index.ts:2074` runBreakerBeat; `~/HarnessAgents/hive/cost-ledger.jsonl` |
| Lifetime totals per agent across restarts | `src/main/costLifetime.ts:60` |
| Per agent per day dollars and tokens, CLI only | `tools/agent-metrics.cjs:41`, `test/agent-metrics.test.cjs` |
| No per agent dollars on any visible screen (Traces tab hidden) | `src/shared/buildFeatures.ts:14`, `src/renderer/src/components/ToolWaterfall.tsx:32` |
| Billing mode known (account or API key), unused by cost code | `src/main/config.ts:282` |
| Plan use (used_percentage, resets_at), per Claude account | `src/main/officeBreak.ts:61` |
| Fallback price table (transcript fallback only; the live ledger uses Claude's own cost): every Opus at 15/75, Fable unpriced (priced as Sonnet) | `src/main/pricing.ts:4,27,52` |
| Cards: assignee, status, result; no time a card was finished (closedAt only for an owner close) | `src/main/hive.ts:209,3430` |
| Schedule runs: only lastFiredAt; no outcome, duration or cost per run | `src/shared/missions.ts:20`, `src/main/index.ts:1159` |
| Event log: messages, mail organize, mail sent, compactions, spawns | `src/main/hive.ts:5249`, `~/HarnessAgents/hive/log.jsonl` |
| Mail draft decisions: sent as written, edited, declined | `src/main/mailApprovals.ts:341` |
| Cards the owner reopened: no record (the reopen clears closedAt and result); `cardGuards` covers only Done cards an agent moved, which the app puts back | `src/main/hive.ts:3406`, `src/shared/cardGuards.ts:70` |
| Busy or idle time: not persisted anywhere | `src/main/hive.ts:448` (status set once at spawn) |
| Model per agent: roster, Edit agent picker; modelForRole never runs for workers | `src/renderer/src/store/store.ts:114`, `src/main/config.ts:525,860`, `src/main/index.ts:3987` |

### This office, last 7 days [measured: tools/agent-metrics.cjs --days 7, 2026-10-15]

| Member | API price value | Share | Cards done (all time) | Schedule runs (all time) | Mail organized (all time) |
|---|---|---|---|---|---|
| Pam | $59.38 | 13.6% | 3 | 166 | 206 |
| Dwight | $59.12 | 13.6% | 7 | 51 | (112 sent) |
| Michael | $57.89 | 13.3% | 4 | 440 | |
| Kelly | $49.55 | 11.4% | 5 | 98 | 98 |
| Erin | $45.25 | 10.4% | 2 | 76 | 81 |
| Creed | $39.05 | 9.0% | 6 | 8 | |
| Nick | $38.78 | 8.9% | 26 | 54 | 18 |
| Ryan | $33.84 | 7.8% | 6 | 4 | |
| Oscar | $22.67 | 5.2% | 9 | 0 | |
| Toby, Sadiq | $14 each | 3.2% each | 3, 8 | 0, 1 | |
| Office | $435.71 | | | | |

The office runs on a Claude plan (decision 2026-09-15: assume Claude Max), so $436 a
week is what the same work would cost at API prices, about $1,890 a month
[estimated: x 4.33], not what the owner pays.

## 0A. Premise challenge

1. **"Dollar value they consume" is not money the owner spends.** On a plan, a
   member's cost is a share of one fixed subscription and of one usage limit that
   every member, Michael included, shares (#129). The honest numbers are: what the
   work would cost at API prices, and each member's share of the office's use. On an
   API key the dollars are real. The view must say which one it is.
2. **"How much work" cannot be counted from cards.** Pam, the second most expensive
   member, closed 3 cards; her work is 166 scheduled runs and 206 organized mails.
   Work has to count every kind the office records: cards finished, schedule runs
   that did work, mails organized, drafts sent.
3. **Recommendations need data the office does not keep yet.** "Runs too often" needs
   to know which runs found nothing to do. "Expensive model for easy work" needs cost
   per run and per card. "A better model would improve quality" needs a quality
   signal: drafts edited or declined, cards reopened, asks Michael had to redo. Today
   none of the per run facts are stored. Instrumentation comes first.
4. **Earlier decisions in this space.** The owner declined an estimated time saved
   (#81: minutes per task set by the owner would be wrong for nearly everyone), kept
   the owner's attention on Ask me rather than new panels (#103), and ruled that the
   app never changes a model on its own (memory, 2026-10-10). A view the owner asked
   for directly is consistent with #103; time saved stays declined unless reopened.

Do nothing cost: owners keep asking "what did Oscar cost, is Kelly worth it", and the
only answer is a hidden developer tab. The 2026-10-10 direction (cheaper model from
data) cannot start without this view.

## 0B. Existing code leverage

| Sub problem | Reuse |
|---|---|
| Dollars per member per day | `tools/agent-metrics.cjs` folding rule and `costLifetime.ts` restart rule; move the fold to `src/shared` |
| Plan use | `officeBreak.ts` reading |
| Work counts | `log.jsonl` (mail-organize, mail-sent), `tasks.json`, `mailApprovals` decisions, owner reopens (new record) |
| Schedules | `config.missions`, `sendMission` |
| Model change | Edit agent model picker and roster save |
| Owner reads it | one Team view (the person panel is unchanged) |

## 0C. Dream state

```
  CURRENT STATE                    THIS PLAN                        12-MONTH IDEAL
  Dollars in a hidden dev tab;     One view: each member's work,    The office tunes itself with the
  work scattered over cards,       what it would cost, and its      owner's consent: each month a
  mail and logs; schedules and     share of the plan; per run and   short review says what each member
  models set once and never        per card facts recorded; plain   did, what it cost, and two or three
  revisited.                       recommendations the owner        changes backed by numbers, which
                                   applies with one click.          the owner accepts in one click.
```

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| D1 approach (owner) | Ask 2026-10-15; #319; memory 2026-10-10 | A: one team view (work, value at API prices, share of plan), new per run and per card records, rule based recommendations the owner applies with one click | B (#319 digest line) and C (Michael's monthly review) not chosen | approved | Owner answer to D1, 2026-10-15: "A) View, records, advice". Scope: the first build. |
| D2 mode (owner) | Review mode menu, 2026-10-15 | SELECTIVE EXPANSION | | approved | Owner answer to D2: "Selective expansion". Approves the review posture only. |
| D3 E1 owner time (owner) | humanQA askedAt, answeredAt | | asks raised and median wait on the owner per member | approved | Owner answer to D3: "Add to scope". |
| D4 E2 kept as is (owner) | mailApprovals decide, cardGuards | | drafts as written, edited, stopped; cards reopened; counts until 10 decisions | approved | Owner answer to D4: "Add to scope". Also the quality evidence for the stronger model advice. |
| D5 E3 speed (owner) | card createdAt to doneAt (new) | | median created to done, excluding Blocked and Waiting time (needs status change times) | approved | Owner answer to D5: "Add to scope". |
| D6 E4 away work (owner) | record timestamps, office hours | | share of work while the owner was away (redefined by D11: owner presence) | approved | Owner answer to D6: "Add to scope". |
| D7 E5 cost per piece (owner) | calculator plus records | | value per card, per run, per mail, shown at 5 or more of a kind | approved | Owner answer to D7: "Add to scope". |
| D8 E6 plan headroom (owner) | officeBreak readings | | one office line: used, reset, pace warning | approved | Owner answer to D8: "Add to scope". |
| D9 E7 time saved (owner) | #81 | | | declined | Owner answer to D9: "Skip, keep #81". |
| D10 run outcome (owner) | scheduleMessage.ts:17 tells agents to stop silently | | the app infers the outcome; no agent behavior change | approved | Owner answer to D10: "App infers it". |
| D11 away means (owner) | no office hours setting exists (officeOpen.ts, officePack.ts:71) | | owner presence: no input for 30 min or asleep | approved | Owner answer to D11: "You weren't at the computer". |
| D13 dismissed advice (owner) | spec review pass 2 | | hidden until its evidence crosses the next step; stored in the private folder | approved | Owner answer to D13: "Until numbers change". |
| D14 documents (owner) | spec review x3, 14 of 14 fixes verified | | this plan and the CEO summary as of 2026-10-15 | approved | Owner answer to D14: "Approve, continue". Approves these document versions only. |
| D15 S2 silent loss (owner, Section 2) | hive.ts appendLog swallows write errors | | failed record writes are counted per day, flagged on the view, and that day is left out of advice | approved | Owner answer to D15: "Flag and pause advice". |
| D16 S3 telemetry store (owner, Section 3) | agents can write the hive root (hive.ts gemini/codex add-dir, Michael edits tasks.json) | | an isolated telemetry pipeline: app only writer, SQLite telemetry_events plus rollups in harness.db (db.ts, app data folder), processor every 30 s, live push to the view | approved | Owner answer to D16: "i see it a totally isolated source that is purely like a telemetry where agents and the app is logging data points all time. Then somethng reading and processing this data to continue to refresh the user interface", then "App SQLite store". Supersedes the file locations in Records. |
| D12 build order (owner) | about 26 files [estimated] after E1 to E6 and spec fixes | | one build; advice stays hidden until it has enough data | approved | Owner answer to D12: "One build". |
| D17 TODO ledger move (owner) | cost data in two stores after the build | | P2 TODO in TODOS.md | deferred | Owner answer to D17: "Add to TODOS.md". |
| D18 TODO Fable tier (owner) | Fable has no tier or price | | P2 TODO in TODOS.md | deferred | Owner answer to D18: "Add to TODOS.md". |

Approval readiness: PASS. Checked rows D1, D3 to D8, D10 to D16 (approved, each with
the owner's answer quoted above), D9 (declined), D17 and D18 (deferred to TODOS.md),
D2 (mode, posture only) and D14 (document approval). Work not covered by an answer:
none; the `advice-applied` audit event (Section 3) and the shared cost fold (Section
5) are mechanics of approved D1 apply and D16 processor, with no behavior of their own.

## Design (pending document approval)

### Telemetry pipeline (D16: isolated store, app is the only writer)

```
  SOURCES (data points, all the time)          STORE (isolated)                 PROCESSOR (main, every 30 s)        VIEW
  agents' hooks via HIVE_SOCK:                  harness.db (app data folder,     reads points past its cursor,      Team view
    prompt, tool use, stop      ---+            outside every agent folder)      folds them into rollups and        subscribes to
  cost samples (breaker beat 30 s)-+--> app --> telemetry_events (append only)   run windows, recomputes advice --> team:updated
  app: card status, reopen,     ---+            telemetry_rollup_daily           for touched days, pushes          (refreshes on
    mail decision, presence        |            telemetry_runs                                                       its own)
  scheduler: run dispatched     ---+            telemetry_failures (D15)
```

- **One table of data points.** `telemetry_events(id, office, agent_id, kind, ts,
  value REAL, attrs TEXT)`; kinds: `prompt`, `tool`, `stop`, `cost`, `run-dispatch`,
  `card-status`, `card-reopen`, `mail-decision`, `presence`. Keyed by office (the
  harness home), since offices share the app. Written only by main; no agent reads
  or writes the app data folder.
- **Derived tables, rebuilt from the events.** `telemetry_runs` (run windows, value,
  work count, outcome), `telemetry_rollup_daily` (per office, agent, day: value,
  tokens, counts per kind), `telemetry_failures` (D15: failed writes per day).
  Losing them costs nothing: the processor rebuilds from the events.
- **Migration.** One appended migration in `db.ts` (never edit a shipped one). The
  cost ledger file stays as it is for now; cost samples also enter the event table
  from the same 30 s beat, so the view never reads the 400,000 row file.
- **Retention.** Events kept 400 days, then pruned by the processor; rollups kept.
  A factory reset already erases harness.db (`factoryReset.ts:60`).
- **Processor.** In main, every 30 s and on app start: reads events past its saved
  cursor, closes run windows (rules below), updates the touched days' rollups and
  advice, and pushes `team:updated` with the new snapshot to an open view.

### Data points and run rules

| Data point | Source | Notes |
|---|---|---|
| `run-dispatch` (mission id, agent) | `sendMission` | dispatch jobs only; heartbeat and compact are left out |
| `prompt`, `tool` (tool name), `stop` | hook events in main (`hooks.ts`) | no prompt text or tool input is stored, only the kind, time and tool name; a model change is applied through the renderer roster (eng review correction 3) |
| `cost` (value, tokens, model) | `runBreakerBeat` sample | the same running totals as the ledger |
| `card-status` (id, from, to), doneAt | main, diffing tasks.json each tick (Michael writes the file) | 8 s granularity: a change reverted within one tick is missed, fine for medians; doneAt is set each time the card reaches Done |
| `card-reopen` (id, by) | main, in the reopen path (`hive.ts:3406`) | today a reopen leaves no trace |
| `mail-decision` (agent, decision) | `mailApprovals.decide()` and where a proposal is cancelled | no subject or body; the mapping below |
| `presence` (away, back) | main, `powerMonitor.getSystemIdleTime()` each minute plus suspend and resume | owner only; never sent to agents |

A **run** starts at the agent's first turn (`prompt` event) after the scheduler message
reaches its inbox (`run-dispatch`); runs arrive as inbox mail and the agent is woken
later (`index.ts:1152`, `hooks.ts:521`), so a run queued behind other work starts when
it really starts (eng review E1). It ends at the first `stop` after which the agent stays idle for 2
minutes (no prompt, no tool), at that agent's next run, or after 60 minutes (outcome
unknown). Its value is the agent's cost delta inside the window [estimated: 30 s
samples; other work in the window counts]. Work count = messages sent, triage
filings, card changes, mails organized or sent, and Write or Edit tool uses inside
the window; did work at 1 or more, nothing to do at 0; failed on agent exit or an
error stop. Michael's whole team relay runs are his runs but are left out of his cost
per run. Engines without prompt and stop hooks (agy, Gemini: `hive.ts:4517`) get a
run count from `run-dispatch` only, labelled.

| Mail decision (`mailApprovals`) | Kept as is |
|---|---|
| approve, no edits | kept |
| approve with edits | edited |
| changes (sent back with a note) | sent back |
| decline | stopped |
| cancelled (withdrawn by the agent or the app) | not counted |

### Measures (pure functions, `src/shared/teamPerformance.ts`; computed in main)

Per member, per week, with a 4 week trend:

- **Work**: shown as separate counts per kind, never summed: cards done, schedule
  runs that did work, mails organized, drafts sent. Messages between members are
  coordination and are not counted. Report cards (a humanQA entry of kind report,
  `hive.ts:382`) and cards the owner closed (`closedBy: owner`) are left out of every
  measure: work, your time, kept as is and speed.
- **Value**: at API prices on a Claude plan ("at API prices; your plan cost doesn't
  change"), spent on an API key (`config.claudeAuth`).
- **Share**: the member's value over the whole office's value for the week, every
  engine included. (Plan headroom is a separate, Claude only reading.)
- **Cost per piece (E5)**: per run = value inside the member's run windows / runs
  that did work; per card and per mail = value outside run windows / that kind's
  count, split by the share each kind has of the member's out of run work events.
  Shown at 5 or more of a kind in the week; labelled an estimate; no value is
  counted twice.
- **Your time (E1)**: asks raised; median wait from askedAt to answeredAt.
- **Kept as is (E2)**: decisions = drafts decided (not cancelled) + cards done; kept =
  drafts approved without edits + cards done and not reopened so far (a card counts as
  kept from the moment it is done; a later reopen moves it to not kept). Counts
  until 10 decisions, then kept / decisions. No decisions means no score, and no
  advice rule that needs it fires. A card reopened and finished again counts once,
  as not kept.
- **Speed (E3)**: median time from card created to doneAt, minus time in Blocked or Waiting.
- **While you were away (E4)**: share of work whose time falls in an away period
  (D11: no input for 30 minutes, or the computer asleep).
- Office line **plan headroom (E6)**: on a Claude plan only, the latest reading of the
  most constrained window (`rate_limits`) across every Claude account the office uses, its reset time, and "at this pace, runs
  out around <day>" when used% / (elapsed / window length) > 100%, once at least
  20% of the window has passed; the day is when used% reaches 100% at that pace. Hidden on an API key.

The view never folds the 400,000 row ledger: it reads the processor's rollups.

### Recommendations (rules, `src/shared/teamAdvice.ts`; hidden until the evidence minimum)

| Rule | Shown when (last 14 days) | One click does |
|---|---|---|
| Run less often | 10 or more runs and 70% or more found nothing to do | an interval schedule: interval x 2; a times or weekly schedule: opens the schedule editor with the suggestion written out ("about half as often"), since no clean halving exists |
| Run more often | 10 or more runs, 90% or more did work, and median work count per run up 30% or more this week over last | an interval schedule: interval / 2, never below 15 minutes; a times or weekly schedule: opens the schedule editor with the suggestion written out |
| Try a cheaper model | Claude member on the top tier (ladder below), 20 or more pieces of work, 10 or more mail decisions, kept as is 90% or more, no reopens; members without 10 mail decisions get no cheaper model advice (not enough quality evidence) | next tier down in the same provider; never for Michael |
| Try a stronger model | 10 or more decisions and kept as is under 60%, or 3 or more reopens | next tier up in the same provider; Michael included |

- Each recommendation shows its numbers ("Toby: 14 runs, 12 found nothing to do").
- **Early patterns** (owner, 2026-10-19): before 14 live days the same four rules run on the
  live days so far, each evidence minimum halved (5 runs; 10 pieces and 5 decisions; 2
  reopens), with the same shares. What they find shows under a bold "What Pulse sees so far,
  not advice yet." as plain facts ("Toby's "Benefits inbox check" found nothing to do on 6
  of 8 runs so far"), at most 3, the most evidence first: no Apply, no Not now, no saving,
  and a model fact names no model. On day 14 the advice takes over (`adviceFor(input,
  { from, scale })`, `PulseView.early`).
- Model advice shows observed cost per piece; a projected saving appears only when
  both models have a known price (`knownPrice(model)` returns nothing for a model the
  table does not list, unlike `priceFor`, which falls back to Sonnet). Add Fable and
  current Opus rows; this fix is for projections only, the live values already use
  Claude's own cost.
- The model ladder is data: a new `tier` (top, middle, small) on each Claude entry of
  `modelCatalog.json`, maintained with the remote catalog. Opus is top, Sonnet
  middle, Haiku small; next tier down or up picks the newest model of that tier.
  Model advice is Claude only for now: Codex and other engines get none, and a
  model without a tier (Fable until Anthropic's published positioning places it)
  gets none.
- The owner applies it: schedules through the existing missions update path, exactly
  like a manual edit today (Michael is not told, as today, so no agent behavior
  changes); models through the Edit
  agent save path, taking effect on the member's next start. Nothing applies itself.
- Dismissed advice (D13) stays hidden until its evidence crosses the next step: the
  rule's count reaches its next band (for example 12 of 14 to 14 of 14) or 14 more
  days of data arrive. Stored in harness.db (`telemetry_dismissed`) with the evidence at dismissal. Never across providers (memory, 2026-10-10).

### The view

One Team view opened from the studio home, a row per member (name, department, model,
work, value, share, a 4 week trend: the owner's 2026-10-10 "over time") with the office line on top; a member's row opens the
details above. Fields only; each measure's explanation sits behind an InfoTip (Less
verbose UI). A design review settles the layout.

### Edge cases

- No history yet: "Collecting since <date>"; advice hidden until its minimum. The
  schedule rules need 14 days of runs after the build (run more often needs 2 full
  weeks for its comparison), so no schedule advice shows before then.
- A deleted member: their history stays in the office total as "Former team members".
- A renamed member: tracked by id, shown under the current name.
- Codex or other engines: value from their own pricing; left out of plan share and headroom, labelled.

## Expansion candidates (decided: E1 to E6 added, E7 declined)

| # | Measure | Owner question it answers | Source | Effort |
|---|---|---|---|---|
| E1 | Time each member asked of you: asks raised, how long they waited on you | "Who needs me most?" | humanQA askedAt, answeredAt | S |
| E2 | Work kept as is: drafts sent as written, cards not reopened | "Can I stop checking Kelly?" (#319) | mailApprovals decide, cardGuards | M |
| E3 | Speed: time from a request to done | "How fast does the office respond?" | card createdAt to doneAt (new) | S |
| E4 | Work while you were away (D11: owner presence) | "Did it work while I slept?" | record timestamps, presence | S |
| E5 | Cost per piece of work: per card, per run, per mail | "Is this worth it?" | calculator plus records | S |
| E6 | Plan headroom: at this pace, when the weekly limit runs out | "Will the office stop on Thursday?" | officeBreak readings | M |
| E7 | Estimated time saved (reopens #81, owner declined 2026-10) | "How many hours did it save me?" | owner set minutes per kind of work | M |

## Tests

- Pure measures (`teamPerformance.ts`), `node --test` fixtures: a ledger with an app
  restart, a quiet week (zeros, says so), a deleted member, a Codex member, an API key
  office (spent, no headroom), kept as is with each mail decision including cancelled.
- Advice rules (`teamAdvice.ts`): each rule just below and at its minimum; no data
  means no advice; never a cheaper model for Michael; never across providers;
  dismissed advice returns only at the next evidence step.
- Run windows: a queued run, a run that never stops (60 minute end, unknown), two
  runs back to back, a file write only run counted as work.
- tasks.json diff: status changes, doneAt stamped at each finish, a reopen logged.
- Presence: the away period builder is pure and platform neutral; the powerMonitor
  poll is a thin wrapper, so no platform scoped test is needed.
- Processor: a batch of events across midnight updates both days; a cursor saved
  before a crash replays without double counting (event ids are unique).
- No code path writes a model or a schedule except the owner's click (source check).
- Store: the migration appends (never edits), events are written only by main, the
  processor rebuilds rollups from events alone, and a factory reset erases harness.db.

## Behavior changes

None for agents: run outcomes are inferred (D10), and applying advice works like a
manual edit today. The owner sees a new Team view.

## Build sequence (0I)

```
  HOUR 1 (foundations)   Telemetry store: db.ts migration, telemetry_events writer
                         fed by hook events, cost beat, tasks.json diff, reopen,
                         mail decisions, presence.
                         Know first: hooks.ts event flow (UserPromptSubmit, Stop,
                         PostToolUse), the 8 s tick, costLifetime's restart rule.
  HOUR 2-3 (core logic)  teamPerformance.ts and teamAdvice.ts, pure, with fixtures;
                         the 30 s processor (cursor, runs, rollups). Ambiguities: run windows that
                         overlap a card's work; a member with no decisions.
  HOUR 4-5 (integration) IPC to the Team view; apply paths (missions update, Edit
                         agent save); price table rows; catalog tier. Surprise: the
                         remote catalog overwrites tier unless the schema carries it.
  HOUR 6+ (polish/tests) Three locales, InfoTips, empty states, reset entries,
                         source check that only the owner's click writes a model or
                         a schedule.
```

Effort: human team about 2 weeks; CC + gstack about 3 to 4 hours of build plus review.

# Review sections (CEO review, 2026-10-15)

## Section 1: Architecture (revised after D16)

```
  agents (Claude Code PTYs)                                   owner
     | hook events over HIVE_SOCK                               | clicks
     v                                                          v
  main: hooks.ts --+                                    renderer: Team view
  main: runBreakerBeat (30 s) --+                         ^ team:updated (push)   | team:apply (compare and set)
  main: tasks.json diff (8 s) --+--> TelemetryWriter --> harness.db               v
  main: mailApprovals.decide() -+    (main only)          telemetry_events --> TelemetryProcessor (30 s)
  main: hive reopen path -------+                         (append only)        runs, rollups, advice
  main: presence poll (60 s) ---+                                               uses src/shared/teamPerformance.ts
  main: sendMission ------------+                                                and src/shared/teamAdvice.ts
                                   config.missions, roster models, officeBreak readings feed the processor
```

- **Boundaries.** Writers live in main next to the events they watch and only main
  touches harness.db; all math is
  pure in `src/shared` (testable without Electron); the renderer only shows a snapshot
  and sends two owner actions. No agent prompt changes.
- **Coupling.** New: the processor's run rule depends on the hook event order (prompt, tool uses,
  stop) that `hooks.ts:443` already relies on for turns. Justified: no other signal
  marks a run's start and end.
- **Scaling.** Events per day [estimated]: cost 13 agents x 2,880 beats = ~37,000;
  hook prompt, tool and stop events a few thousand; the rest small. ~45,000 rows a
  day, ~18M rows at 400 days. The processor reads only past its cursor (indexed by
  id), and the view reads rollups, so 10x members stays cheap. 100x: the cost points
  dominate; store a cost point only when the value changed since the last one.
- **Single points of failure.** The hook socket: if it is down, runs are not
  recorded (the view says "Collecting since" from the first recorded run).
- **Rollback.** Additive files only; reverting the release removes the view, and the
  records stay harmless on disk. About one release cycle.
- **Value test.** The view is the product the owner asked for (2026-10-10 and
  2026-10-15); it retires nothing.
- **Platform.** The records under it (runs, card times, presence) are what a later
  Michael monthly review (D1 option C) would read, so C needs no new records.

Findings: the storage question went to Section 3 and the owner chose an isolated
telemetry pipeline (D16); this section's diagram and scaling are revised for it.

## Section 2: Error and rescue map

```
  CODEPATH                          | WHAT CAN GO WRONG                         | CLASS
  ----------------------------------|-------------------------------------------|--------------------
  TelemetryWriter (hook frames)     | hook frame missing agent id or prompt      | bad frame
                                    | Stop never arrives (agent killed, crash)   | open run
                                    | app quits with runs open                   | open run at exit
  TelemetryWriter.insert            | disk full, database locked or corrupt      | SQLITE_FULL, SQLITE_BUSY, SQLITE_CORRUPT
                                    | native module fails to load (db.ts)        | load error
  tasksDiff (8 s tick)              | tasks.json mid-write or malformed          | SyntaxError (JSON.parse)
                                    | card removed or id changed                 | missing id
  TelemetryProcessor                | event with bad attrs; crash mid batch      | parse error, partial batch
  presence poll                     | powerMonitor throws or returns NaN         | runtime error
  teamSnapshot (IPC)                | any record unreadable                      | read error
  team:apply schedule               | mission deleted or changed since shown     | stale
                                    | missions:upsert rejects the new timing     | validation
  team:apply model                  | model no longer in catalog; roster save    | stale, write error
  telemetry_dismissed               | row with bad evidence                       | parse error

  CLASS               | RESCUED | RESCUE ACTION                                        | USER SEES
  --------------------|---------|------------------------------------------------------|------------------------------
  bad frame           | Y       | ignore that frame, console.warn with agent and event | nothing (run still ends at idle or 60 min)
  open run            | Y       | 60 minute end, outcome unknown                       | run counted, outcome unknown
  open run at exit    | Y       | on start, close open runs at app quit time, unknown  | same
  SQLITE_FULL/BUSY/CORRUPT, load error | Y (D15) | busy: retry with backoff (WAL makes this rare); others: count the failure per day in memory and in kv | "Some records from <day> could not be saved"; no advice uses that day; a store that cannot open shows "Pulse numbers are unavailable"
  SyntaxError tasks   | Y       | skip this tick, keep the last good snapshot          | nothing; next tick catches up
  missing id          | Y       | treat as removed; no status event invented           | nothing
  parse/partial batch | Y       | skip the bad event (counted); cursor saved only after a batch commits | no double counting after a crash
  presence error      | Y       | treat as present; log once a day                     | away share may be low; never invented
  read error snapshot | Y       | snapshot carries a per section error                 | that section says it could not load
  stale apply         | Y       | compare and set: refuse when the current value differs from the one shown | "This changed since; here is the new advice"
  validation          | Y       | refuse, keep the schedule                            | the reason, schedule unchanged
  model stale/write   | Y       | refuse, keep the model                               | the reason, model unchanged
  dismissed bad row   | Y       | ignore that row, log                                | that dismissed advice may show once more
```

No catch all: each rescue names its class. Owner decision D15: a record that cannot
be saved is flagged on the view and its day is left out of advice.

Section 1 revisited after D16: no further decision needed.

## Section 3: Security and threat model

| Threat | Likelihood | Impact | Mitigated |
|---|---|---|---|
| An agent edits its own numbers to steer advice (model upgrade, schedule) | Low | High | Yes (D16): the store is in the app data folder, written only by main |
| The cost ledger (`hive/cost-ledger.jsonl`) stays agent writable | Low | Low | Yes for the view: it reads cost points from harness.db, not the file |
| Presence reveals when the owner is at the computer | Low | Med | Yes: only away and back times, owner only, never sent to agents or Michael, erased on reset |
| Prompt text or tool input leaks into telemetry | Med | Med | Yes: the writer stores kind, time and tool name only; the scheduler match runs in memory |
| Mail content in decisions | Low | Med | Yes: decision and agent only, no subject or body |
| `team:apply` called with a forged model or mission | Low | Med | Yes: main validates the model against the catalog, the mission id, and compare and set |
| Renderer reads another office's numbers | Low | Low | Yes: every query filters by the current office |
| New dependency | none | | better-sqlite3 already ships (db.ts) |
| LLM prompt injection | none | | no model call; advice is rules |

No audit trail gap: each owner apply is itself a telemetry event (`advice-applied`)
so the view can show what changed and when.

## Section 4: Data flow and interaction edge cases

```
  hook frame / app event -> VALIDATE (agent id known, kind known) -> TRANSFORM (drop text, keep kind, time, tool name)
     -> PERSIST (insert telemetry_events, one prepared statement) -> PROCESSOR (cursor) -> rollups, runs, advice -> push
  shadow paths:
    nil agent id or unknown kind ......... dropped, counted in a debug counter (Section 8)
    empty tasks.json / no cards .......... no card events; those tiles fold into quiet chips (pulse-smart-view.md, owner 2026-10-19)
    malformed tasks.json ................. tick skipped, last good snapshot kept (Section 2)
    insert fails ......................... D15: failure counted per day, flagged, advice skips the day
    duplicate event (replay after crash) . cursor saved in the same transaction as rollups: no double count
    stale data (app closed for days) ..... open runs closed at app quit time as unknown; presence gap = away
```

**Ordering.** Invariant: every event is counted in the rollups exactly once.
Writers and the processor run on the main thread with one synchronous better-sqlite3
connection, so an insert and a processor batch never interleave; the processor
commits its rollup changes and its new cursor in one transaction. A crash before
commit replays the batch; after commit it never repeats. Test: insert events,
run a batch, crash between rollup write and commit (throw inside the transaction),
rerun, assert counts once.

| Interaction | Edge case | Handled | How |
|---|---|---|---|
| Apply advice | double click | Yes | compare and set: the second click sees the value already changed and does nothing |
| Apply advice | the schedule changed elsewhere since shown | Yes | refused with the new advice (Section 2) |
| Apply advice | the member was deleted while the view is open | Yes | push update removes the row; apply refused |
| Dismiss | then the evidence crosses the next band | Yes | D13 rule |
| View | no members, 1 member, 30 members | Yes | empty state; list scrolls; office line always on top |
| View | open for hours | Yes | live push every 30 s; no reload needed |
| View | office switched | Yes | snapshot keyed by office; switching reloads |
| Processor | app asleep, then resumes | Yes | next tick processes everything past the cursor |

## Section 5: Code quality

- **Duplicated behavior.** The cost running total fold (restart detection) exists in
  `src/main/costLifetime.ts:60` and `tools/agent-metrics.cjs:41`. The processor needs
  it a third time: extract it to `src/shared/costFold.ts` and use it in all three.
- **Complexity.** The run rule (start match, idle end, next run, 60 minute cap,
  failure) would branch more than 5 times in one function; split into
  `runStarts`, `runEnds`, `runOutcome`.
- **Fit.** Pure math in `src/shared` with `node --test`, main only wiring, IPC in
  preload: the house pattern (`ownerRequests.ts`, `askMeRouting.ts`).
- **Not over built.** No new service or class beyond the writer and the processor.

## Section 6: Tests

```
  NEW THING                         TYPE         HAPPY                         FAILURE                         EDGE
  telemetry migration               unit         creates tables, user_version  native load error -> unavailable  rerun is a no-op
  TelemetryWriter                   unit         each kind stored, no text     insert error -> D15 counted       unknown agent dropped
  tasks.json diff                   unit         status change, doneAt         malformed file skipped            reopen then done again
  run rule                          unit         start, idle end, outcome      no stop -> 60 min unknown         queued run, back to back, file write only
  processor                         unit         rollups per day               crash mid batch -> no double      batch across midnight
  teamPerformance measures          unit         every measure                 a day with a gap is marked        quiet week, deleted member, Codex, API key
  teamAdvice rules                  unit         each rule fires at minimum    no data -> no advice              Michael never cheaper; never cross provider; dismissed band
  team:apply                        integration  schedule and model applied    stale -> refused                  double click
  Team view                         component    rows, office line             unavailable store message         empty office, 30 members
  source check                      unit         only team:apply writes model or schedule from advice
```

Friday 2am test: a fixture office with three weeks of events produces the same
numbers as `tools/agent-metrics.cjs` on the same cost points (shared fold).
Hostile QA: an agent writes a fake `telemetry_events` row through a hive file:
impossible, the store is outside every agent folder (source check that no agent
writable dir contains the app data folder). Chaos: kill the app mid batch; numbers
stay exact. Flakiness: every time based test injects the clock.

## Section 7: Performance

- Writes: ~45,000 events a day [estimated, Section 1], inserted with prepared
  statements; cost points batched in one transaction per 30 s beat.
- Indexes: `telemetry_events(id)` (cursor), `(office, agent_id, ts)`;
  `telemetry_rollup_daily(office, agent_id, day)` primary key.
- Processor batch: ~400 events per 30 s tick; work is linear in the batch.
- View: reads rollups for 4 weeks (members x 28 rows) plus open advice; under 10 ms.
- Slowest paths: first start on a big office (catching up the cursor), the tasks.json
  diff on a large board, and pruning at 400 days (run in small chunks).

## Section 8: Observability

- kv `telemetry:health`: last event time, last processed id and time, failures by
  day, dropped frames. A stalled processor (no progress for 5 minutes while events
  arrive) logs once and the view shows numbers as of the last update.
- Each processor batch logs one line: events read, runs closed, days touched, ms.
- Debuggable later: events are the raw truth; rollups can be rebuilt by clearing the
  derived tables (a developer command in Advanced, not for owners).

## Section 9: Deployment and rollout

- Migration: one appended migration; an older app opening the newer DB skips it
  (user_version check in `db.ts`). No change to hive files.
- Windows ships every release: better-sqlite3 already ships there; powerMonitor
  idle time works on Windows and macOS.
- Rollout: the store starts collecting at first launch; the view says "Collecting
  since"; advice appears only after its 14 day minimums.
- Rollback: revert the release; harness.db keeps the unused tables harmlessly.
- Post-deploy check, first hour: events of kinds cost, prompt and stop exist for
  each running member; the first scheduled run closes with an outcome.

## Section 10: Long term trajectory

- Reversibility: 4 of 5 (additive tables and a view; the migration stays).
- Debt: run value is an estimate; cost data lives in two places (the ledger file
  and the store) until the ledger moves in (db.ts already reserves it).
- Next: Michael's monthly review (D1 option C, not chosen now) can read the rollups
  without new records; cross provider advice waits on the engine gates (#48, #61).
- Retrospective on cherry picks: E2 (kept as is) turned out to be the quality
  evidence the model advice needs; E3 needed the status events that E2's reopen
  record also uses. No rejected item (E7) is needed by an accepted one.

## Section 11: Design and UX

```
  studio home --(Team button)--> Team view
                                   | office line: value this week, plan headroom, gaps notice
                                   | rows: member, department, model, work by kind, value, share, trend
                                   |   --(row)--> member details: cost per piece, your time, kept as is,
                                   |                speed, away share, advice cards (apply, dismiss)
                                   |   --(apply)--> confirm line --> applied (row updates on next push)
                                   +--(empty)--> "Collecting since <date>"
```

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Office line | last snapshot | "Collecting since" | "Pulse numbers are unavailable" | numbers | headroom hidden on an API key |
| Member rows | last snapshot | zeros, says so | per section error | rows | Codex row labelled |
| Advice | none shown | "No advice yet" | hidden | cards | days with gaps left out (D15) |

- First the owner sees the office line (is the office healthy, will it stop), then
  who costs what, then a member's detail and advice.
- Fields only, InfoTips for every measure (Less verbose UI); no dashes in copy;
  three locales; keyboard reachable rows; numbers not color only.
- Recommend `/plan-design-review` before building: this is a new screen.

## Outside voice

Skipped by owner policy (memory, 2026-10-01): Codex is used only for the adversarial
code pass, and there is no Claude fallback. No completed external review.

## Reality rows

REALITY: premise-table pass 4 premises, each with a receipt, unverified=0 docs/designs/team-performance.md:58
REALITY: already-done pass nothing on origin/main since 2026-10-15 touches db.ts or the new modules src/main/db.ts:1
REALITY: surface-check pass the only CLI named, `node tools/agent-metrics.cjs --days 7 --json`, was run; IPC names are new tools/agent-metrics.cjs:4
REALITY: binding-decisions pass model choice stays the owner's (memory 2026-10-10), schedules run as configured with no hidden skips (advice is applied only by the owner), no agent behavior change src/shared/scheduleMessage.ts:17
REALITY: numbers pass spend and counts tagged [measured: tools/agent-metrics.cjs, log.jsonl, tasks.json]; volumes tagged [estimated] docs/designs/team-performance.md:38
REALITY: deferred-asks finding #319 asked for delivery in the weekly digest (owner chose a view instead); #66 Auto default model left out (owner rule: never automatic); #64 setup wizard left out (owner 2026-10-10) TODOS.md:118
REALITY: pr-count pass one build, one PR (D12; no ship-policy file, default one PR per wave) docs/designs/team-performance.md:126

## NOT in scope

- Estimated time saved (D9, declined: the #81 reasoning holds).
- Michael's monthly performance review (D1 option C, not chosen; the rollups make it possible later).
- Cross provider model advice (memory 2026-10-10; waits on #48 and #61).
- Delivering numbers in the weekly digest (#319's channel; the owner asked for one view).
- Moving the cost ledger into the store (D17, deferred to TODOS.md).
- Fable's tier and price (D18, deferred to TODOS.md).

## What already exists

See 0B. Reused: cost samples and the restart fold (`costLifetime.ts`,
`tools/agent-metrics.cjs`, extracted to `src/shared/costFold.ts`), the SQLite store and
its migrations (`db.ts`), hook events (`hooks.ts`), plan readings (`officeBreak.ts`),
the missions update path (`missions:upsert`), the Edit agent save path, the model
catalog. New: the telemetry tables, processor, two pure modules and the Team view.

## Dream state delta

After this build the office records every data point an owner's question needs and
shows it in one live view, with advice the owner applies in one click. Left for the
12 month ideal: Michael explaining the month in words (option C), cross provider
advice, and one cost store (D17).

## Failure modes registry

```
  CODEPATH              | FAILURE MODE                  | RESCUED? | TEST? | USER SEES?                         | LOGGED?
  ----------------------|-------------------------------|----------|-------|------------------------------------|--------
  TelemetryWriter       | insert fails (full, corrupt)  | Y (D15)  | Y     | "Some records from <day> ..."      | Y
  TelemetryWriter       | store cannot open             | Y        | Y     | "Pulse numbers are unavailable"     | Y
  hook frame            | missing agent or prompt       | Y        | Y     | nothing (run ends at idle or cap)  | Y (counter)
  run rule              | no stop arrives               | Y        | Y     | outcome unknown                    | Y
  tasks.json diff       | malformed file                | Y        | Y     | nothing; next tick                 | Y
  processor             | crash mid batch               | Y        | Y     | nothing; no double count           | Y
  processor             | stalls                        | Y        | Y     | numbers as of the last update      | Y
  presence poll         | API error                     | Y        | Y     | away share may be low              | Y (daily)
  team:apply            | stale or invalid              | Y        | Y     | reason; nothing changed            | Y
  dismissed advice      | bad row                       | Y        | Y     | advice may show once more          | Y
```

CRITICAL GAPS: 0.

## Scope expansion decisions

Accepted: E1 owner time, E2 kept as is, E3 speed, E4 away work, E5 cost per piece,
E6 plan headroom. Deferred: none from 0G (D17 and D18 are review TODOs). Skipped: E7
time saved. Full record: `~/.gstack/projects/agentvivekkumar-dontbemichael/ceo-plans/2026-10-15-team-performance.md`.

## Diagrams

Produced: system architecture (Section 1), telemetry pipeline data flow with shadow
paths (Design, Section 4), error flow (Section 2), user flow (Section 11), build
sequence (0I). No new state machine beyond the run rule (described in prose:
open, closed by idle, next run, cap, or failure). Deployment and rollback are
additive (Section 9), one step each, so no flowchart. Stale diagram audit: the
first Section 1 diagram (file records) was replaced after D16; no other diagram in
files this plan touches is affected.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding
above. Effort ratio assumption: features ~30x, tests ~50x, architecture ~5x.

- [ ] **T1 (P1, human: ~1d / CC: ~20min)** — store — telemetry tables migration and writer
  - Surfaced by: Section 3, D16 (isolated store, app only writer)
  - Files: src/main/db.ts, src/main/telemetryStore.ts (new)
  - Verify: node --test test/telemetry-store.test.cjs (migration, insert, no text stored, D15 failures)
- [ ] **T2 (P1, human: ~1d / CC: ~20min)** — sources — feed data points from hooks, cost beat, sendMission, tasks.json diff, reopen, mail decisions, presence
  - Surfaced by: Design, data points table; Section 2 (rescues)
  - Files: src/main/hooks.ts, src/main/index.ts, src/main/hive.ts, src/main/mailApprovals.ts
  - Verify: node --test test/telemetry-sources.test.cjs
- [ ] **T3 (P1, human: ~4h / CC: ~10min)** — shared — extract the cost fold
  - Surfaced by: Section 5, duplicated restart rule
  - Files: src/shared/costFold.ts (new), src/main/costLifetime.ts, tools/agent-metrics.cjs
  - Verify: test/agent-metrics.test.cjs and the cost lifetime tests stay green
- [ ] **T4 (P1, human: ~1d / CC: ~20min)** — processor — cursor, run windows, rollups, live push
  - Surfaced by: D16 processor; Section 4 ordering invariant
  - Files: src/main/telemetryProcessor.ts (new), src/preload/index.ts
  - Verify: node --test test/telemetry-processor.test.cjs (crash mid batch, midnight, queued run)
- [ ] **T5 (P1, human: ~1d / CC: ~15min)** — measures — teamPerformance.ts
  - Surfaced by: D1, E1 to E6, D11, D15
  - Files: src/shared/teamPerformance.ts (new)
  - Verify: node --test test/team-performance.test.cjs
- [ ] **T6 (P1, human: ~1d / CC: ~15min)** — advice — teamAdvice.ts with minimums, ladder, dismiss bands
  - Surfaced by: D1 rules; spec review thresholds; D13
  - Files: src/shared/teamAdvice.ts (new), src/shared/modelCatalog.json, src/main/pricing.ts
  - Verify: node --test test/team-advice.test.cjs
- [ ] **T7 (P1, human: ~4h / CC: ~10min)** — apply — team:apply with compare and set, advice-applied event
  - Surfaced by: Section 4 double click and stale apply; Section 3 audit
  - Files: src/main/index.ts, src/preload/index.ts
  - Verify: node --test test/team-apply.test.cjs; source check that only this path writes from advice
- [ ] **T8 (P1, human: ~2d / CC: ~30min)** — view — Team view, office line, member details, InfoTips, three locales
  - Surfaced by: Section 11 states map
  - Files: src/renderer/src/components/team/ (new), studio home entry, src/renderer/src/i18n/locales/*.json
  - Verify: component tests for empty, unavailable, partial; run /plan-design-review first
- [ ] **T9 (P2, human: ~2h / CC: ~5min)** — observability — telemetry:health and batch log lines
  - Surfaced by: Section 8
  - Files: src/main/telemetryProcessor.ts
  - Verify: a stalled processor test logs once and the view keeps the last numbers
- [ ] **T10 (P2, human: ~1h / CC: ~5min)** — docs — CHANGELOG, docs/FEATURES.md, DESIGN.md for the Team view
  - Surfaced by: Section 10 knowledge
  - Files: CHANGELOG.md, docs/FEATURES.md, branding/DESIGN.md
  - Verify: no dashes in copy test passes

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION                         |
  | System Audit         | cost recorded since 9/26 but unseen; work   |
  |                      | undercounted by cards; no per run records   |
  | Step 0               | approach A; E1-E6 added, E7 declined;       |
  |                      | inferred outcomes, presence, one build      |
  | Section 1  (Arch)    | 1 issue (storage) -> D16                    |
  | Section 2  (Errors)  | 13 error paths mapped, 0 GAPS (D15)         |
  | Section 3  (Security)| 9 threats, 1 High impact (mitigated, D16)   |
  | Section 4  (Data/UX) | 8 edge cases mapped, 0 unhandled            |
  | Section 5  (Quality) | 2 issues found (fold duplication, run rule) |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 1 gap found (health record, T9)             |
  | Section 9  (Deploy)  | 0 risks flagged                             |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | 0 issues; design review recommended         |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 13 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 10 total, 0 CRITICAL GAPS                   |
  | TODOS.md updates     | 2 items proposed (both added)               |
  | Scope proposals      | 7 proposed, 6 accepted (EXP + SEL)          |
  | CEO plan             | written                                     |
  | Outside voice        | codex skipped (owner policy)                |
  | Lake Score           | 3/3 recommendations chose complete option   |
  | Diagrams produced    | 5 (architecture, data flow, error, user     |
  |                      | flow, build sequence)                       |
  | Stale diagrams found | 1 (replaced after D16)                      |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows (PLAN_REALITY), 0 unverified       |
  +====================================================================+
```

PLAN_REALITY: phase=ceo rows=7/7 missing=none unverified=0 verdict=complete

## Unresolved Decisions

None.

# Eng review (plan-eng-review, 2026-10-15)

Target: docs/designs/team-performance.md (this file), after the CEO review.

## Scope challenge

- Complexity: about 26 files [estimated] and 2 new services (TelemetryWriter,
  TelemetryProcessor): the gate trips. No feature cut proposed (scope settled in the
  CEO review, D1 to D18). Structure question not asked: owner rule, no code
  arrangement questions (memory); arrangement kept as planned.
- Search [Layer 1]: SQLite WAL grows without bound under a never closing reader, and
  DELETE frees pages without shrinking the file; VACUUM in WAL mode roughly doubles
  disk use until a TRUNCATE checkpoint. The processor must not hold a read open, and
  retention needs a plan (Section 4).
- TODOS cross reference: "Authenticate hook events" (#61, P2) touches this plan (E2 below).

Findings:

1. [P1] (confidence: 9/10) src/main/index.ts:1152 — a run is not a prompt. `sendMission`
   does `hive.send({ to: payload.to, act: 'inform', subject: payload.subject, body:
   payload.body }, 'scheduler')`: the run lands as an inbox file, and `hooks.ts:521`
   says "Inbox files remain durable; the renderer wakes the agent later through its
   guarded idle-only delivery path". The prompt the agent submits is the wake nudge,
   not the scheduler message, so the plan's run start rule ("the prompt whose text is
   that run's scheduler message") never matches. Decision E1.
2. [P2] (confidence: 9/10) src/main/hooks.ts (the hook socket reads the agent from the
   frame; TODOS.md "Authenticate hook events", #61) — telemetry is fed by hook frames
   any agent could forge for itself or another, which undercuts D16's "agents cannot
   steer their numbers". Decision E2.
3. Correction (confidence: 9/10) src/main/index.ts:4940 `ipcMain.handle('roster:write'`
   — the model lives in the renderer roster, so applying a model runs through the same
   store action Edit agent uses (renderer), with main validating and recording
   `advice-applied`. No behavior change.
4. Correction (confidence: 8/10) src/main/modelCatalog.ts (the remote catalog replaces
   the baked one after `parseModelCatalog`) — `tier` must be added to
   `modelCatalogPayload` parsing and to `docs/model-catalog.json`, or a refresh drops
   it. No behavior change.

## Eng decision ledger

### E1: when a scheduled run starts
Finding: 1, P1, 9/10, src/main/index.ts:1152, eng review
Plan baseline: run starts at the prompt whose text is the scheduler message (Design, run rule; D10 inferred outcomes, D12)
Runtime evidence: runs arrive as inbox files from "scheduler"; the agent is woken later by a nudge (hooks.ts:521)
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| Run start | prompt equals scheduler text (never matches) | the agent's first turn after the scheduler file reaches its inbox | the moment the agent moves the scheduler file to inbox/.done |
| Run end, outcome, value rules | approved (D10) | unchanged | unchanged |
| Agent behavior | none (D10) | none | none |
Question D1: When does a scheduled run start, given runs arrive as inbox mail? (P1, 9/10; recommendation A)
Header: Run start
Options:
A) First turn after delivery (recommended): a run starts at the agent's first turn after the scheduler mail lands in its inbox; end, outcome and value rules stay as approved; other mail woken in the same turn shares the window (estimate).
B) When the mail is filed: a run starts when the agent moves the scheduler mail to its done folder; often late, since agents file at the end of a turn.
State: approved
Actual answer: A, "First turn after delivery" (owner, D1 of the eng review, 2026-10-15)
Accepted scope: replace the run start rule with "the agent's first turn (prompt event) after the scheduler message reaches its inbox (`run-dispatch` time)"; tests: a run woken by a nudge starts at that turn; a turn before delivery does not start it.
History: none

### E2: hook events are not authenticated (#61)
Finding: 2, P2, 9/10, src/main/hooks.ts (agent read from the frame), TODOS.md "Authenticate hook events", eng review
Plan baseline: telemetry fed by hook frames as they arrive (D16)
Runtime evidence: any agent can send a frame naming any agent (TODOS.md, #61)
Comparison grid:
| Commitment | Current | A (ship, #61 later) | B (do #61 here) |
|---|---|---|---|
| Hook auth | none | none until #61 | per agent secret at spawn; frames with a wrong or missing secret ignored and counted |
| Owner dock out of the hive (#61 part 2) | in hive/agents/human | unchanged | moved as #61 specifies |
| Ship timing | n/a | n/a | owner: nothing ships until the whole feature works locally |
Question D2: Hook events aren't authenticated yet; does that block this build? (recommendation A)
Owner answer to D2: "do not ship anything yet. build all that is needed to finish this in this branch locally. once all works i will ship and deploy"
Question D3 (follow-up): Since nothing ships until it all works, should this branch also build hook authentication (#61)? (recommendation A: build it here)
Header: #61 in branch
Options:
A) Build #61 here too (recommended): per agent secret at spawn, events with a wrong or missing secret ignored and counted, the owner's dock moved out of the hive as #61 specifies.
B) View only; #61 stays a TODO: document the forgeable input gap.
State: approved
Actual answer: A, "Build #61 here too" (owner, D3 of the eng review, 2026-10-15), after D2's instruction to build everything locally before shipping
Accepted scope: implement TODOS.md "Authenticate hook events and keep the owner's messages out of the agents' folder" (#61) in this branch; telemetry drops and counts unauthenticated frames; the TODOS entry is removed when done. Delivery: build the whole feature on the running branch; nothing ships or deploys until the owner says so.
History: D2 answered with a delivery instruction rather than an option; D3 confirmed the reading.

## Eng Section 1: Architecture

1. [P2] (confidence: 8/10) src/main/index.ts (runBreakerBeat appends a ledger row only
   "if (sample?.sessionId)", issue #358) — Codex and other transcript fallback members
   produce samples with an empty session id, so they would write no cost points and
   show $0, against the approved edge case "Codex or other engines: value from their
   own pricing" (D14 documents). Necessary implementation of that approved behavior,
   no question: the telemetry writer stores every sample, keyed by agent and a source
   id when the session id is empty. (The ledger file's own gate stays as is; D17.)
2. Distribution: no new artifact; better-sqlite3 already ships for macOS and Windows
   (`db.ts`), so the build and installer paths are unchanged.
3. Production failure per new path: harness.db cannot open (native module) -> view says
   "Pulse numbers are unavailable" (Section 2 map); hook socket down -> no turn events,
   view shows the last update time; processor throws -> batch not committed, retried
   next tick. All handled in the plan.

Dispositions: 1 accepted as necessary implementation of D14's approved edge case.

## Eng Section 2: Code quality

1. [P3] (confidence: 8/10) tools/agent-metrics.cjs:17 (`const fs = require('node:fs');`,
   plain CommonJS with only node: requires) — the CLI cannot import TypeScript from
   `src/shared`, so it is not a caller of the extracted cost fold. Shared fold callers:
   `costLifetime.ts:60` and the new processor (proposed). The CLI keeps its copy; a
   fixture test pins both to the same numbers (Section 3). Correction to T3.
2. [P3] (confidence: 8/10) src/main/hive.ts:3310 (`readTasks` returns tasks.json) — the
   8 s tick that refreshes owner requests already reads tasks.json; the card status diff
   reuses that read instead of a second file read. Correction, no behavior change.
3. [P3] (confidence: 7/10) per the search check — the processor must never hold a read
   open between ticks (WAL cannot be recycled under a long lived reader) and must do
   its reads and rollup writes inside one short transaction. Correction.

Dispositions: 1 to 3 accepted as corrections (no behavior change).

### E3: regression contract for hook authentication (#61)
Finding: Section 3, regression risk (IRON RULE), 9/10, 41 test files exercise the hook path (test/hive-hook-node.test.cjs, test/hook-frame-paths.test.cjs, test/windows-hook-shell.test.cjs, ...), eng review
Plan baseline: E2 approved building #61 here; contract unset
Comparison grid:
| Commitment | A strict everywhere | B strict for telemetry only |
|---|---|---|
| Agents the app starts | carry a secret; behave exactly as today | same |
| Frame with missing or wrong secret | dropped for every consumer, counted per agent | reaches breaker, notes, wake as today; never telemetry |
Question D4: what happens to a hook event without a valid secret? (recommendation A)
Header: Auth contract
State: approved
Actual answer: A, "Strict: drop and count" (owner, D4 of the eng review, 2026-10-15)
Accepted scope: every existing hook test passes unchanged except that its frames carry the spawned agent's secret; frames with a missing, wrong or another agent's secret are dropped for every consumer and counted per agent in telemetry:health; tests cover accepted, missing, wrong, cross agent and the Windows shim.
History: none

## Eng Section 3: Tests

Framework: `node --test` through `tools/run-tests.cjs` (package.json "test"); pure modules
load with `test/load-ts.cjs`.

```
CODE PATHS (all proposed)                                   USER FLOWS
[+] main TelemetryWriter                                    [+] Owner opens Team view
  ├── [GAP] insert per kind, no prompt text stored            ├── [GAP] rows and office line render from a snapshot
  ├── [GAP] insert fails -> D15 failure counted               ├── [GAP] empty office: "Collecting since"
  ├── [GAP] cost point only when changed; Codex no session    ├── [GAP] store unavailable message
  └── [GAP] unauthenticated frame dropped and counted (E3)    └── [GAP] live push updates an open view
[+] hooks.ts auth (#61)                                     [+] Owner applies advice
  ├── [GAP] legit frame accepted (all 41 existing suites)     ├── [GAP] schedule applied, compare and set
  ├── [GAP] missing / wrong / cross agent secret rejected     ├── [GAP] model applied through the roster
  └── [GAP] Windows shim carries the secret                   ├── [GAP] double click does nothing twice
[+] main TelemetryProcessor                                   └── [GAP] stale advice refused with the new one
  ├── [GAP] run starts at first turn after delivery (E1)    [+] Owner dismisses advice
  ├── [GAP] idle 2 min end; next run; 60 min cap            └── [GAP] returns only at the next evidence band
  ├── [GAP] crash mid batch -> no double count
  ├── [GAP] batch across midnight
  └── [GAP] never holds a read open between ticks
[+] shared teamPerformance / teamAdvice / costFold
  ├── [GAP] each measure; report cards and owner closed cards left out
  ├── [GAP] each rule at and below its minimum; no data no advice
  ├── [GAP] Michael never cheaper; never across providers; Fable none
  └── [GAP] costFold = costLifetime numbers; CLI parity fixture
[+] tasks diff on the existing tick
  └── [GAP] status change, doneAt each finish, reopen logged, malformed skipped
[+] presence
  └── [GAP] away builder from idle samples, suspend and resume

COVERAGE: 0/33 paths tested (all proposed)  |  every path above needs a test in the build
QUALITY: all new tests must be ★★★ (behavior + edge + error)
```

Regression (IRON RULE): the 41 existing hook suites are the regression contract for
E3; they must pass with only the secret added to their frames. `test/agent-metrics.test.cjs`
and the cost lifetime tests guard the fold extraction. No LLM or prompt change: no eval.

Test files (match naming): `test/telemetry-store.test.cjs`, `test/telemetry-processor.test.cjs`,
`test/hook-auth.test.cjs`, `test/team-performance.test.cjs`, `test/team-advice.test.cjs`,
`test/team-apply.test.cjs`, `test/team-view.test.cjs`. Each carries a Value line.

Dispositions: E3 approved (D4). Test plan artifact written (path in the completion summary).

### E4: raw event retention
Finding: Section 4, P3, 7/10, Design "Retention. Events kept 400 days" plus the search check (DELETE does not shrink SQLite; VACUUM in WAL doubles disk use), eng review
Plan baseline: raw events 400 days, then pruned (Design, D14 documents)
Runtime evidence: [measured: hive/cost-ledger.jsonl] 404,157 of 408,918 rows repeat the previous value; 4,761 changes in ~19 days. Hook event volume unknown [estimated: thousands a day].
Comparison grid:
| Commitment | A | B |
|---|---|---|
| Raw retention | 35 days | 400 days |
| Rollups and runs | forever | forever |
| Pruning | small nightly chunks, incremental auto vacuum | small chunks, vacuum when mostly free space |
Question D5: How long does the telemetry store keep raw data points? (recommendation A)
Header: Retention
State: approved
Actual answer: B, "400 days raw, as planned" (owner, D5 of the eng review, 2026-10-15)
Accepted scope: raw events kept 400 days, pruned in small chunks by the processor; a VACUUM followed by a TRUNCATE checkpoint runs only when free pages exceed half the file, during an idle period; rollups and runs kept forever. Lossless correction kept: a cost point identical to the agent's previous one is not stored (running totals; no information lost).
History: none

## Eng Section 4: Performance

1. [P3] (confidence: 8/10) Design "cost samples ... every 30 s" with src/main/index.ts
   runBreakerBeat — storing every beat would write ~37,000 identical rows a day; store
   a cost point only when it differs from that agent's last one [measured: 98.8% repeat].
   Lossless correction.
2. [P3] (confidence: 7/10) TelemetryWriter on the hook path — one synchronous insert per
   hook frame on the main thread. Buffer frames and insert them in one transaction at
   most once a second (and at quit); D15 counts a failed batch. Correction.
3. Retention and vacuum: decided in E4 (owner kept 400 days).
4. View reads: rollups only, members x 28 rows; no query in a loop.

Dispositions: 1 and 2 accepted as corrections; E4 approved (D5, option B).

## Outside voice

Skipped by owner policy (memory, 2026-10-01): Codex only for the adversarial code pass,
no Claude fallback. No completed external review.

## TODO choices

No new TODO. The existing "Authenticate hook events" entry (#61) is now built in this
branch (E2) and is removed from TODOS.md when it lands.

Approval readiness: PASS. Checked E1 (D1, A), E2 (D2 instruction and D3, A), E3 (D4, A),
E4 (D5, B). Corrections 3 and 4 (scope challenge), Section 1 item 1, Section 2 items
1 to 3 and Section 4 items 1 and 2 change no behavior and implement approved D14 or D16
commitments. Delivery: nothing ships or deploys until the owner says so (D2).

## Eng NOT in scope

- Shipping or deploying anything from this branch before the owner says so (D2).
- Moving the cost ledger file into the store (D17, TODOS.md).
- Fable's tier and price (D18, TODOS.md).
- Making the CLI tool import the shared fold (it stays plain CommonJS; parity test instead).

## Eng what already exists

Reused as is: `db.ts` migrations and WAL store, `hooks.ts` event flow, the 8 s tick's
tasks read (`hive.ts:3310`), `costLifetime.ts` restart rule (extracted to
`src/shared/costFold.ts`), `missions:upsert`, `roster:write` through the renderer store,
`modelCatalog` parsing (gains `tier`), `factoryReset.ts` (harness.db already erased).
Rebuilt: none.

## Eng failure modes

| Path | Realistic failure | Test | Handling | User sees |
|---|---|---|---|---|
| run start | wake nudge never sent (agent busy for hours) | yes | run starts at the real first turn | run counted when it happens |
| hook auth | engine bridge drops the secret | yes | frames dropped and counted (E3) | that member's activity stops updating; health shows drops |
| writer batch | disk full during a batch | yes | D15 failure counted | day flagged; advice skips it |
| processor | long read keeps WAL growing | yes | no read held between ticks | nothing |
| vacuum | runs during heavy work | yes | only when idle and free pages > half | nothing |
| apply model | roster save fails in renderer | yes | refused, reason shown | model unchanged |

Critical gaps: 0.

## Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| S1 hook auth (#61) | src/main (hooks, hive spawn, hookShell), test/ hook suites | none |
| S2 pure measures and advice, cost fold | src/shared, test/ | none |
| S3 telemetry store, writer, processor | src/main (db, index, hooks writer calls) | S1 (hooks.ts), S2 |
| S4 Team view and apply | src/renderer, src/preload, i18n | S3 (snapshot contract) |

Lane A: S1 then S3 (both touch hooks.ts). Lane B: S2 (independent). Then S4.
Execution: launch A (S1) and B (S2) together; merge both; then S3; then S4.
Conflict flag: hooks.ts is shared by S1 and S3; keep them in one lane.

## Eng implementation tasks

Synthesized from this review's findings, on top of the CEO tasks T1 to T10 above.
Ratios: features ~30x, tests ~50x, security ~10x.

- [ ] **E-T1 (P1, human: ~3d / CC: ~1h)** — hooks — authenticate hook events (#61), strict contract
  - Surfaced by: Scope challenge 2, E2 (D3), E3 (D4)
  - Files: src/main/hooks.ts, src/main/hive.ts, src/main/hookShell.ts, test/hook-auth.test.cjs, the 41 hook suites
  - Verify: node --test test/hook-auth.test.cjs and npm test (all hook suites green with the secret)
- [ ] **E-T2 (P1, human: ~2h / CC: ~10min)** — processor — run start at the first turn after delivery
  - Surfaced by: Scope challenge 1, E1 (D1)
  - Files: src/main/telemetryProcessor.ts
  - Verify: node --test test/telemetry-processor.test.cjs (nudge woken run, turn before delivery ignored)
- [ ] **E-T3 (P2, human: ~2h / CC: ~10min)** — writer — cost points for every engine, only on change; one batch per second
  - Surfaced by: Section 1 item 1, Section 4 items 1 and 2
  - Files: src/main/telemetryStore.ts, src/main/index.ts
  - Verify: node --test test/telemetry-store.test.cjs (Codex sample stored, repeat skipped, failed batch counted)
- [ ] **E-T4 (P2, human: ~2h / CC: ~10min)** — processor — retention 400 days, chunked prune, idle vacuum
  - Surfaced by: E4 (D5)
  - Files: src/main/telemetryProcessor.ts
  - Verify: node --test test/telemetry-processor.test.cjs (prune by age, vacuum only past half free)
- [ ] **E-T5 (P3, human: ~1h / CC: ~5min)** — catalog — `tier` in the payload parser and docs/model-catalog.json
  - Surfaced by: Scope challenge 4
  - Files: src/shared/modelCatalogPayload.ts, src/shared/modelCatalog.json, docs/model-catalog.json
  - Verify: a catalog refresh keeps tier (unit test)

## Eng completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (PLAN_REALITY complete), 0 unverified premises
- Architecture Review: 1 issue found (Codex cost points)
- Code Quality Review: 3 issues found (all corrections)
- Test Review: diagram produced, 33 gaps identified (all proposed paths), regression contract set (E3)
- Performance Review: 2 issues found (repeat cost points, per frame inserts), retention decided (E4)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (the #61 entry moves into this branch)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, skipped (owner policy)
- Parallelization: 2 lanes, 2 parallel (S1, S2) / 2 sequential (S3, S4)
- Lake Score: 3/4 answers picked the 10/10 option (E1, E3 yes; E2 follow up yes; E4 chose B)
- Test plan: ~/.gstack/projects/agentvivekkumar-dontbemichael/moblizeit-mit-local-instance-version-de4202-eng-review-test-plan-20261015-144821.md

REALITY: premise-table pass every scope challenge finding quoted with file:line, unverified=0 src/main/index.ts:1152
REALITY: already-done pass nothing on origin/main since 2026-10-15 touches these modules src/main/db.ts:1
REALITY: surface-check pass npm test runs tools/run-tests.cjs; IPC names checked (roster:write, missions:upsert) src/main/index.ts:4940
REALITY: binding-decisions pass CEO D1 to D18 and owner rules (no code arrangement questions, Codex policy, one running branch) honored docs/designs/team-performance.md:1
REALITY: numbers pass ledger rows repeating the previous value 98.8% (counted over hive/cost-ledger.jsonl:1-408918); hook event volume is [estimated]
REALITY: deferred-asks pass #61's requests (secret per agent, owner dock out of the hive) both in scope (E2) TODOS.md:1
REALITY: pr-count pass one branch, nothing ships until the owner says so (D2) docs/designs/team-performance.md:1

PLAN_REALITY: phase=eng rows=7/7 missing=none unverified=0 verdict=complete

# Design review (plan-design-review, 2026-10-15)

Approved mockups: `~/.gstack/projects/agentvivekkumar-dontbemichael/designs/team-view-20261015/`
(`team-view.html` round 1, `team-view-round2.html` round 2, `approved.json`). Outside design
voices skipped: owner policy (Codex only for the adversarial code pass, no Claude fallback).

Step 0: 4/10. Focus: all 7 passes (owner, D1).

## Approved direction (owner)

- D2: "i liked B where it tells how to optimize first. The overall metric for agents looks
  like a table of data to read through. This is hard to make sense. This needs to be much
  more visual and graphic to immediately understand what matters the most. what got done,
  what efforts got saved etc."
- D3: C, outcomes on top (B1) and member tiles below (B2). No table anywhere.
- D4: "effort saved" = money saved by applied suggestions ("Saved by your changes") plus
  work counts; no hours estimate (#81 and CEO D9 stand).

## Pass 1: Information architecture (3/10 -> 8/10)

- D5 (1A): a fourth fixed view tab, named **Pulse** (owner: "1A but i want to rename it to
  Pulse"): Office, Tasks, Pulse, Who talks to whom; remembered in `cth.floorView`. Replaces
  "opened from the studio home".
- Order on the page, top to bottom:

```
  Pulse  [This week v]                                         Updated just now
  +-- Ways to save ----------------------------------------------------------+
  | [suggestion] [suggestion] [suggestion]      | Saved by your changes $x   |
  +-- What got done ---------------------------------------------------------+
  | [emails organized] [emails sent for you] [tasks finished] [checks run]   |
  |   big number, label, who-did-it bar with names                            |
  +-- Team -------------------------------------------------------------------+
  | [Michael tile] [member tile] [member tile] [member tile]                   |
  | [member tile] ...  (click a tile -> member detail overlay)                |
  +-- Office -----------------------------------------------------------------+
  | Where the money went (bar) | Plan use ring + pace | Your time, away share |
```

- D6 (1B): a member tile shows what they did (counts by kind) and a **Cost for the work**
  bar: the member's cost per piece of each kind against the office median for that kind,
  marked cheaper / about usual / pricier; "too few to compare" under 5 pieces of a kind.
  No "work share" (unlike work is never added up).
- D7 (1C): Michael's tile comes first, indigo ring: requests routed, questions to you,
  cards opened, and "Running the office: N% of cost"; no cost-for-the-work bar.
- The view is named Pulse everywhere (D5): earlier mentions of "the Team view" or a
  studio home button in this plan mean the Pulse tab.
- Remaining: the layout when the right column narrows the stage (Pass 6).

## Pass 2: Interaction states (4/10 -> 9/10)

- D8 (2A): the period picker offers This week, Last week and Last 4 weeks; weeks start
  Monday, local time; remembered on this computer. Suggestions always use the last 14 days.
  Owner, 2026-10-16: the picker offers Today, This week and This month (a calendar month), and
  a Compare switch sets each against the span before, up to the same day (all of yesterday;
  last week to the same weekday; last month to the same date, capped). Both spans come from the
  same snapshot code. Compare waits until the span before starts on or after the first live
  recorded day. Last week and Last 4 weeks are gone. Reviews: the eng and design review report
  for this change (2026-10-16). Owner, 2026-10-16: the held tile opens a list of what was held,
  read from a private record the hive writes at each hold; the count comes from the hive's
  trust-held line, the same event (docs/designs/research-agent-privacy.md). Owner, 2026-10-16: the
  questions and web answers tiles open lists of each check, both texts kept whole up to 4,000
  characters in private/checked.jsonl, shown 62 days and then moved to private/checked-archive
  (never deleted but by a reset); the counts come from the hive's trust-checked line, one per
  message, and the trust layer's own lines stop counting from v 3 (eng and design reviews,
  2026-10-16).
- D9 (2B): with no suggestion, one calm line "Nothing to change this week." with an (i);
  before 14 days of records, "Suggestions start on <date>." Saved by your changes stays.

```
  FEATURE              | LOADING          | EMPTY                          | ERROR                              | SUCCESS             | PARTIAL
  ---------------------|------------------|--------------------------------|------------------------------------|---------------------|------------------------------
  Ways to save         | last snapshot    | "Nothing to change this week." | hidden (store unavailable message) | amber soft cards    | days with gaps left out (D15)
  Saved by your changes| last snapshot    | "Apply a suggestion to start"  | hidden                             | $ amount, since     | "Measuring, first result <d>"
  What got done        | last snapshot    | zeros with "Collecting since"  | "Pulse numbers are unavailable"    | 4 tiles             | gap notice above the tiles
  Team tiles           | last snapshot    | "Your office is empty" + Hire  | per tile "Could not load"          | tiles               | "Too few to compare yet"
  Office row           | last snapshot    | zeros                          | per section message                | bar, ring, numbers  | ring hidden on an API key
```

  Remaining: exact strings are settled at build with the no dashes rule.

## Pass 3: Journey (5/10 -> 8/10)

```
  STEP | USER DOES                     | USER FEELS                 | PLAN SPECIFIES
  -----|-------------------------------|----------------------------|-------------------------------------------
  1    | clicks Pulse                  | curious: is it working?    | ways to save first, then what got done
  2    | reads What got done           | reassured: it did a lot    | big numbers with who did it
  3    | scans Team tiles              | oriented: who to look at   | cost for the work bar, verdict words
  4    | clicks Apply on a suggestion  | in control                 | D10: green "Applied." with Undo, no dialog
  5    | comes back next week          | trust: did it pay off?     | D16: measured "Saved by your changes"
```

- D10 (3A): Apply confirms in place: the card turns green, "Applied. <what changed>." with
  Undo, which restores the exact previous setting; after leaving Pulse it folds into Saved
  by your changes. Schedules and Edit agent still change it any time.

## Pass 4: AI slop (6/10 -> 8/10)

Classifier: OPERATE (app UI). Hard rejections: none after fixes (tiles are click targets,
not decoration). Litmus: brand clear (app shell) yes; one anchor (What got done numbers)
yes; scannable by headings yes; one job per section yes; cards necessary yes (each is an
action or opens a member); motion none needed; premium without shadows yes.
- D11 (4A): the app's line icons (Icon.tsx: mail, send, check, clock) at 18 px in ink-2
  on a card-2 square; no emoji anywhere on Pulse.
- D12 (4B): suggestion cards use an amber soft fill with a 1 px amber border at 40%, no left
  stripe (the stripe stays Ask me's alone); applied cards turn green soft.

## Pass 5: Design system (7/10 -> 9/10)

- Tokens: amber for proposals, green for savings and good, coral never on Pulse, mono for
  every number (words like "Measuring" stay in Sora), r-xl tiles, shadow-md.
- D13 (5A): in who-did-it and money bars, members of one department take its acc, then m,
  then d shades, with a 2 px white gap; every bar has a legend naming each member with
  their number.
- New DESIGN.md entry at build (7.27 Pulse): outcome tile, member tile, cost for the work
  bar, suggestion card (amber soft, applied green), plan ring (SVG arc, not a gradient).

## Pass 6: Responsive and accessibility (3/10 -> 9/10)

- D14 (6A): reflow by stage width: 1100 px or wider, 4 outcome tiles and 4 member tiles a
  row, office row in 3 columns; 760 to 1099 px, outcomes 2 by 2, members 3 a row,
  suggestions 2 a row, money bar on its own row; under 760 px, one column.
- D15 (6B): tiles and suggestion buttons in tab order with the app focus ring (DESIGN.md
  12); each bar and the ring carry an aria-label sentence with every value; the view is a
  region labelled Pulse with h2 per section; Undo announces in a polite live region;
  RTL mirrors the layout and bars run right to left; nothing relies on color alone.

## Pass 7: Open decisions (1 resolved, 0 deferred)

- D16 (7A): Saved by your changes is measured: (cost per piece in the 14 days before the
  change minus cost per piece since) x pieces since, at API prices, labelled "about";
  "Measuring, first result <date>" for the first 7 days; zero or negative says so.
- D17: the final reference mockup was updated to match every decision.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Pulse (full width and narrow) | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/team-view-20261015/pulse-final.html | ways to save, what got done, team tiles, office row | avatars draw PersonAvatar props in the build; "Measuring" in Sora |
| Member detail | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/team-view-20261015/team-view.html (Member detail section) | overlay like Task detail | facts grid plus amber soft suggestions (D12 style) |

## Design NOT in scope

- Hours saved (D4, #81, CEO D9).
- Custom date ranges (D8).
- A confirm dialog before Apply (D10).

## Design: what already exists

View tabs (TopBar, DESIGN.md 7.2), TaskDetailOverlay pattern for member detail (7.21),
InfoTip (7.23), PersonAvatar and department colors (3.4), Icon.tsx line icons, status and
soft tokens (3.2), the right column (5.2), focus ring (12).

## Design implementation tasks

- [ ] **D-T1 (P1, human: ~2d / CC: ~45min)** — renderer — Pulse view per pulse-final.html (D5 to D16)
  - Surfaced by: Passes 1 to 7
  - Files: src/renderer/src/components/pulse/ (new), src/renderer/src/shell/TopBar.tsx, i18n locales
  - Verify: component tests for each state in the Pass 2 table; screenshot at 1280 with the right column open
- [ ] **D-T2 (P1, human: ~4h / CC: ~15min)** — renderer — accessibility per D15
  - Surfaced by: Pass 6
  - Files: the Pulse components
  - Verify: keyboard walk and aria-label sentences in tests
- [ ] **D-T3 (P2, human: ~1h / CC: ~5min)** — docs — DESIGN.md 7.27 Pulse, tab list in 7.2
  - Surfaced by: Pass 5
  - Files: branding/DESIGN.md
  - Verify: no dashes in copy test passes
- [ ] **D-T4 (P1, human: ~3h / CC: ~10min)** — shared — cost for the work and measured savings math (D6, D16)
  - Surfaced by: Pass 1, Pass 7
  - Files: src/shared/teamPerformance.ts
  - Verify: node --test test/team-performance.test.cjs (median per kind, under 5 pieces, savings before and after)

## Design completion summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI scope: new Pulse view  |
  | Step 0               | 4/10, all 7 passes                           |
  | Pass 1  (Info Arch)  | 3/10 -> 8/10 after fixes                     |
  | Pass 2  (States)     | 4/10 -> 9/10 after fixes                     |
  | Pass 3  (Journey)    | 5/10 -> 8/10 after fixes                     |
  | Pass 4  (AI Slop)    | 6/10 -> 8/10 after fixes                     |
  | Pass 5  (Design Sys) | 7/10 -> 9/10 after fixes                     |
  | Pass 6  (Responsive) | 3/10 -> 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 1 resolved, 0 deferred                       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                            |
  | What already exists  | written                                      |
  | TODOS.md updates     | 0 items proposed                             |
  | Approved Mockups     | 3 generated, 1 approved (final reference)    |
  | Decisions made       | 15 added to plan (D2 to D16)                 |
  | Decisions deferred   | 0                                            |
  | Overall design score | 3/10 -> 8/10                                 |
  +====================================================================+
```

Plan is design-complete. Run /design-review after implementation for visual QA.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | 7 proposals, 6 accepted, 0 deferred |
| Outside Review | codex, plan review (CEO, eng) and design voices | Independent 2nd opinion | 0 | skipped | owner policy (Codex only for the adversarial code pass, no Claude fallback); no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 39 issues (mapped to tasks), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 3/10 → 8/10, 15 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | not applicable |

- **OUTSIDE COVERAGE:** codex, plan-review and design phases, skipped by owner policy, no findings; no native fallback by the same policy.
- **VERDICT:** CEO + DESIGN CLEARED; eng review ISSUES OPEN (findings mapped to tasks, no unresolved decisions); eng review required.

NO UNRESOLVED DECISIONS
