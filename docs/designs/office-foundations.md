# Company foundations: one document every job works from

Owner, 2026-10-19: agents work with whatever is there, so a marketing member with no ideal
customer profile writes for everyone, and the owner never hears why. Revised the same day:

> foundation file should be just one file listing what agent type needs as a foundation ...
> This file can be stored as a part of company wide knowledge base ... can be viewed and
> modified by owner. The out of box installation will ship this file as these are business
> agnostic requirements with `<response>` part being empty. The agents and Michael core
> instructions need to be made aware of this file as default always available context. When
> owner teach agents or agents learn on the job ... that all should also sync with foundation
> document. This way foundation document will eventually be complete even if owner does not
> take time to fill it explicitly.

Earlier the same day the owner asked that each member's work show a quality score that drops
while its foundations are missing, on Pulse, so the owner sees why some members do weaker work.
No product is ever required or recommended by name: an answer says what is true for this
business ("Money in and out: bank statements, one PDF a month, in Finance/Statements").

Research behind it (deep research, 2026-10-19, 103 agents, each claim checked by three
skeptical reviewers): agents left alone almost never ask for missing context; a few targeted
questions recover most of the quality it costs; foundational context works best stored once
and applied by default (HubSpot brand voice, Jasper IQ); gaps close fastest when the system
fills what it can and a person confirms (Intercom Fin); nudges work when sparse and retire
when the gap closes; a head start raises completion (endowed progress).

## 1. The document

One document in company knowledge, titled **Company foundations**, shipped with every install.
Plain Markdown, one section per job, numbered questions with an answer after the colon:

```
# Company foundations

## Sales
1. What we sell: <empty>
2. Who we sell to (ideal customer): <empty>
3. How a sale happens, step by step: <empty>
4. Businesses, consumers or both: <empty>
5. Where leads and deals are kept: <empty>
6. Prices and terms: <empty>

## Marketing
1. Who we sell to (ideal customer): <empty>
2. How we sound (brand voice): <empty>
3. How we look (brand kit: logo, colors, fonts): <empty>
4. Who our customers are today: <empty>
5. What we sell: <empty>
6. Who we compete with, and how we differ: <empty>

## Finance
1. Accounting method (cash or accrual): <empty>
2. Financial year: <empty>
3. Where money in and out is recorded: <empty>
4. Who owes us and whom we owe, and where that is kept: <empty>
5. Statements, budgets or targets: <empty>
...
```

- **Business agnostic.** The questions ship the same for every install; the answers are this
  business's. Sections follow the office's departments (Sales, Marketing, Finance, Customer
  support, Front desk and admin, People, IT, Operations; `officeRoles.ts`). A section appears for
  each job the office has. Questions live in `src/shared/foundations.ts`, one catalog.
- **A shared question has one answer** (owner, 2026-10-19: "marketing ICP and sales ICP
  should be same even it is repeated in the document"). Each question has an id in the catalog
  (`customers`, `offer`, `voice` ...); a job section lists the ids it needs, so "Who we sell
  to" shows under Sales and Marketing, but it is one answer. Answering or changing it anywhere
  writes the same answer at every place it appears.
- **A head start.** At setup the app answers what the company profile already holds (opening
  hours, financial year), so the document never starts at zero.
- **One set of facts with the company profile** (architecture review, 2026-10-19). Where a
  question repeats a company profile field, the two stay in step: setup writes the profile
  answer into the foundations, a profile change in Settings updates the same answer, and an
  answer the office learns for it updates the profile field. The profile keeps its short form;
  the foundations hold the same fact, never a second version.
- **Existing offices** get the document seeded on the next launch, answers empty except the
  head start.

## 2. Where it lives, and how the owner sees it

Architecture review, 2026-10-19: the company knowledge store is a search index (documents are
added, split into chunks and indexed; none is edited in place), so it cannot be the live record
that agents write to at any time.

- **The record** is one structured file the app alone writes: `foundations.json` in the
  office's private folder (`private/` in the office folder), out of every member's reach (the
  app files gate). It holds each question's answer once, with who gave it, when, and where it
  came from.
- **The readable copy** is the Company foundations document above, published into company
  knowledge from the record every time it changes (the old copy removed, the new one added).
  Members search it like any company document; the owner sees it in Settings, Memory &
  Knowledge, where it opens as a read only copy.
- **The owner's own editing** (a form in Settings) comes in a later release (owner,
  2026-10-19). Until then the document fills through Ask me answers and what the office learns
  (sections 4 and 5).
