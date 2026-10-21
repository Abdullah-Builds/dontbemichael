import type { ResearchConfig } from '../shared/research';
import type { DataClassId, DataClassSetting } from '../shared/dataClasses';
import type { MailboxRecord, AgentCapabilities } from '../shared/mailboxes';
import type { CompanyProfile } from '../shared/companyProfile';
import type { ScheduledMission, ScheduleRequest } from '../shared/missions';
import type { ClaudeConnectorsState } from '../shared/claudeConnectors';
import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  autoModeFlagForProvider,
  defaultCommandForProvider,
  inferAgentProvider,
  providerPreset,
  type AgentProvider
} from '../shared/agentProvider';
import { defaultMcpDefaults } from '../shared/mcpCatalog';
import { MAX_AGENT_TOKEN_CAP } from '../shared/tokenCaps';
import { expandTilde, normalizeHiveHome } from './fs';
import { isHeldRename, RENAME_RETRY_MS, sleepSync, writeFileAtomic } from './atomicFile';
import type { IntegrationRecord } from '../shared/integrations';
import {
  DEFAULT_CONTEXT_TRIGGER,
  DEFAULT_ORG_TRIGGER,
  DEFAULT_TRIGGER_MODE,
  DEFAULT_WEBHOOK_SCHEMA,
  type ContextTriggerConfig,
  type OrgTriggerConfig,
  type WebhookTrigger
} from '../shared/triggers';

/** A recurring schedule. The type and every rule about it (ownership, next run,
 *  what a run sends) live in shared/missions.ts so main, preload and the
 *  renderer can't drift apart. */
export type { ScheduledMission } from '../shared/missions';

/** The standup's focus area (schedule-focus-areas.md F6, card-lifecycle.md
 *  section 6): what Michael concentrates on in each standup run. */
export const OPS_STANDUP_FOCUS =
  'First close your open requests from the owner: route each answer and reply done to it. ' +
  'Fix each blocked card with nothing asked: ask its question on Ask me, ' +
  'move it to waiting naming who in waitingOn, or to done. ' +
  'Check the floor in fleet.json: who does what, whether each member still runs, ' +
  'whether in-flight cards are on track, and whether any card has nobody on it. ' +
  'A doing card held on someone outside the office or a teammate goes to waiting, naming who in waitingOn; ' +
  'a waiting card returns to doing when they answer; else work the gone quiet list. ' +
  'Re-engage anyone stalled; keep the board right.';

/** Standup focus texts the app shipped before. An office still carrying one
 *  word for word gets the current one at launch; the owner's own text stays. */
export const OPS_STANDUP_BUILT_IN_FOCUSES: readonly string[] = [
  // 2026-10-10 to 2026-10-17: "else chase them", with no check back time,
  // so a Waiting card whose customer never answered could wait forever.
  'First close your open requests from the owner: route each answer and reply done to it. ' +
  'Then fix each blocked card with nothing asked: ask its question on Ask me, ' +
  'move it to waiting naming who in waitingOn, or to done. ' +
  'Check the floor in fleet.json: who is doing what, whether each member still runs, ' +
  'whether in-flight cards are on track, and whether any card has nobody on it. ' +
  'A doing card held on someone outside the office or a teammate goes to waiting, naming who in waitingOn; ' +
  'a waiting card returns to doing when they answer; else chase them. ' +
  'Re-engage anyone stalled and keep the board right.',
  // 2026-10-09 dev builds only: Waiting without the step that brings a card
  // back to doing, so an office that ran one still gets the current text.
  'First close your open requests from the owner: route each answer and reply done to it. ' +
  'Then fix every blocked card with nothing asked: put its question for the owner on Ask me, ' +
  'or move it to waiting with who it waits on in waitingOn, or to done. ' +
  'Then check the floor through fleet.json: who is doing what, whether each team member is still running, ' +
  'whether in-flight cards are on track, and whether any card has nobody on it. ' +
  'Move every doing card that waits on someone outside the office or a teammate to waiting, naming who in waitingOn. ' +
  'Re-engage anyone stalled and keep the board accurate.',
  // 2026-10-03, before the Waiting column: it sent a card held on someone to
  // doing, so every hour it undid the Waiting rule and no card ever reached it.
  'First close your open requests from the owner: route each answer and reply done to it. ' +
  'Then fix every blocked card with nothing asked: put its question for the owner on Ask me, ' +
  'or move it to doing with who it waits on, or to done. ' +
  'Then check the floor through fleet.json: who is doing what, whether each team member is still running, ' +
  'whether in-flight cards are on track, and whether any card has nobody on it. ' +
  'Re-engage anyone stalled and keep the board accurate.',
  // 2026-10-02, before blocked cards with nothing asked were listed.
  'First close your open requests from the owner: route each answer and reply done to it. ' +
  'Then check the floor through fleet.json: who is doing what, whether each team member is still running, ' +
  'whether in-flight cards are on track, and whether any card is blocked or has nobody on it. ' +
  'Re-engage anyone stalled and keep the board accurate.'
];

/** The built-in hourly ops standup. A schedule says when and which job
 *  (owner, 2026-09-25): the label names the job, and what Michael covers at a
 *  standup is its focus area (OPS_STANDUP_FOCUS), sent with each run. Shipped
 *  enabled; users can toggle it off in the Command Center. */
export const OPS_STANDUP_MISSION: ScheduledMission = {
  id: 'ops-standup',
  label: 'Hourly ops standup',
  intervalMs: 3_600_000,
  to: 'god',
  body: '',
  focus: OPS_STANDUP_FOCUS,
  enabled: true
  // NO autoCompact. Compaction belongs to contextTrigger.compact and nothing else.
};

/** Company foundations check (office-foundations.md, eng D3): once a week,
 *  Michael brings each empty question the work hit back to the owner. Its how
 *  is in his instructions ("Company foundations"); the focus says this run. */
export const FOUNDATIONS_CHECK_FOCUS =
  'For each empty question in the company foundations that the work hit: if its foundation card is open, ' +
  'set its ask\'s askedAt to now so it comes back to the top of Ask me; if none is open, raise one. ' +
  'Raise nothing for a question no work has hit, and nothing when every hit question is answered.';

export const FOUNDATIONS_CHECK_MISSION: ScheduledMission = {
  id: 'foundations-check',
  label: 'Foundations check',
  intervalMs: 7 * 86_400_000,
  // Mondays at 9:00.
  weekly: { days: [1], minute: 9 * 60 },
  to: 'god',
  body: '',
  focus: FOUNDATIONS_CHECK_FOCUS,
  enabled: true
};

/** Standup prompts the app itself shipped. An office still carrying one of
 *  them word for word gets the current (empty) body at launch, because its
 *  content now lives in the standup's focus area; text the owner wrote is kept. */
