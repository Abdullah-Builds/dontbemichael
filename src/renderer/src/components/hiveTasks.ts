import { openAskIndexes } from '@shared/askMeRouting';
import { isNextAt } from '@shared/cardGuards';

/* The hive task ledger as the renderer reads it: the card types, the open
 * question rule and the one parser every reader goes through. Plain TypeScript
 * with no UI, so the shared Needs you feed (shell/useNeedsYou.ts) and its tests
 * can load it. TasksKanban.tsx re-exports all of it. */

/** A card on the task kanban. Mirrors HiveTask in the main/preload process —
 *  re-declared locally so the renderer doesn't reach into the preload package
 *  (same convention as store/config.ts). */
export interface HumanQA {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  /** Set when Michael withdraws the ask without an answer (or the owner closes
   *  the card): the question stays on the card as history and leaves ASK ME. */
  dismissedAt?: string;
  /** Why it was withdrawn, in a few words. */
  dismissedReason?: string;
  /** Set when the card closing withdrew it; shown in the owner's language. */
  dismissedBy?: 'card-closed' | 'member-deleted';
  /** The agent whose work needs the answer, and which learns from it; "god"
   *  when Michael raised it himself. */
  raisedBy?: string;
  /** A choice: the options Michael wrote (docs/designs/ask-me-options.md). */
  options?: unknown;
  /** Several questions, each maybe with its own options. */
  parts?: unknown;
  /** Which option the owner picked, recorded with the answer. */
  picked?: number;
  /** Each question's answer, null where the owner left it unanswered. */
  partAnswers?: (string | null)[];
  /** "report", or "foundation" for a Company foundations card. */
  kind?: string;
  /** A foundation card's question id (shared/foundations.ts). */
  foundation?: string;
}

export interface HiveTask {
  id: string;
  title: string;
  description?: string;
  /** When a To do card's one off next step is due (ISO). Cards carry no running
   *  notes: each agent's conversation and the office log keep its activity
   *  (owner, 2026-10-11). */
  nextAt?: string;
  assignee?: string;
  status: 'todo' | 'doing' | 'waiting' | 'blocked' | 'done';
  /** Who a Waiting card waits on, in a few words (Michael writes it). */
  waitingOn?: string;
  dependsOn: string[];
  priority: number;
  createdAt: string;
  /** First-class human feedback: the god appends {q} when a card needs the
   *  human; the ASK ME view fills in {a}. Full history stays on the card. */
  humanQA?: HumanQA[];
  /** Done by the owner's decision rather than finished work (card-lifecycle.md
   *  D2): shown as "Closed by owner". */
  closedBy?: 'owner';
  closedReason?: string;
  /** What came of the card, in Michael's words: he writes it when he marks the
   *  card Done (issue 51). Shown on the card, never checked or invented. */
  result?: string;
}

/** The card's open questions for the human, oldest first: every ask with no
 *  answer and no withdrawal (dismissedAt), whatever the card's status
 *  (askMeRouting.ts openAskIndexes, owner 2026-10-04). */
export function openQuestions(t: HiveTask): HumanQA[] {
  return openAskIndexes(t.humanQA).map((i) => t.humanQA![i]);
}

/** The card's newest open question, if any. */
export function openQuestion(t: HiveTask): HumanQA | undefined {
  const open = openQuestions(t);
  return open[open.length - 1];
}

/** Waiting on the human = a question on the card still open. The card's status
 *  never hides it: a question leaves only when answered or withdrawn. */
export function waitsOnHuman(t: HiveTask): boolean {
  return openQuestions(t).length > 0;
}

export type TaskStatus = HiveTask['status'];

/** Deterministic fallback id derived from a task's content (djb2 → base36).
 *  Used for tasks lacking a valid string id so re-parsing tasks.json on every
 *  5s poll yields the SAME id — no React key churn / card remount. Unlike
 *  shortId() (random, for brand-new tasks), this never changes across polls. */
function stableId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (((h << 5) + h) ^ seed.charCodeAt(i)) | 0;
  return `t-${(h >>> 0).toString(36)}`;
}