- A shared question is one entry in the record, printed under every job that lists it.

## 3. Always in context

- **Michael** gets the whole document with his session context (like the company profile),
  and again whenever it changes.
- **Each member** gets its own job's section, plus which of its questions are empty, again on
  change. A member who covers two jobs gets both.
- **Research gets none** (eng review finding 1): like the company profile, the foundations never
  go to the one member online.
- It stays short by design (a few dozen lines), so it costs little to carry on every turn.

## 4. How members use it (the DNA)

```
 task arrives ─► does it depend on a foundation question of my job?
                   ├─ answered ─► follow the answer
                   └─ empty ─► do the work anyway
                               ├─ one line in the result: "Written without our ideal customer"
                               └─ report the gap to `foundations` (the app keeps it once per
                                  question and tells Michael the first time)
 Michael ─► one Ask me card per empty question the work hit, for the whole office
              [ answer field ]  ─► written into the document ─► every member sees it
              [ Draft it ]      a member drafts from what the office holds; the draft comes
                                back into the card for the owner to save (design D8)
              [ Not now ]       back in a week
 still empty a week later ─► the card comes back, every week, until the question is answered
```

- **Weekly until answered** (owner, 2026-10-19: "the nudge should keep coming weekly until
  done"), through a default "Foundations check" job on Michael's schedule (eng D3), visible and
  editable in Schedules; the app never moves cards. An empty question the work hit keeps one card. Not now hides it for a week; a card
  left open comes back to the top of Needs you once a week. It stops only when the question is
  answered, by the owner or by what the office learns (section 5).
- **Only what the work hit** (owner, 2026-10-19). A card is raised for a question only after a
  member's work needed it and found it empty; the document's other empty questions never
  become cards on their own. When the work hits many, many cards is right: each is a real gap
  the office ran into.
- Still one card per question, never one per task or per member, so a week brings at most one
  reminder for each empty question.

## 5. The document fills itself as the office learns

- **The owner teaches a member** (an Ask me answer, a correction in the conversation) and the
  answer is a foundation answer: the member sends it to the foundations as well as keeping it
  in its own memory.
- **A member learns it on the job** (the price list in a sent quote, the financial year from a
  bookkeeping export): same, it sends the answer to the foundations.
- **How it is sent**: a hive message to `foundations` (like `scheduler`), carrying the question
  id, the answer and **where it came from** (the owner's message, a file, a record). The app is
  the only writer: it checks the message, writes the record, and republishes the document.
- **A learned answer goes live at once**, with no approval (owner, 2026-10-19). It is marked
  with who and when ("Learned by Ryan, 19 Oct"), so the owner sees what came from where and
  can correct it through Michael (and in the form, once it ships).
- **A learned answer to a shared question** fills it everywhere it appears, like an owner's.
- **A member fills only an empty answer.** A change to an answer the owner wrote goes to
  Michael as a suggestion, never over the owner's words.
- **Safeguards on learned answers** (architecture review and deep research, 2026-10-19:
  agents' shared memory is easily poisoned, and screening text alone misses plain wrong facts):
  - **A source is required.** An answer with no source is refused, and the member is told.
  - **Outside text goes through Michael.** An answer drawn from an email from someone outside,
    a web page or any outside text goes to Michael first, under the existing screening rule
    (high confidence flags to Michael, never the owner); only what he confirms is written.
    Answers from the owner or the office's own records go straight in.
  - **A cited owner message is checked** (ship review, 2026-10-20). The app keeps the ids of
    the messages the owner sends, and who got each, in its private folder
    (`owner-said.jsonl`), out of the team's reach; only those count as the owner's words, never
    a line in the hive log, which a member's shell can write. A member citing one fills only an
    empty answer, marked as taught to that member. Only Michael can change an answer the owner
    wrote, and only by citing a message the owner sent him.
  - **Own job only.** A member answers and reports gaps only for its own job's questions;
    Michael for any. Only the member the owner asked, or Michael, fills a draft.
  - **Short answers.** Each answer is one plain line, capped at about 300 characters (a longer
    one points to a file), so the document stays a few dozen lines.
  - **Conflicts are caught.** When a member sends an answer that differs from a learned one,
    the app keeps the first and raises the difference to Michael instead of overwriting.

## 6. The foundations count

The app computes it from the document; no member grades itself (owner rule, 2026-10-15:
Pulse counts only what the app records).

- **From history in harness.db** (eng finding 4): every change to the record also writes a
  telemetry event, so Pulse knows what was answered on each day.
- **For each day's work** (cards done, scheduled runs, drafts sent) the app takes how much of
  that member's job section was answered that day: answered
  questions over all its questions, each question weighing the same. A shared answer
  counts for every job that lists it.
- **A member's foundations count** for the period is the average over its work, shown as
  "Foundations 2 of 6" with what is missing ("missing ideal customer and brand voice").
- **It measures the office, not the member** (architecture review, 2026-10-19): every member
  of a job shares the same empty questions, so it is never called a quality score. Quality is
  what Pulse already measures, work kept as is, shown beside it.
- **Proof, not a claim**: Pulse already measures work kept as is (drafts sent unchanged, cards
  not reopened). Once a member has work both before and after a question was answered, Pulse
  shows the difference ("Kept as is 45% without our ideal customer, 85% with").

## 7. On Pulse (design review D3 to D9, D14)

- **The strip sits inside Recommendations** (D3), one row under the header (under the Early look
  header while it shows): "Foundations  Marketing 1/6  Sales 2/6". Only jobs whose work hit an
  empty question appear, the most hit first (D4). A job leaves once every question its work hit
  is answered, and the strip goes when no job is left (D7). Clicking a job opens its waiting
  foundation cards in Needs you, or the Company foundations document as a read only copy when
  none is waiting (D5).
- **Team at work** (D6): a member missing any foundation shows a small ring and "Foundations
  2 of 6" under its role; the table keeps its four columns. Nothing shows once all of its
  questions are answered (D9).
- **Member detail** (D14): one more fact box, "Foundations 1 of 6", the missing questions that
  work hit as pills (each opens its waiting card), "and 3 more no work has needed yet", and once
  the evidence exists two small bars: work kept as is without the answer and with it.
- **Early look and Recommendations**: once the kept as is evidence exists, "Answer who we sell
  to: Ryan's posts are kept as is 45% without it, 85% with". Deferred at ship (owner, D2,
  2026-10-20) and kept in TODOS.md; until then the proof shows only in member detail.

## 8. Agent behavior changes (each needs the owner's decision)

1. Every member and Michael carry the document (their section, or all of it) in context.
2. A member doing work that depends on an empty question adds one limitation line and tells
   Michael once per question.
3. Michael raises one Ask me card per empty question the work hit, with Draft it and Not now,
   and raises it again each week until the question is answered.
4. Members send what they are taught or learn on the job to the foundations, filling only
   empty answers, each marked with who and when.

## 9. Decided

- A question two jobs share has one answer, repeated in each job's section (owner, 2026-10-19).
- The nudge for an empty question repeats weekly until it is answered (owner, 2026-10-19).
- Every question weighs the same in the count (owner, 2026-10-19).
- A learned answer goes live at once, with no approval; it is marked with who learned it and
  when (owner, 2026-10-19), with the safeguards in section 5.
- Cards come only from questions the work hit; many cards is fine when the work hit many
  (owner, 2026-10-19).
- The record is a structured file the app alone writes; company knowledge holds the readable
  copy. The owner's editing form waits for a later release (owner, 2026-10-19).
- "Foundations 2 of 6", never a quality score; kept as is stays the quality measure.
- The foundations and the company profile hold one set of shared facts.

## Changed at ship (2026-10-20)

The reviews below describe the plan as reviewed. Finding 2, R4 and the architecture sketch say
the app finds a cited owner message in the hive log; as built, it checks the app's own list of
the owner's sent messages in the private folder (section 5). The Early look and Recommendations
line (section 7) is deferred to TODOS.md.

## NOT in scope

- Judging whether an answer is *good*; only whether it is there.
- Any product recommendation or connector setup flow.
- The owner's editing form in Settings (a later release).
- Owner defined questions (later: the owner adds a question to a section).

## Eng review (2026-10-19)

Target: this design, checked against `src/main/hooks.ts` (context delivery), `src/main/knowledge.ts`
(company knowledge store), `src/main/hive.ts` (special recipients, Ask me rules),
`src/main/factoryReset.ts`, `src/shared/companyProfile.ts`, `src/shared/officeRoles.ts` and the
packs, at bd681437 plus later commits.

### Scope Challenge

- **What exists to build on**: the company profile is delivered at session start and again on
  change, never repeated unchanged (hooks.ts:915); the same path carries the foundations. Special
  hive recipients (`scheduler`, hive.ts:3037) give the `foundations` target. The app's private
  root (factoryReset.ts:39, behind the app files gate) holds the record. Company knowledge
  supports add, get, list, search and remove (knowledge.ts:40), so a change republishes the copy.
- **Arrangement**: chosen, not asked (owner rule): `src/shared/foundations.ts` (catalog, record
  shape, rendering, count), `src/main/foundations.ts` (the single writer), hook delivery beside
  the profile, a `foundations` route in hive, Pulse reading the history.
- **Scope accepted as is**; no feature cuts proposed.

Findings (all within decisions the owner already made; recorded as corrections, no question):

1. **[P1] Research gets no foundations** (confidence 9/10, hooks.ts:921
   `!isResearchAgent`): the company profile never goes to Research, the only member online, under
   the research privacy design. The foundations follow the same rule.
2. **[P1] A source is verified, not taken on trust** (8/10): a member could claim "the owner told
   me". The app accepts a source only if it checks out: an owner message id it finds in the hive
   log from the owner, or a file inside the office folders. Anything else is outside text and goes
   to Michael first (owner approved safeguard, 2026-10-19).
3. **[P2] The weekly reminder is Michael's scheduled job** (8/10): the app records and shows,
   never moves cards (owner rule), and recurring jobs carry their how in a Work style. A default
   "Foundations check" job on Michael's schedule, visible in Schedules and run as configured,
   re-raises each still empty question that the work hit.
4. **[P2] The count is computed from history in harness.db** (8/10): each change to the record
   also writes a telemetry event (answered, changed, cleared, with question id and time). Pulse
   works out each member's coverage on each day from those events and its pieces of work that
   day, so no new store and no agent written file feeds Pulse (owner rule, 2026-10-15).
5. **[P2] Republish and delivery are batched** (7/10): several learned answers in a minute
   republish the company knowledge copy once, and members get the new section once.
6. **[P2] Owner written wins over learned in the profile sync** (8/10): a learned answer never
   overwrites a profile field the owner set, the same rule as the document itself.
8. **[P2] The app keeps "once per question"** (8/10): a member reports a gap to the
   `foundations` route, not straight to Michael. The app records the hit (which question, which
   member, when), forwards the first one to Michael, and drops repeats, so "once" does not rest on
   a member's memory. The weekly job's run lists the questions hit and still empty.
7. **[P2] A factory reset removes the record**, and existing offices get it seeded on the next
   launch (factoryReset.ts PRIVATE_ENTRIES).

## Decision ledger

### R1: Every member and Michael carry the foundations in context (behavior change 1)
Finding: behavior change 1 (section 8), eng review
Plan baseline: section 3: Michael the whole document, each member its job's section, on start and on change
Runtime evidence: the company profile is delivered this way today (hooks.ts:915), never to Research
Comparison grid: A) as written, Research excluded | B) members get only the list of their empty questions and search company knowledge for answers when needed
Question D1: see the AskUserQuestion of the same id
State: approved
Actual answer: A) Always in context (D1, 2026-10-19)
Accepted scope: members get their job's section on session start and on change, Michael the whole document, Research none, through the company profile delivery path.