export const OPS_STANDUP_BUILT_IN_BODIES: readonly string[] = [
  // Until 2026-09-25 (morning): told Michael each agent would compact.
  'Hourly ops standup. Review every agent: who is doing what, and confirm each ' +
  'is still running (not stalled or idle-stale). Check the task board \u2014 are ' +
  'in-flight tasks on track, and is anything blocked or unowned? Flag stale ' +
  'agents and at-risk tasks, and keep the board accurate. (As part of this ' +
  "standup each working agent is asked to summarise its current task and the " +
  'next step, then compact and resume from the same point \u2014 so terminal ' +
  'contexts stay bounded without losing work. The compaction is queued and ' +
  'runs when an agent is idle, so it never interrupts work mid-step.)',
  // 2026-09-25, before schedules stopped carrying prompts.
  'Hourly ops standup. Review every agent: who is doing what, and confirm each ' +
  'is still running (not stalled or idle-stale). Check the task board: are ' +
  'in-flight tasks on track, and is anything blocked or unowned? Flag stale ' +
  'agents and at-risk tasks, and keep the board accurate.'
];

/** The built-in heartbeat (Lane A #1). A context-aware beat that, each tick,
 *  observes live floor state and — only when the floor has gone quiet — drops a
 *  digest into god's inbox and (if god's PTY is genuinely idle) nudges it to
 *  re-engage anyone stalled. The same beat ticks the circuit breaker.
 *
 *  Shipped DISABLED by default (opt-in): unlike the standup, which only sends a
 *  hive message, the heartbeat types into god's PTY, so the user turns it on
 *  explicitly in the Command Center once they want active re-engagement.
 *  `intervalMs` is the normal-cadence base; the scheduler derives a tighter beat
 *  when an agent looks stuck and a slower one right after a re-engage. */
export const HEARTBEAT_MISSION: ScheduledMission = {
  id: 'heartbeat',
  label: 'Floor heartbeat',
  intervalMs: 120_000,
  to: 'god',
  body:
    'Floor heartbeat: the team has gone quiet. Review the digest in your inbox, ' +
    're-engage anyone stalled or blocked, and keep the board accurate — or rest ' +
    'if the work is genuinely done.',
  enabled: false,
  kind: 'heartbeat',
  quietThresholdMs: 300_000
};

/** What a heartbeat sends Michael: the summary, with the owner's text from the
 *  heartbeat box ahead of it when the owner wrote some. The shipped default is
 *  not sent: it says the team has gone quiet and points to a digest in the
 *  inbox, which is wrong on a beat for waiting mail and when the digest is in
 *  the same message. */
export function heartbeatMessage(body: string | undefined, digest: string): string {
  const own = body?.trim();
  return own && own !== HEARTBEAT_MISSION.body.trim() ? `${own}\n\n${digest}` : digest;
}

/** The dedicated auto-compact MAINTENANCE schedule (maint-1). DECOUPLED from the
 *  ops standup so editing/replacing a standup can never silently disable
 *  compaction again (the bug this fixes). It fires ONLY the auto-compact signal —
 *  `kind:'compact'` makes syncMissions skip the hive.send dispatch (empty to/body).
 *  Shipped DISABLED (v0.3.4 founder decision): scheduled compaction is opt-in.
 *  Turn it on in Settings → General or the Schedules tab; the Schedules warning
 *  panel explains the risk of leaving it off for long-running agents. It is the
 *  SINGLE source of truth for compaction, and it's persistent: deleting it makes
 *  it reappear DISABLED.
 *  Existing installs keep whatever enabled state the user already has
 *  (compactMaintenanceSeeded guards re-seeding). */
export const COMPACT_MAINTENANCE_MISSION: ScheduledMission = {
  id: 'compact-maintenance',
  label: 'Auto-compact (maintenance)',
  // 2h, matching DEFAULT_CONTEXT_TRIGGER.compact.everyMs. The two cadences must
  // agree: this mission is the schedule half of the same behaviour the context
  // trigger now owns, and a 1h seed here would keep interrupting agents on the
  // old rhythm no matter what the trigger says.
  intervalMs: 7_200_000,
  to: '',
  body: '',
  enabled: false,
  autoCompact: true,
  kind: 'compact'
};

/** The 1h cadence `compact-maintenance` was seeded with before Triggers doubled
 *  it. `migrateTriggersV1` bumps only missions still sitting on this EXACT value,
 *  so an interval the user tuned by hand is left exactly where they put it. */
const LEGACY_COMPACT_MAINTENANCE_INTERVAL_MS = 3_600_000;

/** Circuit-breaker thresholds (Lane A #6.6b). The breaker runs inside the
 *  heartbeat beat, so it only ticks when the heartbeat is enabled. Trip
 *  conditions are behavioral by default; `costCapUsd` is the only $-based one and
 *  is unset by default (a hardcoded dollar default would be arbitrary). Defaults
 *  are deliberately conservative and steer-first — `hardStop` is OFF unless the
 *  user opts in, so the breaker never auto-kills a healthy long-runner. */
export interface CircuitBreakerConfig {
  /** Master switch for breaker evaluation within the beat. Default true. */
  enabled?: boolean;
  /** Allow the top of the ladder (kill PTY + archive). Default false = the
   *  breaker may steer/constrain but never hard-stops until the user opts in. */
  hardStop?: boolean;
  /** Consecutive identical tool calls (same name+input) before tripping. */
  repeatedToolLimit?: number;
  /** Consecutive api_error / retry events before tripping. */
  errorStormLimit?: number;
  /** Output-token velocity (tokens/min, diffed across beats) before tripping. */
  tokenVelocityPerMin?: number;
}

/** Company knowledge (the Knowledge Graph store + agent access tool).
 *  The owner adds their own documents, sheets, PDFs and images; agents search
 *  them on demand via the `kg` CLI and MemPalace. Always on since 2026-10-19
 *  (owner: no switch); members are pointed at it while it holds a document.
 *  See docs/design/knowledge-graph.md. */
export interface KnowledgeGraphConfig {
  /** The old switch. Company knowledge has no switch since 2026-10-19 (owner);
   *  an office whose owner had set this false is told once (knowledgeOnNoticeSeen). */
  enabled?: boolean;
  /** Override the store location. Unset = <userData>/knowledge. */
  rootPath?: string;
}

