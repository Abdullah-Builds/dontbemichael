import { RESEARCH_ID } from '../../../shared/research';
import { startResearch } from '@/shell/research';
import { useEffect, useRef } from 'react';
import { useStore, type Agent, type QueuedMessage, type StationKind, type ToolKind } from '@/store/store';
import {
  buildSpawnCommand,
  ASSISTANT_MODEL,
  inferAgentProvider,
  isClaudeProvider,
  tokenizeCommand,
  type HarnessConfig
} from '@/store/config';
import { terminalReadyToReceive } from '../../../shared/providerAutomation';
import type { AgentProvider } from '../../../shared/agentProvider';
import { bridgeOf, providerPreset } from '../../../shared/agentProvider';
import { isDurableRole, MICHAEL_ROLE, preferredAgentRole, roleForHiveSpawn } from '../../../shared/agentRole';
import { inboxNudgeText } from '../../../shared/hiveNudge';
import { heldByBreak } from '../../../shared/officeBreak';
import { getOfficeBreak } from '@/components/OfficeBreakNotice';
import { resolveGodName } from '../../../shared/godIdentity';
import { acquireTerminal, resetTerminal, isTerminalAutomationSafe, hasTerminalDraft } from '@/components/terminalPool';
import { canDeliverToAgent, deliverWithAcknowledgement, checkPrecondition } from './queueDelivery';
import { RunningToolCalls } from './runningToolCalls';
import { OFFICE_CAST, DEFAULT_CHARACTER, HIREABLE_CAST, type OfficeCharacterName } from '@/scene/office/cast';
import { teamMemberName, teamMemberRole, teamMemberGoal, teamAccent, teamMemberStart, rewrittenInstructions, didNotStartNote } from '../../../shared/teamPlan';
import type { AgentDefinitionV2 } from '../../../shared/agentDefinition';
import { FIRST_TASK_EDITED_MAX, withoutLegacyFirstTask } from '../../../shared/firstTask';
import { firstTaskSection } from '../../../shared/workStyleText';
import { splitAgentRole } from '../../../shared/agentRole';
import { ACTION_AT_PROMPT, ACTION_CLOCKING_IN } from '@/store/store';
import { ENGINE_READY_EVENT } from '@/shell/useNeedsYou';
import { seedStarterJobs } from '@/shell/seedStarterJobs';
import { PromptSubmits, confirmSubmit } from '../../../shared/submitConfirm';
import { isTerminalPrompt } from '../../../shared/hookEvents';
import { cutText } from '@shared/cutText';

const GOD_ID = 'god';
/** Accent palette for MAIN-spawned (voice-hired) agents — picked deterministically
 *  from the agent id so the same agent always gets the same colour. Mirrors the
 *  AddAgentModal palette. */
const SPAWN_ACCENTS = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'] as const;
const GOD_PTY = `pty-${GOD_ID}`;

// Provider-agnostic PTY-quiescence idle fallback (#2e). A non-Claude bridge that
// fires a 'working' event but never its turn-end signal (Stop / session.idle /
// agent_end) would pin the agent 'working' forever → the idle-only inbox-wake nudge
// never fires → a god stops draining mail and the floor stalls. So a 'working'
// agent whose PTY has emitted NOTHING for this window is treated as turn-done and
// flipped idle. A streaming turn (incl. a long tool) keeps emitting bytes → stays
// working; only true silence drifts it idle. Hook events still win — a fresh
// PreToolUse/Stop refreshes status on the next event. Checked on QUIESCE_POLL_MS.
const QUIESCE_IDLE_MS = 12000;
const QUIESCE_POLL_MS = 4000;
// After a god/agent spawn, hold off the inbox-wake + queue-drain typers for this
// long while the readiness handshake + provider-specific boot sequence runs.
const BOOT_GRACE_MS = 35_000;
// Delay before typing a one-time TUI protocol seed into a fresh worker (3b) —
// long enough for the TUI to finish painting and surface any permission prompt.
// submitToPty additionally waits for the terminal's readiness handshake.
const SEED_BOOT_MS = 12_000;

/** Hive-aware / hooks-bridge engines get standing goals via HookServer
 *  (SessionStart + UserPromptSubmit). Cursor and other no-hook engines need the
 *  goal prepended onto queued PTY deliveries so an Edit Agent save still lands
 *  on the next drain cycle without a restart. */
function usesHookStandingGoal(agent: Agent): boolean {
  const provider = inferAgentProvider(agent.command, agent.provider);
  const preset = providerPreset(provider);
  if (preset.hiveAware) return true;
  return bridgeOf(provider)?.kind === 'hooks';
}

/** Prepend `<goal>…</goal>` for engines that cannot inject via hooks. Reads the
 *  live store field, so a just-saved goal is picked up on the next queue flush. */
function withStandingGoal(agent: Agent, text: string): string {
  const goal = agent.goal?.trim();
  if (!goal || usesHookStandingGoal(agent)) return text;
  if (text.includes('<goal>')) return text;
  return `<goal>\n${goal}\n</goal>\n\n${text}`;
}

// Per-pty submission chain. Every submitToPty for a given pty is appended here so
// two callers (e.g. the boot sequence's /remote-control and the inbox-wake nudge)
// can NEVER interleave their text + Enter — which jammed them onto one line and
// produced "Unknown command: /remote-control<next prompt>".
const writeChains = new Map<string, Promise<void>>();
const readyPids = new Map<string, number>();

