# TODOS

## Connections

### One call at a time per connected app, and a throttle notice

**What:** The broker now backs off per connected app after a 429 or a 503 with `Retry-After` (`src/main/brokerThrottle.ts`, PR #399): a wait of 20 s or less is held, a longer one is answered at once with when to try again. Two parts are left. Send one call at a time per app, so the calls held during a wait don't all go out together when it ends and hit the limit again. And show the owner a throttle that lasts, in plain words, instead of it showing only in agents' answers.

**Why:** Gmail, Google Business Profile, Meta and QuickBooks all throttle. Held calls released together can trip the limit straight away, and a long throttle is invisible to the owner today.

**Context:** Decision 22 (business-mode-office-packs.md) named a serialized executor with at most one call in flight per connection as the home for this; Decision 25 named the attention strip, which does not exist yet.

**Effort:** M
**Priority:** P2
**Depends on:** Decision 2 (per-agent grants), Decision 22 (serialized executor); only relevant from Phase 2, when agents make real third-party calls.

## Research agent (deferred from the third ship of mit/named-links, 2026-10-13)

### A checked message for Pete is never dropped when delivery fails

**What:** `queueForResearch()` in `src/main/hive.ts` removes the message's row from `research-pending.json` before `deliverToResearch()` and the commit succeed, and a delivery error is only logged. Keep the row until delivery succeeds, requeue it on failure, and tell Michael when it can't be delivered.

**Why:** Found by the Codex adversarial review of the mit/named-links ship (2026-10-14). A disk or git error drops an owner or app message for Pete with no trace, and the record that would have recovered it is already gone.

**Effort:** S
**Priority:** P2

### Catch money amounts in the privacy check's pattern recheck

**What:** Add a pattern for money amounts to the recheck in `src/shared/dataClasses.ts`: digits with a currency mark or code before or after them (Rs, INR, ₹, $, USD, €, £ and the like, with the groupings people write, such as `1,35,000` or `2,000.50`). Today the only money pattern is the card number check.

**Why:** Found by PR 411 (Tejashree0405), confirmed on main 2026-10-18: when the model's cleaned rewrite of a message to Pete keeps "Rs 1,35,000", "₹5,000" or "$2,000", the recheck lets it through, so business figures (private by default) rely on the model alone. In the contributor's live runs, one of 30 private messages kept a payroll figure.

**Behavior change:** Pete gets more messages refused or trimmed: a message to Pete that names an amount is cleaned or refused even when the model passed it. Tests should keep years, counts and percentages passing.

**Effort:** S
**Priority:** P2

### Give Pete mail folders it can only read

**What:** Keep the Research team member's inbox and the outbox the app reads in folders only the app writes, and give Pete a way to mark a message handled and to hand in an answer that does not need its shell to write there.

**Why:** Three review passes and two Codex passes each found a new way for a steered Pete to trick the app through its own folders: links, pipes, hard links, forged messages, swapped folders. Each is fixed and tested (`src/main/hive.ts` researchDir, researchDelivered, dropResearchEntry; `src/main/researchNotes.ts` ownResearchDir), and its shell now writes only inbox, outbox, memory and its desk (verified live). The review still ended with converged false (owner, third ship D6): the class of attack stays as long as the app acts in folders Pete writes.

**Context:** The app delivers stamped copies already (`researchStamp`), so an app owned inbox Pete reads is a small step; marking handled could be a message to the app instead of a move into `.done`. The outbox needs a drop folder the app moves out of at once, or a hook on Pete's Write tool that hands the file to the app.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Keep Claude Code's transcripts and history out of agents' reach

**What:** Wall every agent's file tools and shell from Claude Code's projects folder and `history.jsonl` (under `CLAUDE_CONFIG_DIR` or `~/.claude`), apart from what the app itself needs.

**Why:** Any team member can read the other team members' Claude Code conversations there, and the prompts hidden checks send, which can quote what a teammate asked Pete before the trust layer cleaned it. The trust layer now removes each check's transcript as it ends and sweeps leftovers at launch (`src/main/hiddenClaude.ts` dropTranscript), but a check's prompt may also be kept in Claude Code's history.

**Context:** Found by the security review and Codex in the third ship. Pete is already walled from both. Adding `claudeProjectsRoot()` to every agent's read walls needs care: Michael reads his own transcript through the app, not his tools.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Take the internet from team members' shells on Windows

**What:** Hold team members' shell commands off the internet on Windows, where the engine has no sandbox. Until then, the Research screen says so on Windows (done 2026-10-18).

**Why:** On Windows only the web tools are refused; a shell command can still reach the internet, so the rule that only Pete uses the internet is not enforced there. The CHANGELOG names this.

**Effort:** M
**Priority:** P2
**Depends on:** A Windows shell sandbox, or a firewall rule per team member.

### Wall members' notes from every engine's shell, and on Windows

**What:** Keep a team member's shell from reading another member's hive folder (agents/<id>/) and the hive's git history on every engine, not only Claude on a Mac and Linux, and on Windows.

**Why:** Member memory is private (owner, 2026-10-16), and the walls are Claude Code's sandbox Read rules plus the hook on file tools. Codex, Gemini and the other engines get no such shell rule, and Windows has no sandbox at all, so a shell command there can still read a teammate's notes; on Windows that includes Research, which can reach the internet from its shell. Found by the ship review and the Codex adversarial review of the running branch (2026-10-17, owner D3.3).

**Context:** The prompts tell every member to ask instead; the file tool hook refuses everywhere. Each engine's own sandbox config, where one exists, is the place to add the rule; Windows needs the same shell sandbox as the item above.

**Effort:** M
**Priority:** P2
**Depends on:** A Windows shell sandbox for the Windows part.

### Keep a teammate's question to Pete across a quit while its check waits

**What:** Save a teammate's own message to Research while it waits for the privacy check (up to 30 minutes), as the owner's and the app's notes are saved, and tell the sender and Michael after a restart.

**Why:** queueForResearch writes only the owner's and the app's notes to research-pending.json; a teammate's question that waits through a quit or a crash is lost with no word to anyone. The wait used to be seconds; it is now up to 30 minutes, mostly while the team starts. Found by the ship review red team (2026-10-17, owner D3.3).

**Effort:** S
**Priority:** P3
**Depends on:** None

## Team performance (from the CEO review of docs/designs/team-performance.md, 2026-10-15)

### Move the cost ledger into the telemetry store

**What:** Move the circuit breaker and lifetime totals from `hive/cost-ledger.jsonl` onto the telemetry store in harness.db, then stop writing the file.

**Why:** After the team performance build, cost data lives in two places that can drift apart, and the file is agent writable and grows forever (403,830 rows in its first 3 weeks).

**Context:** `db.ts` already reserves a `cost_ledger` table with the file's column names. Readers today: `costLifetime.ts`, `runBreakerBeat` in `index.ts`, `tools/agent-metrics.cjs`. The team performance processor already folds cost points from the store with `src/shared/costFold.ts`. Owner decision D17.

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** The team performance build (telemetry store)

### Give Fable a tier and a price

**What:** Add Fable's tier (top, middle or small) to `modelCatalog.json` and its price rows to `pricing.ts`, from Anthropic's published pricing.

**Why:** Model advice in the Team view needs a tier, so members on Fable, the default model (`config.ts:525`), get no cheaper or stronger model advice until it has one.

**Context:** The team performance build adds `tier` to Claude catalog entries and `knownPrice(model)`; a model without a tier gets no model advice. The remote catalog (`modelCatalog.ts`) must carry the field too. Owner decision D18.

**Effort:** S (human) / S (CC)
**Priority:** P2
**Depends on:** The team performance build

### A health readout for the Pulse telemetry (T9)

**What:** Add `telemetry:health` (last batch time, events per batch, failed writes, refused hook frames per member from `HookServer.rejectedFrames()`), one log line per processor batch, and a single warning when the processor stalls.

**Why:** When a Pulse number looks wrong there is no way to see whether points stopped flowing, writes failed or frames were refused; today nothing reads `rejectedFrames()`.

**Context:** Deferred from plan: docs/designs/team-performance.md (T9, E3), owner choice at /ship of mit/delete-team-member, 2026-10-16. The store already counts failed writes per day (D15); the processor runs every 30 s from `index.ts`.

**Effort:** S (human) / S (CC)
**Priority:** P1
**Depends on:** None

### Keep Pulse's heavy reads off the main thread

**What:** Read transcripts for the backfill line by line with a yield every few hundred lines, skip lines before the window before parsing tool results, and let the 30 s tick drain backfilled points instead of folding up to 100,000 at once; prune `telemetry_runs` with the events.

**Why:** On the first launch after an update the backfill and its fold can hold the main thread for seconds while every agent starts and sends hook frames; a very large office log or transcript is read whole into memory (Codex review).

**Context:** From the /ship performance review, 2026-10-16. Migration 4 added the indexes the hot reads needed; this is the remaining part. `pulseBackfill.ts` readTranscript and `pulseBackfillOnce` in `index.ts`.

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** None

### Pulse reads a card's whole history, not the period's slice

**What:** Keep card lifecycle state (reopened, held time) per card as events arrive, instead of rebuilding it from the period's events only.

**Why:** A card reopened or held before the period and finished in it counts as kept as is and as faster than it was.

**Context:** From the second Codex adversarial review, 2026-10-16. `telemetryProcessor.ts` cards().

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** None

### Pulse keeps a card finished just before a quit

**What:** Record card status changes where Michael's board write lands (or persist the last seen board) instead of only diffing the 8 s poll in memory.

**Why:** A card that reaches Done in the seconds before the app quits or crashes is taken as the new baseline on the next launch and never counted in Tasks done.

**Context:** From the Codex adversarial review, 2026-10-16. `telemetryStore.ts` tasks(): the first read of an office only remembers.

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** None

### Key Pulse by a stable office id, not its folder path

**What:** Store an office id in the office and key telemetry rows by it, or re-key rows when Settings moves the office; resolve the path with realpath meanwhile.

**Why:** Moving the office, or reaching it by another spelling (a symlink, a different case), splits Pulse history and runs the backfill again under the new key.

**Context:** From the /ship red team review, 2026-10-16. `pulseOffice()` in `index.ts` returns `expandTilde(harnessHome)`.

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** None

### Let only the main session release a prompt hold

**What:** Pass whether a hook frame is a subagent's to the worker wake watchdog, and let only the main session's events (or the denial of the prompted tool) end the hold; give the hold a long ceiling.

**Why:** A Task subagent's PostToolUse can end the hold while a permission prompt is still on screen, and a prompt escaped with no follow up event keeps the member from ever being nudged.

**Context:** From the /ship testing and red team reviews, 2026-10-16. The stuck restart now restarts a member on a permission prompt within seconds, which makes both cases rare. `workerWake.ts` MOVED_ON_EVENTS.

**Effort:** S (human) / S (CC)
**Priority:** P2
**Depends on:** None

### Hand the hook secret over where another process cannot read it

**What:** On engines and platforms where a sibling process can read another's environment (Linux /proc, Windows), pass the hook secret through a 0600 file or descriptor only that agent's sandbox can read, or check the peer on the socket.

**Why:** All agents run as the same OS user, and a sibling's environment is readable: on a Mac, `ps eww` showed a test HIVE_HOOK_SEAL of a node process (checked 2026-10-16). A member that reads a teammate's secret can send hook frames as them (Pulse numbers, a stuck restart), the forgery #61 closes.

**Context:** From the /ship security and Codex adversarial reviews, 2026-10-16; the owner chose to ship 0.2.2 with this named limit. Today the secret is in each agent's env (`hive.ts` HIVE_HOOK_SEAL), read by every bridge shim. A per member file outside the hive, with a sandbox read deny for every other member, or a socket peer check (LOCAL_PEERPID on macOS), would close it; Windows has no sandbox, so it stays weaker there.

**Effort:** M (human) / M (CC)
**Priority:** P1
**Depends on:** None

### Fill in Pulse's earlier checks off the main process

**What:** Run the one-time backfill of Pulse's questions and answers lists, and the parse of the 62 day list, off the main process (a worker, or rows in the telemetry database queried by time and way).

**Why:** The first open of the list scans every member's inbox and sent folders and then parses the whole checked.jsonl on the main process; a large office stalls the window and every timer for that time. The live file is now read without blocking, but the scan and the parse are not. Found by the Codex adversarial review (2026-10-17).

**Effort:** M
**Priority:** P3
**Depends on:** None

### Retry the backfill when it skipped files it could not read

**What:** Write the backfill's done mark only after a scan that read every file it meant to, and record how many it skipped, so a scan cut short by files being written or a slow volume runs again.

**Why:** ensureCheckedBackfill writes checked-backfill.json whatever it read, so a scan that met unreadable files never fills in their details. Links and pipes an agent left are skipped on purpose and must not count as a failure. Found by the Codex adversarial review (2026-10-17).

**Effort:** S
**Priority:** P4
**Depends on:** None

## Company foundations (deferred from the ship of mit/file-tab-no-bottom-bar, 2026-10-20)

### Name a missing foundation's proof in Early look and Recommendations

**What:** Once the kept as is evidence exists for a question, add a line to Early look and Recommendations such as "Answer who we sell to: Ryan's posts are kept as is 45% without it, 85% with", built from the same proof the member detail box shows.

**Why:** The strip in Recommendations names the jobs whose work hit an empty answer, but not what answering it would win; the proof today is only in a member's detail box, one click away.

**Context:** Deferred from plan: docs/designs/office-foundations.md (section 7, "Early look and Recommendations"), owner choice D2 at /ship, 2026-10-20. The proof is computed in `src/main/pulse.ts` foundations() and shown by `FoundationsBox` in `PulseView.tsx`; advice lines come from `src/shared/teamAdvice.ts`.

**Effort:** S (human) / S (CC)
**Priority:** P1
**Depends on:** None

### Read an edited document in again off the main thread

**What:** Move `kg-core` reindex (and the index rewrite it does) to a worker or child process, or keep the index in one file per document, so a save's work is bounded to the edited document.

**Why:** Every save of a document opened from Settings rewrites the whole `index.jsonl` synchronously on the main process; with a large store one save can stall routing and the window for a moment (Codex adversarial review).

**Context:** From the Codex adversarial pass at /ship, 2026-10-20 (owner choice D11). Saves now wait 3 s of quiet before a read in (`knowledgeEdits.ts`), and the index is replaced whole by rename (`kg-core.cjs` writeAtomic). A copy kept from a broken `foundations.json` (`foundations.json.broken-*` in the private folder) is not yet erased by a factory reset.

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** None

## Terminal links (from the ship review of mit/named-links, 2026-10-13)

### A quoted phrase that starts with a slash links as a path

**What:** Quoted prose that starts with a real folder still links as one path: "/tmp is full, see notes.md" underlines the whole phrase and ⌘-click finds nothing. PR 378 (2026-10-17) fixed the case with a space next to a slash ("/ see notes.md" now links only notes.md); a phrase like this one has no such space, so the pattern cannot tell it from a real file named with spaces.

**Why:** A link that leads nowhere reads as broken.

**Context:** `PATH_TOKEN_RE` (`quotedPathRe`) in `src/shared/terminalPaths.ts`. Fix: check a quoted match exists on disk before underlining it (the chip path already does), and fall back to the file name inside it when it does not.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Reset (deferred from the ship of mit/named-links, 2026-10-14)

### Clear what a reset could not remove on the next launch

**What:** Reset & start over retries each delete for about a second, then logs what is left. Save what still could not be removed and erase it early on the next launch, telling the owner if it still cannot go.

**Why:** The reset erases right after it stops the team without waiting for them to exit; a slow agent can write a file back, and on Windows a file still open can't be deleted, so a few leftovers can stay while setup looks fresh. A saved list of paths to delete at startup needs checks that it only names the app's own folders.

**Effort:** M
**Priority:** P3

## Attachments (from the Codex adversarial review of design/studio-v2, 2026-10-01)

### Keep each agent's mail pass out of other agents' reach

**What:** Move each agent's `md-mail.mcp.json` (it holds that agent's broker token) out of the shared hive folder, or block other agents from reading `<hive>/agents/<other>/md-mail.mcp.json`, and delete it when the agent's terminal closes.

