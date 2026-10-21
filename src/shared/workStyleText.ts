/**
 * Work style in two forms (owner, 2026-09-27: "the work style on the review
 * step is a LLM prompt. This app is for business users so it should show a
 * plain english language style description which business user can modify.
 * while saving system should automatically convert and align to meet
 * prompting standards").
 *
 *   plain         what the owner reads and edits: third person, about the
 *                 team member, in everyday words.
 *   instructions  what the agent gets (its `goal`): written to the agent, in
 *                 the house format and to the prompting guidelines in
 *                 docs/designs/agent-instructions/appendix-c-prompting-guidelines.md.
 *
 * Main turns one into the other with a hidden Claude call; the prompts are
 * here, beside plain-text fallbacks used when that call can't run. No electron
 * or node imports: main and the renderer use it, tests load it directly.
 */

import { swapName } from './hireTemplates';
import { ownValue } from './ownValue';

export interface WorkStyleContext {
  /** The team member's name. */
  name: string;
  /** Job title. */
  title?: string;
  /** Business name and city, for the instructions' first line. */
  business?: { name?: string; city?: string };
  /** The office manager's name (Michael unless the owner renamed him). */
  manager?: string;
}

/** A heading, or one of the owner's labels, that starts the next section. */
const SECTION_START = /^(#{1,6}\s|(the job|how the work is done|how to work|asks (?:you|the owner) first|needs the owner'?s approval)(:|\s*$))/i;
/** A real First task section start: a heading ("### First task"), the words
 *  alone on their line (older packs wrote "First task" with no marks), or the
 *  owner's label with its colon ("First task: ..."). A duty sentence that only
 *  begins with those words ("First task each morning is the inbox") is not one. */
const FIRST_TASK_HEAD = /^(?:#{1,6}\s*first task\b\s*:?|first task\s*:|first task\s*$)\s*(.*)$/i;

/**
 * The First task section of a Work style, in either form (a "### First task"
 * heading or the owner's "First task:" label): its words, and the text without
 * it. Null when there is none. One-time work is a card now, never part of the
 * standing Work style (docs/designs/first-task-card.md).
 */
export function firstTaskSection(text: string): { body: string; without: string } | null {
  const lines = text.replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => FIRST_TASK_HEAD.test(l.trim()));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && !SECTION_START.test(lines[end].trim())) end++;
  const inline = FIRST_TASK_HEAD.exec(lines[at].trim())?.[1] ?? '';
  const body = [inline, ...lines.slice(at + 1, end)].join('\n').trim();
  const without = [...lines.slice(0, at), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, without };
}

/** The text without its First task section. */
export function withoutFirstTask(text: string): string {
  return firstTaskSection(text)?.without ?? text;
}

const where = (b?: { name?: string; city?: string }) => {
  const n = b?.name?.trim() || 'the business';
  return b?.city?.trim() ? `${n}, ${b.city.trim()}` : n;
};

/** The first line every work style opens with (teamMemberGoal's packs do too). */
export function instructionsOpening(b?: { name?: string; city?: string }): string {
  return `The owner set this work style for your role at ${where(b)}.`;
}

/** The hidden call that turns an agent's instructions into the owner's plain
 *  description. */
export function toPlainPrompt(instructions: string, ctx: WorkStyleContext): string {
  const michael = ctx.manager?.trim() || 'Michael';
  return [
    `Rewrite the instructions below, which were written for an AI team member${ctx.title ? ` whose job is ${ctx.title}` : ''}, as a short plain English description for the small business owner who employs them.`,
    `Write about the team member by role, never by name, because names change: start a sentence with what is done ("Sorts the inbox every morning, so...") or say "${roleLabel(ctx.title)}". Use everyday words a busy owner reads in a minute. Keep every duty, habit and approval rule the instructions contain, and add nothing new.`,
    `Never write "you" or "your": the reader cannot tell who that means. The business owner is "the owner". ${michael} is the office manager: team members report to ${michael} and ${michael} brings to the owner whatever needs them, so anything this role sends, reports or asks for approval goes to ${michael}, even where the instructions say "the owner" or "you". Call a teammate by their role, such as the Sales Director; where the instructions give only a name, say "a teammate". ${michael} is the only name to keep.`,
    'Use three short parts, each a label on its own line followed by a few sentences: "The job:", "How the work is done:", "Asks the owner first:". Leave out a part the instructions have nothing for. Leave out any first task: one time work is a card on the board, not part of the description.',
    'No markdown symbols, no bullet characters, no dashes; use commas, colons and periods. Answer with the description only.',
    '',
    '--- INSTRUCTIONS ---',
    instructions.trim()
  ].join('\n');
}

