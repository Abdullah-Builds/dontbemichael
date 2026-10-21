import { create } from 'zustand';
import type { OfficeOpening } from '@/shell/clockingIn';
import type { AccentColorName } from '@/design/tokens';
import type { OfficeCharacterName } from '@/scene/office/cast';
import type { StatusKind } from '@/components/PixelBadge';
import type { AgentProvider } from '@shared/agentProvider';
import type { HireManifest } from '@shared/hire';
import { ownValue } from '@shared/ownValue';
import {
  EMPTY_HIRE_QUEUE,
  clearHireQueue,
  enqueueHires,
  finishCurrentHire,
  type HireReviewQueue
} from '@shared/hireQueue';
import { DEFAULT_ORG_TRIGGER, type OrgTriggerConfig, type WebhookTrigger } from '@shared/triggers';
import { isCompactionCommand } from '@shared/providerAutomation';
import { preferredAgentRole } from '@shared/agentRole';
import { isInboxNudge } from '@shared/hiveNudge';
import { SHOW_FOCUS_MODE, SHOW_GIT, SHOW_TRACES, SHOW_IDE, SHOW_ORG_TRIGGER, SHOW_VOICE } from '@shared/buildFeatures';
import type { ScheduledMission } from '@shared/missions';
import { refocusAfterRemoval, focusOnLoad, restoreFocus } from './focusMode';
import { chooseRosterSource } from './rosterSource';
import { renamePatches, swapName } from '@shared/hireTemplates';
import { canOpen } from '../shell/closingFloor';
import type { CenterClaim } from '../shell/wideCenter';
import { closeTab, openTab, type FileTab, type FixedView } from './fileTabs';
import { afterLeave, attemptLeave } from './leaveGuard';

export type ToolKind =
  | 'Read' | 'Edit' | 'Write' | 'Bash' | 'WebFetch' | 'WebSearch'
  | 'Grep' | 'Glob' | 'TodoWrite' | 'MCP';

export type StationKind =
  | 'shelf' | 'terminal' | 'web' | 'board' | 'mailbox' | 'mcp' | 'desk';

/** An unsent Ask me pick: the option picked on a choice, or each question's
 *  chip and typed line on an ask with several (docs/designs/ask-me-options.md). */
export interface AnswerPick { pick?: number; parts?: ({ chip?: number; text?: string } | undefined)[] }

/** Why an agent waits for a restart (store.pendingRestart). */
export interface PendingRestart {
  at: number;
  /** engine: Claude Code was just set up (docs/designs/get-michael-ready.md).
   *  stuck: the session stopped on a prompt (hooks.ts stuckOnPrompt).
   *  silent: its engine stopped reporting to the app (issue #326). */
  reason: 'email' | 'connectors' | 'engine' | 'stuck' | 'silent';
  /** The owner pressed Restart now: do not wait for idle. */
  now?: boolean;
  /** The last restart attempt failed; it is tried again on the next tick. */
  failed?: boolean;
}

export interface BlockReason {
  summary: string;                 // short headline shown on banner
  detail: string;                  // longer explanation
  command?: string;                // verbatim command awaiting confirmation, if any
  actions: Array<{
    label: string;
    kind: 'approve' | 'deny' | 'neutral';
    /** what we'd send to the tmux pane on click */
    send?: string;
  }>;
}

export interface Agent {
  id: string;
  name: string;
  /** which Office character represents this agent on the floor */
  character: OfficeCharacterName;
  accent: AccentColorName;
  /** persistent job / hire one-liner — same string as hive registry `role`.
   *  Live status belongs on `status` / `action`, never here. */
  description: string;
  project: string;
  /** legacy field — populated only for the seeded mock agents */
  tmuxTarget: string;
  cwd: string;
  goal?: string;
  /** User-authored private note shown and edited from the roster-card hover. */
  note?: string;
  /** Binding lines this hire's leaving took off teammates ("Not for ...; that
   *  goes to <Name>."), put back if they return (ship review SR3, 2026-10-03). */
  releasedBindings?: Array<{ id: string; line: string }>;
  status: StatusKind;
  action: string;
  progress: number;
  currentStation?: StationKind;
  carrying?: ToolKind;
  /** latest assistant message, streamed character-by-character in the sidebar */
  recentAssistantText?: string;
  /** epoch ms — used to drive the typewriter so identical strings still re-stream */
  recentTextTs?: number;
  /** What the current tool call is doing, in one safe line (the hook's
   *  `detail`: Claude's description of a command, a file name). Set and
   *  cleared by hook events only; the closing-time rows show it. */
  actionDetail?: string;
  /** When the agent's current step started, epoch ms. Hook events restart it:
   *  a tool call starting, the turn carrying on after a tool ends or a prompt
   *  lands, compacting, a wait at a prompt, an idle spell. The terminal parser
   *  rewrites `action` constantly and never touches it. */
  actionAt?: number;
  /** populated when status === 'blocked' */
  blockReason?: BlockReason;
  /** present iff this agent has a real PTY in the main process */
  ptyId?: string;
  /** Incremented by Restart & Continue to remount this agent's xterm without
   * changing its durable PTY/session identity. */
  terminalGeneration?: number;
  /** the command being run in the PTY (e.g. 'claude' or 'agy') */
  command?: string;
  /** which agent CLI preset owns this PTY recipe; drives the model picker +
   *  spawn flags. Defaults to 'claude' when unset (legacy agents / inferred
   *  from command). */
  provider?: AgentProvider;
  /** the model this agent runs on (e.g. 'claude-sonnet-4-6[1m]' or 'gemini-3-pro');
   *  drives the model selector + the --model arg used when (re)spawning the agent */
  model?: string;
  /** the last prompt the user submitted to this agent in Claude Code —
   *  shown on the floor as a card above the seated avatar */
  lastPrompt?: string;
  /** the orchestrator ("god") agent — seated in Michael's room, runs the floor */
  isGod?: boolean;
  /** Michael's prep assistant — send-only; enriches prompts and forwards them to
   *  the god. Excluded from broadcast fan-out and from the restorable-dead sweep. */
  isAssistant?: boolean;
  /** The human has this agent 1:1 and Michael has been told to leave it alone.
   *  Mirrors `RegistryAgent.onHold`; main owns the record, this is the copy the
   *  title bar renders from. */
  onHold?: boolean;
  /** The office pack card this agent's job was copied from when it was hired,
   *  `<businessType>/<cardId>` (hire redesign E2): its Profile shows that card's
   *  does, asks first and connections. Setup's pack members need none, since
   *  their id is their card's. */
  sourceCard?: string;
  /** When git isolation is enabled, the dedicated worktree path the agent runs
   *  in (its own `agent/<id>` branch); undefined for shared-cwd agents. */
  worktreePath?: string;
  /** Live context size of the agent's Claude session (tokens), polled from its
   *  transcript. Drives the context gauge on the agent card. */
  contextTokens?: number;
  /** The context-window limit assumed for this agent's model (tokens). */
  contextLimit?: number;
  /** True once this agent's terminal was closed. Archived agents are retained
   *  (in the store's `archivedAgents` list + the hive registry) but flagged and
   *  kept off the floor; only live-PTY agents are 'active'. */
  archived?: boolean;
  /** Hive protocol to TYPE into this agent's TUI as its first turn, set at spawn
   *  for `seedDelivery:'type-into-tui'` providers (Crush) whose bare TUI rejects a
   *  positional seed. useHive types it once after boot-grace then clears it.
   *  Ephemeral spawn state — not persisted. (ondev-b) */
  seedPrompt?: string;
}

export interface FeedEntry {
  agentId: string;
  text: string;
  ts: number;
}

/** A message the user has parked for an agent while its terminal was busy.
 *  Queued messages are drained one at a time when the agent next goes idle (see
 *  useHive's flush loop). */
export interface QueuedMessage {
  id: string;
  text: string;
  /** epoch ms the message was queued — drives ordering and the "queued 2m ago" hint */
  ts: number;
  /** Slack-originated: thread coordinates so the office can reply in-thread. */
  slack?: { channel: string; thread_ts: string };
  /** Optional override for the text actually typed into the agent's PTY. When set,
   *  the drain submits THIS instead of `text`, while UI/card surfaces keep using
   *  `text`. Used by Slack-origin work to carry the autonomy preamble to god's
   *  prompt without polluting the human-readable kanban card title (= raw `text`). */
  instruction?: string;
  /** An owner question from the dock (michael-replies.md, R6): typed means
   *  Michael has it; the drain reports delivery and a drop by this id. */
  ownerRequestId?: string;
  /** User clicked "send now" while floor-wide auto-delivery was paused. Bypasses
   *  ONLY the pause gate in the drain loop — idle/draft/picker safety still hold,
   *  so it delivers the moment the terminal is actually free. */
  manual?: boolean;
  /** Delivery-time precondition, re-checked by the drain immediately before the
   *  message is typed; a message whose precondition no longer holds is DROPPED
   *  rather than deferred (deferring would park it at the queue head forever and
   *  starve everything behind it).
   *
   *  Exists because a queued message is evaluated at enqueue time but delivered
   *  an arbitrary interval later, and some messages are only worth sending if the
   *  world they described still exists. 'inbox-nonempty' is the inbox-wake nudge:
   *  the agent can drain its whole inbox in the same turn the nudge was queued
   *  from, and delivering it afterwards costs a full turn to discover nothing is
   *  there. Declarative (a string, not a closure) so it survives persistQueues. */
  precondition?: 'inbox-nonempty';
    /** Token count captured when a /compact was enqueued for this agent, carried
   *  through to the point of successful delivery so the "already compacted at
   *  N tokens" latch (see useHive) can be written there instead of at enqueue
   *  time. Enqueue time is too early: a /compact stuck behind an undeliverable
   *  status would otherwise latch out every future compact attempt for a
   *  compaction that never actually happened. */
  compactUsed?: number;
}

