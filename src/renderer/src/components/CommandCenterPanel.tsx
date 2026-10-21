import { CapabilitiesTab } from './CapabilitiesTab';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelCard, PanelHeader, PanelTabs } from '@/shell/PanelChrome';
import { PixelBadge } from './PixelBadge';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { PtyTerminalView } from './PtyTerminalView';
import { MessageQueueComposer } from './MessageQueueComposer';
import { ProfileTab } from './ProfileTab';
import { MemoryNotes, memorySummary } from './MemoryNotes';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { memoryView } from '@shared/memoryIndex';
import { SHOW_FOCUS_MODE, SHOW_IDE, ALLOW_TEMP_WORKERS, SHOW_OPEN_TERMINAL, SHOW_DELIVERY_SWITCH } from '@shared/buildFeatures';
import { TriggersTab } from './triggers/TriggersTab';
import { TriggerHistoryTab } from './triggers/TriggerHistoryTab';
import { TriggerCard } from './triggers/ui';
import { WorkersTab } from './WorkersTab';
import { acquireTerminal, disposeTerminal, resetTerminal } from './terminalPool';
import { terminalInstanceKey } from './terminalRecovery';
import { areLogsEqual, type LogEntry } from './activityLog';
import { Icon } from './Icon';
import { useFleetTelemetry } from '@/hooks/useTelemetry';
import { COMMAND_GROUPS } from '@shared/claudeCommands';
import { roleForHiveSpawn } from '@shared/agentRole';
import { useStore, triggerHistoryVisible, type Agent } from '@/store/store';
import { releaseBindingsOf } from '@/shell/releaseBindings';
import { usePtyParser } from '@/hooks/usePtyParser';
import {
  buildSpawnCommand,
  decodeProviderModel,
  encodeProviderModel,
  inferAgentProvider,
  isClaudeProvider,
  modelProvidersForAgent,
  modelsForProvider,
  providerPreset,
  tokenizeCommand,
  AGENT_PROVIDER_PRESETS,
  type AgentProvider
} from '@/store/config';
import { BUILD_ENGINES, canReceiveInbox } from '@shared/agentProvider';
import { isComposingKey } from '@shared/imeGuard';
import { fmtTokens } from '@shared/tokenFormat';
import { useRtl } from '@/i18n/useDirection';
import { SilentPanelLine } from './SilentEngine';

/** Michael's control surface. Shown instead of the plain terminal/files panel
 *  when the god agent is selected: terminal + queue, the floor roster (with
 *  per-agent model + dispatch + assistant access), a memory view, and a live
 *  activity feed / board / usage meter. */

// Both the AskMe (#human) tab and the Triggers tab live here. Triggers replaced
// the old Schedules tab: schedules are now one of four trigger types, and the
// whole surface lives in ./triggers (see src/shared/triggers.ts for the contract).
// MONITOR and ACTIVITY are no longer tabs: they are the two cards inside
// ADVANCED. A request for 'floor' or 'activity' still works; it opens ADVANCED
// with that card expanded (see the ccTabRequest effect).
// TASKS and GRAPH are not tabs: they are the floor's TASKS and GRAPH views
// (App.tsx), and a request for either switches the floor to it.
type CCTab = 'profile' | 'capabilities' | 'terminal' | 'triggers' | 'trigger-history'
  | 'memory' | 'workers' | 'advanced';

/** Fallback denominator for the per-agent token meter when no floor token budget
 *  is configured — so the bar reads as a budget estimate (filled + remaining)
 *  rather than being pinned to 100% for whichever agent burns the most tokens. */
const DEFAULT_TOKEN_CAP = 1_000_000;

/** A GitHub issue as returned by `window.cth.githubIssues` (labels/assignees flattened). */
interface GHIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  assignees: string[];
}

/** Canonical tab order. Not every entry is always shown — see `visibleTabs`.
 *  PROFILE is first on every agent (owner, 2026-09-25), then ASK ME. The panel
 *  still OPENS on ASK ME (`defaultTab`): it is what the team needs from the
 *  owner, and a business owner opening Michael should land there. */
const TABS: { key: CCTab; labelKey: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { key: 'profile', labelKey: 'sidebar.profile', icon: 'info' },
  // Michael follows Capabilities like everyone (docs/designs/multi-mailbox.md, E3);
  // after ASK ME, which stays second on his panel (owner, 2026-09-25).
  { key: 'capabilities', labelKey: 'sidebar.capabilities', icon: 'gear' },
  { key: 'terminal', labelKey: 'commandCenter.tabs.terminal', icon: 'terminal' },
  // Everyone's jobs on a clock, read only. Michael's own are on his
  // Capabilities tab like everyone's (owner, 2026-09-26).
  { key: 'triggers', labelKey: 'commandCenter.tabs.officeSchedule', icon: 'clock' },
  { key: 'trigger-history', labelKey: 'commandCenter.tabs.history', icon: 'ledger' },
  { key: 'memory', labelKey: 'commandCenter.tabs.memory', icon: 'sparkle' },
  { key: 'workers', labelKey: 'commandCenter.tabs.workers', icon: 'gear' },
  // Last on purpose: the floor's inner workings, which an owner rarely needs.
  { key: 'advanced', labelKey: 'commandCenter.tabs.advanced', icon: 'mcp' }
];

/** @param fullscreen this instance IS the fullscreen overlay, so it owns the pty
 *  and renders the real terminal. The docked instance renders the "open in
 *  fullscreen" placeholder instead — two live xterms on one pty fight over its
 *  cols/rows and corrupt the display. */
