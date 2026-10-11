import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { OfficeRecord } from '../shared/officeRecord';
import type { MailboxRecord, AgentCapabilities, MailProvider, MailServer } from '../shared/mailboxes';
import type { ClaudeConnectorsState } from '../shared/claudeConnectors';
import type { ScheduledMission, ScheduleRequest } from '../shared/missions';
import type { LinkedProposal, MailProposal, ProposalDecision, StandingApproval } from '../shared/mailProposals';
import type { OwnerDock } from '../shared/ownerRequests';
import type { AgentProvider } from '../shared/agentProvider';
import type { EngineSetupStatus } from '../shared/engineSetup';
import type { HireManifest } from '../shared/hire';
export type { HireManifest } from '../shared/hire';
import type { IntegrationRecord, IntegrationTemplate } from '../shared/integrations';
export type { IntegrationRecord, IntegrationTemplate } from '../shared/integrations';
import type { UpdateStatus } from '../shared/updateState';
import type { CliUpdateStatus } from '../shared/cliUpdate';
export type { UpdateStatus } from '../shared/updateState';
import type { ToolStatus } from '../shared/toolCatalog';
export type { ToolStatus } from '../shared/toolCatalog';
import type { HeroPayload } from '../shared/heroPayload';
export type { HeroPayload } from '../shared/heroPayload';
import type { ModelCatalog } from '../shared/modelCatalogPayload';
export type { ModelCatalog, CatalogModel } from '../shared/modelCatalogPayload';
import type { HookEvent } from '../shared/hookEvents';
export type { HookEvent } from '../shared/hookEvents';
import type { LocalSkill, CatalogSkill } from '../main/skills';
export type { LocalSkill, CatalogSkill } from '../main/skills';
import type { OfficePack, PackOrigin } from '../shared/officePack';
export type { OfficePack, PackOrigin } from '../shared/officePack';
import type {
  ContextRule, ContextTriggerConfig, OrgTriggerConfig, TriggerHistoryEntry, WebhookTrigger
} from '../shared/triggers';
export type {
  ContextRule, ContextTriggerConfig, OrgTriggerConfig, TriggerHistoryEntry, WebhookTrigger
} from '../shared/triggers';

/** Renderer-visible integration record: the secretRef handle is redacted to a
 *  presence boolean. Matches main `integrations.listRecordsRedacted()` — the
 *  write-only secret contract (spec §2): a secret value is NEVER returned over IPC. */
export type IntegrationRecordView = Omit<IntegrationRecord, 'secretRef'> & { hasSecret: boolean };

// Injected at build time from package.json (see electron.vite.config.ts).
declare const __APP_VERSION__: string;

/** The renderer's roster as mirrored to `<harnessHome>/roster.json`. The agent
 *  entries stay `unknown` here for the same reason main leaves them opaque: the
 *  store owns that shape, and repeating it in the bridge would mean editing two
 *  files every time an agent gains a field. */
export interface RosterSnapshot {
  version: 1;
  savedAt: string;
  agents: unknown[];
  archived: unknown[];
  restorable: unknown[];
  queues: Record<string, unknown[]>;
  selectedId: string | null;
}

export interface HiveAgentMeta {
  id: string;
  name: string;
  /** Which CLI this agent runs on (claude/codex/grok/antigravity/custom); defaults claude. */
  provider?: AgentProvider;
  role?: string;
  capabilities?: string[];
  cwd: string;
  isGod?: boolean;
  /** Michael's prep assistant — send-only; enriches prompts and forwards them. */
  isAssistant?: boolean;
}

export interface HiveMessage {
  id: string;
  conversation: string;
  in_reply_to: string | null;
  from: string;
  to: string;
  act: 'request' | 'inform' | 'propose' | 'query' | 'agree' | 'refuse' | 'done';
  subject: string;
  body: string;
  hops: number;
  requires_reply: boolean;
  needs_human: boolean;
  created_at: string;
}

/** A hive message reshaped for the voice read-layer (`hive:messages`). `subject`
 *  and `body` are REDACTED in the main process before crossing this boundary —
 *  the renderer never receives a raw body or a secret. Mirror of `VoiceMessage`
 *  in src/main/hive.ts. */
export interface VoiceMessage {
  id: string;
  conversation: string;
  from: string;
  to: string;
  act: HiveMessage['act'];
  subject: string;
  body: string;
  requires_reply: boolean;
  direction: 'inbox' | 'outbox';
  owner: string;
  archived: boolean;
  created_at: string;
}

export interface HiveRegistry {
  godId: string | null;
  /** `archived` agents have had their terminal closed — retained + flagged, not
   *  deleted; only live-PTY agents are 'active'. */
  agents: Record<string, HiveAgentMeta & {
    status: string;
    lastSeen: number;
    archived?: boolean;
    /** The owner closed this agent on purpose; its schedules were paused. */
    closedByOwner?: boolean;
    sessionId?: string;
  }>;
}

/** One row of the consolidated voice read-layer directory (`hive:agentDirectory`):
 *  everything the office-floor sidebar + telemetry know for an agent, joined into
 *  one PII-free record. Includes archived agents. */
export interface AgentDirectoryEntry {
  id: string;
  name: string;
  role: string;
  provider: string;
  /** Live model id (normalized), if any usage has been recorded — else null. */
  model: string | null;
  status: string;
  cwd: string | null;
  /** Whether `cwd` is an absolute, existing directory (spawn-usable). */
  cwdValid: boolean | null;
  archived: boolean;
  isGod: boolean;
  isAssistant: boolean;
  sessionId: string | null;
  /** Whether the agent has recorded non-trivial memory beyond the seed header. */
  hasMemory: boolean;
  inboxBacklog: number;
  breaker: string;
  tokens: number;
  /** Aggregate spend; carried for completeness — the voice layer speaks tokens. */
  usd: number;
  lastTool: string | null;
  lastActiveSecAgo: number | null;
  contextTokens: number | null;
  contextLimit: number | null;
  contextPct: number | null;
}

export interface AgentDirectory {
  godId: string | null;
  agents: AgentDirectoryEntry[];
}

/** One question→answer exchange with the human, recorded ON the task card. */
export interface HumanQA {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  dismissedAt?: string;
}

/** A card on the task kanban, persisted to hive/tasks.json. */
export interface HiveTask {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  status: 'todo' | 'doing' | 'waiting' | 'blocked' | 'done';
  /** Who a Waiting card waits on (Michael writes it). */
  waitingOn?: string;
  dependsOn: string[];
  priority: number;
  createdAt: string;
  /** First-class human feedback: god appends {q}, the harness UI fills {a};
   *  the full history stays on the card. */
  humanQA?: HumanQA[];
  /** Outcome summary used for the Slack done-notification. */
  result?: string;
  /** Origin thread for a Slack-sourced task (drives the done-summary reply). */
  slack?: { channel: string; thread_ts: string };
  /** SHA-256 of the capability token for a generic-webhook-sourced task (drives
   *  the GET status lookup; the raw token is never persisted). */
  webhook?: { tokenHash: string };
  /** Ended by the owner's decision, not finished work (card-lifecycle.md D2). */
  closedBy?: 'owner';
  closedAt?: string;
  closedReason?: string;
}

/** A message the router just delivered, with its resolved recipient ids. Drives
 *  the envelope-handoff animation on the office floor. `needsHuman` is always
 *  false since Michael's replies to the owner land in his conversation dock
 *  (docs/designs/michael-replies.md); kept so older floor code still reads it. */
export interface HiveRouteEvent {
  id: string;
  from: string;
  to: string;
  act: 'request' | 'inform' | 'propose' | 'query' | 'agree' | 'refuse' | 'done';
  subject: string;
  targets: string[];
  needsHuman: boolean;
}

/** A direct hive message addressed to a provider that cannot drain hive inbox.
 *  The renderer turns this into a queued terminal work order for that agent. */
export interface HiveTerminalHandoffEvent {
  id: string;
  from: string;
  to: string;
  act: 'request' | 'inform' | 'propose' | 'query' | 'agree' | 'refuse' | 'done';
  subject: string;
  body: string;
  requiresReply: boolean;
  createdAt: string;
}

export interface SpawnPtyOptions {
  id: string;
  cwd: string;
  command: string;
  /** Which CLI to spawn; usually inferred from `command` in the main process. */
  provider?: AgentProvider;
  args?: string[];
  cols?: number;
  rows?: number;
  /** When present, the agent is provisioned in the hive at spawn. */
  hive?: HiveAgentMeta;
  /** When true (and cwd is a git repo), spawn the agent in its own git worktree. */
  isolate?: boolean;
  /** When true, continue the agent's prior CLI session if one was recorded
   *  (provider-aware: Claude/Grok `--resume`, Antigravity `--conversation`). For
   *  Claude the main process looks up the session id from the hive registry and
   *  seeds its transcript into the cwd's project dir (#1 — restore on restart). */
  resume?: boolean;
  /** Fail before spawning when a requested resume cannot be attached. */
  requireResume?: boolean;
  /** Explicit Claude session id to resume (#2 — Add Agent "resume session"). The
   *  main process seeds that session's `.jsonl` into the target cwd's project dir
   *  (copying it from wherever it lives) and launches `claude --resume <id>`. */
  resumeSessionId?: string;
}

export interface PtyExit { exitCode: number; signal?: number | undefined }

/** A recurring schedule; the type lives in shared/missions.ts. */
export type { ScheduledMission, ScheduleRequest } from '../shared/missions';
export type { LinkedProposal, MailProposal, ProposalDecision, StandingApproval } from '../shared/mailProposals';
export type { OwnerDock, DockItem, DockQuestion, DockReply } from '../shared/ownerRequests';

/** Company knowledge config. Mirrors src/main/config.ts. */
export interface KnowledgeGraphConfig {
  enabled?: boolean;
  rootPath?: string;
}

/** Circuit-breaker thresholds (Lane A #6.6b). Mirrors src/main/config.ts. */
export interface CircuitBreakerConfig {
  enabled?: boolean;
  hardStop?: boolean;
  repeatedToolLimit?: number;
  errorStormLimit?: number;
  tokenVelocityPerMin?: number;
}