// 'files' retired in v0.3.4 (the per-agent IDE button superseded it) — a
// persisted 'files' selection falls back to 'terminal' on load. 'git' added in
// v0.3.4: at-a-glance branch/status/log without opening the IDE.
export type SidebarTab = 'profile' | 'capabilities' | 'terminal' | 'messages' | 'memory' | 'traces' | 'git';

/** Lifecycle of the god agent ("Michael") bootstrap on launch.
 *  'booting' until his PTY is confirmed live, then 'ready' (or 'failed' if the
 *  spawn errored). The empty-floor UI shows a loader while 'booting' so users
 *  don't see the "add agent" prompt before Michael has clocked in. */
export type GodStatus = 'booting' | 'ready' | 'failed';
/** What the right column shows: nothing, the Needs you board, or a person. */
export type RightColumn = 'closed' | 'board' | 'person';

interface State {
  agents: Agent[];
  /** Agents whose terminal was closed — retained + flagged, kept off the active
   *  roster/floor. The hive registry retains them durably; this mirrors them for
   *  the renderer's "Archived" view. */
  archivedAgents: Agent[];
  /** Workers from the previous session whose terminal died with the app (quit /
   *  crash). Kept with their full spawn recipe (id, cwd, model, command) so the
   *  user can one-click respawn them with the SAME agent id — memory, inbox and
   *  registry entry reattach by themselves. God/assistant are excluded (they
   *  auto-respawn). */
  restorableAgents: Agent[];
  selectedId: string | null;
  feeds: Record<string, string[]>;
  addAgentOpen: boolean;
  fullscreenAgentId: string | null;
  /** What the big floor area shows: the animated office, the task board (who
   *  is doing what, what is blocked, what is done), or the GRAPH of who talks
   *  to whom. Remembered per Mac. */
  floorView: FloorView;
  /** Files opened from a reply or an Ask me card, as tabs after Who talks to
   *  whom (docs/designs/open-file-tab.md). Never saved. */
  fileTabs: FileTab[];
  /** The file tab shown while `floorView` is 'file'. */
  activeFileTab: string | null;
  /** The fixed view the owner was on, to go back to when the last file tab closes. */
  lastFixedView: FixedView;
  /** Does the user work in focus mode by default? Persisted as a boolean, and
   *  written ONLY by an explicit toggle. Kept in the store rather than read once
   *  at construction because the roster arrives after the store does. */
  prefersFocusMode: boolean;
  /** Absolute path queued for the IDE to open on next mount. Consumed-and-cleared
   *  by IdePanel, which routes it the same way a tree click would (Monaco for
   *  source, preview for markdown, the viewer for images). */
  ideInitialFile: string | null;
  /** Whether the full-window IDE panel (file manager + Monaco editor + git diff)
   *  is open. Toggled from the title-bar IDE button; a global feature surface,
   *  independent of the per-agent sidebar Files/Git tabs. */
  ideOpen: boolean;
  /** WHICH agent the IDE was opened FOR — set by whoever opens it.
   *
   *  The IDE used to infer its workspace purely from `selectedId`, which is a
   *  guess that is usually right and occasionally wrong: `setFullscreen` puts an
   *  agent's terminal on screen WITHOUT selecting it, so hitting IDE from a
   *  fullscreen terminal could open a different agent's directory than the one
   *  being looked at. That was invisible while the title said only "IDE" and the
   *  folder name; it becomes a flatly wrong agent NAME once the title names one.
   *  Callers therefore state their intent, and `selectedId` stays as the
   *  fallback for anything that genuinely has no particular agent in mind. */
  ideAgentId: string | null;
  sidebarWidth: number;
  /** The person's or Michael's panel opens wide, centered over the office
   *  (wide panel WD6): the owner's choice, remembered on this computer, never
   *  set by the window's size. The Needs you board ignores it (WD1). */
  panelWide: boolean;
  setPanelWide: (on: boolean) => void;
  /** The 1:1 with Michael opens wide in the center (design review 2026-10-17,
   *  1A): its own choice, remembered on this computer, set only by its Open
   *  wide button (7A). */
  dockWide: boolean;
  setDockWide: (on: boolean) => void;
  /** Esc sent the wide 1:1 back to the side for now (6B); cleared on close. */
  dockSideForNow: boolean;
  setDockSideForNow: (on: boolean) => void;
  /** Who opened last, the 1:1 or the right column: that one takes the center
   *  (8A, shell/wideCenter.ts). Never remembered. */
  centerClaim: CenterClaim;
  sidebarTab: SidebarTab;
  godStatus: GodStatus;
  /** The office opening (DESIGN.md 7.24): the Clocking in card and the clock
   *  pill read it; TeamClockingIn.tsx moves it on (shell/clockingIn.ts). */
  opening: OfficeOpening;
  /** Per-agent outgoing message queue (agent id → messages awaiting delivery).
   *  Lets the user keep "talking" to a busy agent: messages park here and are
   *  drained to the terminal one-by-one once the agent is free. */
  messageQueues: Record<string, QueuedMessage[]>;
  /** Per-agent tool-call count this session — a lightweight activity/usage proxy
   *  shown in the command center (interactive sessions don't expose billed $). */
  toolCounts: Record<string, number>;
  bumpToolCount: (id: string) => void;
  setGodStatus: (status: GodStatus) => void;
  setOpening: (opening: OfficeOpening) => void;
  /** A Restore team run opens the office again, card and pill included. */
  reopenOffice: () => void;
  select: (id: string) => void;
  /** Closing time: who has gone home (confirmed or closed without). Empty when
   *  not closing. Nobody in it can be opened (docs/designs/closing-floor.md). */
  goneHome: string[];
  setGoneHome: (ids: string[]) => void;
  /** What the right column shows (docs/designs/needs-you-empty-state.md, eng
   *  R1): nothing ('closed', the office takes the window), the Needs you board,
   *  or the selected person's panel. A selection always exists (Michael at
   *  launch), so the column needs its own state. Starts closed; App opens the
   *  board whenever anything waits and nothing may close it then. */
  rightColumn: RightColumn;
  /** `claim: false` for the app's own opening (an ask arriving), which never
   *  takes the center from the 1:1 (8A counts the owner's actions only). */
  setRightColumn: (column: RightColumn, opts?: { claim?: boolean }) => void;
  /** Open the Needs you board from an owner action (the pill, the coral strip,
   *  a "for you" chip). Asks the board to put focus in a reply field (D10),
   *  on `taskId`'s card when given (D11). */
  openNeedsYou: (opts?: { taskId?: string }) => void;
  /** Bumped by openNeedsYou; the board focuses on each new seq. */
  needsYouFocus: { seq: number; taskId?: string } | null;