export function CommandCenterPanel({ agent, fullscreen = false }: { agent: Agent; fullscreen?: boolean }) {
  const { t } = useTranslation();
  // Design v2: Ask me is no longer a tab here; it is the Needs you board in the
  // right column (branding/DESIGN.md 7.6). The docked panel opens on Profile: a
  // terminal is the least friendly thing a business owner can meet first. Focus
  // mode opens on the terminal, because reaching it means asking for it.
  const defaultTab: CCTab = fullscreen ? 'terminal' : 'profile';
  const [tab, setTab] = useState<CCTab>(defaultTab);
  // The trigger-history ledger has nothing to say until an outside party can
  // reach us, so its tab appears only once an org key or a webhook exists. This
  // is the first config-gated tab in the panel: TABS stays the canonical order
  // and the gate is applied at render, so nothing else has to know about it.
  // The rule itself lives in the store (`triggerHistoryVisible`) beside the two
  // mirrors it reads — a second copy here would drift from Settings.
  const showHistory = useStore(triggerHistoryVisible);
  // Never leave the panel parked on a tab that has just been hidden.
  useEffect(() => {
    if (!showHistory && tab === 'trigger-history') setTab(defaultTab);
  }, [showHistory, tab, defaultTab]);
  // WORKERS lists Michael's temporary helpers, which this build does not have
  // (ALLOW_TEMP_WORKERS in buildFeatures.ts).
  const visibleTabs = TABS.filter((t) =>
    (t.key !== 'trigger-history' || showHistory) && (t.key !== 'workers' || ALLOW_TEMP_WORKERS));

  // External tab requests (the boss-room calendar → 'triggers'; a 'tasks'
  // request switches the floor to its TASKS view). seq-keyed so clicking again re-opens the tab even
  // if it was already requested.
  const ccTabRequest = useStore((s) => s.ccTabRequest);
  // Which ADVANCED card a request asked for. seq doubles as the tab's key, so a
  // request made while ADVANCED is already showing still opens that card.
  const [advancedFocus, setAdvancedFocus] = useState<{ card: AdvancedCard | null; seq: number }>({ card: null, seq: 0 });
  useEffect(() => {
    if (!ccTabRequest) return;
    if (ccTabRequest.tab === 'tasks' || ccTabRequest.tab === 'graph') { useStore.getState().setFloorView(ccTabRequest.tab); return; }
    if (ccTabRequest.tab === 'floor' || ccTabRequest.tab === 'activity') {
      setAdvancedFocus({ card: ccTabRequest.tab === 'floor' ? 'monitor' : 'activity', seq: ccTabRequest.seq });
      setTab('advanced');
      return;
    }
    const key = ccTabRequest.tab as CCTab;
    if (!TABS.some((t) => t.key === key)) return;
    // Read the gate live rather than depending on it — as a dependency it would
    // re-fire a stale request the moment the tab appeared.
    if (key === 'trigger-history' && !triggerHistoryVisible(useStore.getState())) return;
    if (key === 'workers' && !ALLOW_TEMP_WORKERS) return;
    setTab(key);
  }, [ccTabRequest]);
  // A task-detail "assign" pre-fills the Floor dispatch box and jumps to it.
  // Seeded via the store one-shot (the detail overlay lives app-wide now);
  // { seq } makes every assign distinct so identical text re-seeds.
  const [dispatchSeed, setDispatchSeed] = useState<{ text: string; seq: number }>({ text: '', seq: 0 });
  const dispatchSeedRequest = useStore((s) => s.dispatchSeedRequest);
  useEffect(() => {
    if (!dispatchSeedRequest) return;
    setDispatchSeed({ text: dispatchSeedRequest.text, seq: dispatchSeedRequest.seq });
  }, [dispatchSeedRequest]);
  // Lifted so the floor's GRAPH view can open a specific agent's memory here.
  const [selectedMemoryAgent, setSelectedMemoryAgent] = useState<string | null>(null);
  const memoryFocusRequest = useStore((s) => s.memoryFocusRequest);
  useEffect(() => {
    if (memoryFocusRequest) setSelectedMemoryAgent(memoryFocusRequest.agentId);
  }, [memoryFocusRequest]);
  const updateAgent = useStore((s) => s.updateAgent);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const fullscreenAgentId = useStore((s) => s.fullscreenAgentId);
  const onPtyStream = usePtyParser(agent.id);
  // True only for the DOCKED panel while the overlay holds this agent.
  const isFullscreenedHere = fullscreenAgentId === agent.id && !fullscreen;
  // v0.3.4: ONE floor-wide auto-delivery switch, moved off the per-agent
  // control strips — toggling applies to every live agent, god included.
  // Seeded from the god's own control state (the floor is kept in sync by
  // this single control, so any agent's state reflects the floor's).
  const [floorDeliveryPaused, setFloorDeliveryPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    window.cth.controlSnapshot(agent.id)
      .then((s) => { if (alive && s) setFloorDeliveryPaused(s.autoDeliveryPaused); })
      .catch(() => { /* none */ });
    return () => { alive = false; };
  }, [agent.id]);
  const toggleFloorDelivery = async () => {
    const next = !floorDeliveryPaused;
    setFloorDeliveryPaused(next);
    const all = useStore.getState().agents;
    await Promise.all(all.map((a) => window.cth.controlAutoDelivery(a.id, next).catch(() => null)));
  };

  return (
    <PanelCard>
      {/* Design v2 header (branding/DESIGN.md 7.10). Floor-wide delivery and
          the IDE stay behind their build flags, beside close. */}
      <PanelHeader
        agent={agent}
        role={t('studio.officeManager')}
        withNote={false}
        extra={<>
          {SHOW_DELIVERY_SWITCH && (
            <PixelButton variant={floorDeliveryPaused ? 'primary' : 'secondary'} size="md" onClick={() => { void toggleFloorDelivery(); }}>
              <span className="cth-tip cth-tip-wrap"
                data-tip={floorDeliveryPaused ? t('commandCenter.deliveryPausedTitle') : t('commandCenter.deliveryOnTitle')}
                aria-label={floorDeliveryPaused ? t('commandCenter.deliveryResumeAria') : t('commandCenter.deliveryHoldAria')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name={floorDeliveryPaused ? 'pause' : 'play'} />
                {floorDeliveryPaused ? t('commandCenter.deliveryPaused') : t('commandCenter.deliveryAuto')}
              </span>
            </PixelButton>
          )}
          {SHOW_IDE && (
            <PixelButton variant="secondary" size="md" onClick={() => { const st = useStore.getState(); st.setIdeOpen(true, st.selectedId); }}>
              <span className="cth-tip cth-tip-wrap" data-tip={t('commandCenter.ideTitle')} aria-label={t('commandCenter.openIdeAria')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="code" /> {t('commandCenter.ide')}
              </span>
            </PixelButton>
          )}
        </>}
      />

      {/* Tabs (DESIGN.md 7.11): Profile, Access, Work, Office schedule, History
          (only once a webhook exists), Memory, Advanced. */}
      <SilentPanelLine agentId={agent.id} name={agent.name} />
      <PanelTabs tabs={visibleTabs.map((tabDef) => ({ key: tabDef.key, label: t(tabDef.labelKey) }))} current={tab} onChange={setTab} />

      {/* Body (data-panel-body: see AgentDetailPanel). */}
      <div data-panel-body data-tab={tab} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'terminal' && (
          isFullscreenedHere ? (
            <Centered>{t('commandCenter.terminalFullscreen')}</Centered>
          ) : agent.ptyId ? (
            <>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <PtyTerminalView
                  key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
                  ptyId={agent.ptyId}
                  onStreamData={onPtyStream}
                  onUserPrompt={(t) => {
                    updateAgent(agent.id, { lastPrompt: t });
                    if (t.trim().toLowerCase() === '/clear') {
                      updateAgent(agent.id, { contextTokens: 0, contextLimit: undefined, progress: 0 });
                    }
                    void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t });
                  }}
                  onToggleFullscreen={SHOW_FOCUS_MODE || fullscreen ? () => setFullscreen(fullscreen ? null : agent.id) : undefined}
                  fullscreen={fullscreen}
                  embedded={!fullscreen}
                />
              </div>
              <MessageQueueComposer agent={agent} />
            </>
          ) : (
            <Centered>{t('commandCenter.noTerminal', { name: agent.name })}</Centered>
          )
        )}
        {tab === 'profile' && <ProfileTab agent={agent} />}
        {tab === 'capabilities' && <CapabilitiesTab agent={agent} />}
        {tab === 'triggers' && <TriggersTab />}
        {tab === 'trigger-history' && <TriggerHistoryTab />}
        {tab === 'memory' && (
          <MemoryTab godId={agent.id} who={selectedMemoryAgent ?? undefined} onWho={setSelectedMemoryAgent} />
        )}
        {tab === 'advanced' && <AdvancedTab key={advancedFocus.seq} focus={advancedFocus.card} seed={dispatchSeed} />}
        {ALLOW_TEMP_WORKERS && tab === 'workers' && <WorkersTab />}
      </div>
    </PanelCard>
  );
}

