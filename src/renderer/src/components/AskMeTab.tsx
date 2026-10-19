import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/design/theme';
import { GrowingTextarea } from './GrowingTextarea';
import { askHeadline, askTitle, askedAgo } from './askHeadline';
import { departmentOf } from '@/scene/studio/layout';
import { family } from '@/scene/studio/theme';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';
import { AgentAvatar } from './AgentAvatar';
import { type HiveTask, type HumanQA } from './TasksKanban';
import { compareByNewestAsk } from './askMeOrder';
import { answerMessages, askAsText, isAnswered, isReport, isWithdrawn, labeledAnswer, openAskIndexes, openReportIndexes, partAnswerText, raiserOf, readAskShape, type AskShape } from '@shared/askMeRouting';
import { isComposingKey } from '@shared/imeGuard';
import { useRtl } from '@/i18n/useDirection';
import { ScheduleRequestCards } from './ScheduleRequestCards';
import { WorkStyleUpdateCards } from './WorkStyleUpdateCards';
import { MailProposalCards } from './MailProposalCards';
import { QuickBooksApprovalCards } from './QuickBooksApprovalCards';
import { EngineSetupCard } from './EngineSetupCard';
import { OfficeBreakCard, useOfficeBreak } from './OfficeBreakNotice';
import { SilentEngineCards } from './SilentEngine';
import { silentCards } from '@shared/silentEngine';
import { FileText } from './FileChip';
import { ChoiceRows, PartLines } from './AskAnswerFields';
import { refreshNeedsYou, setupCardShown, updateNeedsYouTasks, useNeedsYou } from '@/shell/useNeedsYou';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { useResearchName } from '@/shell/research';

/**
 * ASK ME — first-class human feedback through the task system.
 *
 * Tasks the god can only move with the human's input sit here. An entry isn't
 * necessarily a question — it can be a TO-DO only the human can perform
 * (create an account, approve a purchase, provide credentials, test on a real
 * device). Each card shows the open ask, a place to respond (an answer, or a
 * "done, here's the result" confirmation), and the CASCADE of downstream
 * tasks stuck waiting on this one — so "why isn't X done?" reads as "ah,
 * because I still owe something here."
 *
 * Sending an answer does two things:
 *   1. writes it into the card's humanQA entry in hive/tasks.json (the
 *      decision is documented ON the task, forever), and
 *   2. mails the god so it picks the answer up, unblocks the card, and the
 *      work continues — no separate HumanQuestion.md side-channel anymore.
 */

/** How many Office humor lines the All clear moment rotates through (D8). */
const ALL_CLEAR_LINES = 5;
/** The last focus request the board acted on, so a board that mounts later
 *  (the launch open, D7) never takes focus for an old one. */
let handledFocusSeq = 0;

/** One open question on the board. A card can hold several, and each is its
 *  own row with its own answer, so a newer question never hides an older one
 *  (askMeRouting.ts, owner 2026-10-04). */
interface AskRow { key: string; task: HiveTask; index: number; ask: HumanQA }

/** All tasks transitively waiting on `id` (dependents chain), cycle-safe. */
function dependentsTree(id: string, all: HiveTask[], seen = new Set<string>()): HiveTask[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const direct = all.filter((t) => Array.isArray(t.dependsOn) && t.dependsOn.includes(id) && t.status !== 'done');
  return direct.flatMap((d) => [d, ...dependentsTree(d.id, all, seen)]);
}

/** An ask without any pick or part answers already on it. */
function withoutDetail<T extends object>(e: T): T {
  const { picked: _p, partAnswers: _pa, ...rest } = e as T & { picked?: unknown; partAnswers?: unknown };
  return rest as T;
}