export interface HarnessConfig {
  /** Has the user completed the first-run onboarding? */
  onboardingComplete: boolean;
  /** Self-identified audience. NO LONGER ASKED during onboarding — the first
   *  screen now asks what business the owner runs, and onboarding speaks one
   *  plain register to everyone. Kept because Settings still exposes it as
   *  "simple mode" and existing installs have it persisted; unset = never chosen. */
  audience?: 'technical' | 'non-technical';
  /** Which Office Pack the owner picked on the first onboarding screen (a pack's
   *  `businessType`, e.g. 'restaurant-food'). Decides the suggested starter cast,
   *  the office hours and each agent's starting tool levels. Unset = an install
   *  that predates business mode. */
  businessType?: string;
  /** The business's own name and city, as the owner typed them. They personalise
   *  the office (title bar, Michael's voice) and give agents something concrete
   *  to write with — a draft that says "Pho Saigon Kitchen, Austin" rather than
   *  "your business". Never used as a path or an id. */
  businessName?: string;
  businessCity?: string;
  /** The company profile: key facts with short, definite answers, delivered
   *  to every agent (src/shared/companyProfile.ts). */
  companyProfile?: CompanyProfile;
  /** Michael's folder: the business folder, private to him and the owner, that
   *  holds every team member's folder by default (src/shared/folderAccess.ts). */
  businessFolder?: string;
  /** Before 2026-09-25: the shared Office folder, inside Michael's. Read once at
   *  launch to fill businessFolder (its parent); nothing else uses it. Company
   *  knowledge lives in the knowledge feature now. */
  officeFolder?: string;
  /** The starter team picked during onboarding, each with the ABSOLUTE folder it
   *  works in (Decisions 44, 47). The running office starts agents from this. */
  businessTeam?: Array<{ agentId: string; folder: string }>;
  /** Set once the onboarding team has been started, so it is started once. */
  businessTeamStarted?: boolean;
  /** Research, the one team member on the internet (shared/research.ts). */
  research?: ResearchConfig;
  /** The owner's data classes that differ from the seeded defaults
   *  (shared/dataClasses.ts): what the team may send to Research. */
  dataClasses?: Partial<Record<DataClassId, DataClassSetting>>;
  /** Team members that failed their first start, tried again (and only they)
   *  on each later launch until they start. */
  businessTeamRetry?: string[];
  /** Set once existing team members got today's Role description and Work
   *  style (the one-time rewrite, 2026-09-25). */
  instructionsRewritten?: boolean;
  /** Set once the pack's First task text was taken out of existing team
   *  members' Work styles (docs/designs/first-task-card.md, D1). */
  firstTasksRemoved?: boolean;
  /** Owner decisions on offered job description updates
   *  (shared/workStyleUpdates.ts), by `${key}:${agentId}`: 'use' or 'keep'. */
  workStyleUpdatesDecided?: Record<string, 'use' | 'keep'>;
  /** Folder where the harness keeps its own state (agent metadata, logs). */
  harnessHome: string | null;
  /** Recently-opened office folders (most-recent first), offered by the missing
   *  office screen and Settings → General's other offices. Maintained by writeConfig whenever harnessHome is
   *  set (onboarding finish, changeHome). Capped to a handful. */
  recentHives?: string[];
  /** Folders the user registered during onboarding (used as quick-picks). */
  registeredRepos: string[];
  /** When true, new agents are spawned with --permission-mode bypassPermissions. */
  autoMode: boolean;
  /** May the orchestrator ("Michael") spin up agents on its own?
   *
   *  Default FALSE. Spawning an agent is a SPEND decision, so it should not
   *  happen unprompted. The ability itself shipped in v0.4.4 with no gate at all,
   *  so this closes an existing default-on behaviour rather than gating a new
   *  feature: an operator who wants it must now say so.
   *
   *  Off does not FAIL a queued spawn request, it declines to consume one. The
   *  request sits in HIVE_ROOT/spawn-requests until the toggle is turned on. */
  orchestratorMaySpawn: boolean;
  /** The command we run when spawning a new agent. */
  defaultCommand: string;
  /** Default model for newly spawned agents (e.g. 'claude-sonnet-4-6[1m]'); unset = CLI default. */
  defaultModel?: string;
  /** Which provider powers the GOD orchestrator ("Michael"). The persona is
   *  constant; only its engine is selectable. Default 'claude'. Eligible providers
   *  are those that can receive inbox (claude/codex/antigravity/qwen). */
  godProvider?: AgentProvider;
  /** How Claude Code signs in for the team (docs/designs/get-michael-ready.md):
   *  the owner's Claude account (default), or an Anthropic API key kept in the
   *  secret store under `apikey:anthropic` and handed to each Claude agent as
   *  ANTHROPIC_API_KEY at start. */
  claudeAuth?: 'account' | 'apiKey';
  /** What the owner pays for their Claude plan a month, in USD (Settings > Agents).
   *  Unset: the detected plan's list price. Pulse splits it by share of the work. */
  planPriceMonthly?: number;
  /** The model GOD runs on. Unset falls back to the provider preset's
   *  `recommendedOrchestratorModel`, then MODEL_GOD. Default 'claude-opus-5-5'. */
  godModel?: string;
  /** Per-server consent state for the default MCP bundle, keyed by catalog id.
   *  Seeded from MCP_CATALOG (safe-readonly ON, write/secret OFF); the user flips
   *  these in Settings. A server is wired into an agent only when enabled here. */
  mcpDefaults?: { [id: string]: { enabled: boolean } };
  /** Mailboxes connected in Settings (docs/designs/multi-mailbox.md). Metadata
   *  only; each app password lives in the secret store under `mail:<id>`. */
  mailboxes?: MailboxRecord[];
  /** Per-agent Capabilities, keyed by agent id (Michael included). Missing means
   *  no capabilities: every agent starts with email off (MB-6). */
  agentCapabilities?: { [agentId: string]: AgentCapabilities };
  /** The QuickBooks row's switch in Settings > Connections > Claude connectors:
   *  agents may use the QuickBooks on the owner's Claude account (owner,
   *  2026-09-29; one row in the connector list since 2026-10-02). Off or absent
   *  refuses everyone. */
  quickbooksClaude?: boolean;
  /** The last read of the connectors on the owner's Claude account
   *  (shared/claudeConnectors.ts). Absent until the first read. */
  claudeConnectors?: ClaudeConnectorsState;
  /** Settings > Connections > Claude connectors: the ones the owner turned on,
   *  by key. Off or absent refuses every agent. QuickBooks uses quickbooksClaude. */
  connectorsOn?: { [key: string]: boolean };
  /** The connector keys the owner has seen in Settings, so a new one opens the list. */
  connectorsSeen?: string[];
  /** One-time guard: the old QuickBooks and "Your Claude account" choices were
   *  carried over to the connector list (owner, 2026-10-02, D9). */
  connectorsMigrated?: boolean;
  /** Embedding model for the palace: lightweight 'minilm' or multilingual 'embeddinggemma'. */
  embeddingModel: 'minilm' | 'embeddinggemma';
  /** Recurring auto-dispatch missions handled by the scheduler. */
  missions?: ScheduledMission[];
  /** One-time guard: schedules were moved to per-agent ownership (everyone rows
   *  to Michael, createdBy stamped). See migrateMissions in shared/missions.ts. */
  missionsOwnersMigrated?: boolean;
  /** Schedule changes agents asked for, waiting for the owner in ASK ME. An
   *  agent never changes a schedule itself (owner, 2026-09-25). */
  scheduleRequests?: ScheduleRequest[];
  /** One-time guard: has the built-in hourly ops standup been seeded into an
   *  existing install's missions? Prevents re-adding it after a user deletes it. */
  opsStandupSeeded?: boolean;
  /** One-time guard: the weekly Foundations check was added (office-foundations.md);
   *  an owner who deletes it keeps it deleted. */
  foundationsCheckSeeded?: boolean;
  /** One-time guard: the standup got its focus area (schedule-focus-areas.md
   *  F6). An owner who later edits or clears it keeps their choice. */
  standupFocusSeeded?: boolean;
  /** Owner answers the app recorded from Ask me (shared/ownerRequests.ts
   *  answerKey): the launch catch-up relays only these. */
  ownerAnswerKeys?: string[];
  /** Legacy: the first build kept the dock's genuine message keys here
   *  (michael-replies.md, R4). Read once, moved to userData/owner-dock-keys.json,
   *  then cleared. */
  ownerDockKeys?: string[];
  /** Legacy one-time guard (2026-09-25): the old switch was turned on once for
   *  this install. The switch is gone; an `enabled` false left by an owner who
   *  turned it off later only brings the one time knowledge notice. */
  knowledgeOnSeeded?: boolean;
  /** The one time card telling an owner who had company knowledge off that it
   *  has no switch now and its documents are searchable was read. */
  knowledgeOnNoticeSeen?: boolean;
  /** One-time guard for the built-in heartbeat mission (mirrors opsStandupSeeded
   *  so a user who deletes the heartbeat doesn't get it re-added every boot). */
  heartbeatSeeded?: boolean;
  /** maint-1 guard for the dedicated auto-compact maintenance mission. UNLIKE the
   *  two above, this does NOT suppress re-add forever: once seeded (flag set), a
   *  later delete makes the mission reappear DISABLED on next boot (compaction is
   *  required, so it's never silently lost — only user-disabled). */
  compactMaintenanceSeeded?: boolean;
  /** DEPRECATED (v0.3.4): config-file only, no UI anywhere. Hard dollar ceiling
   *  across all active agents. Still enforced if present so legacy configs keep
   *  their guard, but the token cap (costCapTokens) is the real budget —
   *  scheduled for removal next release. */
  costCapUsd?: number;
  /** Hard TOKEN ceiling (total tokens across all active agents) before the
   *  breaker trips. The user-facing budget — set in Settings. Opt-in like the
   *  $-cap; total = input + output + cacheRead + cacheCreation, summed across the
   *  floor (the biggest token spender is blamed). */
  costCapTokens?: number;
  /** Per-agent token ceiling, keyed by agent id. When an agent's own WORK tokens
   *  (input + output + cacheCreation — cacheRead excluded, see breaker.ts #189)
   *  exceed its cap the breaker trips that agent alone (independent of the floor
   *  budget, which sums all kinds). Set from each agent's card in the Command
   *  Center. */
  agentTokenCaps?: Record<string, number>;
  /** Agent ids whose automatic inbox/queue delivery is paused. Pending messages
   *  stay durable until the operator explicitly resumes delivery. */
  autoDeliveryPausedAgents?: string[];
  /** Passed to every spawned agent as `--max-turns <n>` when set; unset = no cap
   *  (Claude Code's default). A coarse runaway guard independent of the breaker. */
  maxTurns?: number;
  /** Max concurrent god-triggered ephemeral Slack workers; extra spawn-requests
   *  wait in the queue (natural backpressure, a resource backstop). Default 4. */
  maxConcurrentWorkers?: number;
  /** Minutes an ephemeral worker may produce NO output before the reaper kills it
   *  — idle-based, never wall-clock, so an actively-working worker is never reaped.
   *  Default 20. */
  workerIdleTimeoutMinutes?: number;
  /** Registered integrations (Phase 2) — labeled REST endpoints workers reach through
   *  the loopback secret broker. METADATA ONLY: each record carries a `secretRef`
   *  handle, never the secret value (secrets live encrypted in a separate file via
   *  Electron safeStorage — see src/main/integrations.ts). Default []. */
  integrations?: IntegrationRecord[];
  /** Default per-worker TOTAL-token cap (input+output+cache) applied to every
   *  god-triggered ephemeral worker; a worker's own spawn-request `tokenCap`
   *  overrides it. When the effective cap is exceeded the worker is reaped (its
   *  committed work preserved) and god is informed. This is PLUMBING for a later
   *  budget feature: per the human directive there is NO per-worker cap today, so
   *  the default is 0 = UNLIMITED — the mechanism is wired but never throttles
   *  unless someone explicitly sets a positive cap (per request or here). */
  defaultWorkerTokenCap?: number;
  /** Circuit-breaker thresholds (Lane A #6.6b). Unset = conservative defaults. */
  circuitBreaker?: CircuitBreakerConfig;
  /** Company knowledge (the Knowledge Graph store). Default ON. */
  knowledgeGraph?: KnowledgeGraphConfig;
  /** Fire native desktop notifications on agent lifecycle events (idle finish / waiting for input). */
  notifications?: boolean;
  /** Opt-in "strong keep-alive": while ≥1 agent PTY is live, escalate the power
   *  blocker from 'prevent-app-suspension' to 'prevent-display-sleep', which on
   *  macOS also blocks TRUE system sleep (lid-close/idle) so scheduled missions
   *  and terminals keep firing ON TIME while away — at a battery cost (best on
   *  AC). Default OFF: the honest default is "survive sleep + catch up once on
   *  resume" (see the powerMonitor 'resume' handler), not "stay awake". */
  strongKeepalive?: boolean;
  /** @deprecated Ignored since 2026-10-02: every installed build checks for
   *  updates (updater.ts), and the switch is gone. Kept so older config files
   *  still read. (Mirrored in preload + renderer config.) */
  autoUpdate?: boolean;
  /** Terminal theme — mirrored into each agent's per-session Claude settings
   *  ("theme" key) at spawn so the TUI's truecolor palette matches. Scoped to
   *  harness agents only; the user's global Claude theme is never touched. */
  terminalTheme?: 'light' | 'dark';
  /** Anonymous product analytics (PostHog) — the exact events/properties are
   *  documented in TELEMETRY.md. Ignored while COLLECT_USAGE_STATS
   *  (buildFeatures.ts) is false, as it is in this build. Otherwise default ON
   *  (opt-out); builds without an injected key and environments
   *  with DO_NOT_TRACK set never send regardless of this flag. (Mirrored in
   *  preload + renderer config.) */
  telemetryEnabled?: boolean;
  /** Master flag for the TV-show office themes feature (Settings theme picker +
   *  destructive switch flow). Default false = the picker is hidden and the
   *  office renders as today (zero behavior change). */
  tvShowOffices?: boolean;
  /** Which office map/cast theme the pixel office renders. Only honored when
   *  `tvShowOffices` is on; otherwise the office theme is used. Unbuilt show
   *  themes fall back to 'office' in the loader. */
  officeTheme?: 'office' | 'friends' | 'brooklyn99' | 'siliconvalley' | 'got' | 'hogwarts';
  /** Per-CLI-provider local/self-hosted base URL (Ollama/LM Studio/vLLM, …) for the
   *  OpenCode/Crush/pi/qwen engines; applied at spawn (config-injection or proxy
   *  upstream). API KEYS are NOT stored here — they live write-only in the secret
   *  broker (integrations.ts), read MAIN-ONLY at spawn. */
  providerBaseUrls?: Partial<Record<AgentProvider, string>>;
  /** Per-CLI-provider default model slug, used to pre-fill the model picker. */
  providerDefaultModels?: Partial<Record<AgentProvider, string>>;
  /** Master toggle for the Slack → Michael's-queue integration. */
  slackEnabled?: boolean;
  /** Slack app signing secret (Basic Information → Signing Secret). Never logged. */
  slackSigningSecret?: string;
  /** Bot token (xoxb-…) — only needed if the bot ever replies; optional for now. */
  slackBotToken?: string;
  /** Restrict ingestion to one channel id; empty/undefined = any channel. */
  slackChannelId?: string;
  /** Local HTTP port the webhook server binds to (default 3847). */
  slackPort?: number;
  /** Opt-in: allow APP/VOICE-INITIATED proactive posting into Slack (e.g. the
   *  renderer's "queued" acknowledgement). DEFAULT OFF per the human directive
   *  "stop posting into Slack by default". This does NOT gate the Slack-ORIGIN
   *  done-reply round-trip (a user @-mention → task → result posted back to that
   *  thread) or an agent's own direct in-thread reply — those always stay on. */
  slackProactivePosting?: boolean;