  updateAgent: (id: string, patch: Partial<Agent>) => void;
  /** Copy durable hive roles onto roster descriptions (and the reverse is a
   *  no-op when the roster already has a real job string). */
  syncDescriptionsFromRoles: (roles: Record<string, string>) => void;
  /** Replace the Role description and Work style of these agents, wherever they
   *  are on the floor (active, archived or waiting to be restored). */
  rewriteInstructions: (patches: Array<{ id: string; description: string; goal: string }>) => void;
  /** Persist a display-name change to both the hive registry and renderer roster.
   *  The agent id and all id-derived paths remain unchanged. */
  renameAgent: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  setAgentNote: (id: string, note: string) => void;
  pushFeed: (id: string, line: string) => void;
  /** Adds an agent's card. It also takes the focus unless `select: false`: a
   *  hire the owner just made should open, but agents the app starts on its own
   *  (restoring the team, a new business team's first start) must leave the
   *  focus where it is, which at launch is Michael. */
  addAgent: (agent: Agent, opts?: { select?: boolean }) => void;
  removeAgent: (id: string) => void;
  /** Archive an agent (its terminal was closed): move it from the active roster
   *  into `archivedAgents` with its PTY cleared. Retained + flagged, NOT deleted. */
  archiveAgent: (id: string) => void;
  /** Permanently forget an archived agent (drops the renderer entry only; the
   *  hive registry keeps its record). */
  removeArchivedAgent: (id: string) => void;
  /** Drop one agent from the restorable list (it was respawned or dismissed). */
  removeRestorableAgent: (id: string) => void;
  reorderAgents: (fromId: string, toId: string) => void; // move agent fromId into toId's slot (drag-reorder) and persist the new order
  /** One-shot request to open a Command-Center tab (e.g. the boss-room calendar
   *  → 'triggers'; 'tasks' and 'graph' switch the floor view instead). `seq`
   *  makes repeated identical requests distinct. */
  ccTabRequest: { tab: string; seq: number } | null;
  requestCommandCenterTab: (tab: string) => void;
  /** Every schedule in the office, as main last reported it (missions:list). */
  missions: ScheduledMission[];
  missionsStatus: 'loading' | 'ready' | 'error';
  setMissions: (missions: ScheduledMission[], status?: 'ready' | 'error') => void;
  /** Open Michael's Memory tab on one agent's memory: selects Michael, asks for
   *  the tab, and names the agent. The floor's GRAPH view uses it, since the
   *  graph no longer sits next to that tab. seq-keyed like ccTabRequest. */
  memoryFocusRequest: { agentId: string; seq: number } | null;
  openAgentMemory: (agentId: string) => void;
  /** Open a team member's Profile tab (their schedules), from Pulse. */
  openAgentProfile: (agentId: string) => void;
  /** The task whose detail overlay is open (rendered app-wide over the office
   *  floor — the card content grows: contracts, deps, the human Q&A trail). */
  taskDetailId: string | null;
  openTaskDetail: (id: string) => void;
  /** Open Edit {name} for a member from outside its panel (a Needs you card's
   *  Change engine, issue #326): its panel opens and Edit with it. */
  editAgentRequest: { agentId: string; engine: boolean; seq: number } | null;
  requestEditAgent: (agentId: string, opts?: { engine?: boolean }) => void;
  /** Edit opened for the request: it is used once (ship review 2026-10-17). */
  clearEditAgentRequest: () => void;
  closeTaskDetail: () => void;
  /** One-shot prefill for the Command Center's dispatch box (a task detail's
   *  "assign" from anywhere in the app). seq-keyed like ccTabRequest. */
  dispatchSeedRequest: { text: string; seq: number } | null;
  requestDispatchSeed: (text: string) => void;
  /** Unsent ASK ME answer drafts, keyed by task id — so switching tabs (which
   *  unmounts the ask-me view) doesn't eat a half-typed answer. */
  answerDrafts: Record<string, string>;
  setAnswerDraft: (taskId: string, text: string) => void;
  /** The picked option and each question's chip and line on an Ask me card,
   *  kept like a typed draft (docs/designs/ask-me-options.md, decision 3A). */
  answerPicks: Record<string, AnswerPick>;
  setAnswerPick: (key: string, pick: AnswerPick) => void;
  /** Unsent composer drafts, per agent — so switching agents (which remounts the
   *  composer) doesn't eat what the user was typing. */
  drafts: Record<string, string>;
  setDraft: (agentId: string, text: string) => void;
  /** Mirror of config.freeflowEnabled so the composer can show/hide the Free Flow
   *  mic button reactively (set by App on config load and by Settings on save). */
  freeflowEnabled: boolean;
  setFreeflowEnabled: (on: boolean) => void;
  /** Agents waiting for a restart so a change reaches them: email turned on
   *  (docs/designs/multi-mailbox.md, E2/E5) or their Claude connectors changed
   *  (docs/designs/claude-connectors.md, D2). Agent id -> when it was queued,
   *  why, and whether the owner pressed Restart now. Cleared once restarted. */
  pendingRestart: Record<string, PendingRestart>;
  setPendingRestart: (agentId: string, entry: PendingRestart | undefined) => void;
  /** Mirror of `!!config.groqApiKey` — boolean presence ONLY; the key value never
   *  enters the store. Lets the composer show the voice button disabled (with a
   *  "add a Groq key" tooltip) instead of hiding it. Set by App on config load and
   *  by Settings on save. */
  hasGroqKey: boolean;
  setHasGroqKey: (has: boolean) => void;
  /** Mirror of BYOK OpenAI key presence (boolean only — the key lives in the main
   *  secret broker, never the store). Gates the Realtime Michael voice toggle the
   *  way hasGroqKey gates the Free Flow mic. Set by App on load via
   *  window.cth.realtimeHasOpenAiKey(). */
  hasOpenAiKey: boolean;
  setHasOpenAiKey: (has: boolean) => void;
  /** Mirror of config.webhookTriggers — the inbound HTTP endpoints. Webhooks are
   *  editable from BOTH Settings → Connections and the Triggers tab, so neither
   *  surface keeps its own copy: both render off this list and both call the
   *  setter after persisting, and the other one repaints without a refetch.
   *  Seeded by App from getConfig() (main deep-fills the field on every read).
   *
   *  Holds per-endpoint secrets, because a secret is what the UI has to show for
   *  reveal/copy to mean anything. Renderer memory only — never persisted to
   *  localStorage or the roster file, never logged, masked in every surface. */
  webhookTriggers: WebhookTrigger[];
  setWebhookTriggers: (list: WebhookTrigger[]) => void;
  /** Mirror of config.orgTrigger (peer messaging between teammates' clone nodes).
   *  Same two-way contract as `webhookTriggers`, and the same handling for
   *  `apiKey` — in memory for the two surfaces that display it masked, nowhere
   *  else. Configuration only for now: no transport reads the key yet. */
  orgTrigger: OrgTriggerConfig;
  setOrgTrigger: (cfg: OrgTriggerConfig) => void;
  /** Park a message for an agent. Returns nothing; the flush loop delivers it.
   *  `meta.instruction`, when set, is what gets typed into the PTY instead of
   *  `text` (UI/card surfaces still show `text`). */
    enqueueMessage: (agentId: string, text: string, meta?: { slack?: { channel: string; thread_ts: string }; instruction?: string; precondition?: QueuedMessage['precondition']; compactUsed?: number; ownerRequestId?: string }) => void;
  /** Drop a single queued message (user removed it, or it was just delivered). */
  removeQueuedMessage: (agentId: string, messageId: string) => void;
  /** The conversation dock above the composer (michael-replies.md): open,
   *  and the owner question to show. */
  dockOpen: boolean;
  dockFocus?: string;
  /** Every explicit navigation, including reopening the same question. */
  dockNavigation: number;
  setDock: (open: boolean, focus?: string) => void;
  /** "Send now" while floor auto-delivery is paused: marks the message manual
   *  (drain bypasses the pause gate for it) and moves it to the queue front. */
  releaseQueuedMessage: (agentId: string, messageId: string) => void;
  /** Clear an agent's entire pending queue. */
  clearQueue: (agentId: string) => void;
  setAddAgentOpen: (open: boolean) => void;
  /** Validated manifests waiting for one-at-a-time human review. */
  hireQueue: HireReviewQueue;
  enqueuePendingHires: (manifests: readonly HireManifest[]) => void;
  finishPendingHire: () => void;
  clearPendingHires: () => void;
  setFullscreen: (id: string | null) => void;
  setFloorView: (view: FloorView) => void;
  /** Open a file's tab, or select it if it is open (keyed by main's real path). */
  openFileTab: (tab: Omit<FileTab, 'openedAt'>) => void;
  selectFileTab: (id: string) => void;
  closeFileTab: (id: string) => void;
  /** Move focus mode WITHOUT touching the preference. For the paths that re-home
   *  a focused agent that went away: the app is following the user, not being
   *  told what the user wants. `setFullscreen` is the explicit toggle. */
  refocusFullscreen: (id: string | null) => void;
  /** Re-apply the persisted preference now that the roster has changed. */
  restoreFocusMode: () => void;
  /** Open an absolute path in the IDE — the ONE way to show a file.
   *
   *  v0.4.5 removed a second, worse file surface (a fullscreen overlay wrapping
   *  a bare Monaco). It could not scroll, had no tabs, no tree, and no git, and
   *  every file it opened was one click from "open in IDE" anyway. Everything
   *  that used to open it now comes here, so there is exactly one editor to fix
   *  when an editor bug shows up. */
  openFileInIde: (absPath: string) => void;
  /** Open/close the IDE. `agentId` names the agent whose workspace it should
   *  show; omit it only when the caller truly has no specific agent (the IDE
   *  then falls back to the selection and says so in its title). */
  setIdeOpen: (open: boolean, agentId?: string | null) => void;
  setIdeInitialFile: (path: string | null) => void;
  setSidebarWidth: (px: number) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  /** Drop persisted agents whose PTY is no longer alive in the main process.
   *  Called once at startup so a renderer reload (e.g. after the laptop sleeps)
   *  restores still-running agents and only removes truly-dead ones. */
  reconcileWithLivePtys: (livePtyIds: string[]) => void;
}

const LS_SIDEBAR_WIDTH = 'cth.sidebarWidth';
const LS_SIDEBAR_TAB = 'cth.sidebarTab';
const LS_PANEL_WIDE = 'cth.panelWide';
const LS_DOCK_WIDE = 'cth.dockWide';
const LS_AGENTS = 'cth.agents';
const LS_ARCHIVED = 'cth.archivedAgents';
const LS_RESTORABLE = 'cth.restorableAgents';
const LS_SELECTED = 'cth.selectedId';
const LS_QUEUES = 'cth.messageQueues';
/** Which hive this origin's roster keys were last written for. See rosterSource.ts. */
const LS_ROSTER_HOME = 'cth.rosterHome';
const LS_FOCUS_MODE = 'cth.prefersFocusMode';
const LS_FLOOR_VIEW = 'cth.floorView';

/** Opening the right column on purpose (Needs you, a person, Michael's tabs)
 *  goes back to the office: Tasks, Pulse and Who talks to whom hide the column
 *  (owner, 2026-10-03; Pulse 2026-10-15). A file tab keeps it beside the file,
 *  so an Ask me card stays answerable while its file is read (open-file-tab.md, F1). */
function officeView(view: FloorView): { floorView?: FloorView } {
  if (view === 'office' || view === 'file') return {};
  try { window.localStorage.setItem(LS_FLOOR_VIEW, 'office'); } catch { /* per-Mac nicety only */ }
  return { floorView: 'office' };
}

export type FloorView = 'office' | 'tasks' | 'pulse' | 'graph' | 'file';
const initialFloorView: FloorView = (() => {
  try {
    const v = window.localStorage.getItem(LS_FLOOR_VIEW);
    return v === 'tasks' || v === 'graph' || v === 'pulse' ? v : 'office';
  } catch { return 'office'; }
})();