**Why:** Sandboxed team agents cannot reach the broker, but Michael runs unsandboxed and could read a Can send agent's token and send from its mailbox. Found in the pre-landing security review (`src/main/index.ts`, the md-mail block before `ptyManager.spawn`).

**Effort:** S
**Priority:** P1

### Say "cannot check email" beside a schedule

**What:** When a schedule's agent has email off, show a short note on that schedule ("Pam cannot check email") in the On a schedule section and the office schedule.

**Why:** Plan CEO Section 4. A mail check schedule on an agent without email is silently ignored.

**Context:** Deferred from plan: docs/designs/multi-mailbox.md

**Effort:** S
**Priority:** P1

### Read one email without downloading its attachments

**What:** `MailService.read` fetches the whole message, attachments included, before trimming the text to 50K. Fetch the body structure plus the text part only, and take attachment names and sizes from the structure.

**Why:** A 25 MB message is held in memory in the main process for one read.

**Effort:** M
**Priority:** P2

## Message times and upkeep (deferred from the ship review of mit/file-tab-no-bottom-bar, 2026-10-18)

### Read a reply's time from the app's record, not the agent's file

**What:** The dock and Michael's open questions read Michael's replies back from his outbox and its .sent folder, with the time he wrote. Use the time the app routed it instead: keep it in an app private record (or stamp the .sent copy even when it can't be rewritten in place), and never let a time earlier than the question it answers count as an answer.

**Why:** The router now keeps an agent's time no later than now, but the files it reads back are Michael's own, and a past time (a timezone slip) can sort a reply before your question or leave a done question open.

**Effort:** S
**Priority:** P2

### Compare To do reminder times by the instant

**What:** `dueReminders` and `guardCards` in `src/shared/cardGuards.ts` compare `nextAt` as text. Compare by `Date.parse`, as `waitingChecks` now does.

**Why:** Rewriting a past due time in another spelling (Z or +00:00) sends the Next step due reminder again and resets Michael's backstop.

**Effort:** S
**Priority:** P3

### Keep a schedule decision for Pete while he isn't reporting

**What:** A schedule decision for Research while it isn't reporting is now dropped quietly with the other upkeep. Keep it (without Michael) and deliver it, with its upkeep kind, once Research reports again.

**Why:** A decline carries Michael's or the owner's reason; dropped, Research may ask for the same change again.

**Effort:** S
**Priority:** P3

### Retry closing time's wait after all note to Michael

**What:** When a member reports again mid close, its brief goes out once, but a failed note telling Michael to wait for its ACK is not tried again. Keep a note owed set retried on the next row update.

**Why:** Michael may close without the member's ACK.

**Effort:** S
**Priority:** P3

## Michael reply readability (deferred from the eng review, 2026-10-17)

### Check the figures in Michael's answer against the team's report

**What:** In code, check that every amount in Michael's answer to the owner matches, by label and value, an amount in the team report it drew on; a mismatch goes back to Michael, never the owner.

**Why:** Michael now copies figures exactly by rule (hive.ts owner answer rule), but a retyped or rounded figure still reaches the owner unseen. Research on multi agent systems found the lead agent's rewrite of worker output is where most errors come from, and models are weak at checking numbers themselves.

**Pros:** A wrong figure is caught before the owner reads it.

**Cons:** Needs a link from an answer to the reports it used, which the hive does not record today; a check that matches any recent number would flag dates, counts and Michael's own totals.

**Context:** Owner D9 A in the readability eng review (decision 383ee82c). Start by recording, on Michael's answer, the ids of the team messages it used. The marker gstack-shortcut(dec-383ee82c) sits at routeMessage's toOwner branch in `src/main/hive.ts`.

**Effort:** M
**Priority:** P2
**Depends on:** linking an answer to its source reports

### An eval for agent prompt changes

**What:** A small eval that runs Michael (and one team member) on a few fixed questions, such as a figures question and a compare two options question, and checks the reply's shape in code: answer first, a list or small table, figures copied exactly, currency present, no dashes.

**Why:** Prompt changes ship with source pins only, which prove the text is in the app, not that agents follow it; the owner is the first to see a regression.

**Pros:** Catches a prompt regression before an office sees it; makes later wording changes safe.

**Cons:** Model calls per run; answers vary, so checks must be about shape, not exact text.

**Context:** Owner D12 A in the readability eng review, 2026-10-17. Prompt rules: `src/main/hive.ts` (owner answer rule, team report rule), `src/shared/ownerRequests.ts` ownerQuestionsContext. Start with a script under tools/ that runs claude -p with the built prompt and checks the reply with plain code.

**Effort:** M
**Priority:** P2
**Depends on:** None

## Mail approvals and Michael replies (deferred from ship of feat/mail-approvals-michael-replies, 2026-10-07)

### Rebuild Michael's owner requests from open items only

**What:** Bound the 8 second rebuild of Michael's owner requests to messages newer than the oldest open item, and keep message bodies out of the never evicted cache.

**Why:** Since the fixed floor replaced the 30 day window, the work and the cached bodies grow with all conversation history.

**Context:** Deferred by the owner (ship D5). `src/main/hive.ts` `refreshOwnerRequests` and `ownerMessages`.

**Effort:** M
**Priority:** P2
**Depends on:** None

## Update notices (deferred from ship of feat/claude-code-update-notice, 2026-09-30)

## Secret store (deferred from ship of fix/atomic-secret-store, 2026-09-30)

## QuickBooks through the Claude account (deferred from ship of feat/qbo-claude-channel, 2026-09-30)

### Stop a nested Claude from reaching the account's connectors

**What:** Keep agents from starting their own `claude` (for example `claude -p`) outside the app's hooks, or turn off the Claude account's connectors for such runs.

**Update 2026-10-02 (docs/designs/claude-connectors.md):** once that plan ships, an agent with no connector grants starts with `ENABLE_CLAUDEAI_MCP_SERVERS=false`, which a nested `claude` inherits, so this is closed for them. It stays open for agents with at least one grant (explicit or the QuickBooks role default): a nested `claude` loads every connector with no deny rules. Options: a separate Claude config folder per agent, or blocking `claude` in agent shells.

**Update 2026-10-14 (#325):** a `claude` started from an agent's bash shell now gets `ENABLE_CLAUDEAI_MCP_SERVERS=false` through `CLAUDE_ENV_FILE`, so the everyday case is closed on Mac, Linux and Git Bash. Still open: PowerShell agents on Windows, and an agent that unsets the variable on purpose; the hard guarantee is a separate Claude config folder per agent.

**Why:** The QuickBooks switch and Capabilities are enforced by the app's PreToolUse hook, which reaches an agent only through `--settings` (`src/main/hive.ts`). A nested Claude started from Bash has no hook but inherits the account's QuickBooks (and email), so the switch off is not a hard guarantee. Stated in CHANGELOG 0.0.11.

**Effort:** M
**Priority:** P1

### Base the QuickBooks default on the role, not the agent id

**What:** Give hired agents with a books role the on + Read only default.

**Why:** Only an agent whose id is literally `oscar` gets it (`booksReadRoleIds` in `src/main/index.ts`); a bookkeeper hired later starts off.

**Effort:** S
**Priority:** P3

### Show a locally added QuickBooks server in the status

**What:** Read non-`claude.ai` QuickBooks servers from `claude mcp list` too.

**Why:** A QuickBooks server added with `claude mcp add` is gated but Settings says it is not connected.

**Effort:** S
**Priority:** P3

## Closing time (deferred from ship of feat/closing-time-progress, 2026-09-29)

### Rows in a second window

**What:** Give the closing-time rows names and detail in every window, not only the one that saw the hook events.

**Why:** Detail lives in the renderer store of the window that received `hive:hookEvent`; another window shows names but no detail.

**Effort:** S
**Priority:** P3

### Parallel tool calls clear each other's detail

**What:** Track detail per tool call so one call's PostToolUse does not clear another's.

**Why:** With parallel calls, the row goes blank while a call is still running.

**Effort:** S
**Priority:** P3

### Replace the source-regex dialog tests with pure helpers

**What:** Move the checks in `test/closing-time-dialog.test.cjs` that grep component source into tested helpers.

**Why:** They break on harmless edits (comments, added props) and passed review cycles several times only after loosening.

**Effort:** M
**Priority:** P3

### Archiving a live agent during closing time

**What:** Archiving through voice or `hive:setArchived` drops the agent from the wait list but does not call `closingTime.refresh` or tell Michael.

**Why:** Michael can keep waiting for an ACK that never comes until the 6-minute timeout.

**Effort:** S
**Priority:** P3

### Mark the detail line as the agent's own words

**What:** The detail is agent-written text shown where the owner decides to close without someone.

**Why:** An agent can write "safe to close without me"; the owner's choice is steered by untrusted text.

**Effort:** S
**Priority:** P3

## Task board (deferred from ship of mit/local-app-version-stuck-ee4e87, 2026-10-12)

### A triage filing the app creates itself, so none is ever overwritten

**What:** Team members send a filing as an outbox message to "triage", and the router creates the file in `triage/` with an exclusive create, instead of each agent writing there itself.

**Why:** The write guard refuses an edit, another agent's name and a file that already exists (`src/main/harnessGuard.ts`, `isPlumbing`), but the check runs before the write, so two writes of the very same filing name at the same instant could still lose the first. Codex adversarial pass 2 found it; the owner accepted the risk for this release (ship D11), since agents do not write the same name twice at once.

**Context:** The router already moves every outbox file (`HiveManager.routeOnce`); open the new file with `wx` there and archive the outbox copy, as messages do. Then the triage folder can be the app's alone in the write guard.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Schedules

### Michael turns repeated work into a routine (issue #41)

**What:** When the same kind of work keeps getting done (for example chasing overdue invoices three weeks running), Michael sets it up as a scheduled job for the team member who does it, with its how in that member's Work style.

**Why:** Owners rarely notice which work repeats, so it stays manual. Starter jobs only cover what a business type usually needs, not how this office actually works.

**Context:** The app works out the repeats and Michael decides, so the duty never lives only in his prompt (card-lifecycle rule): group done cards that look like the same job (title, assignee, what was done) and keep each group in front of Michael until he acts or passes. Approval follows the office management rule (owner, 2026-10-10, issue #41): Michael sets up routine jobs himself through the schedule path and adds the how to the Work style; a job that touches money, customers, legal or security goes to Ask me first with the proposed job filled in. Nothing starts without one of those two.

**Effort:** M
**Priority:** P3
**Depends on:** nothing.

## Agents and 1:1

### Show the rewritten instructions before saving a work style

**What:** When the owner edits a plain work style (hire or Edit Agent), show the instructions the app wrote from it and let them accept or undo, instead of saving straight away.

**Why:** The owner edits a summary; details the summary left out could still be lost in a rewrite. The prompt now keeps them, but the owner can't see the result.

**Context:** From the /ship pre-landing review of feat/hire-wizard (2026-09-27). `src/main/workStyleConvert.ts`, `toInstructionsPrompt` in `src/shared/workStyleText.ts`, AddAgentModal and EditAgentModal save paths.

**Effort:** S
**Priority:** P2
**Depends on:** nothing.

### End a hidden Claude call early when it can't answer

**What:** A hidden call whose session is stuck on a trust or sign-in screen now waits for its full timeout (60 to 180 seconds). Detect a known blocking screen, or no transcript at all, and give up early so the rules fallback answers quickly.

**Why:** The owner waits on "checking..." for a minute when Claude is signed out.

**Context:** From the /ship pre-landing review (2026-09-27): `captureAndFinish` in `src/main/hiddenClaude.ts` re-arms until its own answer appears.

**Effort:** S
**Priority:** P3
**Depends on:** nothing.

### Test Michael deciding schedule requests end to end

**What:** Runtime tests for `receiveScheduleRequest`, `michaelDecides`, `decideScheduleRequest` and `sweepScheduleRequests` in `src/main/index.ts` (unknown id, stale, escalated, pending list, the 12 hour escalation), which today are checked by source patterns only.

**Why:** These decide whether a request reaches Michael or the owner at all.

**Context:** From the /ship coverage audit (2026-09-27). Needs the functions moved into a module that tests can load with fake config and hive.

**Effort:** M
**Priority:** P2
**Depends on:** nothing.

### Hire through Michael

**What:** The owner tells Michael "hire another admin for catering" and Michael asks the app to open the hire wizard on Review, prefilled with a job he adjusted. The owner still presses Hire; Michael can never hire on his own.

**Why:** The owner runs the office by talking to Michael, so hiring from chat fits how the app is used.

**Context:** Deferred in /plan-ceo-review of the hire wizard redesign (2026-09-27, D5.5) because it needs the wizard first (`docs/designs/hire-redesign.md`). To build: a Michael to app message (an MCP tool, since sandboxed Bash cannot reach the app), a prefill path into the Review step that runs the same distinct job check, and a guard that no agent message can press Hire.

**Effort:** L
**Priority:** P2
**Depends on:** the hire wizard redesign.


### One rule for "stuck at a prompt" in main and the panel

**What:** Put the terminal prompt check (`isTerminalPrompt` in `src/main/hooks.ts`) in shared code
and use it in the renderer's status parsing (`src/renderer/src/hooks/useHive.ts`), passing
`notification_type` through the hook event.

**Why:** Michael is told an agent is stuck from the prompt's type; the panel decides from words
in the message. For a dialog without those words, Michael hears "stuck" while the panel shows the
agent idle, with no coral bar and Talk 1:1 not leading. Found by the red team in the pre-landing
review of feat/per-agent-schedules (2026-09-25); the owner chose a follow-up.

**Priority:** P2
**Completed:** `isTerminalPrompt` moved to `src/shared/hookEvents.ts` and consumed in `useHive.ts`'s Notification hook handler alongside `notificationType`.

### Block mouse and focus reports in a watch-only terminal

**What:** While a team member's terminal is locked (outside 1:1), drop mouse report and focus
report sequences in `term.onData` (`src/renderer/src/components/terminalPool.ts`), letting the
terminal's own query replies through.

**Why:** The lock covers keys, paste, drop and composition. If the agent's program turns on mouse
tracking, a click in the watch-only terminal still reaches it. Low confidence in the pre-landing
review (2026-09-25); needs a check with a mouse-aware prompt.

**Priority:** P3

## Business mode (deferred from plan, v0.0.1 ship)

Deferred from plan: `docs/designs/business-mode-office-packs.md` (owner chose "ship, defer as P1 TODOs" on 2026-09-24).

### Enforcement compiler and the default-deny hook

**What:** Compile each agent's levels into real permissions: `dontAsk`, compiled allow/deny rules, a default-deny PreToolUse hook (Decision 4, tests T2/T3).

**Why:** Today only the prompt layer (`teamMemberGoal`) limits agents, `bypassPermissions` is still the default, and the hook fails open. "Asks before sending" is instructed, not enforced.

**Context:** `src/shared/agentDefinition.ts` already carries levels and outward capabilities; `src/main/harnessGuard.ts` shows the PreToolUse pattern. Start by compiling one agent's levels into its per-session settings.

**Effort:** L
**Priority:** P1
**Depends on:** None

### Approvals inbox (with the two-zone panel and draft-to-post flow)

**What:** Approval action payloads, an executor, and the approvals UI (Decisions 31 and Ryan's "copy to clipboard and mark posted").

**Why:** Outward actions (emails, posts, spending) need a place for the owner to say yes; Ask me covers questions only.

**Context:** Ask me is the first tab on Michael's panel now; approvals likely sit beside it.

**Effort:** XL
**Priority:** P1
**Depends on:** Enforcement compiler

### Office schedule (officeHours)

**What:** Honour each pack's `officeHours`: soft pause outside hours, office state, wired to `weeklySchedule`.

**Why:** Validated in the pack schema but never used, so the office runs around the clock regardless.

**Context:** `src/shared/officePack.ts` (officeWindow), `src/shared/weeklySchedule.ts`.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Attention strip and owner floor layout (Decisions 25, 27)

**What:** The minimal attention strip, plain-language agent cards, approvals in the right panel.

**Why:** Owners need one place that says what needs them now.

**Context:** The floor now has OFFICE, TASKS and GRAPH views and a blocked-count badge; the strip is the next layer.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Close dialog and tray (Decisions 1, 39)

**What:** A close dialog with a safe default and keyboard contract, and a tray so the office keeps running.

**Why:** Closing the window ends the day for the whole office; there is no way to keep it running in the background.

**Context:** Since the Studio redesign, closing the main window with terminals running starts closing time on the floor (`ClosingTimeBar`, via `app:closeRequested` in `src/main/index.ts`), the same as quitting. What is left is the tray, and a choice between closing the window and quitting.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Per-agent levels screen (Decision 33)

**What:** A screen per agent in the order job, limits, connect.

**Why:** Autonomy is one global checkbox; owners cannot give Oscar less freedom than Pam.

**Context:** Pairs with the enforcement compiler.

**Effort:** L
**Priority:** P1
**Depends on:** Enforcement compiler

### First-success confirmation and morning report (Decision 32)

**What:** Confirm the first finished job to the owner, and a morning summary, plus a weekly digest for owners who open the app once a week (issue #81): emails handled and drafted, tasks closed by each team member, scheduled jobs run, and what still waits on the owner.

**Why:** New owners need proof the office works while they were away.

**Context:** Packs declare `firstAction` (Decision 29), used only in agent goals today. Every count comes from what the app recorded (the task ledger, the mail send records, the schedule runs), never from Michael's memory, and a week with nothing in it says so plainly. Deliver it the way reports already work: Michael posts it on Ask me as a report (`kind: "report"`), from a schedule the owner can see and change in Schedules. No estimated time saved: the owner declined it (2026-10-10, #81), because minutes per task set by the owner would end up wrong for everyone.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Owner floor narrow layout (Decision 38)

**What:** A layout for narrow windows.

**Why:** The floor and side panel crowd each other on small laptop screens.

**Context:** `src/renderer/src/App.tsx` floor area and SidebarSplitter.

**Effort:** M
**Priority:** P1
**Depends on:** None

### 14px text floor on the remaining setup screens (Decision 36)

**What:** Raise the last setup text under 14px to 14px or more.

**Why:** The owner's standing rule. The Business and Team steps (with TeamCard and PackTile) were raised in PR #138.

**Context:** Still under 14px: the company profile labels in `src/renderer/src/components/CompanyProfileFields.tsx` (shared with other screens; the PR #138 author offered to do these), and the Welcome and Permissions steps in `src/renderer/src/components/OnboardingWizard.tsx` (12 and 13px titles and notes).

**Effort:** S
**Priority:** P1
**Depends on:** None

## Documents and security (review items skipped for v0.0.1)

### Gate web tools for members on other engines (issue #230 follow-up)

**What:** Members that run on Codex, OpenCode, Crush or another bridged engine keep their own web tools and shell network; the Research rule (only Research uses the internet) reaches Claude members only.

**Why:** An owner who puts a member on another engine may believe that member is fenced in like the rest of the office.

**Context:** Ship review 2026-10-13, decision D4: Settings, Research & privacy, names those members with an info icon. Fix per engine: map each bridged provider's web tool names into the hook's gate where its bridge posts PreToolUse, and give its shell a network rule where its sandbox allows one; otherwise refuse web for that engine.

**Effort:** M
**Priority:** P1
**Depends on:** nothing.

### Research agent and data privacy guard (issue #230)

**What:** No agent reaches the internet except an optional Research agent (off by default, turned on in Settings). Members ask Research through the hive; a guard checks every message to Research against the owner's data classes (patterns plus a quick no-tools AI check, fails closed) and returns refused ones to the sender only. A Data privacy page in Settings lists the classes, seeded with safe classes Allowed and sensitive ones Private.

**Why:** Owners want research to stay possible without any agent that holds private data (HubSpot, mailboxes, finance, the board) sending it to the web.

**Context:** Design and eng review in `docs/designs/research-agent-privacy.md` (owner direction and decisions D1 to D7, 2026-10-13). Research is walled off from the hive, business folder, palace and company knowledge (sandbox deny rules), excluded from broadcasts; other members cannot write its inbox, and the app sweeps any message it did not deliver; its replies are screened as outside text. Known limit: on Windows (no sandbox, #187) Research can be turned on with a warning, but its shell is not confined there. Michael's shell reaches no host in any office (D9.1, every office since ship 2 D16). Replaces the per member Sites code applied uncommitted on mit/named-links (keep the hook gate, `sandbox.network` plumbing and restart reason; remove the Sites group). Upgrade impact: every office loses web research until the owner turns Research on.

**Status (2026-10-13):** built on mit/named-links; at /ship the refuse only guard became a two way trust layer (pass, clean or deny in; clean and flag out), see the design doc's "Trust layer" section and its review pass 2 decisions (D6.1 to D6.7). Live sandbox checks on a Mac passed: Research cannot read `tasks.json`, the home folder, other sessions' temp output or teammates' moved session files; a member cannot read or write Research's folders. Left: Windows (no sandbox, #187) and members on other engines (P1 above); Research on engines other than Claude is refused until they have equal walls. Named Pete by default; the owner may rename it in Edit agent, the name is kept in the app settings (`research.name`) and nobody else may take it (ship 2 D17); the second ship's three review passes made every file tool call judged on its real path (trimmed and resolved, kept when a big call is cut), walled each agent's session scratch folder from the others, and made a path from agent text only ever shown in Finder (D12).

**Effort:** L
**Priority:** P1
**Depends on:** nothing.

## Engines

### Run Gemini members in Gemini's own sandbox

**What:** Start Gemini team members with Gemini's own sandbox (`-s`) where it works, so a Gemini member has a guard besides its reports to the app.

**Why:** The app starts Gemini with `--yolo` and no sandbox (`src/shared/agentProvider.ts`), so a Gemini member whose reports stop has no guard at all. The #326 design therefore stops a silent Gemini member on every platform; with a sandbox it could keep working the way a Claude member on a Mac does.

**Pros:** Gemini offices stop far less often; parity with Claude and Codex on a Mac.

**Cons:** Gemini's sandbox needs Docker or Podman on some platforms, may block tools the team uses, and needs its own writable folder setup (like Codex `--add-dir`).

**Context:** From the #326 eng review, 2026-10-16 (decision R2). Start in `hive.ts` where Gemini's `--include-directories` are added, and check what `-s` needs on each platform.

**Effort:** M
**Priority:** P2
**Depends on:** none; independent of #326.

### Make a second engine (Codex first) ready for an office

**What:** Close the gaps that keep engines other than Claude Code out of `BUILD_ENGINES`, starting with Codex, then add it to the list.

**Why:** An audit on 2026-09-24 found that the code for Codex, Gemini CLI and Antigravity exists, but none is ready for an office without Claude. Only Codex has live history (hooks, idle, messaging and resume were debugged on real workers). Every picker and voice hiring now offer only `BUILD_ENGINES`, so nothing half-working can be chosen until this is done.

**Context:** In order of impact:
1. ~~The team always starts on the default engine.~~ Done 2026-09-26: setup now writes `defaultCommand` from Michael's engine (`teamDefaultsFromMichael`, `test/team-engine-from-michael.test.cjs`).
2. Cost and token data: Codex is done. The telemetry fallback reads a Codex agent's rollout in its CODEX_HOME (`src/main/codexUsage.ts`, `hive.codexHome`), and `src/main/pricing.ts` prices GPT-5 models. Still open: Gemini and the other engines (no usage source yet), and the lifetime cost ledger, which only records live OTel samples. For Gemini, issue #113 has the plan: read the session `.jsonl` at the hook payload's `transcript_path` (already kept as `hookServer.transcriptPath(id)`), skip `$set` and `$rewindTo` lines, keep the last copy of each message id (late token updates re-append it), keep rewound turns (they were billed), map `cacheRead = cached`, `input = input - cached + tool`, `output = output + thoughts`; fall back to the project slug in `~/.gemini/projects.json` when no hook has fired; add Gemini Pro and Flash rows to `pricing.ts`; prove it live with one Gemini worker under a low token cap.
3. MCP servers go only into Claude's `--settings` (`src/main/hive.ts:1163`). Codex now gets bundled skills in its private `CODEX_HOME/skills`; other engines still need native skill discovery. The md-mail server is the same gap (issue #109): `index.ts` writes it and passes `--mcp-config` only for Claude, so a Codex member with email starts with no mail tools. Fix: write an `[mcp_servers.md-mail]` entry in the agent's private `CODEX_HOME/config.toml` (same command, args and env, a fresh broker token each spawn), removed at teardown like the Claude file. The mail gate in `hooks.ts` matches only Claude's `mcp__md-mail__` tool names, so the same change makes it match Codex's names too: a mail tool on any engine passes the same check, and a test proves a Codex mail call is gated.
4. Antigravity gets no extra writable directories, so hive file writes may be refused. Gemini CLI done 2026-10-11: the folders Codex gets with `--add-dir` go into its per-agent settings file as `context.includeDirectories` and onto argv as `--include-directories` (Gemini CLI 0.60 and later skip a system settings file in a folder the user owns; `geminiIncludeDirArg`, `test/auto-mode-sandbox.test.cjs`).
5. Antigravity agents never get their standing goal, and an Antigravity Michael never gets the roster (no SessionStart/UserPromptSubmit event).
6. ~~The app's own background calls run only on Claude (issue #85).~~ Done 2026-10-17 (PR 354): `runHiddenModel` in `src/main/hiddenModel.ts` picks the runner from Michael's engine for all six (memory tidy up, the standing approval check, the hire check and the three Work style helpers). Claude keeps its runner and models; Codex runs `codex exec` read only in an empty folder with every tool off and the prompt on stdin, using Michael's model or the CLI default; any other engine answers unavailable and the caller keeps its fallback (`test/hidden-model.test.cjs`, `test/hidden-model-callers.test.cjs`). Still open: a runner for Gemini.
7. Michael's first prompt is still written for one engine (`INITIAL_GOD_PROMPT` in `src/renderer/src/hooks/useHive.ts:77`). The spawn prompt and PROTOCOL.md now say "AI agents".
8. No permission-prompt detection for these engines (no Notification event), which matters only with auto mode off.
9. The access policy reaches Claude only (issue #48). Folder privacy (`denyRead`/`denyWrite`), connector deny and the MCP list are written into Claude's `--settings` (`hookSettings` in `src/main/hive.ts`); Codex gets its own workspace sandbox and `--add-dir`, but no folder read privacy or connector deny. Before any engine joins `BUILD_ENGINES`: build the one policy into each engine's own settings, record per engine which rules it can enforce, and where it can't, limit that agent (mail Draft only, connectors off) with the reason on its Access tab. A test per engine tries a read of another member's folder, a write outside its own and a denied connector, and passes only when each is blocked or the agent is limited. `test/engine-readiness.test.cjs` checks the preset half today. Issue #139 adds: make it a typed `isolation` capability on each engine preset (OS sandbox plus deny rules, a PreToolUse check only, or none), so `BUILD_ENGINES` refuses an engine that has not proved its kind, and an engine with none never hosts a member who holds a private folder; put the app's private mail token folder (`agentPrivatePaths.ts`, #63) in every engine's denied set; and note the hook gaps: pi has only PreToolUse, and the proxy tier (qwen) has no hooks at all, so its shell is unguarded.
10. Hook events carry a per start secret (issue #61, built with the team performance work): a new engine's bridge must send `HIVE_HOOK_SEAL` in every frame (never a name like a token or key: Claude Code's subprocess scrub strips those) and pass the forged frame checks in `test/hook-auth.test.cjs` before it joins `BUILD_ENGINES`.
11. No test of a run on each engine (issue #83). With a fake CLI process standing in for the engine (no paid calls), one shared test per engine checks: it starts and finishes a task, reports completion, and handles a sign-in failure, a plan or quota limit, a cancel and its cleanup, each with a plain reason to the owner. It runs in CI on every platform the engine ships for, beside `test/office-privacy-conformance.test.cjs` and `test/engine-readiness.test.cjs`.

A live end-to-end run is required before adding an engine: Gemini has never been run for real, and Codex needs an OpenAI account with credits.

**Effort:** L
**Priority:** P3
**Depends on:** A decision to offer a second engine.

### A backup engine through a plan limit (issue #129)

**What:** An optional backup engine per team member, set by the owner (default none). When the office break starts (issue #124), a member with a backup restarts on it with a handoff note as its first message (its task, recent context, files touched) and keeps the same folder, memory and mailbox. At the reset it goes back to its own engine at its next idle point. The floor shows it ("Pam is on Codex until 3:40 PM"); members without a backup keep the break.

**Why:** On a Pro plan the break can last hours of a business day. An owner who also has a ChatGPT plan could keep work moving.

**Context:** The trigger is the office break (`src/main/officeBreak.ts`); the handoff can reuse `hive.takeHandoff`. Two facts shape the design. The usage limit is per Claude account, so every Claude member, Michael included, reaches it at once: there is no member with headroom left, and failover has to cover Michael (a Codex Michael needs gaps 5 and 7 of the second engine item), or the moved members work with nobody to report to until the reset. The backup is the owner's own choice per member, never picked by the app (the model choice rule). Behind a `buildFeatures.ts` flag until it has run live.

**Effort:** M
**Priority:** P3
**Depends on:** Make a second engine (Codex first) ready for an office, in full: the access policy (#48) and hook authentication (#61) above all, so a member that fails over keeps the owner's folder and connector limits.

## Onboarding

## Release

### Sign and notarize the Mac build with an Apple Developer ID

**What:** Add the Developer ID Application cert and notarization credentials as repo secrets (`APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). `release.yml` and `build/notarize.cjs` already use them when present.

**Why:** 0.0.1 ships ad-hoc signed. Owners must clear a "could not verify" dialog through Privacy & Security on first open, and Squirrel.Mac cannot update an ad-hoc app in place, so every update falls back to "download the new version" instead of restart to install. macOS also forgets folder grants between versions without a stable signature.

**Context:** Needs an Apple Developer Program membership (paid, per organization). Once the secrets exist, the ad-hoc fallback in `release.yml` switches off by itself; update RELEASE.md's install steps then.

**Effort:** S (after the Apple account exists)
**Priority:** P1
**Depends on:** Apple Developer Program membership

## Repo

### Remove or rewrite the old project's website files in docs/

**What:** What is left of the old project's website: `docs/blog/` with its source in `blog/`, `docs/sitemap.xml`, `.github/workflows/blog.yml`, and the upstream promo media that was in `docs/media/` (removed on 2026-10-01 with the v2 redesign). (The site pages, `docs/CNAME`, `robots.txt`, the Google verification file, the research, drops, hires gallery, evidence and deck were removed on 2026-09-28. `docs/llms.txt` and `docs/llms-full.txt` went in the 0.0.1 land: GitHub Pages is off for this repo, so nothing served them.)

**Why:** They describe the other product.

**Context:** The website for this app lives in its own repo; keep only files the app reads at runtime (`docs/model-catalog.json`, `docs/hero.json`).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Record demo videos of Don't Be Michael

**What:** New demo videos of this app: a short hero clip for the top of the README, and an agents-at-work clip with a poster image for the README's "Watch the office work" section, which now shows a still.

**Why:** The README shows stills only. The old project's recordings (`docs/media/hero.mp4`, `docs/media/demo/agents.mp4`) were removed on 2026-10-01 with the v2 redesign, since they showed the Munder Difflin pixel UI.

**Context:** The studio lab (`npm run lab`, `docs/demo/studio-lab.html?clean&autoplay`) plays the office on a neutral example office and is made for recording. Keep files small (under 5 MB), commit an mp4 plus a jpg poster under `docs/media/`, and point the README at them. Delete whatever of `landing-remotion/` is no longer used. The website repo may want the same clips.

**Effort:** S
**Priority:** P2
**Depends on:** None

## Completed

### A write to a connected app is never sent twice (issue #54)

**What:** The send once rule mail already has, for writes the broker forwards to a connected app (anything other than GET or HEAD): an identical write is recorded before it goes upstream and answered from that record if it comes again, across a restart too.

**Why:** The broker forwards a write with no dedupe behind a 30 second timeout (`src/main/integrationBroker.ts`, `UPSTREAM_TIMEOUT_MS`). If the provider accepts it but the answer is lost, or the app stops before it comes back, the agent's retry creates a second invoice, booking or contact. Plain mail sends got this in PR #126; connected app writes did not.

**Context:** Reuse PR #126's pattern inside the broker, not a new store: an app private journal like `mail-send-journal.json`, keyed on the agent, integration, method, path and a hash of the body, written as pending before the upstream call and settled after. Pass the key upstream where the provider takes one (an `Idempotency-Key` header, QuickBooks `requestid`). A write left pending after a stop that the app cannot check is refused with a plain reason telling the agent to tell Michael, as PR #126 does for mail; the app never makes or moves a card for it (Michael owns every card). Issue #54 also proposed a per task work record for engine hand off and proof of done; those stay with "Make a second engine (Codex first) ready for an office", #36, #48 and #51.

**Effort:** M
**Priority:** P2
**Depends on:** None
**Completed:** Connected app writes are recorded in `broker-write-journal.json` before they go upstream (`src/main/brokerWriteOnce.ts`). A repeat of a write that worked gets the first answer; a failed one may go again with the same key. A write still pending after a restart is refused, and the agent is told to tell Michael. No card is opened. QuickBooks also gets a stable `requestid`. A damaged journal is set aside and a fresh one started (PR #212).

### Message when the OS cannot encrypt stored credentials

**What:** A plain-language path for when Electron's `safeStorage` reports encryption unavailable, so connecting an account fails visibly instead of silently.

**Why:** The secret store refuses to write without OS encryption — "a secret is never written unless `safeStorage.isEncryptionAvailable()`" (`src/main/integrations.ts:12`, enforced at `:111`). That is the correct security behavior, but no screen explains it. On Linux without a keyring, or a Mac with a damaged keychain, the owner clicks Connect and nothing happens.

**Effort:** S
**Priority:** P2
**Completed:** merged 2026-10-17. Mailboxes (PR #136), connected apps (agentvivekkumar/dontbemichael#211, by DavidFHCh) and saved AI keys (agentvivekkumar/dontbemichael#384, by fayzan-cbr) each check the secret store first and say what to do on each platform.

### Read the registry once per router tick

**What:** In `routeOnce`, read the registry and Pete's name once per tick, not once per outbox file.

**Why:** Each outbox file asks `addressedToResearch` with a fresh `registry()` read, so a busy tick reads registry.json once per message (performance review, third ship).

**Effort:** S
**Priority:** P3
**Completed:** merged 2026-10-17. `routeOnce` reads the registry and Research's name once per tick, the first time a message needs them; delivery still reads per message (agentvivekkumar/dontbemichael#385, by amartya1523).

### End a credit or sign in stop only on a finished turn

**What:** When the office stopped because the Claude account ran out of credit or its sign in stopped working, end the stop when a turn finishes, never because a check heard nothing for ten minutes.

**Why:** After a restart, or with no Claude session alive to take Michael's check, silence ends the stop (`CHECK_TIMEOUT_MS` in `src/main/officeBreak.ts`) and the team is given work on an account that still cannot run it, then stops again.

**Effort:** S
**Priority:** P3
**Completed:** merged 2026-10-17. A credit or sign in check that hears nothing goes back to waiting and checks again after RETRY_MS; only a finished turn ends the stop. The plan limit keeps its old ending and a key stop still waits for the owner (agentvivekkumar/dontbemichael#383, by amartya1523).

### Copy a link's address from a card

**What:** A right-click "Copy link address" on links in the app's rendered markdown.

**Why:** Named links (docs/designs/named-links.md) show "HubSpot" instead of the raw URL, so selecting the text copies the name, not the address. The app has no context menu (`src/main/index.ts` sets `setWindowOpenHandler` and `will-navigate` handlers, no `context-menu`), so an owner who forwards a record link has to open it and copy it from the browser.

**Effort:** S
**Priority:** P3
**Completed:** merged 2026-10-17. Right-clicking a web or email link anywhere in the app shows one item, Copy link address, which copies the real address; the label follows the app language (`src/shared/linkMenu.ts`, agentvivekkumar/dontbemichael#372, by Yash-Nimkar0, closes #370).

### A refused tool call still shows its detail

**What:** PreToolUse that the hook denies (paused or gated) still sends `detail`.

**Why:** The row names a step that never ran.

**Effort:** S
**Priority:** P3
**Completed:** merged 2026-10-13. A refused PreToolUse call omits detail via `emitRefused()` so the row stays clear (agentvivekkumar/dontbemichael#261, by AnonymousSurya).

### Log the webhook format editor's parse error

**What:** `console.error` the raw JSON parse message in `src/renderer/src/components/triggers/WebhookSchemaEditor.tsx`, and make `error` a boolean.

**Why:** The owner now sees plain words, but nobody can see where the mistake was.

**Context:** Third review pass, 2026-09-24.

**Effort:** S
**Priority:** P2
**Depends on:** None
**Completed:** merged 2026-10-12, ships in 0.1.9. A failed save logs the parser's message once with `console.error`, `error` is a yes or no flag, and the owner sees the same words; the check is the pure `schemaParseError` helper with its own test (agentvivekkumar/dontbemichael#141, by piyush12kunjilwar, closes #131).

### Cap the total size of an Office file's zip entries

**What:** In `src/main/docText.ts` (unzip filter, ~line 108) cap total uncompressed bytes and entry count, not only each entry.

**Why:** A crafted .docx/.xlsx/.pptx can declare many large entries and exhaust memory in the main process, taking every agent down. Owner skipped this at ship review 2026-09-24.

**Context:** Count accepted entries and sum `originalSize` in the filter; reject past e.g. 200 MB / 5,000 entries.

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** 0.1.7 (2026-10-09). Before inflating anything, `fromOoxml` adds up the declared sizes of the XML parts it would read and refuses the file past 200 MB or 5,000 parts; media still never counts (agentvivekkumar/dontbemichael#58).

### Decide the Git for Windows check

**What:** On the clean PC, install Claude Code and start one session. If it needs Git Bash, add a Git for Windows check to onboarding (E3).

**Why:** If Git Bash is missing, a Windows beta user would get stuck at their first agent start.

**Context:** E3 in `docs/designs/windows-11-installer.md` depends on that smoke test, which has not run yet.

**Effort:** human S / CC S
**Priority:** P1
**Depends on / blocked by:** the PC smoke test.
**Completed:** 0.1.6 (2026-10-09). A Windows office without Git for Windows runs Claude Code, which then runs hooks in PowerShell; the app now writes hooks for that shell (`src/main/hookShell.ts`), so no Git for Windows step is needed in onboarding.

### Clean up a "Not for" clause when its teammate leaves

**What:** When a hire is bound to a mailbox or topic, overlapping teammates' routing lines gain "Not for <scope>; that goes to <Name>." If that teammate is later renamed or removed, rewrite or drop the clause.

**Why:** A stale clause sends Michael to a name that no longer exists, and the work bounces.

**Context:** Found by the spec review of the hire wizard redesign (2026-09-27). The clause format is `bindingLines` in `src/shared/hireTemplates.ts`; hook the rename path in `hive.ts` and agent removal in the renderer.

**Effort:** S
**Priority:** P2
**Completed:** 0.1.0 (2026-10-04). A rename rewrites the clause on every teammate (renamePatches); closing or forgetting the hire takes it off and keeps it on the hire, and it goes back when they return (src/renderer/src/shell/releaseBindings.ts).

### Recognise the connector behind an opaque server name

**What:** When the connector's server has a UUID-like name, 16 of its tools (including `money_onboarding_application_submit`) are not recognised as QuickBooks and are not gated.

**Why:** Claude Code names claude.ai connectors `claude_ai_Intuit_QuickBooks`, which matches; a differently named server would not. Match on the connector URL from `claude mcp list` or on the full tool catalog.

**Effort:** S
**Priority:** P2
**Completed:** 0.0.15 (2026-10-02). Any MCP server that is not a discovered, granted connector is now refused by default (docs/designs/claude-connectors.md), so an opaque name can no longer slip past.

### Subagents keep their parent's QuickBooks access

**What:** Tag hook payloads with the harness agent id so a subagent's own `agent_id` does not replace it.

**Why:** If Claude Code sends a subagent id, the hook finds no capability and refuses Oscar's delegated QuickBooks reads (fails closed).

**Effort:** S
**Priority:** P3
**Completed:** 0.0.15 (2026-10-02). The hook shim always sends the agent's own id and keeps Claude Code's subagent id as `subagent_id`, so delegated calls follow the agent's QuickBooks, connector and folder rules.

### Back the Claude account switch with more than the hook

**What:** The Your Claude account switch was enforced only by the PreToolUse hook, which let calls through when the hook could not reach the app, and matched connectors by server name.

**Completed:** 0.0.15 (2026-10-02). Replaced by per-connector grants (docs/designs/claude-connectors.md): connectors are kept out at spawn, the hook shim fails closed for MCP calls, and connectors are matched by tool name. Left open: local-scope and project `.mcp.json` servers are not in the start-up deny list (the hook still refuses them).

### Point the contributors workflow at this fork's credit, or turn it off

**What:** `.github/workflows/contributors.yml` regenerates CONTRIBUTORS.md from this repo's merged pull requests and opens a bot pull request.

**Why:** On this fork that list would drop the original project's contributors, which the README credits.

**Context:** Found in the 0.0.1 land audit. A bot pull request is harmless until someone merges it.

**Effort:** S
**Priority:** P3
**Depends on:** None
**Completed:** 2026-09-24 (the workflow stays on; CONTRIBUTORS.md now lists this repo's contributors only, and the README no longer credits the upstream list there)

## Claude account connectors (deferred from /plan-ceo-review, 2026-10-02)

### Per-connector activity log

**What:** Record each connector call (agent, connector, tool, allowed or refused) and show recent use on each row of Settings > Connections > Claude connectors.

**Why:** Once connectors are granted per agent, the owner will ask what an agent did in HubSpot or Drive; refusals are otherwise visible only in the agent's own terminal.

**Pros:** A clear record of who touched which system; builds on the hook's refusal log lines from the connectors plan.

**Cons:** A new screen, log rotation and privacy wording.

**Context:** Deferred as E5 (D7) in docs/designs/claude-connectors.md. The hook already sees every MCP call (`src/main/hooks.ts`).

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** the Claude connectors plan.

### Disable the owner's Claude Code plugins in agent sessions

**What:** Start agents with the owner's Claude Code plugins (skills, hooks, agent definitions) disabled, not only their MCP servers.

**Why:** E1 in docs/designs/claude-connectors.md blocks personal and plugin MCP servers, but plugin skills, hooks and agents still load in every agent session; a plugin hook runs code on agent events.

**Pros:** Closes the rest of the leak E1 targets; agents run only what the app provides.

**Cons:** Needs a probe of which flag or setting disables plugins for one session without touching the owner's own Claude Code.

**Context:** Seen 2026-10-02: plugins enterprise-search and finance load in agent sessions (stream-json `init`).

**Effort:** S (human) / S (CC)
**Priority:** P2
**Depends on:** nothing.

## Watch list (no issue seen yet; act only if the symptom shows up)

### Agents skip their folder or company knowledge

**Watch for:** an agent answers a policy, price or "how we do it" question from memory or the internet when the answer is in the company knowledge store; an agent asks the owner for a document already in its folder; this happens more late in a long session or after a compaction.

**How it works today:** agents are only told, never reminded. At spawn, `injectedPrompt` (`src/main/hive.ts`) puts the folder line ("read it for context before searching the internet"), `companyKnowledgeLine` ("when a task touches any of that, search it") and `memoryRule` into `--append-system-prompt`. At session start the hook (`src/main/hooks.ts`) adds the company profile, which ends with a pointer to the knowledge store, and the memory index. `knowledgeUpdate` speaks only when the owner turns the store on or off. Nothing repeats per task, nothing searches for the agent, nothing lists the folder's files, and nothing records whether `kg search` ran.

**Smaller gaps:** Michael's folder line does not say to read it for context; Michael's hand-off rules say "where to look" but never name company knowledge; Codex, Grok and agy get the text only as their first message.

**Fixes, strongest first:**
1. On a new task, have the hook run `kg search` on the task text and attach the top 2 or 3 matches (capped, skipped when nothing matches).
2. A one-line reminder through the hook when a new inbox task arrives.
3. A short list of the agent's folder files at session start, sent again when it changes (like the roster).
4. Log `kg` calls from activity events so agents that never search are visible. Do this first if the symptom appears, to confirm it.

**Context:** Investigated 2026-10-02 on the owner's question; owner chose to watch rather than build, since no issue has been seen.

**Effort:** S to M (human) / S (CC)
**Priority:** P3 (watch)
**Depends on:** nothing.

## Windows

### Sign the Windows installer

**What:** Choose a Windows signing service (Microsoft Trusted Signing, or a vendor cloud key such as DigiCert KeyLocker or SSL.com eSigner), then wire `release.yml` so the Windows leg signs when its secrets exist and builds unsigned, without failing, when they don't.

**Why:** Unsigned installers show "Windows protected your PC"; people must click More info, then Run anyway. Some small business owners stop there.

**Pros:** Removes or shortens the warning; the publisher name shows in the install prompt.

**Cons:** A paid account and a one-time identity check; a new signature can still warn until Windows' reputation system trusts it.

**Context:** Accepted as E1 in `docs/designs/windows-11-installer.md` (CEO review 2026-10-04), with wiring deferred by R5 until the owner picks a service at sign up. New certificates must keep their key in hardware or a cloud vault, so a certificate file in CI secrets is not an option. Mirror the Mac notarize step: absent secrets mean an unsigned build and no failure.

**Effort:** human M / CC S
**Priority:** P2
**Depends on / blocked by:** the owner choosing a service and passing its identity check.

### Copy diagnostics for problem reports

**What:** A "Copy diagnostics" button beside Settings' Report a problem: app and OS versions, the last 50 office event types from `log.jsonl`, agent exit summaries, with paths and names redacted; copied to the clipboard only.

**Why:** Report a problem carries version numbers only, on purpose, so beta reports can lack what happened just before the failure.

**Pros:** Remote debugging of Windows beta problems without back and forth.

**Cons:** Redaction must be exact: office names, folder paths and customer names must never reach the copy.

**Context:** Deferred as S3 in `docs/designs/windows-11-installer.md` (CEO review 2026-10-04) to design from what the first real beta reports lack. Sources: hive `log.jsonl`, `crashes/` (raw terminal tails, never copied raw).

**Effort:** human M / CC S
**Priority:** P3
**Depends on / blocked by:** the first Windows beta reports.

### Go live steps for the Windows beta

**What:** In order:
1. Push an rc tag (vX.Y.Z-rc.1).
2. ~~Read the first "Tests (Windows)" CI run and fix each POSIX-only test, or skip it on win32 with a reason.~~ Done 2026-10-09: tests are platform scoped (`test/platform.cjs`, CONTRIBUTING.md). Text files check out with LF (`.gitattributes`), Windows test path assumptions were made portable, and Mac or POSIX only tests skip on Windows with a reason.
3. Run the rc.1 and rc.2 checklist on the clean x64 Windows 11 PC: install through SmartScreen, onboard, hire, task, mail archive search, schedule, rc.1 updates to rc.2, a user name with a space and an accent, an office folder in OneDrive, and agent start time under Defender. Also check that rc.2 is offered the clean release.
4. ~~Once it is green, remove `continue-on-error: true` from the `test-windows` job~~ Done 2026-10-09 (ci.yml now also runs "Tests (macOS)", and every job blocks). Done 2026-10-10: Typecheck, Build, Tests (macOS) and Tests (Windows) are required checks on main in the "protect main" ruleset, and admins can bypass them only by merging a pull request.
5. ~~Set the repository variable `WINDOWS_RELEASE=on`.~~ Done 2026-10-05: the owner chose to ship Windows on every release before the PC check. v0.1.1 got its Windows installer added after release.
6. After the first clean release that carries Windows, add the Windows (beta) download to the website, and confirm with the owner before that push.

**Why:** Windows ships on every release before the PC check (owner, 2026-10-05); these steps confirm it works. The website push is a production deploy.

**Context:** Deferred from the ship of feat/windows-beta-askme-fixes (2026-10-05). These are post-merge steps from `docs/designs/windows-11-installer.md` (T5, T10, R9, R10, E5).

**Effort:** human M / CC S
**Priority:** P1
**Depends on / blocked by:** this branch merged; the physical PC.

## Ask me (deferred from ship of feat/windows-beta-askme-fixes, 2026-10-05)

### FEATURES.md entries at land

**What:** Add the Ask me file rows and the Windows beta to `docs/FEATURES.md` when this branch lands.

**Why:** FEATURES.md is updated at each land.

**Context:** Deferred from plan: `docs/designs/ask-me-open-file.md` and `docs/designs/windows-11-installer.md`.

**Effort:** human S / CC S
**Priority:** P1

### A React test harness

**What:** Add a small render harness (jsdom with react-dom) so these renderer paths get behavior tests instead of source regex pins:
- Ask me rows
- the per-index answer
- AskFileRows states
- Task detail withdrawn text
- the floor's flight rules

**Context:** The coverage audit for this ship found 7 paths that are only pinned by source regex (73% value-weighted). The same applies to the IPC handlers in `src/main/index.ts`, which tests cannot load.

**Effort:** human M / CC M
**Priority:** P2

### Trust boundaries Codex raised on Ask me (2026-10-05)

**What:** Codex adversarial pass 2 raised these items. Each one either already exists on main or needs a design decision:
1. ~~**Question text in Michael's request.**~~ Done 2026-10-18: the question goes in as one line labelled as card text, through cardText, which also folds C1 line breaks and drops format characters.
2. **Who closed the question.** Open or closed is decided by whether a string is present, so a worker that writes tasks.json can set `a` or `dismissedAt` and hide a question. Give answers and withdrawals provenance: the recorded owner answer keys for answers, plus a trusted withdrawal marker.
3. ~~**The 30-day window.**~~ Done 2026-10-06 (michael-replies.md): a fixed floor replaces the rolling window.
4. ~~**Reply alias.**~~ Done 2026-10-06 (michael-replies.md): any name that reaches the owner closes a request.
5. **File swap race.** `fs:openAskFile` checks the file and then opens it by path. The swap window is milliseconds, because the check runs at click time. Open a verified copy or a file handle instead.

**Effort:** human M / CC S
**Priority:** P2

### Hire wizard offers Send only from an existing mailbox (deferred 2026-10-06)

- **What:** In the hire wizard's mailbox step, also list "Send only from <address> (<owner>)" for roles whose pack card sends mail.
- **Why:** A new sales hire could send outreach from the owner's address from day one instead of needing a second step on the Access tab.
- **Pros:** Teaches Send only where it matters; no extra trip to the Access tab.
- **Cons:** One more choice in an already full wizard step.
- **Context:** docs/designs/shared-mailboxes.md (E4, owner deferred in the CEO review). Send only grants live on the Access tab first.
- **Depends on / blocked by:** Send only grants (shared-mailboxes.md accepted scope) shipping first.

### Translate the update surfaces

**Completed:** next release after 0.2.0 (2026-10-14), contributed in #290.

### Row still names a finished tool

**Completed:** next release after 0.2.0 (2026-10-14), contributed in #288.

### Parse documents off the main thread

**Completed:** next release after 0.2.0 (2026-10-14), documents are read in a process of their own, src/main/docTextProcess.ts.