export interface HarnessConfig {
  onboardingComplete: boolean;
  /** Onboarding audience ('technical' | 'non-technical'). No longer asked during
   *  onboarding; still read by Settings. Mirrors src/main/config.ts. */
  audience?: 'technical' | 'non-technical';
  /** The Office Pack picked on the first onboarding screen, plus the business's
   *  own name and city. Mirrors src/main/config.ts. */
  businessType?: string;
  businessName?: string;
  businessCity?: string;
  /** Michael's folder: the business folder holding every team member's. */
  businessFolder?: string;
  /** Key facts about the business (src/shared/companyProfile.ts). */
  companyProfile?: import('../shared/companyProfile').CompanyProfile;
  /** Before 2026-09-25: the retired shared Office folder. */
  officeFolder?: string;
  /** The starter team picked during onboarding, each with the ABSOLUTE folder it
   *  works in (Decisions 44, 47). The running office starts agents from this. */
  businessTeam?: Array<{ agentId: string; folder: string }>;
  /** Set once the onboarding team has been started, so it is started once. */
  businessTeamStarted?: boolean;
  /** Team members that failed their first start, tried again (and only they)
   *  on each later launch until they start. */
  businessTeamRetry?: string[];
  /** Set once existing team members got today's Role description and Work
   *  style (the one-time rewrite, 2026-09-25). */
  instructionsRewritten?: boolean;
  /** Set once the pack's First task text was taken out of existing team
   *  members' Work styles (docs/designs/first-task-card.md, D1). */
  firstTasksRemoved?: boolean;
  /** Owner decisions on offered job description updates (shared/workStyleUpdates.ts). */
  workStyleUpdatesDecided?: Record<string, 'use' | 'keep'>;
  harnessHome: string | null;
  /** Recently-opened hive home folders (most-recent first). Mirrors src/main/config.ts. */
  recentHives?: string[];
  registeredRepos: string[];
  autoMode: boolean;
  defaultCommand: string;
  defaultModel?: string;
  /** Which provider+model powers the GOD orchestrator ("Michael"). Default
   *  'claude' / 'claude-opus-5-5'. Mirrors src/main/config.ts. */
  godProvider?: AgentProvider;
  godModel?: string;
  /** Per-server consent for the default MCP bundle, keyed by catalog id. Mirrors
   *  src/main/config.ts. */
  mcpDefaults?: { [id: string]: { enabled: boolean } };
  mailboxes?: MailboxRecord[];
  agentCapabilities?: { [agentId: string]: AgentCapabilities };
  /** The QuickBooks row's switch under Settings > Connections > Claude connectors.
   *  Off or absent refuses everyone. Mirrors src/main/config.ts. */
  quickbooksClaude?: boolean;
  /** Connectors on the owner's Claude account, as last read. Mirrors src/main/config.ts. */
  claudeConnectors?: ClaudeConnectorsState;
  /** The connectors the owner turned on, by key (QuickBooks: quickbooksClaude). */
  connectorsOn?: { [key: string]: boolean };
  /** Connector keys the owner has seen in Settings. */
  connectorsSeen?: string[];
  semanticMemory: boolean;
  embeddingModel: 'minilm' | 'embeddinggemma';
  missions?: ScheduledMission[];
  opsStandupSeeded?: boolean;
  heartbeatSeeded?: boolean;
  notifications?: boolean;
  /** Opt-in strong keep-alive (prevent-display-sleep). Mirrors main + renderer
   *  HarnessConfig so updateConfig({ strongKeepalive }) is typed across the bridge. */
  strongKeepalive?: boolean;
  /** @deprecated Ignored since 2026-10-02: updates are always checked. */
  autoUpdate?: boolean;
  /** Anonymous product analytics (see TELEMETRY.md). Ignored while
   *  COLLECT_USAGE_STATS (buildFeatures.ts) is false, as it is in this build.
   *  Mirrors main + renderer HarnessConfig. */
  telemetryEnabled?: boolean;
  slackEnabled?: boolean;
  slackSigningSecret?: string;
  slackBotToken?: string;
  slackChannelId?: string;
  slackPort?: number;
  slackProactivePosting?: boolean;
  webhookEnabled?: boolean;
  webhookSecret?: string;
  webhookPort?: number;
  /** Free Flow voice dictation — master flag (default off), user Groq key, model.
   *  Entry point B (hold-Option-to-talk) is handled in the renderer, no hotkey. */
  freeflowEnabled?: boolean;
  groqApiKey?: string;
  freeflowModel?: string;
  /** Realtime Michael voice loop — true ONLY while a session holds the mic
   *  (renderer session sets it at start()/stop()); the main mic permission gate
   *  reads it. Default off. */
  realtimeVoiceEnabled?: boolean;
  /** Realtime voice idle auto-disconnect (ms); default 180000 (3 min), 0 = never.
   *  Tuned in Settings → Realtime Michael; the cost cap stays the runaway guard. */
  realtimeIdleDisconnectMs?: number;
  costCapUsd?: number;
  costCapTokens?: number;
  agentTokenCaps?: Record<string, number>;
  autoDeliveryPausedAgents?: string[];
  maxTurns?: number;
  circuitBreaker?: CircuitBreakerConfig;
  /** Company knowledge (the Knowledge Graph store). Default ON. */
  knowledgeGraph?: KnowledgeGraphConfig;
  /** Terminal theme, mirrored into each agent's per-session Claude settings. */
  terminalTheme?: 'light' | 'dark';
  /** TV-show office themes feature flag (Settings picker + switch flow). Default OFF. */
  tvShowOffices?: boolean;
  /** Active office map/cast theme (honored only when tvShowOffices is on). */
  officeTheme?: 'office' | 'friends' | 'brooklyn99' | 'siliconvalley' | 'got' | 'hogwarts';
  /** Per-CLI-provider local/self-hosted base URL (Ollama/LM Studio/vLLM, …) for the
   *  OpenCode/Crush/pi/qwen engines; applied at spawn. API KEYS are NOT stored here —
   *  they live write-only in the secret broker. */
  providerBaseUrls?: Partial<Record<AgentProvider, string>>;
  /** Per-CLI-provider default model slug, used to pre-fill the model picker. */
  providerDefaultModels?: Partial<Record<AgentProvider, string>>;
}

export interface MemoryStatus {
  available: boolean;
  enabled: boolean;
  active: boolean;
  initialized: boolean;
  palacePath: string | null;
  model: 'minilm' | 'embeddinggemma';
  bin: string | null;
}

/** Enterprise Knowledge Graph — corpus status, one document, and a search hit. */
export interface KnowledgeStatus {
  enabled: boolean;
  root: string;
  docCount: number;
  chunkCount: number;
  byModality: Record<string, number>;
}
export interface KnowledgeDoc {
  id: string;
  title: string;
  source: string;
  modality: string;
  mime: string | null;
  origExt: string;
  bytes: number;
  tags: string[];
  caption: string | null;
  chunkCount: number;
  addedAt: string;
  extractor: string;
  truncated: boolean;
}
export interface KnowledgeHit {
  docId: string;
  title: string;
  source: string;
  modality: string;
  chunkIdx: number;
  score: number;
  snippet: string;
}
export interface KnowledgeIngestResult {
  ok: boolean;
  results: Array<{ ok: boolean; srcPath: string; docId?: string; chunkCount?: number; error?: string }>;
  error?: string;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  subject: string;
  author: string;
  time: number;
  refs: string[];
}
export interface GitStatusEntry { path: string; index: string; worktree: string }
export interface GitStatus { staged: GitStatusEntry[]; unstaged: GitStatusEntry[]; untracked: string[] }
/** A single file's two sides for a working-tree-vs-HEAD diff (see main git.getDiff). */
export interface GitDiff {
  ok: true;
  path: string;
  relPath: string;
  head: string;
  working: string;
  headExists: boolean;
  workingExists: boolean;
  isBinary: boolean;
}

/** v0.3.4 git visualization — mirrors src/main/git.ts GitCommit / GitCommitFile. */
export interface GitCommitRow {
  sha: string;
  shortSha: string;
  parents: string[];
  subject: string;
  author: string;
  time: number;
  refs: string[];
}
export interface GitFileChange {
  path: string;
  status: string;
  oldPath?: string;
}

/** Real token usage + estimated USD cost summed from an agent's Claude Code
 *  transcripts under ~/.claude/projects. Reconciler/fallback path — now priced
 *  PER MODEL (not Sonnet-for-everyone). The live path uses AgentUsageSample. */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  /** Most-recently-seen model id (normalized), if any priced record was found. */
  model?: string;
}

/** Live cumulative cost/token snapshot from the OTel collector (the locked
 *  cross-lane seam). PII-free by construction. Mirrors telemetry.ts. */
export interface AgentUsageSample {
  agentId: string;
  sessionId: string;
  ts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  model: string;
  usd: number;
}

/** One tool invocation for the per-agent span waterfall (#7B.2). Ephemeral. */
export interface ToolSpan {
  agentId: string;
  sessionId: string;
  ts: number;
  tool: string;
  success: boolean;
  durationMs: number;
  decision?: 'accept' | 'reject';
  error?: string;
}

/** Power-resume signal (mirrors the emitter in src/main). Fired after the Mac
 *  wakes from sleep / unlocks: `dead` lists PTY ids that were live before sleep
 *  but emitted nothing after resume (wedged terminals); `total` is how many were
 *  checked. The renderer auto-respawns exactly the `dead` ids. */
export interface PowerResumeEvent {
  reason: string;
  awayMs: number | null;
  dead: string[];
  total: number;
}

/** Closing-time progress event (mirrors src/main/closingTime.ts). */
export interface ClosingTimeEvent {
  phase: 'started' | 'progress' | 'complete' | 'timeout' | 'cancelled';
  /** Workers that have ACKed so far / every worker closing time started
   *  with, including any later closed without or whose terminal ended (see
   *  `waiting` for who is still waited on). */
  acked: number;
  total: number;
  /** Team members who confirmed. */
  confirmed: string[];
  /** Team members still being waited on. */
  waiting: string[];
  /** Team members the owner chose to close without. */
  excused: string[];
  /** Michael's id, for his own row. */
  godId: string;
  /** False once Michael's terminal has ended. */
  godLive: boolean;
  /** The app reopens itself after closing. */
  relaunch: boolean;
}

/** Per-agent operator-control state (#7C.1–7C.3). */
export interface AgentControlSnapshot {
  paused: boolean;
  halted: boolean;
  autoDeliveryPaused: boolean;
  gatedTools: string[];
  pendingSteers: number;
}

/** Circuit-breaker state (Lane A #6 → this lane's avatars/meter). */
export interface BreakerState {
  agentId: string;
  level: 'healthy' | 'steering' | 'constrained' | 'stopped';
  reason: string;
  ts: number;
}

/** Live telemetry push payload (channel `telemetry:event`). */
export type TelemetryEvent =
  | { kind: 'usage'; sample: AgentUsageSample }
  | { kind: 'tool_result'; span: ToolSpan }
  | { kind: 'api_error'; agentId: string; sessionId: string; ts: number; error: string };

/** Cold-start backfill from the collector. */
export interface TelemetrySnapshot {
  usage: AgentUsageSample[];
  spans: Record<string, ToolSpan[]>;
}

/** One captured user prompt from the SQLite command_history table. */
export interface CommandHistoryEntry {
  id: number;
  agentId: string;
  cwd: string | null;
  text: string;
  ts: number;
}

/** A GitHub issue, normalized for the renderer (labels/assignees flattened to names). */
export interface GHIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  assignees: string[];
}