// Fields that are large or transient — not worth persisting across reloads.
// contextTokens/contextLimit describe a LIVE session; persisting them showed a
// dead session's context gauge after a restart until the poll caught up.
/** A team member's `action` while its terminal shows a prompt only a person can
 *  answer (a permission or a question). Team members read as "waiting", never
 *  "blocked", so this marker is what tells the panel to offer Talk 1:1
 *  (docs/designs/owner-talks-via-michael.md). */
export const ACTION_AT_PROMPT = 'waiting at a prompt';
/** What an agent's card and bubble say while it comes back after a launch, or
 *  starts for the first time: office words, not "reconnecting" or "starting
 *  up" (owner, 2026-09-27). Shown translated (actionText). */
export const ACTION_CLOCKING_IN = 'clocking in…';
/** An agent's action for display: the app's own captions in the owner's
 *  language, anything else as it is. */
export function actionText(action: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (action === ACTION_CLOCKING_IN) return t('office.activity.clockingIn');
  // The hook marks a finished agent "idle"; the office says it more kindly
  // (owner, 2026-09-27: "nothing to do").
  const plain = action.trim().toLowerCase();
  if (plain === 'idle') return t('office.activity.idle');
  // Engine words become office words (owner, 2026-09-30: "using Bash" confuses
  // a business owner). Only the words shown change; the stored action does not.
  const said = ownValue(OFFICE_WORDS, plain);
  if (said) return t(`office.activity.${said}`);
  const tool = toolOfAction(action);
  if (tool) return toolText(tool, t);
  return action;
}

/** Fixed captions the app sets, in office words (keys under office.activity). */
const OFFICE_WORDS: Record<string, string> = {
  'reading inbox': 'readingInbox',
  awaiting: 'waiting',
  'waiting at a prompt': 'waitingInput',
  'compacting context': 'compacting',
  'recreating terminal…': 'restarting',
  resumed: 'backAtIt',
  'revived after sleep': 'backAtIt',
  'worktree gone, using base repo': 'mainFolder',
  thinking: 'thinking',
  'running the floor': 'runningFloor'
};

/** Tools an engine reports, as named in hook events and terminal output. */
const KNOWN_TOOLS = /^(bash|bashoutput|killshell|read|write|edit|multiedit|notebookedit|grep|glob|ls|webfetch|websearch|task|agent|todowrite|skill|exitplanmode)$/i;

/** The tool behind an action: "using Bash" from a hook, or "bash npm test" /
 *  "read src/app.ts" from the terminal parser. */
export function toolOfAction(action: string): string | null {
  const using = /^using (\S+)/i.exec(action.trim());
  if (using) return using[1];
  const first = action.trim().split(/\s+/)[0] ?? '';
  if (KNOWN_TOOLS.test(first) || /^mcp__/.test(first)) return first;
  return null;
}

/** A tool call in words a business owner reads at a glance. */
export function toolText(tool: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const k = (key: string, opts?: Record<string, unknown>) => t(`office.activity.tool.${key}`, opts);
  const mail = /^mcp__md-mail__([a-z_]+)$/i.exec(tool);
  if (mail) return mail[1] === 'send' ? k('sendingEmail') : mail[1] === 'draft' ? k('draftingEmail') : k('checkingEmail');
  const mcp = /^mcp__(.+?)__(.+)$/i.exec(tool);
  if (mcp) {
    const server = mcp[1].replace(/^claude_ai_/i, '').replace(/[_-]+/g, ' ').trim();
    if (/quickbooks|qbo|intuit/i.test(server)) return k('inApp', { app: 'QuickBooks' });
    if (/calendar/i.test(server)) return k('calendar');
    if (/gmail|outlook|e?mail/i.test(server)) return k('checkingEmail');
    if (/^hive$/i.test(server)) return k('team');
    if (/browser|playwright|chrome|puppeteer/i.test(server)) return k('web');
    const app = server.split(' ').map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
    return k('inApp', { app });
  }
  switch (tool.toLowerCase()) {
    case 'bash': case 'bashoutput': case 'killshell': return k('computer');
    case 'read': return k('reading');
    case 'write': return k('writing');
    case 'edit': case 'multiedit': case 'notebookedit': return k('editing');
    case 'grep': case 'glob': case 'ls': return k('looking');
    case 'webfetch': return k('webPage');
    case 'websearch': return k('search');
    case 'task': case 'agent': return k('helper');
    case 'todowrite': return k('todo');
    case 'skill': return k('playbook');
    case 'exitplanmode': return k('plan');
    default: return k('working');
  }
}

/** What an agent is doing right now, for a card or a caption: its action, else
 *  the first words of the last prompt it was given (the studio label cards and
 *  panel headers, DESIGN.md 7.14). */
export function liveActivity(agent: Pick<Agent, 'action' | 'lastPrompt'>, fallback = ''): string {
  const action = (agent.action || '').trim();
  if (action) return action;
  const prompt = (agent.lastPrompt || '').trim();
  if (!prompt) return fallback;
  const out = prompt.split(/\s+/).slice(0, 6).join(' ');
  return out.length > 42 ? `${out.slice(0, 41)}…` : out;
}

type PersistedAgent = Omit<Agent, 'recentAssistantText' | 'recentTextTs' | 'blockReason' | 'contextTokens' | 'contextLimit' | 'seedPrompt' | 'actionDetail' | 'actionAt'>;

// ─── The roster mirror ──────────────────────────────────────────────────────
//
// localStorage is partitioned by ORIGIN, and the two ways this app runs do not
// share one: `npm run dev` serves the renderer from http://localhost:5173, a
// packaged build loads it from file://. So the roster — agents, their private
// notes, worktree paths, archived entries, parked queues — was invisible to
// whichever of the two you were not currently in, even though the hive on disk
// (sessions, memory, inboxes, tasks) was shared and intact the whole time.
//
// So we also mirror it to <harnessHome>/roster.json, which both sides reach by
// path. localStorage keeps being written byte-for-byte as before: it is the
// fallback when there is no file yet, and a standing backup afterwards. Main
// keeps every previous version of the file under roster-backups/.
const fileRoster = (() => {
  try { return window.cth?.rosterReadSync?.() ?? null; } catch { return null; }
})();

/** Which hive we are opening, and which one this origin's localStorage was last
 *  written for. Both read synchronously, for the same reason the roster is: the
 *  store is built at module load, so an async answer would arrive too late. */
const currentHome = (() => {
  try { return window.cth?.harnessHomeSync?.() ?? null; } catch { return null; }
})();
/** The office this store's roster was loaded for (null: none was set yet).
 *  App compares it with the office setup chooses; see rosterNeedsReload. */
export const ROSTER_BOOT_HOME: string | null = currentHome;
const storedHome = (() => {
  try { return window.localStorage.getItem(LS_ROSTER_HOME); } catch { return null; }
})();

const { useFileRoster, useLocalFallback } = chooseRosterSource({
  fileRoster,
  currentHome,
  storedHome
});

/** Claim this origin's roster keys for the hive we just opened. Written even
 *  when nothing loaded: from here on localStorage describes THIS hive, so the
 *  next hive we open knows not to adopt it. */
try {
  if (currentHome) window.localStorage.setItem(LS_ROSTER_HOME, currentHome);
} catch { /* noop */ }

/** The renderer's running copy of what should be on disk. Kept as a mutable
 *  mirror updated slice-by-slice rather than read back out of the store, because
 *  every persist* call happens INSIDE a zustand `set()` — `getState()` there
 *  still returns the pre-update state, so a snapshot built that way would
 *  reliably be one edit stale. */
const rosterMirror: {
  agents: PersistedAgent[];
  archived: PersistedAgent[];
  restorable: PersistedAgent[];
  queues: Record<string, QueuedMessage[]>;
  selectedId: string | null;
} = { agents: [], archived: [], restorable: [], queues: {}, selectedId: null };

let rosterFlush: ReturnType<typeof setTimeout> | null = null;

function flushRosterNow(): void {
  if (rosterFlush) { clearTimeout(rosterFlush); rosterFlush = null; }
  try {
    void window.cth?.rosterWrite?.({
      version: 1,
      savedAt: new Date().toISOString(),
      agents: rosterMirror.agents,
      archived: rosterMirror.archived,
      restorable: rosterMirror.restorable,
      queues: rosterMirror.queues,
      selectedId: rosterMirror.selectedId
    });
  } catch { /* the file is a mirror — localStorage already took the write */ }
}

/** Coalesce a burst of persist* calls into one disk write. Agent edits arrive in
 *  clusters (spawn writes agents + selection + queues in the same tick). */
function scheduleRosterFlush(): void {
  if (rosterFlush) return;
  rosterFlush = setTimeout(flushRosterNow, 500);
}

// Don't let a quit inside the debounce window drop the last edit. localStorage
// would still have it, but only for THIS origin — and the whole point is that
// the other origin can read it too.
try {
  window.addEventListener('beforeunload', flushRosterNow);
} catch { /* not a browser context (unit tests) */ }

function slimAgents(agents: Agent[]): PersistedAgent[] {
  return agents.map(({ recentAssistantText, recentTextTs, blockReason, contextTokens, contextLimit, seedPrompt, actionDetail, actionAt, ...rest }) => {
    void recentAssistantText; void recentTextTs; void blockReason; void contextTokens; void contextLimit; void seedPrompt; void actionDetail; void actionAt;
    return rest;
  });
}