  // ─── Free Flow (voice dictation → message queue) ───────────────────────────
  /** Master toggle for Free Flow push-to-talk dictation. Default OFF: with it off
   *  the composer shows no mic button, no getUserMedia runs, and no Groq call is
   *  ever made (zero behavior change). */
  freeflowEnabled?: boolean;
  /** User-pasted Groq API key (the user supplies their own free key). Used ONLY in
   *  the main process for the Groq STT call; NEVER logged, and never crosses IPC
   *  for the request. Treated like `slackBotToken`. */
  groqApiKey?: string;
  /** Groq Whisper model id. Default 'whisper-large-v3-turbo' (fast, multilingual). */
  freeflowModel?: string;

  // ─── Realtime Michael (premium speech-to-speech voice orchestrator) ─────────
  /** True ONLY while a Realtime Michael voice session is live: the renderer
   *  session flips this on at start() (before getUserMedia) and off at stop().
   *  The main-process mic permission gate reads it so the Electron media
   *  permission is open EXACTLY while the voice loop holds the mic — never just
   *  because an OpenAI key exists (that key is shared with the CLI engines).
   *  Default off; absence ⇒ mic denied, mirroring `freeflowEnabled`. */
  realtimeVoiceEnabled?: boolean;
  /** How long (ms) a realtime voice session may sit with no voice activity before
   *  it auto-disconnects (the rt-9 idle guard). Default 180000 (3 min). 0 = never
   *  auto-disconnect on idle — the spend cap remains the runaway guard. The user
   *  tunes this in Settings → Realtime Michael. */
  realtimeIdleDisconnectMs?: number;