/** Normalize whatever hive:tasks returns into a typed task array. The god
 *  writes this file by hand — every field except the shape itself is optional
 *  in practice, so EVERY consumer must go through this (exported for the
 *  detail overlay; a raw card without dependsOn once crashed it). */
export function parseTasks(raw: unknown): HiveTask[] {
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks))
    ? (raw as { tasks: unknown[] }).tasks
    : [];
  return list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => ({
      id: typeof t.id === 'string' && t.id
        ? t.id
        : stableId(`${typeof t.title === 'string' ? t.title : ''}|${typeof t.createdAt === 'string' ? t.createdAt : ''}|${i}`),
      title: typeof t.title === 'string' ? t.title : '(untitled)',
      // The app writes "description" (a Slack or webhook request). Agents' old
      // running "notes" are left in the file but not read: an agent's activity
      // lives in its conversation and the office log (owner, 2026-10-11).
      description: typeof t.description === 'string' ? t.description : undefined,
      nextAt: isNextAt(t.nextAt) ? t.nextAt : undefined,
      assignee: typeof t.assignee === 'string' ? t.assignee : undefined,
      status: (['todo', 'doing', 'waiting', 'blocked', 'done'] as const).includes(t.status as TaskStatus)
        ? (t.status as TaskStatus) : 'todo',
      waitingOn: typeof t.waitingOn === 'string' && t.waitingOn.trim() ? t.waitingOn.trim() : undefined,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d): d is string => typeof d === 'string') : [],
      priority: typeof t.priority === 'number' ? t.priority : 3,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      humanQA: Array.isArray(t.humanQA)
        ? (t.humanQA as unknown[])
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { q?: unknown }).q === 'string')
          // Every field an entry carries survives the parse (raisedBy routes the
          // answer; options and parts give the card its shape, ask-me-options.md).
          // An answer writes these entries back, so a field dropped here was
          // erased from disk (found 2026-10-02).
          .map((e) => ({
            ...e,
            q: e.q as string,
            a: typeof e.a === 'string' ? e.a : undefined,
            askedAt: typeof e.askedAt === 'string' ? e.askedAt : undefined,
            answeredAt: typeof e.answeredAt === 'string' ? e.answeredAt : undefined,
            // Preserve a dismissal across the 5s re-parse, else the card would
            // resurface on the next poll (openQuestion would see it as open).
            dismissedAt: typeof e.dismissedAt === 'string' ? e.dismissedAt : undefined,
            dismissedReason: typeof e.dismissedReason === 'string' ? e.dismissedReason : undefined,
            dismissedBy: e.dismissedBy === 'card-closed' || e.dismissedBy === 'member-deleted' ? e.dismissedBy : undefined,
            raisedBy: typeof e.raisedBy === 'string' ? e.raisedBy : undefined
          }))
        : undefined,
      closedBy: t.closedBy === 'owner' ? 'owner' as const : undefined,
      closedReason: typeof t.closedReason === 'string' ? t.closedReason : undefined,
      result: typeof t.result === 'string' && t.result.trim() ? t.result : undefined
    }));
}

/** House rule 8 asks for an ISO date and time with its offset (isNextAt).
 *  Anything looser is not shown and wakes nobody: "Mon 12 Oct 13:00" parses as
 *  a 2001 date, and a bare date reads as midnight UTC, the evening before west
 *  of it. */
const nextAtFormats = new Map<string, Intl.DateTimeFormat>();

/** A card's next step time in the viewer's local time and the app's language,
 *  like "Mon, 12 Oct, 8:00 AM", with the year when it is not this year
 *  ("Mon, 4 Jan 2027, 9:00 AM"), so a sorted column reads right across the
 *  turn of the year (owner, 2026-10-17). */
export function nextAtLabel(nextAt: string | undefined, lang?: string, now = Date.now()): string | undefined {
  if (!isNextAt(nextAt)) return undefined;
  const when = new Date(nextAt);
  const withYear = when.getFullYear() !== new Date(now).getFullYear();
  const key = `${lang ?? ''}|${withYear ? 'y' : ''}`;
  let f = nextAtFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang || undefined, {
      weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' as const } : {}), hour: 'numeric', minute: '2-digit'
    });
    nextAtFormats.set(key, f);
  }
  return f.format(when);
}