### R2: A member doing affected work adds a limitation line and tells Michael once (behavior change 2)
Finding: behavior change 2 (section 8), eng review
Plan baseline: section 4: do the work anyway, one line in the result, tell Michael once per question
Runtime evidence: house rule 2 and the worker rule "do the rest and say plainly what is missing" (hive.ts:263, :424); triage files reach Michael today (hive.ts:421)
Comparison grid: A) as written | B) tell Michael once, no line in the result
State: approved
Actual answer: A) Note and tell once (D2, 2026-10-19)
Accepted scope: the member does the work, adds one line in what it hands back (its report, the card, a note beside a draft; never inside text sent to anyone outside), and tells Michael once per question through triage.

### R3: Michael raises one card per empty question the work hit, weekly until answered (behavior change 3)
Finding: behavior change 3 (section 8) and finding 3, eng review
Plan baseline: section 4; weekly repeat (owner, 2026-10-19); cards only from questions the work hit (owner, 2026-10-19)
Runtime evidence: Michael writes Ask me cards (hive.ts:366); the app never moves cards (owner rule); recurring jobs need their how in a Work style (owner rule)
Comparison grid: A) one card per question, It's here / Draft it / Not now, re-raised weekly by a "Foundations check" job on Michael's schedule | B) the same, but the weekly re-raise comes from the app instead of a scheduled job
State: approved
Actual answer: A) Michael, weekly job (D3, 2026-10-19)
Accepted scope: Michael raises one Ask me card per empty question the work hit (an answer, Draft it, Not now); a default weekly "Foundations check" job on Michael's schedule, visible and editable in Schedules, has him re-raise each question still empty; the app never moves cards.