function persistAgents(agents: Agent[], selectedId: string | null): void {
  const slim = slimAgents(agents);
  try {
    window.localStorage.setItem(LS_AGENTS, JSON.stringify(slim));
    window.localStorage.setItem(LS_SELECTED, selectedId ?? '');
  } catch { /* noop */ }
  rosterMirror.agents = slim;
  rosterMirror.selectedId = selectedId;
  scheduleRosterFlush();
}

/** Run-state an agent recomputes from its live pty on every reload. A patch made
 *  only of these is not worth a localStorage write; anything else is. Listed as
 *  the volatile set rather than the durable set on purpose — a new durable field
 *  then persists by default instead of being silently dropped. */
const VOLATILE_AGENT_FIELDS = new Set<keyof Agent>([
  'status', 'action', 'progress', 'currentStation', 'carrying',
  'recentAssistantText', 'recentTextTs', 'blockReason',
  'contextTokens', 'contextLimit', 'lastPrompt', 'actionDetail', 'actionAt'
]);

function touchesDurableAgentField(patch: Partial<Agent>): boolean {
  return Object.keys(patch).some((k) => !VOLATILE_AGENT_FIELDS.has(k as keyof Agent));
}

/** The persisted list for one slice: the shared file when it has a roster,
 *  otherwise this origin's localStorage — but only when that localStorage was
 *  written for this hive. Returns [] on anything malformed. */
function persistedSlice(
  key: string,
  fromFile: unknown[] | undefined
): PersistedAgent[] {
  if (useFileRoster) return Array.isArray(fromFile) ? (fromFile as PersistedAgent[]) : [];
  if (!useLocalFallback) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedAgent[]) : [];
  } catch {
    return [];
  }
}

function loadPersistedAgents(): Agent[] {
  try {
    const parsed = persistedSlice(LS_AGENTS, fileRoster?.agents);
    if (!parsed.length) return [];
    // Reset volatile run-state; the PTY stream / mock loop will repopulate it.
    return parsed.map((a) => ({
      ...a,
      progress: 0,
      status: 'idle',
      action: ACTION_CLOCKING_IN,
      currentStation: 'desk',
      carrying: undefined,
      recentTextTs: Date.now(),
    }));
  } catch {
    return [];
  }
}

function persistArchived(archived: Agent[]): void {
  const slim = slimAgents(archived);
  try {
    window.localStorage.setItem(LS_ARCHIVED, JSON.stringify(slim));
  } catch { /* noop */ }
  rosterMirror.archived = slim;
  scheduleRosterFlush();
}

function loadPersistedArchived(): Agent[] {
  try {
    const parsed = persistedSlice(LS_ARCHIVED, fileRoster?.archived);
    if (!parsed.length) return [];
    // Archived agents have no live process — force the flag + clear run-state.
    return parsed.map((a) => ({
      ...a,
      archived: true,
      status: 'idle',
      ptyId: undefined,
      carrying: undefined,
      currentStation: undefined
    }));
  } catch {
    return [];
  }
}

function persistRestorable(restorable: Agent[]): void {
  // Keeps contextTokens/contextLimit, unlike the other two: a restorable entry
  // is a spawn recipe for a session that has not been re-entered yet, so its
  // last known context size is still meaningful.
  const slim: PersistedAgent[] = restorable.map(({ recentAssistantText, recentTextTs, blockReason, seedPrompt, actionDetail, actionAt, ...rest }) => {
    void recentAssistantText; void recentTextTs; void blockReason; void seedPrompt; void actionDetail; void actionAt;
    return rest;
  });
  try {
    window.localStorage.setItem(LS_RESTORABLE, JSON.stringify(slim));
  } catch { /* noop */ }
  rosterMirror.restorable = slim;
  scheduleRosterFlush();
}

function loadPersistedRestorable(): Agent[] {
  try {
    const parsed = persistedSlice(LS_RESTORABLE, fileRoster?.restorable);
    if (!parsed.length) return [];
    // No live process — clear run-state; the spawn recipe fields are what matter.
    return parsed.map((a) => ({
      ...a,
      status: 'idle',
      carrying: undefined,
      currentStation: undefined
    }));
  } catch {
    return [];
  }
}

function persistQueues(queues: Record<string, QueuedMessage[]>): void {
  try {
    // Only keep non-empty queues so the key stays small.
    const slim: Record<string, QueuedMessage[]> = {};
    for (const [id, q] of Object.entries(queues)) if (q.length) slim[id] = q;
    window.localStorage.setItem(LS_QUEUES, JSON.stringify(slim));
    rosterMirror.queues = slim;
    scheduleRosterFlush();
  } catch { /* noop */ }
}

function loadPersistedQueues(): Record<string, QueuedMessage[]> {
  try {
    const parsed = useFileRoster
      ? (fileRoster?.queues as Record<string, QueuedMessage[]> | undefined)
      : useLocalFallback
        ? JSON.parse(window.localStorage.getItem(LS_QUEUES) ?? 'null') as Record<string, QueuedMessage[]> | null
        : null;
    if (!parsed || typeof parsed !== 'object') return {};
    // Defensively keep only well-formed entries.
    const out: Record<string, QueuedMessage[]> = {};
    for (const [id, q] of Object.entries(parsed)) {
      if (Array.isArray(q)) {
        out[id] = q.filter((m) => m && typeof m.text === 'string' && typeof m.id === 'string');
      }
    }
    return out;
  } catch {
    return {};
  }
}

function loadPersistedSelectedId(agents: Agent[]): string | null {
  try {
    const id = useFileRoster
      ? fileRoster?.selectedId
      : useLocalFallback ? window.localStorage.getItem(LS_SELECTED) : null;
    // Every launch opens on Michael (owner, 2026-09-24). The saved selection
    // was usually just the last agent to start, since each start took focus.
    const god = agents.find((a) => a.isGod);
    if (god) return god.id;
    return id && agents.some((a) => a.id === id) ? id : (agents[0]?.id ?? null);
  } catch {
    return agents.find((a) => a.isGod)?.id ?? agents[0]?.id ?? null;
  }
}
const initialSidebarWidth = (() => {
  try {
    const v = window.localStorage.getItem(LS_SIDEBAR_WIDTH);
    const n = v ? parseInt(v, 10) : NaN;
    if (!Number.isNaN(n) && n >= 320 && n <= 1200) return n;
  } catch { /* noop */ }
  return 420;
})();
const initialPanelWide = (() => {
  try { return window.localStorage.getItem(LS_PANEL_WIDE) === '1'; } catch { return false; }
})();
const initialDockWide = (() => {
  try { return window.localStorage.getItem(LS_DOCK_WIDE) === '1'; } catch { return false; }
})();
const initialSidebarTab: SidebarTab = (() => {
  try {
    const v = window.localStorage.getItem(LS_SIDEBAR_TAB);
    if (v === 'profile' || v === 'capabilities' || v === 'terminal' || v === 'messages' || v === 'memory') return v;
    // A saved TRACES tab opens on Profile while this build hides traces.
    if (v === 'traces') return SHOW_TRACES ? v : 'profile';
    // Schedules is a section of Capabilities now (owner, 2026-09-26).
    if (v === 'schedules') return 'capabilities';
    // A saved GIT tab opens on the terminal while this build hides git.
    if (v === 'git') return SHOW_GIT ? v : 'terminal';
  } catch { /* noop */ }
  // First visit: the agent's Profile, the first tab (owner, 2026-09-25).
  return 'profile';
})();

/** Does the user want focus mode as their default view?
 *
 *  Persisted as a BOOLEAN, deliberately not as the focused agent's id. The id is
 *  meaningless across a restart: that agent may have been closed, or its PTY may
 *  not come back, and restoring a stale one lands us straight in the dangling
 *  reference `refocusAfterRemoval` exists to prevent. The preference is "I work
 *  in focus mode", so on load we resolve it against whoever is selected now. */
const initialPrefersFocusMode = (() => {
  try {
    return window.localStorage.getItem(LS_FOCUS_MODE) === '1';
  } catch { /* noop */ }
  return false;
})();


const initialAgents = loadPersistedAgents();
const initialArchivedAgents = loadPersistedArchived();
const initialRestorableAgents = loadPersistedRestorable();
const initialSelectedId = loadPersistedSelectedId(initialAgents);
const initialQueues = loadPersistedQueues();

// Prime the mirror with whatever we just loaded, so a later persist of ONE slice
// writes a complete file rather than blanking the slices it didn't touch.
rosterMirror.agents = slimAgents(initialAgents);
rosterMirror.archived = slimAgents(initialArchivedAgents);
rosterMirror.restorable = slimAgents(initialRestorableAgents);
rosterMirror.queues = initialQueues;
rosterMirror.selectedId = initialSelectedId;

// First run with the file: seed it from this origin's localStorage. Only when
// there is something to seed — writing an empty file here would hand a blank
// roster to the other side, which is precisely the outcome being designed out.
if (useLocalFallback && rosterMirror.agents.length + rosterMirror.archived.length + rosterMirror.restorable.length > 0) {
  scheduleRosterFlush();
}

let queuedSeq = 0;
/** Process-unique id for a queued message (timestamp + counter avoids collisions
 *  when several are queued within the same millisecond). */
function newQueuedId(): string {
  queuedSeq += 1;
  return `q-${Date.now()}-${queuedSeq}`;
}

