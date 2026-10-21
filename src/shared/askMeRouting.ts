/**
 * Where an owner's Ask me answer goes (owner, 2026-09-25). Ask me is how the
 * office reaches the owner when it can't decide or do something itself.
 * The owner only talks to Michael (owner, 2026-10-04): the answer goes to him
 * as a request to route the follow-up, and into the memory notes of the agent
 * that raised it. When Michael raised it himself (a job no one fits, a
 * technical failure), both are Michael.
 */

export const MICHAEL_ID = 'god';

/**
 * The agent that raised a question: its recorded `raisedBy`, else the card's
 * assignee, else Michael. Only an agent this office knows counts, so a stale
 * or mistyped id falls through instead of sending the answer nowhere.
 */
export function raiserOf(
  entry: { raisedBy?: string },
  task: { assignee?: string },
  knownIds: ReadonlySet<string>
): string {
  for (const id of [entry.raisedBy, task.assignee]) {
    if (id && (id === MICHAEL_ID || knownIds.has(id))) return id;
  }
  return MICHAEL_ID;
}

/** The conversation an owner's answer opens with Michael for a card, so his
 *  reply (in_reply_to) and the card can always be matched up. */
export function cardConversation(taskId: string): string {
  return `card:${taskId}`;
}

/** The card a conversation is about, if it is one opened by cardConversation. */
export function cardOfConversation(conversation: string | undefined): string | undefined {
  return conversation?.startsWith('card:') ? conversation.slice(5) || undefined : undefined;
}

/** One message an answer sends. */
export interface AnswerMessage {
  to: string;
  act: 'request' | 'inform';
  subject: string;
  body: string;
  conversation?: string;
  requires_reply?: boolean;
}

/** Card text an agent wrote, as one short line: it goes into messages that
 *  come from the owner and into Michael's context, so it can never pass for a
 *  new line of instructions. */