/**
 * The hidden call that turns the owner's plain description into instructions,
 * to the house prompting guidelines (appendix C): facts with reasons, normal
 * volume, no hedges, what to do rather than what not to do, scope and the
 * approvals stated, no generic virtues, a few hundred words at most.
 */
export function toInstructionsPrompt(plain: string, ctx: WorkStyleContext, previous?: string): string {
  return [
    `Turn the owner's description below into the standing work style for ${ctx.name}, an AI team member${ctx.title ? ` whose job is ${ctx.title}` : ''} at ${where(ctx.business)}. ${ctx.name} reads it at the start of every session.`,
    `In the description, "the owner" is the business owner and ${ctx.manager?.trim() || 'Michael'} is the office manager, who hands out work and brings the owner what needs them. Team members send reports and approvals to ${ctx.manager?.trim() || 'Michael'}, never to the owner directly.`,
    '',
    'Follow these rules, because the team member reads every line literally:',
    `Start with exactly this line: "${instructionsOpening(ctx.business)}"`,
    'Then three sections with these markdown headings, leaving out a section the description has nothing for: "### The job" (one or two sentences on the outcome and why it matters), "### How to work" (short prose sentences, each with its reason after "because" or "so"), "### Needs the owner\'s approval" (what must go to Michael for the owner\'s approval first, with the reason). Leave out any first task or other one time job: it goes on a card on the board, and a work style holds only standing duties.',
    'Address the team member as "you", and name no other team member either: call a teammate by their role, such as the Sales Director, because names change and a renamed teammate would leave a stale name behind. Write the owner\'s preferences as plain statements of fact. Write at normal volume: no capitals for emphasis, no "must", "never" or "critical" unless the owner said it. State each rule directly, without "try to" or "if possible". Say what to do rather than what to avoid.',
    'Keep every duty, habit, limit and approval the owner described, with their meaning unchanged, and add no duties of your own. Leave out generic advice such as being accurate or thorough, and anything about thinking step by step or double checking.',
    'Keep it under 300 words. Use commas, colons and periods, never dashes. Answer with the work style only.',
    ...(previous?.trim()
      ? ['', 'The team member\'s previous work style is below. The description is a plain summary of it that the owner edited, so treat the edit as a change to the previous work style: apply what the owner added, removed or changed, and keep every other detail of the previous work style as it is, including specifics the summary left out such as file names, formats, amounts and deadlines.', '--- PREVIOUS WORK STYLE ---', previous.trim()]
      : []),
    '',
    '--- OWNER\'S DESCRIPTION ---',
    plain.trim()
  ].join('\n');
}

/** What "Suggest me" knows about the new hire (owner, 2026-10-03: writing a
 *  good work style from scratch is hard). */
export interface SuggestRequest {
  ctx: WorkStyleContext;
  /** What the new hire handles: their role description. */
  handles: string;
  /** The business type, as onboarding names it ("Restaurant & Food"). */
  businessType?: string;
  /** Teammates and what each handles, so the suggestion stays clear of them. */
  team: Array<{ name: string; title?: string; handles?: string }>;
}

/**
 * The hidden call behind "Suggest me" on the hire wizard: a first work style
 * the owner reviews and edits, in the plain three part form the field already
 * shows (toPlainPrompt's), built from the role, what they handle, the business
 * and the team. It becomes the agent's instructions at Hire, as any edit does.
 */