/** A CI (GitHub Actions) workflow run, normalized for the renderer. */
export interface CIRun {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

/** One live god-triggered ephemeral worker, as shown in the Workers tab. */
export interface WorkerSnapshot {
  workerId: string;
  reqId: string;
  name: string;
  baseBranch: string;
  spawnedAt: number;
  ageMs: number;
  idleMs: number | null;        // null = PTY already gone
  tokensUsed: number;
  tokenCap: number | null;      // effective cap; null = unlimited (the default)
  hasSlack: boolean;
  releasing: boolean;
  status: 'releasing' | 'working';
}
/** A worker worktree preserved at teardown, awaiting integration + GC. */
export interface PreservedWorktreeSnapshot {
  workerId: string;
  wtPath: string;
  baseBranch: string;
  preservedAt: number;
}

const api = {
  version: __APP_VERSION__,

  // ─── Analytics ───────────────────────────────────────────────────────────
  /** Count ONE human-sent message (TELEMETRY.md → `message_sent`). Carries a
   *  surface name and nothing else — no text, no length, no agent id — and main
   *  accepts only 'terminal' and 'composer' here (steer and hive are counted in
   *  main, at their own handlers). Never awaited by callers and never allowed to
   *  throw: a telemetry hiccup must not break sending a message. */
  trackMessageSent: (surface: 'terminal' | 'composer'): Promise<void> =>
    ipcRenderer.invoke('analytics:messageSent', surface).then(() => undefined, () => undefined),

  // ─── Office Packs ────────────────────────────────────────────────────────
  /** The business types onboarding offers, each with its core agents already
   *  merged in. `problems` names any pack that could not be read — the list is
   *  never empty because of one bad file, so the first screen always has
   *  something to click. */
  packsList: (): Promise<{
    packs: Array<{ pack: OfficePack; origin: PackOrigin }>;
    problems: Array<{ file: string; reason: string }>;
    core?: OfficePack;
  }> => ipcRenderer.invoke('packs:list'),

  // ─── Agent folders (Decisions 44, 45) ───────────────────────────────────
  /** Default `~/Documents/<Business>/<Folder>` paths for the team screen, or
   *  under `root` when the owner picked Michael's folder. Creates nothing. */
  foldersSuggest: (businessName: string, folders: string[], root?: string): Promise<{
    home: string; root: string; byFolder: Record<string, string>; rootRefused?: boolean;
  }> => ipcRenderer.invoke('folders:suggest', { businessName, folders, root }),
  /** Which of `names` already exist as folders under `root`. Reads only. */
  foldersExist: (root: string, names: string[]): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('folders:exists', { root, names }),
  /** The hire wizard's distinct job check against every teammate (design D6). */
  hireCheckDistinct: (
    job: { name: string; title: string; routing: string; workStyle?: string; mailbox?: string },
    team: Array<{ name: string; title: string; routing: string; workStyle?: string; mailbox?: string }>,
    requestId?: string
  ): Promise<{ distinct: boolean; overlapsWith: string[]; why: string; suggestion?: string; source: 'ai' | 'rules' }> =>
    ipcRenderer.invoke('hire:checkDistinct', { job, team, requestId }),
  /** Stop a check the owner moved past (another job picked, or back a step). */
  hireCheckStop: (requestId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('hire:checkStop', requestId),
  /** "Suggest me": a first work style for the owner to edit; empty when it can't
   *  run. With a `requestId`, the draft streams to onWorkStyleSuggestText. */
  workStyleSuggest: (req: {
    requestId?: string;
    ctx: { name: string; title?: string; business?: { name?: string; city?: string }; manager?: string };
    handles: string;
    businessType?: string;
    team: Array<{ name: string; title?: string; handles?: string }>;
  }): Promise<{ text: string; cancelled?: boolean }> => ipcRenderer.invoke('workStyle:suggest', req),
  /** The draft as it is written, for the run with this request id. */
  onWorkStyleSuggestText: (cb: (e: { requestId: string; text: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { requestId: string; text: string }) => cb(payload);
    ipcRenderer.on('workStyle:suggestText', listener);
    return () => ipcRenderer.removeListener('workStyle:suggestText', listener);
  },
  /** Stop a suggestion that is still being written. */
  workStyleSuggestStop: (requestId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('workStyle:suggestStop', requestId),
  /** Rewrite a work style: the agent's instructions as the owner's plain
   *  description, or the owner's description as instructions. */
  workStyleConvert: (req: {
    to: 'plain' | 'instructions';
    text: string;
    ctx: { name: string; title?: string; business?: { name?: string; city?: string }; manager?: string };
    previous?: string;
  }): Promise<{ text: string; source: 'ai' | 'rules' }> => ipcRenderer.invoke('workStyle:convert', req),
  /** Check a job's focus area against the Work style and the agent's other
   *  jobs (schedule-focus-areas.md, FA3). `checked: false` when it couldn't run. */
  workStyleCheckFocus: (req: {
    agentId?: string; name: string; job: string; focus: string; workStyle: string; others: Array<{ job: string; focus: string }>;
  }): Promise<{ checked: boolean; conflict?: string }> => ipcRenderer.invoke('workStyle:checkFocus', req),
  /** Create each folder if it's missing. Never touches an existing folder's contents. */
  foldersEnsure: (paths: string[]): Promise<Array<
    { ok: true; path: string; created: boolean } | { ok: false; path: string; reason: string }
  >> => ipcRenderer.invoke('folders:ensure', paths),

  // ─── PTY ─────────────────────────────────────────────────────────────────
  /** `cwd` in the result is the TILDE-EXPANDED absolute path main actually spawned
   *  into — the renderer stores that, not the raw `~/…` the user typed. */
  spawnPty: (opts: SpawnPtyOptions): Promise<{ ok: boolean; error?: string; cwd?: string; worktreePath?: string; resumeNotFound?: boolean; resumed?: boolean; seedPrompt?: string }> =>
    ipcRenderer.invoke('pty:spawn', opts),
  writePty: (id: string, data: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pty:write', id, data),
  resizePty: (id: string, cols: number, rows: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),
  redrawPty: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pty:redraw', id),
  /** A terminal still drawn past its box after a fit: sizes only, to the office log. */
  logTerminalOverflow: (info: Record<string, number | string>): void =>
    ipcRenderer.send('terminal:overflow', info),
  killPty: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pty:kill', id),
  listPtys: (): Promise<Array<{
    id: string;
    cwd: string;
    command: string;
    pid: number;
    lastOutputAt: number;
    hasOutput: boolean;
  }>> =>
    ipcRenderer.invoke('pty:list'),
  /** Resolve a Claude session id to the cwd it originally ran in (Add Agent
   *  resume auto-fill), or null if the id is invalid/unknown. */
  resolveSessionCwd: (sessionId: string): Promise<string | null> =>
    ipcRenderer.invoke('session:resolveCwd', sessionId),
  onPtyData: (id: string, cb: (data: string) => void): (() => void) => {
    const channel = `pty:data:${id}`;
    const listener = (_e: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onPtyExit: (id: string, cb: (info: PtyExit) => void): (() => void) => {
    const channel = `pty:exit:${id}`;
    const listener = (_e: IpcRendererEvent, info: PtyExit) => cb(info);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  /** Fires when an agent is auto restart-and-continued into this SAME pty after a
   *  first-time engine-CLI install. The terminal should re-arm in place (clear the
   *  "process exited" line + re-enable input) so the relaunched CLI paints clean. */
  onPtyRelaunch: (id: string, cb: () => void): (() => void) => {
    const channel = `pty:relaunch:${id}`;
    const listener = () => cb();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // ─── Dialog ──────────────────────────────────────────────────────────────
  chooseFolder: (): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('dialog:chooseFolder'),

  // ─── Terminal.app ────────────────────────────────────────────────────────
  openTerminalAt: (cwd: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:openAtFolder', cwd),

  // ─── Clipboard ─────────────────────────────────────────────────────────────
  copyToClipboard: (text: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('app:copyToClipboard', text),
  /** Read the system clipboard as plain text ('' when empty/unreadable). */
  readClipboard: (): Promise<string> =>
    ipcRenderer.invoke('app:readClipboard'),
  /** Clipboard text, read SYNCHRONOUSLY. Only for the terminal's paste shortcut,
   *  where an async read loses a race against dictation tools that restore the
   *  previous clipboard right after sending the paste key.
   *
   *  TRADEOFF, stated plainly because sendSync blocks the renderer until main
   *  answers: this app has a history of main-thread stalls (iCloud-evicted files
   *  wedging a spawnSync git call), and during such a stall this call freezes the
   *  paste keystroke rather than merely delaying it. Accepted because a clipboard
   *  read is a memory lookup with no I/O, and because the async alternative is
   *  measurably WRONG — it pastes the user's previous clipboard. Do not reach for
   *  sendSync elsewhere on this reasoning; it is justified by the race, not by
   *  convenience. */
  readClipboardSync: (): string => {
    try { return ipcRenderer.sendSync('app:readClipboardSync') ?? ''; } catch { return ''; }
  },

  // ─── Config ──────────────────────────────────────────────────────────────
  getConfig: (): Promise<HarnessConfig> =>
    ipcRenderer.invoke('config:get'),
  updateConfig: (patch: Partial<HarnessConfig>): Promise<HarnessConfig> =>
    ipcRenderer.invoke('config:update', patch),
  /** Set or clear one per-agent token ceiling against main's latest config. */
  setAgentTokenCap: (agentId: string, tokenCap?: number): Promise<HarnessConfig> =>
    ipcRenderer.invoke('config:setAgentTokenCap', agentId, tokenCap),
  ensureHarnessHome: (path: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('config:ensureHome', path),
  /** Change the harness home folder. 'move' copies the existing hive + palace
   *  into the new folder (old kept as a safety net); 'fresh' just re-points and
   *  bootstraps an empty home. On success the app relaunches (never resolves);
   *  on failure (e.g. copy error) returns { ok: false, error }. */
  changeHome: (newHome: string, mode: 'move' | 'fresh'): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('config:changeHome', { newHome, mode }),
  /** Whether a folder (default: the current home) exists and holds an office. */
  homeStatus: (path?: string): Promise<{ path: string | null; exists: boolean; hasOffice: boolean }> =>
    ipcRenderer.invoke('config:homeStatus', path),
  /** What is in a folder: an office, and if so its business and team, read from
   *  its office.json or, for an older office, its hive registry. Setup uses it
   *  to continue an existing office by folder, never by business name. */
  officeFind: (path: string): Promise<{
    path: string | null;
    hasOffice: boolean;
    record: OfficeRecord | null;
    source: 'file' | 'registry' | null;
  }> => ipcRenderer.invoke('office:find', path),
  /** Start an empty office at the current home path after it went missing.
   *  Relaunches on success (never resolves); returns { ok: false } on failure. */
  startOverHere: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('config:startOverHere'),

  // ─── Filesystem (sandboxed to cwd) ───────────────────────────────────────
  listDir: (root: string, rel: string): Promise<
    { ok: true; entries: DirEntry[]; path: string } | { ok: false; error: string }
  > => ipcRenderer.invoke('fs:listDir', root, rel),
  readFile: (root: string, rel: string): Promise<
    { ok: true; content: string; path: string; size: number } | { ok: false; error: string }
  > => ipcRenderer.invoke('fs:readFile', root, rel),
  /** Raw bytes for files `readFile` refuses (images). The renderer has no way to
   *  load them off disk — the CSP allows no `file:` source and no file protocol
   *  is registered — so images travel as bytes and become a `blob:` URL in the
   *  renderer, which `img-src` already permits. Root-confined and size-capped in
   *  the main process; `mime` is derived from the extension. */
  readBinary: (root: string, rel: string): Promise<
    // `Uint8Array<ArrayBuffer>`, not the bare alias: structured clone always
    // hands the renderer a view over a plain ArrayBuffer, and saying so is what
    // lets the value go straight into `new Blob([...])` — the default
    // `ArrayBufferLike` admits SharedArrayBuffer, which BlobPart rejects.
    { ok: true; bytes: Uint8Array<ArrayBuffer>; mime: string; path: string; size: number }
    | { ok: false; error: string }
  > => ipcRenderer.invoke('fs:readBinary', root, rel),
  writeFile: (root: string, rel: string, content: string): Promise<
    { ok: true; path: string } | { ok: false; error: string }
  > => ipcRenderer.invoke('fs:writeFile', root, rel, content),
  /** v0.3.4: existence check for an absolute path (expands ~) — backs the
   *  terminal ⌘-click markdown flow. Metadata only, never contents. */
  statAbs: (p: string): Promise<{ exists: boolean; isFile: boolean; path: string }> =>
    ipcRenderer.invoke('fs:statAbs', p),
  /** Show a path in the OS file browser (Finder / Explorer / the Linux default).
   *  Backs ⌘-click on a terminal path we have no viewer for. Reveals only — main
   *  never launches a file's default application, because the path came from
   *  agent output. */
  revealPath: (p: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:revealPath', p),
  /** The files an Ask me question names: whether each opens in its default
   *  app, is only shown in Finder, or is missing. Main decides
   *  (docs/designs/ask-me-open-file.md). */
  askFiles: (paths: string[], who: { raisedBy?: string; assignee?: string }): Promise<Array<'open' | 'reveal' | 'missing'>> =>
    ipcRenderer.invoke('fs:askFiles', paths, who),
  /** Open (or, when main says so, show in Finder) one file an Ask me question names. */
  openAskFile: (p: string, who: { raisedBy?: string; assignee?: string }): Promise<{ ok: boolean; action?: 'opened' | 'revealed'; error?: string }> =>
    ipcRenderer.invoke('fs:openAskFile', p, who),

  // ─── Git ─────────────────────────────────────────────────────────────────
  gitIsRepo: (cwd: string): Promise<boolean> => ipcRenderer.invoke('git:isRepo', cwd),
  /** Absolute path of the MAIN working tree `cwd` belongs to — a linked worktree
   *  resolves to the original repo, not to itself. null when not a git repo. */
  gitMainRepo: (cwd: string): Promise<string | null> => ipcRenderer.invoke('git:mainRepo', cwd),
  gitBranch: (cwd: string) =>
    ipcRenderer.invoke('git:branch', cwd) as Promise<{ current: string | null; detached: boolean } | { error: string }>,
  gitStatus: (cwd: string) =>
    ipcRenderer.invoke('git:status', cwd) as Promise<GitStatus | { error: string }>,
  gitLog: (cwd: string, n?: number) =>
    ipcRenderer.invoke('git:log', cwd, n ?? 50) as Promise<GitCommit[] | { error: string }>,
  gitBranches: (cwd: string) =>
    ipcRenderer.invoke('git:branches', cwd) as Promise<{ local: string[]; remote: string[]; current: string | null } | { error: string }>,
  gitAheadBehind: (cwd: string) =>
    ipcRenderer.invoke('git:aheadBehind', cwd) as Promise<{ ahead: number; behind: number; upstream: string | null } | { error: string }>,
  /** Diff one repo-root-relative file: its HEAD content vs its working-tree content.
   *  Path-validated main-side against `cwd`; the renderer only ever gets the two
   *  text sides. Backs the IDE's git-diff (Monaco DiffEditor) view. */
  gitDiff: (cwd: string, relPath: string) =>
    ipcRenderer.invoke('git:diff', cwd, relPath) as Promise<GitDiff | { ok: false; error: string }>,
  // ── v0.3.4: history / compare / checkout (git visualization) ──
  gitLogGraph: (cwd: string, n: number, skip?: number) =>
    ipcRenderer.invoke('git:logGraph', cwd, n, skip ?? 0) as Promise<GitCommitRow[] | { error: string }>,
  gitCommitFiles: (cwd: string, sha: string) =>
    ipcRenderer.invoke('git:commitFiles', cwd, sha) as Promise<GitFileChange[] | { error: string }>,
  gitShowFile: (cwd: string, rev: string, relPath: string) =>
    ipcRenderer.invoke('git:showFile', cwd, rev, relPath) as Promise<
      { ok: true; exists: boolean; isBinary: boolean; content: string } | { ok: false; error: string }
    >,
  gitCompareRefs: (cwd: string, base: string, head: string, mode?: 'two' | 'three') =>
    ipcRenderer.invoke('git:compareRefs', cwd, base, head, mode ?? 'three') as Promise<
      { ahead: number; behind: number; mergeBase: string | null; files: GitFileChange[] } | { error: string }
    >,
  gitWorktrees: (cwd: string) =>
    ipcRenderer.invoke('git:worktrees', cwd) as Promise<
      Array<{ path: string; head: string; branch: string | null }> | { error: string }
    >,
  gitCheckout: (cwd: string, ref: string, detach?: boolean) =>
    ipcRenderer.invoke('git:checkout', cwd, ref, detach === true) as Promise<
      { ok: true; detached: boolean } | { ok: false; error: string }
    >,

  // ─── Hive (multi-agent coordination) ─────────────────────────────────────
  hiveRegistry: (): Promise<HiveRegistry> => ipcRenderer.invoke('hive:registry'),
  /** Persist a hire/job role to hive registry.json + identity.md (no respawn). */
  hivePatchAgentRole: (id: string, role: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('hive:patchAgentRole', id, role),
  /** A hire's first task: its card, and a request to Michael to hand it out.
   *  Once per hire; `sent` is false when there was nothing to send. With
   *  `edited`, the words are an owner's edited First task from an older Work
   *  style (sourceCard may then be empty: a hire with no pack card). */
  hiveFirstTask: (sourceCard: string | undefined, agentId: string, name: string, edited?: { ask: string; role?: string; existing?: boolean }): Promise<{ ok: boolean; sent?: boolean; error?: string }> =>
    ipcRenderer.invoke('hive:firstTask', { sourceCard, agentId, name, ...(edited ? { ask: edited.ask, role: edited.role, existing: edited.existing } : {}) }),
  /** Rename an agent's display name. Its id, hive directory, and PTY are unchanged. */
  hiveRenameAgent: (id: string, name: string): Promise<{ ok: boolean; name?: string; error?: string }> =>
    ipcRenderer.invoke('hive:renameAgent', id, name),
  /** Put an agent on hold (the human has them 1:1) or take it off. Held agents
   *  keep running; Michael is told to stop routing work to them. */
  hiveSetAgentHold: (id: string, hold: boolean): Promise<{ ok: boolean; onHold?: boolean; error?: string }> =>
    ipcRenderer.invoke('hive:setAgentHold', id, hold),
  hiveBoard: (): Promise<string> => ipcRenderer.invoke('hive:board'),
  hiveTasks: (): Promise<unknown> => ipcRenderer.invoke('hive:tasks'),
  hiveLog: (n?: number, kind?: string, since?: number): Promise<unknown[]> => ipcRenderer.invoke('hive:log', n ?? 200, kind, since),
  /** When the app last cleared this agent's conversation, or null. */
  hiveClearedState: (id: string): Promise<{ at: number; oldSession: string; tokensBefore: number } | null> =>
    ipcRenderer.invoke('hive:clearedState', id),
  /** Undo a clear: restart the agent into its earlier conversation. */
  restoreConversation: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('agent:restoreConversation', id),
  /** Add the owner's Ask me answer to the raising agent's memory notes. */
  hiveRememberOwnerAnswer: (p: { agentId: string; task: string; q: string; a: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('hive:rememberOwnerAnswer', p),
  hiveMemory: (id: string): Promise<string> => ipcRenderer.invoke('hive:memory', id),
  hiveMemoryDetail: (id: string): Promise<{ index: string; waiting: number }> => ipcRenderer.invoke('hive:memoryDetail', id),
  hiveProcedure: (id: string, slug: string): Promise<string | null> => ipcRenderer.invoke('hive:procedure', id, slug),
  hiveInbox: (id: string): Promise<HiveMessage[]> => ipcRenderer.invoke('hive:inbox', id),
  // Mailboxes and Capabilities (docs/designs/multi-mailbox.md). A password
  // crosses the bridge only once, to be tested and stored in main.
  mailSave: (input: { id?: string; provider: MailProvider; address: string; password: string; imap?: MailServer; smtp?: MailServer }): Promise<{ ok: true; record: MailboxRecord } | { ok: false; kind: string; reason: string }> =>
    ipcRenderer.invoke('mail:save', input),
  mailRemove: (id: string): Promise<{ ok: boolean; affected: string[] }> => ipcRenderer.invoke('mail:remove', id),
  /** `move: true` confirms taking a mailbox another agent holds (one agent per
   *  mailbox); without it main answers `heldBy` and changes nothing. */
  mailSetCapabilities: (agentId: string, caps: AgentCapabilities & { move?: boolean }): Promise<{ ok: boolean; restartNeeded: boolean; heldBy?: string; movedFrom?: string }> =>
    ipcRenderer.invoke('mail:setCapabilities', agentId, caps),
  /** A member's Send only grant from another member's mailbox, or null to
   *  remove it (docs/designs/shared-mailboxes.md). */
  mailSetSendOnly: (agentId: string, grant: { mailbox: string; sending: 'send' | 'approval' | 'draft' } | null): Promise<{ ok: boolean; restartNeeded: boolean }> =>
    ipcRenderer.invoke('mail:setSendOnly', agentId, grant),
  /** Read the connectors on the owner's Claude account again (a few seconds). */
  connectorsRefresh: (why?: string): Promise<void> => ipcRenderer.invoke('connectors:refresh', why),
  /** Whether a read is running now. */
  connectorsReading: (): Promise<boolean> => ipcRenderer.invoke('connectors:reading'),
  onConnectorsReading: (cb: (reading: boolean) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, reading: boolean) => cb(reading);
    ipcRenderer.on('connectors:reading', listener);
    return () => ipcRenderer.removeListener('connectors:reading', listener);
  },
  /** The owner's switch for one connector. */
  connectorsSetOn: (key: string, on: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('connectors:setOn', key, on),
  /** Give or take one connector from one agent. */
  connectorsSetGrant: (agentId: string, key: string, granted: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('connectors:setGrant', agentId, key, granted),
  /** Forget a connector that left the Claude account. */
  connectorsClear: (key: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('connectors:clear', key),
  /** The owner saw the list: nothing in it is new any more. */
  connectorsSeen: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('connectors:seen'),
  /** Agents whose connectors changed since they started (missed pushes). */
  connectorsPendingRestarts: (): Promise<string[]> => ipcRenderer.invoke('connectors:pendingRestarts'),
  /** An agent's connectors changed since it started: restart it when idle. */
  onConnectorsRestartNeeded: (cb: (p: { agentId: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, p: { agentId: string }) => cb(p);
    ipcRenderer.on('connectors:restartNeeded', listener);
    return () => ipcRenderer.removeListener('connectors:restartNeeded', listener);
  },
  /** Agents that may use QuickBooks, Read only, before the owner chooses (Oscar). */
  quickbooksRoleDefaults: (): Promise<string[]> => ipcRenderer.invoke('quickbooks:roleDefaults'),
  /** Save one agent's QuickBooks capability (through the owner's Claude account). */
  quickbooksSetAccess: (agentId: string, cap: { enabled: boolean; changes: boolean }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('quickbooks:setAccess', agentId, cap),
  /** Received and sent messages for an agent's Messages tab, newest first, redacted. */
  hiveHistory: (id: string): Promise<Array<VoiceMessage & { dir: 'in' | 'out' }>> => ipcRenderer.invoke('hive:history', id),
  /** Voice read-layer: recent message CONTENT (inbox/outbox bodies), REDACTED in
   *  main. Pass { id } for one message, { agentId } to scope to one mailbox, or
   *  {} for the whole floor. Backs Realtime Michael's get_messages. The renderer
   *  never sees a raw body or a secret — stripping happens main-side. */
  hiveMessages: (opts?: { agentId?: string; id?: string; limit?: number; includeArchived?: boolean }): Promise<VoiceMessage[]> =>
    ipcRenderer.invoke('hive:messages', opts ?? {}),
  /** Consolidated per-agent directory (registry + telemetry + context), incl.
   *  archived agents. Backs Realtime Michael's get_agent_detail / list_agents. */
  hiveAgentDirectory: (): Promise<AgentDirectory> => ipcRenderer.invoke('hive:agentDirectory'),

  // ─── Ephemeral workers (P4 — Slack-triggered isolated workers) ───────────
  /** Live ephemeral workers + worktrees preserved awaiting integration/GC. */
  listWorkers: (): Promise<{ live: WorkerSnapshot[]; preserved: PreservedWorktreeSnapshot[]; maxWorkers: number }> =>
    ipcRenderer.invoke('workers:list'),
  /** Manually stop a live ephemeral worker (safety-gated teardown; work preserved). */
  stopWorker: (workerId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('workers:stop', workerId),

  // ─── Semantic memory (MemPalace CLI) ─────────────────────────────────────
  memoryStatus: (): Promise<MemoryStatus> => ipcRenderer.invoke('hive:memoryStatus'),
  /** Which external tools (uv, mempalace, git, each agent engine) are actually
   *  present on this machine, with a platform-resolved install command each. */
  toolsStatus: (): Promise<ToolStatus[]> => ipcRenderer.invoke('tools:status'),
  // ─── Get Michael ready (docs/designs/get-michael-ready.md) ────────────────
  /** Where Claude stands: installed, signed in. `provider` is setup's pick
   *  before it is saved; otherwise Michael's saved engine. */
  engineSetupStatus: (provider?: AgentProvider): Promise<EngineSetupStatus> => ipcRenderer.invoke('engineSetup:status', provider),
  /** Run Claude's standalone installer in the `engine-setup-install` terminal. */
  engineSetupInstall: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('engineSetup:install'),
  /** Run `claude auth login` (opens the browser) in the `engine-setup-signin` terminal. */
  engineSetupSignIn: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('engineSetup:signIn'),
  /** Use an Anthropic API key instead of a Claude account: checked with
   *  Anthropic, then kept write only in the secret store. Never read back. */
  engineSetupUseApiKey: (key: string): Promise<{ ok: boolean; error?: 'invalid' | 'rejected' | 'refused' | 'workspace' | 'busy' | 'unreachable' | 'store'; reason?: string }> =>
    ipcRenderer.invoke('engineSetup:useApiKey', key),
  /** A setup terminal ended, or an agent could not start for want of Claude. */
  onEngineSetupChanged: (cb: (e: { id: string; exitCode: number | null }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, info: { id: string; exitCode: number | null }): void => cb(info);
    ipcRenderer.on('engineSetup:changed', listener);
    return () => ipcRenderer.removeListener('engineSetup:changed', listener);
  },
  /** Settings hero payload — plan + sponsor, fetched from the repo and cached. */
  heroPayload: (force?: boolean): Promise<{ hero: HeroPayload; fetchedAt: number; stale: boolean }> =>
    ipcRenderer.invoke('hero:payload', force),
  /** The remote model catalog — the agent model presets, fetched from the repo
   *  and cached, so a new model needs a JSON edit rather than a release. A null
   *  catalog means the renderer keeps the list compiled into the build. */
  modelCatalog: (force?: boolean): Promise<{
    catalog: ModelCatalog | null; fetchedAt: number; stale: boolean;
  }> => ipcRenderer.invoke('models:catalog', force),
  /** Skills already installed for the coding agents on this machine. */
  skillsLocal: (cwd?: string): Promise<LocalSkill[]> => ipcRenderer.invoke('skills:local', cwd),
  /** The browsable skills catalog (cached; `force` re-fetches). */
  skillsCatalog: (force?: boolean): Promise<{
    skills: CatalogSkill[]; fetchedAt: number; stale: boolean; error?: string;
  }> => ipcRenderer.invoke('skills:catalog', force),
  /** Install a catalog skill into ~/.claude/skills. `unsupported` distinguishes
   *  "there is no downloadable source" from "the download failed". */
  skillsInstall: (url: string, name: string): Promise<
    { ok: true; path: string } | { ok: false; error: string; unsupported?: boolean }
  > => ipcRenderer.invoke('skills:install', url, name),
  /** Delete an installed skill. Main refuses any path outside a skills root. */
  skillsUninstall: (path: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('skills:uninstall', path),
  /** Show a skill's folder in the OS file manager. */
  skillsReveal: (path: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('skills:reveal', path),
  searchMemory: (query: string, wing?: string): Promise<{ ok: boolean; output: string; error?: string }> =>
    ipcRenderer.invoke('hive:searchMemory', query, wing),
  memoryWakeUp: (wing?: string): Promise<{ ok: boolean; output: string; error?: string }> =>
    ipcRenderer.invoke('hive:memoryWakeUp', wing),
  mineNow: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('hive:mineNow'),
  /** Tidy agents' memory notes into their index now (memoryTidy.ts). With an
   *  id, that agent is tidied if it has anything to tidy. */
  reflectNow: (id?: string): Promise<Array<{ id: string; tidied: boolean; reason: string }>> =>
    ipcRenderer.invoke('memory:reflectNow', id),

  // ─── Enterprise Knowledge Graph (multimodal context for agents) ───────────
  kgStatus: (): Promise<KnowledgeStatus> => ipcRenderer.invoke('kg:status'),
  kgList: (): Promise<KnowledgeDoc[]> => ipcRenderer.invoke('kg:list'),
  kgSearch: (query: string, limit?: number): Promise<KnowledgeHit[]> =>
    ipcRenderer.invoke('kg:search', query, limit),
  kgGet: (id: string): Promise<{ meta: KnowledgeDoc; text: string } | null> =>
    ipcRenderer.invoke('kg:get', id),
  kgRemove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('kg:remove', id),
  /** Open an OS file picker and ingest the chosen artifacts in one round-trip. */
  kgAddFiles: (): Promise<KnowledgeIngestResult> => ipcRenderer.invoke('kg:addFiles'),
  /** Ingest explicit file paths (e.g. drag-and-drop). */
  kgIngestFiles: (paths: string[], tags?: string[]): Promise<KnowledgeIngestResult> =>
    ipcRenderer.invoke('kg:ingestFiles', { paths, tags }),

  // ─── Composer attachments (images + files, sent to agents by PATH) ─────────
  /** Open an OS picker for images/files; returns chosen absolute paths + names. */
  attachFiles: (): Promise<
    { ok: true; files: { path: string; name: string }[] } | { ok: false; error: string }
  > => ipcRenderer.invoke('dialog:attachFiles'),
  /** Resolve a dropped File's absolute path (Electron 32 removed File.path). */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Write the current clipboard image to a temp PNG and return its path (paste-to-attach). */
  saveClipboardImage: (): Promise<
    { ok: true; file: { path: string; name: string } } | { ok: false; error: string }
  > => ipcRenderer.invoke('clipboard:saveImage'),

  // ─── Command history (SQLite — every prompt submitted to an agent) ─────────
  /** Record one submitted prompt. Fire-and-forget from the prompt-detection hook. */
  historyAdd: (entry: { agentId: string; cwd?: string; text: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('history:add', entry),
  /** Most-recent-first history, optionally scoped to one agent. */
  historyList: (agentId?: string, limit?: number): Promise<CommandHistoryEntry[]> =>
    ipcRenderer.invoke('history:list', agentId, limit),
  /** Substring search over prompt text, most-recent-first. */
  historySearch: (query: string, limit?: number): Promise<CommandHistoryEntry[]> =>
    ipcRenderer.invoke('history:search', query, limit),
  hiveSend: (msg: Partial<HiveMessage>, from?: string): Promise<{ ok: boolean; error?: string; message?: HiveMessage }> =>
    ipcRenderer.invoke('hive:send', msg, from),
  /** Michael's open requests from the owner, oldest first (card-lifecycle.md). */
  hiveOwnerRequests: (): Promise<Array<{ id: string; taskId: string; subject: string; createdAt: string }>> =>
    ipcRenderer.invoke('hive:ownerRequests'),

  onHiveHookEvent: (
    cb: (e: HookEvent) => void
  ): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: HookEvent) => cb(payload);
    ipcRenderer.on('hive:hookEvent', listener);
    return () => ipcRenderer.removeListener('hive:hookEvent', listener);
  },
  /** Push-based context accounting from the status line: live tokens + the
   *  session's EXACT context-window size. Same pattern as onHiveHookEvent. */
  onHiveContextUpdate: (
    cb: (e: { agentId: string; tokens: number; limit: number }) => void
  ): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { agentId: string; tokens: number; limit: number }) => cb(payload);
    ipcRenderer.on('hive:contextUpdate', listener);
    return () => ipcRenderer.removeListener('hive:contextUpdate', listener);
  },
  onHiveMessage: (cb: (e: HiveRouteEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: HiveRouteEvent) => cb(payload);
    ipcRenderer.on('hive:message', listener);
    return () => ipcRenderer.removeListener('hive:message', listener);
  },
  /** Register a listener for hive tasks routed to non-Claude agents (e.g.
   *  Codex). Main emits this instead of bouncing; the renderer enqueues the
   *  raw text so the drain effect types it into the agent's REPL when idle. */
  onHiveEnqueue: (cb: (e: { targetId: string; text: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { targetId: string; text: string }) => cb(payload);
    ipcRenderer.on('hive:enqueueToAgent', listener);
    return () => ipcRenderer.removeListener('hive:enqueueToAgent', listener);
  },
  /** A MAIN-initiated agent spawn (e.g. a voice hire via rt-5) — the renderer adds
   *  the floor card from this descriptor since it didn't initiate the hire itself. */
  onHiveAgentSpawned: (
    cb: (rec: {
      id: string; name: string; provider?: string; cwd: string;
      command?: string; role?: string; worktreePath?: string;
      character?: string; accent?: string;
    }) => void
  ): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload);
    ipcRenderer.on('hive:agentSpawned', listener);
    return () => ipcRenderer.removeListener('hive:agentSpawned', listener);
  },
  /** A MAIN-initiated agent kill/archive (e.g. a voice kill via rt-5) — the renderer
   *  archives the floor card since it didn't initiate the kill itself. */
  onHiveAgentArchived: (cb: (e: { id: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { id: string }) => cb(payload);
    ipcRenderer.on('hive:agentArchived', listener);
    return () => ipcRenderer.removeListener('hive:agentArchived', listener);
  },
  /** Register a listener for terminal work-order handoffs (#53) — hive mail to a
   *  hookless provider that can't drain an inbox; the renderer types it into the
   *  agent's REPL as a work order. */
  onHiveTerminalHandoff: (cb: (e: HiveTerminalHandoffEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: HiveTerminalHandoffEvent) => cb(payload);
    ipcRenderer.on('hive:terminalHandoff', listener);
    return () => ipcRenderer.removeListener('hive:terminalHandoff', listener);
  },

  // ─── Shareable hires (deep link / file import) ────────────────────────────
  /** Fired when a validated hire manifest arrives via the dontbemichael://
   *  deep link. The renderer opens the Add-Agent modal pre-filled — import
   *  never spawns anything by itself. */
  onHireImport: (cb: (manifest: HireManifest) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, manifest: HireManifest) => cb(manifest);
    ipcRenderer.on('hire:import', listener);
    return () => ipcRenderer.removeListener('hire:import', listener);
  },
  /** Fired when a deep-linked manifest failed validation/fetch. */
  onHireError: (cb: (info: { error: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, info: { error: string }) => cb(info);
    ipcRenderer.on('hire:error', listener);
    return () => ipcRenderer.removeListener('hire:error', listener);
  },
  /** Signal readiness and pull any queued deep-linked manifests (cold-start
   *  links, links that arrived during load). Resolves the queued list. */
  drainPendingHires: (): Promise<HireManifest[]> =>
    ipcRenderer.invoke('hire:drainPending'),
  /** Open a multi-file picker and validate every selected hire manifest. */
  importHireFiles: (): Promise<{
    ok: boolean;
    manifests: HireManifest[];
    errors: string[];
    error?: string;
  }> =>
    ipcRenderer.invoke('hire:openFile'),

  // ─── Config changes ──────────────────────────────────────────────────────
  /** Fired whenever a setting is saved, with the full updated config. */
  onConfigChanged: (cb: (config: HarnessConfig) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, config: HarnessConfig) => cb(config);
    ipcRenderer.on('config:changed', listener);
    return () => ipcRenderer.removeListener('config:changed', listener);
  },

  // ─── Quit confirmation ───────────────────────────────────────────────────
  onCloseRequested: (cb: (info: { ptyCount: number }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, info: { ptyCount: number }) => cb(info);
    ipcRenderer.on('app:closeRequested', listener);
    return () => ipcRenderer.removeListener('app:closeRequested', listener);
  },
  /** Quit the way Cmd-Q does: closing time when terminals are running. */
  requestQuit: (): Promise<void> => ipcRenderer.invoke('app:requestQuit'),
  confirmClose: (): Promise<void> => ipcRenderer.invoke('app:confirmClose'),
  cancelClose: (): Promise<void> => ipcRenderer.invoke('app:cancelClose'),

  // ─── Power / wake (auto-revive wedged PTYs after sleep/lock) ────────────────
  /** Subscribe to the main-process power-resume signal; returns an unsubscribe
   *  fn. The main process catches up after a sleep/unlock and reports the PTY
   *  ids that wedged across it in `dead` — the renderer respawns ONLY those
   *  (empty `dead[]` = no-op). Same main→renderer push pattern as onClosingTime. */
  onPowerResume: (cb: (e: PowerResumeEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: PowerResumeEvent) => cb(payload);
    ipcRenderer.on('power:resume', listener);
    return () => ipcRenderer.removeListener('power:resume', listener);
  },

  // ─── Closing time (graceful shutdown via the hive) ─────────────────────────
  /** Start the closing-time protocol: the god broadcasts shutdown, every worker
   *  saves its memory and ACKs, the god concludes — then the app quits itself.
   *  Resolves with ok:false (+ error) when no god agent is running. */
  startClosingTime: (opts?: { relaunch?: boolean }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('app:startClosingTime', opts),
  /** Abort an in-progress closing time and tell the floor to resume work. */
  cancelClosingTime: (): Promise<void> => ipcRenderer.invoke('app:cancelClosingTime'),
  /** Re-send the closing-time note to one agent (Michael included). */
  closingTimeRemind: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:closingTimeRemind', id),
  /** Close without one team member: stop waiting on it; it is back tomorrow. */
  closingTimeExcuse: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:closingTimeExcuse', id),
  /** Progress events for the quit dialog: started → progress → complete (the
   *  app tears down moments later) | timeout | cancelled. Each carries the ACK
   *  counts and the rows: who confirmed, who is still waited on, who the owner
   *  closed without, and Michael's id. Progress also fires on Close without
   *  them and when a waited-on terminal ends. */
  onClosingTime: (cb: (ev: ClosingTimeEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: ClosingTimeEvent) => cb(ev);
    ipcRenderer.on('app:closingTime', listener);
    return () => ipcRenderer.removeListener('app:closingTime', listener);
  },

  // ─── Reset ─────────────────────────────────────────────────────────────────
  /** Wipe all hive data + the memory palace, reset config, and relaunch the app
   *  into onboarding. The process exits, so this promise never resolves. */
  resetAll: (): Promise<void> => ipcRenderer.invoke('app:resetAll'),

  // ─── Token telemetry (real usage + est. cost from CC transcripts) ──────────
  /** Sum input/output/cache tokens + estimated USD cost for an agent from its
   *  Claude Code transcripts (reconciler/fallback). Returns null for an invalid cwd. */
  agentUsage: (cwd: string): Promise<AgentUsage | null> =>
    ipcRenderer.invoke('hive:agentUsage', cwd),
  /** Current context size (tokens) of an agent's live session, read from the
   *  last assistant message of its transcript. Null until the agent's hooks
   *  have fired at least once (the transcript path is learned from them). */
  agentContext: (agentId: string): Promise<number | null> =>
    ipcRenderer.invoke('hive:agentContext', agentId),

  // ─── Live telemetry (OTel collector — the usage-provider seam + spans) ──────
  /** Live cumulative usage for an agent (OTel-preferred, transcript fallback). */
  telemetryUsage: (agentId: string): Promise<AgentUsageSample | null> =>
    ipcRenderer.invoke('telemetry:usage', agentId),
  /** Recent tool spans for an agent's waterfall (#7B.2). */
  telemetrySpans: (agentId: string): Promise<ToolSpan[]> =>
    ipcRenderer.invoke('telemetry:spans', agentId),
  /** Cold-start backfill of all agents' usage + recent spans. */
  telemetrySnapshot: (): Promise<TelemetrySnapshot> =>
    ipcRenderer.invoke('telemetry:snapshot'),
  /** Subscribe to live telemetry pushes; returns an unsubscribe fn. */
  onTelemetryEvent: (cb: (e: TelemetryEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TelemetryEvent) => cb(payload);
    ipcRenderer.on('telemetry:event', listener);
    return () => ipcRenderer.removeListener('telemetry:event', listener);
  },

  // ─── Circuit breaker (Lane A #6 state → avatars/meter) ──────────────────────
  /** Subscribe to breaker-state changes; returns an unsubscribe fn. */
  onBreakerState: (cb: (s: BreakerState) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: BreakerState) => cb(payload);
    ipcRenderer.on('control:breakerState', listener);
    return () => ipcRenderer.removeListener('control:breakerState', listener);
  },
  /** Push a breaker state to the renderer (Lane A's policy / interim glue calls this). */
  setBreakerState: (state: BreakerState): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('control:setBreakerState', state),

  // ─── Operator control over agents (#7C.1–7C.3) ──────────────────────────────
  /** Pause/unpause an agent — paused → its tool calls are denied at PreToolUse. */
  controlPause: (agentId: string, on: boolean): Promise<AgentControlSnapshot | null> =>
    ipcRenderer.invoke('control:pause', agentId, on),
  /** Pause/resume automatic inbox and queued-message delivery for one agent. */
  controlAutoDelivery: (agentId: string, paused: boolean): Promise<AgentControlSnapshot | null> =>
    ipcRenderer.invoke('control:autoDelivery', agentId, paused),
  /** Clear pause + halt so the agent can run again. */
  controlResume: (agentId: string): Promise<AgentControlSnapshot | null> =>
    ipcRenderer.invoke('control:resume', agentId),
  /** Gate/ungate a specific tool for an agent (denied at PreToolUse). */
  controlGateTool: (agentId: string, tool: string, on: boolean): Promise<AgentControlSnapshot | null> =>
    ipcRenderer.invoke('control:gateTool', agentId, tool, on),
  /** Queue a steer note — injected as context on the agent's next hook (#7C.2). */
  controlSteer: (agentId: string, text: string): Promise<AgentControlSnapshot | null> =>
    ipcRenderer.invoke('control:steer', agentId, text),
  /** Request a graceful stop at the next hook boundary (#7C.3). */
  controlHalt: (agentId: string): Promise<AgentControlSnapshot | null> =>
    ipcRenderer.invoke('control:halt', agentId),
  /** Read an agent's current control snapshot. */
  controlSnapshot: (agentId: string): Promise<AgentControlSnapshot | null> =>
    ipcRenderer.invoke('control:snapshot', agentId),
  /** Subscribe to gate/deny events (a tool was blocked); returns unsubscribe fn. */
  onApprovalRequest: (cb: (e: { agentId: string; tool?: string; reason?: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { agentId: string; tool?: string; reason?: string }) => cb(payload);
    ipcRenderer.on('control:approvalRequest', listener);
    return () => ipcRenderer.removeListener('control:approvalRequest', listener);
  },

  // ─── Task kanban (hive/tasks.json) ───────────────────────────────────────
  /** Atomically append one card against the latest main-process ledger. */
  hiveAddTask: (task: HiveTask): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('hive:addTask', task),
  /** Record Ask me answers on one card, merged against the card on disk.
   *  `landed`: at least one answer was added to a question still open there. */
  hivePatchTask: (
    id: string,
    patch: Partial<Omit<HiveTask, 'id'>>
  ): Promise<{ ok: boolean; landed?: boolean; error?: string }> => ipcRenderer.invoke('hive:patchTask', id, patch),
  /** The owner moves a card; Done is their decision to end it. Michael is told. */
  hiveMoveTask: (id: string, status: HiveTask['status']): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('hive:moveTask', id, status),
  /** The owner ends a card: Done, marked "Closed by owner", never deleted. */
  hiveCloseTask: (id: string, reason?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('hive:closeTask', id, reason),

  // ─── Scheduled missions (recurring auto-dispatch) ──────────────────────────
  listMissions: (): Promise<ScheduledMission[]> => ipcRenderer.invoke('missions:list'),
  /** One schedule per call, applied by main to the current list (eng review R2). */
  upsertMission: (mission: ScheduledMission): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('missions:upsert', mission),
  deleteMission: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('missions:delete', id),
  setMissionEnabled: (id: string, on: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('missions:setEnabled', id, on),
  /** Schedule changes agents asked for, waiting for the owner in ASK ME. */
  listScheduleRequests: (): Promise<ScheduleRequest[]> => ipcRenderer.invoke('scheduleRequests:list'),
  decideScheduleRequest: (id: string, approve: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('scheduleRequests:decide', id, approve),
  onScheduleRequestsUpdated: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('scheduleRequests:updated', listener);
    return () => ipcRenderer.removeListener('scheduleRequests:updated', listener);
  },
  /** The owner's conversation with Michael (docs/designs/michael-replies.md). */
  ownerAsk: (p: { text: string; inReplyTo?: string; conversation?: string }): Promise<{ ok: boolean; id?: string; workOrder?: string }> => ipcRenderer.invoke('owner:ask', p),
  ownerConversation: (): Promise<OwnerDock> => ipcRenderer.invoke('owner:conversation'),
  ownerDelivered: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('owner:delivered', id),
  ownerWithdraw: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('owner:withdraw', id),
  ownerNotSent: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('owner:notSent', id),
  ownerRetry: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('owner:retry', id),
  ownerRead: (ids: string[]): Promise<{ ok: boolean }> => ipcRenderer.invoke('owner:read', ids),
  ownerNudge: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('owner:nudge', id),
  ownerDockVisible: (on: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('owner:dockVisible', on),
  onOwnerChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('owner:changed', listener);
    return () => ipcRenderer.removeListener('owner:changed', listener);
  },
  onOwnerOpenDock: (cb: (questionId: string) => void): (() => void) => {
    const listener = (_e: unknown, id: string): void => cb(id);
    ipcRenderer.on('owner:openDock', listener);
    return () => ipcRenderer.removeListener('owner:openDock', listener);
  },
  /** "Got it" on a report card (14A). */
  ackReport: (taskId: string, index: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('hive:ackReport', taskId, index),
  /** Send on approval: emails waiting for the owner on Ask me, and the owner's decision. */
  listMailProposals: (): Promise<MailProposal[]> => ipcRenderer.invoke('mailProposals:list'),
  /** Proposals tied to a task: ids, state and, once sent, the Message-ID (no email text). */
  listLinkedMailProposals: (): Promise<LinkedProposal[]> => ipcRenderer.invoke('mailProposals:linked'),
  decideMailProposal: (id: string, decision: ProposalDecision, edit: { subject?: string; body?: string }, note?: string, standing?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('mailProposals:decide', id, decision, edit, note, standing),
  /** Standing approvals: kinds of email an agent may send without asking. */
  listMailStanding: (agentId: string): Promise<StandingApproval[]> => ipcRenderer.invoke('mailStanding:list', agentId),
  /** A Send only member's latest sends from that mailbox, newest first (at most 5). */
  mailRecentSends: (agentId: string, mailbox: string): Promise<Array<{ to: string; subject: string; sentAt: number }>> => ipcRenderer.invoke('mail:recentSends', agentId, mailbox),
  revokeMailStanding: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('mailStanding:revoke', id),
  onMailProposalsUpdated: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('mailProposals:updated', listener);
    return () => ipcRenderer.removeListener('mailProposals:updated', listener);
  },
  /** The owner is closing this agent: pause its schedules and mark it closed. */
  closeAgentByOwner: (id: string): Promise<{ ok: boolean; paused: number }> =>
    ipcRenderer.invoke('agent:closedByOwner', id),
  /** Fires when the scheduler stamps a mission's lastFiredAt (a beat/dispatch),
   *  so the SCHEDULES panel can refresh "last fired" without a reload. */
  onMissionsUpdated: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('missions:updated', listener);
    return () => ipcRenderer.removeListener('missions:updated', listener);
  },

  // ─── Full-text search across hive files (board, tasks, memory) ─────────────
  textSearch: (q: string): Promise<{ ok: boolean; results: Array<{ source: string; excerpt: string }> }> =>
    ipcRenderer.invoke('hive:textSearch', q),

  // ─── GitHub issue ingestion (gh CLI) ───────────────────────────────────────
  /** List up to 30 open issues in the repo at `cwd` via the `gh` CLI. Returns
   *  `{ ok: false, error }` if `gh` is missing/unauthenticated or `cwd` isn't a repo. */
  githubIssues: (cwd: string): Promise<{ ok: boolean; issues?: GHIssue[]; error?: string }> =>
    ipcRenderer.invoke('github:issues', cwd),

  // ─── GitHub CI status watcher (gh CLI) ─────────────────────────────────────
  /** List up to 5 recent CI (GitHub Actions) runs in the repo at `cwd` via the
   *  `gh` CLI. Returns `{ ok: false, error }` if `gh` is missing/unauthenticated,
   *  `cwd` isn't a repo, or the repo has no Actions. */
  githubCIRuns: (cwd: string): Promise<{ ok: boolean; runs?: CIRun[]; error?: string }> =>
    ipcRenderer.invoke('github:ciRuns', cwd),

  // ─── Desktop notifications ───────────────────────────────────────────────────
  /** Toggle native desktop notifications for agent lifecycle events. */
  setNotifications: (v: boolean): Promise<HarnessConfig> =>
    ipcRenderer.invoke('app:setNotifications', v),

  // ─── Reliability / OS integration (onboarding permissions step) ──────────────
  /** Open a System Settings deep-link (or https URL) in the OS handler. Main
   *  restricts the scheme; the renderer just points at the pane. */
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('app:openExternal', url),
  /** Toggle macOS "Open at Login". Resolves to the resulting state (no prompt). */
  setLoginItem: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('app:setLoginItem', enabled),

  // ─── Agent lifecycle (archival) ─────────────────────────────────────────────
  /** Archive/unarchive a hive agent in the registry. Closing a terminal tab
   *  archives it automatically via pty:kill; this is the explicit primitive. */
  hiveSetArchived: (id: string, archived: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('hive:setArchived', id, archived),

  // ─── Slack integration (Slack message → Michael's queue) ─────────────────────
  /** Register a listener for inbound Slack messages; returns an unsubscribe fn.
   *  The message carries the thread coordinates needed to reply in-thread. */
  onSlackMessage: (cb: (msg: { text: string; channel: string; ts: string; thread_ts: string; autonomyPreamble?: string; files?: { path: string; name: string; mimetype: string }[] }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: { text: string; channel: string; ts: string; thread_ts: string; autonomyPreamble?: string; files?: { path: string; name: string; mimetype: string }[] }) => cb(msg);
    ipcRenderer.on('slack:incomingMessage', listener);
    return () => ipcRenderer.removeListener('slack:incomingMessage', listener);
  },
  /** Start the Slack webhook server; returns the public tunnel URL to paste into
   *  the Slack app's Event Subscriptions → Request URL. */
  slackStart: (): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('slack:start'),
  /** Stop the Slack webhook server + tunnel. */
  slackStop: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('slack:stop'),
  /** Current connection state + last Request URL (so Settings can hydrate the
   *  "Connected" badge and re-show the persisted tunnel URL on reopen). */
  slackStatus: (): Promise<{ running: boolean; url?: string }> =>
    ipcRenderer.invoke('slack:status'),
  /** Post a reply into a Slack thread (the bot token stays in main). Used for the
   *  renderer's immediate "queued" ack. */
  slackReply: (m: { channel: string; thread_ts: string; text: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('slack:reply', m),
  /** Absolute path to the bundled reply helper, for the office worker's
   *  end-of-run "post your summary back to Slack" instruction. */
  slackReplyScriptPath: (): Promise<string> =>
    ipcRenderer.invoke('slack:replyScriptPath'),
  /** Persist Slack settings (and stop the server if disabled / secret cleared). */
  slackSetConfig: (patch: {
    signingSecret?: string; botToken?: string; channelId?: string; port?: number; enabled?: boolean;
    proactivePosting?: boolean;
  }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('slack:setConfig', patch),

  // ─── Generic webhook + status API (POST → work, GET → status) ────────────────
  /** Start the generic webhook server; returns the public endpoint URL callers
   *  POST to (secret-gated) and GET a token's status from. */
  webhookStart: (): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('webhook:start'),
  /** Stop the generic webhook server + tunnel. */
  webhookStop: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('webhook:stop'),
  /** Current state + last endpoint URL (so Settings can hydrate the badge/URL). */
  webhookStatus: (): Promise<{ running: boolean; url?: string }> =>
    ipcRenderer.invoke('webhook:status'),
  /** Mint + persist a fresh secret and return it for the user to copy. */
  webhookGenerateSecret: (): Promise<{ ok: boolean; secret?: string }> =>
    ipcRenderer.invoke('webhook:generateSecret'),
  /** Persist webhook settings (and stop the server if disabled / secret cleared). */
  webhookSetConfig: (patch: {
    secret?: string; port?: number; enabled?: boolean;
  }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('webhook:setConfig', patch),

  // ─── Triggers: context (auto-compact / auto-clear) ──────────────────────────
  /** The two context rules (cadence + pressure gate + message), deep-filled. */
  getContextTrigger: (): Promise<ContextTriggerConfig> =>
    ipcRenderer.invoke('triggers:getContext'),
  /** Persist both rules and RE-ARM main's timers; resolves to what was stored
   *  (main clamps the cadence/percentages, so the echo is authoritative). */
  setContextTrigger: (cfg: ContextTriggerConfig): Promise<ContextTriggerConfig> =>
    ipcRenderer.invoke('triggers:setContext', cfg),
  /** Fires when a context rule comes due. `rule` rides along because main owns
   *  only the CADENCE — the renderer applies the per-agent pressure gate and
   *  queues the command for each agent that qualifies. */
  onContextTrigger: (cb: (evt: { action: 'compact' | 'clear'; rule: ContextRule }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { action: 'compact' | 'clear'; rule: ContextRule }) => cb(payload);
    ipcRenderer.on('trigger:context', listener);
    return () => ipcRenderer.removeListener('trigger:context', listener);
  },

  // ─── Triggers: webhook endpoints (many endpoints, one server + tunnel) ──────
  /** Every configured endpoint, enabled or not. */
  listWebhooks: (): Promise<WebhookTrigger[]> => ipcRenderer.invoke('webhooks:list'),
  /** Replace the whole list; main normalises each row (a blank secret keeps the
   *  stored one, an unknown mode keeps the stored one) and hot-swaps the running
   *  server's endpoints WITHOUT a restart, so no other caller's URL changes. */
  saveWebhooks: (list: WebhookTrigger[]): Promise<WebhookTrigger[]> =>
    ipcRenderer.invoke('webhooks:save', list),
  /** Revoke one endpoint; resolves to the remaining list. */
  deleteWebhook: (id: string): Promise<WebhookTrigger[]> =>
    ipcRenderer.invoke('webhooks:delete', id),
  /** Mint a 256-bit secret for the operator to paste into their caller. Not
   *  persisted until the endpoint carrying it is saved. */
  generateWebhookSecret: (): Promise<string> => ipcRenderer.invoke('webhooks:generateSecret'),
  /** Server state, the tunnel root, and each endpoint's full public URL (`url` is
   *  '' until a tunnel has come up). */
  webhooksStatus: (): Promise<{ running: boolean; url?: string; endpoints: { id: string; url: string }[] }> =>
    ipcRenderer.invoke('webhooks:status'),

  // ─── Triggers: organisation (clone-node peer messaging) ─────────────────────
  /** PERSISTENCE ONLY — the peer transport does not exist yet, so setting this
   *  stores the key and mode and starts nothing. */
  getOrgTrigger: (): Promise<OrgTriggerConfig> => ipcRenderer.invoke('org:getTrigger'),
  setOrgTrigger: (cfg: OrgTriggerConfig): Promise<OrgTriggerConfig> =>
    ipcRenderer.invoke('org:setTrigger', cfg),

  // ─── Triggers: history ledger + approval gate ───────────────────────────────
  /** The whole ledger, newest first (both directions, both sources). */
  listTriggerHistory: (): Promise<TriggerHistoryEntry[]> =>
    ipcRenderer.invoke('triggerHistory:list'),
  /** Answer a held message. 'approved' RELEASES it to the hive (card + god
   *  request, the same path an auto-allowed message takes); 'rejected' only flips
   *  the verdict. Deciding an already-decided entry is a no-op, never a second
   *  dispatch. Resolves to the updated row, or null when the id is gone. */
  decideTriggerHistory: (arg: { id: string; decision: 'approved' | 'rejected' }): Promise<TriggerHistoryEntry | null> =>
    ipcRenderer.invoke('triggerHistory:decide', arg),
  /** Wipe the ledger, or just one source's half of it. */
  clearTriggerHistory: (source?: 'webhook' | 'org'): Promise<void> =>
    ipcRenderer.invoke('triggerHistory:clear', source),
  /** Fires whenever the ledger changes (an inbound arrived, a verdict landed, a
   *  reply was paired), so the history tab live-refreshes. */
  onTriggerHistoryUpdated: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('triggerHistory:updated', listener);
    return () => ipcRenderer.removeListener('triggerHistory:updated', listener);
  },

  // ─── Free Flow (voice dictation → message queue) ─────────────────────────────
  /** Persist Free Flow settings (flag / Groq key / model). The Groq key is stored
   *  in main config; entry point B (hold-Option) is renderer-side, no hotkey here. */
  freeflowSetConfig: (patch: {
    enabled?: boolean; apiKey?: string; model?: string;
  }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('freeflow:setConfig', patch),
  /** Transcribe one captured audio clip via Groq (the key stays in main; only the
   *  audio bytes go in and the transcript comes back). Gated on the flag + a key. */
  freeflowTranscribe: (arg: {
    audio: ArrayBuffer | Uint8Array; mimeType?: string; filename?: string; language?: string;
  }): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('freeflow:transcribe', arg),

  // ─── Integrations registry (Phase 2 — labeled REST endpoints via the secret broker) ──
  // Bridges the §6 IPC surface for the Settings UI. WRITE-ONLY secret contract end to
  // end: `integrationsList` returns records with secretRef redacted to `hasSecret`;
  // `integrationsSetSecret` takes a secret ONE WAY (never echoed); NO method ever
  // returns a secret value to the renderer. Method names match registryClient's
  // feature-detection (camelCase ↔ colon-channel), so its real path activates as-is.
  integrationsList: (): Promise<IntegrationRecordView[]> =>
    ipcRenderer.invoke('integrations:list'),
  integrationsTemplates: (): Promise<IntegrationTemplate[]> =>
    ipcRenderer.invoke('integrations:templates'),
  integrationsUpsert: (record: IntegrationRecord): Promise<{ ok: true; record: IntegrationRecord } | { ok: false; error: string }> =>
    ipcRenderer.invoke('integrations:upsert', record),
  integrationsSetSecret: (req: { id: string; secret: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('integrations:setSecret', req),
  integrationsRemove: (req: { id: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('integrations:remove', req),
  integrationsTest: (req: { id: string; path?: string }): Promise<{ ok: boolean; status?: number; error?: string }> =>
    ipcRenderer.invoke('integrations:test', req),
  // Per-CLI-provider BYOK keys — WRITE-ONLY. `providerKeySet` stores a backend key one
  // way (never echoed); `providerKeyHas` returns only a boolean; no method ever returns
  // the plaintext. Keys are materialized MAIN-ONLY at spawn.
  providerKeySet: (req: { backend: string; key: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('providerKey:set', req),
  providerKeyHas: (backend: string): Promise<boolean> =>
    ipcRenderer.invoke('providerKey:has', backend),
  providerKeyClear: (backend: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('providerKey:clear', backend),
  // Realtime Michael (voice orchestrator) — MAIN mints a short-lived EPHEMERAL token
  // from the BYOK OpenAI key; the real key NEVER crosses IPC. `realtimeHasOpenAiKey`
  // is a presence boolean only (gates the voice toggle, like providerKeyHas).
  realtimeHasOpenAiKey: (): Promise<boolean> =>
    ipcRenderer.invoke('realtime:hasKey'),
  realtimeMintToken: (
    req?: { model?: string }
  ): Promise<
    | { ok: true; token: string; expiresAt: number | null; sessionConfig: { model: string } }
    | { ok: false; error: string; code?: string }
  > => ipcRenderer.invoke('realtime:mintToken', req ?? {}),
  // rt-5 voice ACTIONS — the renderer holds NO policy; main (realtimeActions.ts) owns
  // the tiering, two-step verbal confirm, hard allowlist, and michael-voice
  // attribution. These just forward {verb,...args} and speak back `spoken`.
  realtimeAction: (
    payload: { verb: string } & Record<string, unknown>
  ): Promise<{ ok: boolean; spoken: string; needsConfirm?: boolean }> =>
    ipcRenderer.invoke('realtime:action', payload),
  realtimeActionConfirm: (
    req: { phrase: string }
  ): Promise<{ ok: boolean; spoken: string; needsConfirm?: boolean }> =>
    ipcRenderer.invoke('realtime:action:confirm', req),
  realtimeActionCancel: (): Promise<{ ok: boolean; spoken: string; needsConfirm?: boolean }> =>
    ipcRenderer.invoke('realtime:action:cancel'),
  // rt-12 completion seam — a voice-dispatched task finished. `summary` is the
  // human-speakable line Michael relays; the rest is context for a toast/log.
  onRealtimeCompletion: (
    cb: (evt: { correlationId: string; kind: string; targetAgentId: string; taskId?: string; summary: string; completedAt: number; objective?: string }) => void
  ): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload);
    ipcRenderer.on('realtime:completion', listener);
    return () => ipcRenderer.removeListener('realtime:completion', listener);
  },
  /** Tell main whether a live voice session is open (drives queue-vs-push for completions). */
  realtimeSetSessionLive: (live: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('realtime:setSessionLive', live),
  /** Drain completions that arrived while no session was open (warm-start catch-up). */
  realtimeDrainCompletions: (): Promise<
    { correlationId: string; kind: string; targetAgentId: string; taskId?: string; summary: string; completedAt: number; objective?: string }[]
  > => ipcRenderer.invoke('realtime:drainCompletions'),
  /** Block until a tracked task completes (or times out) — backs the wait_for tool. */
  realtimeWaitFor: (
    taskId: string,
    timeoutMs?: number
  ): Promise<{ summary: string; targetAgentId: string; taskId?: string } | { timedOut: true; taskId: string }> =>
    ipcRenderer.invoke('realtime:waitFor', taskId, timeoutMs),
  /** v0.3.4: coalesced floor deltas pushed while a voice session is live — the
   *  renderer injects them into the conversation as silent items. */
  onRealtimeFloorDelta: (cb: (evt: { text: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { text: string }) => cb(payload);
    ipcRenderer.on('realtime:floorDelta', listener);
    return () => ipcRenderer.removeListener('realtime:floorDelta', listener);
  },
  /** v0.3.4: main-staged queue insertions (voice clear_context) — the renderer
   *  enqueues so delivery rides every existing safety gate. */
  onRealtimeEnqueue: (cb: (evt: { agentId: string; text: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { agentId: string; text: string }) => cb(payload);
    ipcRenderer.on('realtime:enqueue', listener);
    return () => ipcRenderer.removeListener('realtime:enqueue', listener);
  },
  /** v0.3.4: app self-knowledge — version + newest changelog sections. */
  appInfo: (): Promise<{ version: string; changelog: string; packaged?: boolean }> =>
    ipcRenderer.invoke('app:info'),
  // ─── Roster mirror (agents + notes + queues, shared dev ↔ packaged) ─────────
  /** Read the roster file beside the hive. SYNCHRONOUS on purpose: the zustand
   *  store is created at module load, so an async read would arrive after the
   *  first render and the floor would flash empty. One blocking round trip at
   *  boot. `null` = no file (or unreadable) — the caller then uses localStorage. */
  rosterReadSync: (): RosterSnapshot | null => {
    try { return ipcRenderer.sendSync('roster:readSync') ?? null; } catch { return null; }
  },
  /** Which hive is open, synchronously — same boot-time constraint as
   *  `rosterReadSync`, and read in the same breath: the store has to know which
   *  hive its localStorage keys belong to before it decides to trust them. */
  harnessHomeSync: (): string | null => {
    try { return ipcRenderer.sendSync('config:homeSync') ?? null; } catch { return null; }
  },
  /** Mirror the roster to disk. Debounced by the caller; main keeps the previous
   *  contents as a backup and refuses a first write that would empty a full file. */
  rosterWrite: (snap: RosterSnapshot): Promise<{ ok: boolean; skipped?: string; error?: string }> =>
    ipcRenderer.invoke('roster:write', snap),
  /** Copy roster.json into roster-backups/ now, before a change the app makes
   *  on its own (the instructions rewrite). */
  rosterBackup: (reason: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('roster:backup', reason),

  // ─── Auto-update (v0.3.4; full state model v0.3.7) ──────────────────────────
  /** Push channel from main's updater — every stage of the pipeline, so the
   *  toolbar badge can show "checking", download progress, and the staged
   *  "restart to update" rather than only the terminal states. */
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: UpdateStatus) => cb(payload);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  /** The last known status — a reloaded window subscribes AFTER main may have
   *  already emitted, so it pulls the current state instead of waiting 6h. */
  updateCurrent: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:current'),
  /** The release notes of the version this install runs, fetched from its
   *  GitHub release when you click What's new in Settings. `notes` is
   *  undefined when the release could not be read (offline, no release). */
  updateReleaseNotes: (): Promise<{ version: string; notes?: string; url: string }> =>
    ipcRenderer.invoke('update:releaseNotes'),

  // ─── Claude Code updated underneath the team (src/shared/cliUpdate.ts) ──────
  /** Pushed when live agents fall behind the installed Claude Code, or catch up
   *  (null). */
  onCliUpdateStatus: (cb: (status: CliUpdateStatus | null) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: CliUpdateStatus | null) => cb(payload);
    ipcRenderer.on('cliUpdate:status', listener);
    return () => ipcRenderer.removeListener('cliUpdate:status', listener);
  },
  /** The last known status, for a window that subscribed after the push. */
  cliUpdateCurrent: (): Promise<CliUpdateStatus | null> => ipcRenderer.invoke('cliUpdate:current'),
  /** Quit and install the downloaded update — only ever called from an explicit
   *  "restart to update" click. */
  updateRestartAndInstall: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('update:restartAndInstall'),
  /** Manual re-check. */
  updateCheckNow: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('update:checkNow'),
  /** Start the download for an already-detected update (autoDownload normally
   *  beats the user to it; this is the explicit one-click path). */
  updateDownload: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('update:download'),
  /** Open the project's releases page for a notify-only update. */
  updateOpenRelease: (url?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('update:openRelease', url),
  /** Which OS this window runs on, for platform-specific copy. */
  platform: process.platform as string,
  arch: process.arch as string,
  /** The OS version (e.g. 10.0.26100 on Windows 11), for a prefilled problem report. */
  osVersion: (typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '') as string,
  /** DEV ONLY — fabricate an update status so the toast can be inspected without
   *  cutting a release. Refused (`{ok:false}`) in a packaged build; see the
   *  handler in updater.ts. Call it from the devtools console:
   *    await window.cth.updateSimulate()                       // notify-only digest toast
   *    await window.cth.updateSimulate({ state: 'downloaded' }) // restart-to-update toast
   *    await window.cth.updateSimulate({ drop: true })          // the centered release page
   *    await window.cth.updateSimulate({ notes: '<!-- drop -->…' }) // your own drop */
  updateSimulate: (opts?: {
    state?: 'downloaded' | 'available-manual';
    version?: string;
    notes?: string;
    /** Preview the centered release page using the default drop template. */
    drop?: boolean;
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('update:simulate', opts)
};

contextBridge.exposeInMainWorld('cth', api);

export type CthApi = typeof api;
