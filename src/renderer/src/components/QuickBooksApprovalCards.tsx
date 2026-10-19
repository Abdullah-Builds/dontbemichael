import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickBooksApproval } from '@shared/quickbooks';
import { useStore } from '@/store/store';
import { AgentAvatar } from './AgentAvatar';
import { PixelButton } from './PixelButton';

/**
 * QuickBooks "Changes need my OK" (issue 320): a change a team member wants to
 * make in QuickBooks, shown in plain words on Ask me. The owner approves or
 * declines it as it stands; the member then makes the same call once.
 */
export function QuickBooksApprovalCards({ approvals, refresh }: { approvals: QuickBooksApproval[]; refresh: () => void }) {
  return <>{approvals.map((a) => <ApprovalCard key={a.id} a={a} refresh={refresh} />)}</>;
}

const meta: CSSProperties = { fontSize: 11.5, lineHeight: '16px', color: 'var(--cth-ink-2)', overflowWrap: 'anywhere' };

function ApprovalCard({ a, refresh }: { a: QuickBooksApproval; refresh: () => void }) {
  const { t } = useTranslation();
  const agents = useStore((s) => s.agents);
  const name = agents.find((x) => x.id === a.agentId)?.name ?? a.agentId;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const decide = async (decision: 'approve' | 'decline'): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await window.cth.decideQuickBooksApproval(a.id, decision);
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
      aria-label={t('askMe.booksTitle', { name })}
      style={{
        position: 'relative', flexShrink: 0, padding: '12px 14px', borderRadius: 'var(--cth-r-xl)',
        background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)',
        display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--cth-font-ui)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, lineHeight: '17px', color: 'var(--cth-ink)' }}>
        <AgentAvatar id={a.agentId} name={name} size={17} />
        {t('askMe.booksTitle', { name })}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink)' }} dir="auto">{a.title}</div>
      {/* Everything the approval covers, in full; a long call scrolls. */}
      <div tabIndex={0} style={{ ...meta, maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
        {a.lines.map((line, i) => <div key={i} dir="auto">{line}</div>)}
      </div>
      <div style={meta}>{t('askMe.booksNote', { name })}</div>
      {failed && <div role="alert" style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-coral-text)' }}>{t('askMe.booksFailed')}</div>}
      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <PixelButton variant="secondary" size="sm" disabled={busy} onClick={() => void decide('decline')}>{t('askMe.booksDecline')}</PixelButton>
        <PixelButton variant="primary" size="sm" disabled={busy} onClick={() => void decide('approve')}>{t('askMe.approve')}</PixelButton>
      </div>
    </section>
  );
}