// ─── Floor tab — roster, model, dispatch, dirs, assistant ────────────────────

type AdvancedCard = 'monitor' | 'activity';

/**
 * ADVANCED: the floor's inner workings, as collapsible cards in the TRIGGERS
 * tab's style. Both start closed, like every section on every agent tab
 * (owner, 2026-09-26). A deep link opens its card: "assign" and setup ask for
 * MONITOR, where the box for sending Michael a task lives.
 */
function AdvancedTab({ focus, seed }: { focus: AdvancedCard | null; seed: { text: string; seq: number } }) {
  const { t } = useTranslation();
  const godName = useStore((s) => s.agents.find((a) => a.isGod)?.name) ?? 'Michael';
  return (
    <Scroll>
      <Muted>{t('commandCenter.advanced.intro')}</Muted>
      <div style={{ height: 8 }} />
      <TriggerCard
        title={t('commandCenter.advanced.monitor')}
        blurb={t('commandCenter.advanced.monitorBlurb', { godName })}
        defaultOpen={focus === 'monitor'}
      >
        <FloorTab seed={seed} embedded />
      </TriggerCard>
      <TriggerCard
        title={t('commandCenter.advanced.activity')}
        blurb={t('commandCenter.advanced.activityBlurb')}
        defaultOpen={focus === 'activity'}
      >
        <ActivityTab embedded />
      </TriggerCard>
    </Scroll>
  );
}

/** Children only: an ADVANCED card already scrolls and pads, so an embedded
 *  view skips its own `Scroll` rather than nesting a second one. */