### R4: Members send what they are taught or learn to the foundations (behavior change 4)
Finding: behavior change 4 (section 8) and finding 2, eng review
Plan baseline: section 5; no owner approval (owner, 2026-10-19); safeguards approved (owner, 2026-10-19)
Runtime evidence: members keep what they learn in their own memory only (hive.ts:312); no shared write path exists
Comparison grid: A) owner taught and on the job answers, each with a verified source; outside text through Michael; fill only empty; conflicts to Michael | B) only answers the owner taught, never on the job learning
State: approved
Actual answer: A) Taught and learned (D4, 2026-10-19)
Accepted scope: members send owner taught and on the job answers to `foundations`, each with a source the app verifies (an owner message in the hive log, or a file in the office folders); anything else is outside text and goes to Michael first; members fill only empty answers; a clash with a learned answer goes to Michael; Research sends none.

Approval readiness: PASS (R1 D1 A, R2 D2 A, R3 D3 A, R4 D4 A, 2026-10-19)

## Design review (2026-10-19)

Scope: the foundation card in Needs you, the Company foundations strip and the count on Pulse.
Mockups (HTML with the app's tokens, owner rule):
`~/.gstack/projects/agentvivekkumar-dontbemichael/designs/foundations-20261019/foundations-variants.html`.

- **D2, the card: evidence first, then the answer** (variant 1A). Title is the question ("Who we
  sell to"); the member who hit it, as the usual raiser chip, and when; one bold line of what the
  work did without it ("Ryan wrote 3 posts this week without knowing who you sell to"), then the
  other jobs that use it; a multi line answer box; Save answer (primary), Have Ryan draft it
  (secondary), Not now (quiet, at the end); a footer naming the jobs that use the answer.
- **D3, the strip sits inside Recommendations** (variant 2A): one row under the Recommendations
  header, under the Early look header while it shows: "Foundations  Sales 2/6  Marketing 1/6
  Finance 0/5", each job a pill with a small bar. No new section on Pulse.
- **D4** the strip shows only jobs whose work hit an empty question, most hit first.
- **D5** clicking a job opens its waiting cards in Needs you, else the document at that job.
- **D6** the count sits under the member's name on Team at work; no new column.
- **D7** a job leaves the strip once every question its work hit is answered.
- **D8** Have Ryan draft it: the card shows "Ryan is drafting an answer from your past clients"
  (a status line in `indigo-soft`, Save disabled), then the draft fills the answer box, labeled
  "drafted by Ryan", for the owner to edit and save. Answers learned on the job still go live at
  once (eng D4).
- **D9** nothing shows on a row once all of a member's questions are answered.
- **D10** foundation cards are listed together after the decision cards in Needs you.
- **D11** the card names its member with the usual Ask me raiser chip, in the member's
  department color; amber stays advice.
- **D12** the answer box has a visible label "Your answer" and the hint as a line under it,
  linked as its description; the hint never sits inside the box.
- **D13** at 320 px, Save answer and Have Ryan draft share a line and Not now wraps to its own.
- **D14** member detail gains a Foundations fact box with the missing questions and the proof.

States:

| Part | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Foundation card | as other Ask me cards | never shown without a hit | save fails: the typed answer stays, a line "Couldn't save, try again" | card closes; a polite line "Saved to Company foundations" | drafting: status line, Save disabled; draft arrived: box filled, "drafted by Ryan" |
| Strip | none until the snapshot lands | not shown (no job hit) | the view's "unavailable" card | not shown once every hit question is answered | jobs leave one by one |
| Count on a row | as Team at work | not shown (all answered) | as Team at work | not shown | "Foundations 2 of 6" |
| Member detail box | as the detail | not shown (all answered) | as the detail | not shown | count, missing pills, proof once evidence exists |

Journey:

| Step | Owner does | Owner feels | Plan specifies |
|---|---|---|---|
| 1 | Sees a foundation card after the decisions | "This is why the posts were generic" | evidence line (D2), order (D10) |
| 2 | Asks Ryan to draft it | relief, someone starts it | drafting state (D8) |
| 3 | Reads, fixes and saves the draft | in control, quick | draft in the box, Save (D8) |
| 4 | Sees Marketing leave the strip | progress | strip leaves (D7) |
| 5 | Weeks later, sees kept as is rise | the answer paid off | proof in member detail (D14) |

Accessibility: the card is a group named by its question; the answer box has a visible label and
its hint as the description (D12); strip jobs are buttons named "Marketing, 1 of 6 answered. Open
its questions"; the drafting line is a polite status; the ring is decorative beside its text.
Every color is an existing token (`indigo`, `indigo-soft`, `neutral-soft`, department colors).

Approved mockup:
`~/.gstack/projects/agentvivekkumar-dontbemichael/designs/foundations-20261019/foundations-approved.html`
(the card waiting, at 320 px, drafting and with a draft; the strip; Team at work; member detail).

## Eng Review Body

### 1. Architecture

```
 member ─(answer + source | gap)─► hive route `foundations` ─► FoundationsWriter (main, single writer)
                                                                 ├─ verify source: owner message in hive log
                                                                 │   or file in office folders; else ─► Michael
                                                                 ├─ rules: fill only empty, owner wins, cap,
                                                                 │   clash ─► Michael, gap kept once ─► Michael
                                                                 ├─ foundations.json (private root)
                                                                 ├─ telemetry event (harness.db) ─► Pulse count
                                                                 ├─ company profile sync (owner wins)
                                                                 └─ debounced publish ─► company knowledge copy
 hooks (SessionStart / change) ─► member: its job section │ Michael: all │ Research: nothing
 Michael ─► Ask me card per hit question ◄─ weekly "Foundations check" job (Schedules)
 Ask me answer ─► Michael ─► `foundations` (source: the owner's answer)
```

Findings 1 to 4 and 8 above (Research excluded, verified sources, weekly job, history in
harness.db, once per question kept by the app). One realistic failure per new path:

| Path | Failure | Handling | Owner sees |
|---|---|---|---|
| writer | two answers for one question in the same second | single writer in main, in order | first wins, clash to Michael |
| publish | knowledge store unavailable | record kept; publish retried on next change and at launch | members still get answers through the hook |
| source check | member claims an owner message that is not in the log | treated as outside text, to Michael | nothing until Michael confirms |
| delivery | answers change mid task | delivered on the next prompt, like the profile | updated answers on the next turn |
| weekly job | office closed at the job time | the usual catch up rule (missions.ts) | the check runs once on opening |

### 2. Code quality

Findings 6 and 7 (owner wins in the profile sync; factory reset and seeding). One catalog
(`src/shared/foundations.ts`) drives the record, the rendered document, each member's section and
the count, so the four never drift.

### 3. Tests

```
CODE PATHS                                               USER FLOWS
[+] shared/foundations.ts                                [+] New office
  ├── [GAP] render: shared question printed in each job     ├── [GAP] seeded with profile head start
  ├── [GAP] section per job, empty markers                  └── [GAP] [→live] member hits empty ICP: note,
  └── [GAP] count: answered / all, equal weights                       one card, weekly re-raise
[+] main/foundations.ts writer                           [+] Learning
  ├── [GAP] fill only empty; owner wins                     ├── [GAP] owner answer on Ask me fills it
  ├── [GAP] verified source vs outside -> Michael           └── [GAP] learned answer marked, clash to Michael
  ├── [GAP] cap, clash, gap once per question            [+] Pulse
  ├── [GAP] profile sync both ways, owner wins              └── [GAP] Foundations 2 of 6 beside kept as is
  └── [GAP] seed, migration, factory reset
[+] hooks delivery: [GAP] member section, Michael all, Research none, on change
[+] hive.ts instructions: [GAP] pins for the four behavior rules [→EVAL] live check
COVERAGE: 0/16 paths tested (all new) | GAPS: 16, mapped to T1 to T9
```

Regression contract: the company profile keeps reaching every member except Research exactly as
today; Ask me cards keep their rules; Research's privacy rules are unchanged.

### 4. Performance

No issues beyond finding 5: a few dozen lines per member per change; one debounced publish.

### Outside voice

Skipped by the owner's standing rule: Codex only as the adversarial pass at ship.

### TODOS.md updates

None proposed. The owner's editing form is a later release (NOT in scope).

### Parallelization

| Step | Modules | Depends on |
|---|---|---|
| T1 catalog | src/shared | none |
| T2 writer, T3 route | src/main | T1 |
| T4 delivery, T5 instructions | src/main | T1 |
| T6 packs | resources/packs | T1 |
| T7 Pulse | src/main, src/renderer | T2 |
| T8 docs | docs, branding | none |

Lane A: T1, then T2 and T3, then T7. Lane B (after T1): T4, T5, T6. Lane C: T8. Sequential
merge; T9 last.

## Implementation Tasks

- [x] **T1 (P1, human: ~1 day / CC: ~30 min)** catalog, record shape, rendering, count
  (`src/shared/foundations.ts`), questions per job, shared ids, equal weights. Tests: render, count.
- [x] **T2 (P1, human: ~2 days / CC: ~1h)** the single writer (`src/main/foundations.ts`): record
  in the private root, seed and migration, verified sources, outside text to Michael, fill only
  empty, owner wins, cap, clash, profile sync, telemetry events, debounced publish to company
  knowledge, factory reset entry. Tests: every rule.
- [x] **T3 (P1, human: ~1 day / CC: ~30 min)** hive route `foundations`: answers and gap reports,
  gap kept once per question, first forwarded to Michael. Tests: route and dedupe.
- [x] **T4 (P1, human: ~1 day / CC: ~20 min)** hook delivery beside the profile: member's job
  section, Michael all, Research none, on change. Tests: delivery per role.
- [x] **T5 (P1, human: ~1 day / CC: ~30 min)** instructions (D1 to D4): the member foundations
  line, Michael's card rules, the default weekly "Foundations check" job with its how in his Work
  style. Tests: prompt pins.
- [x] **T6 (P2, human: ~3h / CC: ~15 min)** packs: each role's job section; custom hires by
  department. Tests: pack validation.
- [x] **T7 (P1, human: ~1 day / CC: ~45 min)** Pulse: Foundations 2 of 6 beside kept as is, the
  Company foundations strip, the with and without evidence; locales. Tests: count from events, pins.
- [x] **T7a (P1, human: ~1 day / CC: ~40 min)** the foundation card in Needs you (design D2,
  D8, D10 to D13): evidence line, raiser chip, labeled answer box, Save, Have Ryan draft it, Not
  now, drafting and draft arrived states, listed after decisions, 320 px wrap. Tests: pins; live.
- [x] **T7b (P1, human: ~3h / CC: ~15 min)** member detail Foundations box (design D14).
- [x] **T8 (P2, human: ~2h / CC: ~10 min)** DESIGN.md (the card, the strip, the count), CHANGELOG
  with the four behavior changes.
- [x] **T9 (P1, human: ~3h / CC: ~20 min)** full suite and a live check: a member hits an empty
  question, the note, one card, an Ask me answer filling the document.

## Eng Review Completion Summary

- Step 0: Scope Challenge, scope accepted as-is
- Reality rows: 7/7, 0 unverified premises
- Architecture Review: 5 issues found (findings 1, 2, 3, 4, 8)
- Code Quality Review: 2 issues found (findings 6, 7)
- Test Review: diagram produced, 16 gaps identified, all mapped to tasks
- Performance Review: 1 issue found (finding 5)
- NOT in scope: written
- What already exists: in the Scope Challenge
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, skipped (owner rule)
- Parallelization: 3 lanes, merged in order
- Lake Score: N/A

REALITY: premise-table pass profile delivery, special recipients, store operations read from code hooks.ts:915
REALITY: already-done pass no foundations code on main or the branch src/shared/companyProfile.ts:1
REALITY: surface-check n/a no CLI or route named hive.ts:3037
REALITY: binding-decisions pass owner rules kept (Michael owns cards, Pulse from harness.db, Research privacy) hooks.ts:921
REALITY: numbers pass about 300 character cap and a few dozen lines are design values [estimated] office-foundations.md:1
REALITY: deferred-asks pass the editing form is deferred by the owner office-foundations.md:1
REALITY: pr-count pass one change on the running branch office-foundations.md:1

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                     |
  +====================================================================+
  | System Audit         | DESIGN.md present; card, strip, count, detail|
  | Step 0               | 3/10; card anatomy, placement, states       |
  | Pass 1  (Info Arch)  | 4/10 -> 8/10 after fixes                    |
  | Pass 2  (States)     | 2/10 -> 8/10 after fixes                    |
  | Pass 3  (Journey)    | 5/10 -> 8/10 after fixes                    |
  | Pass 4  (AI Slop)    | 8/10 -> 8/10, no issues                     |
  | Pass 5  (Design Sys) | 6/10 -> 8/10 after fixes                    |
  | Pass 6  (Responsive) | 4/10 -> 8/10 after fixes                    |
  | Pass 7  (Decisions)  | 1 resolved (member detail), 0 deferred      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (owner editing form, quality judge) |
  | What already exists  | Ask me card, raiser chip, PixelButton,      |
  |                      | cth-input, quiet chip, Early look header    |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 2 built, 1 approved (HTML, owner rule)      |
  | Decisions made       | 13 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 -> 8/10                                |
  +====================================================================+
```

Unresolved decisions: none.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | codex, plan review and design phases | Independent 2nd opinion | 7 | skipped | owner rule (adversarial pass only) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 6 | ISSUES OPEN | 24 issues, 0 critical gaps; all decided and mapped to tasks |
| Design Review | `/plan-design-review` | UI/UX gaps | 6 | CLEAR | score: 2/10 -> 8/10, 13 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** codex, design and plan review phases, skipped (owner rule); no findings.
- **VERDICT:** DESIGN CLEARED. Eng review complete with every finding decided and mapped to tasks (its status counts mapped work). Ready to implement.

NO UNRESOLVED DECISIONS