export const useStore = create<State>((set, get) => ({
  agents: initialAgents,
  archivedAgents: initialArchivedAgents,
  restorableAgents: initialRestorableAgents,
  selectedId: initialSelectedId,
  feeds: {},
  addAgentOpen: false,
  ccTabRequest: null,
  memoryFocusRequest: null,
  // Every action that changes the panel asks the leave guard first, so Edit
  // agent's unsaved changes are never lost without asking (leaveGuard.ts).
  openAgentProfile: (agentId) => { attemptLeave({ selectedId: agentId, rightColumn: 'person' }, () => set((s) => {
    const seq = (s.ccTabRequest?.seq ?? 0) + 1;
    persistAgents(s.agents, agentId);
    return { selectedId: agentId, ccTabRequest: { tab: 'profile', seq }, rightColumn: 'person' as const, centerClaim: 'column' as const, ...officeView(s.floorView) };
  })); },
  openAgentMemory: (agentId) => { attemptLeave({ selectedId: get().agents.find((a) => a.isGod)?.id ?? get().selectedId, rightColumn: 'person' }, () => set((s) => {
    const god = s.agents.find((a) => a.isGod);
    const seq = (s.ccTabRequest?.seq ?? 0) + 1;
    const selectedId = god?.id ?? s.selectedId;
    persistAgents(s.agents, selectedId);
    return {
      selectedId,
      ccTabRequest: { tab: 'memory', seq },
      memoryFocusRequest: { agentId, seq },
      rightColumn: 'person' as const,
      centerClaim: 'column' as const,
      ...officeView(s.floorView)
    };
  })); },
  // 'human' was Michael's Ask me tab; in v2 Ask me is the Needs you board.
  requestCommandCenterTab: (tab) => {
    const s0 = get();
    // Not onto a person who has gone home at closing time (5A).
    const blocked = tab !== 'human' && !!s0.selectedId && !canOpen(s0.selectedId, s0.goneHome);
    attemptLeave(blocked ? null : { selectedId: s0.selectedId, rightColumn: tab === 'human' ? 'board' : 'person' }, () =>
      set((s) => tab === 'human'
        ? { rightColumn: 'board' as const, centerClaim: 'column' as const, ...officeView(s.floorView) }
        : s.selectedId && !canOpen(s.selectedId, s.goneHome)
          ? {}
          : { ccTabRequest: { tab, seq: (s.ccTabRequest?.seq ?? 0) + 1 }, rightColumn: 'person' as const, centerClaim: 'column' as const, ...officeView(s.floorView) }));
  },
  missions: [],
  missionsStatus: 'loading',
  setMissions: (missions, status = 'ready') => set({ missions, missionsStatus: status }),
  fullscreenAgentId: SHOW_FOCUS_MODE ? focusOnLoad(initialPrefersFocusMode, initialSelectedId) : null,
  prefersFocusMode: initialPrefersFocusMode,
  floorView: initialFloorView,
  fileTabs: [],
  activeFileTab: null,
  lastFixedView: initialFloorView === 'tasks' || initialFloorView === 'graph' || initialFloorView === 'pulse' ? initialFloorView : 'office',
  ideInitialFile: null,
  ideOpen: false,
  ideAgentId: null,
  sidebarWidth: initialSidebarWidth,
  panelWide: initialPanelWide,
  setPanelWide: (on) => {
    try { window.localStorage.setItem(LS_PANEL_WIDE, on ? '1' : '0'); } catch { /* noop */ }
    set(on ? { panelWide: on, centerClaim: 'column' } : { panelWide: on });
  },
  dockWide: initialDockWide,
  setDockWide: (on) => {
    try { window.localStorage.setItem(LS_DOCK_WIDE, on ? '1' : '0'); } catch { /* noop */ }
    set(on ? { dockWide: on, dockSideForNow: false, centerClaim: 'dock' } : { dockWide: on, dockSideForNow: false });
  },
  dockSideForNow: false,
  setDockSideForNow: (on) => set({ dockSideForNow: on }),
  centerClaim: null,
  sidebarTab: initialSidebarTab,
  godStatus: 'booting',
  messageQueues: initialQueues,
  toolCounts: {},
  bumpToolCount: (id) =>
    set((s) => ({ toolCounts: { ...s.toolCounts, [id]: (s.toolCounts[id] ?? 0) + 1 } })),
  setGodStatus: (status) => set({ godStatus: status }),
  opening: { kind: 'opening', since: Date.now() },
  setOpening: (opening) => set({ opening }),
  reopenOffice: () => set({ opening: { kind: 'opening', since: Date.now() } }),
  // A person who has gone home at closing time opens from nowhere (5A).
  select: (id) => { attemptLeave(canOpen(id, get().goneHome) ? { selectedId: id, rightColumn: 'person' } : null, () => set((s) => {
    if (!canOpen(id, s.goneHome)) return {};
    persistAgents(s.agents, id);
    return { selectedId: id, ccTabRequest: null, memoryFocusRequest: null, rightColumn: 'person', centerClaim: 'column', ...officeView(s.floorView) };
  })); },
  goneHome: [],
  setGoneHome: (ids) => set((s) => (ids.length === s.goneHome.length && ids.every((id) => s.goneHome.includes(id)) ? {} : { goneHome: ids })),
  rightColumn: 'closed',
  setRightColumn: (column, opts) => { attemptLeave({ selectedId: get().selectedId, rightColumn: column }, () => set(
    column !== 'closed' && opts?.claim !== false ? { rightColumn: column, centerClaim: 'column' } : { rightColumn: column }
  )); },
  openNeedsYou: (opts) => { attemptLeave({ selectedId: get().selectedId, rightColumn: 'board' }, () => set((s) => ({
    rightColumn: 'board',
    centerClaim: 'column',
    ...officeView(s.floorView),
    needsYouFocus: { seq: (s.needsYouFocus?.seq ?? 0) + 1, ...(opts?.taskId ? { taskId: opts.taskId } : {}) }
  }))); },
  needsYouFocus: null,

  updateAgent: (id, patch) =>
    set((s) => {
      // The pty parser calls this on every chunk of output, mostly with what
      // is already there: no change means no new state, so the studio and
      // everything else subscribed to `agents` skip the render.
      const current = s.agents.find((a) => a.id === id) as Record<string, unknown> | undefined;
      if (!current || Object.entries(patch).every(([k, v]) => Object.is(current[k], v))) return s;
      const agents = s.agents.map(a => a.id === id ? { ...a, ...patch } : a);
      // Persist only when something DURABLE changed. `updateAgent` is also the
      // pty parser's per-chunk write (status/action/progress), so persisting
      // unconditionally would rewrite localStorage on every burst of terminal
      // output. Persisting nothing was worse: a model or command change lived
      // only in memory, so the selector snapped back to the old model on reload
      // and restore relaunched the old command.
      if (touchesDurableAgentField(patch)) persistAgents(agents, s.selectedId);
      return { agents };
    }),
  syncDescriptionsFromRoles: (roles) =>
    set((s) => {
      const apply = (list: Agent[]): Agent[] => {
        let changed = false;
        const next = list.map((a) => {
          const description = preferredAgentRole(a.description, roles[a.id], !!a.isGod);
          if (description === a.description) return a;
          changed = true;
          return { ...a, description };
        });
        return changed ? next : list;
      };
      const agents = apply(s.agents);
      const archivedAgents = apply(s.archivedAgents);
      const restorableAgents = apply(s.restorableAgents);
      if (agents === s.agents && archivedAgents === s.archivedAgents && restorableAgents === s.restorableAgents) {
        return s;
      }
      persistAgents(agents, s.selectedId);
      if (archivedAgents !== s.archivedAgents) persistArchived(archivedAgents);
      if (restorableAgents !== s.restorableAgents) persistRestorable(restorableAgents);
      return { agents, archivedAgents, restorableAgents };
    }),
  rewriteInstructions: (patches) =>
    set((s) => {
      const byId = new Map(patches.map((p) => [p.id, p]));
      if (byId.size === 0) return s;
      const apply = (list: Agent[]): Agent[] =>
        list.some((a) => byId.has(a.id))
          ? list.map((a) => { const p = byId.get(a.id); return p ? { ...a, description: p.description, goal: p.goal } : a; })
          : list;
      const agents = apply(s.agents);
      const archivedAgents = apply(s.archivedAgents);
      const restorableAgents = apply(s.restorableAgents);
      if (agents !== s.agents) persistAgents(agents, s.selectedId);
      if (archivedAgents !== s.archivedAgents) persistArchived(archivedAgents);
      if (restorableAgents !== s.restorableAgents) persistRestorable(restorableAgents);
      return { agents, archivedAgents, restorableAgents };
    }),
  renameAgent: async (id, name) => {
    try {
      const result = await window.cth.hiveRenameAgent(id, name);
      if (!result.ok || !result.name) return { ok: false, error: result.error ?? 'Could not rename agent' };
      const nextName = result.name;
      const before = get();
      const previousName = [...before.agents, ...before.archivedAgents, ...before.restorableAgents].find((a) => a.id === id)?.name;
      // The old name, wherever the team's role lines and Work styles still
      // carry it, becomes the new one (renamePatches, hireTemplates.ts).
      const patches = previousName
        ? renamePatches([...before.agents, ...before.archivedAgents, ...before.restorableAgents], previousName, nextName)
        : [];
      const patchOf = new Map(patches.map((p) => [p.id, p]));

      set((s) => {
        const rename = (agents: Agent[]): Agent[] =>
          agents.map((agent) => {
            const patch = patchOf.get(agent.id);
            const next = patch ? { ...agent, ...patch } : agent;
            // Lines a closed hire released name them; a rename keeps them true (SR3).
            return agent.id === id
              ? { ...next, name: nextName, ...(next.releasedBindings ? { releasedBindings: next.releasedBindings.map((b) => ({ ...b, line: swapName(b.line, previousName, nextName) })) } : {}) }
              : next;
          });
        const agents = rename(s.agents);
        const archivedAgents = rename(s.archivedAgents);
        const restorableAgents = rename(s.restorableAgents);
        persistAgents(agents, s.selectedId);
        persistArchived(archivedAgents);
        persistRestorable(restorableAgents);
        return { agents, archivedAgents, restorableAgents };
      });
      // Michael routes by the role in the office registry: keep it in step.
      for (const p of patches) {
        if (p.description) void window.cth.hivePatchAgentRole(p.id, p.description).catch(() => undefined);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not rename agent' };
    }
  },
  setAgentNote: (id, note) =>
    set((s) => {
      const agents = s.agents.map((a) => a.id === id ? { ...a, note } : a);
      persistAgents(agents, s.selectedId);
      return { agents };
    }),
  pushFeed: (id, line) =>
    set((s) => ({ feeds: { ...s.feeds, [id]: [...(s.feeds[id] ?? []), line] } })),
  addAgent: (agent, opts) =>
    set((s) => {
      // Idempotent by id: a MAIN-initiated spawn broadcast (hive:agentSpawned, e.g.
      // a voice hire) and a renderer-initiated hire (AddAgentModal) can both call
      // addAgent for the same id — never render a duplicate card. The first writer
      // (richer local record) wins; the broadcast is a no-op for it.
      if (s.agents.some((a) => a.id === agent.id)) return s;
      // GOD enters at the HEAD, everyone else at the tail. Michael's position was
      // otherwise decided by a race he usually lost: useHive's bootstrap removes
      // the restored god entry, then spawns him asynchronously (a setTimeout, a
      // listPtys round-trip, and a --resume that seeds a transcript first), while
      // useRestoreTeam respawns last session's workers in parallel. Whoever
      // resolved first landed first, so a session with workers to restore put the
      // BOSS card fourth — and persistAgents() then wrote that order to disk, so
      // it stuck across restarts instead of flickering once.
      //
      // Fixed at insertion rather than by sorting at render time: the order has
      // drag-reorder (reorderAgents) whose whole point is a persisted manual
      // order, and a god-first sort at render time would silently override the
      // user's own arrangement every frame. This just makes the head the honest
      // default; a deliberate drag still wins and still persists.
      const agents = agent.isGod ? [agent, ...s.agents] : [...s.agents, agent];
      // Re-spawning an archived agent un-archives it: an id is active xor archived.
      const archivedAgents = s.archivedAgents.filter((a) => a.id !== agent.id);
      // A live (re)spawn also consumes any restorable entry for the same id.
      const restorableAgents = s.restorableAgents.filter((a) => a.id !== agent.id);
      const selectedId = opts?.select === false ? s.selectedId : agent.id;
      persistAgents(agents, selectedId);
      persistArchived(archivedAgents);
      if (restorableAgents.length !== s.restorableAgents.length) persistRestorable(restorableAgents);
      return {
        agents,
        archivedAgents,
        restorableAgents,
        selectedId,
        feeds: { ...s.feeds, [agent.id]: s.feeds[agent.id] ?? [] }
      };
    }),
  removeAgent: (id) =>
    set((s) => {
      const agents = s.agents.filter(a => a.id !== id);
      const { [id]: _gone, ...feeds } = s.feeds;
      const { [id]: _queueGone, ...messageQueues } = s.messageQueues;
      const selectedId = s.selectedId === id ? (agents[0]?.id ?? null) : s.selectedId;
      const fullscreenAgentId = refocusAfterRemoval(s.fullscreenAgentId, agents, selectedId);
      persistAgents(agents, selectedId);
      if (_queueGone) persistQueues(messageQueues);
      return { agents, feeds, selectedId, messageQueues, fullscreenAgentId };
    }),
  archiveAgent: (id) =>
    set((s) => {
      const target = s.agents.find((a) => a.id === id);
      if (!target) return s;
      const agents = s.agents.filter((a) => a.id !== id);
      // Retain a flagged copy; the PTY is gone, so clear all live run-state.
      const archivedEntry: Agent = {
        ...target,
        archived: true,
        ptyId: undefined,
        status: 'idle',
        action: 'archived',
        carrying: undefined,
        currentStation: undefined
      };
      const archivedAgents = [...s.archivedAgents.filter((a) => a.id !== id), archivedEntry];
      const { [id]: _feedGone, ...feeds } = s.feeds;
      const { [id]: _queueGone, ...messageQueues } = s.messageQueues;
      const selectedId = s.selectedId === id ? (agents[0]?.id ?? null) : s.selectedId;
      const fullscreenAgentId = refocusAfterRemoval(s.fullscreenAgentId, agents, selectedId);
      persistAgents(agents, selectedId);
      persistArchived(archivedAgents);
      if (_queueGone) persistQueues(messageQueues);
      return { agents, archivedAgents, feeds, selectedId, messageQueues, fullscreenAgentId };
    }),
  removeArchivedAgent: (id) =>
    set((s) => {
      if (!s.archivedAgents.some((a) => a.id === id)) return s;
      const archivedAgents = s.archivedAgents.filter((a) => a.id !== id);
      persistArchived(archivedAgents);
      return { archivedAgents };
    }),
  removeRestorableAgent: (id) =>
    set((s) => {
      if (!s.restorableAgents.some((a) => a.id === id)) return s;
      const restorableAgents = s.restorableAgents.filter((a) => a.id !== id);
      persistRestorable(restorableAgents);
      return { restorableAgents };
    }),
  reorderAgents: (fromId, toId) =>
    set((s) => {
      if (fromId === toId) return s;
      const from = s.agents.findIndex((a) => a.id === fromId);
      const to = s.agents.findIndex((a) => a.id === toId);
      if (from === -1 || to === -1) return s;
      const agents = [...s.agents];
      const [moved] = agents.splice(from, 1);
      agents.splice(to, 0, moved);
      // Persist the new roster order so it survives a reload (same slim key the
      // rest of the roster uses). selectedId is unchanged by a reorder.
      persistAgents(agents, s.selectedId);
      return { agents };
    }),
  taskDetailId: null,
  openTaskDetail: (id) => set({ taskDetailId: id }),
  editAgentRequest: null,
  requestEditAgent: (agentId, opts) => {
    get().select(agentId);
    // After the select applies, so Keep editing drops the request with it; the
    // panel clears it once it opens Edit (ship review 2026-10-17).
    afterLeave(() => set((s) => ({ editAgentRequest: { agentId, engine: !!opts?.engine, seq: (s.editAgentRequest?.seq ?? 0) + 1 } })));
  },
  clearEditAgentRequest: () => set({ editAgentRequest: null }),
  closeTaskDetail: () => set({ taskDetailId: null }),
  dispatchSeedRequest: null,
  requestDispatchSeed: (text) =>
    set((s) => ({ dispatchSeedRequest: { text, seq: (s.dispatchSeedRequest?.seq ?? 0) + 1 } })),
  answerDrafts: {},
  setAnswerDraft: (taskId, text) =>
    set((s) => ({ answerDrafts: { ...s.answerDrafts, [taskId]: text } })),
  answerPicks: {},
  setAnswerPick: (key, pick) =>
    set((s) => ({ answerPicks: { ...s.answerPicks, [key]: pick } })),
  drafts: {},
  setDraft: (agentId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [agentId]: text } })),
  freeflowEnabled: false,
  pendingRestart: {},
  setPendingRestart: (agentId, entry) => set((s) => {
    const next = { ...s.pendingRestart };
    // A second reason while one waits keeps the first time, so the 10 minute
    // ceiling never resets, and keeps 'connectors': turning email off clears
    // only an email restart, never one main asked for its connectors.
    if (entry === undefined) delete next[agentId];
    else {
      const prev = next[agentId];
      next[agentId] = prev ? { ...entry, at: prev.at, reason: prev.reason === 'connectors' ? 'connectors' : entry.reason } : entry;
    }
    return { pendingRestart: next };
  }),
  // Voice is off in this build (SHOW_VOICE): dictation stays off whatever is saved,
  // which hides the mic button and disarms hold Option.
  setFreeflowEnabled: (on) => set({ freeflowEnabled: SHOW_VOICE && on }),
  hasGroqKey: false,
  setHasGroqKey: (has) => set({ hasGroqKey: has }),
  hasOpenAiKey: false,
  setHasOpenAiKey: (has) => set({ hasOpenAiKey: has }),
  webhookTriggers: [],
  setWebhookTriggers: (list) => set({ webhookTriggers: list }),
  // A copy, not the shared DEFAULT_ORG_TRIGGER instance — main takes the same
  // care (withTriggerDefaults), and handing the module-level default out is how
  // one careless mutation rewrites the default for everyone.
  orgTrigger: { ...DEFAULT_ORG_TRIGGER },
  setOrgTrigger: (cfg) => set({ orgTrigger: cfg }),
  dockOpen: false,
  dockFocus: undefined,
  dockNavigation: 0,
  // Opening the 1:1 takes the center (8A); closing ends Esc's "for now" (7A).
  setDock: (open, focus) => set((s) => open
    ? { dockOpen: true, dockFocus: focus, centerClaim: 'dock', dockNavigation: s.dockNavigation + 1 }
    : { dockOpen: false, dockFocus: undefined, dockSideForNow: false, dockNavigation: s.dockNavigation + 1 }),
  enqueueMessage: (agentId, text, meta) =>
    set((s) => {
      const trimmed = text.trim();
      if (!trimmed) return s;
      // ONE PENDING COMPACT PER AGENT. Compaction is idempotent in the worst way:
      // the first `/compact` does the work and every one behind it answers
      // "nothing to compact", so a queue that accumulates them spends a delivery
      // slot and a model round-trip per copy to achieve nothing, and buries the
      // operator's real backlog behind them.
      //
      // The invariant lives HERE rather than at the call sites because there are
      // several — the context trigger, god dispatching a work order, Slack, the
      // composer — and each one that grew its own check could still be bypassed
      // by the next path someone adds. The context trigger's own check stays as
      // cheap defence in depth, but this is the one that cannot be routed around.
      const queued = s.messageQueues[agentId] ?? [];
      if (isCompactionCommand(trimmed) && queued.some((m) => isCompactionCommand(m.text))) {
        return s;
      }
      // ONE PENDING INBOX NUDGE PER AGENT — the same property, for the same
      // reason. The first nudge makes the agent drain its WHOLE inbox, so every
      // nudge queued behind it lands on a directory that agent has already
      // emptied and answers "nothing new": a delivery slot and a model
      // round-trip each, to say nothing. Mail arriving while an agent is mid-turn
      // queues one nudge per poll, so this is the common case rather than the
      // rare one, and the floor reports it as repeated empty-inbox wakes.
      // Suppressing the copy loses nothing — the surviving nudge sends the agent
      // to the same authoritative directory, where the newer mail is waiting too.
      if (isInboxNudge(trimmed) && queued.some((m) => isInboxNudge(m.text))) {
        return s;
      }
            const msg: QueuedMessage = {
        id: newQueuedId(), text: trimmed, ts: Date.now(),
        ...(meta?.slack ? { slack: meta.slack } : {}),
        ...(meta?.instruction ? { instruction: meta.instruction } : {}),
        ...(meta?.precondition ? { precondition: meta.precondition } : {}),
        ...(meta?.compactUsed !== undefined ? { compactUsed: meta.compactUsed } : {}),
        ...(meta?.ownerRequestId ? { ownerRequestId: meta.ownerRequestId } : {})
      };
      const messageQueues = { ...s.messageQueues, [agentId]: [...(s.messageQueues[agentId] ?? []), msg] };
      persistQueues(messageQueues);
      return { messageQueues };
    }),
  removeQueuedMessage: (agentId, messageId) =>
    set((s) => {
      const current = s.messageQueues[agentId];
      if (!current) return s;
      const next = current.filter((m) => m.id !== messageId);
      const messageQueues = { ...s.messageQueues, [agentId]: next };
      persistQueues(messageQueues);
      return { messageQueues };
    }),
  releaseQueuedMessage: (agentId, messageId) =>
    set((s) => {
      const current = s.messageQueues[agentId];
      const target = current?.find((m) => m.id === messageId);
      if (!current || !target) return s;
      const next = [
        { ...target, manual: true },
        ...current.filter((m) => m.id !== messageId)
      ];
      const messageQueues = { ...s.messageQueues, [agentId]: next };
      persistQueues(messageQueues);
      return { messageQueues };
    }),
  clearQueue: (agentId) =>
    set((s) => {
      if (!s.messageQueues[agentId]?.length) return s;
      const messageQueues = { ...s.messageQueues, [agentId]: [] };
      persistQueues(messageQueues);
      return { messageQueues };
    }),
  reconcileWithLivePtys: (livePtyIds) =>
    set((s) => {
      const live = new Set(livePtyIds);
      // Keep agents with no PTY (synthetic) or whose PTY is still alive.
      const agents = s.agents.filter((a) => !a.ptyId || live.has(a.ptyId));
      if (agents.length === s.agents.length) return s;
      // Workers whose terminal died with the previous session become restorable
      // (full spawn recipe retained) instead of silently vanishing. God and the
      // prep assistant are excluded — they auto-respawn at boot.
      const dead = s.agents.filter(
        (a) => a.ptyId && !live.has(a.ptyId) && !a.isGod && !a.isAssistant
      );
      const restorableAgents = [
        ...s.restorableAgents.filter((r) => !dead.some((d) => d.id === r.id)),
        ...dead
      ];
      const feeds: Record<string, string[]> = {};
      for (const a of agents) feeds[a.id] = s.feeds[a.id] ?? [];
      const selectedId = agents.some((a) => a.id === s.selectedId)
        ? s.selectedId
        : (agents[0]?.id ?? null);
      const fullscreenAgentId = refocusAfterRemoval(s.fullscreenAgentId, agents, selectedId);
      persistAgents(agents, selectedId);
      persistRestorable(restorableAgents);
      return { agents, feeds, selectedId, restorableAgents, fullscreenAgentId };
    }),
  setAddAgentOpen: (open) => set({ addAgentOpen: open }),
  hireQueue: EMPTY_HIRE_QUEUE,
  enqueuePendingHires: (manifests) => set((s) => ({
    hireQueue: enqueueHires(s.hireQueue, manifests)
  })),
  finishPendingHire: () => set((s) => ({
    hireQueue: finishCurrentHire(s.hireQueue)
  })),
  clearPendingHires: () => set((s) => ({
    hireQueue: clearHireQueue(s.hireQueue)
  })),
  setFloorView: (view) => {
    // A file tab is never saved: after a restart the app opens on the last
    // fixed view (open-file-tab.md, R4).
    if (view === 'file') { set({ floorView: view }); return; }
    try { window.localStorage.setItem(LS_FLOOR_VIEW, view); } catch { /* per-Mac nicety only */ }
    set({ floorView: view, lastFixedView: view });
  },
  // A file opened from Task detail would land behind that dialog, so the
  // dialog closes and the owner sees the file.
  openFileTab: (tab) => set((s) => ({ ...openTab(s, { ...tab, openedAt: Date.now() }), floorView: 'file', taskDetailId: null })),
  selectFileTab: (id) => set((s) => (s.fileTabs.some((f) => f.id === id) ? { activeFileTab: id, floorView: 'file' } : {})),
  closeFileTab: (id) => set((s) => {
    const r = closeTab(s, id);
    const floorView: FloorView = s.floorView !== 'file' ? s.floorView : r.select ?? s.lastFixedView;
    return { fileTabs: r.fileTabs, activeFileTab: r.activeFileTab, floorView };
  }),
  setFullscreen: (id) => {
    // Focus mode is hidden in this build: nothing opens it (buildFeatures.ts).
    if (id && !SHOW_FOCUS_MODE) return;
    // Entering focus mode makes it the default view; leaving it clears that.
    // Only an explicit toggle writes the preference, so an agent closing under
    // you never silently changes how the app opens next time. Every non-explicit
    // mover goes through `refocusFullscreen` instead.
    try { window.localStorage.setItem(LS_FOCUS_MODE, id ? '1' : '0'); } catch { /* noop */ }
    set({ fullscreenAgentId: id, prefersFocusMode: !!id });
  },
  refocusFullscreen: (id) => set({ fullscreenAgentId: id }),
  restoreFocusMode: () =>
    set((s) => {
      if (!SHOW_FOCUS_MODE) return s;
      const id = restoreFocus(s.prefersFocusMode, s.fullscreenAgentId, s.agents, s.selectedId);
      return id === s.fullscreenAgentId ? s : { fullscreenAgentId: id };
    }),
  openFileInIde: (absPath) => {
    if (!SHOW_IDE) return; // hidden in this build; callers show the file in Finder instead
    const s = get();
    // Resolve the OWNING agent here rather than in each caller: a terminal link
    // or a Files-tab click often has nothing selected, and the IDE would
    // otherwise fall back to the selection and open the wrong workspace.
    const owner = s.agents.find((a) => absPath === a.cwd || absPath.startsWith(a.cwd + '/'));
    set({ ideInitialFile: absPath, ideOpen: true, ideAgentId: owner?.id ?? null });
  },
  // Closing CLEARS the target: the id is scoped to one IDE session, and a stale
  // one left behind would silently win over the selection on the next open from
  // a caller that passes nothing.
  // With the IDE hidden (SHOW_IDE) nothing can open it, whichever caller asks.
  setIdeOpen: (open, agentId) => set({ ideOpen: open && SHOW_IDE, ideAgentId: open && SHOW_IDE ? (agentId ?? null) : null }),
  setIdeInitialFile: (path) => set({ ideInitialFile: path }),
  setSidebarWidth: (px) => {
    const clamped = Math.min(1200, Math.max(320, Math.round(px)));
    try { window.localStorage.setItem(LS_SIDEBAR_WIDTH, String(clamped)); } catch { /* noop */ }
    set({ sidebarWidth: clamped });
  },
  setSidebarTab: (tab) => {
    try { window.localStorage.setItem(LS_SIDEBAR_TAB, tab); } catch { /* noop */ }
    set({ sidebarTab: tab });
  }
}));

export function selectedAgent(s: State): Agent | undefined {
  return s.agents.find(a => a.id === s.selectedId);
}

/** Whether the Command Center's Trigger History tab has anything to be about
 *  yet: an organisation key is set, or at least one webhook exists. Derived from
 *  the two mirrors rather than stored beside them, so it cannot fall out of step
 *  with the thing it describes. Use as `useStore(triggerHistoryVisible)`. */
export function triggerHistoryVisible(s: State): boolean {
  return s.webhookTriggers.length > 0 || (SHOW_ORG_TRIGGER && s.orgTrigger.apiKey.trim() !== '');
}