export function cardText(s: string | undefined, max = 120): string {
  // C1 controls fold too (a NEL reads as a new line), and format characters
  // such as a right to left override are dropped, as in toolLine.
  const one = (s ?? '').replace(/\p{Cf}+/gu, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Most of a question kept in Michael's request; the card has all of it. */
const QUESTION_MAX = 2000;

/**
 * The messages an answer sends (docs/designs/card-lifecycle.md): one, a REQUEST
 * to Michael about the card, so the answer is his open work until he closes it
 * with done; it used to be an inform, a note he could read and set aside, and
 * answered cards stalled in Blocked (owner, 2026-10-02). The team member who
 * raised the question used to get the answer straight from the owner too; now
 * Michael routes the follow-up, to them or someone else (owner, 2026-10-04:
 * the owner only talks to Michael).
 */
export function answerMessages(p: {
  raiser: string;
  raiserName: string;
  taskId: string;
  title: string;
  q: string;
  a: string;
  /** When the owner answered; named on the last line (answeredAtOf). */
  answeredAt?: string;
}): AnswerMessage[] {
  const title = cardText(p.title);
  // The card id comes from the ledger agents write, so it is cleaned like the title.
  const id = cardText(p.taskId, 60);
  // The question is the raiser's text, so it is folded to one labelled line
  // like the title. The answer is the owner's own words and stays as written.
  const qa = [`Q (as written on the card): ${cardText(p.q, QUESTION_MAX)}`, `A: ${p.a}`];
  const forMichael: AnswerMessage = {
    to: MICHAEL_ID,
    act: 'request',
    requires_reply: true,
    conversation: cardConversation(p.taskId),
    subject: `OWNER ANSWER on card ${id}: ${title}`.slice(0, 200),
    body: [
      p.raiser === MICHAEL_ID
        ? `The owner answered the question you raised on card ${id} ("${title}"):`
        : `The owner answered the question ${p.raiserName} raised on card ${id} ("${title}"):`,
      ...qa,
      p.raiser === MICHAEL_ID
        ? 'It is on the card and in your memory notes.'
        : `It is in ${p.raiserName}'s memory notes.`,
      'Route the follow-up: hand the card to the same team member or another, or ask the owner again. Then close this request with a "done" reply (in_reply_to this message). It stays open until you do.',
      // The owner never has to answer every question (owner, 2026-10-15,
      // docs/designs/ask-me-options.md): what they left unanswered goes to the
      // one who raised it, who comes back only for what they still need.
      p.raiser === MICHAEL_ID
        ? 'Check each question of the ask against the answer. Settle any the owner left unanswered yourself where you can, and ask the owner again only for what you still need.'
        : `Check each question of the ask against the answer. Send any the owner left unanswered to ${p.raiserName} with the answers: they settle what they can and file back to you only what they still need. Ask the owner again only for that.`,
      ...(p.answeredAt ? [`Answered at ${p.answeredAt}.`] : [])
    ].join('\n')
  };
  return [forMichael];
}

/** The last line of an answer's request to Michael: which answer it carries,
 *  so the launch catch-up matches each request to its own answer. */
const ANSWERED_AT_LINE = /\nAnswered at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\.$/;

/** The answer time a request to Michael names, if it names one. */
export function answeredAtOf(body: unknown): string | undefined {
  return typeof body === 'string' ? ANSWERED_AT_LINE.exec(body)?.[1] : undefined;
}

/**
 * An open ask stays open until the owner answers it or Michael withdraws it
 * ("dismissedAt"), whatever the card's status and however many asks follow it
 * (owner, 2026-10-04: an open question must never vanish). It used to be only
 * the card's newest ask, so a second, different question on a card silently
 * withdrew the first, and a card moved out of Blocked hid its ask; replaying
 * the ledger found six questions lost that way.
 */
export interface AskEntry { q?: unknown; a?: unknown; dismissedAt?: unknown; kind?: unknown }

/** A report Michael put on Ask me (docs/designs/michael-replies.md, 14A): an
 *  outcome to read, not a question. It never turns the pill coral, never needs
 *  the card Blocked, and "Got it" clears it. */
export const isReport = (e: AskEntry | null | undefined): boolean => !!e && e.kind === 'report';

/** Whether an ask carries a real answer or a real withdrawal: text, never a
 *  blank or a stray value, so a worker writing " " into tasks.json cannot hide
 *  a question from the owner (Codex adversarial review, 2026-10-05). */
const filled = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
export const isAnswered = (e: AskEntry | null | undefined): boolean => !!e && filled(e.a);
export const isWithdrawn = (e: AskEntry | null | undefined): boolean => !!e && filled(e.dismissedAt);

/** Indexes of a card's open entries of one kind (asks or reports), oldest first. */
function openIndexes(qa: readonly (AskEntry | null | undefined)[] | undefined, reports: boolean): number[] {
  if (!Array.isArray(qa)) return [];
  const out: number[] = [];
  qa.forEach((e, i) => { if (e && typeof e.q === 'string' && isReport(e) === reports && !isAnswered(e) && !isWithdrawn(e)) out.push(i); });
  return out;
}

/** Indexes of the card's open asks, oldest first. Reports are not asks. */
export function openAskIndexes(qa: readonly (AskEntry | null | undefined)[] | undefined): number[] {
  return openIndexes(qa, false);
}

/** Indexes of the card's open reports (not yet read with "Got it" or answered). */
export function openReportIndexes(qa: readonly (AskEntry | null | undefined)[] | undefined): number[] {
  return openIndexes(qa, true);
}

/** The renderer's humanQA merged onto the card's list on disk. The renderer
 *  can only add an answer: the list stays the disk's, entry for entry, and a
 *  slot takes the renderer's "a" and "answeredAt" only while the question is
 *  the same and still open on disk. Its list is a few seconds old, so a
 *  withdrawal (dismissedAt) Michael wrote since, a slot whose question changed
 *  and an entry added on disk all stand (pre-landing review, 2026-10-05).
 *  `only`: the one slot being answered; no other slot takes an answer, so a
 *  stale answer in the list never lands on a question asked again since.
 *  `added`: the slots that took an answer. */
export function mergeHumanQA(onDisk: unknown[], incoming: unknown[], only?: number): { humanQA: unknown[]; added: number[] } {
  const added: number[] = [];
  const humanQA = onDisk.map((d, i) => {
    if (only !== undefined && i !== only) return d;
    const e = incoming[i];
    if (!d || typeof d !== 'object' || !e || typeof e !== 'object') return d;
    const disk = d as AskEntry;
    const next = e as AskEntry & { answeredAt?: unknown };
    if (typeof disk.q !== 'string' || disk.q !== next.q || isAnswered(disk) || isWithdrawn(disk)) return d;
    if (typeof next.a !== 'string' || !next.a.trim()) return d;
    added.push(i);
    // Which option and which parts ride along only with the owner's own answer,
    // so text an agent wrote into an open ask never counts (eng review R2).
    const extra = answerDetail(d as AskEntry & AskShapeFields, next as { picked?: unknown; partAnswers?: unknown });
    // Drop any the agent left on the open ask, so only the owner's own survive.
    const { picked: _p, partAnswers: _pa, ...base } = d as AskEntry & { picked?: unknown; partAnswers?: unknown };
    return { ...base, a: next.a, ...(typeof next.answeredAt === 'string' ? { answeredAt: next.answeredAt } : {}), ...extra };
  });
  return { humanQA, added };
}

/* ───────────────── Options and several questions (ask-me-options.md) ───────────────── */

/** One option Michael wrote on an ask. */
export interface AskOption { label: string; recommended?: boolean }
/** One question of an ask with several; it may carry its own options (a mixed ask). */
export interface AskPart { q: string; options?: AskOption[] }
/** The fields that give an ask its shape. An entry has one or the other. */
export interface AskShapeFields { options?: unknown; parts?: unknown }

/** What the card shows for an ask: a choice, several questions, or today's
 *  plain card. Michael writes these fields by hand, so anything the app can't
 *  read falls back to the plain card; there are no count or length limits
 *  (owner, eng review D2). */
export type AskShape =
  | { kind: 'plain' }
  | { kind: 'choice'; options: AskOption[] }
  | { kind: 'parts'; parts: AskPart[] };

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function readOptions(v: unknown): AskOption[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: AskOption[] = [];
  for (const o of v) {
    const label = o && typeof o === 'object' ? text((o as { label?: unknown }).label) : null;
    if (!label) return null;
    out.push((o as { recommended?: unknown }).recommended === true ? { label, recommended: true } : { label });
  }
  return out;
}

export function readAskShape(entry: AskShapeFields | null | undefined): AskShape {
  if (!entry) return { kind: 'plain' };
  const hasOptions = entry.options !== undefined;
  const hasParts = entry.parts !== undefined;
  if (hasOptions === hasParts) return { kind: 'plain' };
  if (hasOptions) {
    const options = readOptions(entry.options);
    return options ? { kind: 'choice', options } : { kind: 'plain' };
  }
  if (!Array.isArray(entry.parts) || !entry.parts.length) return { kind: 'plain' };
  const parts: AskPart[] = [];
  for (const raw of entry.parts) {
    const q = raw && typeof raw === 'object' ? text((raw as { q?: unknown }).q) : null;
    if (!q) return { kind: 'plain' };
    const opts = (raw as { options?: unknown }).options;
    if (opts === undefined) { parts.push({ q }); continue; }
    const options = readOptions(opts);
    if (!options) return { kind: 'plain' };
    parts.push({ q, options });
  }
  return { kind: 'parts', parts };
}

/** The owner's answer to one question of several: a chip, typed text, or both. */
export interface PartAnswer { chip?: number; text?: string }

/** One part's answer as words, or null when it was left unanswered. */
export function partAnswerText(part: AskPart, ans: PartAnswer | undefined): string | null {
  const chip = ans?.chip !== undefined ? part.options?.[ans.chip]?.label : undefined;
  const typed = ans?.text?.trim() ?? '';
  if (chip) return typed ? `${chip} (${typed})` : chip;
  return typed || null;
}

/**
 * The owner's answer in words (decision 5A): the option's own words, never a
 * bare number, so Michael, memory notes and Task detail read it on their own.
 * Several questions name the ones left unanswered, which Michael routes to
 * whoever raised them (eng review D1). Empty when there is nothing to send.
 */
export function labeledAnswer(shape: AskShape, d: { pick?: number; note?: string; parts?: (PartAnswer | undefined)[] }): string {
  const note = d.note?.trim() ?? '';
  if (shape.kind === 'choice') {
    const label = d.pick !== undefined ? shape.options[d.pick]?.label : undefined;
    if (!label) return note;
    return note ? `Picked: ${label}. Note: ${note}` : `Picked: ${label}`;
  }
  if (shape.kind === 'parts') {
    const lines: string[] = [];
    const missing: number[] = [];
    shape.parts.forEach((part, i) => {
      const a = partAnswerText(part, d.parts?.[i]);
      if (a) lines.push(`${i + 1}: ${a}`); else missing.push(i + 1);
    });
    if (!lines.length && !note) return '';
    if (missing.length) lines.push(`Not answered: ${missing.join(', ')}`);
    if (note) lines.push(`Also: ${note}`);
    return lines.join('. ');
  }
  return note;
}

/** The ask as plain text for Michael and memory notes: the question, then its
 *  options or numbered questions, since those no longer sit in the text. */
export function askAsText(q: string, shape: AskShape): string {
  if (shape.kind === 'choice') {
    return [q, ...shape.options.map((o, i) => `${i + 1}. ${o.label}${o.recommended ? ' (recommended)' : ''}`)].join('\n');
  }
  if (shape.kind === 'parts') {
    return [q, ...shape.parts.map((p, i) => `${i + 1}. ${p.q}${p.options ? ` (${p.options.map((o) => o.label).join(' / ')})` : ''}`)].join('\n');
  }
  return q;
}

/** The picked option and each part's answer, kept on the entry beside its
 *  answer, only when they fit the ask on disk. */
function answerDetail(disk: AskShapeFields, incoming: { picked?: unknown; partAnswers?: unknown }): { picked?: number; partAnswers?: (string | null)[] } {
  const shape = readAskShape(disk);
  const out: { picked?: number; partAnswers?: (string | null)[] } = {};
  if (shape.kind === 'choice' && Number.isInteger(incoming.picked) && (incoming.picked as number) >= 0 && (incoming.picked as number) < shape.options.length) {
    out.picked = incoming.picked as number;
  }
  if (shape.kind === 'parts' && Array.isArray(incoming.partAnswers) && incoming.partAnswers.length === shape.parts.length
    && incoming.partAnswers.every((x) => x === null || typeof x === 'string')) {
    out.partAnswers = incoming.partAnswers as (string | null)[];
  }
  return out;
}