function Bare({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function FloorTab({ seed, embedded = false }: { seed: { text: string; seq: number }; embedded?: boolean }) {
  const Wrap = embedded ? Bare : Scroll;
  const { t } = useTranslation();
  const rtl = useRtl();
  const agents = useStore((s) => s.agents);
  const godName = agents.find((a) => a.isGod)?.name ?? t('common.orchestrator');
  const select = useStore((s) => s.select);
  const updateAgent = useStore((s) => s.updateAgent);
  const toolCounts = useStore((s) => s.toolCounts);
  // Live OpenTelemetry per agent — merged into each agent card below (the old
  // standalone Fleet tab folded in here so the roster shows identity + controls
  // AND live cost/usage in one place).
  const { samples, spark, rate, lastTool, breakers } = useFleetTelemetry();
  const [repos, setRepos] = useState<string[]>([]);
  // Floor-wide token budget (drives the breaker); also the token-meter denominator.
  const [tokenCap, setTokenCap] = useState<number | undefined>(undefined);
  // Per-agent token limit (overrides the floor budget for that agent), keyed by id.
  const [agentTokenCaps, setAgentTokenCaps] = useState<Record<string, number>>({});
  const [restarting, setRestarting] = useState<string | null>(null);
  const [engineProvider, setEngineProvider] = useState<AgentProvider>('claude');
  const [engineModel, setEngineModel] = useState<string | undefined>(undefined);
  const [restartErrors, setRestartErrors] = useState<Record<string, string>>({});
  // The harness's own default model (Settings → default model). Michael and every
  // new agent spawn on this, so the picker marks it — otherwise the only entry
  // reading "default" was the CLI's, which is a different thing entirely.
  const [defaultModel, setDefaultModel] = useState<string | undefined>(undefined);
  const [dispatchTo, setDispatchTo] = useState<string>(''); // '' = Michael decides
  const [dispatchText, setDispatchText] = useState('');
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);
  // ── ISSUES section state ──
  const [issueRepo, setIssueRepo] = useState<string>('');
  const [issues, setIssues] = useState<GHIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      setRepos(c.registeredRepos ?? []);
      setTokenCap(c.costCapTokens);
      setAgentTokenCaps(c.agentTokenCaps ?? {});
      setEngineProvider(c.godProvider ?? 'claude');
      setEngineModel(c.godModel);
      setDefaultModel(c.defaultModel);
    }).catch(() => { /* noop */ });
  }, []);

  // Seed the dispatch box from a task-card "assign" (keyed on seq so repeat
  // assigns re-prefill). seq === 0 is the untouched initial state — skip it.
  useEffect(() => {
    if (seed.seq > 0) setDispatchText(seed.text);
  }, [seed.seq, seed.text]);

  // Restart an agent's PTY in place. `resume:true` reattaches its prior Claude
  // conversation (`--resume <sessionId>`, resolved in the main process from the
  // hive registry by agent id) — this is "Restart & Continue": a clean re-draw
  // of the TUI in a fresh process WITHOUT losing the thread, which is the escape
  // hatch for a corrupted/garbled terminal (e.g. xterm reflow after dragging the
  // window between displays of different sizes). With `resume` unset it's the
  // old behavior: a model change that starts a fresh session.
  const restartWithModel = async (
    a: Agent,
    model: string | undefined,
    opts: {
      resume?: boolean;
      provider?: AgentProvider;
      /** Resume if we can, start fresh if we can't, instead of refusing.
       *  "Restart & Continue" wants the hard failure — continuing is the entire
       *  point, so silently starting a blank session would be worse than an
       *  error. A model change wants the soft one: the user asked to change
       *  model, and an agent with no recorded session still has to get one. */
      resumeOptional?: boolean;
    } = {}
  ) => {
    if (!a.ptyId) return;
    setRestarting(a.id);
    setRestartErrors((errors) => ({ ...errors, [a.id]: '' }));
    try {
      const cfg = await window.cth.getConfig();
      // Respawn on the same CLI this agent already runs on (inferred from its
      // command if not explicitly tagged) so an Antigravity/Codex worker stays
      // on its own binary. tokenizeCommand keeps quoted model labels one arg.
      // opts.provider overrides the inferred provider — used when changing GOD's engine.
      const previousProvider = inferAgentProvider(a.command, a.provider);
      const provider = opts.provider ?? previousProvider;
      let resume = opts.resume === true && provider === previousProvider;
      if (opts.resume && !resume && !opts.resumeOptional) {
        throw new Error('Cannot resume a session through a different provider.');
      }
      let resumeSessionId: string | undefined;
      if (resume) {
        // A precondition miss is fatal for an explicit "continue", and merely
        // means "start fresh" for an opportunistic one (see resumeOptional).
        const giveUpOnResume = (reason: string) => {
          if (!opts.resumeOptional) throw new Error(reason);
          resume = false;
          resumeSessionId = undefined;
        };
        const registry = await window.cth.hiveRegistry();
        resumeSessionId = registry.agents[a.id]?.sessionId;
        if (!resumeSessionId) {
          giveUpOnResume('No recorded session ID; current process was left running.');
        } else if (provider === 'claude' && !(await window.cth.resolveSessionCwd(resumeSessionId))) {
          giveUpOnResume('Session transcript not found; current process was left running.');
        }
      }
      // Capture the live grid before replacing anything. Restart & Continue
      // recreates only this agent's xterm; model changes retain the old
      // in-place reset behavior.
      const oldEntry = acquireTerminal(a.ptyId);
      let cols = oldEntry.term.cols || 100;
      let rows = oldEntry.term.rows || 30;
      try {
        oldEntry.fit.fit();
        cols = oldEntry.term.cols;
        rows = oldEntry.term.rows;
      } catch { /* host not sized yet */ }

      // A restart: an isolated member's worktree stays, and it starts again in it
      // (ship review 2026-10-17).
      const cwd = a.worktreePath && (await window.cth.gitIsRepo(a.worktreePath)) ? a.worktreePath : a.cwd;
      const killed = await window.cth.killPty(a.ptyId, { restart: true });
      // A pty that is ALREADY gone is the state this kill was trying to reach, so
      // it is not a failure. This is the single most common way to arrive at
      // "Restart & Continue": the session died on its own — a crash, or Ctrl-C
      // twice — main dropped it from the session map, and kill then answers
      // `no pty: <id>`. Treating that as fatal aborted before the respawn and
      // turned the one situation the button exists for into a dead end.
      if (!killed.ok && !/^no pty:/.test(killed.error ?? '')) {
        throw new Error(killed.error ?? 'Could not stop the current process.');
      }
      if (resume) {
        // A blank xterm can retain corrupt renderer/DOM/subscription state even
        // after its PTY is healthy. Throw that one terminal away, acquire its
        // replacement BEFORE spawning (so startup output has a listener), then
        // bump the key so React remounts only this agent's terminal card.
        disposeTerminal(a.ptyId);
        acquireTerminal(a.ptyId);
        updateAgent(a.id, {
          terminalGeneration: (a.terminalGeneration ?? 0) + 1,
          status: 'idle',
          action: 'recreating terminal…'
        });
      } else {
        resetTerminal(a.ptyId);
      }
      const command = buildSpawnCommand(cfg, model, provider);
      const [exe, ...args] = tokenizeCommand(command.trim());
      const hive = {
        id: a.id,
        name: a.name,
        cwd,
        provider,
        isGod: a.isGod,
        isAssistant: a.isAssistant,
        role: roleForHiveSpawn(a)
      };
      const res = await window.cth.spawnPty({
        id: a.ptyId,
        cwd,
        command: exe,
        args,
        provider,
        cols,
        rows,
        hive,
        resume,
        resumeSessionId,
        requireResume: resume
      });
      if (!res.ok) throw new Error(res.error ?? 'Restart failed.');
      if (resume && res.resumed !== true) {
        throw new Error('Resume was refused; no replacement session was accepted.');
      }
      if (res.ok) {
        // Record the model even on a resume. A same-provider model change now
        // RESUMES the session (that is the point — you keep the conversation and
        // just swap the model), so "resume ⇒ the model is unchanged" stopped
        // being true. Skipping the patch left the live process on the new model
        // while the selector and the persisted agent kept the old one, and the
        // next restore relaunched the old command. `command` is rebuilt from the
        // selected model above, so on a genuine no-change restart this is a no-op.
        const patch = resume
          ? {
              command: command.trim(),
              provider,
              model,
              status: 'idle' as const,
              action: 'continuing…'
            }
          : {
              command: command.trim(),
              provider,
              model,
              status: 'idle' as const,
              action: provider === previousProvider ? 'restarting…' : `switching to ${providerPreset(provider).label}…`
            };
        updateAgent(a.id, patch);
      }
    } catch (error) {
      setRestartErrors((errors) => ({
        ...errors,
        [a.id]: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      setRestarting(null);
    }
  };

  // ALL human dispatch flows through the god — never directly into a worker's
  // inbox. Direct dispatch bypassed the orchestrator's whole job: no 4-part
  // contract, no card in tasks.json, no board awareness — and the old
  // 'broadcast' DEFAULT sent the same task to every worker at once. A worker
  // picked in the dropdown is forwarded as a SUGGESTION the god may follow.
  const dispatch = async () => {
    const body = dispatchText.trim();
    if (!body) return;
    const suggested = dispatchTo ? agents.find((a) => a.id === dispatchTo) : undefined;
    const full = suggested
      ? `${body}\n\n${t('commandCenter.dispatchSuggestion', { name: suggested.name, id: suggested.id })}`
      : body;
    const res = await window.cth.hiveSend(
      { to: 'god', act: 'request', subject: t('commandCenter.taskFromHuman'), body: full },
      'human'
    );
    setDispatchText('');
    setDispatchMsg(res.ok
      ? suggested
        ? t('commandCenter.sentToWithSuggestion', { godName, name: suggested.name })
        : t('commandCenter.sentToMichael', { godName })
      : t('commandCenter.dispatchFailed', { error: res.error ?? '?' }));
    setTimeout(() => setDispatchMsg(null), 4000);
  };

  const fetchIssues = async () => {
    const repo = issueRepo || repos[0];
    if (!repo) { setIssuesError('No repo selected.'); return; }
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      const res = await window.cth.githubIssues(repo);
      if (res.ok) {
        setIssues((res.issues ?? []).slice(0, 10));
      } else {
        setIssues([]);
        setIssuesError(res.error ?? 'Failed to fetch issues.');
      }
    } catch (e) {
      setIssues([]);
      setIssuesError(e instanceof Error ? e.message : String(e));
    } finally {
      setIssuesLoading(false);
    }
  };

  const assignIssue = (issue: GHIssue) => {
    const body = (issue.body ?? '').slice(0, 200);
    setDispatchText(`GitHub Issue #${issue.number}: ${issue.title}\n\n${body}\n\nURL: ${issue.url}`);
    setDispatchTo(''); // Michael decomposes and assigns — no more broadcast blasts
  };

  // Set/clear one agent's token limit atomically in main. Renderer config objects
  // are snapshots, so persisting this whole map could clobber a cap added by the
  // hire flow after this panel loaded.
  const setAgentCap = (id: string, tokens: number | undefined) => {
    setAgentTokenCaps((current) => {
      const optimistic = { ...current };
      if (tokens && tokens > 0) optimistic[id] = tokens;
      else delete optimistic[id];
      return optimistic;
    });
    void window.cth.setAgentTokenCap(id, tokens).then((updated) => {
      setAgentTokenCaps(updated.agentTokenCaps ?? {});
    }).catch(() => {
      // Reconcile a failed optimistic edit with the persisted source of truth.
      void window.cth.getConfig().then((current) => {
        setAgentTokenCaps(current.agentTokenCaps ?? {});
      }).catch(() => { /* noop */ });
    });
  };

  // The token meter is scaled to the agent's own limit when set, else the floor
  // token budget — so each bar reads as "tokens used vs budget" with the remaining
  // headroom visible, never pinned to a useless 100%.
  const floorCap = tokenCap && tokenCap > 0 ? tokenCap : DEFAULT_TOKEN_CAP;
  // Fleet totals across the roster (for the AGENTS summary band).
  let sumTokens = 0, sumInput = 0, sumCacheRead = 0, sumRate = 0;
  for (const a of agents) {
    const s = samples[a.id];
    if (s) {
      sumTokens += s.input + s.output + s.cacheRead + s.cacheCreation;
      sumInput += s.input + s.cacheRead + s.cacheCreation;
      sumCacheRead += s.cacheRead;
    }
    sumRate += rate[a.id] ?? 0;
  }
  const fleetCachePct = sumInput > 0 ? Math.round((sumCacheRead / sumInput) * 100) : 0;

  return (
    <Wrap>
      <Section title={t('commandCenter.dispatchViaMichael', { godName: godName.toUpperCase() })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, fontWeight: 600, color: 'var(--cth-ink-500)', flexShrink: 0 }}>
            {t('commandCenter.suggestedOwner')}
          </span>
          <Select value={dispatchTo} onChange={setDispatchTo}>
            <option value="">{t('commandCenter.michaelDecides', { godName })}</option>
            {agents.filter((a) => !a.isGod).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </div>
        <textarea
          dir={rtl ? 'auto' : undefined}
          value={dispatchText}
          onChange={(e) => setDispatchText(e.target.value)}
          rows={2}
          placeholder={t('commandCenter.dispatchPlaceholder', { godName })}
          style={textareaStyle}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <PixelButton variant="primary" size="sm" onClick={dispatch} disabled={!dispatchText.trim()}>
            {t('commandCenter.dispatch')}
          </PixelButton>
          {dispatchMsg && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{dispatchMsg}</span>}
        </div>
      </Section>

      <Section title={t('commandCenter.agents')}>
        {agents.map((a) => {
          const agentProvider = inferAgentProvider(a.command, a.provider);
          const agentPreset = providerPreset(agentProvider);
          const sample = samples[a.id];
          const breaker = breakers[a.id];
          const armed = !!breaker && (breaker.level === 'constrained' || breaker.level === 'stopped');
          const tokens = sample ? sample.input + sample.output + sample.cacheRead + sample.cacheCreation : 0;
          // The per-agent cap is measured in WORK tokens — input + output + cache
          // writes, cache reads excluded (breaker.ts, #189) — so the meter against
          // that cap reads the same figure; otherwise a cache-heavy agent shows a
          // full red bar while the breaker is (correctly) calm. The floor budget
          // sums all kinds, so its meter keeps `tokens`; the count beside the bar
          // stays the all-kinds spend either way.
          const workTokens = sample ? sample.input + sample.output + sample.cacheCreation : 0;
          const agentCap = agentTokenCaps[a.id]; // per-agent limit, if set
          const hasAgentCap = !!agentCap && agentCap > 0;
          const denom = hasAgentCap ? agentCap : floorCap;
          const used = hasAgentCap ? workTokens : tokens;
          const pct = Math.min(100, Math.round((used / denom) * 100));
          const meterColor = armed || pct >= 90 ? 'var(--cth-coral)' : pct >= 60 ? 'var(--cth-lemon)' : 'var(--cth-mint)';
          // Sparkline only when the agent is actually burning tokens; otherwise the
          // flat baseline is just a mystery line. Label it with the live rate.
          const sparkSeries = spark[a.id] ?? [];
          const hasSpark = sparkSeries.some((v) => v > 0);
          const rateVal = Math.round(rate[a.id] ?? 0);
          const rateLabel = rateVal > 0 ? `${fmtTokens(rateVal)}/m` : 'rate';
          const currentModelKnown = modelsForProvider(agentProvider)
            .some((model) => model.id === a.model);
          return (
          <div key={a.id} style={{
            borderRadius: 'var(--cth-r-md)',
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: 6, marginBottom: 6,
            background: armed ? 'var(--cth-coral-light)' : 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                borderRadius: 'var(--cth-r-md)',
                width: 24, height: 24, background: `var(--cth-${a.accent}-light)`,
                boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', flexShrink: 0
              }}>
                <SpritePortrait character={a.character} scale={1} />
              </div>
              <button
                onClick={() => select(a.id)}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)'
                }}
              >{a.name}{a.isGod ? t('commandCenter.godTag') : ''}</button>
              <PixelBadge status={armed ? 'looping' : a.status} />
              {armed && <span title={breaker?.reason} style={{ color: 'var(--cth-coral)', fontSize: 12 }}>⚠</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cth-ink-500)' }}>
                {t('commandCenter.toolCalls', { count: toolCounts[a.id] ?? 0 })}
              </span>
              <TokenLimitEditor value={agentCap} onSet={(t) => setAgentCap(a.id, t)} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', wordBreak: 'break-all' }}>{a.cwd}</div>
            {/* Live telemetry (folded in from the old Fleet tab) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {hasSpark ? (
                <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-500)', flexShrink: 0 }}>{rateLabel}</span>
                  <Sparkline series={sparkSeries} />
                </span>
              ) : (
                <span style={{ flex: 1 }} />
              )}
              {lastTool[a.id] && (
                <span style={{
                  borderRadius: 'var(--cth-r-md)',
                  fontSize: 10, lineHeight: '14px', padding: '0 5px', flexShrink: 0,
                  background: 'var(--cth-paper-200)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', color: 'var(--cth-ink-700)'
                }}>{lastTool[a.id]}</span>
              )}
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-300)', flexShrink: 0 }}>{t('commandCenter.budget')}</span>
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-900)', width: 56, textAlign: 'right' }}>{fmtTokens(tokens)}</span>
              <div
                title={t('commandCenter.meterTitle', {
                  used: used.toLocaleString(),
                  limit: denom.toLocaleString(),
                  note: hasAgentCap ? t('commandCenter.agentLimit') : t('commandCenter.floorBudget')
                })}
                style={{ borderRadius: 'var(--cth-r-md)', width: 96, height: 8, background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', flexShrink: 0 }}
              >
                <div style={{ width: `${pct}%`, height: '100%', background: meterColor }} />
              </div>
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)', width: 30, textAlign: 'right' }}>{pct}%</span>
            </div>
            {/* Context window — the SAME exact statusLine-fed numbers as the
                avatar-card gauge (tokens currently in the window vs the real
                200k/1M size). Distinct from the cumulative budget meter above,
                which keeps growing forever and pins at 100% — that one is
                spend, this one is headroom before compaction. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-300)', flexShrink: 0 }}>{t('commandCenter.ctx')}</span>
              {a.contextTokens !== undefined && a.contextLimit ? (() => {
                const cpct = Math.min(100, Math.round((a.contextTokens! / a.contextLimit!) * 100));
                const ccolor = cpct >= 88 ? 'var(--cth-coral)' : cpct >= 75 ? 'var(--cth-lemon)' : `var(--cth-${a.accent})`;
                return (
                  <>
                    <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-900)', width: 56, textAlign: 'right' }}>
                      {fmtTokens(a.contextTokens!)}
                    </span>
                    <div
                      title={t('commandCenter.contextTitle', {
                        used: a.contextTokens!.toLocaleString(),
                        limit: a.contextLimit!.toLocaleString(),
                        pct: cpct
                      })}
                      style={{ borderRadius: 'var(--cth-r-md)', width: 96, height: 8, background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', flexShrink: 0 }}
                    >
                      <div style={{ width: `${cpct}%`, height: '100%', background: ccolor }} />
                    </div>
                    <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)', width: 30, textAlign: 'right' }}>{cpct}%</span>
                  </>
                );
              })() : (
                <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-300)' }}>
                  {t('commandCenter.noStatusTick')}
                </span>
              )}
            </div>
            {/* Non-god agents get the cross-provider model picker + restart controls
                here. The GOD agent's model lives in the engine row below
                (provider+model+apply), so we DON'T render this second selector for
                it — one model picker, not two. */}
            {!a.isGod && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Select
                value={encodeProviderModel(agentProvider, a.model)}
                disabled={restarting === a.id}
                onChange={(value) => {
                  const choice = decodeProviderModel(value);
                  if (!choice) return;
                  // Switching model within the SAME provider continues the
                  // conversation — that's the whole point of switching mid-task
                  // ("this got hard, go up a tier"), and starting fresh threw
                  // away the context that made the switch necessary.
                  // `resume` is best-effort: restartWithModel already refuses it
                  // across providers, and falls back to a fresh session when no
                  // session id or transcript is recorded.
                  void restartWithModel(a, choice.model, {
                    provider: choice.provider,
                    resume: choice.provider === agentProvider,
                    resumeOptional: true
                  });
                }}
              >
                {(!agentPreset.supportsModel || !currentModelKnown) && (
                  <option value={encodeProviderModel(agentProvider, a.model)}>
                    {agentPreset.label} · {a.model ?? 'current'}
                  </option>
                )}
                {/* This build's engines only (BUILD_ENGINES), plus the one the
                    agent runs on now so its current model stays listed. */}
                {modelProvidersForAgent(a.isGod)
                  .filter((preset) => BUILD_ENGINES.includes(preset.id) || preset.id === agentProvider)
                  .map((preset) => (
                  <optgroup key={preset.id} label={preset.label}>
                    {modelsForProvider(preset.id).map((model) => {
                      // `defaultModel` is a Claude model id, so it can only mark
                      // an entry in the Claude group.
                      const isHarnessDefault = preset.id === 'claude'
                        && !!defaultModel && model.id === defaultModel;
                      return (
                        <option
                          key={`${preset.id}:${model.id ?? 'cli-default'}`}
                          value={encodeProviderModel(preset.id, model.id)}
                        >
                          {model.label}{isHarnessDefault ? ' · default' : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </Select>
              <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
                {restarting === a.id
                  ? t('common.restarting')
                  : t('commandCenter.modelRestarts', { provider: agentPreset.label })}
              </span>
              {/* Restart & Continue — kill + respawn keeping the SAME model and
                  resuming the prior conversation (--resume). Use this to redraw a
                  garbled TUI (e.g. after dragging the window across displays)
                  without losing the thread. */}
              {(agentProvider === 'claude' || agentPreset.resumeFlag || agentPreset.resumeSubcommand) && <>
                <span style={{ flex: 1 }} />
                <PixelButton
                  variant="secondary"
                  size="sm"
                  disabled={restarting === a.id}
                  onClick={() => restartWithModel(a, a.model, { resume: true })}
                >
                  <span title={t('commandCenter.restartContinueTitle', { name: a.name })}>
                    {t('commandCenter.restartContinue')}
                  </span>
                </PixelButton>
              </>}
            </div>
            )}
            {restartErrors[a.id] && (
              <div style={{ fontSize: 11, color: 'var(--cth-coral)' }}>
                {restartErrors[a.id]}
              </div>
            )}
            {a.isGod && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', flexShrink: 0 }}>{t('commandCenter.engine')}</span>
                <Select
                  value={engineProvider}
                  disabled={restarting === a.id}
                  onChange={(v) => {
                    const p = v as AgentProvider;
                    setEngineProvider(p);
                    const preset = AGENT_PROVIDER_PRESETS.find((x) => x.id === p);
                    setEngineModel(preset?.recommendedOrchestratorModel);
                  }}
                >
                  {/* This build's engines only, plus Michael's current one. */}
                  {AGENT_PROVIDER_PRESETS
                    .filter((p) => canReceiveInbox(p.id)
                      && (BUILD_ENGINES.includes(p.id) || p.id === agentProvider || p.id === engineProvider))
                    .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}{p.id === 'claude' ? ' ★' : ''}
                    </option>
                  ))}
                </Select>
                <Select
                  value={engineModel ?? ''}
                  disabled={restarting === a.id}
                  onChange={(v) => setEngineModel(v || undefined)}
                >
                  {modelsForProvider(engineProvider).map((m) => (
                    <option key={m.label} value={m.id ?? ''}>{m.label}</option>
                  ))}
                </Select>
                <PixelButton
                  variant="secondary"
                  size="sm"
                  disabled={restarting === a.id}
                  onClick={async () => {
                    const currentProvider = inferAgentProvider(a.command, a.provider);
                    if (engineProvider !== currentProvider) {
                      if (!window.confirm(t('commandCenter.confirmRestartEngine', { name: a.name }))) return;
                    }
                    await window.cth.updateConfig({ godProvider: engineProvider, godModel: engineModel });
                    await restartWithModel(a, engineModel, { provider: engineProvider, resume: false });
                  }}
                >
                  {restarting === a.id ? t('common.restarting') : t('commandCenter.apply')}
                </PixelButton>
                {/* Redraw a garbled terminal without losing the thread (resume the
                    SAME engine+model). Kept here since the god has no per-agent row above. */}
                <PixelButton
                  variant="secondary"
                  size="sm"
                  disabled={restarting === a.id}
                  onClick={() => restartWithModel(a, a.model, { resume: true })}
                >
                  <span title={t('commandCenter.restartContinueTitle', { name: a.name })}>
                    {t('commandCenter.restartContinue')}
                  </span>
                </PixelButton>
              </div>
            )}
          </div>
          );
        })}
        {/* Fleet summary band */}
        <div style={{
          borderRadius: 'var(--cth-r-md)',
          display: 'flex', gap: 14, marginTop: 2, padding: '6px 8px',
          background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
          fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-900)', flexWrap: 'wrap'
        }}>
          <span>Σ <strong>{fmtTokens(sumTokens)}</strong> {t('costHud.tok')}</span>
          <span style={{ color: 'var(--cth-ink-700)' }}>{t('commandCenter.fleetInputs', { value: fmtTokens(sumInput), pct: fleetCachePct })}</span>
          <span style={{ color: 'var(--cth-ink-700)' }}>{t('commandCenter.fleetRate', { value: Math.round(sumRate).toLocaleString() })}</span>
        </div>
        <div style={{ marginTop: 6 }}>
          <Muted>
            {t('commandCenter.telemetryNote', { cap: fmtTokens(floorCap) })}
            {tokenCap && tokenCap > 0 ? '' : t('commandCenter.defaultBudgetNote')}
          </Muted>
        </div>
      </Section>

      <ArchivedSection />


      <Section title={t('commandCenter.directories')}>
        {repos.length === 0 && <Muted>{t('commandCenter.noRepos')}</Muted>}
        {repos.map((r) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--cth-ink-700)', wordBreak: 'break-all' }}>{r}</span>
            {SHOW_OPEN_TERMINAL && (
              <button
                onClick={() => window.cth.openTerminalAt(r)}
                title={t('commandCenter.openInTerminal')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)' }}
              ><Icon name="terminal" /></button>
            )}
          </div>
        ))}
      </Section>

      <Section title={t('commandCenter.issues')}>
        {repos.length === 0 && <Muted>{t('commandCenter.noRepos')}</Muted>}
        {repos.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <Select value={issueRepo || repos[0]} onChange={setIssueRepo}>
                {repos.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
              <PixelButton variant="primary" size="sm" onClick={fetchIssues} disabled={issuesLoading}>
                {issuesLoading ? t('commandCenter.fetching') : t('commandCenter.fetchIssues')}
              </PixelButton>
            </div>
            {issuesError && (
              <div style={{
                borderRadius: 'var(--cth-r-md)',
                fontSize: 12, color: 'var(--cth-ink-700)', marginBottom: 6,
                padding: 6, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
                wordBreak: 'break-word'
              }}>{issuesError}</div>
            )}
            {!issuesError && !issuesLoading && issues.length === 0 && <Muted>{t('commandCenter.noIssues')}</Muted>}
            {issues.map((issue) => (
              <div key={issue.number} style={{
                borderRadius: 'var(--cth-r-md)',
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: 6, marginBottom: 6,
                background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--cth-ink-900)', flex: 1, wordBreak: 'break-word' }}>
                    <strong>#{issue.number}</strong> {issue.title}
                  </span>
                  <PixelButton variant="secondary" size="sm" onClick={() => assignIssue(issue)}>
                    {t('commandCenter.assign')}
                  </PixelButton>
                </div>
                {issue.labels.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {issue.labels.map((label) => (
                      <span key={label} style={{
                        borderRadius: 'var(--cth-r-md)',
                        fontSize: 10, lineHeight: '14px', padding: '0 5px',
                        background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
                        color: 'var(--cth-ink-700)'
                      }}>{label}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </Section>
    </Wrap>
  );
}

// ─── Archived agents — retained + flagged, kept off the floor ────────────────

function ArchivedSection() {
  const { t } = useTranslation();
  const archivedAgents = useStore((s) => s.archivedAgents);
  const removeArchivedAgent = useStore((s) => s.removeArchivedAgent);
  const [open, setOpen] = useState(false);
  if (archivedAgents.length === 0) return null;
  return (
    <Section title={t('commandCenter.archived', { count: archivedAgents.length })}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          borderRadius: 'var(--cth-r-md)',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px 1px', border: 'none', cursor: 'pointer',
          background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
          fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
          marginBottom: open ? 6 : 0
        }}
      >{open ? '▾' : '▸'} {open ? t('commandCenter.hideClosed') : t('commandCenter.showClosed')}</button>
      {open && archivedAgents.map((a) => (
        <div key={a.id} style={{
          borderRadius: 'var(--cth-r-md)',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 6, marginBottom: 6, opacity: 0.7,
          background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)'
        }}>
          <div style={{
            borderRadius: 'var(--cth-r-md)',
            width: 24, height: 24, background: `var(--cth-${a.accent}-light)`,
            boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', flexShrink: 0
          }}>
            <SpritePortrait character={a.character} scale={1} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-700)' }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', wordBreak: 'break-all' }}>{a.cwd}</div>
          </div>
          <button
            onClick={() => { void releaseBindingsOf(a.id).finally(() => removeArchivedAgent(a.id)); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)', flexShrink: 0 }}
          ><Icon name="x" /></button>
        </div>
      ))}
    </Section>
  );
}

// ─── Memory tab ──────────────────────────────────────────────────────────────

/** Michael's Memory tab: any agent's memory (picker) and the office search.
 *  `ownOnly`: a team member's own Memory tab, that agent only, no picker and no
 *  office search (owner, 2026-09-25). */
export function MemoryTab({ godId, who: controlledWho, onWho, ownOnly = false }: {
  godId: string; who?: string; onWho?: (id: string) => void; ownOnly?: boolean;
}) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  // Selection is controllable from the floor's GRAPH view (openAgentMemory); falls back to local state.
  const [internalWho, setInternalWho] = useState<string>(godId);
  const who = ownOnly ? godId : (controlledWho ?? internalWho);
  const setWho = onWho ?? setInternalWho;
  const name = agents.find((a) => a.id === who)?.name ?? who;
  // undefined: first read not back yet; null: the read failed.
  const [detail, setDetail] = useState<{ index: string; waiting: number } | null | undefined>(undefined);
  const [showFile, setShowFile] = useState(false);
  // One search box: exact words across the team's notes. Search by meaning
  // covers company knowledge only, so it lives with it in Settings (owner,
  // 2026-10-19); members' notes are never indexed by meaning.
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [textResults, setTextResults] = useState<Array<{ source: string; excerpt: string }>>([]);
  const [textSearched, setTextSearched] = useState(false);

  useEffect(() => {
    let alive = true;
    setShowFile(false);
    // Switching agents keeps the last view until the new one arrives.
    window.cth.hiveMemoryDetail(who)
      .then((d) => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setDetail(null); });
    return () => { alive = false; };
  }, [who]);

  const view = useMemo(() => memoryView(detail?.index ?? ''), [detail]);
  const waiting = detail?.waiting ?? 0;

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await window.cth.textSearch(q);
      setTextResults(res.ok ? res.results.slice(0, 10) : []);
      setTextSearched(true);
    } catch {
      setTextResults([]); setTextSearched(true);
    } finally { setBusy(false); }
  };

  const linkButton: React.CSSProperties = {
    padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
    fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-900)', textDecoration: 'underline', textUnderlineOffset: 2
  };

  // Memory first, search below (docs/designs/memory-tab-readable.md). A flex
  // column so the raw file view can still take the height the tab has left.
  return (
    <div style={{
      flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 10,
      background: 'var(--cth-paper-200)', display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: 'var(--cth-font-display)', fontSize: 12, lineHeight: '20px', fontWeight: 400, color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('memoryNotes.title', { name })}
        </h2>
        {!ownOnly && (
          <label style={{ display: 'flex', minWidth: 0 }}>
            <span style={srOnly}>{t('memoryNotes.whose')}</span>
            <Select value={who} onChange={setWho}>
              {agents.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </Select>
          </label>
        )}
      </div>

      {detail === undefined ? (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--cth-ink-500)' }}>{t('memoryNotes.loading')}</p>
      ) : detail === null ? (
        <p role="alert" style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--cth-coral)' }}>! {t('memoryNotes.readFailed', { name })}</p>
      ) : (
        <>
          {memorySummary(t, view, waiting) && (
            <div style={{ fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)', marginTop: 2 }}>{memorySummary(t, view, waiting)}</div>
          )}
          {showFile ? (
            <div style={{ flex: 1, minHeight: 240, display: 'flex', flexDirection: 'column' }}>
              <Pre fill>{detail.index || t('commandCenter.noMemory')}</Pre>
            </div>
          ) : view.isIndex || !detail.index.trim() ? (
            <MemoryNotes agentId={who} name={name} view={view} waiting={waiting} />
          ) : (
            // An older free-form memory, not yet turned into an index by its first tidy-up.
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: '20px' }}><MarkdownPreview source={detail.index} variant="card" /></div>
          )}
          {detail.index.trim() && (
            <div style={{ marginTop: 10 }}>
              <button type="button" aria-pressed={showFile} onClick={() => setShowFile((v) => !v)} style={linkButton}>
                {showFile ? t('memoryNotes.showNotes') : t('memoryNotes.showFile')}
              </button>
            </div>
          )}
        </>
      )}

      {!ownOnly && <section style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--cth-ink-100)' }}>
        <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-ink-700)' }}>{t('memoryNotes.searchTitle')}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') search(); }}
            placeholder={t('commandCenter.textSearchPlaceholder')}
            aria-label={t('memoryNotes.searchTitle')}
            style={{ ...textareaStyle, height: 30 }}
          />
          <PixelButton variant="primary" size="sm" onClick={search} disabled={busy || !query.trim()}>
            {busy ? '…' : t('common.search')}
          </PixelButton>
        </div>
        {textResults.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {textResults.map((r, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)' }}>{r.source}</div>
                <Pre>{r.excerpt}</Pre>
              </div>
            ))}
          </div>
        )}
        {textSearched && textResults.length === 0 && <Muted>{t('commandCenter.nothingMatched')}</Muted>}
      </section>}
    </div>
  );
}

