import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { MailProposal, ProposalDecision } from '@shared/mailProposals';
import { useStore } from '@/store/store';
import { useHarnessConfig } from '@/hooks/useHarnessConfig';
import { AgentAvatar } from './AgentAvatar';
import { GrowingTextarea } from './GrowingTextarea';
import { PixelButton } from './PixelButton';

/**
 * Send on approval (docs/designs/send-on-approval.md): an email a team member
 * proposed, on Ask me. The owner can edit the subject and body, then Approve,
 * Ask for changes (with a note) or Don't send. The team member sends the
 * approved version; the app keeps it, so nothing changes after the owner's yes.
 */
export function MailProposalCards({ proposals, refresh }: { proposals: MailProposal[]; refresh: () => void }) {
  return <>{proposals.map((p) => <ProposalCard key={p.id} p={p} refresh={refresh} />)}</>;
}

/** Wraps text in a bidi isolate (FSI ... PDI) for use inside a translated line. */
const isolate = (s: string): string => `\u2068${s}\u2069`;

// .cth-input draws the resting edge and the focus ring; the resets here keep
// the browser's own border, outline and field colors out (as CompanyProfileFields).
const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: 'none', outline: 'none',
  background: 'var(--cth-card)', color: 'var(--cth-ink)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, lineHeight: '18px'
};
const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--cth-ink-3)' };
const meta: CSSProperties = { fontSize: 11.5, lineHeight: '16px', color: 'var(--cth-ink-2)', overflowWrap: 'anywhere' };

function ProposalCard({ p, refresh }: { p: MailProposal; refresh: () => void }) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const mailboxes = useHarnessConfig()?.mailboxes;
  const name = agents.find((a) => a.id === p.agentId)?.name ?? p.agentId;
  const from = mailboxes?.find((m) => m.id === p.mailbox)?.address ?? p.mailbox;
  const [subject, setSubject] = useState(p.subject);
  const [body, setBody] = useState(p.body);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The agent's offer to send this kind without asking from now on: off until
  // the owner ticks it, and its words can be narrowed first.
  const [standOn, setStandOn] = useState(false);
  const [kind, setKind] = useState(p.offerStanding ?? '');

  const decide = async (decision: ProposalDecision): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const standing = decision === 'approve' && standOn && kind.trim() ? kind : undefined;
      const res = await window.cth.decideMailProposal(p.id, decision, decision === 'approve' ? { subject, body } : {}, decision === 'changes' ? note : undefined, standing);
      if (!res.ok) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <section
      aria-label={t('askMe.mailTitle', { name })}
      style={{
        position: 'relative', flexShrink: 0, padding: '12px 14px', borderRadius: 'var(--cth-r-xl)',
        background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)',
        display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--cth-font-ui)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, lineHeight: '17px', color: 'var(--cth-ink)' }}>
        <AgentAvatar id={p.agentId} name={name} size={17} />
        {t('askMe.mailTitle', { name })}
      </div>
      <div style={meta}>
        {/* Addresses isolated, so they read left to right inside an Arabic line. */}
        <div>{t('askMe.mailFrom', { from: isolate(from) })}</div>
        <div>{t('askMe.mailTo', { to: isolate(p.to) })}</div>
        {p.cc && <div>{t('askMe.mailCc', { cc: isolate(p.cc) })}</div>}
        {/* The task and webhook request this email is for (issue #105), shown
            only when the proposal has them: no task, no task line. */}
        {p.taskId && <div>{t('askMe.mailTask', { id: isolate(p.taskId) })}</div>}
        {p.correlationId && <div>{t('askMe.mailRequest', { id: isolate(p.correlationId) })}</div>}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={label}>{t('askMe.mailSubject')}</span>
        <input className="cth-input" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} dir="auto" style={field} />
      </label>
      {/* What else leaves with it (eng review D2): the owner approves seeing it. */}
      {(p.forward || (p.attachFrom?.length ?? 0) > 0) && (
        <div style={meta}>
          {p.forward && <div>{t('askMe.mailForwards')}</div>}
          {(p.attachFrom?.length ?? 0) > 0 && <div>{t('askMe.mailAttaches', { count: p.attachFrom!.length })}</div>}
        </div>
      )}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={label}>{t('askMe.mailBody')}</span>
        <GrowingTextarea className="cth-input" value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} maxHeight={320} dir="auto" style={field} />
      </label>
      {p.offerStanding && !asking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cth-ink)' }}>
            <input type="checkbox" checked={standOn} onChange={(e) => setStandOn(e.target.checked)} disabled={busy} />
            {t('askMe.mailStanding')}
          </label>
          {standOn && (
            <input className="cth-input" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy} aria-label={t('askMe.mailStanding')} dir="auto" style={field} />
          )}
        </div>
      )}
      {asking && (
        <GrowingTextarea
          className="cth-input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} dir="auto"
          placeholder={t('askMe.mailNote')} aria-label={t('askMe.mailNote')} style={field}
        />
      )}
      {failed && (
        <div role="alert" style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-coral-text)' }}>{t('askMe.mailFailed')}</div>
      )}
      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {asking ? (
          <>
            <PixelButton variant="secondary" size="sm" disabled={busy} onClick={() => setAsking(false)}>{t('askMe.mailCancel')}</PixelButton>
            <PixelButton variant="primary" size="sm" disabled={busy || !note.trim()} onClick={() => void decide('changes')}>{t('askMe.mailSendNote')}</PixelButton>
          </>
        ) : (
          <>
            <PixelButton variant="secondary" size="sm" disabled={busy} onClick={() => void decide('decline')}>{t('askMe.mailDecline')}</PixelButton>
            <PixelButton variant="secondary" size="sm" disabled={busy} onClick={() => setAsking(true)}>{t('askMe.mailChanges')}</PixelButton>
            <PixelButton variant="primary" size="sm" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void decide('approve')}>{t('askMe.approve')}</PixelButton>
          </>
        )}
      </div>
    </section>
  );
}