  // ─── Generic inbound webhook + status API (LEGACY, single-endpoint) ─────────
  // Superseded by `webhookTriggers`, which allows many endpoints over one server
  // and one tunnel. These three are kept because they are the MIGRATION SOURCE
  // (`migrateTriggersV1` folds them into a `WebhookTrigger`) and because the main
  // process still reads them until the server is rewired onto the new list.
  // Nothing new should be written here.
  /** @deprecated Use `webhookTriggers[].enabled`. */
  webhookEnabled?: boolean;
  /** App-generated shared secret callers echo in `x-md-webhook-secret`. Never
   *  logged, and never forwarded into the routed message/card/response.
   *  @deprecated Use `webhookTriggers[].secret` (one secret per endpoint, so
   *  revoking one caller never disturbs the others). */
  webhookSecret?: string;
  /** Local HTTP port the generic webhook server binds to (default 3849).
   *  @deprecated The port is a property of the shared server, not of any one
   *  trigger; `webhookTriggers` are multiplexed over it by id. */
  webhookPort?: number;

  // ─── Triggers (src/shared/triggers.ts owns every type here) ────────────────
  /** Auto-compaction / auto-clearing of agent terminal context. Both halves ship
   *  in DEFAULT_CONTEXT_TRIGGER; `readConfig` deep-fills them, because the
   *  top-level merge below is one level deep and a half-written sub-object would
   *  otherwise reach consumers with `undefined` thresholds. */
  contextTrigger?: ContextTriggerConfig;
  /** Inbound HTTP endpoints, one entry per caller. Replaces the legacy single
   *  webhook above; several coexist on one port, told apart by `id` in the path. */
  webhookTriggers?: WebhookTrigger[];
  /** Peer messaging between teammates' clone nodes. Persistence + UI only today —
   *  no transport service reads `apiKey` yet. */
  orgTrigger?: OrgTriggerConfig;
  /** One-time guard for `migrateTriggersV1` (legacy webhook → webhookTriggers,
   *  1h → 2h compact cadence). Set once the migration has run to completion. */
  triggersMigratedV1?: boolean;
}

const DEFAULTS: HarnessConfig = {
  onboardingComplete: false,
  harnessHome: null,
  recentHives: [],
  registeredRepos: [],
  autoMode: true,
  orchestratorMaySpawn: false,
  defaultCommand: 'claude',
  godProvider: 'claude',
  godModel: 'claude-opus-5-5',
  // Global default model for every agent that hasn't picked one explicitly — wins
  // over the role-based tiers (modelForRole) in the spawn handler, so all agents
  // (incl. god) default to Fable 5. A per-agent model choice still overrides it.
  defaultModel: 'claude-fable-5',
  // Seeded from the MCP catalog so the consent defaults never drift from it
  // (safe-readonly ON, write/secret OFF).
  mcpDefaults: defaultMcpDefaults(),
  maxConcurrentWorkers: 4,
  workerIdleTimeoutMinutes: 20,
  integrations: [],
  defaultWorkerTokenCap: 0, // 0 = unlimited (human directive: NO per-worker cap)
  embeddingModel: 'minilm',
  missions: [OPS_STANDUP_MISSION],
  notifications: false,
  strongKeepalive: false,
  telemetryEnabled: true,
  tvShowOffices: false,
  officeTheme: 'office',
  slackEnabled: false,
  slackSigningSecret: undefined,
  slackBotToken: undefined,
  slackChannelId: undefined,
  slackPort: undefined,
  slackProactivePosting: false,
  freeflowEnabled: true,
  groqApiKey: undefined,
  freeflowModel: 'whisper-large-v3-turbo',
  realtimeVoiceEnabled: false,
  realtimeIdleDisconnectMs: 180_000,
  webhookEnabled: false,
  webhookSecret: undefined,
  webhookPort: undefined,
  // Triggers. These three are the ONLY object/array defaults that get handed
  // straight back out of `readConfig` for a config that never persisted them, so
  // `withTriggerDefaults` re-copies them on every read — see the note there.
  contextTrigger: DEFAULT_CONTEXT_TRIGGER,
  webhookTriggers: [],
  orgTrigger: DEFAULT_ORG_TRIGGER,
  triggersMigratedV1: false,
  // Company knowledge (the knowledge feature): ON by default (owner,
  // 2026-09-25). It is where company wide information, policies and rules live,
  // and every agent, Michael included, searches it. Existing installs are
  // switched on once at launch (knowledgeOnSeeded).
  knowledgeGraph: { enabled: true }
};

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

/**
 * Deep-fill the trigger sub-objects, and hand back copies of them.
 *
 * TWO problems, one fix. First, the merge in `readConfig` is one level deep, so a
 * `contextTrigger` persisted by an older build (or by a `writeConfig` that
 * patched only `compact`) arrives missing sub-keys that DEFAULTS would have
 * supplied — the consumer then reads `undefined` where it expects a number and
 * the rule never fires. Second, that same shallow merge hands the literal
 * DEFAULT_CONTEXT_TRIGGER / DEFAULT_ORG_TRIGGER instances to every config that
 * didn't persist them, so one caller mutating what it read would rewrite the
 * defaults for the whole process — and for every config read afterwards.
 *
 * Every branch below therefore constructs a fresh object, including the
 * "nothing persisted" branch.
 */