/** The time groups an open column is cut into (owner, 2026-10-17), in time
 *  order, in the viewer's local calendar. Each card goes in the first that
 *  fits. The rest of the current quarter is "This quarter", except in the last
 *  quarter, where it is the rest of the year ("Later this year"), and "Next
 *  quarter" is then next January to March. "Later" is two years or more away. */
export type NextGroup =
  | 'overdue' | 'today' | 'tomorrow' | 'thisMonth' | 'thisQuarter' | 'laterThisYear'
  | 'nextQuarter' | 'nextYear' | 'later' | 'none';

export function nextGroup(nextAt: string | undefined, now = Date.now()): NextGroup {
  if (!isNextAt(nextAt)) return 'none';
  const t = Date.parse(nextAt);
  if (t < now) return 'overdue';
  const d = new Date(t);
  const n = new Date(now);
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  if (day(d) === day(n)) return 'today';
  if (day(d) === day(tomorrow)) return 'tomorrow';
  // Months counted from this January: this month is m, this quarter ends at q.
  const m = n.getMonth();
  const at = (d.getFullYear() - n.getFullYear()) * 12 + d.getMonth();
  const q = m - (m % 3) + 2;
  if (at === m) return 'thisMonth';
  if (at <= q) return q === 11 ? 'laterThisYear' : 'thisQuarter';
  if (at <= q + 3) return 'nextQuarter';
  if (at <= 11) return 'laterThisYear';
  if (at <= 23) return 'nextYear';
  return 'later';
}

/** The order of an open column (owner, 2026-10-17): the earliest Next time
 *  first, cards with none after them; at the same time the higher priority
 *  first, then the order the cards were made (the board's own order). A time
 *  already passed is simply earliest. */
export function byNext<T extends { nextAt?: string; priority: number }>(cards: readonly T[]): T[] {
  const at = (c: T): number => (isNextAt(c.nextAt) ? Date.parse(c.nextAt as string) : Infinity);
  return cards
    .map((c, i) => ({ c, i, t: at(c) }))
    .sort((a, b) => (a.t === b.t ? 0 : a.t < b.t ? -1 : 1) || b.c.priority - a.c.priority || a.i - b.i)
    .map((x) => x.c);
}

/** The first line of a Done card's result, as plain text for the board: its
 *  markdown heading, bullet, emphasis and code marks taken off. Empty when the
 *  card has no result. */
export function resultHeadline(result: string | undefined): string {
  const line = (result ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    // Underscores are emphasis only at a word's edges, so q3_sales_report.md
    // and first_last@acme.com keep theirs.
    .replace(
      /(\*\*|\*|`)(.+?)\1|(?<![\p{L}\p{N}])(__?)(.+?)\3(?![\p{L}\p{N}])/gu,
      (_m, _mark?: string, inner?: string, _under?: string, emph?: string) => inner ?? emph ?? ''
    )
    .trim();
}

/** The Tasks board's filter (issue 158): what the owner typed and one team
 *  member ('' for everyone, 'unassigned' for cards with no assignee). */
export interface TaskFilter {
  query: string;
  assignee: string;
  nameFor?: (id?: string) => string | undefined;
}

/** Is either part of the filter set? While it is, the board unfolds Done. */
export function filterActive(f: TaskFilter): boolean {
  return f.query.trim() !== '' || f.assignee !== '';
}

/** Does a card pass the filter? Every typed word must appear, in any case, in
 *  the card's id, title, description, result, waiting on, or assignee; a member
 *  must be its assignee (or unassigned). */
export function taskMatches(
  task: HiveTask,
  f: TaskFilter,
  nameFor?: (id?: string) => string | undefined
): boolean {
  if (f.assignee === 'unassigned') {
    if (task.assignee) return false;
  } else if (f.assignee && task.assignee !== f.assignee) {
    return false;
  }
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const resolve = f.nameFor ?? nameFor;
  const memberName = resolve ? resolve(task.assignee) : undefined;
  const text = [
    task.id,
    task.title,
    task.description,
    task.result,
    task.waitingOn,
    task.assignee,
    memberName
  ].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}