const srOnly: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0
};

// ─── Fleet telemetry bits (folded into the Floor AGENTS cards) ───────────────

/** Block-character sparkline of recent token deltas — neo-brutalist mono. */
function Sparkline({ series }: { series: number[] }) {
  const blocks = '▁▂▃▄▅▆▇█';
  const max = Math.max(1, ...series);
  const text = series.length
    ? series.map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))]).join('')
    : '▁▁▁▁▁▁';
  return (
    <span style={{ flex: 1, fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '12px', color: 'var(--cth-sky)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
      {text}
    </span>
  );
}

/** Per-agent token-limit control (top-right of each agent card). Shows the
 *  current limit as a lemon chip, or "set limit"; click to edit a token number.
 *  Enter / ✓ / blur commit; Escape cancels. */
function TokenLimitEditor({ value, onSet }: { value?: number; onSet: (tokens: number | undefined) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value != null ? String(value) : '');
  const skipBlur = useRef(false);
  const commit = () => {
    const raw = text.trim();
    const n = raw === '' ? undefined : Number(raw);
    onSet(typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined);
    setEditing(false);
  };
  if (!editing) {
    return (
      <button
        onClick={() => { setText(value != null ? String(value) : ''); setEditing(true); }}
        title={t('commandCenter.tokenLimitTitle')}
        style={{
          borderRadius: 'var(--cth-r-md)',
          flexShrink: 0, padding: '1px 6px', border: 'none', cursor: 'pointer',
          background: value && value > 0 ? 'var(--cth-lemon)' : 'var(--cth-cream-200)',
          boxShadow: `inset 0 0 0 1px ${value && value > 0 ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)'}`,
          fontFamily: 'var(--cth-font-ui)', fontSize: 11, color: 'var(--cth-ink-900)'
        }}
      >{value && value > 0
        ? <>{t('commandCenter.tokenLimit', { value: fmtTokens(value) })}</>
        : t('commandCenter.setLimit')}</button>
    );
  }
  return (
    <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <input
        type="number" min="0" step="100000" value={text} autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isComposingKey(e)) return;
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { skipBlur.current = true; setEditing(false); }
        }}
        onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } commit(); }}
        placeholder={t('common.tokens')}
        style={{
          borderRadius: 'var(--cth-r-md)',
          width: 84, padding: '2px 4px', background: 'var(--cth-paper-100)', border: 'none',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)',
          fontSize: 11, color: 'var(--cth-ink-900)', outline: 'none'
        }}
      />
      <button
        onMouseDown={(e) => e.preventDefault()} onClick={commit} title={t('commandCenter.saveLimit')}
        style={{ borderRadius: 'var(--cth-r-md)', flexShrink: 0, padding: '1px 5px', border: 'none', cursor: 'pointer', background: 'var(--cth-mint)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', fontSize: 11, color: 'var(--cth-ink-900)' }}
      >✓</button>
    </span>
  );
}