async function waitForTerminalReady(
  ptyId: string,
  provider: AgentProvider,
  timeoutMs = 30_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const live = await window.cth.listPtys();
    const pty = live.find((entry) => entry.id === ptyId);
    if (!pty) throw new Error(`PTY exited before becoming ready: ${ptyId}`);
    if (readyPids.get(ptyId) === pty.pid) return;
    if (terminalReadyToReceive(pty.hasOutput, Date.now() - started, provider)) {
      readyPids.set(ptyId, pty.pid);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PTY did not become ready within ${timeoutMs}ms: ${ptyId}`);
}

/**
 * Type a line into an agent's Claude Code TUI and actually submit it.
 *
 * Writing the text and the carriage return in a single chunk makes the TUI
 * treat the whole thing as a paste, so the "\r" lands as a newline inside the
 * input box instead of submitting — the command just sits there as text. We
 * send the text first, then the Enter as a separate keystroke a tick later so
 * the prompt is registered and executed. Idle autonomous agents thus act on a
 * dispatched instruction on their own.
 *
 * Submissions to the same pty are serialized (and each settles for `settleMs`
 * after Enter) so concurrent callers can't jam their input together.
 *
 * The text is wrapped in bracketed-paste markers (ESC[200~ … ESC[201~) so the
 * TUI treats it as ONE paste: embedded newlines land as literal newlines in the
 * input box. Without them, every "\n" in a multi-line message acted as Enter —
 * the message submitted line-by-line in fragments (the agent saw only the last
 * chunk). The closing Enter, sent a tick later, submits the whole block. (#24) */
// When each agent last accepted a prompt (its UserPromptSubmit hook), so a
// submit can confirm it landed (shared/submitConfirm.ts).
const promptSubmits = new PromptSubmits();
// Each agent's tool calls still running, so parallel calls keep their detail.
const runningCalls = new RunningToolCalls();

function submitToPty(
  ptyId: string,
  text: string,
  provider: AgentProvider,
  settleMs = 250
): Promise<void> {
  const prev = writeChains.get(ptyId) ?? Promise.resolve();
  const next = prev.catch(() => { /* a failed prior write must not stall the chain */ }).then(async () => {
    await waitForTerminalReady(ptyId, provider);
    const typedAt = Date.now();
    // Bracketed paste (ESC[200~ … ESC[201~) only matters for MULTI-LINE text, so a
    // stray "\n" doesn't submit early (#24). Single-line text (nudges, slash
    // commands) is sent raw — some TUIs (Antigravity's agy) treat the paste
    // markers as literal input and never submit, so skipping them is more robust.
    const payload = text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text;
    // writePty NEVER rejects for a dead pty — it resolves { ok:false, error:
    // 'no pty: …' } — so an unchecked await here made every failed delivery look
    // successful (the queue-drain then destroyed the message it had already
    // popped, #36). Surface the failure as a rejection; the chain itself is
    // immune (the prev.catch above absorbs it for the next writer).
    const wrote = await window.cth.writePty(ptyId, payload);
    if (!wrote?.ok) throw new Error(wrote?.error ?? `pty write failed: ${ptyId}`);
    await new Promise((r) => setTimeout(r, 140));
    const submitted = await window.cth.writePty(ptyId, '\r');
    if (!submitted?.ok) throw new Error(submitted?.error ?? `pty write failed: ${ptyId}`);
    // Claude Code says when it accepts a prompt: wait for it, and press Enter
    // again if a slow terminal took the first one as part of the text.
    // Slash commands (/clear, /compact) are the TUI's own and fire no prompt hook.
    const agentId = isClaudeProvider(provider) && !text.trimStart().startsWith('/') ? useStore.getState().agents.find((a) => a.ptyId === ptyId)?.id : undefined;
    if (agentId) {
      const ok = await confirmSubmit({
        accepted: () => promptSubmits.since(agentId, typedAt),
        pressEnter: () => window.cth.writePty(ptyId, '\r'),
        stillSafe: () => isTerminalAutomationSafe(ptyId) && !hasTerminalDraft(ptyId)
          && !promptSubmits.attentionSince(agentId, typedAt)
      });
      if (!ok) console.warn(`[submit] ${agentId} did not accept the prompt after retries`);
    }
    await new Promise((r) => setTimeout(r, settleMs));
  });
  writeChains.set(ptyId, next);
  return next;
}

/** Wrap a user message as an enrich task for the assistant. The assistant's
 *  system prompt has the full instructions; this just frames the one task. */
function enrichTaskPrompt(text: string): string {
  return [
    `ENRICH TASK: ${text}`,
    '',
    '(Identify the relevant project, cd in, gather READ-ONLY context, then send the improved,',
    'self-contained prompt to Michael via an outbox message with "to":"god". Do not do the task yourself.)'
  ].join('\n');
}

function terminalWorkOrderPrompt(msg: {
  id: string;
  from: string;
  act: string;
  subject: string;
  body: string;
  requiresReply: boolean;
  createdAt: string;
}): string {
  return [
    'WORK ORDER FROM HIVE',
    `Message: ${msg.id}`,
    `From: ${msg.from}`,
    `Subject: ${msg.subject}`,
    `Act: ${msg.act}${msg.requiresReply ? ' (reply expected)' : ''}`,
    `Issued: ${msg.createdAt}`,
    '',
    msg.body,
    '',
    'Notes:',
    '- This arrived through your terminal because this provider does not support hive inbox.',
    '- Work in your current cwd.',
    '- When done, report changes, validation, blockers, and next step in this terminal.'
  ].join('\n');
}

/** Tool name → where the avatar walks + what it carries. */
const TOOL_STATION: Record<string, { station: StationKind; carry?: ToolKind }> = {
  Read: { station: 'shelf', carry: 'Read' },
  Edit: { station: 'desk', carry: 'Edit' },
  Write: { station: 'desk', carry: 'Write' },
  Bash: { station: 'terminal', carry: 'Bash' },
  Grep: { station: 'shelf', carry: 'Grep' },
  Glob: { station: 'shelf', carry: 'Glob' },
  WebFetch: { station: 'web', carry: 'WebFetch' },
  WebSearch: { station: 'web', carry: 'WebSearch' },
  TodoWrite: { station: 'board', carry: 'TodoWrite' },
  // #5A — delegating to a sub-agent reads as "handing off at the outbox".
  Task: { station: 'mailbox', carry: 'TodoWrite' }
};

/** Resolve a tool name to its station/glyph. Falls back: any `mcp__*` tool →
 *  the MCP station (previously these silently sat at the desk, #5A gap); anything
 *  else → the desk. */
function stationForTool(tool: string): { station: StationKind; carry?: ToolKind } {
  if (TOOL_STATION[tool]) return TOOL_STATION[tool];
  if (tool.startsWith('mcp__')) return { station: 'mcp', carry: 'MCP' };
  // Heuristic fallback for non-Claude tool names (Antigravity sends run_command,
  // ListDir, write_file, … — its hook names differ from Claude's exact tags).
  // Match write/edit BEFORE read so "write_file" → desk, not shelf.
  const t = tool.toLowerCase();
  if (/command|bash|shell|exec|terminal|run_/.test(t)) return { station: 'terminal', carry: 'Bash' };
  if (/web|fetch|browser|http|url/.test(t)) return { station: 'web', carry: 'WebFetch' };
  if (/write|edit|create|patch|replace|apply/.test(t)) return { station: 'desk', carry: 'Write' };
  if (/read|list|view|dir|glob|grep|search|find|file|cat|\bls\b/.test(t)) return { station: 'shelf', carry: 'Read' };
  return { station: 'desk' };
}

/**
 * Give every existing team member today's Role description and Work style,
 * ONCE (owner, 2026-09-25: "rewrite all"). roster.json is copied into
 * roster-backups/ first; if that copy fails, nothing is changed and the rewrite
 * is tried again next launch. The business's own pack wins for an id that more
 * than one pack holds. The Work style reaches a running agent on its next
 * prompt; the role in the registry reaches it at its next start.
 */
async function rewriteTeamInstructions(config: HarnessConfig): Promise<void> {
  if (config.instructionsRewritten) return;
  const { packs, core } = await window.cth.packsList();
  const own = packs.map((p) => p.pack).find((p) => p.businessType === config.businessType);
  const defs = new Map<string, AgentDefinitionV2>();
  for (const p of [own, ...packs.map((x) => x.pack), core]) {
    for (const a of p?.agents ?? []) if (!defs.has(a.id)) defs.set(a.id, a);
  }
  const floor = useStore.getState();
  const patches = rewrittenInstructions(
    [...floor.agents, ...floor.archivedAgents, ...floor.restorableAgents],
    defs,
    { name: config.businessName, city: config.businessCity }
  );
  if (patches.length > 0) {
    const backup = await window.cth.rosterBackup('instructions-rewrite').catch(() => ({ ok: false }));
    if (!backup.ok) return;
    useStore.getState().rewriteInstructions(patches);
    for (const p of patches) await window.cth.hivePatchAgentRole(p.id, p.description).catch(() => undefined);
  }
  await window.cth.updateConfig({ instructionsRewritten: true }).catch(() => undefined);
}

/**
 * The one-time cleanup of the First task text in team members' Work styles
 * (docs/designs/first-task-card.md, D1 and the ship review): a section that is
 * word for word a pack's old first task comes out with no card, since that
 * person has been working. One the owner edited becomes a first task card for
 * Michael and leaves the Work style; it stays in the Work style when the card
 * cannot be made, the text is too long for a card, or the hire is closed.
 */
async function removeLegacyFirstTasks(config: HarnessConfig): Promise<void> {
  if (config.firstTasksRemoved) return;
  const floor = useStore.getState();
  const team = [...floor.agents, ...floor.archivedAgents, ...floor.restorableAgents].filter((a) => !a.isGod);
  const manager = floor.agents.find((a) => a.isGod)?.name;
  const closed = new Set(floor.archivedAgents.map((a) => a.id));
  // The pack's own text comes out. A First task the owner edited becomes a
  // card Michael hands out, then leaves the Work style too (ship review
  // 2026-10-03, SR2): left there, the editor no longer showed it and the next
  // save dropped it without a word.
  const patches: Array<{ id: string; description: string; goal: string }> = [];
  const edited: Array<{ a: Agent; ask: string }> = [];
  const cleaned: Agent[] = [];
  for (const a of team) {
    const legacy = withoutLegacyFirstTask(a.goal, manager);
    if (legacy !== null) { patches.push({ id: a.id, description: a.description ?? '', goal: legacy }); cleaned.push(a); continue; }
    const section = a.goal ? firstTaskSection(a.goal) : null;
    // A closed hire cannot be handed a card, and a card holds at most
    // FIRST_TASK_EDITED_MAX characters: those keep their words where they are.
    if (!section?.body.trim() || closed.has(a.id) || section.body.trim().length > FIRST_TASK_EDITED_MAX) continue;
    edited.push({ a, ask: section.body.trim() });
    patches.push({ id: a.id, description: a.description ?? '', goal: section.without });
  }
  let retry = false;
  if (patches.length > 0) {
    const backup = await window.cth.rosterBackup('first-task-cleanup').catch(() => ({ ok: false }));
    if (!backup.ok) return;
    const keep = (id: string) => patches.splice(patches.findIndex((p) => p.id === id), 1);
    // Some old pack "first tasks", edited or not, were standing duties (the
    // daily special, the monthly note to past clients): the card's starter
    // jobs keep them on a schedule (ship review SR4, 2026-10-03). They are
    // added before the text comes out, so a failure keeps the words and the
    // cleanup runs again next launch; a closed hire's are added switched off,
    // as its other schedules are (Codex adversarial review, 2026-10-04).
    for (const a of cleaned) {
      if (!(await seedStarterJobs(a.sourceCard, a.id, { paused: closed.has(a.id) }))) { keep(a.id); retry = true; }
    }
    for (const { a, ask } of edited) {
      if (!(await seedStarterJobs(a.sourceCard, a.id))) { keep(a.id); retry = true; continue; }
      const sent = await window.cth.hiveFirstTask(a.sourceCard, a.id, a.name, { ask, role: splitAgentRole(a.description).role }).catch(() => ({ ok: false }));
      // Not on a card yet: keep it in the Work style rather than lose it.
      if (!sent.ok) keep(a.id);
    }
    if (patches.length > 0) useStore.getState().rewriteInstructions(patches);
  }
  if (!retry) await window.cth.updateConfig({ firstTasksRemoved: true }).catch(() => undefined);
}

/**
 * Start the team the owner picked during onboarding (Decisions 44, 47), ONCE.
 *
 * Each member is spawned exactly as the hire dialog spawns an agent — same
 * engine command, same hive provisioning — but inside its own folder and with
 * its pack's job description as its standing goal. `businessTeamStarted` stops
 * a second run of the whole team. Which members start, and in which folder, is
 * teamMemberStart's call (teamPlan.ts): the floor decides, and a member the
 * registry knows but the floor lost comes back in the folder it really works in.
 * A member that fails to start is skipped rather than blocking the rest, and is
 * saved in `businessTeamRetry`: each later launch tries those members, and only
 * those, so a member the owner removed is never started again.
 */
async function startBusinessTeam(config: HarnessConfig): Promise<void> {
  const team = config.businessTeam ?? [];
  // After the first run, only the members that failed to start are tried.
  const retry = config.businessTeamStarted ? new Set(config.businessTeamRetry ?? []) : undefined;
  // Research, when the owner picked it in the Team step (issue #230): started
  // with the first run even when no other member was picked.
  if (team.length === 0 || retry?.size === 0) {
    if (!retry) await startPickedResearch(config);
    return;
  }

  const { packs, core } = await window.cth.packsList();
  // The business's pack; when its type is unknown (an office continued from its
  // registry), the pack that holds the most of this team, so each member comes
  // back with its own business's job description.
  const teamIds = new Set(team.map((m) => m.agentId));
  const coverage = (p: { agents?: Array<{ id: string }> } | undefined) =>
    (p?.agents ?? []).filter((a) => teamIds.has(a.id)).length;
  const byTeam = config.businessType
    ? undefined
    // Core wins ties, so "Something else" (a team picked from core) stays on core.
    : packs.map((p) => p.pack).reduce<typeof core | undefined>((best, p) => (coverage(p) > coverage(best) ? p : best), core);
  const pack = packs.map((p) => p.pack).find((p) => p.businessType === config.businessType) ?? byTeam ?? core;
  // The business's own pack first, then every other pack: an office continued
  // from its registry may not know its business type, and its members must
  // still be found (a Kelly or a Dwight is not in the core pack).
  const defs = new Map<string, AgentDefinitionV2>();
  for (const p of [pack, ...packs.map((x) => x.pack), core]) {
    for (const a of p?.agents ?? []) if (!defs.has(a.id)) defs.set(a.id, a);
  }
  const reg = await window.cth.hiveRegistry().catch(() => null);

  const provider = inferAgentProvider(config.defaultCommand);
  // Same seed as the hire dialog: Claude reads defaultModel, other engines their
  // own entry (setup writes whichever Michael's pick needs).
  const model = isClaudeProvider(provider) ? config.defaultModel : config.providerDefaultModels?.[provider];
  const command = buildSpawnCommand(config, model, provider);
  const [exe, ...args] = tokenizeCommand(command.trim());
  const castName = (c?: string): OfficeCharacterName =>
    HIREABLE_CAST.some((m) => m.name === c) ? (c as OfficeCharacterName) : DEFAULT_CHARACTER;

  const failed: string[] = [];
  for (const [index, member] of team.entries()) {
    if (retry && !retry.has(member.agentId)) continue;
    const def = defs.get(member.agentId);
    if (!def) continue;
    const id = member.agentId;
    // The pack the card came from, in the same order defs was filled.
    const cardPack = [pack, ...packs.map((x) => x.pack), core].find((p) => p?.agents?.some((a) => a.id === id));
    const floor = useStore.getState();
    const floorIds = new Set([...floor.agents, ...floor.archivedAgents, ...floor.restorableAgents].map((a) => a.id));
    const decision = teamMemberStart(id, member.folder, floorIds, reg?.agents?.[id]?.cwd);
    if (!decision.start) continue;
    const workFolder = decision.cwd;
    const ptyId = `pty-${id}`;
    const name = teamMemberName(def);
    const role = teamMemberRole(def);
    const res = await window.cth.spawnPty({
      id: ptyId,
      cwd: workFolder,
      command: exe,
      provider,
      args,
      cols: 100,
      rows: 30,
      hive: { id, name, provider, cwd: workFolder, role }
    });
    if (!res.ok) {
      console.warn(`[team] ${name} did not start: ${res.error ?? 'unknown error'}`);
      failed.push(id);
      continue;
    }
    const folder = res.cwd || workFolder;
    // A first start, or a lost member brought back: the card appears, the focus
    // stays on Michael.
    useStore.getState().addAgent({
      id,
      name,
      character: castName(def.character),
      accent: teamAccent(index),
      description: role,
      project: folder.split(/[\\/]/).filter(Boolean).pop() ?? folder,
      tmuxTarget: '',
      cwd: folder,
      goal: teamMemberGoal(def, { name: config.businessName, city: config.businessCity }),
      status: 'idle',
      action: ACTION_CLOCKING_IN,
      progress: 0,
      currentStation: 'desk',
      ptyId,
      command: command.trim(),
      provider,
      model,
      seedPrompt: res.seedPrompt,
      recentTextTs: Date.now()
    }, { select: false });
    // The card's starter jobs, each with its focus area (inbox zero, 2026-10-03),
    // and its first task as a card Michael hands out (first-task-card.md).
    if (cardPack) {
      await seedStarterJobs(`${cardPack.businessType}/${id}`, id);
      // Only a true first start: a member the registry already knew has been
      // working, so it gets no first task (first-task-card.md D1). A retried
      // member never ran, even when its failed start registered it.
      if (retry || !reg?.agents?.[id]) await window.cth.hiveFirstTask(`${cardPack.businessType}/${id}`, id, name).catch(() => undefined);
    }
  }
  await window.cth.updateConfig({ businessTeamStarted: true, businessTeamRetry: failed }).catch(() => undefined);
  // Who did not start goes to Michael, who tells the owner; it was only logged.
  if (failed.length) {
    const note = didNotStartNote(failed.map((id) => teamMemberName(defs.get(id)!)), !!retry);
    await window.cth.hiveSend({ to: GOD_ID, act: 'inform', ...note }, 'system').catch(() => undefined);
  }
  if (!retry) await startPickedResearch(config);
}

/** Research, when the owner picked it in the Team step (issue #230). */
async function startPickedResearch(config: HarnessConfig): Promise<void> {
  if (!config.research?.on || useStore.getState().agents.some((a) => a.id === RESEARCH_ID)) return;
  const r = await startResearch(config);
  if (!r.ok) console.warn(`[team] Research did not start: ${r.error ?? 'unknown error'}`);
}

/**
 * The renderer-side glue for the hive:
 *   1. spawns the god agent into Michael's room when none is running,
 *   2. drives avatar state from real Claude Code hook events, and
 *   3. wakes idle agents that have unread inbox messages so collaboration
 *      doesn't stall while an agent sits at its prompt.
 */
/** Kill an agent's PTY and start it again on its prior CLI session (--resume),
 *  in its worktree if it has one. Shared by the sleep revive and by
 *  restart-on-enable for email (docs/designs/multi-mailbox.md, E2): the same
 *  flow as the "Restart & Continue" button. */
async function respawnResumed(a: Agent, ptyId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await window.cth.getConfig();
  // Isolated agents run inside their worktree (a.cwd is the base repo); re-enter
  // it if it still exists, else fall back to the base cwd, same as restoreTeam.
  let cwd = a.cwd;
  if (a.worktreePath && (await window.cth.gitIsRepo(a.worktreePath))) cwd = a.worktreePath;
  // A restart: the worktree it re-enters stays (ship review 2026-10-17).
  await window.cth.killPty(ptyId, { restart: true });
  // Soft-reset the pooled xterm in place (no-op if none): re-arm input and
  // clear the stale frame so the revived TUI paints clean, like the button.
  resetTerminal(ptyId);
  const provider = inferAgentProvider(a.command, a.provider);
  // Prefer the agent's exact recorded command (same model/flags); fall back to
  // a rebuilt one only if it predates the persisted `command` field.
  const command = (a.command ?? '').trim() || buildSpawnCommand(cfg, a.model, provider);
  const [exe, ...args] = tokenizeCommand(command);
  const hive = a.isGod
    ? { id: a.id, name: a.name, cwd, provider, isGod: true, role: roleForHiveSpawn(a) }
    : a.isAssistant
    ? { id: a.id, name: a.name, cwd, provider, isAssistant: true, role: roleForHiveSpawn(a) }
    : { id: a.id, name: a.name, cwd, provider, role: roleForHiveSpawn(a) };
  // Spawn at the terminal's real grid so the TUI's absolute cursor moves land
  // in the right cells (a size mismatch scatters the redraw).
  const entry = acquireTerminal(ptyId);
  let cols = 100, rows = 30;
  try { entry.fit.fit(); cols = entry.term.cols; rows = entry.term.rows; } catch { /* host not sized yet */ }
  return window.cth.spawnPty({
    id: ptyId,
    cwd,
    command: exe,
    provider,
    args,
    cols,
    rows,
    // The worktree (if any) already exists on disk: re-enter it, do NOT
    // re-isolate (that conflicts on the existing path/branch).
    isolate: false,
    // Reattach the agent's prior session so no context is lost.
    resume: true,
    hive
  });
}

export function useHive(config: HarnessConfig | null): void {
  // Per-agent dedup for the inbox-wake nudge: every inbox message id we have
  // already nudged this agent about. A SET, not a high-water mark.
  //
  // This used to hold one string — the lexicographically largest id in the inbox,
  // read as "the newest". Message ids are usually `<timestamp>-<rand>`, so that
  // held, but an agent may set its own `id` in the outbox JSON and the hive keeps
  // it verbatim (hive.ts normalize: `partial.id ?? ...`). One such id in god's
  // inbox — `dev15-progress-canvas-v4` — sorts above EVERY `2026-*` timestamp and
  // never drains, so the "newest" id was frozen on it: Michael was nudged once per
  // app launch and then never again, however much real mail piled up behind it.
  // Tracking the ids we have seen has no such ordering assumption, and it keeps
  // the property the high-water mark was there for: draining removes ids from the
  // INBOX without adding anything new, so a drain still produces no nudge.
  //
  // Note what this set does NOT do: it never shrinks. Ids accumulate for the life
  // of the window (a restart clears it), because forgetting an id we have already
  // nudged for would re-nudge the moment that message reappeared in a listing. The
  // cost is a few tens of bytes per message, which for a 24/7 floor is real but
  // negligible next to a stalled agent. Evicting ids that have left the inbox would
  // bound it exactly; deliberately not done here to keep this fix minimal.
  const nudged = useRef<Record<string, Set<string>>>({});
  // Per-agent timestamp of the last queued-message we submitted. Guards against
  // re-sending the next message before the agent's hooks have flipped it to
  // 'working' (there's a short window where it still reads 'idle' right after we
  // type into it). One message per cooldown keeps delivery strictly one-by-one.
  const lastFlush = useRef<Record<string, number>>({});
  // Queue-drain delivery tracking (#36): a message now stays IN the queue until
  // its PTY write chain resolves, so `inFlightSends` (message ids mid-write)
  // stops a store-update burst from double-sending the head, and `sendFailures`
  // bounds retries — after MAX_SEND_ATTEMPTS failed writes the message is
  // dropped WITH a console.warn instead of being silently destroyed.
  const inFlightSends = useRef<Set<string>>(new Set());
  const sendFailures = useRef<Record<string, number>>({});
  // In-flight spawn guard so a re-render / StrictMode double-mount can't spawn
  // Michael twice (the window between the listPtys check and spawnPty is racy).
  const godSpawning = useRef(false);
  // Per-agent timestamp until which auto-typers (inbox-wake #3, queue-drain #4)
  // must leave the agent alone — set while its boot sequence is typing so nothing
  // collides with /remote-control + the orientation prompt.
  const bootGraceUntil = useRef<Record<string, number>>({});
  // Agents whose one-time TUI protocol seed (Crush, seedDelivery:'type-into-tui')
  // has already been typed — guards effect #3b against re-seeding. (ondev-b)
  const seeded = useRef<Set<string>>(new Set());
  const seenTerminalHandoffs = useRef<Set<string>>(new Set());
  // Per-pty timestamp guarding auto-revive (effect #7) against a double-respawn
  // when power-resume + screen-unlock arrive back-to-back: an id revived (or
  // mid-revive) within REVIVE_DEBOUNCE_MS is skipped. Set BEFORE the async spawn
  // so a re-entrant event can't race a second respawn for the same id.
  const reviving = useRef<Record<string, number>>({});
  // Reactive so the assistant bootstrap (effect #1b) re-runs once Michael is ready.
  const godStatus = useStore((s) => s.godStatus);
  // Per-pty `lastOutputAt`, refreshed by the quiescence sweep (#2e) and read by
  // the queue drain (#4) so it can tell a terminal parked at its prompt from one
  // mid-turn. Kept here rather than fetched again in #4 — #2e already polls
  // listPtys on exactly the cadence the drain needs, and one reading keeps the
  // two loops from disagreeing about whether an agent is quiet.
  const ptyLastOutput = useRef<Record<string, number>>({});
    /** How long this terminal has been silent, or null when we have no reading
   *  (never polled, PTY gone, or it has emitted nothing at all). canDeliverToAgent
   *  fails closed on null — unmeasured silence is not evidence of silence.
   *  Hook-level (not effect-local) because both the drain effect and the
   *  context-trigger effect gate delivery through the same check. */
  const ptyQuietMs = (ptyId: string, now: number): number | null => {
    const last = ptyLastOutput.current[ptyId];
    return typeof last === 'number' && last > 0 ? now - last : null;
  };
  // #5C/#7C.4 — latest circuit-breaker level per agent. When 'constrained'/
  // 'stopped' the avatar is pinned to 'looping' and hook events must NOT flip it
  // back to 'working' (the flicker the spec calls out); only a genuine Stop clears it.
  const breakerLevel = useRef<Record<string, string>>({});

  // 0) Heal roster `description` from hive `role` when the floor caption was
  //    overwritten by a status string ("on standby") after hire.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    void window.cth.hiveRegistry().then((reg) => {
      const roles: Record<string, string> = {};
      for (const [id, entry] of Object.entries(reg.agents ?? {})) {
        if (typeof entry.role === 'string' && entry.role.trim()) roles[id] = entry.role.trim();
      }
      useStore.getState().syncDescriptionsFromRoles(roles);
      const { agents, archivedAgents } = useStore.getState();
      for (const a of [...agents, ...archivedAgents]) {
        const next = preferredAgentRole(a.description, roles[a.id], !!a.isGod);
        if (isDurableRole(next) && next !== roles[a.id]) {
          void window.cth.hivePatchAgentRole(a.id, next);
        }
      }
    }).catch(() => { /* hive not ready yet */ });
  }, [config?.onboardingComplete]);

  // 1) Bootstrap the god agent (source of truth = live PTYs, to dodge restarts).
  useEffect(() => {
    if (!config?.onboardingComplete || !config.harnessHome) return;
    let cancelled = false;
    useStore.getState().setGodStatus('booting');
    const t = setTimeout(async () => {
      if (cancelled) return;
      const live = await window.cth.listPtys().catch(() => []);
      if (live.some((p) => p.id === GOD_PTY)) { // already running — keep restored entry
        if (!cancelled) useStore.getState().setGodStatus('ready');
        return;
      }
      // Synchronous guard (no await between check and set) → exactly one spawn.
      if (cancelled || godSpawning.current) return;
      godSpawning.current = true;
      useStore.getState().removeAgent(GOD_ID); // clear any stale restored entry

      // A prior rename (Edit Agent panel → renameAgent() → hive.ts's renameAgent())
      // persists straight into registry.json, so read it back here rather than
      // hardcoding DEFAULT_GOD_NAME below — otherwise a custom name reverts on
      // every respawn even though the registry still has it right.
      const reg = await window.cth.hiveRegistry().catch(() => null);
      const godName = resolveGodName(reg?.agents?.[GOD_ID]?.name);

      const godProvider = config.godProvider ?? 'claude';
      const godModel = config.godModel;
      const command = buildSpawnCommand(config, godModel, godProvider);
      const [exe, ...args] = tokenizeCommand(command.trim());
      // Decision 44: on a business install Michael works in the business folder,
      // his own private folder holding his team's (folderAccess.ts), not the
      // hive's plumbing. Main makes that call and reports where he started.
      // Older installs have none and keep the harness folder, exactly as before.
      const requestedCwd = config.businessFolder || config.harnessHome!;
      const res = await window.cth.spawnPty({
        id: GOD_PTY,
        cwd: requestedCwd,
        command: exe,
        provider: godProvider,
        args,
        cols: 100,
        rows: 30,
        // Restore Michael's prior conversation across an app restart. His session
        // id lives in the hive registry (recorded from his hooks), so the main
        // process attaches `--resume <id>`; a missing transcript falls back to a
        // fresh session. Without this the most important context on the floor —
        // the orchestrator's — was lost on every restart.
        resume: true,
        hive: { id: GOD_ID, name: godName, provider: godProvider, cwd: requestedCwd, isGod: true, role: MICHAEL_ROLE }
      });
      if (cancelled) { godSpawning.current = false; return; }
      if (!res.ok) { godSpawning.current = false; useStore.getState().setGodStatus('failed'); return; }
      const godCwd = res.cwd || requestedCwd;
      const god: Agent = {
        id: GOD_ID,
        name: godName,
        character: 'michael',
        accent: 'lemon',
        description: 'office manager: runs the floor, triages requests, and brings you only the critical calls',
        project: 'hive',
        tmuxTarget: '',
        cwd: godCwd,
        status: 'idle',
        action: 'running the floor',
        progress: 0,
        currentStation: 'desk',
        ptyId: GOD_PTY,
        command: command.trim(),
        provider: godProvider,
        model: godModel,
        isGod: true,
        recentTextTs: Date.now()
      };
      useStore.getState().addAgent(god);
      useStore.getState().setGodStatus('ready');
      // The team picked during onboarding starts once Michael is up, each member
      // inside its own folder. After this they restore like any hired agent.
      void rewriteTeamInstructions(config).catch(() => undefined).then(() => removeLegacyFirstTasks(config)).catch(() => undefined).then(() => startBusinessTeam(config));

      // Nothing is typed into Michael's terminal at start (owner cleanup,
      // 2026-09-25): his startup instructions cover orientation, and the standup
      // sent when the office opens (standupOnOfficeOpen) gives him his first turn
      // through the inbox. /remote-control is no longer switched on. Only an
      // engine that can't take its protocol on the command line (Crush) still
      // has it typed, on a fresh spawn, because that is its instructions.
      const resumedGod = res.resumed === true;
      if (res.seedPrompt && !resumedGod) {
        bootGraceUntil.current[GOD_ID] = Date.now() + BOOT_GRACE_MS;
        void (async () => {
          try { if (!cancelled) await submitToPty(GOD_PTY, res.seedPrompt!, godProvider); }
          catch { /* PTY may have died during startup */ }
          finally { bootGraceUntil.current[GOD_ID] = 0; }
        })();
      }
    }, 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [config?.onboardingComplete, config?.harnessHome]);

  // 2) Drive avatars from real hook events emitted by each agent's shim.
  useEffect(() => {
    return window.cth.onHiveHookEvent((e) => {
      if (!e.agentId) return;
      // A new Claude process (a start or a --resume, not a /compact or /clear)
      // has not been told about the mail already in its inbox: the nudge typed
      // into the process it replaced (signed out, wedged, killed) went with it.
      // Forget what this agent was nudged about, so the inbox wake (#3) names
      // that mail again. Without it, Michael restarted after the owner saved
      // an API key sat idle: the office open standup had been nudged into a
      // signed out Claude and was never named again.
      if (e.event === 'SessionStart' && (e.source === 'startup' || e.source === 'resume')) delete nudged.current[e.agentId];
      if (e.event === 'Notification' || e.event === 'PermissionRequest') promptSubmits.noteAttention(e.agentId);
      const { updateAgent, agents } = useStore.getState();
      const self = agents.find((a) => a.id === e.agentId);
      if (!self) return;
      // Breaker precedence (#5C): a constrained/stopped agent stays 'looping'
      // regardless of in-flight tool/prompt/compact events.
      const blevel = breakerLevel.current[e.agentId];
      const breakerArmed = blevel === 'constrained' || blevel === 'stopped';
      // Hook events are the authoritative status source for real agents (the
      // pty-stream parser only refines the on-floor action/station).
      if (e.event === 'PreCompact') {
        // #5C — agent entered /compact; show it's boxing up context, not frozen.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'compacting', action: 'compacting context', carrying: undefined, actionDetail: undefined, actionAt: Date.now() });
      } else if (e.event === 'PostCompact') {
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working', action: 'resumed', carrying: undefined, actionDetail: undefined, actionAt: Date.now() });
      } else if (e.event === 'PreToolUse' && e.tool) {
        // A blocked event means the hook denied this call; nothing ran.
        // Do not update the agent's working state or count a tool use for it.
        if (e.blocked) return;
        const m = stationForTool(e.tool);
        // Each tool call restarts the clock the closing-time rows show.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working', currentStation: m.station, carrying: m.carry, action: `using ${e.tool}`, actionDetail: e.detail, actionAt: Date.now() });
        if (e.toolUseId) runningCalls.start(e.agentId, e.toolUseId, { tool: e.tool, detail: e.detail, at: Date.now() });
        useStore.getState().bumpToolCount(e.agentId); // usage proxy for the command center
      } else if (e.event === 'PostToolUse' || e.event === 'PostToolUseFailure' || e.event === 'PostToolBatch' || e.event === 'UserPromptSubmit') {
        // A turn is in progress (prompt submitted / tool just finished) — keep
        // it working so it doesn't flicker idle between tool calls. The
        // finished tool's detail goes, so the closing-time row never shows a
        // tool that already ended as still running (owner, 2026-09-29).
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working', actionDetail: undefined, actionAt: Date.now() });
        // With parallel calls, the row goes back to the latest one still running.
        // A call that failed ends the same way, by its own id. A finished
        // batch ends every call it names, the ones the engine refused too.
        const toolEnded = e.event !== 'UserPromptSubmit';
        const running = toolEnded ? runningCalls.end(e.agentId, e.toolUseIds ?? e.toolUseId) : undefined;
        if (running && !breakerArmed) updateAgent(e.agentId, { action: `using ${running.tool}`, actionDetail: running.detail, actionAt: running.at });
        // Nothing still running: the row stops naming the tool that finished.
        else if (toolEnded && !breakerArmed) updateAgent(e.agentId, { action: 'thinking' });
        // The prompt landed: a submit waiting on it stops pressing Enter.
        if (e.event === 'UserPromptSubmit') { promptSubmits.note(e.agentId); runningCalls.clear(e.agentId); }
      } else if (e.event === 'PreInvocation') {
        // Antigravity (agy): the model is being called — it's thinking/working.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'working', action: 'thinking', actionDetail: undefined, actionAt: Date.now() });
      } else if (e.event === 'PostInvocation') {
        // agy's per-turn boundary. Unlike Claude, agy's Stop fires only on process
        // EXIT, so without this an agy worker would never register as idle and the
        // inbox-wake nudge (idle-only) could never reach it — its mail would sit
        // undrained. Treat it as idle; a follow-up tool/turn re-sets working.
        if (!breakerArmed) updateAgent(e.agentId, { status: 'idle', action: 'idle', carrying: undefined, actionDetail: undefined, actionAt: Date.now() });
      } else if (e.event === 'Stop' || e.event === 'SubagentStop') {
        // A blocked Stop means the agent is being re-engaged to process its
        // inbox — it's NOT idle, so keep it working until it genuinely stops.
        if (e.blocked) {
          if (!breakerArmed) updateAgent(e.agentId, { status: 'working', action: 'reading inbox', carrying: undefined });
        } else {
          // A genuine stop clears any breaker override — the run is over.
          breakerLevel.current[e.agentId] = 'healthy';
          runningCalls.clear(e.agentId);
          updateAgent(e.agentId, { status: 'idle', action: 'idle', carrying: undefined, actionDetail: undefined, actionAt: Date.now() });
        }
      } else if (e.event === 'Notification' && !breakerArmed) {
        // Claude Code fires Notification for two very different situations:
        //   1. it genuinely needs the human (a permission / approval prompt), or
        //   2. the prompt has merely gone idle ("Claude is waiting for your
        //      input") — i.e. the agent answered and has nothing queued.
        // Only (1) is a real "needs you". Treating (2) as blocked made Michael
        // march to the door with a red "!" right after finishing, so detect the
        // idle case and let him linger on the floor instead. One rule shared
        // with main (isTerminalPrompt): prompt types or permission messages.
        if (isTerminalPrompt(e)) {
          // Only the god agent escalates to the human; sub-agents are autonomous
          // and read as "waiting" (parked on god, not on you).
          updateAgent(e.agentId, self.isGod ? { status: 'blocked' } : { status: 'waiting', action: ACTION_AT_PROMPT, actionDetail: undefined, actionAt: Date.now() });
        } else {
          // Idle notification — responded, nothing to do. Linger, don't flag.
          updateAgent(e.agentId, { status: 'idle', action: 'idle', carrying: undefined, actionDetail: undefined, actionAt: Date.now() });
        }
      }
    });
  }, []);

  // 2b) Consume circuit-breaker state (#7C.4/#5C). Lane A's breaker policy (#6)
  //     pushes BreakerState on `control:breakerState`; this gives it PRECEDENCE
  //     over hook-derived status: a constrained/stopped agent is pinned to
  //     'looping' (see the breakerArmed guard above) until it genuinely Stops.
  useEffect(() => {
    return window.cth.onBreakerState((s) => {
      breakerLevel.current[s.agentId] = s.level;
      const { updateAgent, agents } = useStore.getState();
      if (!agents.some((a) => a.id === s.agentId)) return;
      if (s.level === 'constrained' || s.level === 'stopped') {
        updateAgent(s.agentId, { status: 'looping', action: s.reason || 'breaker armed', carrying: undefined });
      }
      // 'healthy'/'steering' clear the pin; the next hook event refreshes status.
    });
  }, []);

  // 2c) Context gauge backfill: poll each live agent's current context size
  //     (tokens) from its session transcript — only until the status line
  //     (effect 2d) has delivered exact numbers for that agent. A session that
  //     names its own window (a Codex rollout) has no status line, so it is
  //     sized by that window and polled for as long as it runs.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const sizedByPoll = new Set<string>();
    const poll = async () => {
      const { agents, updateAgent } = useStore.getState();
      for (const a of agents) {
        if (!a.ptyId) continue;
        // The status line pushes exact numbers after every response (effect
        // 2d) — this transcript poll only backfills agents whose status line
        // hasn't fired yet (e.g. freshly restored, no response so far).
        if (a.contextLimit !== undefined && !sizedByPoll.has(a.id)) continue;
        try {
          const ctx = await window.cth.agentContext(a.id);
          if (ctx === null) continue;
          const tokens = ctx.tokens;
          if (ctx.limit) {
            sizedByPoll.add(a.id);
            const progress = Math.max(0, Math.min(8, Math.round((tokens / ctx.limit) * 8)));
            updateAgent(a.id, { contextTokens: tokens, contextLimit: ctx.limit, progress });
            continue;
          }
          const hinted = /1m/i.test(a.model ?? '') ? 1_000_000 : 200_000;
          const limit = Math.max(hinted, tokens > 200_000 ? 1_000_000 : 0);
          const progress = Math.max(0, Math.min(8, Math.round((tokens / limit) * 8)));
          updateAgent(a.id, { contextTokens: tokens, progress });
        } catch { /* ignore — try again next tick */ }
      }
    };
    const t = setTimeout(poll, 3000); // first fill shortly after boot
    const iv = setInterval(poll, 15000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [config?.onboardingComplete]);

  // 2d) Push-based context gauge: the status-line shim forwards the session's
  //     EXACT context accounting (tokens + real window size) after every
  //     response — no probing, no transcript guesswork.
  useEffect(() => {
    return window.cth.onHiveContextUpdate(({ agentId, tokens, limit }) => {
      // Defense-in-depth: the main process already filters limit > 0, but the
      // renderer must not trust IPC blindly — limit 0 would put NaN progress
      // into the store (NaN survives the Math.min/max clamp).
      if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(tokens)) return;
      const progress = Math.max(0, Math.min(8, Math.round((tokens / limit) * 8)));
      useStore.getState().updateAgent(agentId, { contextTokens: tokens, contextLimit: limit, progress });
    });
  }, []);

  // 2e) Non-Claude providers cannot drain hive inbox. Direct hive mail to them
  //     arrives here as a terminal work order and is queued through the same
  //     idle-only PTY drain as human-composed messages.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    return window.cth.onHiveTerminalHandoff((msg) => {
      if (seenTerminalHandoffs.current.has(msg.id)) return;
      const { agents, enqueueMessage, messageQueues } = useStore.getState();
      const target = agents.find((a) => a.id === msg.to);
      if (target?.ptyId) {
        const marker = `Message: ${msg.id}`;
        if ((messageQueues[target.id] ?? []).some((queued) => queued.text.includes(marker))) return;
        seenTerminalHandoffs.current.add(msg.id);
        enqueueMessage(target.id, terminalWorkOrderPrompt(msg));
        return;
      }
      seenTerminalHandoffs.current.add(msg.id);
      enqueueMessage(
        GOD_ID,
        [
          `Terminal handoff failed for ${msg.to}: ${msg.subject}`,
          '',
          `Message ${msg.id} from ${msg.from} could not be queued because ${msg.to} has no live PTY. Route it manually or respawn the agent.`
        ].join('\n')
      );
    });
  }, [config?.onboardingComplete]);

  // 2e) PROVIDER-AGNOSTIC PTY-QUIESCENCE IDLE FALLBACK (the linchpin that makes
  //     canReceiveInbox:true safe for the live-unverified OpenCode/Crush/pi bridges).
  //     Hook events are the authoritative status source, but a bridge whose turn-end
  //     signal (Stop/session.idle/agent_end) doesn't fire leaves the agent pinned
  //     'working' — and BOTH delivery paths (#3 nudge, #4 queue-drain) are idle-gated,
  //     so the agent silently stops draining mail. usePtyParser has a 4s idle drift,
  //     but it's Claude-TUI-tuned AND only runs for the mounted terminal — a
  //     backgrounded god gets none. This is the floor-wide, provider-agnostic backstop:
  //     it reads each live PTY's lastOutputAt (already tracked in the main process) and
  //     flips any 'working' agent quiet for QUIESCE_IDLE_MS to idle so the nudge can
  //     drain it. Safe because a genuinely-working agent (incl. a long streaming tool)
  //     keeps emitting bytes; a false idle self-corrects on the next hook event.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const iv = setInterval(async () => {
      const ptys = await window.cth.listPtys().catch(() => []);
      const lastOut: Record<string, number> = {};
      for (const p of ptys) lastOut[p.id] = p.lastOutputAt;
      // Publish BEFORE the early return and before the 'working' filter below,
      // so the drain (#4) also gets a reading for breaker-pinned agents — and so
      // a vanished PTY clears its entry instead of leaving a stale one.
      ptyLastOutput.current = lastOut;
      if (!ptys.length) return;
      const now = Date.now();
      const { agents, updateAgent } = useStore.getState();
      for (const a of agents) {
        if (!a.ptyId || a.status !== 'working') continue;
        // Never fight the breaker pin (a constrained/stopped agent stays 'looping')
        // or a still-booting agent (its boot sequence is mid-type).
        const bl = breakerLevel.current[a.id];
        if (bl === 'constrained' || bl === 'stopped') continue;
        if ((bootGraceUntil.current[a.id] ?? 0) > now) continue;
        const last = lastOut[a.ptyId];
        if (typeof last === 'number' && last > 0 && now - last > QUIESCE_IDLE_MS) {
          updateAgent(a.id, { status: 'idle', action: 'idle', carrying: undefined });
        }
      }
    }, QUIESCE_POLL_MS);
    return () => clearInterval(iv);
  }, [config?.onboardingComplete]);

  // 3) Wake agents holding unread inbox messages. The assistant is send-only
  //    (it never receives inbox mail), so it's excluded.
  //
  //    QUEUES the nudge rather than typing it. This loop used to write straight
  //    into the terminal, which made it the one automatic writer that could land
  //    on top of whatever the user was typing — its text fused onto the user's
  //    half-written line and the pair got submitted as one garbled prompt. Going
  //    through the queue means effect #4 owns every decision about when a
  //    terminal may be typed into: idle, off cooldown, past boot grace, delivery
  //    not paused, and no user draft in the way. One gate, one place, and this
  //    loop stops needing prompt logic of its own. /compact (effect #6) has
  //    always worked this way.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const iv = setInterval(async () => {
      const agents = useStore.getState().agents.filter((a) => a.ptyId);
      for (const a of agents) {
        try {
          const inbox = await window.cth.hiveInbox(a.id);
          // Nudge on any id we have not nudged for yet (#130's per-id Set).
          // Draining shrinks the set and introduces nothing new, so this POLL
          // stays quiet; a genuinely new message fires regardless of how its id
          // happens to sort.
          //
          // That reasoning covers the poll only — it does NOT survive the gap
          // between enqueue and delivery, which is why the nudge carries an
          // 'inbox-nonempty' precondition that the drain re-checks before typing.
          // Without it: mail lands and queues a nudge, the already-awake agent
          // drains the whole inbox in that same turn, and the nudge is typed into
          // an empty inbox afterwards — a wasted turn, and the most expensive one
          // on the floor when the agent is god.
          const seen = nudged.current[a.id] ?? (nudged.current[a.id] = new Set());
          const fresh = inbox.filter((m) => m.id && !seen.has(m.id));
          if (fresh.length) {
            // Name the ids: the nudge is queued now and typed whenever the agent
            // next goes idle, so it can arrive long after the agent drained and
            // filed this very mail. Carrying the ids is what lets it tell
            // "already handled" from "woken for nothing". The queue keeps only
            // one nudge pending per agent (see enqueueMessage), so a suppressed
            // copy's ids stay unnamed — hence the text points at the pending
            // inbox as the authority rather than at the list.
            useStore.getState().enqueueMessage(
              a.id,
              inboxNudgeText(fresh.map((m) => m.id)),
              { precondition: 'inbox-nonempty' }
            );
            for (const m of fresh) seen.add(m.id);
          }
        } catch { /* ignore */ }
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [config?.onboardingComplete]);

  // 3b) Seed a fresh "type-into-tui" worker (Crush) with the hive protocol. Its
  //     bare TUI rejects a positional seed (Cobra reads it as a subcommand →
  //     `Unknown command`), so the main process spawns it bare and hands the
  //     protocol back as `seedPrompt`; we TYPE it as the worker's first turn after a
  //     boot-grace (TUI finished painting), ONCE per agent. Routed through the SAME
  //     per-pty submit chain + boot-grace as the inbox-wake nudge so the seed and a
  //     nudge can never jam onto one line. (god-as-Crush is seeded in its own boot
  //     sequence above; this covers workers.) (ondev-b)
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const iv = setInterval(() => {
      const { agents, updateAgent } = useStore.getState();
      for (const a of agents) {
        if (!a.ptyId || a.isGod || !a.seedPrompt || seeded.current.has(a.id)) continue;
        seeded.current.add(a.id);
        const ptyId = a.ptyId;
        const seed = a.seedPrompt;
        // Hold the nudge/quiesce typers off this agent until the seed lands + settles.
        bootGraceUntil.current[a.id] = Date.now() + BOOT_GRACE_MS;
        // Clear the record now so it isn't re-seen (the ref also guards) or persisted.
        updateAgent(a.id, { seedPrompt: undefined });
        setTimeout(() => {
          // Permission-prompt safety (#5): if the worker surfaced an approval /
          // needs-human prompt while its TUI booted ('waiting'/'blocked'), the
          // seed's trailing Enter would confirm it. Put the seed back and let a
          // later tick retry once the prompt clears; if the agent vanished
          // (killed mid-boot), don't type into its orphaned pty at all.
          const live = useStore.getState().agents.find((x) => x.id === a.id);
          if (!live) return;
          if (live.status === 'waiting' || live.status === 'blocked') {
            seeded.current.delete(a.id);
            useStore.getState().updateAgent(a.id, { seedPrompt: seed });
            return;
          }
          submitToPty(
            ptyId,
            withStandingGoal(live, seed),
            inferAgentProvider(live.command, live.provider)
          )
            .catch(() => { /* pty may have died */ });
        }, SEED_BOOT_MS);
      }
    }, 1500);
    return () => clearInterval(iv);
  }, [config?.onboardingComplete]);

  // 4) Drain each agent's queued messages to its terminal, one at a time, the
  //    moment the agent goes idle. This is what lets the user keep sending
  //    messages while the agent's "cloud terminal" is mid-run: the messages
  //    park in the store and get typed in (and submitted) as soon as it's free.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const FLUSH_COOLDOWN_MS = 4500;
    // A message that fails this many PTY writes (dead/crashed pty that the store
    // still thinks is idle) is dropped WITH a console.warn — bounded so the drain
    // never spins forever on a corpse, loud so the loss is diagnosable. (#113)
    const MAX_SEND_ATTEMPTS = 3;
    const inFlight = new Set<string>();
    const sendFailures: Record<string, number> = {};


    // Send the front of `srcId`'s queue into `target`'s pty (verbatim or wrapped),
    // gated on the target being idle, free of interactive menus, and off
    // cooldown. The queue item is acknowledged only after BOTH PTY writes
    // succeed; failures stay visible and retry automatically (bounded by
    // MAX_SEND_ATTEMPTS so the drain never spins forever on a corpse).
    const dispatch = async (
      srcId: string,
      target: Agent | undefined,
      wrap?: (m: QueuedMessage) => string
    ): Promise<{ sent: boolean; message?: QueuedMessage }> => {
      const { messageQueues, removeQueuedMessage } = useStore.getState();
      const next = messageQueues[srcId]?.[0];
      if (!next || !target?.ptyId) return { sent: false };
      const now = Date.now();
      // Idle, or breaker-pinned with a terminal that has genuinely gone quiet.
      // This gate is a don't-type-mid-stream safety check, so `manual` does NOT
      // bypass it — "send now" releases the auto-delivery PAUSE below, not this.
      if (!canDeliverToAgent(target.status, ptyQuietMs(target.ptyId, now), QUIESCE_IDLE_MS)) {
        return { sent: false };
      }
      const control = await window.cth.controlSnapshot(target.id);
      // The pause gate holds everything EXCEPT messages the user explicitly
      // released with "send now" (m.manual) — otherwise a paused floor leaves
      // the queue with no escape hatch at all. Idle/draft/picker safety below
      // still applies to manual messages; only the pause is bypassed.
      if (control?.autoDeliveryPaused && !next.manual) return { sent: false };
      // The Claude plan's usage limit holds the office (issue 124): nothing is
      // typed into a Claude terminal until the break ends. "Send now" still goes.
      if (heldByBreak(getOfficeBreak(), target.provider) && !next.manual) return { sent: false };
      // Hold queued messages until the target finishes its boot sequence.
      if ((bootGraceUntil.current[target.id] ?? 0) >= now) return { sent: false };
      // The user owns the prompt: a draft they are writing, or a menu they
      // opened, holds delivery. Both blocks expire after half an hour, and when
      // one does we simply type after whatever is there — automation never
      // erases the user's text and never closes the user's menu.
      if (!isTerminalAutomationSafe(target.ptyId, now)) return { sent: false };
      if (now - (lastFlush.current[target.id] ?? 0) < FLUSH_COOLDOWN_MS) return { sent: false };
      // Last gate before we type: re-check the message's delivery-time
      // precondition. A queue item is decided at enqueue time and delivered an
      // arbitrary interval later, and the inbox nudge is only worth sending if
      // there is still something in the inbox — the agent routinely drains it in
      // the very turn the nudge was queued from. Stale ones are DROPPED, not
      // deferred, so they cannot park at the queue head and starve the rest.
      if (await checkPrecondition(next, () => window.cth.hiveInbox(srcId)) === 'drop') {
        removeQueuedMessage(srcId, next.id);
        return { sent: false };
      }
      // Removed while the checks above ran (the owner withdrew a question, or
      // cleared the queue): never type it.
      if (!useStore.getState().messageQueues[srcId]?.some((m) => m.id === next.id)) return { sent: false };
      const flightKey = `${srcId}:${next.id}`;
      if (inFlight.has(flightKey)) return { sent: false };
      // Marked in flight first, in the same step as the check, so a second
      // flush can't pass while the claim below is on its way.
      inFlight.add(flightKey);
      lastFlush.current[target.id] = now;
      // An owner question is claimed in main before it is typed (Codex P1):
      // from then on it is Michael's (and in his every-turn list) even if this
      // window stops mid-typing, and a withdraw can no longer race it.
      if (next.ownerRequestId) {
        const claim = await window.cth.ownerDelivered(next.ownerRequestId).catch(() => ({ ok: false }));
        if (!claim.ok) { inFlight.delete(flightKey); removeQueuedMessage(srcId, next.id); return { sent: false }; }
      }
      try {
        const sent = await deliverWithAcknowledgement(
          // `instruction` (when present) is the authoritative text to type into
          // the PTY; UI/card surfaces continue to show the readable `text`.
          () => submitToPty(
            target.ptyId!,
            withStandingGoal(
              target,
              wrap ? wrap(next) : (next.instruction ?? next.text)
            ),
            inferAgentProvider(target.command, target.provider)
          ),
          () => {
            removeQueuedMessage(srcId, next.id);
            // Zero the gauge on a DELIVERED /clear — the new session's context
            // isn't known until statusLine fires after the first post-clear
            // response, so leaving it at the old value shows a stale-full bar.
            if (next.text.trim().toLowerCase() === '/clear') {
              useStore.getState().updateAgent(target.id, {
                contextTokens: 0,
                contextLimit: undefined,
                progress: 0
              });
            }
          }
        );
        if (sent) {
          delete sendFailures[next.id];
          return { sent: true, message: next };
        }
        // Failed write (dead/crashed pty the store still thinks is idle): retry
        // on the next cooldown-spaced flush, but only MAX_SEND_ATTEMPTS times —
        // then drop LOUDLY so the loss is diagnosable. (#113/#36)
        const attempts = (sendFailures[next.id] ?? 0) + 1;
        sendFailures[next.id] = attempts;
        if (attempts >= MAX_SEND_ATTEMPTS) {
          delete sendFailures[next.id];
          removeQueuedMessage(srcId, next.id);
          // An owner question was claimed before typing, so Michael still has it
          // through his every-turn list of open owner questions.
          console.warn(
            `[queue-drain] dropping message ${next.id} for ${target.id} after ${attempts} failed pty writes ` +
            `("${next.text.slice(0, 80)}${next.text.length > 80 ? '…' : ''}")`
          );
        }
        return { sent: false };
      } finally {
        inFlight.delete(flightKey);
      }
    };

    // Promote a genuine Slack-origin work item to a stamped kanban card the first
    // time it's dispatched to the office. The card carries slack:{channel,thread_ts}
    // (origin thread) so the main-process done-observer can post its one summary
    // reply in-thread once the card later reaches 'done'. ADDITIVE + idempotent +
    // best-effort: a failure here never affects the dispatch that already happened,
    // and only dispatched work items land here (slash commands/acks never do).
    type SlackTaskCard = Parameters<typeof window.cth.hiveAddTask>[0];
    const ensureSlackCard = async (m: QueuedMessage): Promise<void> => {
      const slack = m.slack;
      if (!slack) return;
      try {
        const raw = await window.cth.hiveTasks();
        const existing: SlackTaskCard[] =
          raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)
            ? (raw as { tasks: SlackTaskCard[] }).tasks
            : [];
        const id = `slack-${slack.thread_ts}-${m.id}`;
        if (existing.some((t) => t.id === id)) return; // already promoted — no dup
        const title = cutText(m.text, 80);
        const card: SlackTaskCard = {
          id,
          title,
          description: m.text,
          status: 'todo',
          dependsOn: [],
          priority: 1,
          createdAt: new Date().toISOString(),
          slack
        };
        await window.cth.hiveAddTask(card);
      } catch { /* best-effort: card promotion must never sink dispatch */ }
    };

    const flush = () => {
      const { agents, messageQueues } = useStore.getState();
      const byId = (id: string) => agents.find((a) => a.id === id);
      const now = Date.now();

      for (const a of agents) {
        // Same gate as dispatch() — this pre-filter runs first, so relaxing only
        // the one inside dispatch would have changed nothing.
        if (!a.ptyId || !canDeliverToAgent(a.status, ptyQuietMs(a.ptyId, now), QUIESCE_IDLE_MS)) continue;
        if (!messageQueues[a.id]?.length) continue;
                void dispatch(a.id, a).then(({ sent, message }) => {
          if (sent && message?.slack) void ensureSlackCard(message);
        });
      }
    };

    // Run on every store change (status flips, new queue items) — debounced so a
    // burst of pty-stream updates coalesces — plus a periodic backstop.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) return;
      debounce = setTimeout(() => { debounce = null; flush(); }, 200);
    };
    const unsub = useStore.subscribe(schedule);
    const iv = setInterval(flush, 3000);
    schedule();
    return () => { unsub(); if (debounce) clearTimeout(debounce); clearInterval(iv); };
  }, [config?.onboardingComplete]);

  // 5) Pipe inbound Slack messages into Michael's queue. The main-process Slack
  //    webhook server pushes each verified message here via IPC; enqueueing to
  //    GOD_ID lands it in Michael's queue exactly as if the user had typed it
  //    into the composer — effect #4 above then drains it to his PTY.
  //    We immediately ack in the triggering thread and stash the thread coords
  //    so the office can post its summary back later.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    return window.cth.onSlackMessage((msg) => {
      const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;
      if (!msg?.text?.trim() && !hasFiles) return;
      let text = msg.text.trim();
      // Append local file paths so the agent (Claude Code) can Read them directly.
      if (hasFiles) {
        const fileLines = msg.files!.map((f) => `- ${f.path} (${f.name})`).join('\n');
        text = text ? `${text}\n\nAttached files:\n${fileLines}` : `Attached files:\n${fileLines}`;
      }
      const slack = { channel: msg.channel, thread_ts: msg.thread_ts };
      // `text` (raw user request + any attachment lines) drives the human-facing
      // kanban card title/description. The autonomy preamble — supplied verbatim
      // by main, the authoritative source — is prepended ONLY to god's working
      // instruction (what gets typed into his PTY), so the board stays readable
      // while every Slack-origin god-session runs under the autonomy policy. When
      // main sends no preamble (older build), god just gets the raw text.
      const instruction = msg.autonomyPreamble ? `${msg.autonomyPreamble}${text}` : undefined;
      useStore.getState().enqueueMessage(GOD_ID, text, { slack, instruction });
      // Immediate "queued" acknowledgement in the originating Slack thread.
      void window.cth.slackReply({
        channel: msg.channel,
        thread_ts: msg.thread_ts,
        text: ':hourglass_flowing_sand: *Received.* Your request has been queued. The team is on it and will reply here when done.'
      });
    });
  }, [config?.onboardingComplete]);

  // 5b) Pipe hive tasks addressed to non-Claude agents (e.g. Codex) into their
  //     terminal queues. When main routes a message to a non-claude provider it
  //     emits 'hive:enqueueToAgent' instead of bouncing; we enqueue the raw
  //     task text here so effect #4 types it into the REPL when the agent idles.
  //     No inbox nudge, no /compact — just the verbatim subject+body text.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    return window.cth.onHiveEnqueue?.((msg) => {
      if (!msg?.targetId || !msg?.text?.trim()) return;
      useStore.getState().enqueueMessage(msg.targetId, msg.text.trim());
    });
  }, [config?.onboardingComplete]);

  // 5b) MAIN-initiated roster changes (rt-5 voice spawn/kill). The renderer store is
  //     only mutated by renderer-initiated hires (AddAgentModal); a voice hire/kill
  //     runs in MAIN (spawnAgentCore / teardownPty, owner=null) and would otherwise
  //     be invisible on the floor. Main broadcasts; we build/archive the card here.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const offSpawn = window.cth.onHiveAgentSpawned?.((rec) => {
      if (!rec?.id) return;
      // addAgent is idempotent, but bail early if the renderer already carded it.
      if (useStore.getState().agents.some((a) => a.id === rec.id)) return;
      // An explicit character wins; otherwise infer it from the name, which is
      // what makes "spawn one called Meredith" land on the Meredith avatar with
      // nothing else asked for. The explicit field covers what inference cannot
      // express: an agent named something else that should still look like a
      // particular character. Unknown values fall through to the inference rather
      // than breaking the card.
      const castMember = (q?: string) =>
        q ? HIREABLE_CAST.find((m) => m.name === q || m.displayName.toLowerCase() === q)?.name : undefined;
      const character =
        castMember(rec.character?.trim().toLowerCase()) ??
        castMember((rec.name || rec.id).toLowerCase()) ??
        DEFAULT_CHARACTER;
      // Accent is otherwise hashed from the worker id, which is stable but not
      // choosable. An unrecognised accent keeps the hash.
      const askedAccent = SPAWN_ACCENTS.find((a) => a === rec.accent?.trim().toLowerCase());
      let h = 0;
      for (const ch of rec.id) h = (h + ch.charCodeAt(0)) % SPAWN_ACCENTS.length;
      const project = (rec.cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'hive';
      const agent: Agent = {
        id: rec.id,
        name: rec.name || rec.id,
        character,
        accent: askedAccent ?? SPAWN_ACCENTS[h],
        description: rec.role || 'a fresh harness',
        project,
        tmuxTarget: '',
        cwd: rec.cwd,
        status: 'idle',
        action: ACTION_CLOCKING_IN,
        progress: 0,
        currentStation: 'desk',
        ptyId: rec.id,
        command: rec.command,
        provider: rec.provider as Agent['provider'],
        isGod: false,
        recentTextTs: Date.now()
      };
      useStore.getState().addAgent(agent);
    });
    const offArchive = window.cth.onHiveAgentArchived?.((e) => {
      if (e?.id) useStore.getState().archiveAgent(e.id);
    });
    return () => { offSpawn?.(); offArchive?.(); };
  }, [config?.onboardingComplete]);

  // 5c) v0.3.4 voice bridge: main stages queue insertions (clear_context) and
  //     pushes them here, so delivery rides EVERY existing gate — idle-only,
  //     boot grace, draft/picker safety, auto-delivery pause. Main owns the
  //     confirm policy; this is just the enqueue.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    return window.cth.onRealtimeEnqueue?.((evt) => {
      if (!evt?.agentId || typeof evt.text !== 'string' || !evt.text.trim()) return;
      const { agents, enqueueMessage } = useStore.getState();
      if (!agents.some((a) => a.id === evt.agentId)) return;
      enqueueMessage(evt.agentId, evt.text.trim());
    });
  }, [config?.onboardingComplete]);

  // 6) Context upkeep has no clock-driven path here any more: compaction is
  //    Claude Code's own, and a team member's conversation is cleared only by
  //    main after a finished, handed-off task (safeClearer.ts; owner, 2026-09-25).

  // 7) Auto-revive wedged PTYs after the Mac sleeps/locks. Kevin's main-process
  //    keepalive catches up its schedules on wake and DETECTS terminals that were
  //    live before sleep but went silent after resume — it reports those ids on
  //    `power:resume`. We respawn EXACTLY those, resuming each agent's prior CLI
  //    session (--resume) so the terminal self-heals instead of the user clicking
  //    "Restart & Continue". This reuses the same resume-spawn flow as that button
  //    (CommandCenterPanel.restartWithModel) and restoreTeam's worktree handling.
  //    Pure addition: an empty `dead[]` is a no-op; healthy PTYs are never touched.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    // Skip an id we revived (or are mid-reviving) within this window — coalesces
    // a resume + unlock that arrive back-to-back (main also coalesces on its side).
    const REVIVE_DEBOUNCE_MS = 8000;

    const revive = async (deadId: string): Promise<void> => {
      const now = Date.now();
      if (now - (reviving.current[deadId] ?? 0) < REVIVE_DEBOUNCE_MS) return;
      reviving.current[deadId] = now; // claim BEFORE any await so re-entry can't double-spawn
      // Only respawn a PTY we actually own; never touch an unknown/healthy id.
      const a = useStore.getState().agents.find((x) => x.ptyId === deadId);
      if (!a) return;
      try {
        const res = await respawnResumed(a, deadId);
        if (res.ok) {
          reviving.current[deadId] = Date.now(); // re-stamp so the debounce covers the spawn
          useStore.getState().updateAgent(a.id, { status: 'idle', action: 'revived after sleep' });
        } else {
          delete reviving.current[deadId]; // let a later power:resume retry it
          console.error('[autorevive] respawn failed for', a.id, res.error);
        }
      } catch (err) {
        delete reviving.current[deadId];
        console.error('[autorevive] respawn threw for', deadId, err);
      }
    };

    return window.cth.onPowerResume?.((e) => {
      const dead = Array.isArray(e?.dead) ? e.dead : [];
      if (!dead.length) return; // healthy wake — nothing wedged, no-op
      for (const id of dead) void revive(id);
    });
  }, [config?.onboardingComplete]);

  // Claude turned ready after Michael or the team could not start for want of
  // it (get-michael-ready.md): from the card, setup, a sign in in the browser,
  // or an install outside the app. The members whose terminals could not start
  // restart now (main names them); anyone already working is left alone.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const onReady = (e: Event): void => {
      const restart = new Set(((e as CustomEvent<{ restart?: string[] }>).detail?.restart) ?? []);
      const { agents, setPendingRestart } = useStore.getState();
      for (const a of agents) {
        if (a.ptyId && restart.has(a.ptyId) && isClaudeProvider(a.provider ?? 'claude')) setPendingRestart(a.id, { at: Date.now(), reason: 'engine', now: true });
      }
    };
    window.addEventListener(ENGINE_READY_EVENT, onReady);
    // A new API key replaced one that stopped working (office-stopped-account.md):
    // the running Claude terminals restart, resumed, the same way.
    const offKey = window.cth.onOfficeRestartClaude?.((restart) => {
      onReady(new CustomEvent(ENGINE_READY_EVENT, { detail: { restart } }));
    });
    return () => { window.removeEventListener(ENGINE_READY_EVENT, onReady); offKey?.(); };
  }, [config?.onboardingComplete]);

  // 8) Restart to apply (docs/designs/multi-mailbox.md E2 + E5, and
  //    docs/designs/claude-connectors.md D2). Claude Code picks up the md-mail
  //    tools and its connectors only at start, so turning email on, or changing
  //    an agent's connectors, queues a restart. It waits until the agent is not
  //    mid-step, then restarts with Restart & Continue (same conversation).
  //    After 10 minutes still busy, or when the owner presses Restart now, it
  //    restarts anyway and says so on the floor. Main asks for a connector
  //    restart whenever the agent would now start differently.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const queue = (agentId: string): void => {
      const a = useStore.getState().agents.find((x) => x.id === agentId);
      if (a?.ptyId) useStore.getState().setPendingRestart(agentId, { at: Date.now(), reason: 'connectors' });
    };
    // A push sent before this window listened (app start, a reload) is asked for again.
    void window.cth.connectorsPendingRestarts?.().then((ids) => ids.forEach(queue)).catch(() => {});
    return window.cth.onConnectorsRestartNeeded?.(({ agentId }) => queue(agentId));
  }, [config?.onboardingComplete]);
  // A member stopped on a prompt the owner can't answer: restart now, which
  // clears it; they resume where they left off (owner, 2026-10-15).
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    return window.cth.onAgentRestartStuck?.(({ agentId }) => {
      const a = useStore.getState().agents.find((x) => x.id === agentId);
      if (a?.ptyId) useStore.getState().setPendingRestart(agentId, { at: Date.now(), reason: 'stuck', now: true });
    });
  }, [config?.onboardingComplete]);
  // A member whose engine stopped reporting (issue #326): Michael's one restart,
  // or the owner's Restart on its card. Same restart as Restart & Continue; it
  // also starts a member that was stopped (its terminal id is kept).
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    return window.cth.onAgentRestartSilent?.(({ agentId }) => {
      const a = useStore.getState().agents.find((x) => x.id === agentId);
      if (a?.ptyId) useStore.getState().setPendingRestart(agentId, { at: Date.now(), reason: 'silent', now: true });
    });
  }, [config?.onboardingComplete]);
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const CEILING_MS = 10 * 60_000;
    const POLL_MS = 5_000;
    const BUSY = new Set(['thinking', 'working', 'compacting', 'looping']);
    const WHY = { email: 'turn on email', connectors: 'apply its connectors', engine: 'start on Claude Code', stuck: 'clear a stuck prompt', silent: 'report to the app again' } as const;
    const inFlight = new Set<string>();
    const tick = (): void => {
      const { pendingRestart, agents, setPendingRestart, updateAgent } = useStore.getState();
      for (const [agentId, entry] of Object.entries(pendingRestart)) {
        if (inFlight.has(agentId)) continue;
        const a = agents.find((x) => x.id === agentId);
        if (!a || !a.ptyId) { setPendingRestart(agentId, undefined); continue; } // not running: its next start applies it
        const overdue = Date.now() - entry.at >= CEILING_MS;
        if (BUSY.has(a.status) && !overdue && !entry.now) continue;
        inFlight.add(agentId);
        void respawnResumed(a, a.ptyId).then((res) => {
          if (res.ok) {
            setPendingRestart(agentId, undefined);
            updateAgent(agentId, { status: 'idle', action: overdue ? `restarted after ${Math.round(CEILING_MS / 60_000)} minutes to ${WHY[entry.reason]}` : `restarted to ${WHY[entry.reason]}` });
          } else {
            console.error('[restart] restart failed for', agentId, entry.reason, res.error);
            // Say so on the Access tab and give Restart now back.
            const cur = useStore.getState().pendingRestart[agentId];
            if (cur) setPendingRestart(agentId, { ...cur, now: false, failed: true });
          }
        }).catch((e) => console.error('[restart] restart threw for', agentId, e))
          .finally(() => inFlight.delete(agentId));
      }
    };
    const iv = setInterval(tick, POLL_MS);
    return () => clearInterval(iv);
  }, [config?.onboardingComplete]);
}