export function AskMeTab() {
  const { t: translate, i18n } = useTranslation();
  const rtl = useRtl();
  const godName = useResolvedGodName();
  const agents = useStore((s) => s.agents);
  const restorable = useStore((s) => s.restorableAgents);
  // One shared read with the pill, the strip and the chips (D3, eng R4).
  const { tasks, requests: scheduleRequests, offers, proposals, booksApprovals, engineSetup, stop, researchNotice, silent } = useNeedsYou();
  // Members whose engine isn't reporting (issue #326): their cards keep All clear away.
  const silentShown = silentCards(silent).length > 0;
  // A sign in stop already asks the owner to sign in: one card (eng R3).
  const engineCard = setupCardShown({ engineSetup, stop });
  const onBreak = !!useOfficeBreak();
  const refreshScheduleRequests = refreshNeedsYou;
  // Drafts live in the STORE (keyed by row) — switching tabs unmounts this
  // view, and a half-typed answer must survive the round trip.
  const drafts = useStore((s) => s.answerDrafts);
  const setAnswerDraft = useStore((s) => s.setAnswerDraft);
  // The picked option and each question's chip and line, kept like the typed
  // draft (ask-me-options.md, 3A).
  const picks = useStore((s) => s.answerPicks);
  const setAnswerPick = useStore((s) => s.setAnswerPick);
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const [sending, setSending] = useState<string | null>(null);
  // The row whose last Reply did not save, so its card can say so.
  const [failed, setFailed] = useState<string | null>(null);
  // The open row: undefined means the newest, null means none.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  // Which cards have their "holding up" list open.
  const [openStuck, setOpenStuck] = useState<Record<string, boolean>>({});
  const dark = useAppTheme() === 'dark';
  // Answers given since the board opened: they stay under All clear until the
  // column closes (D4), so the owner sees the reply landed.
  const [answeredHere, setAnsweredHere] = useState<{ id: string; title: string; a: string; who?: string; whoId?: string }[]>([]);
  const [line] = useState(() => 1 + Math.floor(Math.random() * ALL_CLEAR_LINES));
  const rootRef = useRef<HTMLDivElement>(null);

  // Opened from the pill, the strip or a "for you" chip: put focus in the
  // reply field of the asked for card, or the newest one (D10, D11).
  const focusReq = useStore((s) => s.needsYouFocus);
  useEffect(() => {
    if (!focusReq || focusReq.seq <= handledFocusSeq) return;
    handledFocusSeq = focusReq.seq;
    if (focusReq.taskId) {
      const first = rowsRef.current.find((r) => r.task.id === focusReq.taskId);
      if (first) setOpenId(first.key);
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        // Every row of a card carries its id; the first in the list is the
        // one just opened.
        const wanted = focusReq.taskId ? root.querySelector<HTMLElement>(`[data-askme-id="${CSS.escape(focusReq.taskId)}"]`) : null;
        const cardEl = wanted ?? root.querySelector<HTMLElement>('.cth-askme-card.is-open');
        const field = cardEl?.querySelector<HTMLTextAreaElement>('textarea');
        if (field && cardEl) { cardEl.scrollIntoView({ block: 'nearest' }); field.focus(); return; }
        root.closest('[data-right-column]')?.querySelector<HTMLElement>('[data-needs-you-heading]')?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusReq]);

  const nameFor = (id?: string): string | undefined =>
    id ? (agents.find((a) => a.id === id)?.name ?? restorable.find((a) => a.id === id)?.name ?? id) : undefined;

  // Every open question, newest at the top, oldest at the bottom. Before this
  // the board had no comparator at all, so a question's position was an
  // accident of where its card sat in tasks.json. Only this OUTER list is
  // sorted; a card's humanQA history stays chronological (see askMeOrder.ts).
  // Reports (michael-replies.md, 14A) follow the questions: something to read,
  // never something blocking.
  const rowsOf = (pick: typeof openAskIndexes): AskRow[] => tasks
    .flatMap((t) => pick(t.humanQA).map((index) => ({ key: `${t.id}#${index}`, task: t, index, ask: t.humanQA![index] })))
    .sort((a, b) => compareByNewestAsk(a.ask, b.ask));
  const waiting: AskRow[] = [...rowsOf(openAskIndexes), ...rowsOf(openReportIndexes)];
  const rowsRef = useRef<AskRow[]>(waiting);
  rowsRef.current = waiting;
  // A card with several open questions has a row for each: their labels add
  // the start of the question, so a screen reader can tell them apart.
  const rowsPerCard = new Map<string, number>();
  for (const r of waiting) rowsPerCard.set(r.task.id, (rowsPerCard.get(r.task.id) ?? 0) + 1);
  const rowLabel = (r: AskRow): string => {
    const title = askTitle(r.task.title);
    if ((rowsPerCard.get(r.task.id) ?? 0) < 2) return title;
    const q = askHeadline(r.ask.q);
    return `${title}: ${q.length > 60 ? `${q.slice(0, 59).trimEnd()}…` : q}`;
  };

  /** The answer a row would send: the owner's words, labeled with the option
   *  or the questions it answers (ask-me-options.md, 5A). */
  const answerFor = (row: AskRow, shape: AskShape): string => {
    const pk = picks[row.key] ?? {};
    return labeledAnswer(shape, { pick: pk.pick, note: drafts[row.key] ?? '', parts: pk.parts });
  };

  /**
   * Record the owner's answer on one open question, then tell Michael.
   *
   * This view's card is a few seconds old, so main merges it against the card
   * on disk (askMeRouting.ts mergeHumanQA): the answer lands only on the same
   * question, still open there. When it does not land (the question changed,
   * or Michael withdrew it meanwhile), nothing is sent or remembered and the
   * draft is kept.
   */
  const sendAnswer = async (row: AskRow) => {
    const { task, index, ask: open } = row;
    const shape = readAskShape(open);
    const text = answerFor(row, shape);
    if (!text || sending) return;
    const pk = picks[row.key] ?? {};
    // Which option and which parts, recorded beside the answer (main keeps them
    // only with it: askMeRouting.ts mergeHumanQA).
    const detail = shape.kind === 'choice' && pk.pick !== undefined
      ? { picked: pk.pick }
      : shape.kind === 'parts'
        ? { partAnswers: shape.parts.map((p, i) => partAnswerText(p, pk.parts?.[i])) }
        : {};
    // Michael and memory notes read the options or questions with the answer.
    const asked = askAsText(open.q, shape);
    setSending(row.key);
    setFailed(null);
    try {
      // 1) Document the answer ON the card, on this question only.
      const answeredAt = new Date().toISOString();
      const next = tasks.map((t) => {
        if (t.id !== task.id) return t;
        const qa = (t.humanQA ?? []).map((e, i) =>
          i === index && e.q === open.q && !isAnswered(e) && !isWithdrawn(e)
            // Only this Reply's own pick and lines go with the answer, never ones
            // an agent left on the open ask.
            ? { ...withoutDetail(e), a: text, answeredAt, ...detail }
            : e
        );
        return { ...t, humanQA: qa };
      });
      const updated = next.find((candidate) => candidate.id === task.id);
      const result = updated
        ? await window.cth.hivePatchTask(task.id, { humanQA: updated.humanQA }, index)
        : { ok: false, landed: false };
      if (!result.ok || result.landed === false) throw new Error('task changed before answer could be saved');
      updateNeedsYouTasks(() => next);
      // 2) The answer reaches Michael as a request about the card, which he
      //    closes with done once he has routed it, and goes into the memory
      //    notes of whoever raised the question. The owner only talks to
      //    Michael (askMeRouting.ts).
      const agents = useStore.getState().agents;
      const raiser = raiserOf(open, task, new Set(agents.map((a) => a.id)));
      const raiserName = agents.find((a) => a.id === raiser)?.name ?? raiser;
      for (const m of answerMessages({ raiser, raiserName, taskId: task.id, title: task.title, q: asked, a: text, answeredAt })) {
        await window.cth.hiveSend({
          to: m.to, act: m.act, subject: m.subject, body: m.body,
          ...(m.conversation ? { conversation: m.conversation } : {}),
          ...(m.requires_reply !== undefined ? { requires_reply: m.requires_reply } : {})
        }, 'human');
      }
      await window.cth.hiveRememberOwnerAnswer({ agentId: raiser, task: task.title, q: asked, a: text }).catch(() => undefined);
      setAnswerDraft(row.key, '');
      setAnswerPick(row.key, {});
      setAnsweredHere((list) => [{ id: row.key, title: task.title, a: text, who: nameFor(typeof task.assignee === 'string' ? task.assignee : undefined), whoId: typeof task.assignee === 'string' ? task.assignee : undefined }, ...list.filter((x) => x.id !== row.key)]);
      refreshNeedsYou();
    } catch {
      // Keep the draft so the owner can try again, and reload the board in
      // case the question changed or was withdrawn meanwhile.
      setFailed(row.key);
      refreshNeedsYou();
    }
    setSending(null);
  };

  return (
    // Design v2 (branding/DESIGN.md 7.8): plain white cards. Michael's question,
    // a one row answer, and what is stuck behind it. Scrolls on its own so the
    // board heading stays put.
    <div ref={rootRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '2px 2px 10px', margin: '-2px -2px 0' }}>
      <OfficeBreakCard />
      <SilentEngineCards />
      <EngineSetupCard status={engineCard ? engineSetup : null} />
      <ScheduleRequestCards requests={scheduleRequests} refresh={refreshScheduleRequests} />
      <WorkStyleUpdateCards offers={offers} />
      <MailProposalCards proposals={proposals} refresh={refreshNeedsYou} />
      <QuickBooksApprovalCards approvals={booksApprovals} refresh={refreshNeedsYou} />
      {/* Nothing left (D4, D8): All clear, one light line, and what was just
          answered. The column closes on the next click outside it. */}
      {!engineCard && !onBreak && !researchNotice && !silentShown && waiting.length === 0 && scheduleRequests.length === 0 && offers.length === 0 && proposals.length === 0 && booksApprovals.length === 0 && (
        <div style={{ padding: '4px 2px 2px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--cth-ink)' }}>{translate('shell.allClear')}</div>
          <div style={{ marginTop: 4, fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-3)' }}>{translate(`shell.allClearLine${line}`, { godName })}</div>
        </div>
      )}
      {!engineCard && !silentShown && waiting.length === 0 && scheduleRequests.length === 0 && offers.length === 0 && proposals.length === 0 && booksApprovals.length === 0 && answeredHere.map((x) => (
        <section key={x.id} aria-label={askTitle(x.title)} style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '18px', letterSpacing: '-0.01em', color: 'var(--cth-ink)' }}>{askTitle(x.title)}</div>
          {x.who && <div style={{ marginTop: 6 }}><span style={personChip}><AgentAvatar id={x.whoId} name={x.who} size={16} />{x.who}</span></div>}
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'var(--cth-ink-3)' }}>{translate('askMe.yourAnswer')}</div>
          <div dir={rtl ? 'auto' : undefined} style={{ marginTop: 2, fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{x.a}</div>
        </section>
      ))}
      {waiting.map((row, idx) => {
        const { task: t, ask: open } = row;
        const stuck = dependentsTree(t.id, tasks);
        const owner = t.assignee ? agents.find((a) => a.id === t.assignee) : undefined;
        // Agents write tasks.json: a card's assignee may not be a string.
        const who = nameFor(typeof t.assignee === 'string' ? t.assignee : undefined);
        const fam = owner && !owner.isGod ? family(departmentOf(owner), dark) : null;
        const answered = t.humanQA?.filter((e) => e.a).length ?? 0;
        // See full context only when it leads somewhere new: the card's background,
        // its result, or other questions and answers (owner, 2026-10-12: it opened
        // to a repeat of the question). Agents write tasks.json, so check types.
        const moreContext = (typeof t.description === 'string' && t.description.trim() !== '')
          || (typeof t.result === 'string' && t.result.trim() !== '')
          || (t.humanQA?.length ?? 0) > 1;
        const draft = drafts[row.key] ?? '';
        const shape = readAskShape(open);
        const pk = picks[row.key] ?? {};
        const toSend = answerFor(row, shape);
        const partsAnswered = shape.kind === 'parts' ? shape.parts.filter((p, i) => partAnswerText(p, pk.parts?.[i])).length : 0;
        // Reply says what it will send (D3): the option, or how many questions.
        const replyLabel = shape.kind === 'choice' && pk.pick !== undefined
          ? translate(draft.trim() ? 'askMe.replyOptionNote' : 'askMe.replyOption', { n: pk.pick + 1 })
          : shape.kind === 'parts' && partsAnswered > 0 && partsAnswered < shape.parts.length
            ? translate('askMe.replyPartial', { n: partsAnswered, total: shape.parts.length })
            : translate('askMe.respond');
        const hasDraft = !!draft.trim() || pk.pick !== undefined || partsAnswered > 0;
        const showStuck = openStuck[row.key] ?? false;
        // One card open at a time; the newest is open until the owner picks another.
        // The newest is open by default, and after the open card is answered
        // (it leaves the list) the newest opens again.
        const pinned = openId !== undefined && (openId === null || waiting.some((x) => x.key === openId));
        const expanded = pinned ? openId === row.key : idx === 0;
        const toggle = () => setOpenId(expanded ? null : row.key);
        const ago = askedAgo(open.askedAt, Date.now(), i18n.language, translate('askMe.justNow'));
        return (
          // Design v2 (DESIGN.md 7.8; owner, 2026-09-30): folded cards read as a
          // list (title, who, when, the ask in a line or two); one opens to the
          // full question, a one row reply and what it holds up.
          <section key={row.key} data-askme-id={t.id} aria-label={rowLabel(row)} style={expanded ? cardOpen : card} className={expanded ? 'cth-askme-card is-open' : 'cth-askme-card'}>
            {/* The header folds and unfolds the card. */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={toggle}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                className="cth-askme-head"
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
              >
                <div className="cth-askme-title" style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 600, lineHeight: '18px', letterSpacing: '-0.01em', color: 'var(--cth-ink)' }}>
                  {askTitle(t.title)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
                  {who && (
                    <span style={{ ...personChip, ...(fam ? { background: fam.l, boxShadow: `inset 0 0 0 1px ${fam.m}` } : {}) }}>
                      <AgentAvatar id={typeof t.assignee === 'string' ? t.assignee : undefined} name={who} size={16} />
                      {who}
                    </span>
                  )}
                  {ago && <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{ago}</span>}
                  {isReport(open) && <span style={reportTag}>{translate('askMe.report')}</span>}
                  {!expanded && hasDraft && <span style={draftTag}>{translate('askMe.draft')}</span>}
                </div>
                {/* Folded: the ask itself, in a line or two. */}
                {!expanded && (
                  <div dir={rtl ? 'auto' : undefined} style={{
                    marginTop: 7, fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-2)',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                  }}>{askHeadline(open.q)}</div>
                )}
              </div>
              {/* An ask is cleared by answering it, never dismissed (owner,
                  2026-10-01). The chevron shows the card folds and opens. */}
              <div style={{ flexShrink: 0, marginTop: -3, marginInlineEnd: -5 }}>
                {/* Folded or open, at a glance: a chevron that turns as the card opens. */}
                <span
                  aria-hidden="true"
                  onClick={toggle}
                  className="cth-askme-chevron"
                  style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 6, cursor: 'pointer', color: 'var(--cth-ink-3)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 160ms var(--cth-ease)' }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </div>
            </div>
            {expanded && <>
            {/* The question, as markdown: Michael writes lists, emphasis and code. */}
            <div dir={rtl ? 'auto' : undefined} className="cth-askme-q" style={{ margin: '10px 0 12px', fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink)' }}>
              {/* Files the question names are chips that open them (docs/designs/open-file-tab.md). */}
              <FileText source={open.q} who={{ raisedBy: open.raisedBy, assignee: typeof t.assignee === 'string' ? t.assignee : undefined }} />
            </div>
            {shape.kind === 'choice' && (
              <ChoiceRows
                options={shape.options}
                pick={pk.pick}
                onPick={(pick) => setAnswerPick(row.key, { ...pk, pick })}
                onSend={() => void sendAnswer(row)}
                who={{ raisedBy: open.raisedBy, assignee: typeof t.assignee === 'string' ? t.assignee : undefined }}
              />
            )}
            {shape.kind === 'parts' && (
              <PartLines
                parts={shape.parts}
                answers={pk.parts ?? []}
                onChange={(parts) => setAnswerPick(row.key, { ...pk, parts })}
                onSend={() => void sendAnswer(row)}
                who={{ raisedBy: open.raisedBy, assignee: typeof t.assignee === 'string' ? t.assignee : undefined }}
              />
            )}
            {shape.kind !== 'plain' ? <>
            {/* With options or questions (A1): the box full width, then Reply on
                its own row, so picking never reads as sending. */}
            <GrowingTextarea
              className="cth-input"
              dir={rtl ? 'auto' : undefined}
              value={draft}
              onChange={(e) => setAnswerDraft(row.key, e.target.value)}
              onFocus={() => setOpenId(row.key)}
              onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendAnswer(row); }}
              placeholder={shape.kind === 'parts' ? translate('askMe.anythingElse') : pk.pick !== undefined ? translate('askMe.addNote') : translate('askMe.ownAnswer')}
              style={{
                width: '100%', display: 'block', boxSizing: 'border-box', padding: '7px 10px', minHeight: 34,
                background: 'var(--cth-card)', border: 'none',
                fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '18px',
                color: 'var(--cth-ink)', outline: 'none'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <PixelButton
                variant="primary" size="sm"
                disabled={!toSend || sending === row.key}
                onClick={() => void sendAnswer(row)}
                ariaLabel={shape.kind === 'choice' && pk.pick !== undefined ? translate('askMe.replyOptionAria', { n: pk.pick + 1, label: shape.options[pk.pick]?.label ?? '' }) : undefined}
                style={{ height: 34, flexShrink: 0 }}
              >
                {sending === row.key ? translate('askMe.sending') : replyLabel}
              </PixelButton>
            </div>
            </> : (
            /* One row: the answer, and Reply. */
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <GrowingTextarea
                className="cth-input"
                dir={rtl ? 'auto' : undefined}
                value={draft}
                onChange={(e) => setAnswerDraft(row.key, e.target.value)}
                // Typing pins this card open, so a newer ask arriving never folds it mid answer.
                onFocus={() => setOpenId(row.key)}
                onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendAnswer(row); }}
                placeholder={translate('askMe.answerPlaceholder')}
                style={{
                  flex: 1, minWidth: 0, display: 'block', boxSizing: 'border-box', padding: '7px 10px', minHeight: 34,
                  background: 'var(--cth-card)', border: 'none',
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '18px',
                  color: 'var(--cth-ink)', outline: 'none'
                }}
              />
              {/* A report is cleared with Got it; nothing goes to Michael (14A). */}
              {isReport(open) && (
                <PixelButton variant="secondary" size="sm" disabled={sending === row.key} style={{ height: 34, flexShrink: 0 }}
                  onClick={() => { void window.cth.ackReport(t.id, row.index).then(() => refreshNeedsYou()); }}>
                  {translate('askMe.gotIt')}
                </PixelButton>
              )}
              <PixelButton
                variant="primary" size="sm"
                disabled={!draft.trim() || sending === row.key}
                onClick={() => void sendAnswer(row)}
                style={{ height: 34, flexShrink: 0 }}
              >
                {sending === row.key ? translate('askMe.sending') : translate('askMe.respond')}
              </PixelButton>
            </div>
            )}
            {failed === row.key && (
              <div role="alert" style={{ marginTop: 6, fontSize: 11, lineHeight: '15px', color: 'var(--cth-coral-text)' }}>{translate('askMe.mailFailed')}</div>
            )}
            {/* The cascade: what is stuck behind this answer, folded to one line. */}
            {stuck.length > 0 && (
              <div style={{ marginTop: 9 }}>
                <button
                  onClick={() => setOpenStuck((m) => ({ ...m, [row.key]: !showStuck }))}
                  aria-expanded={showStuck}
                  style={{ ...quietLink, display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', color: 'var(--cth-ink-3)' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                    style={{ transform: showStuck ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}><path d="M9 6l6 6-6 6" /></svg>
                  {stuck.length === 1
                    ? translate('askMe.blockingDownstream', { count: stuck.length })
                    : translate('askMe.blockingDownstreamPlural', { count: stuck.length })}
                </button>
                {showStuck && (
                  <div style={{ marginTop: 5, paddingInlineStart: 15, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {stuck.slice(0, 6).map((d) => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--cth-ink-2)' }}>
                        <span style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 2, background: d.status === 'blocked' ? 'var(--cth-coral-base)' : 'var(--cth-blue)' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                        {nameFor(d.assignee) && <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{nameFor(d.assignee)}</span>}
                      </div>
                    ))}
                    {stuck.length > 6 && (
                      <div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{translate('askMe.more', { count: stuck.length - 6 })}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* The full task, and any earlier answers, are one click away. */}
            {moreContext && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--cth-line)' }}>
              <button onClick={() => openTaskDetail(t.id)} title={translate('askMe.openDetail')} style={{ ...quietLink, color: 'var(--cth-indigo-text)', fontWeight: 600 }}>
                {translate('askMe.openTask')}
              </button>
              {answered > 0 && (
                <button onClick={() => openTaskDetail(t.id)} title={translate('askMe.viewAnswersHistory')} style={quietLink}>
                  {answered === 1
                    ? translate('askMe.viewAnswers', { count: answered })
                    : translate('askMe.viewAnswersPlural', { count: answered })}
                </button>
              )}
            </div>
            )}
            </>}
          </section>
        );
      })}
      {/* A report, after the questions like every Report card (DESIGN.md 7.8). */}
      {researchNotice && <ResearchNoticeCard />}
    </div>
  );
}

const card: CSSProperties = {
  position: 'relative', flexShrink: 0,
  padding: '13px 14px 13px', borderRadius: 'var(--cth-r-xl)',
  background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line), 0 1px 2px rgba(30, 27, 46, .04), 0 4px 12px rgba(62, 52, 140, .06)'
};
const cardOpen: CSSProperties = {
  ...card,
  boxShadow: 'inset 0 0 0 1px var(--cth-line-2), var(--cth-shadow-md)'
};
const draftTag: CSSProperties = {
  fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 'var(--cth-r-pill)',
  background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)'
};
const personChip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px 0 3px', borderRadius: 'var(--cth-r-pill)',
  background: 'var(--cth-neutral-soft)', fontSize: 11.5, fontWeight: 600, color: 'var(--cth-ink-2)'
};
const quietLink: CSSProperties = {
  padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 11, color: 'var(--cth-ink-3)'
};

/** The one time card after the update that took the internet from the team
 *  (issue #230, design review D9 and D20): a report, so it never turns the
 *  Needs you pill coral; either button clears it for good. */
function ResearchNoticeCard() {
  const { t } = useTranslation();
  const researchName = useResearchName();
  const seen = (): void => { void window.cth.researchNoticeSeen().then(() => refreshNeedsYou()).catch(() => undefined); };
  return (
    <section aria-label={t('research.noticeTitle')} style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink)' }}>{t('research.noticeTitle')}</span>
        <span style={reportTag}>{t('askMe.report')}</span>
      </div>
      <p style={{ margin: '8px 0 12px', fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink)' }}>{t('research.noticeBody', { name: researchName })}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <PixelButton variant="secondary" size="sm" onClick={seen}>{t('askMe.gotIt')}</PixelButton>
        <PixelButton variant="primary" size="sm" onClick={() => {
          seen();
          window.dispatchEvent(new CustomEvent('cth:open-settings', { detail: { section: 'Research & privacy' } }));
        }}>{t('research.noticeOpen')}</PixelButton>
      </div>
    </section>
  );
}

const reportTag: CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 'var(--cth-r-pill)',
  background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-2)'
};