export function suggestWorkStylePrompt(req: SuggestRequest): string {
  const { ctx } = req;
  const michael = ctx.manager?.trim() || 'Michael';
  const kind = req.businessType?.trim() ? `, a ${req.businessType.trim()} business` : '';
  const role = ctx.title?.trim() || 'team member';
  // No one is named in a work style (owner, 2026-10-03: names change): the
  // hire and every teammate are given to the model by role only, and a name
  // inside someone's role line becomes that person's role.
  const people = [{ name: ctx.name, title: role }, ...req.team.map((m) => ({ name: m.name, title: m.title?.trim() || 'a teammate' }))];
  const unname = (text: string) => people.reduce((t, p) => swapName(t, p.name, p.title), text);
  const flat = (text: string) => unname(text.replace(/\s+/g, ' ').trim());
  const team = req.team.slice(0, 20).map((m) => `- ${m.title?.trim() || 'A teammate'}: ${flat(m.handles ?? '').slice(0, 300)}`);
  return [
    `Write a first work style for a new AI team member whose job is ${role}, at ${where(ctx.business)}${kind}. The owner will read it, change what they want, and save it.`,
    `What the ${role} handles: "${flat(req.handles)}"`,
    '',
    `The rest of the team, by role, so this work stays clear of theirs:`,
    ...(team.length ? team : ['- (nobody yet)']),
    '',
    `${michael} is the office manager: he hands out work and brings the owner whatever needs them. The ${role} reports and asks for approvals through ${michael}, asks a teammate directly for a fact, and goes to ${michael} when nobody can help or someone else has to do work.`,
    'Write in everyday words a busy owner reads in a minute. Use three short parts, each a label on its own line followed by a few sentences: "The job:" (the outcome and why it matters for this kind of business), "How the work is done:" (four to six concrete habits for this job in this business, each with its reason after "because" or "so"), "Asks the owner first:" (what must wait for the owner\'s approval, with the reason).',
    `Name no person, because names change: start each sentence with what is done ("Checks contact records for duplicates, because...") or say "this role", and call a teammate by their role, such as "the Sales Director". ${michael} is the only name you may use.`,
    `Stay inside what the ${role} handles and leave teammates' work to them. Say nothing about how often or at what time the work runs, because schedules set that. Leave out any first task. Invent no prices, dates, tools, names or policies the owner has not given; say "the owner's" price list, policy or tool instead.`,
    'No markdown symbols, no bullet characters, no dashes; use commas, colons and periods. Keep it under 200 words. Answer with the description only.'
  ].join('\n');
}

const HEADING_LABEL: Record<string, string> = {
  'the job': 'The job:',
  'how to work': 'How the work is done:',
  "needs the owner's approval": 'Asks the owner first:',
  'needs the owners approval': 'Asks the owner first:'
};

/** How the plain description names the team member: their role, never their
 *  name, so a rename leaves nothing stale (owner, 2026-10-03). */
export function roleLabel(title?: string): string {
  return title?.trim() || 'This role';
}

/** A plain description without the model: the opening line addressed to the
 *  agent dropped, headings turned into labels, markdown removed. `label` is
 *  how "you" reads (roleLabel: the role, never a name). */