function withTriggerDefaults(cfg: HarnessConfig): HarnessConfig {
  return {
    ...cfg,
    contextTrigger: {
      compact: { ...DEFAULT_CONTEXT_TRIGGER.compact, ...cfg.contextTrigger?.compact },
      clear: { ...DEFAULT_CONTEXT_TRIGGER.clear, ...cfg.contextTrigger?.clear }
    },
    orgTrigger: { ...DEFAULT_ORG_TRIGGER, ...cfg.orgTrigger },
    webhookTriggers: Array.isArray(cfg.webhookTriggers)
      ? cfg.webhookTriggers.map((t) => ({ ...t }))
      : []
  };
}

/** Set once `migrateTriggersV1` has run in THIS process. `writeConfig` reads
 *  before it writes, so without an in-memory latch the migration's own persist
 *  would re-enter `readConfig` and run the migration a second time before
 *  `triggersMigratedV1: true` ever reached disk. */
let triggersMigrationRan = false;

/**
 * Fold the pre-Triggers config shape forward, exactly once per install.
 *
 * Runs from `readConfig`, so it is complete before any consumer can observe the
 * config — there is no boot ordering to get wrong and no window in which half
 * the app sees the old shape. Two things move:
 *
 *   1. The single legacy webhook (`webhookEnabled`/`webhookSecret`) becomes one
 *      `WebhookTrigger` with the stable id `legacy`, so the caller that already
 *      holds that secret keeps working across the upgrade. Skipped when
 *      `webhookTriggers` is already populated — the user has moved on, and
 *      re-adding a synthesised entry would resurrect a revoked endpoint.
 *   2. The seeded `compact-maintenance` mission moves from the old 1h cadence to
 *      2h, but ONLY if it still reads exactly 1h. A user-chosen interval is a
 *      decision, not a stale default, and is left alone.
 *
 * Wrapped end-to-end in a try/catch: a config that is corrupt in some unrelated
 * way must still boot the app, and a migration is never worth a failed launch.
 */
function migrateTriggersV1(cfg: HarnessConfig): HarnessConfig {
  if (cfg.triggersMigratedV1 || triggersMigrationRan) return cfg;
  triggersMigrationRan = true;
  try {
    const next: HarnessConfig = { ...cfg, triggersMigratedV1: true };

    const legacySecret = typeof cfg.webhookSecret === 'string' ? cfg.webhookSecret.trim() : '';
    if (legacySecret && (cfg.webhookTriggers?.length ?? 0) === 0) {
      next.webhookTriggers = [
        {
          id: 'legacy',
          name: 'Default webhook',
          secret: legacySecret,
          enabled: cfg.webhookEnabled ?? false,
          mode: DEFAULT_TRIGGER_MODE,
          schema: DEFAULT_WEBHOOK_SCHEMA,
          createdAt: Date.now()
        }
      ];
    }

    const missions = Array.isArray(cfg.missions) ? cfg.missions : [];
    const stale = (m: ScheduledMission): boolean =>
      m?.id === COMPACT_MAINTENANCE_MISSION.id
      && m.intervalMs === LEGACY_COMPACT_MAINTENANCE_INTERVAL_MS;
    if (missions.some(stale)) {
      next.missions = missions.map((m) =>
        stale(m) ? { ...m, intervalMs: COMPACT_MAINTENANCE_MISSION.intervalMs } : m
      );
    }

    persistConfig(next);
    return next;
  } catch {
    // Leave the config exactly as read. The latch above stays set, so a failing
    // migration retries on the next launch rather than on every single read.
    return cfg;
  }
}

export function readConfig(): HarnessConfig {
  const p = configPath();
  // No file yet = a first run with nothing to migrate; the defaults ARE the
  // post-migration shape. Deliberately does not persist — a bare read must not
  // conjure a config.json before onboarding has written one.
  if (!existsSync(p)) return withTriggerDefaults({ ...DEFAULTS });
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeStoredHomes(migrateTriggersV1(withTriggerDefaults({ ...DEFAULTS, ...parsed })));
  } catch {
    return withTriggerDefaults({ ...DEFAULTS });
  }
}

/** (#140, the upgrade path) A config.json persisted BEFORE `writeConfig`
 *  learned to expand `~` still holds literal `~/…` strings in `harnessHome` /
 *  `recentHives`, and nothing rewrites the file until the next write — so the
 *  hive picker renders the raw `~` string and feeds it straight back into
 *  `config:changeHome`, which lands on `resolve()` → `<cwd>/~/…`, a real
 *  directory named "~". `normalizeHiveHome` only cleans values on the way IN;
 *  this cleans them on the way OUT, so no consumer can see a `~` path
 *  regardless of the file's vintage. Expanded duplicates collapse (a stale
 *  "~/X" next to its absolute twin becomes one entry). */
function normalizeStoredHomes(cfg: HarnessConfig): HarnessConfig {
  if (typeof cfg.harnessHome === 'string' && cfg.harnessHome.trim()) {
    cfg.harnessHome = expandTilde(cfg.harnessHome);
  }
  if (Array.isArray(cfg.recentHives)) {
    const seen = new Set<string>();
    cfg.recentHives = cfg.recentHives
      .filter((h): h is string => typeof h === 'string' && !!h.trim())
      .map((h) => expandTilde(h))
      .filter((h) => (seen.has(h) ? false : (seen.add(h), true)));
  }
  return cfg;
}

/** Announces every saved setting, so a screen showing one can update.
 *
 *  Settings, Slack, voice and notifications each save by their own route, and
 *  all of them end up writing the file below — so one subscription here covers
 *  every setting rather than the ones anybody remembered to wire up. */
type ConfigWriteListener = (next: HarnessConfig) => void;
const configWriteListeners = new Set<ConfigWriteListener>();

export function onConfigWritten(listener: ConfigWriteListener): () => void {
  configWriteListeners.add(listener);
  return () => { configWriteListeners.delete(listener); };
}

/** The copy kept of a config.json that could not be read, and the bytes it holds. */
let keptCopy: { path: string; raw: string } | null = null;

/** A config.json that exists but does not parse reads as the defaults, so the
 *  next save would write over the owner's settings for good (issue 98). Keep a
 *  copy beside it first, so it can be repaired; the app goes on working. If the
 *  copy cannot be made, the save fails rather than lose the file. Returns the
 *  copy's path, or null when the file is missing or readable. */