// ─── Activity tab — hive event log + board ───────────────────────────────────

function ActivityTab({ embedded = false }: { embedded?: boolean }) {
  const Wrap = embedded ? Bare : Scroll;
  const { t } = useTranslation();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [board, setBoard] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const refresh = async () => {
      try {
        const next = (await window.cth.hiveLog(60)) as LogEntry[];
        // Same log as last poll: keep the prev reference so React skips the
        // re-render. IPC returns fresh objects each time, so compare by value.
        setLog((prev) => (areLogsEqual(prev, next) ? prev : next));
      } catch { /* noop */ }
      try { setBoard(await window.cth.hiveBoard()); } catch { /* noop */ }
    };
    refresh();
    timer.current = setInterval(refresh, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const fmt = (e: LogEntry): string => {
    switch (e.kind) {
      case 'spawn': return t('commandCenter.logSpawn', { name: e.name ?? e.agentId });
      case 'message': return t('commandCenter.logMessage', { from: e.from, to: e.to, subject: e.subject || e.act });
      case 'drain': return t('commandCenter.logDrain', { agent: e.agentId, count: e.count });
      case 'escalate': return t('commandCenter.logEscalate', { subject: e.subject ?? '' });
      case 'approval': return e.approve ? t('commandCenter.logApprovalGranted') : t('commandCenter.logApprovalDenied');
      default: return JSON.stringify(e);
    }
  };

  return (
    <Wrap>
      <Section title={t('commandCenter.activity')}>
        {log.length === 0 && <Muted>{t('commandCenter.nothingYet')}</Muted>}
        {[...log].reverse().map((e, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--cth-ink-700)', padding: '2px 0', display: 'flex', gap: 6 }}>
            <span style={{ color: 'var(--cth-ink-300)', flexShrink: 0 }}>{e.kind ?? '·'}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmt(e)}</span>
          </div>
        ))}
      </Section>

      <Section title={t('commandCenter.board')}>
        <Pre>{board || t('commandCenter.boardEmpty')}</Pre>
      </Section>
    </Wrap>
  );
}


