/**
 * An agent's Messages tab as the owner reads it (docs/designs/messages-tab.md,
 * owner 2026-09-25): conversations grouped by the day they last moved, and the
 * office's own notices (closing time, scheduled runs) counted on one line
 * instead of filling the tab. Pure: no React, no fs.
 */

export interface HistoryItem {
  id: string;
  from: string;
  to: string;
  act: string;
  subject: string;
  body: string;
  created_at: string;
  conversation?: string;
}

export interface ThreadRow<M extends HistoryItem = HistoryItem> {
  conversation: string;
  /** The message that started it. */
  first: M;
  /** The newest message, when there is more than one. */
  latest?: M;
  messages: M[];
  lastAt: string;
}

export interface MessageView<M extends HistoryItem = HistoryItem> {
  /**
   * Newest day first; each day's conversations newest first. `day` is local YYYY-MM-DD,
   * or '' for one last group of conversations whose time does not parse.
   */
  days: Array<{ day: string; threads: ThreadRow<M>[] }>;
  notices: { scheduled: number; closing: number; other: number; messages: M[] };
}

const SYSTEM_SENDERS = new Set(['scheduler', 'heartbeat', 'system', 'breaker', 'foundations']);
const CLOSING = /closing[\s_-]*time/i;

/** Traffic that isn't a handoff: the app's own notes and closing time. */
export function isRoutine(m: Pick<HistoryItem, 'from' | 'subject'>): boolean {
  return SYSTEM_SENDERS.has(m.from) || CLOSING.test(m.subject ?? '');
}

/** Local YYYY-MM-DD of an ISO time, optionally shifted by calendar days. */
export function localDay(iso: string, dayOffset = 0): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (dayOffset) d.setDate(d.getDate() + dayOffset);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const timeOf = (iso: string): number => new Date(iso).getTime();
/** Oldest first, with times that do not parse after every real one, in their own order. */
const byTime = (a: number, b: number): number =>
  Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : Number.isNaN(b) ? -1 : a - b;

export function messageView<M extends HistoryItem>(msgs: M[]): MessageView<M> {
  const notices: MessageView<M>['notices'] = { scheduled: 0, closing: 0, other: 0, messages: [] };
  const by = new Map<string, M[]>();
  for (const m of msgs) {
    if (isRoutine(m)) {
      if (CLOSING.test(m.subject ?? '')) notices.closing++;
      else if (m.from === 'scheduler' || m.from === 'heartbeat') notices.scheduled++;
      else notices.other++;
      notices.messages.push(m);
      continue;
    }
    const key = m.conversation || m.id;
    const list = by.get(key) ?? [];
    list.push(m);
    by.set(key, list);
  }
  notices.messages.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const threads: ThreadRow<M>[] = [...by.entries()].map(([conversation, list]) => {
    // Real times in order, then any message whose time does not parse, in the
    // order it was written, so one broken time cannot move the whole thread.
    const sorted = [...list].sort((a, b) => byTime(timeOf(a.created_at), timeOf(b.created_at)));
    const timed = sorted.filter((m) => !Number.isNaN(timeOf(m.created_at)));
    // The row shows the newest real message beside its time, so both come from it.
    const last = timed.length ? timed[timed.length - 1] : sorted[sorted.length - 1];
    return { conversation, first: sorted[0], ...(last !== sorted[0] ? { latest: last } : {}), messages: sorted, lastAt: last.created_at };
  }).sort((a, b) => byTime(timeOf(b.lastAt), timeOf(a.lastAt)));

  const days: MessageView<M>['days'] = [];
  // A time that does not parse sorts as text, so it can land above or below
  // every real day; keep those conversations together, after the dated ones.
  const undated: ThreadRow<M>[] = [];
  for (const t of threads) {
    const day = localDay(t.lastAt);
    if (!day) { undated.push(t); continue; }
    const bucket = days[days.length - 1];
    if (bucket && bucket.day === day) bucket.threads.push(t);
    else days.push({ day, threads: [t] });
  }
  if (undated.length) days.push({ day: '', threads: undated });
  return { days, notices };
}

/** The verb for a message kind, as a key under `threads.verb`. */
export function verbKey(act: string): string {
  return ['request', 'inform', 'propose', 'query', 'agree', 'refuse', 'done'].includes(act) ? act : 'other';
}

/** What a row quotes: the subject, else the body's first line. */
export function gist(m: Pick<HistoryItem, 'subject' | 'body'>, max = 160): string {
  const text = (m.subject?.trim() || m.body?.split('\n').find((l) => l.trim()) || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