function keepUnreadableConfig(p: string): string | null {
  let raw: string;
  try { raw = readFileSync(p, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try { JSON.parse(raw); return null; } catch { /* damaged: keep it below */ }
  if (keptCopy?.raw === raw) return keptCopy.path;
  const copy = `${p}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(p, copy);
  keptCopy = { path: copy, raw };
  console.warn(`[config] config.json could not be read; kept a copy at ${copy}`);
  return copy;
}

/** Where the copy of an unreadable config.json is kept, making it now if need
 *  be, so setup can tell the owner why it starts again (issue 98). Null when
 *  the file is missing or readable, or the copy could not be made. */
export function damagedConfigCopy(): string | null {
  try { return keepUnreadableConfig(configPath()); } catch { return null; }
}

function persistConfig(next: HarnessConfig): HarnessConfig {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  keepUnreadableConfig(p);
  writeFileAtomic(p, JSON.stringify(next, null, 2));
  // Saving one setting stores only that setting, so fill the rest back in first:
  // subscribers must see the same complete config a read gives them, never a
  // half-filled one. Skip the migration — it saves in its own right, and has
  // already run against what this change was built on.
  const view = normalizeStoredHomes(withTriggerDefaults({ ...DEFAULTS, ...next }));
  // The change is already saved, so one failed subscriber must not fail the save
  // for its caller, nor stop the subscribers after it.
  for (const listener of configWriteListeners) {
    try { listener(view); } catch { /* a broken listener is not a failed save */ }
  }
  return next;
}

export function writeConfig(patch: Partial<HarnessConfig>): HarnessConfig {
  const current = readConfig();
  const next: HarnessConfig = { ...current, ...patch };
  // Project INGESTION — a registered repo is typed by hand ("~/dev/foo") as often
  // as it is picked from the folder dialog. Expand `~` here so the persisted list
  // (and therefore every agent's default cwd) is ABSOLUTE; Node's fs/spawn treat
  // `~` as a literal directory name and the spawn dies with `cwd does not exist`.
  if (Array.isArray(patch.registeredRepos)) {
    const seen = new Set<string>();
    next.registeredRepos = patch.registeredRepos
      .map((r) => expandTilde(r))
      .filter((r) => r && !seen.has(r) && (seen.add(r), true));
  }
  // The HIVE HOME needs the exact same treatment as registeredRepos above, and for
  // years it did not get it (#140). Onboarding SUGGESTS `~/HarnessAgents` and the
  // field is free text, so the common path — accept the default, press Finish —
  // persisted a literal `~`. The first thing the finish step does is create the
  // directory, and Node's mkdir has no idea what `~` means: it tried to make a
  // folder actually named "~", which fails as
  //   ENOENT: no such file or directory, mkdir '~/HarnessAgents'
  // and left the wizard wedged on its last step with no way forward. Expand BEFORE
  // the value is persisted or copied into recentHives, so every downstream reader
  // (mkdir, the hive root, the launch picker) sees one absolute path.
  if (typeof patch.harnessHome === 'string' && patch.harnessHome) {
    const { home, recentHives } = normalizeHiveHome(patch.harnessHome, current.recentHives ?? []);
    next.harnessHome = home;
    next.recentHives = recentHives;
  }
  return persistConfig(next);
}

/** Set or clear one agent's token ceiling against the latest config on disk.
 *
 * Renderer config objects are snapshots. Replacing `agentTokenCaps` from one of
 * those snapshots loses caps written since the snapshot was read (most visibly
 * while reviewing a batch of imported hires). Keep the read-modify-write in the
 * synchronous main process so each call merges with the result of the previous
 * one before returning the updated config to the renderer. */
export function setAgentTokenCap(agentId: unknown, tokenCap: unknown): HarnessConfig {
  if (typeof agentId !== 'string' || agentId.trim().length === 0) {
    throw new Error('invalid agent token cap');
  }
  if (
    tokenCap !== undefined
    && (
      typeof tokenCap !== 'number'
      || !Number.isInteger(tokenCap)
      || tokenCap <= 0
      || tokenCap > MAX_AGENT_TOKEN_CAP
    )
  ) throw new Error('invalid agent token cap');

  const current = readConfig();
  const agentTokenCaps = { ...(current.agentTokenCaps ?? {}) };
  if (tokenCap === undefined) delete agentTokenCaps[agentId];
  else agentTokenCaps[agentId] = tokenCap;
  return persistConfig({
    ...current,
    agentTokenCaps
  });
}

/** Wipe the persisted config back to first-run defaults so the app boots into
 *  onboarding again. Used by the "reset & start over" flow. */
export function resetConfig(): HarnessConfig {
  // Saved like any other change, so a reset announces itself too.
  persistConfig({ ...DEFAULTS });
  // Drop the migration latch too: the file on disk is back to `triggersMigratedV1:
  // false`, and a latch left set would keep the flag from ever being written again
  // in this process. The migration itself is a no-op on defaults either way.
  triggersMigrationRan = false;
  return withTriggerDefaults({ ...DEFAULTS });
}

/** Model ids by tier (Lane A #6.4). Kept in sync with the claude list in
 *  src/shared/modelCatalog.json, which `agentModels()` in
 *  src/renderer/src/store/config.ts reads. */
const MODEL_GOD = 'claude-opus-5-5';                  // orchestration — highest capability
const MODEL_WORKER = 'claude-sonnet-4-6';             // general execution
const MODEL_HELPER = 'claude-haiku-4-5-20251001';     // narrow, cheap helpers

/** Minimal structural shape for tiering — a subset of AgentMeta so config.ts
 *  stays free of a hive.ts import. */
export interface RoleHint {
  isGod?: boolean;
  role?: string;
  capabilities?: string[];
}

/** Default model for an agent given its role (Lane A #6.4): Opus for the god,
 *  Haiku for narrow helpers (triage / routing / verification / formatting),
 *  Sonnet for general workers. Returns a model id (matching the catalog) or
 *  undefined to fall back to the CLI default. This is only a DEFAULT — an
 *  explicit per-agent model selection always wins. */
export function modelForRole(
  meta: RoleHint,
  config?: Pick<HarnessConfig, 'godProvider' | 'godModel'>
): string | undefined {
  if (meta.isGod) {
    // GOD engine is selectable: an explicit godModel wins, else the chosen
    // provider's recommended orchestrator model, else the legacy Opus default.
    const preset = providerPreset(config?.godProvider ?? 'claude');
    return config?.godModel ?? preset.recommendedOrchestratorModel ?? MODEL_GOD;
  }
  const hay = `${meta.role ?? ''} ${(meta.capabilities ?? []).join(' ')}`.toLowerCase();
  if (/\b(triage|rout|verif|lint|format|summar|classif|label)/.test(hay)) return MODEL_HELPER;
  return MODEL_WORKER;
}

/** Ensure harnessHome exists on disk. Expands `~` first — the onboarding wizard
 *  lets the user type the path, and mkdir treats a literal `~` as a plain
 *  directory name (issue #140's `ENOENT: mkdir '~/HarnessAgents'`). */
export function ensureHarnessHome(path: string): { ok: boolean; error?: string } {
  try {
    // Expand HERE too, not only at the config write (#140). This runs FIRST —
    // onboarding calls it before updateConfig — so normalizing only at the write
    // boundary left the actual mkdir still receiving a literal `~`. Depending on
    // the process cwd that either fails outright or, worse, quietly succeeds by
    // creating a directory genuinely named "~" somewhere nobody will look, and
    // the hive then lives at a path the user cannot find. This is the
    // "defense-in-depth at the consumers" the expandTilde doc calls for: the
    // ingestion point normalizes, and the consumer refuses to trust that it did.
    mkdirSync(expandTilde(path), { recursive: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function ensureClaudeGlobalPermissions(home: string): void {
  const dir = join(home, '.claude');
  const p = join(dir, 'settings.json');
  try {
    let s: Record<string, unknown> = {};
    if (existsSync(p)) {
      const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      s = parsed as Record<string, unknown>;
    }
    if (s.skipDangerousModePermissionPrompt !== true || s.skipAutoPermissionPrompt !== true) {
      s.skipDangerousModePermissionPrompt = true;
      s.skipAutoPermissionPrompt = true;
      mkdirSync(dir, { recursive: true });
      writeFileSync(p, JSON.stringify(s, null, 2), 'utf8');
    }
  } catch (error) {
    console.warn(
      `[config] Could not safely update Claude config at ${p}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

type ClaudeProjectConfig = Record<string, unknown> & { hasTrustDialogAccepted?: boolean };
type ClaudeConfig = Record<string, unknown> & { projects?: Record<string, ClaudeProjectConfig> };

/** Read `~/.claude.json`, change it, and write it back only when `change` says
 *  it changed something. A file that is not a JSON object is left alone.
 *  True when the file now holds the change (written, or already there). */
function updateClaudeJson(home: string, change: (c: ClaudeConfig) => boolean): boolean {
  const p = join(home, '.claude.json');
  // Claude Code writes this file too. Write a copy beside it and swap it in, so
  // a crash never leaves it half written, and start again (up to three times)
  // when Claude changed it between our read and our write, so its edit is kept.
  // On Windows the swap is refused while something else has the file open
  // (antivirus, backup or sync tools); that also starts again from the read.
  const stamp = (): string => { try { const st = statSync(p); return `${st.mtimeMs}:${st.size}`; } catch { return 'none'; } };
  const ATTEMPTS = 3;
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const before = stamp();
      let c: ClaudeConfig = {};
      let mode = 0o600;
      if (existsSync(p)) {
        mode = statSync(p).mode & 0o777;
        const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
        c = parsed as ClaudeConfig;
      }
      if (!change(c)) return true;
      const tmp = `${p}.dbm-${process.pid}-${attempt}.tmp`;
      writeFileSync(tmp, JSON.stringify(c, null, 2), { encoding: 'utf8', mode });
      if (stamp() !== before) { rmSync(tmp, { force: true }); continue; }
      try {
        renameSync(tmp, p);
      } catch (e) {
        rmSync(tmp, { force: true });
        if (!isHeldRename(e) || attempt === ATTEMPTS - 1) throw e;
        sleepSync(RENAME_RETRY_MS[attempt]);
        continue;
      }
      return true;
    }
    console.warn(`[config] Claude config at ${p} kept changing; left it for the next start.`);
    return false;
  } catch (error) {
    console.warn(
      `[config] Could not safely update Claude config at ${p}:`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/** Claude Code's first run opens on a welcome screen (text style, then sign in)
 *  that waits in the agent's terminal, which the owner never sees. Sign in now
 *  happens in Get Michael ready, so the welcome is marked done. Only ever set,
 *  never cleared, and left alone when already done. */
function markClaudeOnboarded(c: ClaudeConfig): boolean {
  if (c.hasCompletedOnboarding === true) return false;
  c.hasCompletedOnboarding = true;
  return true;
}

/** The key Claude Code files a folder under in ~/.claude.json "projects". On
 *  Windows it turns backslashes into forward slashes ("C:/Users/Ann/Office")
 *  and looks only that up, so a folder trusted as "C:\Users\Ann\Office" still
 *  stops the agent on the trust question and it exits (seen live 2026-10-09). */
export function claudeProjectKey(folder: string, platform: string = process.platform): string {
  return platform === 'win32' ? folder.replaceAll('\\', '/') : folder;
}

/** Claude Code looks a folder up by its real name on disk. On a Mac a folder
 *  typed as "SunRiseBakery" opens "SunriseBakery" too, but only the real name
 *  counts as trusted, so trust that as well; otherwise the agent stops on the
 *  trust question (seen live 2026-09-25). */
function trustClaudeFolder(c: ClaudeConfig, cwd: string): boolean {
  let real = cwd;
  try { real = realpathSync.native(cwd); } catch { /* folder not there yet */ }
  let changed = false;
  // The folder as typed and as Claude Code files it: an older Claude that still
  // looks the raw Windows path up keeps working too.
  for (const key of new Set([cwd, real].flatMap((p) => [p, claudeProjectKey(p)]))) {
    if (c.projects?.[key]?.hasTrustDialogAccepted === true) continue;
    c.projects = c.projects ?? {};
    c.projects[key] = { ...(c.projects[key] ?? {}), hasTrustDialogAccepted: true };
    changed = true;
  }
  return changed;
}

/** Claude Code asks, in the agent's terminal, whether to use an
 *  ANTHROPIC_API_KEY it finds in the environment. The owner already chose that
 *  key in Get Michael ready, so it is approved up front: Claude Code records
 *  approvals as the key's last 20 characters. */
function approveClaudeKeyIn(c: ClaudeConfig, key: string): boolean {
  const tail = key.trim().slice(-20);
  if (!tail) return false;
  const r = (c.customApiKeyResponses && typeof c.customApiKeyResponses === 'object' && !Array.isArray(c.customApiKeyResponses)
    ? c.customApiKeyResponses : {}) as { approved?: unknown; rejected?: unknown };
  const approved = Array.isArray(r.approved) ? r.approved.filter((x): x is string => typeof x === 'string') : [];
  const rejected = Array.isArray(r.rejected) ? r.rejected.filter((x): x is string => typeof x === 'string') : [];
  if (approved.includes(tail) && !rejected.includes(tail)) return false;
  c.customApiKeyResponses = { ...r, approved: approved.includes(tail) ? approved : [...approved, tail], rejected: rejected.filter((x) => x !== tail) };
  return true;
}

/** True when ~/.claude.json now approves the key (a half written file read
 *  while Claude saves it is false, so the caller tries again later). */
export function approveClaudeApiKey(key: string, home: string = homedir()): boolean {
  if (!key.trim()) return false;
  return updateClaudeJson(home, (c) => approveClaudeKeyIn(c, key));
}

/** Idempotently pre-accept Claude Code's first-run prompts so agents spawned with
 *  `--permission-mode bypassPermissions` start cleanly. Without this, a fresh
 *  install shows an interactive "WARNING: Bypass Permissions mode … 1. No, exit /
 *  2. Yes, I accept" prompt that the PTY can't answer in time, so the agent exits
 *  code 1 on its own (reported by multiple users).
 *
 *  Two separate gates, written only when they aren't already satisfied (so we
 *  rarely touch files a running `claude` also writes):
 *   1. `~/.claude/settings.json` → `skipDangerousModePermissionPrompt` +
 *      `skipAutoPermissionPrompt` — these gate the bypass-mode warning (global).
 *   2. `~/.claude.json`, in one pass: `projects[claudeProjectKey(cwd)].hasTrustDialogAccepted`
 *      (forward slashes on Windows, plus the folder as typed and its real name on disk; the
 *      per-folder "do you trust the files in this folder?" dialog),
 *      `hasCompletedOnboarding` (the first-run welcome), and with
 *      `opts.approveKey` the chosen API key in `customApiKeyResponses.approved`.
 *
 *  Each file is an independent best-effort boundary: unsafe existing contents
 *  are preserved without preventing the other file from being handled safely. */
export function ensureClaudePermissionsAccepted(cwd?: string, opts: { approveKey?: string } = {}): void {
  let home: string;
  try { home = homedir(); } catch { return; }
  if (!home) return;

  ensureClaudeGlobalPermissions(home);
  // One read and at most one write of ~/.claude.json per start: it holds every
  // project's history and runs to megabytes for a busy owner.
  updateClaudeJson(home, (c) => {
    let changed = markClaudeOnboarded(c);
    if (cwd && trustClaudeFolder(c, cwd)) changed = true;
    if (opts.approveKey && approveClaudeKeyIn(c, opts.approveKey)) changed = true;
    return changed;
  });
}