// ─── small shared bits ───────────────────────────────────────────────────────

function Scroll({ children }: { children: React.ReactNode }) {
  // minWidth:0 + overflowX:hidden keep wide children (native selects, long paths,
  // budget rows) from forcing a horizontal scrollbar in the narrow sidebar — they
  // wrap/shrink instead. Vertical scroll stays.
  return <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 10, background: 'var(--cth-paper-200)' }}>{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, fontWeight: 600, lineHeight: '12px', color: 'var(--cth-ink-500)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', color: 'var(--cth-ink-700)', fontSize: 13, background: 'var(--cth-paper-200)' }}>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{children}</div>;
}

/** `fill`: grow into the space its flex parent has left, instead of stopping at
 *  200px. The memory file uses it; search results keep the cap. */
function Pre({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  const rtl = useRtl();
  return (
    <pre style={{
      borderRadius: 'var(--cth-r-md)',
      margin: '6px 0 0', padding: 8, overflow: 'auto',
      ...(fill ? { flex: 1, minHeight: 0 } : { maxHeight: 200 }),
      background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
      fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
      color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
    }} dir={rtl ? 'auto' : undefined}>{children}</pre>
  );
}

const textareaStyle: React.CSSProperties = {
  flex: 1, width: '100%', resize: 'none', padding: '6px 8px',
  background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '17px',
  color: 'var(--cth-ink-900)', outline: 'none', boxSizing: 'border-box'
};

function Select({ value, onChange, disabled, children }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        borderRadius: 'var(--cth-r-md)',
        padding: '3px 6px', background: 'var(--cth-paper-100)',
        border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer',
        // Never let a long option name push the sidebar wider than it is.
        minWidth: 0, maxWidth: '100%'
      }}
    >{children}</select>
  );
}