export function plainFallback(instructions: string, label?: string): string {
  const lines = withoutFirstTask(instructions.replace(/\r/g, '')).split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^the owner set this work style/i.test(line)) continue;
    const h = line.match(/^#{1,6}\s*(.+?)\s*$/);
    if (h) {
      const label = ownValue(HEADING_LABEL, h[1].toLowerCase()) ?? `${h[1].replace(/[:.]+$/, '')}:`;
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(label);
      continue;
    }
    out.push(line.replace(/^[-*•]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'));
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return label?.trim() ? thirdPerson(text, label.trim()) : text;
}

/** The quick rewrite's "you" (the team member, in instructions) as their role
 *  label ("This role sorts", "Sales Director sorts"), so the owner never reads
 *  a "you" that isn't them (owner, 2026-09-27) and no name is written into a
 *  job (2026-10-03). */
export function thirdPerson(text: string, label: string): string {
  // "you sort" becomes "This role sorts": the verb after "you" gets its s, the few
  // helper verbs that don't take one are left as they are.
  const keep = new Set(['can', 'could', 'will', 'would', 'should', 'must', 'may', 'might', 'shall', 'did', 'also', 'always', 'never', 'only', 'then', 'still', 'just', 'often', 'usually', 'first']);
  // Words that only ever follow "you" as an object ("asks you to", "between you
  // and a customer", "tells you what"), never a verb to give an s.
  const object = new Set(['to', 'and', 'or', 'but', 'in', 'on', 'at', 'for', 'with', 'about', 'from', 'as', 'if', 'so', 'than', 'too', 'both', 'all', 'a', 'an', 'the', 'what', 'when', 'where', 'how', 'why', 'whether']);
  const negated: Record<string, string> = { do: 'does', have: 'has', are: 'is' };
  const third = (verb: string): string => {
    if (keep.has(verb) || object.has(verb)) return verb;
    if (verb === 'do') return 'does';
    if (verb === 'go') return 'goes';
    if (/(s|sh|ch|x|z)$/.test(verb)) return `${verb}es`;
    if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
    return `${verb}s`;
  };
  return text
    .replace(/\b[Yy]ou are\b/g, () => `${label} is`)
    .replace(/\b[Yy]ou're\b/g, () => `${label} is`)
    .replace(/\b[Yy]ou have\b/g, () => `${label} has`)
    .replace(/\b[Yy]ourself\b/g, () => label)
    .replace(/\b[Yy]our\b/g, () => `${label}'s`)
    // "you don't" is "doesn't"; "you won't" and "you can't" stay as they are.
    .replace(/\b[Yy]ou (do|have|are)n(['’])t\b/g, (_m, verb: string, q: string) => `${label} ${negated[verb]}n${q}t`)
    .replace(/\b[Yy]ou ([a-z]+)\b(?!['’])/g, (_m, verb: string) => `${label} ${third(verb)}`)
    .replace(/\b[Yy]ou\b/g, () => label);
}

const LABEL_HEADING: Array<[RegExp, string]> = [
  [/^the job:\s*/i, '### The job'],
  [/^how the work is done:\s*/i, '### How to work'],
  [/^asks (?:you|the owner) first:\s*/i, "### Needs the owner's approval"]
];

/** Instructions without the model: the opening line, the owner's labels turned
 *  back into the house headings, their words kept as written. */
export function instructionsFallback(plain: string, ctx: WorkStyleContext): string {
  const out: string[] = [instructionsOpening(ctx.business), ''];
  for (const raw of withoutFirstTask(plain.replace(/\r/g, '')).split('\n')) {
    const line = raw.trim();
    const hit = LABEL_HEADING.find(([re]) => re.test(line));
    if (hit) {
      if (out[out.length - 1] !== '') out.push('');
      out.push(hit[1]);
      const rest = line.replace(hit[0], '').trim();
      if (rest) out.push(rest);
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A model answer cleaned for use: fences and a leading label dropped. */
export function cleanAnswer(text: string): string {
  return text.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
}

/**
 * The check a job's focus area gets on save (docs/designs/schedule-focus-areas.md,
 * FA3): against the team member's Work style and its other jobs' focus areas.
 * A focus may narrow or direct the work; it may not widen duties or approvals,
 * or contradict another job's focus.
 */
export function focusCheckPrompt(p: { name: string; workStyle: string; focus: string; job: string; others: Array<{ job: string; focus: string }>; sending?: string }): string {
  return [
    `${p.name} is an AI team member at a small business. The owner is adding a focus area to one of ${p.name}'s scheduled jobs: what ${p.name} concentrates on each time that job runs.`,
    `A focus area may narrow or direct the work within ${p.name}'s work style. It conflicts when it asks for something the work style rules out or keeps for the owner's approval, when it adds duties or permissions the work style does not give, or when it contradicts another job's focus area.`,
    'Answer with exactly "OK" when there is no conflict. Otherwise answer "CONFLICT: " followed by one short sentence for the owner naming what the focus area asks for and what it contradicts, in everyday words, without dashes.',
    '',
    '--- WORK STYLE ---',
    p.workStyle.trim() || '(none written yet)',
    '',
    // The owner's Sending setting decides email, whatever the work style says
    // (owner, 2026-10-05), so a focus that sends as it allows is no conflict.
    ...(p.sending ? [`--- HOW ${p.name.toUpperCase()}'S EMAIL LEAVES (the owner's Sending setting; it outranks the work style on email) ---`, p.sending, ''] : []),
    '--- OTHER JOBS\' FOCUS AREAS ---',
    p.others.length ? p.others.map((o) => `${o.job}: ${o.focus}`).join('\n') : '(none)',
    '',
    `--- NEW FOCUS AREA, for the job "${p.job}" ---`,
    p.focus.trim()
  ].join('\n');
}

/** The check's answer: no conflict, or the conflict in one sentence. Anything
 *  unreadable counts as unchecked, so a failed call never blocks a save. */
export function parseFocusCheck(answer: string): { ok: true } | { ok: false; conflict: string } | null {
  const a = cleanAnswer(answer);
  if (/^ok\b\.?$/i.test(a)) return { ok: true };
  const hit = /^conflict\s*:\s*([\s\S]+)$/i.exec(a);
  if (hit && hit[1].trim()) return { ok: false, conflict: hit[1].trim().replace(/\s+/g, ' ').slice(0, 400) };
  return null;
}
