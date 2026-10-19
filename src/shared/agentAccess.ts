import { agentMailboxes, grantPaused, sendOnlyGrant, sendingMode, sendingWords, type MailAccessConfig, type SendingMode } from './mailboxes';
import { isQuickBooksKey, usableConnectors, type ConnectorConfig } from './claudeConnectors';
import { quickbooksCapability } from './quickbooks';

/** One thing an agent can really reach. */
export type AccessItem =
  | { kind: 'mailbox'; address: string; sending: SendingMode }
  /** Send only from another member's mailbox (shared-mailboxes.md, S2). */
  | { kind: 'send-only'; address: string; sending: SendingMode; paused: boolean }
  | { kind: 'connector'; key: string }
  | { kind: 'quickbooks'; changes: boolean; approval?: boolean };

/**
 * What an agent can actually use right now, for its profile's "Uses" row:
 * its mailbox (agentMailboxes, the rule the mail tools apply) and the Claude
 * connectors it may call (usableConnectors, the rule its spawn and the hook
 * apply), QuickBooks with its level. Never the pack card's `connections`:
 * those are a job template's wish list, and an agent was shown "Mailchimp,
 * Instagram / Facebook" it could never reach (owner, 2026-10-02).
 */
export function agentAccessSummary(cfg: MailAccessConfig & ConnectorConfig, agentId: string, roleReadsBooks: boolean, present?: (agentId: string) => boolean): AccessItem[] {
  const items: AccessItem[] = [];
  const mailboxId = agentMailboxes(cfg, agentId)[0];
  const mailbox = mailboxId ? (cfg.mailboxes ?? []).find((m) => m.id === mailboxId) : undefined;
  if (mailbox) items.push({ kind: 'mailbox', address: mailbox.address, sending: sendingMode(cfg.agentCapabilities?.[agentId]?.email) });
  const grant = sendOnlyGrant(cfg, agentId);
  const granted = grant ? (cfg.mailboxes ?? []).find((m) => m.id === grant.mailbox) : undefined;
  if (grant && granted) items.push({ kind: 'send-only', address: granted.address, sending: grant.sending, paused: grantPaused(cfg, grant.mailbox, present) });
  const connectors = usableConnectors(cfg, agentId, roleReadsBooks).sort((a, b) => a.key.localeCompare(b.key));
  for (const c of connectors) {
    if (isQuickBooksKey(c.key)) {
      { const q = quickbooksCapability(cfg.agentCapabilities?.[agentId]?.quickbooks, roleReadsBooks); items.push({ kind: 'quickbooks', changes: q.changes, ...(q.approval ? { approval: true } : {}) }); }
    } else {
      items.push({ kind: 'connector', key: c.key });
    }
  }
  return items;
}

/**
 * The same access in one line for Michael's roster, with the screen each part
 * comes from, so a team member's mail limit is never blamed on the wrong one
 * (owner, 2026-10-03: an office may use the app's own Mailboxes, Claude
 * connectors such as Gmail, or both). The mailbox is connected in Settings, but
 * Can send or Draft only is the member's own Access tab: the connection itself
 * can send (owner, 2026-10-05). Null when the agent has none.
 */
export function accessLine(items: AccessItem[]): string | null {
  const parts: string[] = [];
  for (const i of items) {
    if (i.kind === 'mailbox') parts.push(`mailbox ${i.address} (connected in Settings, Connections, Mailboxes; ${sendingWords(i.sending)}, set on their Access tab, Email, Sending)`);
    // Michael's routing guess for outreach (S2): who may write as an address.
    if (i.kind === 'send-only') parts.push(`sends only from ${i.address} (Settings, Connections, Mailboxes; ${sendingWords(i.sending)}, set on their Access tab, Email${i.paused ? '; paused: nobody reads it now' : ''})`);
  }
  const connectors = items.flatMap((i) => (i.kind === 'connector' ? [i.key] : i.kind === 'quickbooks' ? [`QuickBooks ${i.changes ? 'with changes' : i.approval ? 'changes need the owner\'s OK' : 'read only'}`] : []));
  if (connectors.length) parts.push(`Claude connectors ${connectors.join(', ')} (Settings, Connections, Claude connectors)`);
  return parts.length ? parts.join('; ') : null;
}
