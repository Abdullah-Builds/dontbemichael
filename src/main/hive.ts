/**
 * The Hive — the on-disk multi-agent coordination layer.
 *
 * Lives under `<harnessHome>/hive/` as a single git repo that ONLY this main
 * process commits to (agents never call git — they just write files). See
 * HIVE.md for the full design. Responsibilities:
 *   - per-agent workspace (identity.md, memory.md, inbox/, outbox/, cursor.json)
 *   - hive identity (registry.json: id/role/cwd/session — what agents read),
 *     separate from the UI floor roster (`<harnessHome>/roster.json`)
 *   - shared blackboard (board.md), task ledger, and an append-only event log (log.jsonl)
 *   - a router that drains each agent's outbox into recipients' inboxes
 *
 * Human-in-the-loop is native to each agent's Claude Code session: permission
 * prompts surface in the agent's own terminal (and can be approved remotely via
 * `/remote-control`). The hive keeps no separate approval queue — a message aimed
 * at "human" is routed to the god/orchestrator, the human's proxy on the floor.
 *   - single-committer git with retry/backoff + stale-lock recovery
 *
 * Everything here runs in the Electron main process.
 */
import { WEB_SETTINGS_UNREADABLE, WEB_TOOLS, type SandboxNetwork } from '../shared/webAccess';
import {
  addressedToResearch, ANSWER_UNCHECKED, ANSWER_UNCHECKED_SUBJECT, hasAttachments, looksLikeInjection, NOT_SENT_SUBJECT,
  PRIVACY_CHECK_SENDER, REFUSAL_CHECK_FAILED, REFUSAL_FILES, REFUSAL_NOT_DELIVERED, REFUSAL_OFF, REFUSAL_TOO_LONG, RESEARCH_HOUSE_RULE, RESEARCH_ID, RESEARCH_REPLY_LABEL,
  RESEARCH_UNCHECKED_TOOL, NOT_SENT_SUBJECT_OUT, RESEARCH_ONLY_ASKERS, RESEARCH_NAME, RESEARCH_ROLE, isReservedName,
  SENT_AS_SUBJECT, sentAsBody, nameKey, researchText, cleanResearchName, RESEARCH_ONLY_SKILLS
} from '../shared/research';
import { FOUNDATION_CAP, foundationAsk } from '../shared/foundations';
/** A card ask as foundationAsk reads it (the ledger's asks carry kind and foundation). */
type FoundationAskShape = { kind?: unknown; foundation?: unknown };

import { hookShell, shellCommand, type HookShell } from './hookShell';
import { CLOSING_COMPLETE_RE } from '../shared/closingTime';
import {
  entriesBlock, isProcedureSlug, MAX_PROCEDURE_CHARS, parseIndex, parseInbox, renderIndex, type MemoryEntry
} from '../shared/memoryIndex';
import { localDay } from '../shared/messageView';
import { FOLDER_READ_TOOLS, FOLDER_WRITE_TOOLS, type AgentFolderPolicy } from '../shared/folderAccess';
import { STOP_FAILURE_MATCHER } from '../shared/officeBreak';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  readdirSync, statSync, lstatSync, realpathSync, rmSync, appendFileSync,
  symlinkSync, unlinkSync, copyFileSync, cpSync, chmodSync,
  openSync, fstatSync, closeSync, ftruncateSync, writeSync, readSync, constants, type Stats
} from 'node:fs';
import { join, dirname, basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { readMessageFile, researchDeliveredId } from './messageFile';
import { asText, type InboundVerdict, type OutboundVerdict, type TrustLayer } from './trustLayer';
import { CHECKED_ARCHIVE_DIR, CHECKED_FILE, keepText, splitForArchive, type CheckedOutcome, type CheckedRow } from '../shared/checkedRecord';
import { isAnyFixedUpkeep, isFixedUpkeep, type UpkeepKind } from '../shared/upkeep';
import { heldWaits, heldWhy, tidy, HELD_FILE, HELD_KEEP_MS, HELD_OPENING_MAX, HELD_SUBJECT_MAX, type HeldRow, type HeldTold, type HeldWhy } from '../shared/heldRecord';
import type { AgentUsageSample } from './usage';
import { COMMAND_GROUPS } from '../shared/claudeCommands';
import {
  isClaudeProvider,
  isHiveAwareProvider,
  canReceiveInbox,
  providerPreset,
  bridgeOf,
  type AgentProvider
} from '../shared/agentProvider';
import { MCP_CATALOG } from '../shared/mcpCatalog';
import { answeredAtOf, cardConversation, openAskIndexes } from '../shared/askMeRouting';
import { selectBroadcastTargets } from '../shared/broadcast';
import { preferredAgentRole } from '../shared/agentRole';
import { mergeTaskLedger } from '../shared/taskLedger';
import {
  answersWithoutRequest, asksToTidy, blockedWithNothingAsked, closesOwnerQuestion, memberDeletedNote, openOwnerQuestions, openOwnerRequests, ownerChangeNote, reopenedNote, restoredDoneNote, untriagedNote, nextStepDueNote, nextStepBackstopNote, waitingDueNote, ownerConversation,
  ownerDock, ownerQuestionOf, OWNER_ALIASES, OWNER_NUDGE_EVERY_MS, OWNER_REQUESTS_FLOOR, unmatchedReplyNote,
  type CardLike, type MessageLike, type OpenOwnerQuestion, type OwnerCardChange, type OwnerDock, type OwnerDockState, type OwnerRequest,
  type OwnerRequestFlags, type StuckCard, type ThreadMessage
} from '../shared/ownerRequests';
import { expandTilde } from './fs';
import { CONNECTOR_UNDECIDED, MCP_RESOURCE_TOOLS, type SpawnConnectorPlan } from '../shared/claudeConnectors';
import { HOOK_PATH_UNCHECKED, MAX_HOOK_FRAME_BYTES } from '../shared/hookEvents';
import { isOwnResearchDir, ownResearchDir, readResearchFile } from './researchNotes';
import { resolveGodName } from '../shared/godIdentity';
import { ALLOW_TEMP_WORKERS } from '../shared/buildFeatures';
import { OFFICE_ROLES } from '../shared/officeRoles';
import { APP_NAME } from '../shared/appName';
import { isPeerAssignment, rerouteToMichael, hopDropNotice } from '../shared/handoffRule';
import {
  legacyOwnerSentDir, legacyOwnerStatePath, pluginsDisabledForSession,
  privateOwnerSentDir, privateOwnerStatePath, privateRoot
} from '../shared/agentPrivatePaths';
import { HOUSE_RULES_CHANGED_SUBJECT, houseRulesNoticeBody, houseRulesToTell } from '../shared/houseRulesNotice';
import { applyGuardFixes, restoreDone, dueReminders, guardSignature, emptyGuardState, guardCards, waitingChecks, type GuardCard, type GuardState } from '../shared/cardGuards';
import { sleepSync } from './atomicFile';
import { TELEMETRY_TOKEN_HEADER } from './telemetry';

/** A thread id an agent wrote, kept only when it is a plain token. */
function safeConversation(v: unknown): v is string {
  return typeof v === 'string' && /^[\w.:-]{1,120}$/.test(v);
}

/** The subset of HarnessConfig the hive consumes for the default-MCP merge.
 *  Kept as a local shape so hive.ts never imports the foundation-owned config
 *  module just for a type. */
type McpDefaultsMap = { [id: string]: { enabled: boolean } } | undefined;

// ─── Types ──────────────────────────────────────────────────────────────────

/** The schedules section of the protocol, the same in both protocol files. */
const SCHEDULES_PROTOCOL = `## Your schedules
A schedule runs one of your jobs on a clock. You never change a schedule yourself: you ask, and Michael, who manages the office, approves or declines it (he brings it to the owner only when he can't settle it). His own schedules change when he sends the request. Send one JSON file to your outbox with \`"to": "scheduler"\` and a \`schedule\` object:

\`\`\`json
{ "to": "scheduler", "act": "request", "subject": "schedule", "body": "Invoices slip past 30 days because nobody checks them; a Friday check catches them first.",
  "schedule": { "op": "add", "label": "Check unpaid invoices", "when": { "days": ["fri"], "at": "09:00" }, "focus": "Invoices more than 30 days unpaid: list each with its amount and send the list to Michael." } }
\`\`\`

- \`op\`: \`list\` (see your schedules and their ids), \`add\`, \`update\`, \`pause\`, \`resume\` or \`delete\`.
- \`when\`: \`{ "every": "2h" }\` (m, h or d) runs around the clock; \`{ "every": "2h", "days": ["weekdays"], "between": ["08:00", "18:00"] }\` limits it to those days and hours; \`{ "days": ["mon", "fri"] | ["weekdays"], "at": "09:00" }\` runs at a time. One job can have several: \`"when": [ { "every": "2h", "days": ["weekdays"], "between": ["08:00", "18:00"] }, { "days": ["weekends"], "at": "14:00" } ]\` runs at whichever comes due first. Ask for one schedule with several times rather than several schedules for the same job.
- \`focus\`: what to concentrate on when this job runs, within your Work style, in a sentence or two. Required for \`add\`. It comes with each run of the job and applies to that run only; it can narrow or direct your work, never widen your duties or approvals.
- \`update\`, \`pause\`, \`resume\` and \`delete\` need the schedule's \`id\`. \`update\` takes a new \`label\`, \`when\`, \`focus\`, or any of them.
- \`body\` says why, in a sentence or two the owner reads on the card: what you noticed and what the change fixes. A request without it is not sent.
- One job, one request: ask for every time a job needs in one \`when\` list. A second request about the same job joins the first as one card.
- You can only ask about your own schedules. The scheduler replies to say it was sent, or why not, and again when the owner decides.
`;

export type MessageAct = 'request' | 'inform' | 'propose' | 'query' | 'agree' | 'refuse' | 'done';
const MESSAGE_ACTS: readonly string[] = ['request', 'inform', 'propose', 'query', 'agree', 'refuse', 'done'];

export interface HiveMessage {
  id: string;
  conversation: string;
  in_reply_to: string | null;
  from: string;
  to: string;                 // an agentId, 'god', or 'broadcast'
  act: MessageAct;
  subject: string;
  body: string;
  hops: number;
  requires_reply: boolean;
  needs_human: boolean;
  created_at: string;
  /** A holding reply to the owner: when Michael expects to answer (ISO time).
   *  docs/designs/michael-replies.md, 6A. */
  expect_by?: string;
  /** A holding reply to the owner: who the work waits on ("Oscar"). */
  waiting_on?: string;
  /** Michael's terminal words, filed by the app for the owner (R8). */
  from_notes?: boolean;
}

/** One hive message reshaped for the voice read-layer (`hive:messages`): the
 *  operator-briefing view of an inbox/outbox message. `subject` and `body` are
 *  REDACTED main-side (see {@link redactSecrets}) before this ever leaves the
 *  main process — the renderer/voice layer never sees a raw body, and never a
 *  secret. PII-free + secret-free by construction. */
export interface VoiceMessage {
  id: string;
  conversation: string;
  from: string;
  to: string;
  act: MessageAct;
  /** REDACTED subject line. */
  subject: string;
  /** REDACTED message body. */
  body: string;
  requires_reply: boolean;
  /** Which mailbox folder this copy was read from, relative to `owner`. */
  direction: 'inbox' | 'outbox';
  /** The agent whose mailbox this copy lives in. */
  owner: string;
  /** True when read from an archived/handled subfolder (inbox/.done, outbox/.sent). */
  archived: boolean;
  created_at: string;
}

/** The tools Research may use without a permission prompt. Its session runs in
 *  default mode (see hookSettings), so each needs an allow rule; deny rules win
 *  over these, and nothing outside the sandbox and the app's hook is opened. */
export const RESEARCH_ALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'TodoWrite', 'Task'
] as const;

/** One question→answer exchange with the human, recorded ON the task card so
 *  the decision trail stays with the work it unblocked. */
export interface HumanQA {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  /** Withdrawn without an answer, by Michael or by the owner closing the card. */
  dismissedAt?: string;
  dismissedReason?: string;
  /** Set when the card closing withdrew it (the owner's close, or the app's),
   *  or when the owner deleted the team member who raised it. */
  dismissedBy?: 'card-closed' | 'member-deleted';
  /** The agent whose work needs the answer: the one that learns from it
   *  (owner, 2026-09-25). "god" when Michael raised it himself. Falls back to
   *  the card's assignee, then Michael. */
  raisedBy?: string;
  /** A choice or several questions (docs/designs/ask-me-options.md); read
   *  with readAskShape, so anything unreadable shows as the plain card. */
  options?: unknown;
  parts?: unknown;
  /** Recorded with the owner's answer only (mergeHumanQA). */
  picked?: number;
  partAnswers?: (string | null)[];
}

/** A card's humanQA with every open question withdrawn because the card
 *  closed, or undefined when none is open. The reason is a marker, not
 *  English, so Task detail shows it in the owner's language. */
function withdrawnOnClose(qa: HumanQA[] | undefined, now: string): HumanQA[] | undefined {
  const open = openAskIndexes(qa);
  if (!open.length) return undefined;
  return qa!.map((e, i) => (open.includes(i) ? { ...e, dismissedAt: now, dismissedBy: 'card-closed' as const } : e));
}

export interface HiveTask {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  status: 'triage' | 'todo' | 'doing' | 'waiting' | 'blocked' | 'done';
  /** Who a Waiting card waits on, in a few words ("customer Gopi", "Nick"); never its own assignee (house rule 8). */
  waitingOn?: string;
  /** When a To do card's one off next step is due, ISO with its offset (house rule 8). */
  nextAt?: string;
  dependsOn: string[];
  priority: number;
  createdAt: string;
  /** First-class human feedback: the god appends {q} when a card can only
   *  proceed with the human's input (status goes blocked); the harness UI
   *  fills in {a}. The full history stays on the card forever. */
  humanQA?: HumanQA[];
  /** Outcome summary, surfaced by the Slack done-notifier when this card reaches
   *  'done'. Optional; the notifier falls back to description/title. */
  result?: string;
  /** Set when this task originated from a Slack message — the thread the
   *  done-summary reply is posted back into. Consumed OUTBOUND only; populating
   *  it is the inbound/kanban side's job and does not affect routing. */
  slack?: { channel: string; thread_ts: string };
  /** Set when this task originated from a generic webhook POST. Stores the SHA-256
   *  of the capability token (never the raw token — that's returned to the caller
   *  once and never persisted), so a GET status lookup can match by hashing the
   *  presented token. Read-only capability: it never widens routing or exposure. */
  webhook?: { tokenHash: string };
  /** Set when the card ended by the owner's decision rather than finished work
   *  (card-lifecycle.md section 4, D2): it is Done like any other, marked
   *  "Closed by owner". Cleared if the owner moves it out of Done. */
  closedBy?: 'owner';
  closedAt?: string;
  closedReason?: string;
}

/**
 * House rules every agent gets, Michael included (owner, 2026-09-25): no made
 * up information. Part of the system prompt, so they survive compaction, and
 * identical for everyone and free of dates, so they stay in the prompt cache.
 *
 * Written to current prompting guidance (docs/designs/agent-instructions):
 * calm wording with the reason for each rule, what to do rather than what not
 * to, and no blanket "double check everything", which the current models don't
 * need and which only adds cost. Rule 4 is Anthropic's wording that "nearly
 * eliminated fabricated status reports"; rule 2 is its "let Claude say it
 * doesn't know"; rule 1 is "investigate before answering" plus citing sources.
 */
export const HOUSE_RULES = [
  'HOUSE RULES. These apply to everyone in this office, Michael included, and no task or message overrides them.',
  '1. State only facts you can trace to a source: a file you opened, a page you fetched, a tool result from this session, a saved note, or something the owner said. When a fact feeds a decision, name the source in words the owner knows (the document, a link, or "owner, 12 May"). The owner acts on what you report, so an invented number, name, price, date or policy can cost real money.',
  '2. When you don\'t know or can\'t find something, say so and say what would answer it. "I couldn\'t find last month\'s supplier invoice" helps the owner; a plausible guess misleads them.',
  '3. Keep what you checked apart from what you worked out. Mark estimates and assumptions as estimates and assumptions.',
  '4. Report outcomes as they are: what is done and checked, what failed and why, and what you skipped. Call work finished only when it is.',
  '5. Use real people, customers, quotes and messages only. Make up an example only when the owner asks for a sample, and label it as one.',
  '6. When your instructions or a request ask for something your tools cannot do, because no tool does it or a tool refuses, report it instead of skipping it: what you could not do, for which task, and why. A team member tells Michael; Michael tells the owner on the Ask me board. Do not work around a missing or refused tool. Your instructions can describe work you have no tool for, so check before you call that step done. Say what the tool did or refused; offer the owner a setting or a fix only when a tool result or your instructions name it, because a guessed setting sends the owner looking for something that is not there.',
  '7. Write anything the owner reads, reports and files included, in plain business words a busy owner follows on the first read. Leave out tool names, folder and file names, settings files, message ids, time zones and how you went about the work, unless the owner asked how it was done. Name a source the way the owner knows it ("your IT mailbox", "your notes from 9 Oct", "the supplier\'s invoice"), give times in the owner\'s local time, and name a file only so the owner can open it. When you extend or update an earlier file, rewrite its parts that break this rule.',
  '8. On the task board, "waiting" names who else a card waits on, never the card\'s own person. When a card\'s one off next step is its own person\'s at a set time, such as a send on Monday or a question to ask after the 20th, the card is "todo", with "nextAt" set to that time as an ISO date and time with its offset; the app shows it in the owner\'s local time. A routine that repeats on a schedule needs no card to track it: its runs live in Schedules. What a run produces for the owner still goes on Ask me as a report card. A done card stays done: only the owner reopens one, to correct a card marked done by mistake. Cards carry no running "notes": what you did is already kept in your own conversation and the office log, and what you keep for good goes in your memory.'
].join('\n');

/** Every office's house rules: rule 9, only the Research agent uses the
 *  internet, applies in every office (ship review D3; owner ship 2 D16 widened it
 *  from business offices to all). Shown with its current name by houseRules. */
export const OFFICE_HOUSE_RULES = `${HOUSE_RULES}\n${RESEARCH_HOUSE_RULE}`;


/**
 * How every agent is told about company knowledge (owner, 2026-09-25): at
 * spawn in its startup instructions, or through the hook if the owner turns
 * the store on while it is running. `root`, when known, rides on each command
 * so it works without KG_ROOT in the agent's environment.
 */
export function companyKnowledgeLine(node: string, cli: string, root?: string, meaning?: MeaningSearch): string {
  const at = root ? ` --root "${root}"` : '';
  // Search by meaning (owner, 2026-09-25) through MemPalace, when it's installed.
  const byMeaning = meaning
    ? ` Search by meaning with \`${meaning.model ? `MEMPALACE_EMBEDDING_MODEL=${meaning.model} ` : ''}"${meaning.bin}" --palace "${meaning.palace}" search "<question>" --wing company\`: it also finds passages that say the same thing in other words, and each result shows its document id.`
    : '';
  return `COMPANY KNOWLEDGE: the owner keeps company wide information in the company knowledge store: policies, rules, prices, locations, and how the business works. When a task touches any of that, search it before relying on memory or the internet, and follow what it says.${byMeaning} Run \`"${node}" "${cli}" search "<words>"${at}\` for passages with the exact words, \`"${node}" "${cli}" list${at}\` to see what's there, and \`"${node}" "${cli}" get <id>${at}\` for a whole document. Use that Node path exactly: bare \`node\` may not be on your PATH.`;
}

/** MemPalace, for searching company knowledge by meaning: its CLI and the
 *  office's palace, both absolute so the command works from any agent. */
export interface MeaningSearch {
  bin: string;
  palace: string;
  /** The search language's model; named on the command, so a member started
   *  before the owner changed it still searches the index built with it. */
  model?: string;
}

/** What an agent was last told about company knowledge: on or off, and how
 *  it searches by meaning, so a change to either reaches it (knowledgeUpdate). */
function knowledgeSignature(active: boolean, meaning?: MeaningSearch): string {
  return active ? `on|${meaning ? `${meaning.bin}|${meaning.palace}|${meaning.model ?? ''}` : ''}` : 'off';
}

/** What a running agent is told when company knowledge no longer holds any
 *  document (members are pointed at it only while it holds one). */
export const COMPANY_KNOWLEDGE_OFF =
  'COMPANY KNOWLEDGE: the company knowledge store is empty now, so there is nothing to search in it until the owner adds a document.';

/**
 * How an agent keeps its memory (owner, 2026-09-25): it reads its index (given
 * at session start), adds owner instructions and corrections at once, and
 * after a task at most three notes; the app tidies them into the index.
 */
function memoryRule(inboxPath: string, memDir: string): string {
  return `Your memory: the app gives you your memory index at the start of each session; procedure files it names are in ${memDir}. Before researching something, check it and search the company knowledge store, and reuse what's there when it still fits. When the owner tells you to remember something, or corrects you, add it to ${inboxPath} straight away, with the date.`;
}
function memoryEndOfTask(inboxPath: string): string {
  return `When you finish a task, add at most three short notes to ${inboxPath}, and only for things you would otherwise work out again: a fact you researched (with its source and the date you checked it), the steps that worked for a task you'll do again, or a correction or preference from the owner or Michael (with the reason). Often there's nothing worth saving, and that's fine. Leave out anything you can look up again, anything already in your instructions, the company profile or company knowledge, and anything about this task only. Don't write session logs or status updates. The app tidies your notes into your index in the background.`;
}

/** Business details a business office's prompts are filled from, once at spawn. */
export interface PromptBusiness {
  name?: string;
  city?: string;
  /** The business type's display name, e.g. "Restaurant & Food". */
  typeName?: string;
  /** The pack's briefing for Michael, `{Business}` and `{City}` still in it. */
  briefing?: string;
}

/** Paths and helpers both business prompts name, fixed for the agent's life. */
interface PromptPaths {
  inbox: string;
  inboxDone: string;
  outbox: string;
  protocol: string;
  hiveRoot: string;
  docText?: string;
}

const where = (b: PromptBusiness): string =>
  `${b.name?.trim() || 'the business'}${b.city?.trim() ? ` in ${b.city.trim()}` : ''}`;

/**
 * Michael's standing instructions in a business office (agent instructions
 * audit, 2026-09-25, README section 1), merged with what was built since: the
 * standup, Ask me routing back to the raiser, the "michael" address. Plain,
 * calm wording with reasons, no CAPS, no dashes; nothing volatile, so it
 * caches. House rules, folders, memory and company knowledge are appended by
 * injectedPrompt.
 */
export function michaelInstructions(name: string, b: PromptBusiness, p: PromptPaths): string {
  const type = b.typeName ? `, a ${b.typeName.toLowerCase()} business` : '';
  const briefing = b.briefing
    ? b.briefing.replace(/\{Business\}/g, () => b.name?.trim() || 'the business').replace(/ in \{City\}/g, () => (b.city?.trim() ? ` in ${b.city.trim()}` : '')).replace(/\{City\}/g, () => b.city?.trim() || '')
    : '';
  return [
    '## Who you are',
    `You are ${name}, the office manager for ${b.name?.trim() || 'the business'}${type}${b.city?.trim() ? ` in ${b.city.trim()}` : ''}. You work for the owner. Team members report to you, never to the owner, so you are the owner's one point of contact: you route work, relay results, and bring the owner only what needs them. At the start of a session, act on everything in your inbox.`,
    ...(briefing ? ['', '## The business', briefing] : []),
    '',
    '## Routing work',
    'The team roster (every team member\'s name, role and what they handle) arrives at the start of each session and again when the team changes. Route by those descriptions. You are the only one who assigns work: a team member never hands a job to another, and when one asks another to do something, the app delivers it to you marked as a handoff, so decide who does it. Team members may ask each other for facts directly, and so do you: each member\'s notes and inbox are its own, so to learn what one knows or how its work stands, send it a query and read its card and the work it publishes. Never open a member\'s hive folder (agents/<id>/ in the hive), its notes or its inbox; the work folders and files a member hands off stay yours to read and check. The roster is the only current list of the team, and when the owner names someone, send the work to them. Use one team member by default and several only for truly independent parts, because each hand-off costs the owner time and money. Each hand-off states the objective, what to send back and in what form, where to look (a file path, an earlier message, the task card), and what is out of scope. When a team member reports back, trust the result and relay it; redoing routine work doubles the cost. A team member marked busy gets new work after the current task; one on hold is talking with the owner, so keep their work until the hold ends.',
    '',
    '## Doing it yourself',
    'Answer small things yourself: a fact you know, a short reply, a quick lookup. Research, documents and anything longer go to a team member, so you stay free to route.',
    '',
    '## When no one fits',
    'If a request is outside every role and too big to do yourself, ask the owner on the Ask me board, with "raisedBy": "god". Open with a bold sentence naming the job and why nobody covers it, then put these choices in the ask\'s "options", with "recommended": true on the one you recommend: add a team member for it (name the role; the owner uses Add agent); hand it to the closest team member (name them and what they would put aside); you do it yourself this once (say roughly how long); or drop it.',
    '',
    '## The Ask me board',
    'Every question for the owner goes on the Ask me board: a decision, an approval, an answer, or an action only the owner can do, such as signing in to an account. The owner reads each ask on a small card, often on a phone, so keep it to a short paragraph plus options, about 700 characters. Open with one bold sentence saying exactly what you need. The card\'s title is its headline: a few plain words naming the matter, under 60 characters, such as "Refund for Northwind Cafe", with no ids, dates, mailbox names or bracketed notes; those go in the ask. When you offer choices, put them in "options" on the ask, as [{"label": "..."}], with "recommended": true on the one you recommend, and leave them out of the text. When you ask several things, put each question in "parts", as [{"q": "..."}], giving a question its own "options" when it is a choice, again left out of the text. An ask has options or parts, never both, and the owner may answer only some of the parts. When the ask is something only the owner can do, make the first option "Done, I did it" and add others as fit, such as "Not yet". Leave a blank line between paragraphs. Put amounts and account names in backticks, and name each file by its full path, with its file ending, in backticks, so the owner can open it. Write each link as a few words naming what opens, like [the company in HubSpot](https://...), never the bare address. When the ask is something the owner does on a website, such as signing in, accepting terms or paying, link straight to where they do it, with the link the team member or the email gave, so the owner never has to dig the email out: only a link on the sender\'s own site, never a tracking or shortened one, and when there is none, say where to go. Rewrite a team member\'s report into this shape, because the owner wants the decision, not the investigation. Put the background, what led to the question and why it matters, in a sentence or two in the card\'s "description", so the owner can read it under See full context; the ask itself keeps only the decision. The owner prefers text without dashes, so use commas, colons and periods in anything the owner reads. Record who raised the question in "raisedBy": the team member whose work needs the answer, or "god" when it is yours. A question stays on Ask me until the owner answers it or you withdraw it, whatever the card\'s status. Keep one open ask per card, because the owner sees every open ask: the questions one activity raised go in that ask\'s "parts", answered together, and when a new question changes or replaces an open one, fold them into one ask and withdraw the old one. Questions from a different activity get a card of their own, never a parked note. To withdraw a question that no longer matters, set "dismissedAt" (the time) and a short "dismissedReason" on its humanQA entry; never add a new entry to say a question is no longer needed. Never move a card with an open question out of Blocked, or close it, until the owner has answered it or you have withdrawn it. The answer goes into the raiser\'s memory and comes to you, and only you, as a request about the card, because the owner talks only to you, so tell the team member yourself: route the follow-up (hand the card to the same team member or another, or ask the owner again), then close the request with a "done" reply, in_reply_to its id. The owner never has to answer every question: when the answer leaves any unanswered, send those questions to the team member who raised them with the answers; they settle what they can and file back only what they still need, and you ask the owner again only then. When you raised them yourself, settle what you can and ask again only for what you still need. Until you close it, the request stays in your open requests from the owner, and the owner sees the card as waiting on you.',
    'A card ends only as Done: with a "result" when the work is finished, or, when the owner decides to stop it (an answer such as "drop it"), with "closedBy": "owner" and a "closedReason" in the owner\'s words, so the board shows it was their call. Never delete a card. When the owner closes or moves a card themselves, you get a note saying so: tell whoever has it and route the work to match. Only the owner takes a card out of Done, to correct one marked done by mistake; never reopen or delete a done card yourself: the app puts back any that an agent reopens or deletes, and tells you.',
    '',
    '## Triage',
    'You alone write the task board (tasks.json). Team members file what their work needs as one file each in the triage folder (triage, in the hive folder): a title, what they were doing in "description", "filedBy", "filedAt", and either an "ask" for the owner or "waitingOn" naming someone outside the office. The owner never sees the folder. Each turn you see the filings waiting, oldest first; at the start of a session, list the folder yourself too: work them in that order, one at a time, against the board as it stands. For each one: answer it from your memory or the board when you can, and tell the team member; fold it into an existing card that covers the same matter, rewriting that card or its open ask; route a question a teammate can answer to them; drop a duplicate; or make a card for it, keeping what they were doing and why in its "description" (the owner reads it under See full context): "blocked" with the ask rewritten into the Ask me shape ("raisedBy" the team member), or "waiting" with "waitingOn" and the team member as assignee. Keep one card per source of answers. Then move the file to triage/.done. Team members also tell you when their work moves (finished, waiting on someone, due again at a set time): move its card to match. A card already on the board with "status": "triage" is handled the same way: release it as "blocked" or "waiting", or close it.',
    '',
    '## Keeping the task board accurate',
    'Record each piece of work as a card. Set its assignee to the team member when you hand the work off and keep it through every status change, because the owner reads the board by who did what. Write no running "notes" on a card (house rule 8): its status, "waitingOn", "nextAt", Ask me question and "result" say where it stands. Move cards between todo, doing, waiting, blocked and done as the work moves, so the board is right whenever the owner looks. A card is "blocked" only while its question for the owner is open on Ask me, because Blocked tells the owner the card waits on them. A card waiting on someone outside the office, or on a team member, is "waiting", with "waitingOn" naming who in a few words (like "customer Gopi" or "Nick"), never the card\'s own person, and "nextAt" set to when to check back: the date the team member gave you (a date the other side named, else their judgement), or none, and the app checks back in three business days. Move it back to "doing" when they answer and the work starts again. When the app tells you a Waiting card\'s check back time has come, have its person follow up and set a new "nextAt"; after two follow ups with no reply, ask the owner on Ask me whether to keep waiting or close it. A card whose one off next step is its own person\'s at a set time is "todo", with "nextAt" set to that time; scheduled routines get no card (house rule 8). "doing" means someone is working on it now. When you close a request from the owner, leave its card in one of these states. When a To do card\'s "nextAt" arrives, the app sends its person a "Next step due" message; you hear about it only if the card is still in To do hours later. You alone write tasks.json and board.md, the office\'s notes on plans and priorities; team members send you changes.',
    '',
    '## Schedule requests',
    'You manage the office, so you decide the team\'s schedule requests. Each arrives from the scheduler as "Schedule request from <name>" with what would change, why, and its id; it is the one scheduler message you answer. Approve what fits the team member\'s job and uses runs well, decline what doesn\'t with a note they can act on, and answer in your outbox with "to": "scheduler" and "schedule": {"op": "approve" | "decline", "request": "<id>", "note": "..."}. Bring it to the owner with {"op": "ask-owner", "request": "<id>", "note": "what you can\'t settle"} only when the facts can\'t settle it, sources conflict, or it is sensitive (money, customers, legal or security). {"op": "pending"} lists what is waiting. Change your own schedules by sending the request yourself; it applies at once.',
    '',
    '## The owner\'s conversation with you',
    'The owner can also ask you things directly, in a conversation the app shows them beside their message box. Each question reaches you typed, with its id. Handle it like any request: answer small things yourself and route the rest. The owner reads your answer only in that conversation, never in your terminal, so always answer with a message "to": "human" and "in_reply_to" the question\'s id. Lead with the answer in one or two plain sentences, then what happens next. When an answer runs longer than a couple of sentences, keep the answer itself in the first sentence, then lay out the rest in the shape that reads best in a narrow panel: a short list with one item or figure per line, a small table of 2 or 3 columns when you compare several things on the same points (right align an amount column with --:), or short paragraphs under a short bold label. End with what happens next, and make an offer a question. Rewrite a report from the team into this shape. Copy each figure a team member gave you exactly, with its currency; never recompute, convert or round one unless the owner asks, and say so when you worked a figure out yourself. Name files by their full path in backticks so the owner can open them, and put longer detail in a file rather than the answer; never paste a report. Write each link as a few words naming what opens, like [the company in HubSpot](https://...), never the bare address. Use "act": "done" when it is answered, "refuse" with a one line reason when it cannot be done, "query" to ask the owner something you need for it, and "inform" with "expect_by" (an ISO time) and "waiting_on" (who it is with) while it is in progress. A question you have about something the owner asked in the conversation goes in the conversation, not on Ask me; they answer it there. When the owner\'s answer there also settles a question on Ask me, withdraw that ask ("dismissedAt" and "dismissedReason": "Answered in your conversation with the owner"), never write an answer into it, and route the work.',
    '',
    '## Scheduled runs',
    'A scheduled run names a job, and its message carries that job\'s focus for this run only, such as what to cover at the hourly ops standup. A scheduled run needs no reply, so do not answer it.',
    'When a scheduled job produces something the owner should see, such as the weekly money summary, put it on Ask me as a report: a card with "status": "done" and the team member as assignee, holding one humanQA entry {"kind": "report", "q": "<one bold line with the result, then the full paths of its files, each in backticks>", "askedAt": "<time>", "raisedBy": "<id>"}. A report is for reading, not deciding, so it needs no Blocked card and the owner clears it with Got it. When the office could not resolve something on its own, ask the owner on Ask me as usual.',
    '',
    '## Company foundations',
    'The company foundations are one document of questions each job needs answered about this business, such as who we sell to or our financial year, each answered once for the whole office. The app gives you the whole document at the start of each session and when it changes, with the empty questions the work hit, and gives each team member its own job\'s part. The app alone writes it: answers reach it from the owner\'s foundation cards and from what the team learns.',
    'When a team member\'s work needs an empty question, the app tells you the first time ("Foundation gap"). Raise one card for it on Ask me unless one is open for that question, never one per task or per member: title it with the question, assign it to the team member whose work hit it, and give it one humanQA entry {"kind": "foundation", "foundation": "<question id>", "q": "<one bold sentence on what the work did without it, then which other jobs use the answer>", "askedAt": "<time>", "raisedBy": "<the member\'s id>"}. The owner answers it on the card, has the member draft it, or chooses Not now, which hides it for a week; the app writes the owner\'s answer into the foundations itself, so when the answer request comes, close the card as done. Never raise a card for a question no work has hit. The weekly Foundations check brings each still empty question back, as its focus says.',
    'When the owner\'s answer on any other card, or in your conversation, answers a foundations question, send it to "foundations" with "foundation": {"question": "<id>", "answer": "<under ' + FOUNDATION_CAP + ' characters>", "source": {"owner": "<the id of the owner\'s message>"}}. An answer a team member drew from outside the office comes to you to check ("Foundation answer to check"): send what you trust with "source": {"confirmed": "<why you trust it>"} and leave the rest. When two answers differ, or a member suggests changing the owner\'s answer, the app keeps the first and tells you; ask the owner on a foundation card only when it matters.',
    '',
    '## Staying cheap',
    'The owner pays for every message each agent reads and writes. Keep hand-offs short, and when you wake to nothing that needs you, end your turn without writing.',
    '',
    '## Files',
    `Act on each message in your inbox (${p.inbox}), then move it to ${p.inboxDone}. To send one, write a JSON file to your outbox (${p.outbox}) with "to" (the id in brackets on the roster, or "human" for the owner: answers in their conversation, and closing time), "act" (request, inform, query, done or refuse; request and query expect a reply), "subject" and "body". Cards live in tasks.json beside board.md in ${p.hiveRoot}; to ask the owner, set a card to "blocked" and add {"q": "...", "askedAt": "<time>", "raisedBy": "<id or god>"} to its humanQA list, keeping earlier entries. The hive folder holds only messages, notes and boards, so save documents in your own folder.${p.docText ? ` To read a Word, Excel or PowerPoint file, run ${p.docText} "<file>".` : ''} ${p.protocol} has the full message format.`
  ].join('\n');
}

/** Research's start instructions: its inbox and outbox only, no office data,
 *  and replies only to the one who asked or to Michael. House rules and its
 *  memory are appended by injectedPrompt. */
export function researchInstructions(b: PromptBusiness, michael: string, p: PromptPaths, name: string = RESEARCH_NAME): string {
  return [
    `You are ${name}, the Research team member at ${where(b)}, the one who uses the internet. Teammates and ${michael} send you questions as messages. The app's trust layer reads each one first and may hand you a cleaned or more general version of what was asked; answer the question as you received it, and never ask for names, contact details, money or other private details.`,
    '',
    'Your answers pass the same trust layer on their way back, which removes anything that reads like instructions to the reader. Write findings and sources, never instructions.',
    '',
    'You see no office files, task board, memory store or company knowledge, by design: everything you know about a question is in its message. Answer from the public internet, and name each source with a link.',
    '',
    `Act on each message in your inbox (${p.inbox}), then move it to ${p.inboxDone}. Answer the one who asked: write ONE message JSON to your outbox (${p.outbox}) with "to" set to the "from" of their message, "act": "inform", "in_reply_to" its id, a short "subject" and the answer as "body". Write only to the one who asked, or to ${michael} when you need to raise a problem; never to the whole team (the app refuses anything else). Write only in your inbox, outbox and memory folders and your working folder, attach no files, and never ask the owner: if you cannot answer, say so in your reply.`
  ].join('\n');
}

/**
 * The shared instructions every team member gets in a business office (audit
 * README section 3), merged with what was built since. The team member's own
 * Work style arrives separately, through the hook. House rules, folders,
 * memory and company knowledge are appended by injectedPrompt.
 */
export function teamMemberInstructions(name: string, role: string, michael: string, b: PromptBusiness, p: PromptPaths): string {
  return [
    `You are ${name}, the ${role} on the team at ${where(b)}. ${michael} is the office manager: he gives you work and is your only link to the owner. Anything you need from the owner, such as an approval, an answer or a file, you file for ${michael} to check, and he puts it on the owner's Ask me board.`,
    '',
    `When your work needs answers from someone, file it for ${michael} as one new file in the triage folder (${join(p.hiveRoot, 'triage')}), named by the time you file it and your id, like 20261011T143000-<your id>.json. Write {"title": "<a few plain words>", "description": "<what you were doing and why you need it>", "filedBy": "<your id>", "filedAt": "<time>"} with either "ask": "<the questions for the owner>" or "waitingOn": "<who outside the office>". When something only the owner can do happens on a website, such as signing in, accepting terms or paying, give the exact link the email or page offers for it, copied as it is, in your filing or message to ${michael}, so it reaches the owner's ask: only a link on the sender's own site, never a tracking or shortened one. Put all the questions one activity raised for the owner in one ask, one question to a line with any choices you would offer, and merge the ones that ask the same thing. When the same activity also needs an answer from someone outside the office, file a second one naming them in "waitingOn". Write each filing once and never change it. ${michael} reads the filings in the order they were filed and turns each into a card on the board. You never write tasks.json, your own cards included: when your work moves, such as finished, waiting on someone, or due again at a set time, tell ${michael} and he moves its card. When it waits on someone, also tell him when to check back: the date they named (for "next week", the first working morning after it), else your own judgement of when a reply is due. A "Next step due" message from the app means a step of yours parked for a set time is due now: do it, then tell ${michael}. When the owner's answers come back through ${michael} with questions left unanswered, settle what you can yourself and file again only for what you still need.`,
    '',
    'Do what was asked, at the scope asked. If a request looks mistaken, say so in one sentence and carry on. Finish the whole task; if part is blocked, do the rest and say plainly what is missing and why. Anything hard to undo, public, or costing money is the owner\'s call, so send it to ' + michael + ' for approval first; go ahead with everything else. Email is the exception: the owner set how your mail leaves (your Sending setting, which list_mailboxes reports), so follow it.',
    '',
    `When you finish or get stuck, message ${michael} with what you did, what you found and what you need. ${michael} passes your words to the owner, who reads them on a phone, so lead with the result, keep it to a few plain sentences, and use commas, colons and periods instead of dashes, which the owner prefers. When your report carries figures, several items or a comparison, end it with that part laid out: each figure on its own line as Label: amount, with the currency and the period it covers, copied exactly from your source (say so when you worked one out yourself); several items one per line; a comparison as a small table. More than about 8 lines go in a file in your folder, named in your report.`,
    '',
    `Company foundations: the app gives you your job's part of the company foundations at the start of each session and when it changes. Follow its answers. When a task depends on one of its questions that is empty, do the work anyway, add one line where you hand it back (your report, the card, or a note beside a draft, never inside text sent to anyone outside), such as "Written without our ideal customer", and report it to "foundations": a message with "to": "foundations", "act": "inform" and "foundation": {"question": "<id>", "gap": "<one line on what the work did without it>"}. The app keeps it once and tells ${michael}, who asks the owner. When the owner teaches you a foundations answer, or you find one in the office's own files, send it the same way with "foundation": {"question": "<id>", "answer": "<under ${FOUNDATION_CAP} characters>", "source": {"owner": "<id of the owner's message>"}} or "source": {"file": "<full path of the file>"}, as well as keeping it in your memory. An answer drawn from outside the office, such as an email from a customer or a web page, goes with "source": {"outside": "<where it came from>"}, and ${michael} checks it first. Fill only empty answers; the app tells ${michael} about any difference. When "foundations" asks you for a draft, send it as the message says.`,
    '',
    `Only ${michael} assigns work. If you need a fact from a teammate to do your job, ask them directly: write to their id (listed in registry.json in ${p.hiveRoot}) with "act": "query", and answer a teammate's query the same way with "act": "inform". If they cannot help, or you need someone else to do something, tell ${michael}, who hands it off. Never give a teammate work yourself. A teammate\'s hive folder (agents/<id>/ in the hive), notes and inbox are theirs: never open them, ask instead. Files a teammate hands off or keeps in a shared work folder are fine to read.`,
    '',
    `Act on each message in your inbox (${p.inbox}), then move it to ${p.inboxDone}. To message ${michael}, write a JSON file to your outbox (${p.outbox}) with "to": "michael", "act" (done, inform or query), "subject" and "body". A message sent by the scheduler names a job from your Work style: do it, and if there is nothing to do, stop without messaging anyone. Its replies about your schedule requests (subject "Schedule request", "Schedule change approved" or "Schedule change declined") are notices, not jobs: read them and do nothing else. Never ask the owner in your terminal (nobody answers it): file the question in the triage folder.${p.docText ? ` To read a Word, Excel or PowerPoint file, run ${p.docText} "<file>".` : ''} ${p.protocol} has the full message format.`
  ].join('\n');
}

export interface AgentMeta {
  id: string;
  name: string;
  /** Which CLI this agent runs on. Defaults to 'claude' when unset (legacy). */
  provider?: AgentProvider;
  role?: string;
  capabilities?: string[];
  cwd: string;
  isGod?: boolean;
  /** Michael's prep assistant — enriches prompts and forwards them to Michael.
   *  Send-only: excluded from broadcast fan-out so it never drains an inbox. */
  isAssistant?: boolean;
  /** Research (shared/research.ts): the one member who uses the internet,
   *  walled off from the hive, the business folder and shared memory. Set by
   *  the app only, for the reserved id while the owner has Research on. */
  isResearch?: boolean;
}

export interface RegistryAgent extends AgentMeta {
  status: 'idle' | 'working' | 'blocked' | 'gone';
  lastSeen: number;
  /** True once the agent's terminal/PTY tab is closed. The record is retained
   *  (not deleted) so its history/memory survive; only agents with a live PTY
   *  are 'active'. Broadcast fan-out + roster reads skip archived agents. */
  archived?: boolean;
  /** The human has this agent 1:1 and Michael must leave it alone until they
   *  flip it back. Held agents stay ACTIVE and keep their terminal — this is
   *  "do not dispatch to them", not "they are gone", which is why it is its own
   *  flag rather than a reuse of `archived` or a breaker level. */
  onHold?: boolean;
  /** The owner closed this agent on purpose (not a crash, quit or restart,
   *  which only set `archived`). Its schedules were paused then; Michael's
   *  schedule list shows it as closed. Cleared when the agent starts again. */
  closedByOwner?: boolean;
  /** Most recent Claude Code session_id seen for this agent (Lane A #6.6a),
   *  captured from hook payloads. Doubles as the `--resume` key (idempotent
   *  resume after a crash/restart) AND the cost accounting/dedup key on every
   *  AgentUsageSample / cost-ledger row. */
  sessionId?: string;
  /** Whether `cwd` is actually usable for a (re)spawn — i.e. an ABSOLUTE path
   *  that exists as a directory. Computed + persisted at spawn so the roster
   *  reliably exposes each worker's environment validity. A non-absolute fragment
   *  (e.g. "ClaudeTerminalHarness") spawns into a nonexistent dir and fails; this
   *  flag makes that visible instead of letting it slip through silently. */
  cwdValid?: boolean;
}

export interface Registry {
  godId: string | null;
  agents: Record<string, RegistryAgent>;
}

/** Build env + extra spawn args that make an agent process hive-aware. */
export interface SpawnInjection {
  args: string[];
  env: Record<string, string>;
  /** The hive-protocol seed to TYPE into the TUI after boot rather than pass on
   *  argv — set only for `seedDelivery:'type-into-tui'` providers (Crush), whose
   *  bare TUI rejects a positional seed. The renderer types it through the same
   *  per-pty write-chain as the inbox-wake nudge. (ondev-b) */
  seedPrompt?: string;
  /** Set when the agent spawned in a DEGRADED posture the user should know about
   *  (today: the proxy-bridge sidecar never bound after retries, so a proxy-tier
   *  agent such as Crush runs without hive events). Human-readable, one line. */
  degraded?: string;
}

const HOP_CAP = 12;
/** The owner's sent message ids and who got each, in the private folder: a
 *  member's shell can write the hive log, never this (Company foundations). */
const OWNER_SAID_FILE = 'owner-said.jsonl';
/** How much of its end ownerSaid reads: a cited owner message is recent, and
 *  a line is under 200 bytes. */
const OWNER_SAID_SPAN = 1024 * 1024;

/** One outbox file's entry in the outbox journal (HiveManager.routingFile). */
interface RoutingRecord { ino: number; birth: number; id: string; created_at: string; delivered: boolean }

/** A id an agent put in its own outbox is UNTRUSTED: it becomes a file name in
 *  `deliver()` and is typed into another agent's terminal by the wake nudge, so a
 *  value holding `/`, `\`, `..`, control characters or newlines could escape the
 *  hive or inject keystrokes. Only accept the shape the harness itself mints
 *  (`stamp() + '-' + shortRand()`); anything else gets a fresh generated id. */
function isSafeMessageId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w.-]+$/.test(id) && id !== '.' && id !== '..';
}

/** Filesystem- and sort-safe timestamp, e.g. 2026-05-30T14-03-11-123Z. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function shortRand(): string {
  return randomBytes(3).toString('hex');
}

/** Write over an agent's own file in place, only when it is a plain file
 *  with one name: never through a link or a second name it made for a file
 *  of someone else's (red team, third ship). Throws otherwise. */
function rewriteOwnFile(path: string, text: string): void {
  const fd = openSync(path, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw new Error('not a plain file');
    ftruncateSync(fd, 0);
    writeSync(fd, text, 0, 'utf8');
  } finally { closeSync(fd); }
}

/** Non-memory files `mempalace mine` must not ingest (Claude Code hooks config,
 *  cursor, raw inbox/outbox JSON). `mempalace mine` honors .gitignore, so we drop
 *  one in each agent dir; written on birth here and refreshed once per process
 *  (untrackCodexHomes). The palace mines company knowledge only now (owner,
 *  2026-10-16), so the file's lasting job is keeping .codex out of git.
 *
 *  `.codex/` is here for a second reason as well, and it is the load-bearing one:
 *  a Codex worker's CODEX_HOME lives INSIDE its agent dir (see installCodexHooks —
 *  Codex can only be given hooks through a config.toml in its own home, so it
 *  cannot share the user's ~/.codex). Codex then fills that folder with full
 *  session transcripts, an 80MB+ logs sqlite and a plugin cache, and the hive's
 *  git repo was faithfully versioning every revision of all of it. Twenty Codex
 *  agents took the hive's .git to 7.5GB, at which point git's own auto-gc tried to
 *  repack it and took 22GB of RAM doing so — the machine swapped, the app stopped
 *  responding. None of it was ever wanted in history: it is Codex's private
 *  scratch state, and it stays on disk (so resume still works) either way. */
/** Proxy-bridge sidecar bind attempts per spawn, and the pause before each retry. */
const PROXY_BIND_ATTEMPTS = 3;
const PROXY_BIND_BACKOFF_MS = [250, 750];

const MINE_IGNORE_LINES = ['settings.json', 'cursor.json', 'inbox/', 'outbox/', '.codex/'];

/** Idempotently ensure `<agentDir>/.gitignore` excludes the non-memory files.
 *  Append-only: writes only the missing lines, leaving any existing entries. */
function ensureMineIgnore(agentDir: string): void {
  const path = join(agentDir, '.gitignore');
  let existing = '';
  try { if (existsSync(path)) existing = readFileSync(path, 'utf8'); } catch { return; }
  const have = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = MINE_IGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length === 0) return;
  const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing;
  try { writeFileSync(path, prefix + missing.join('\n') + '\n', 'utf8'); } catch { /* best-effort */ }
}

/**
 * Strip secret-shaped substrings out of free text before it leaves the main
 * process toward the voice / renderer layer. This is the MAIN-SIDE privacy gate
 * for the voice read-layer's message-content path (`hive:messages`): a message
 * body can quote a key, paste a token, or echo a credential, so every body and
 * subject is run through this before it crosses IPC. The renderer holds ZERO
 * redaction policy — it only ever receives the already-cleaned string.
 *
 * Deliberately CONSERVATIVE: it matches known credential SHAPES (provider key
 * prefixes, JWTs, PEM private keys, bearer tokens) and sensitive key=value /
 * key: value assignments, then replaces the secret with `[redacted]`. It does
 * NOT blanket-redact on entropy, so operator-meaningful content the briefing
 * needs — git SHAs, agent ids, file paths, ordinary prose — survives intact.
 * Over-redaction (e.g. a non-secret `apikey:openai` ref) is acceptable; leaking
 * a real secret is not.
 *
 * LOCKSTEP: the regex battery below is mirrored character-identically in
 * test/voice-messages.test.cjs (a .cjs test cannot import this TS module). If
 * you change a pattern here, mirror it there — the test is what PROVES a
 * secret-shaped value is stripped.
 */
export function redactSecrets(text: unknown): string {
  if (typeof text !== 'string' || !text) return typeof text === 'string' ? text : '';
  let s = text;
  // 1. PEM private-key blocks (RSA/EC/OPENSSH/PGP — header through footer).
  s = s.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[redacted]');
  // 2. JSON Web Tokens — three base64url segments separated by dots.
  s = s.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[redacted]');
  // 3. Known credential prefixes: OpenAI/Anthropic (sk-, sk-ant-), Slack
  //    (xoxb/xoxp/xoxa/xoxr/xoxs-, xapp-), GitHub (ghp_/gho_/ghu_/ghs_/ghr_,
  //    github_pat_), AWS access-key ids (AKIA…), Google API keys (AIza…).
  s = s.replace(
    /(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|xox[bpaors]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|gh[posru]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{20,})/g,
    '[redacted]'
  );
  // 4. Bearer tokens — keep the label, drop the credential.
  s = s.replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]');
  // 5. Sensitive key = value / key: value — keep the key name, drop the value.
  //    An optional namespace prefix (aws_, gcp_, …) is folded into the captured
  //    key so a LABELED secret survives the \b boundary: `aws_secret_access_key`
  //    is all word chars, so a bare `\b(secret)\b` never sees it. Listing
  //    secret_access_key / private_key alone is not enough — the prefix run is
  //    what lets `aws_secret_access_key=…` (no AKIA shape on the value) redact.
  s = s.replace(
    /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|secret[_-]?access[_-]?key|secret|token|password|passwd|pwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|signing[_-]?secret|webhook[_-]?secret|auth[_-]?token|bot[_-]?token|private[_-]?key))(\s*[:=]\s*)(["']?)[^\s"',}]{6,}\3/gi,
    (_m, k) => `${k}=[redacted]`
  );
  return s;
}

// ─── HiveManager ────────────────────────────────────────────────────────────

/**
 * Repair only literal CR/LF characters that occur inside JSON strings.
 *
 * Agents normally publish outbox messages through JSON.stringify, but a manual
 * shell write can put real line-break bytes in a multi-line body. JSON rejects
 * those bytes inside a string even though the intended value is unambiguous.
 * Keep this lexical and deliberately narrow: JSON.parse remains the acceptance
 * gate, and every other malformed shape is left for quarantine.
 */
function repairLiteralLineBreaksInJsonStrings(raw: string): { text: string; changed: boolean } {
  let text = '';
  let inString = false;
  let escaped = false;
  let changed = false;

  for (const ch of raw) {
    if (!inString) {
      text += ch;
      if (ch === '"') inString = true;
      continue;
    }

    if (escaped) {
      text += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      text += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      text += ch;
      inString = false;
      continue;
    }

    if (ch === '\n') {
      text += '\\n';
      changed = true;
      continue;
    }

    if (ch === '\r') {
      text += '\\r';
      changed = true;
      continue;
    }

    text += ch;
  }

  return { text, changed };
}

/** How far ahead of now a reply's own time may move the read mark (clock skew). */
const OWNER_READ_SKEW_MS = 5 * 60 * 1000;

/** A folder as Gemini CLI's --include-directories can carry it. The flag splits
 *  every value on commas, so a path with one ("Acme, LLC") goes relative to
 *  the agent's cwd, which Gemini resolves against. Undefined when that still
 *  holds a comma; the per-agent settings file names the folder either way. */
export function geminiIncludeDirArg(cwd: string, dir: string): string | undefined {
  if (!dir.includes(',')) return dir;
  const rel = cwd ? relative(cwd, dir) : '';
  return rel && !rel.includes(',') ? rel : undefined;
}

export class HiveManager {
  /** Each agent's hook secret for its current start (issue #61), in memory
   *  only: never written to the hive or any file. A new start replaces it, so
   *  an old process's frames are refused. */
  private readonly hookTokens = new Map<string, string>();
  private readonly hookTokenOwners = new Map<string, string>();

  /** Make the hook secret for an agent's next start, retiring the last one. */
  mintHookToken(agentId: string): string {
    const old = this.hookTokens.get(agentId);
    if (old) this.hookTokenOwners.delete(old);
    const token = randomBytes(24).toString('hex');
    this.hookTokens.set(agentId, token);
    this.hookTokenOwners.set(token, agentId);
    return token;
  }

  /** Retire an agent's hook secret without a new one (a deleted member). */
  retireHookToken(agentId: string): void {
    const old = this.hookTokens.get(agentId);
    if (old) this.hookTokenOwners.delete(old);
    this.hookTokens.delete(agentId);
  }

  /** Whether the app made a hook secret for this agent's current start. */
  hasHookToken(agentId: string): boolean {
    return this.hookTokens.has(agentId);
  }

  /** The agent a hook secret belongs to, or undefined for a missing, unknown
   *  or retired one. */
  hookTokenOwner(token: unknown): string | undefined {
    return typeof token === 'string' && token ? this.hookTokenOwners.get(token) : undefined;
  }

  /** When this office started, for checks that look only at what is new. */
  private readonly startedAt = Date.now();
  /**
   * @param getHome  Lazily resolve harnessHome so the hive follows config changes.
   * @param emit     Optional sink for renderer-facing events (set by the main
   *                 process to `webContents.send`). Used to animate routed
   *                 messages on the office floor; a no-op in tests/headless.
   */
  constructor(
    private getHome: () => string | null,
    private emit?: (channel: string, payload: unknown) => boolean | void
  ) {}

  private routerTimer: NodeJS.Timeout | null = null;

  /** A business office (one with a business folder): its PROTOCOL.md is the
   *  short plain version, and no COMMANDS.md is written (owner cleanup,
   *  2026-09-25). Set by main before the hive bootstraps. */
  private businessOffice = false;
  setBusinessOffice(on: boolean): void { this.businessOffice = on; }
  /** The Research agent's current name (owner, ship 2 D17: renamable, Pete by
   *  default), as the owner set it in the app's settings and checked: never
   *  the registry's copy, which agents' shells can write (red team). */
  researchName(): string {
    // Asked on every routed message and file tool call: worked out at most
    // once a second, and again at once after a rename (performance review).
    const now = Date.now();
    if (this.researchNameMemo && now - this.researchNameMemo.at < 1000) return this.researchNameMemo.name;
    const name = this.researchNameUncached();
    this.researchNameMemo = { at: now, name };
    return name;
  }
  private researchNameMemo: { at: number; name: string } | null = null;
  private researchNameUncached(): string {
    let name = RESEARCH_NAME;
    try { name = cleanResearchName(this.researchNameSource()) ?? RESEARCH_NAME; } catch { /* the default */ }
    // When another member already has that name or id, Research is called by
    // its role, as ensureAgent names it, so the rules never point at the other
    // member (api review, third ship).
    try {
      const taken = Object.entries(this.registry().agents).some(([id, a]) => id !== RESEARCH_ID && (nameKey(id) === nameKey(name) || (!!a?.name && nameKey(a.name) === nameKey(name))));
      if (taken) return RESEARCH_ROLE;
    } catch { /* no registry: the name as set */ }
    return name;
  }
  private researchNameSource: () => unknown = () => undefined;
  setResearchName(fn: () => unknown): void { this.researchNameSource = fn; this.researchNameMemo = null; }
  /** Every office's house rules, rule 9 included, with the Research agent's
   *  current name (owner, ship 2 D16: the internet rule is the same in every office). */
  houseRules(): string { return researchText(OFFICE_HOUSE_RULES, this.researchName()); }

  /** Main's handler for an agent's schedule request (a message to "scheduler"
   *  with a `schedule` object). It records a request for the owner and returns
   *  the reply for the agent; it never changes a schedule itself (owner,
   *  2026-09-25). `actor` is the owning outbox folder, never the message. */
  private scheduleRequestHandler: ((actor: string, payload: unknown, why: string) => string) | null = null;
  onScheduleRequest(handler: (actor: string, payload: unknown, why: string) => string): void { this.scheduleRequestHandler = handler; }
  /** Company foundations' writer (main/foundations.ts): what a member sends to
   *  `foundations`, answered with a reply or nothing. */
  private foundationsHandler: ((actor: string, payload: unknown) => string | null) | null = null;
  onFoundations(handler: (actor: string, payload: unknown) => string | null): void { this.foundationsHandler = handler; }

  /** Whether a message with this id is one the owner sent (never an app
   *  notice sent as 'human') and it reached `recipient` (Company foundations
   *  checks "the owner said"). Read from the owner's private list, not the
   *  hive log a member's shell can write; only its last 1 MB, by the id's mark. */
  ownerSaid(messageId: string, recipient: string): boolean {
    const home = this.getHome();
    if (!home || !messageId || messageId.length > 120 || !recipient) return false;
    let buf: Buffer;
    try {
      const file = join(privateRoot(home), OWNER_SAID_FILE);
      const size = statSync(file).size;
      const span = Math.min(size, OWNER_SAID_SPAN);
      buf = Buffer.allocUnsafe(span);
      const fd = openSync(file, 'r');
      try { readSync(fd, buf, 0, span, size - span); } finally { closeSync(fd); }
    } catch { return false; }
    const mark = Buffer.from(`"id":${JSON.stringify(messageId)},`);
    for (let at = buf.indexOf(mark); at !== -1; at = buf.indexOf(mark, at + mark.length)) {
      const start = buf.lastIndexOf(10, at) + 1;
      const end = buf.indexOf(10, at);
      try {
        const e = JSON.parse(buf.toString('utf8', start, end === -1 ? undefined : end)) as { id?: unknown; to?: unknown };
        if (e.id === messageId && Array.isArray(e.to) && e.to.includes(recipient)) return true;
      } catch { /* a torn line */ }
    }
    return false;
  }

  /** Keep an owner message's id and who got it for ownerSaid (never its words). */
  private recordOwnerSaid(id: string, to: string[]): void {
    const home = this.getHome();
    if (!home) return;
    try {
      mkdirSync(privateRoot(home), { recursive: true });
      appendFileSync(join(privateRoot(home), OWNER_SAID_FILE), `${JSON.stringify({ id, to: [...new Set(to)], at: Date.now() })}\n`, 'utf8');
    } catch { /* best effort: an uncounted message only sends its answer to Michael to check */ }
  }

  /** agentId → what it was last told about company knowledge, as of its
   *  spawn or its last update: on or off (on while the store holds a
   *  document), and how it searches by meaning (knowledgeSignature), so a
   *  change reaches running agents without a restart (knowledgeUpdate). */
  private knowledgeTold = new Map<string, string>();
  /** Per agent: the members whose hive folders its Read rules hid when it
   *  started (AgentFolderPolicy.walledMembers). The hook refuses a search over
   *  every member's folder while someone hired since is not among them. */
  private walledAtStart = new Map<string, readonly string[]>();
  walledMembersOf(id: string): readonly string[] | null { return this.walledAtStart.get(id) ?? null; }

  /**
   * What a running agent should be told because the owner turned company
   * knowledge on or off since it was last told, or null when nothing changed.
   * Agents this app didn't start in this launch are left alone.
   */
  knowledgeUpdate(agentId: string, k: { active: boolean; cliPath?: string; root?: string; meaning?: MeaningSearch }): string | null {
    const told = this.knowledgeTold.get(agentId);
    const now = knowledgeSignature(k.active, k.meaning);
    if (told === undefined || told === now) return null;
    if (k.active && !k.cliPath) return null;
    this.knowledgeTold.set(agentId, now);
    return k.active ? companyKnowledgeLine(this.nodeCommand(), k.cliPath!, k.root, k.meaning) : COMPANY_KNOWLEDGE_OFF;
  }

  /** The embedded OTLP collector's loopback URL, set by the main process once the
   *  collector is bound (telemetry.ts). null = telemetry off → no OTel env is
   *  injected at spawn (the transcript reconciler remains the cost source). */
  private _otelEndpoint: string | null = null;
  /** Mints the token an agent's exporter must send (TelemetryCollector.tokenFor). */
  private _otelToken: ((agentId: string) => string) | null = null;
  /** Point newly-spawned agents at the live telemetry collector. Call after the
   *  collector starts; only affects spawns made afterwards. */
  setOtelEndpoint(url: string | null, tokenFor: ((agentId: string) => string) | null = null): void {
    this._otelEndpoint = url;
    this._otelToken = url ? tokenFor : null;
  }
  /** The collector URL agents are pointed at, or null when telemetry is off. */
  otelEndpoint(): string | null {
    return this._otelEndpoint;
  }

  /** What the app running this hive actually IS: its version, and whether it is a
   *  packaged build or a local dev run.
   *
   *  Agents could not see this before, and it cost real time. A multi-agent
   *  investigation into anomalous file modes ran for hours before the explanation
   *  turned out to be that the operator had quit a downloaded build and started a
   *  local one, which inherits the launching shell's umask instead of Finder's
   *  022. No agent could observe that, several published conclusions had to be
   *  withdrawn, and log.jsonl carried no app-start marker to notice the switch
   *  from either. */
  private _runtime: { version: string; packaged: boolean; appPath?: string } | null = null;
  setRuntimeInfo(info: { version: string; packaged: boolean; appPath?: string } | null): void {
    this._runtime = info;
  }
  runtimeInfo(): { version: string; packaged: boolean; appPath?: string } | null {
    return this._runtime;
  }

  /** Whether config.orchestratorMaySpawn is on, mirrored here so the prompt
   *  builder can decide whether to tell god the spawn queue is available. Set at
   *  bootstrap and on every config write; hive.ts deliberately does not import
   *  the config module. */
  private _maySpawn = false;
  setOrchestratorMaySpawn(on: boolean): void {
    // Never on in a build without temporary workers, whatever config says.
    this._maySpawn = on && ALLOW_TEMP_WORKERS;
  }
  orchestratorMaySpawn(): boolean {
    return this._maySpawn;
  }

  // — paths —
  root(): string | null {
    const home = this.getHome();
    return home ? join(home, 'hive') : null;
  }
  enabled(): boolean {
    return this.root() !== null;
  }
  private agentDir(id: string): string {
    return join(this.root()!, 'agents', id);
  }
  /** IPC endpoint the cth-hook shim talks to (Phase 1 autonomy).
   *  On POSIX this is a Unix-domain socket file under the hive root. On Windows,
   *  Node's `net` IPC uses named pipes (a flat `\\.\pipe\` namespace, not the
   *  filesystem), so a raw file path fails to bind with EACCES — derive a stable,
   *  per-launch pipe name instead. The server listens on it and every agent is
   *  handed it in HIVE_SOCK at spawn, so they stay in sync.
   *
   *  The name is random for each app launch, never derived from the hive path
   *  (docs/designs/windows-11-installer.md, S1): pipe names are one namespace
   *  for every account on the PC, so a name anyone could work out lets another
   *  account create it first and read or answer the agents' hook calls. */
  sockPath(): string | null {
    const root = this.root();
    if (!root) return null;
    if (process.platform === 'win32') return this.pipeName;
    return join(root, 'hooks.sock');
  }
  private readonly pipeName = `\\\\.\\pipe\\dbm-hooks-${randomBytes(16).toString('hex')}`;
  private shimPath(): string | null {
    const root = this.root();
    return root ? join(root, 'bin', 'cth-hook.cjs') : null;
  }
  /** The proxy-bridge sidecar (qwen). Pure-Node loopback reverse-proxy that
   *  observes a hookless CLI's LLM traffic and synthesizes the same HIVE_SOCK
   *  payloads the hook shims emit. Written in ensureHive alongside cth-hook.cjs. */
  private proxyShimPath(): string | null {
    const root = this.root();
    return root ? join(root, 'bin', 'hive-proxy.cjs') : null;
  }

  /**
   * The BUNDLED-NODE launcher: `<root>/bin/hive-node` (POSIX) / `hive-node.cmd`
   * (Windows). Every `.cjs` shim in the hive is executed through it.
   *
   * Why it exists: hooks are run by the agent CLI through a plain
   * `/bin/sh -c` with a bare `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. A user whose
   * node comes from nvm (PATH set only by an interactive login shell) has NO node
   * there, so a hook written as `node "<shim>"` exits **127 — command not found**
   * and every payload is silently lost: no live status, no Stop→inbox drain, no
   * session ids. Electron's own binary IS a full Node runtime under
   * `ELECTRON_RUN_AS_NODE=1`, and it is guaranteed present (it is us).
   *
   * A wrapper SCRIPT rather than an inline `ELECTRON_RUN_AS_NODE=1 "<exe>" …`
   * prefix because that prefix is POSIX-sh syntax — it is a hard error under
   * cmd.exe, which is what runs hook commands on Windows. The wrapper also gives
   * agents a `$HIVE_NODE` they can invoke directly (running the Electron binary
   * WITHOUT the env var would launch a second app window, not a script).
   *
   * Checked on every bootstrap and rewritten when its text changed, so an app
   * update/move re-bakes execPath (see writeIfChanged for why not every time).
   */
  private nodeLauncherPath(): string | null {
    const root = this.root();
    if (!root) return null;
    return join(root, 'bin', process.platform === 'win32' ? 'hive-node.cmd' : 'hive-node');
  }

  /** Write `text` to `p` unless the file already says exactly that.
   *
   *  For the bundled-node shims (the launcher below and the PATH `node` in
   *  writeRuntimeShims). ensureHive runs on every task write and every spawn,
   *  not just at startup, and on Windows something holds a running `.cmd` open
   *  (cmd.exe, or a scanner) for as long as a hook runs through it, so rewriting
   *  the same bytes failed with EBUSY and logged an error on every board
   *  change (seen live, 2026-10-12). The text only changes when the app moves
   *  or updates, and that write still lands on the next bootstrap with no hook
   *  in flight. */
  private writeIfChanged(p: string, text: string): void {
    let current: string | null;
    try { current = readFileSync(p, 'utf8'); } catch { current = null; }
    if (current !== text) writeFileSync(p, text, 'utf8');
  }

  /** Write the launcher described above. Best-effort: on failure callers fall
   *  back to bare `node`, i.e. exactly the pre-fix behavior. */
  private writeNodeLauncher(): void {
    const p = this.nodeLauncherPath();
    if (!p) return;
    try {
      if (process.platform === 'win32') {
        this.writeIfChanged(p, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`);
      } else {
        this.writeIfChanged(p, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`);
        chmodSync(p, 0o755);
      }
    } catch (e) {
      console.error('[hive] writeNodeLauncher failed:', e);
    }
  }

  /** The launcher path if it is actually on disk, else null (→ callers fall back
   *  to bare `node`, i.e. exactly the pre-fix behavior — never worse than before). */
  private nodeLauncher(): string | null {
    const p = this.nodeLauncherPath();
    return p && existsSync(p) ? p : null;
  }

  /** The ABSOLUTE bundled-node command to BAKE into any text an agent is expected
   *  to run (`<launcher> <script> …`), falling back to bare `node`.
   *
   *  Exactly the value of the agent's `HIVE_NODE` env var — but agent-facing text
   *  must never spell it as `$HIVE_NODE`: that is POSIX shell syntax. A Windows
   *  agent runs its commands through cmd.exe/PowerShell, where `$HIVE_NODE`
   *  expands to NOTHING (cmd) or to an undefined variable (PowerShell), so every
   *  such instruction is dead on arrival there. The absolute path is correct on
   *  every platform and needs no expansion at all. */
  nodeCommand(): string {
    return this.nodeLauncher() ?? 'node';
  }

  /**
   * `<root>/bin/runtime` — the same bundled-node trick as `hive-node`, but the
   * wrapper is NAMED `node`, so anything that resolves `node` off PATH finds one.
   *
   * `hive-node` only covers commands WE generate. It does nothing for node that
   * the agent's own work needs at runtime: an MCP server declared as
   * `node ./server.js`, a provider CLI that shells out to node, a `.cjs` helper an
   * agent wrote itself. On a machine with no system node those all die with 127
   * exactly like the hooks did.
   *
   * This dir is APPENDED to the agent's PATH (see pty.spawn), never prepended: a
   * user who has their own node keeps their own version — we are strictly the
   * fallback. Prepending would silently swap every agent's node for Electron's
   * (20.18.1 as of Electron 32.3.3) underneath the user's own projects.
   *
   * NOTE: `node` only — deliberately no `npm`/`npx`. Electron bundles the Node
   * RUNTIME, not the npm CLI (which is ~12MB of JS we do not ship), so an `npm`
   * wrapper here could only be a stub that fails confusingly. A missing `npm` is
   * the honest signal; the install ladder (main/cliInstall.ts) detects it and
   * installs a REAL system Node — which brings npm with it. This shim is only the
   * last resort for when that install could not run (offline, or a platform with
   * no official installer).
   */
  runtimeBinDir(): string | null {
    const root = this.root();
    return root ? join(root, 'bin', 'runtime') : null;
  }

  /** Write the `node` shim described above. Best-effort: on failure the dir is
   *  simply absent from PATH and behavior is exactly as before. */
  private writeRuntimeShims(): void {
    const dir = this.runtimeBinDir();
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      if (process.platform === 'win32') {
        this.writeIfChanged(join(dir, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`);
      } else {
        const p = join(dir, 'node');
        this.writeIfChanged(p, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`);
        chmodSync(p, 0o755);
      }
    } catch (e) {
      console.error('[hive] writeRuntimeShims failed:', e);
    }
  }

  /** Build a hook command string that runs `script` under the guaranteed node,
   *  DOUBLE-QUOTED (safe for paths with spaces). */
  private nodeRun(script: string, ...args: string[]): string {
    const launcher = this.nodeLauncher();
    return [launcher ? `"${launcher}"` : 'node', `"${script}"`, ...args].join(' ');
  }

  /** Same, but UNQUOTED — only for configs or platforms that cannot preserve
   *  embedded quotes. POSIX JSON hook configs must use nodeRun() because the
   *  user-selected hive path may legitimately contain spaces. */
  private nodeRunUnquoted(script: string, ...args: string[]): string {
    return [this.nodeLauncher() ?? 'node', script, ...args].join(' ');
  }

  /** The Codex hook command on Windows: the bare name of a `.cmd` written into
   *  `runtimeBinDir()`, which every agent's PATH ends with
   *  (pty.ts withHiveRuntimeFallback). The paths, quoted, live inside the
   *  `.cmd`, so the command itself has no space and no quote.
   *
   *  Codex runs a hook as `cmd.exe /C` plus the command. With a space in the
   *  hive path (the default ~/HarnessAgents under a Windows user name like
   *  "Jane Smith"), the unquoted command splits at the space and every hook
   *  fails. Quoting it does not help on every Codex: codex-cli 0.162.1 passes
   *  the command as an escaped argument, so cmd.exe reads its inner quotes as
   *  `\"` and fails the same way. A bare name runs under both shapes.
   *  Null when the file cannot be written: the caller keeps the old command. */
  private codexHookWindows(shim: string): string | null {
    const dir = this.runtimeBinDir();
    if (!dir) return null;
    try {
      mkdirSync(dir, { recursive: true });
      this.writeIfChanged(join(dir, 'hive-codex-hook.cmd'),
        `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${shim}" %*\r\n`);
      return 'hive-codex-hook';
    } catch (e) {
      console.error('[hive] codexHookWindows failed:', e);
      return null;
    }
  }

  /** One proxy sidecar per live proxy-tier agent, keyed by agentId. Spawned in
   *  ensureAgent, killed on PTY exit / removeAgent / app quit (index.ts) — so a
   *  dead agent never leaks an orphan loopback listener. */
  private proxyChildren = new Map<string, ChildProcess>();

  // — bootstrap —

  /** Create the hive skeleton + git repo if missing. Idempotent. */
  ensureHive(): void {
    const root = this.root();
    if (!root) return;
    mkdirSync(join(root, 'agents'), { recursive: true });
    // #63: owner dock mail and state leave agents/human so no agent can write
    // them as owner text. Idempotent; a fresh office has nothing to move.
    this.migrateOwnerPrivate();

    // Refreshed each bootstrap, like COMMANDS.md just below. It used to be
    // written only when absent, which meant a hive created once never saw a
    // protocol change again: this repo's own hive still carried the file from
    // the day it was initialised, so every protocol addition since had reached
    // new hives only. The file is generated, not user-authored, and agents are
    // pointed at it as the authority, so a stale copy is worse than a rewrite.
    writeFileSync(join(root, 'PROTOCOL.md'), this.businessOffice ? PROTOCOL_BUSINESS_MD : PROTOCOL_MD, 'utf8');

    const registry = join(root, 'registry.json');
    if (!existsSync(registry)) {
      this.writeJson(registry, { godId: null, agents: {} } as Registry);
    }
    const userCodexHome = join(homedir(), '.codex');
    for (const [id, agent] of Object.entries(this.registry().agents)) {
      const codexHome = join(root, 'agents', id, '.codex');
      if (agent.provider === 'codex' && existsSync(codexHome)) {
        this.exposeCodexDataDirs(codexHome, userCodexHome, id);
      }
    }
    const board = join(root, 'board.md');
    if (!existsSync(board)) {
      writeFileSync(board, '# Hive board\n\n_Shared plans live here. The god agent is the scribe._\n', 'utf8');
    }
    const tasks = join(root, 'tasks.json');
    if (!existsSync(tasks)) this.writeJson(tasks, { tasks: [] });
    const log = join(root, 'log.jsonl');
    if (!existsSync(log)) writeFileSync(log, '', 'utf8');

    // The Claude Code command reference Michael consults (refreshed each bootstrap
    // so it tracks the bundled list).
    if (!this.businessOffice) writeFileSync(join(root, 'COMMANDS.md'), COMMANDS_MD, 'utf8');

    // Keep the churny/ephemeral live files out of the hive git repo.
    const gitignore = join(root, '.gitignore');
    // `crashes/` holds raw PTY output from abnormal agent exits. It is
    // DELIBERATELY ignored: that output is whatever the provider printed, which
    // can include tokens, paths and prompt fragments, and the hive repo is
    // committed on every change — a secret written there would be permanent.
    // log.jsonl gets the structured, non-sensitive fields; the dump stays local.
    // agents/human/ holds the owner's own messages to Michael and the dock's
    // state (michael-replies.md): private to the owner, never committed.
    // Research's folder stays out of the hive's history, which every agent
    // can read with git: its notes are web text the trust layer has not
    // cleaned (owner, 2026-10-13: its folders are its alone).
    const want = ['fleet.json', 'hooks.sock', 'cost-ledger.jsonl', 'crashes/', '.DS_Store', 'agents/human/', `agents/${RESEARCH_ID}/`];
    let lines: string[] = [];
    if (existsSync(gitignore)) { try { lines = readFileSync(gitignore, 'utf8').split('\n'); } catch { lines = []; } }
    const missing = want.filter((w) => !lines.includes(w));
    if (missing.length) writeFileSync(gitignore, [...lines.filter(Boolean), ...missing].join('\n') + '\n', 'utf8');

    // The hook shim: a dumb pipe between a `claude` hook and our UDS. Refreshed
    // on every bootstrap so it tracks code changes.
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(this.shimPath()!, HOOK_SHIM, 'utf8');
    // The proxy-bridge sidecar for hookless CLIs (qwen). Same refresh policy.
    writeFileSync(this.proxyShimPath()!, PROXY_BRIDGE_SHIM, 'utf8');
    // The bundled-node launcher every shim above is invoked through — MUST be
    // written before any hook installer runs (they probe for it).
    this.writeNodeLauncher();
    // …and the PATH-visible `node` fallback for the agent's OWN subprocesses.
    this.writeRuntimeShims();

    if (!existsSync(join(root, '.git'))) {
      this.git(['init', '-q'], root);
      this.commit('hive: init');
    }
  }

  /** Validate an agent's cwd the way a spawn does — it must be an ABSOLUTE path
   *  that exists as a directory. Surfaced as `cwdValid` on the registry entry so
   *  the roster reliably exposes whether a worker's working directory is usable.
   *  Best-effort; never throws (a stat error degrades to invalid). */
  private cwdValidity(cwd: string | undefined): { valid: boolean; issue: string | null } {
    if (!cwd || typeof cwd !== 'string') return { valid: false, issue: 'missing' };
    // Defense-in-depth: a `~/…` cwd from an older registry entry (written before
    // ingestion-time expansion) would read as 'not-absolute' forever. Expand first
    // so the roster reports the truth about the directory the spawn would use.
    cwd = expandTilde(cwd);
    if (!isAbsolute(cwd)) return { valid: false, issue: 'not-absolute' };
    try {
      return statSync(cwd).isDirectory()
        ? { valid: true, issue: null }
        : { valid: false, issue: 'not-a-directory' };
    } catch {
      return { valid: false, issue: 'missing-dir' };
    }
  }

  /**
   * Ensure an agent's workspace + registry entry, returning the spawn injection
   * (provider-specific args + env) that makes the process hive-aware.
   */
  async ensureAgent(
    meta: AgentMeta,
    opts: {
      knowledgeGraph?: boolean;
      /** ABSOLUTE path to the Knowledge-Graph CLI (`knowledge.env().KG_CLI`), baked
       *  into the agent's prompt instead of a `$KG_CLI` shell reference — `$VAR` is
       *  POSIX-only and expands to nothing under cmd.exe/PowerShell, so the KG
       *  instructions were unusable on Windows. Optional: undefined degrades to the
       *  old env-var spelling. */
      kgCliPath?: string;
      /** The company knowledge store's folder, written into the search command
       *  so it works without KG_ROOT in the agent's environment. */
      kgRoot?: string;
      /** MemPalace, when installed: company knowledge searched by meaning. */
      meaningSearch?: MeaningSearch;
      /** The business, for a business office's prompts (name, city, type, briefing). */
      business?: PromptBusiness;
      theme?: 'light' | 'dark';
      /** Consent state for the default-MCP bundle (W3). Threaded from the live
       *  HarnessConfig by the caller; undefined → catalog defaults apply. */
      mcpDefaults?: { [id: string]: { enabled: boolean } };
      /** App-resources `skills/` source dir (W3). The bundled read-only skills are
       *  copied into the agent's `.claude/skills/` per spawn; undefined or missing
       *  is a no-op (tolerated until Kevin populates the resource dir). */
      skillsDir?: string;
      /** Extra directories the agent's sandbox may write (e.g. the shared
       *  MemPalace dir, which `mempalace` mutates). Absolute paths; ignored
       *  for providers without a sandbox. */
      extraWritableDirs?: string[];
      /** Michael's folder, the business folder (Decision 44). When set, every
       *  agent is told where its own work belongs, who can open it, and that
       *  the hive is coordination only. */
      businessFolder?: string;
      /** Absolute path of the agent-facing `doc-text` CLI (F6). */
      docTextCliPath?: string;
      /** Which folders this agent may open and change (src/shared/folderAccess.ts). */
      folderPolicy?: AgentFolderPolicy;
      /** Its Claude connectors (shared/claudeConnectors.ts): start with none, or
       *  deny everything not given. Absent means none. */
      connectors?: SpawnConnectorPlan;
      /** Shell network (shared/webAccess.ts): an empty strict list for
       *  everyone, Michael included (D9.1), in every office (ship 2 D16); absent
       *  for Research. */
      network?: SandboxNetwork;
    } = {}
  ): Promise<SpawnInjection> {
    const root = this.root();
    if (!root) return { args: [], env: {} };
    this.ensureHive();
    this.knowledgeTold.set(meta.id, knowledgeSignature(!!opts.knowledgeGraph, opts.knowledgeGraph ? opts.meaningSearch : undefined));

    const dir = this.agentDir(meta.id);
    mkdirSync(join(dir, 'inbox', '.done'), { recursive: true });
    mkdirSync(join(dir, 'outbox', '.sent'), { recursive: true });

    // Resolve role BEFORE writing identity.md. A restart passes the floor
    // roster's `description`, which can be a status caption ("on standby").
    // identity.md and registry.role are the durable job from the hire.
    const reg = this.registry();
    const prev = reg.agents[meta.id];
    if (meta.cwd) meta = { ...meta, cwd: expandTilde(meta.cwd) };
    const role = preferredAgentRole(meta.role, prev?.role, !!meta.isGod);
    meta = { ...meta, role };

    // Research's folder is made safe first: nothing at its top is a link, a
    // pipe or a second name the app's writes below would go through (red
    // team, third ship).
    if (meta.id === RESEARCH_ID) this.makeResearchFolderSafe();
    const identity = join(dir, 'identity.md');
    this.atomicWriteText(identity, this.identityText(meta)); // refresh on each spawn

    // W3 — bundled read-only skills: refresh the agent's .claude/skills/ from the
    // app-resources skills/ dir on every spawn (same policy as identity.md), so an
    // agent always rides with the shipped safe skill set. Tolerant: a missing or
    // partial source dir is a no-op (Kevin populates the resource dir in lp-manifest).
    if (opts.skillsDir) this.copyBundledSkills(opts.skillsDir, join(dir, '.claude', 'skills'), meta.id === RESEARCH_ID);

    // The memory index (src/shared/memoryIndex.ts): only the app writes it; the
    // agent adds notes to memory/inbox.md, tidied in by memoryTidy.ts.
    const memory = join(dir, 'memory.md');
    if (!existsSync(memory)) this.atomicWriteText(memory, renderIndex(meta.name, meta.id, []));
    mkdirSync(join(dir, 'memory'), { recursive: true });
    ensureMineIgnore(dir); // keep settings.json / cursor / messages out of mempalace's index
    const cursor = join(dir, 'cursor.json');
    if (!existsSync(cursor)) this.writeJson(cursor, { lastProcessed: null });

    // upsert registry — spread the PRIOR entry first so a respawn preserves
    // fields the spawn `meta` doesn't carry, above all `sessionId`. Without this,
    // ensureAgent (which runs before the resume lookup in the pty:spawn handler)
    // would wipe the recorded session id, so `lastSession()` returns undefined and
    // `--resume` is never attached — i.e. every restart starts a fresh thread.
    // Validate the working directory at the source so a bad value is visible on
    // the roster (cwdValid) rather than silently spawning into a nonexistent dir.
    // Store the EXPANDED cwd, never the raw `~/…` the user typed — the registry is
    // read by hooks, the roster and the worker watcher, none of which run a shell.
    const cwd = this.cwdValidity(meta.cwd);
    reg.agents[meta.id] = {
      ...prev,
      ...meta,
      // Research is the owner's to name (ship 2 D17): the name set in the
      // app's settings, whatever a spawn or the registry says. A name another
      // member already has is skipped, so two never share one; the role is
      // the last resort.
      ...(meta.id === RESEARCH_ID ? {
        name: this.researchName()
      } : {}),
      capabilities: meta.capabilities ?? prev?.capabilities ?? [],
      role,
      status: 'idle',
      cwdValid: cwd.valid,
      // A (re)spawn always means a live terminal — clear any prior archived flag.
      archived: false,
      closedByOwner: false,
      lastSeen: Date.now()
    };
    if (meta.isGod) reg.godId = meta.id;
    this.atomicWriteJson(join(root, 'registry.json'), reg);

    this.appendLog({ kind: 'spawn', agentId: meta.id, name: meta.name, isGod: !!meta.isGod });
    // Only logs on an invalid cwd (rare) — not a per-spawn line, so no log spam.
    if (!cwd.valid) {
      this.appendLog({ kind: 'cwd_invalid', agentId: meta.id, cwd: meta.cwd, issue: cwd.issue });
    }
    this.commit(`hive: register ${meta.id}`);

    const env: Record<string, string> = {
      AGENT_ID: meta.id,
      AGENT_NAME: meta.name,
      HIVE_ROOT: root,
      AGENT_DIR: dir,
      // A fresh secret for this start (issue #61): every hook frame carries it,
      // and the hook server takes the sender from it, never from the frame.
      // Not named like a token or key: Research runs with Claude Code's
      // subprocess scrub, which strips such names from its hooks and status
      // line, and its every step was refused (2026-10-15).
      HIVE_HOOK_SEAL: this.mintHookToken(meta.id)
    };
    // The bundled-node launcher, so an agent can run the hive's .cjs helpers (KG
    // CLI, Slack reply helper) even when `node` is not on its PATH. Invoking the
    // Electron binary directly would open a second app window, so this must stay
    // the wrapper path and never process.execPath.
    //
    // Kept as an env var for agent CONVENIENCE and for anything that reads it
    // programmatically — but agent-facing TEXT no longer references it by name:
    // `$HIVE_NODE` is POSIX-only syntax and expands to nothing under cmd.exe /
    // PowerShell, so every such instruction was dead on a Windows floor. Commands
    // we write for an agent to run bake `nodeCommand()`'s absolute path instead.
    env.HIVE_NODE = this.nodeCommand();
    // Generic light/dark hint for TUIs that paint their own background. The app
    // defaults to light but every agent CLI assumed a dark terminal, so Crush and
    // OpenCode looked pasted into a light window. COLORFGBG is the classic
    // "fg;bg" convention (rxvt/konsole) that lipgloss/termenv fall back to when
    // an OSC 11 query gets no answer. Claude Code gets the same hint through its
    // per-session settings.json (hookSettings); Crush and OpenCode through their
    // per-agent config dirs below. A running TUI does not re-read this: new
    // agents pick up the current theme, running ones keep the one they started with.
    if (opts.theme) env.COLORFGBG = opts.theme === 'dark' ? '15;0' : '0;15';

    const claudeProvider = isClaudeProvider(meta.provider ?? 'claude');

    // Non-hive-aware providers (Antigravity's `agy`, OpenAI's `codex`, xAI's
    // `grok`) don't
    // understand Claude Code's flags (no `--append-system-prompt`, no telemetry,
    // no `--settings`). Instead: (1) the hive identity+protocol rides in as the
    // session's INITIAL prompt — the closest thing to `--append-system-prompt`
    // these CLIs offer (after the first turn the session continues normally); and
    // (2) lifecycle hooks are wired via the preset's `hookBridge` below. Together
    // that makes a Gemini/Codex worker a full hive citizen — live status +
    // Stop→inbox-drain — without Claude installed at all.
    //
    // How the prompt rides in differs by CLI:
    //  - agy takes it under a flag (`agy -i "<prompt>"`) → push [flag, prompt].
    //  - codex/grok take it POSITIONALLY (`codex|grok "<prompt>"`) → push the
    //    bare prompt as a trailing arg (node-pty passes argv literally, so it
    //    arrives as one positional argument after codex's own flags).
    if (!isHiveAwareProvider(meta.provider)) {
      const preset = providerPreset(meta.provider ?? 'claude');
      const flag = preset.initialPromptFlag;
      const prompt = this.injectedPrompt(meta, dir, root, opts.knowledgeGraph ?? false, opts.kgCliPath, opts.businessFolder, opts.docTextCliPath, opts.kgRoot, opts.meaningSearch, opts.business);
      // agy, codex, and grok expose a Claude-style lifecycle-hook surface, so each
      // gets the SAME live status + Stop→inbox-drain Claude does — selected by the
      // preset's `hookBridge`. agy needs a translating shim (its hook stdin/stdout
      // shape differs from Claude's); codex reuses the Claude `cth-hook` shim
      // verbatim (its hook payload + response contract are already Claude-shaped)
      // and is isolated to a per-agent CODEX_HOME so the user's global Codex
      // configuration is never mutated. Both share the HIVE_SOCK wiring below.
      const preArgs: string[] = [];
      let degraded: string | undefined;
      // Dispatch on the structured bridge descriptor (the foundation's `bridgeOf`
      // derives {kind:'hooks'} from the legacy `hookBridge` for agy/codex, and
      // returns the explicit {kind:'proxy'} for qwen). Two ways a hookless CLI
      // becomes a hive citizen:
      //   - 'hooks' → install a config-file hook shim (agy translator / codex verbatim).
      //   - 'proxy' → spawn a loopback reverse-proxy sidecar that observes the CLI's
      //               LLM traffic and SYNTHESIZES the same HIVE_SOCK payloads.
      const desc = bridgeOf(meta.provider);
      const sock = this.sockPath();
      if (desc && sock) {
        env.HIVE_SOCK = sock;
        try {
          if (desc.kind === 'hooks') {
            if (desc.shim === 'agy') this.installAgyHooks();
            else if (desc.shim === 'codex') {
              env.CODEX_HOME = this.installCodexHooks(dir, meta.id);
              if (opts.skillsDir) this.copyBundledSkills(opts.skillsDir, join(env.CODEX_HOME, 'skills'), false);
              // Codex refuses to run hooks from a config dir without persisted
              // "hook trust" (normally an interactive gate). Our hooks.json is
              // hive-authored inside an isolated CODEX_HOME, so we bypass that gate
              // for this automated spawn — the flag's documented use ("automation
              // that already vets hook sources"). Without it the hooks silently
              // never fire. Must precede the positional prompt.
              preArgs.push('--dangerously-bypass-hook-trust');
              // Auto mode keeps codex's OS sandbox (`-a never -s workspace-write`,
              // agentProvider.ts). workspace-write only covers cwd, so the agent
              // folder (inbox/.done, memory.md, outbox) and the shared hive root
              // (research deliverables, the board for god) are added as extra
              // writable roots. Harmless outside auto mode.
              for (const d of this.sandboxWritableDirs(meta, dir, root, opts.extraWritableDirs)) preArgs.push('--add-dir', d);
            }
            else if (desc.shim === 'pi') {
              // Pi (earendil-works) has a rich pi.on(event) lifecycle. We drop a
              // bundled extension into a PER-AGENT PI_CODING_AGENT_DIR (so the user's
              // global ~/.pi is never touched) that posts cth-hook-shaped payloads to
              // HIVE_SOCK on tool_call/agent_end and auto-approves tools when the floor
              // is in auto mode. HIVE_AUTO_APPROVE (set in spawnAgentCore from
              // config.autoMode) gates the auto-allow — Pam guardrail #5.
              // LIVE-UNVERIFIED: the exact extension API surface needs BYOK keys to
              // prove; the renderer idle inbox-wake nudge is the guaranteed drain.
              env.PI_CODING_AGENT_DIR = this.installPiHooks(dir);
            }
            else if (desc.shim === 'opencode') {
              // OpenCode (anomalyco/opencode) has no Claude-shaped Stop hook, but its
              // plugin API exposes a real session.idle event (god Decision 1). We drop
              // a bundled plugin into a PER-AGENT OPENCODE config dir that posts
              // HIVE_SOCK payloads on tool.execute.before/after + session.idle — the
              // same Stop→drain semantics, provider-agnostic, no traffic interception.
              // LIVE-UNVERIFIED (plugin auto-load + session.idle firing); the renderer
              // idle inbox-wake nudge is the guaranteed drain fallback.
              env.OPENCODE_CONFIG_DIR = this.installOpenCodePlugin(dir, opts.theme);
            }
            else if (desc.shim === 'gemini') {
              // Point only this worker at a per-agent system settings file so
              // the bridge is trusted and ~/.gemini/settings.json stays untouched.
              const writable = this.sandboxWritableDirs(meta, dir, root, opts.extraWritableDirs);
              env.GEMINI_CLI_TRUST_WORKSPACE = "true";
              env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = this.installGeminiHooks(dir, writable);
              // The agent folder and hive root join its workspace, the folders
              // codex gets with --add-dir above. On argv too: Gemini CLI 0.60
              // and later skip a system settings file in a folder the user owns.
              for (const d of writable) {
                const arg = geminiIncludeDirArg(meta.cwd, d);
                if (arg) preArgs.push('--include-directories', arg);
                else console.error(`[hive] ${meta.id}: a comma in ${d} keeps it off Gemini's --include-directories`);
              }
            }
            else if (desc.shim === 'grok') this.installGrokHooks();
          } else if (desc.kind === 'proxy') {
            // Stable per-spawn session id, stamped on every synthesized payload so
            // recordSession (registry resume key) and the cost ledger persist.
            const spawnTs = String(Date.now());
            const sessionId = `proxy-${meta.id}-${createHash('sha1').update(root + meta.id + spawnTs).digest('hex').slice(0, 12)}`;
            env.HIVE_PROXY_SESSION = sessionId;
            // The CLI normally reads its upstream base URL from `baseUrlEnv`; capture
            // the user's configured value as the sidecar's UPSTREAM, then point the
            // CLI at the loopback proxy instead. Fall back to the cloud default if
            // the user hasn't set one.
            const upstream = process.env[desc.baseUrlEnv]
              || (desc.api === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1');
            // A loopback bind on port 0 fails only transiently (a busy moment, a
            // slow sidecar start past the 4s ceiling), so try a few times before
            // giving up: without this ONE bad moment at spawn cost the agent its
            // hive events for the whole session.
            const port = await this.startProxyBridgeWithRetry(meta.id, { sock, sessionId, api: desc.api, upstream });
            // Only redirect the CLI through the proxy if the sidecar actually bound a
            // port. On failure leave routing untouched → the CLI talks to its real
            // upstream directly (degraded: no synthesized hive events, but it still
            // runs). Deliberate degradation is fine; SILENT degradation is not, so
            // the failure goes to log.jsonl, the renderer and the spawn result.
            if (port > 0) {
              const loopback = `http://127.0.0.1:${port}`;
              if (meta.provider === 'crush') {
                // Crush has NO base-URL env override, so the generic env-rewrite is a
                // no-op for it. Route it instead via a per-agent CRUSH_GLOBAL_CONFIG
                // whose chosen provider's base_url points at the loopback proxy
                // (installCrushConfig — sibling of installCodexHooks). `upstream`
                // (captured above from the inert sentinel env or cloud default) is the
                // proxy's real target. Per-agent CRUSH_GLOBAL_DATA isolates session
                // state from the user's global ~/.config/crush.
                const crush = this.installCrushConfig(dir, loopback, desc.api, opts.theme);
                env.CRUSH_GLOBAL_CONFIG = dir;
                env.CRUSH_GLOBAL_DATA = crush.data;
              } else {
                env[desc.baseUrlEnv] = loopback;
              }
            }
            else {
              degraded = `${meta.name} is running without hive events: its proxy bridge did not bind after ${PROXY_BIND_ATTEMPTS} attempts. Live status, cost and inbox wake will not work for this session. Respawn the agent to try again.`;
              console.error(`[hive] proxy bridge for ${meta.id} did not bind — spawning without hive events`);
              this.appendLog({ kind: 'proxy-degraded', agentId: meta.id, name: meta.name, provider: meta.provider, attempts: PROXY_BIND_ATTEMPTS });
              this.emit?.('hive:degraded', { agentId: meta.id, name: meta.name, reason: 'proxy-bind', message: degraded });
            }
          }
        } catch (e) { console.error(`[hive] install ${desc.kind} bridge failed:`, e); }
      }
      // Inject the protocol text whichever way the CLI accepts it.
      // type-into-tui (Crush): the bare TUI reads a positional as a Cobra subcommand
      // → `Unknown command`. So DROP the positional and hand the protocol back as
      // seedPrompt; the renderer types it into the TUI after boot (ondev-b).
      const deg = degraded ? { degraded } : {};
      if (preset.seedDelivery === 'type-into-tui') return { args: [...preArgs], env, seedPrompt: prompt, ...deg };
      // If a provider somehow exposes neither a flag nor a positional prompt, spawn bare.
      if (flag) return { args: [...preArgs, flag, prompt], env, ...deg };
      if (preset.positionalInitialPrompt) return { args: [...preArgs, prompt], env, ...deg };
      return { args: preArgs, env, ...deg };
    }

    // Stage 7A — first-party Claude Code telemetry → the embedded loopback OTLP
    // collector (telemetry.ts). Pure env, no --settings change. Only injected
    // for Claude Code once the collector is up (otelEndpoint set), so telemetry-
    // off installs and non-Claude providers spawn exactly as before.
    if (claudeProvider && this._otelEndpoint && this._otelToken) {
      env.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
      env.OTEL_METRICS_EXPORTER = 'otlp';
      env.OTEL_LOGS_EXPORTER = 'otlp';
      env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json';
      env.OTEL_EXPORTER_OTLP_ENDPOINT = this._otelEndpoint;
      // The collector counts a batch only for the agent this token belongs to.
      env.OTEL_EXPORTER_OTLP_HEADERS = `${TELEMETRY_TOKEN_HEADER}=${this._otelToken(meta.id)}`;
      env.OTEL_METRIC_EXPORT_INTERVAL = '5000'; // 5s — near-live without spamming
      env.OTEL_LOGS_EXPORT_INTERVAL = '2000';
      env.OTEL_RESOURCE_ATTRIBUTES = `agent.id=${meta.id},agent.name=${meta.name}`;
    }
    const args: string[] = [];
    if (!claudeProvider) return { args, env };

    args.push('--append-system-prompt', this.injectedPrompt(meta, dir, root, opts.knowledgeGraph ?? false, opts.kgCliPath, opts.businessFolder, opts.docTextCliPath, opts.kgRoot, opts.meaningSearch, opts.business));

    // Phase 1 — autonomy: attach lifecycle hooks via --settings (no edits to the
    // user's repo) so the agent reports activity and drains its inbox on Stop.
    const sock = this.sockPath();
    const shim = this.shimPath();
    // Claude connectors (docs/designs/claude-connectors.md): an agent that holds
    // none, or has no settings file to carry deny rules and the hook, starts
    // with no Claude account connector and none of the owner's own servers or
    // plugins; only the app's own --mcp-config servers (md-mail) remain. The
    // env reaches its child processes too.
    const settingsWritten = !!(sock && shim);
    const stripConnectors = !opts.connectors || opts.connectors.strip || !settingsWritten;
    if (sock && shim) {
      env.HIVE_SOCK = sock;
      // The shell Claude Code runs the hooks and status line in (hookShell.ts).
      // A Git Bash the app found is pinned, so Claude Code picks the same one.
      const shell = hookShell();
      if (shell.gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = shell.gitBash;
      // Outside the hive (issue 100): the shell sandbox lets an agent write
      // anywhere in the hive, and these settings set its sandbox at its next
      // start, so they live in the app's own folder, out of every agent's reach.
      // The copy an older build left in the agent folder is removed.
      const settingsPath = this.settingsPathFor(dir);
      rmSync(join(dir, 'settings.json'), { force: true });
      mkdirSync(dirname(settingsPath), { recursive: true });
      this.writeJson(settingsPath, this.hookSettings(shim, meta.cwd, opts.mcpDefaults, opts.theme, this.sandboxWritableDirs(meta, dir, root, opts.extraWritableDirs), opts.folderPolicy, stripConnectors ? [] : opts.connectors?.deny ?? [], shell.shell, opts.network, meta.isResearch ? this.researchShellWrite(dir, meta.cwd) : undefined));
      args.push('--settings', settingsPath);
      if (opts.folderPolicy?.walledMembers) this.walledAtStart.set(meta.id, opts.folderPolicy.walledMembers);
      else this.walledAtStart.delete(meta.id);
      // A `claude` the agent starts from its shell has no hook and no deny
      // rules, so it would load every connector on the account (TODOS, P1).
      // Claude Code sources CLAUDE_ENV_FILE before each shell command, so the
      // agent keeps its connectors and its shell children get none. Bash only;
      // a PowerShell agent (Windows without Git Bash) is not covered yet.
      if (shell.shell === 'bash') {
        const envFile = settingsPath.replace(/\.json$/, '.env.sh');
        writeFileSync(envFile, 'export ENABLE_CLAUDEAI_MCP_SERVERS=false\n');
        env.CLAUDE_ENV_FILE = envFile;
      }
    }
    if (stripConnectors) {
      env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
      args.push('--strict-mcp-config');
    }
    return { args, env };
  }

  /** Update the durable job string (hire role) without respawning. Refreshes
   *  registry.json + identity.md so the floor editor and the hive stay aligned. */
  patchAgentRole(id: string, role: string): { ok: boolean; error?: string } {
    const root = this.root();
    if (!root) return { ok: false, error: 'hive disabled' };
    const next = role.trim();
    if (!next) return { ok: false, error: 'empty role' };
    try {
      const reg = this.registry();
      const agent = reg.agents[id];
      if (!agent) return { ok: false, error: 'unknown agent' };
      if (agent.role === next) return { ok: true };
      agent.role = next;
      agent.lastSeen = Date.now();
      this.writeJson(join(root, 'registry.json'), reg);
      if (id === RESEARCH_ID) this.makeResearchFolderSafe();
      this.atomicWriteText(join(this.agentDir(id), 'identity.md'), this.identityText(agent));
      this.appendLog({ kind: 'role', agentId: id, role: next });
      this.commit(`hive: role ${id}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Flip an agent's archived flag and persist the registry. Closing a terminal
   * tab archives the agent (retained + flagged, NOT deleted); a (re)spawn clears
   * it. No-op if the agent isn't registered or the flag is already set the way
   * asked. Best-effort — never throws, so a dying PTY/kill handler can't crash.
   */
  setArchived(id: string, archived: boolean): void {
    const root = this.root();
    if (!root) return;
    try {
      const reg = this.registry();
      const agent = reg.agents[id];
      if (!agent || agent.archived === archived) return;
      agent.archived = archived;
      agent.lastSeen = Date.now();
      this.atomicWriteJson(join(root, 'registry.json'), reg);
      this.appendLog({ kind: 'archive', agentId: id, archived });
      this.commit(`hive: ${archived ? 'archive' : 'unarchive'} ${id}`);
    } catch { /* best-effort — never crash a lifecycle handler */ }
  }
  /** Mark (or clear) that the owner closed this agent. Best-effort, like setArchived. */
  setClosedByOwner(id: string, closed: boolean): void {
    const root = this.root();
    if (!root) return;
    try {
      const reg = this.registry();
      const agent = reg.agents[id];
      if (!agent || !!agent.closedByOwner === closed) return;
      agent.closedByOwner = closed;
      this.atomicWriteJson(join(root, 'registry.json'), reg);
      this.appendLog({ kind: 'closed-by-owner', agentId: id, closed });
    } catch { /* best-effort */ }
  }


  /**
   * Change an agent's display name without changing its durable identity.
   * The registry key, agent directory, session id, and every mailbox path remain
   * keyed by `id`; only the human-facing name is updated.
   *
   * `fleet.json` is patched in the same operation so god's next prompt receives
   * the new name immediately rather than waiting for the periodic fleet refresh.
   */
  /**
   * Put an agent on hold, or take it off, and tell Michael immediately.
   *
   * `fleet.json` is patched in the same operation for the same reason
   * `renameAgent` does it: god's roster is injected from that file on its next
   * prompt, and waiting up to 8s for the periodic refresh means one more
   * dispatch can still land on someone the human has just claimed.
   */
  setAgentHold(id: string, hold: boolean): { ok: boolean; onHold?: boolean; error?: string } {
    const root = this.root();
    if (!root) return { ok: false, error: 'hive disabled (no harnessHome)' };
    try {
      const reg = this.registry();
      const agent = reg.agents[id];
      if (!agent) return { ok: false, error: 'Agent not found' };
      if (!!agent.onHold === hold) return { ok: true, onHold: hold };

      agent.onHold = hold;
      this.writeJson(join(root, 'registry.json'), reg);

      const fleetPath = join(root, 'fleet.json');
      if (existsSync(fleetPath)) {
        try {
          const fleet = this.readJson<{ agents?: Array<{ id?: string; onHold?: boolean }> }>(fleetPath, {});
          if (Array.isArray(fleet.agents)) {
            const row = fleet.agents.find((candidate) => candidate.id === id);
            if (row) { row.onHold = hold; this.writeJson(fleetPath, fleet); }
          }
        } catch { /* fleet is a cache — the registry above is the record */ }
      }
      this.appendLog({ kind: 'agent-hold', id, onHold: hold });
      return { ok: true, onHold: hold };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  renameAgent(id: string, name: string): { ok: boolean; name?: string; error?: string } {
    const root = this.root();
    if (!root) return { ok: false, error: 'hive disabled (no harnessHome)' };

    const nextName = name.trim();
    if (!nextName) return { ok: false, error: 'Name is required' };

    try {
      const reg = this.registry();
      const agent = reg.agents[id];
      if (!agent) return { ok: false, error: 'Agent not found' };
      if (agent.name === nextName) return { ok: true, name: nextName };
      // Names are how Michael and the team address each other, so two agents
      // can't share one (owner, 2026-09-25).
      // Compared as the team reads them, lookalike letters included.
      const taken = Object.entries(reg.agents).some(([otherId, other]) =>
        otherId !== id && ((!!other?.name && nameKey(other.name) === nameKey(nextName)) || (id === RESEARCH_ID && nameKey(otherId) === nameKey(nextName))));
      if (taken) return { ok: false, error: `Another team member is already called ${nextName}. Pick a different name.` };
      // Research's name goes into every agent's house rules and onto its
      // answers: one short plain name, never a word messages are routed by.
      if (id === RESEARCH_ID && !cleanResearchName(nextName)) return { ok: false, error: 'Use a short name of letters, like Pete or Robin, that isn\'t a word the team sends messages by.' };
      if (isReservedName(nextName, id, reg.agents, this.researchName())) return { ok: false, error: `${this.researchName()} is the Research team member's name. Pick a different name.` };

      const previousName = agent.name;
      agent.name = nextName;
      this.researchNameMemo = null;
      this.writeJson(join(root, 'registry.json'), reg);

      // fleet.json is ephemeral and may not exist yet. When it does, keep its
      // display name in lockstep with the registry so rosterContext() is fresh.
      const fleetPath = join(root, 'fleet.json');
      if (existsSync(fleetPath)) {
        try {
          const fleet = this.readJson<{ agents?: Array<{ id?: string; name?: string }> }>(fleetPath, {});
          if (Array.isArray(fleet.agents)) {
            const row = fleet.agents.find((candidate) => candidate.id === id);
            if (row) {
              row.name = nextName;
              this.writeJson(fleetPath, fleet);
            }
          }
        } catch { /* periodic snapshot will repair a malformed/stale fleet file */ }
      }

      this.appendLog({ kind: 'rename', agentId: id, previousName, name: nextName });
      this.commit(`hive: rename ${id}`);
      return { ok: true, name: nextName };
    } catch {
      return { ok: false, error: 'Could not rename agent' };
    }
  }

  /**
   * Persist the agent's Claude Code session_id (Lane A #6.6a). Captured from hook
   * payloads; written only when it actually changes (a new session), so this is a
   * no-op on the vast majority of hook events. The id is the `--resume` key for
   * idempotent resume after a crash/restart AND the accounting/dedup key for cost
   * samples. Best-effort — never throws into a hook handler.
   */
  recordSession(agentId: string, sessionId: string): void {
    const root = this.root();
    if (!root || !sessionId) return;
    try {
      const reg = this.registry();
      const agent = reg.agents[agentId];
      if (!agent || agent.sessionId === sessionId) return; // unknown agent or unchanged → no write
      agent.sessionId = sessionId;
      agent.lastSeen = Date.now();
      this.atomicWriteJson(join(root, 'registry.json'), reg);
      this.appendLog({ kind: 'session', agentId, sessionId });
      this.commit(`hive: session ${agentId}`);
    } catch { /* best-effort — never crash a hook handler */ }
  }

  /** The last known session_id for an agent, or undefined. Used to build a
   *  `claude --resume <id>` spawn so a restarted agent resumes its thread. */
  lastSession(agentId: string): string | undefined {
    return this.registry().agents[agentId]?.sessionId;
  }

  /** A Codex agent's private CODEX_HOME (see installCodexHooks), where its
   *  rollout transcripts live; null for other engines or no hive. */
  codexHome(agentId: string): string | null {
    if (!this.root()) return null;
    const agent = this.registry().agents[agentId];
    if (agent?.provider !== 'codex') return null;
    return join(this.agentDir(agentId), '.codex');
  }

  /** Claude Code settings that route every relevant hook through the shim, plus
   *  (W3) the default MCP bundle merged into this PER-SESSION settings file. cwd
   *  scopes the filesystem/git servers; cfg (the consent map) gates which servers
   *  are written. Claude-only — this is invoked solely on the Claude spawn path. */
  /**
   * Directories a sandboxed agent may write BESIDES its cwd: its own agent
   * folder (hive housekeeping) and the hive root (research deliverables; the
   * board and tasks.json for god; outbox delivery is done by main, not the agent).
   * This is what lets auto mode keep the OS sandbox on — the old full-bypass
   * posture existed only because these paths sit outside the project cwd.
   */
  /** An agent's per-session Claude settings: in `<harnessHome>/agent-settings`,
   *  outside the hive and so outside every agent's writable sandbox (issue 100). */
  private settingsPathFor(dir: string): string {
    return join(dirname(this.root() ?? dirname(dir)), 'agent-settings', `${basename(dir)}.json`);
  }

  private sandboxWritableDirs(meta: AgentMeta, dir: string, root: string, extra?: string[]): string[] {
    // Research writes only its own folders: never the hive, the palace or
    // anything shared (eng review R1).
    if (meta.isResearch) return Array.from(new Set([dir, meta.cwd].filter((d) => typeof d === 'string' && d.length > 0)));
    const out = [dir, root, ...(extra ?? [])].filter((d) => typeof d === 'string' && d.length > 0);
    return Array.from(new Set(out));
  }

  /** Where Research's shell may write: its mail, its notes and its desk, never
   *  the top of its folder, so it can't put a link where the app writes or
   *  moves files (red team, third ship). Its file tools are held by the hook. */
  private researchShellWrite(dir: string, cwd: string | undefined): string[] {
    return [join(dir, 'inbox'), join(dir, 'outbox'), join(dir, 'memory'), ...(cwd ? [cwd] : [])];
  }

  private hookSettings(shim: string, cwd: string, cfg: McpDefaultsMap, theme?: 'light' | 'dark', writableDirs: string[] = [], folders?: AgentFolderPolicy, connectorDeny: string[] = [], shell: HookShell = 'bash', network?: SandboxNetwork, shellWrite?: string[]): unknown {
    // Bundled node, NOT bare `node` — see nodeLauncherPath(). Claude runs each of
    // these through a shell with a stripped PATH, where `node` is often absent.
    // On Windows that shell is PowerShell when there is no Git Bash, which can't
    // parse two quoted paths in a row, so the command is written for the shell
    // and the hook names it (hookShell.ts).
    const node = this.nodeCommand();
    const cmd = shellCommand(shell, node, shim);
    const entry = (matcher?: string) => ({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: cmd, ...(process.platform === 'win32' ? { shell } : {}) }]
    });
    const mcpServers = this.buildDefaultMcpServers(cwd, cfg);
    // #63 / TODOS: MCP servers from plugins are already blocked (--strict-mcp-config
    // / ENABLE_CLAUDEAI_MCP_SERVERS). Plugin skills, hooks and agent definitions
    // still load from the owner's ~/.claude; turn each enabled plugin off in this
    // session's settings only (never writes the owner's file).
    const disabledPlugins = this.ownerPluginsOffForSession();
    return {
      // Match the TUI's truecolor palette to the harness terminal theme —
      // PER SESSION, so the user's global Claude theme (their own terminals
      // outside the app) is never touched.
      //
      // 'auto', not the literal light/dark. Pinning the value matched the theme at
      // SPAWN and then ignored every change: Claude Code supports DEC 2031 theme
      // notifications, but a pinned theme has nothing to reconsider, so flipping
      // the app left a running agent painting its message blocks in the old
      // palette (black highlight on a cream terminal). 'auto' is the value that
      // listens. The terminal reports the current theme the moment the CLI enables
      // 2031, so startup still matches without pinning anything.
      ...(theme ? { theme: 'auto' } : {}),
      // The bypass consent the app keeps in the owner's settings, here too:
      // Research loads no settings file but this one (ship review pass 3).
      skipDangerousModePermissionPrompt: true,
      skipAutoPermissionPrompt: true,
      // W3 — default skills/MCP bundle. Written into the PER-SESSION settings file
      // only (never ~/.claude), so the user's own MCP servers are never clobbered;
      // Claude merges this additively. Omitted entirely when empty so a settings
      // file with no enabled servers is unchanged from before.
      ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      ...(Object.keys(disabledPlugins).length ? { enabledPlugins: disabledPlugins } : {}),
      // The status line gets the session status JSON after every response —
      // including context_window.{total_input_tokens,context_window_size},
      // the only clean programmatic source for the session's REAL context
      // window. The shim prints a compact in-terminal gauge and forwards the
      // payload to the harness (agent-card context gauge, exact limit).
      // No `shell` field here: Claude Code runs it in its default shell, which
      // the pinned Git Bash (or its absence) makes the same as `shell`.
      statusLine: { type: 'command', command: shellCommand(shell, node, shim, '--status'), padding: 0 },
      // After a plan usage limit, Claude Code waits in the session and continues
      // the task by itself at the reset (issue 124, the office break). On by
      // default; set here so the owner's own Claude settings can't turn it off
      // for the team. Read from --settings (user scope), never ~/.claude.
      autoContinueAtUsageLimit: true,
      // Native OS sandbox for Bash subprocesses (macOS Seatbelt / Linux bubblewrap).
      // Auto mode spawns with `--permission-mode bypassPermissions`, which only
      // silences PROMPTS; the sandbox is a separate, opt-in layer that was never
      // switched on. Verified live (claude 2.1.239): with this block, bypass mode
      // still writes cwd and the listed dirs but `touch $HOME/x` fails with
      // "Operation not permitted". Two layers are needed: `sandbox.filesystem`
      // governs Bash children, `permissions.additionalDirectories` governs the
      // Edit/Write tools; with only one the agent deadlocks on its own inbox.
      // failIfUnavailable stays false: a platform without a sandbox (Windows)
      // runs as before rather than refusing to spawn.
      //
      // Folder privacy (src/shared/folderAccess.ts) rides the same two layers:
      // denyRead/denyWrite (with allowRead re-opening an agent's own folder and
      // the Office inside Michael's) hold shell commands, and permission deny
      // rules hold the file tools. Deny rules apply in auto mode too.
      //
      // Not on Windows: Claude Code has no sandbox there, so "sandboxed only"
      // refused every shell command ("Shell command execution is blocked by
      // policy") and team members could not clear their inbox or read files.
      // There the deny rules still hold the file tools (owner, 2026-10-09).
      ...(writableDirs.length
        ? {
            sandbox: {
              enabled: true,
              // A member without the internet is held to the sandbox even
              // without a business folder, or a rerun outside it would reach
              // the internet (issue #230). Not on Windows: no sandbox there (#187).
              ...((folders?.sandboxOnly || network) && process.platform !== 'win32' ? { allowUnsandboxedCommands: false } : {}),
              // No host for the shell of anyone but Research. strictAllowlist
              // makes the empty list a rule, not a prompt saver, in auto mode.
              ...(network && process.platform !== 'win32' ? { network } : {}),
              filesystem: {
                allowWrite: shellWrite ?? writableDirs,
                // The hook program runs outside the sandbox on every tool call,
                // so no agent's shell may rewrite its folder (issue 100).
                denyWrite: Array.from(new Set([dirname(shim), ...(folders?.sandbox.denyWrite ?? [])])),
                ...(folders?.sandbox.denyRead.length ? { denyRead: folders.sandbox.denyRead } : {}),
                ...(folders?.sandbox.allowRead.length ? { allowRead: folders.sandbox.allowRead } : {})
              }
            },
            permissions: {
              // Claude Code lets the shell write in every additional
              // directory too, so Research's are only what its shell may
              // write (verified live, third ship QA).
              additionalDirectories: shellWrite ?? writableDirs,
              // Research loads none of the owner's settings (--setting-sources ''),
              // and Claude Code (2.1.300) turns bypass mode into default for a
              // session whose bypass consent is not in the user's own settings.
              // Pete then stopped on a permission prompt for every shell command
              // (owner, 2026-10-15). Its tools are allowed here instead; the deny
              // rules, the sandbox and the app's own hook still hold them.
              ...(shellWrite ? { allow: [...RESEARCH_ALLOWED_TOOLS] } : {}),
              ...(folders?.deny.length || connectorDeny.length ? { deny: [...(folders?.deny ?? []), ...connectorDeny] } : {})
            }
          }
        : connectorDeny.length ? { permissions: { deny: connectorDeny } } : {}),
      hooks: {
        Stop: [entry()],
        SubagentStop: [entry()],
        PreToolUse: [entry('*')],
        PostToolUse: [entry('*')],
        // A call that failed: the floor ends it by its id, like a finished one.
        PostToolUseFailure: [entry('*')],
        // A finished batch names every call in it, the ones the engine refused
        // on its own too (a deny rule, a declined prompt), which send nothing else.
        PostToolBatch: [entry()],
        UserPromptSubmit: [entry()],
        Notification: [entry()],
        SessionStart: [entry()],
        // #5C: surface mid-`/compact` so an agent boxing up its context reads as
        // 'compacting' on the floor instead of looking frozen.
        PreCompact: [entry()],
        PostCompact: [entry()],
        // A turn cut off by the usage limit, no credit or a sign in that no
        // longer works stops the office (issue 124, office-stopped-account.md).
        StopFailure: [entry(STOP_FAILURE_MATCHER)]
      }
    };
  }

  /** Owner plugins to turn off for one agent session (#63). Reads ~/.claude only. */
  private ownerPluginsOffForSession(): Record<string, false> {
    const out: Record<string, false> = {};
    for (const p of [
      join(homedir(), '.claude', 'settings.json'),
      join(homedir(), '.claude', 'settings.local.json')
    ]) {
      try {
        if (!existsSync(p)) continue;
        const raw = JSON.parse(readFileSync(p, 'utf8')) as { enabledPlugins?: unknown };
        Object.assign(out, pluginsDisabledForSession(raw.enabledPlugins));
      } catch { /* leave owner's file alone on a bad parse */ }
    }
    return out;
  }

  /**
   * W3 — build the per-agent `mcpServers` map from the default catalog. Includes a
   * server only when it's enabled (catalog ∩ consent), scopes filesystem/git to the
   * agent cwd (never whole-disk), and namespaces every id `munder-<id>` so a server
   * of the same name in the user's own ~/.claude is never clobbered. A write/secret
   * server is included ONLY on an explicit `enabled:true` consent — never via a
   * default — so a malformed/partial config can't silently arm a keyed server.
   */
  private buildDefaultMcpServers(
    cwd: string,
    cfg: McpDefaultsMap
  ): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
    const out: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
    for (const e of MCP_CATALOG) {
      const consented = cfg?.[e.id]?.enabled;
      const enabled = consented ?? e.defaultEnabled;
      if (!enabled) continue;
      // Defense-in-depth: a write/secret server requires an EXPLICIT opt-in; it can
      // never ride in on a default (the catalog already ships these OFF, but this
      // guards a hand-edited/partial mcpDefaults map too).
      if (e.tier !== 'safe-readonly' && consented !== true) continue;
      // Replace the `<cwd>` placeholder (filesystem/git) with the agent cwd at merge
      // time so these stay strictly workspace-scoped.
      const args = e.spec.args.map((a) => (a === '<cwd>' ? cwd : a));
      out[`munder-${e.id}`] = {
        command: e.spec.command,
        args,
        ...(e.spec.env ? { env: e.spec.env } : {})
      };
    }
    return out;
  }

  /**
   * W3 — refresh an agent's bundled skills from the app-resources `skills/` dir.
   * Mirrors `identity.md`: overwritten every spawn so the shipped safe set tracks
   * the app. Best-effort and fully tolerant — a missing/empty source dir is a no-op
   * (Kevin populates the resource dir in lp-manifest), and any IO error is swallowed
   * so skill provisioning can never block a spawn.
   * The web skills go to Research alone, the one agent that uses the internet
   * (owner, ship 2 D13); a copy an earlier version gave anyone else is removed.
   */
  private copyBundledSkills(srcDir: string, destDir: string, isResearch: boolean): void {
    try {
      if (!isResearch) for (const web of RESEARCH_ONLY_SKILLS) rmSync(join(destDir, web), { recursive: true, force: true });
      if (!existsSync(srcDir)) return;
      const copyTree = (from: string, to: string): void => {
        const entries = readdirSync(from, { withFileTypes: true });
        if (!entries.length) return;
        mkdirSync(to, { recursive: true });
        for (const ent of entries) {
          if (!isResearch && from === srcDir && RESEARCH_ONLY_SKILLS.includes(ent.name)) continue;
          const s = join(from, ent.name);
          const d = join(to, ent.name);
          if (ent.isDirectory()) copyTree(s, d);
          else if (ent.isFile()) copyFileSync(s, d);
        }
      };
      copyTree(srcDir, destDir);
    } catch (e) { console.error('[hive] copyBundledSkills failed:', e); }
  }

  /**
   * W1 — start a proxy-bridge sidecar for a hookless proxy-tier agent (qwen).
   * Spawns `<root>/bin/hive-proxy.cjs` under Node, which binds a loopback port and
   * reports it back as a one-line `{"port":N}` on stdout. Resolves the bound port
   * (or 0 on failure, so the caller degrades gracefully without redirecting the
   * CLI). Idempotent: any prior sidecar for the agent is killed first, so a respawn
   * never leaks a listener. Tracked in `proxyChildren` for teardown.
   */
  /** startProxyBridge with a short retry ladder. Every attempt kills the previous
   *  sidecar first (startProxyBridge is idempotent), so a retry never leaks a
   *  listener. Resolves the bound port, or 0 once every attempt has failed. */
  private async startProxyBridgeWithRetry(
    agentId: string,
    cfg: { sock: string; sessionId: string; api: 'openai' | 'anthropic'; upstream: string }
  ): Promise<number> {
    for (let attempt = 1; attempt <= PROXY_BIND_ATTEMPTS; attempt++) {
      const port = await this.startProxyBridge(agentId, cfg);
      if (port > 0) return port;
      if (attempt < PROXY_BIND_ATTEMPTS) {
        console.warn(`[hive] proxy bridge for ${agentId} did not bind (attempt ${attempt}/${PROXY_BIND_ATTEMPTS}), retrying`);
        await new Promise((r) => setTimeout(r, PROXY_BIND_BACKOFF_MS[attempt - 1] ?? 1000));
      }
    }
    return 0;
  }

  private startProxyBridge(
    agentId: string,
    cfg: { sock: string; sessionId: string; api: 'openai' | 'anthropic'; upstream: string }
  ): Promise<number> {
    this.stopProxyBridge(agentId);
    const script = this.proxyShimPath();
    if (!script) return Promise.resolve(0);
    return new Promise<number>((resolve) => {
      let settled = false;
      const settle = (port: number): void => { if (!settled) { settled = true; resolve(port); } };
      let child: ChildProcess;
      try {
        child = spawn(process.execPath, [script], {
          env: {
            ...process.env,
            // Run the .cjs under Electron's bundled Node, not as a second app window.
            ELECTRON_RUN_AS_NODE: '1',
            HIVE_SOCK: cfg.sock,
            AGENT_ID: agentId,
            HIVE_HOOK_SEAL: this.hookTokens.get(agentId) ?? '',
            UPSTREAM_BASE_URL: cfg.upstream,
            HIVE_PROXY_SESSION: cfg.sessionId,
            HIVE_PROXY_API: cfg.api
          },
          // Read the port line from stdout; never inherit stdio (the sidecar must
          // never write into the agent's terminal or leak request bodies to a log).
          stdio: ['ignore', 'pipe', 'ignore']
        });
      } catch (e) {
        console.error(`[hive] startProxyBridge spawn failed for ${agentId}:`, e);
        return settle(0);
      }
      this.proxyChildren.set(agentId, child);
      let buf = '';
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (d: string) => {
        if (settled) return;
        buf += d;
        const nl = buf.indexOf('\n');
        if (nl === -1) return;
        try {
          const msg = JSON.parse(buf.slice(0, nl));
          if (typeof msg.port === 'number' && msg.port > 0) settle(msg.port);
          else settle(0);
        } catch { settle(0); }
      });
      child.on('error', () => settle(0));
      child.on('exit', () => {
        if (this.proxyChildren.get(agentId) === child) this.proxyChildren.delete(agentId);
        settle(0); // never hang the spawn if the sidecar dies before reporting
      });
      // Hard ceiling: if the sidecar never reports a port, degrade rather than hang.
      setTimeout(() => settle(0), 4000).unref?.();
    });
  }

  /** Kill the proxy sidecar for an agent, if any. Idempotent; never throws. */
  stopProxyBridge(agentId: string): void {
    const child = this.proxyChildren.get(agentId);
    if (!child) return;
    this.proxyChildren.delete(agentId);
    try { child.kill(); } catch { /* already gone */ }
  }

  /** Kill every live proxy sidecar (app quit). Best-effort. */
  stopAllProxyBridges(): void {
    for (const id of [...this.proxyChildren.keys()]) this.stopProxyBridge(id);
  }

  /**
   * Drain an agent's inbox for the Stop hook. Returns whether to block-to-continue
   * and the message text to feed back. Uses the per-agent cursor so a message is
   * surfaced exactly once (no infinite loop).
   */
  drainForStop(agentId: string): { block: boolean; reason?: string } {
    if (!this.root()) return { block: false };
    const dir = this.agentDir(agentId);
    if (!existsSync(dir)) return { block: false };
    const cursorPath = join(dir, 'cursor.json');
    const cursor = this.readJson<{ lastProcessed: string | null }>(cursorPath, { lastProcessed: null });
    const fresh = this.inbox(agentId)
      .filter((m) => !cursor.lastProcessed || m.id > cursor.lastProcessed)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (fresh.length === 0) return { block: false };

    cursor.lastProcessed = fresh[fresh.length - 1].id;
    this.atomicWriteJson(cursorPath, cursor);
    this.appendLog({ kind: 'drain', agentId, count: fresh.length });

    const lines = fresh.map((m) => `- [from ${m.from}, ${m.act}] ${m.subject}: ${m.body}`).join('\n');
    const reason = [
      `You have ${fresh.length} new hive message(s) in your inbox. Address them before finishing:`,
      lines,
      // Native separators (join, not string-concatenated `/`) so a Windows agent is
      // handed a path its own shell/tools accept, not `C:\…\agents\god/inbox/`.
      `Open the files in ${join(dir, 'inbox')} for full detail, act on each, then move handled ones to ${join(dir, 'inbox', '.done')}. Reply via your outbox if a message requires it.`
    ].join('\n');
    return { block: true, reason };
  }

  // — agent-facing text —

  private identityText(meta: AgentMeta): string {
    const caps = (meta.capabilities ?? []).join(', ') || '—';
    return [
      `# ${meta.name} (${meta.id})`,
      '',
      `- Role: ${meta.role ?? (meta.isGod ? 'office manager' : 'agent')}`,
      `- Capabilities: ${caps}`,
      `- Working directory: ${meta.cwd}`,
      meta.isGod ? '- You are the **god / orchestrator**. You run the floor — keep awareness of the whole team, delegate execution, and personally own only the important calls (decomposition, sign-offs, conflicts, integration), not the grunt work.' : '',
      meta.isGod ? '- Monitor the team with `fleet.json` (live per-agent status/tokens/cost/breaker) and `registry.json`; full command reference in `COMMANDS.md`. `claude agents` does NOT list your hive siblings.' : '',
      ''
    ].filter(Boolean).join('\n');
  }

  /**
   * The system-prompt prefix injected into every spawn via --append-system-prompt.
   *
   * 🔒 PROMPT-CACHE INVARIANT — keep this prefix VOLATILE-FREE. It interpolates
   * only values stable for an agent's whole lifetime (name, id, dir, root,
   * the knowledge settings). Do NOT add dates, UUIDs, counters, board/registry state, or
   * any `Date.now()`-derived text here: a prefix that changes per spawn defeats
   * Anthropic's prompt cache (re-priming the whole system prompt every turn).
   * Volatile context belongs on the live channels — the inbox (hive messages) and
   * the PTY — never baked into this prefix. (Lane A #6.1.)
   *
   * 🪟 NO SHELL SYNTAX. Every path and command here is written the way the AGENT
   * will actually type it, on the platform it is running on. That rules out two
   * habits that were silently Windows-only breakage:
   *  - `$VAR` — POSIX-only. Under cmd.exe `$HIVE_NODE`/`$KG_CLI` expand to nothing
   *    and under PowerShell to an undefined variable, so those instructions were
   *    dead on every Windows floor. Bake the ABSOLUTE resolved path instead: it is
   *    platform-independent, needs no expansion, and stays prompt-cache-stable.
   *  - `'…' + '/inbox/'` — string-concatenating separators told a Windows agent to
   *    read `C:\Users\x\hive\agents\god/inbox/`. Use join() so the agent's own
   *    tooling gets a path it can pass straight to its shell.
   */
  private injectedPrompt(
    meta: AgentMeta,
    dir: string,
    root: string,
    knowledgeGraph: boolean,
    kgCliPath?: string,
    businessFolder?: string,
    docTextCliPath?: string,
    kgRoot?: string,
    meaningSearch?: MeaningSearch,
    business?: PromptBusiness
  ): string {
    // Native-separator path helpers — see the 🪟 note above.
    const inDir = (...parts: string[]): string => join(dir, ...parts);
    const inRoot = (...parts: string[]): string => join(root, ...parts);
    // Resolved ONCE here, at THIS agent's own spawn — same prompt-cache-stable
    // shape as name/id/dir/root above it, not a live re-read on every turn.
    // Needed where another agent's prompt refers to god by name in prose: the
    // PREP ASSISTANT persona and a team member's folder line. God's own prompt
    // already gets its name via `meta.name`.
    const godRegistry = meta.isGod ? null : this.registry();
    const godNameForPrompt = godRegistry
      ? resolveGodName(godRegistry.agents[godRegistry.godId ?? 'god']?.name)
      : '';
    const ctxLine = 'LIVE CONTEXT: each agent row in the LIVE ROSTER carries a `ctx NN%` tag — its live context-window occupancy. Treat it as the real headroom signal when routing: prefer an agent with a LOW `ctx` for a big task; treat a HIGH `ctx` (near 100%) as busy rather than idle, even if the cumulative token count looks modest.';

    // Each member's memory is its own (owner, 2026-10-16): nobody, Michael
    // included, opens another's notes; they ask. Company knowledge is the one
    // store everyone searches (knowledgeLine).
    const memoryLine = meta.isGod
      ? 'PRIVATE MEMORY: each team member\'s notes, memory and inbox are its own. Never open a team member\'s hive folder (agents/<id>/), its notes or inbox, or the hive\'s change history (.git). To learn what one knows or how its work stands, send it a "query", and read its card on the board and the work it publishes; its work folder and the files it hands off stay yours to read.'
      : 'PRIVATE MEMORY: your notes and memory are yours alone, and each teammate\'s are theirs. Never open another team member\'s hive folder (agents/<id>/), its notes or inbox, or the hive\'s change history (.git). To learn what a teammate knows, ask them with a "query" message; files a teammate hands off are fine to read. The one store everyone searches is company knowledge.';
    // Company knowledge (on by default). Volatile-free: the bundled-node launcher
    // and the KG CLI are both fixed absolute paths for an install, so baking them
    // keeps the prefix prompt-cache-stable while making the command runnable in
    // cmd.exe/PowerShell as well as a POSIX shell.
    const hiveNode = this.nodeCommand();
    const kgCli = kgCliPath || (process.platform === 'win32' ? '%KG_CLI%' : '$KG_CLI');
    // Company knowledge (owner, 2026-09-25): the one place company wide
    // information, policies and rules are shared, searched by every agent.
    const knowledgeLine = knowledgeGraph ? companyKnowledgeLine(hiveNode, kgCli, kgRoot, meaningSearch) : '';
    // Item 13: state the build. Agents had no way to tell which version, or even
    // which KIND of build, they were running inside, so anything that varies
    // between a packaged app and a local dev run (umask being the one that bit
    // us) was invisible to every investigation.
    const rt = this.runtimeInfo();
    const runtimeLine = rt
      ? `RUNNING BUILD: ${APP_NAME} v${rt.version}, ${rt.packaged ? 'packaged app' : 'local dev build'}${rt.appPath ? `, from ${rt.appPath}` : ''}. Say this version if asked which one is running, and do not assume behaviour from an older one. A local dev build inherits the launching shell's environment (umask included) where a packaged app does not, so file modes and inherited env can legitimately differ between the two. \`log.jsonl\` records an \`app-start\` event on every launch, which is how you spot a restart or a build switch.`
      : '';
    // Item 11: god could not find the spawn queue. The mechanism has worked since
    // v0.4.4, but nothing told him it existed — the prompt said "spawn" without
    // saying how, COMMANDS.md and PROTOCOL.md did not mention it, and the only
    // description lived in a source comment. So he fell back to writing a hire
    // manifest, which needs a human to click confirm, and it looked like nothing
    // happened. Gated on the toggle: advertising a disabled path is worse than
    // saying nothing, and COMMANDS.md documents it either way for the case where
    // the operator turns it on after god was already running.
    const spawnQueueLine = meta.isGod && this.orchestratorMaySpawn()
      ? `SPAWNING A WORKER: you can start an ephemeral worker yourself by writing ONE JSON file into ${inRoot('spawn-requests')}/<id>.json. Required: \`objective\` (what the worker must do) and \`cwd\` (the repo it runs in). Optional: \`name\`, \`command\`, \`provider\`, \`model\`, \`isolate\` (default true = its own git worktree), \`tokenCap\`, and \`slack\` ({channel, thread_ts}) to route its failures back to a thread. The harness polls that directory, spawns \`worker-<id>\`, and moves the request to \`spawn-requests/.done/\` on success or \`.failed/\` with a reason. This is the ONLY way you can spawn; a hire manifest under research/hires/ needs the human to confirm it in the UI, so it is not a route you can complete on your own. Reuse an existing agent first, as above — a worker is a fresh spend every time.`
      : '';
    const godLine = meta.isGod
      ? 'You are the GOD / ORCHESTRATOR of this hive — your job is to ORCHESTRATE, not to implement: maintain live situational awareness and delegate the work. (1) AWARENESS — always know what is going on: keep an accurate picture of every agent (active vs archived/idle), the task board, and all in-flight work; drain your inbox continually and triage every other agent\'s requests, answering clarifications so the team runs autonomously. (2) DELEGATE — decompose work and fan it out to the hive agents via their inboxes (route messages and assign owners; do not do their jobs); do NOT take on grunt implementation yourself. Stay aware of who is already on the floor and delegate OPPORTUNISTICALLY: BEFORE you spawn anything, CHECK THE LIVE ROSTER (active agents in registry.json + their state in fleet.json) and prefer routing to an EXISTING agent that fits — above all when the request names one ("ask Pam to…", "have Jim…"), route to that agent instead of reflexively creating a new one. Reuse an idle or already-running agent whose role matches; only spawn a fresh agent when no existing one is a sensible fit, and say that you checked. One capable owner beats a duplicate. (3) OWN ONLY THE IMPORTANT, high-leverage things — task decomposition, dispatch decisions, sign-offs, conflict resolution, branch integration, and final QA — and remain the sole scribe of board.md and tasks.json (team members file what they need in the triage folder of the hive, which you work oldest first). You are otherwise fully autonomous — there is NO separate approval queue. For the genuinely critical (destructive actions, spending real money, scope changes, unresolvable conflicts), ask the human directly in your own session and let the tool-permission prompt gate the action; the human approves natively, including remotely from their phone via /remote-control. Keep the team unblocked. When you DISPATCH a task, write it as a 4-part contract so the agent can run autonomously: (1) OBJECTIVE — the concrete goal; (2) OUTPUT — the expected deliverable/format; (3) TOOLS — what to use or avoid, and any references to read instead of re-deriving; (4) BOUNDARIES — scope limits + the definition of done. Pass references (file paths, message ids, board sections), not pasted content — keep dispatches short.'
        + ` MONITOR the floor by reading ${inRoot('fleet.json')} (live per-agent tokens, cost, status, last tool, breaker level, inbox backlog) and ${inRoot('registry.json')} — note that running 'claude agents' will NOT list your hive's sibling agents. A full Claude Code command reference is at ${inRoot('COMMANDS.md')} (slash commands act ONLY on your own session; CLI commands run in your shell and can target the fleet). You periodically receive scheduler / "Heartbeat" standup requests. A scheduled run carries its job's focus for that run (what to cover at the hourly ops standup comes in its message); re-engage anyone stalled, over-budget, or breaker-armed, and keep board.md and tasks.json accurate. In tasks.json, ALWAYS set each task's "assignee" to the worker's agent id the moment you dispatch it, and NEVER clear it on status changes — a done card must still say who did the work (the human reads the board by who-did-what). Write no running "notes" on a card (house rule 8): its status, waitingOn, nextAt, ASK ME question and result say where it stands. HUMAN FEEDBACK is first-class in the ledger: when a task can only proceed with the human's input — a QUESTION to answer OR an ACTION only the human can perform (create an account, approve a purchase, provide credentials/screenshots, test on their device) — set its status to "blocked" and append the concrete ask to the card's "humanQA" array (push {"q":"...","askedAt":"<iso>","raisedBy":"<agent id>"}; raisedBy is the team member whose work needs the answer, or "god" when you raised it yourself, because the answer goes into their memory; phrase actions as clear to-dos; keep every past entry — the history documents the card's decisions). When the app tells you a team member is stuck, do what its note says: a member the app restarted needs no ask, and for one still stuck you move their work to a teammate and put one plain question on ASK ME, never mentioning terminals or a 1:1. BEFORE YOU ADD AN ASK, read the asks already open on the board (any humanQA entry with no "a" and no "dismissedAt"). An ask stays on ASK ME until the human answers it or you withdraw it, whatever the card's status, so keep one open ask per card: if the new ask changes, replaces or contradicts an open one, fold them into one ask on THAT card and withdraw the old one, and never add a different ask to a card that already has one open. To withdraw an ask, set "dismissedAt" (the time) and a short "dismissedReason" on its entry; never add a new entry to say an ask is no longer needed. Never move a card with an open ask out of "blocked", or close it, until the human has answered it or you have withdrawn it. If one answer settles several cards, ask it once and say on the others which card to answer. WRITE THE ASK SHORT AND IN MARKDOWN. The human reads it on a CARD, not in a terminal, so an ask longer than a short paragraph plus its options (roughly 700 characters) is a report, not a question — cut the narrative, keep the decision. Give the card a TITLE the owner can read at a glance: a few plain words naming the matter, under 60 characters (e.g. "Refund for Northwind Cafe"), with no ids, dates, mailbox names or bracketed notes; those go in the ask. Open with ONE **bold** sentence saying exactly what you need from them; put paths, commands, values and identifiers in \`backticks\`; write each link as a few words naming what opens, like [the company in HubSpot](https://...), never the bare address; when the ask is something the owner does on a website (signing in, accepting terms, paying), link straight to where they do it, with the link the team member or the email gave: only the sender's own site, never a tracking or shortened link; put choices in the ask's "options" and several questions in its "parts", never as a list in the text; leave a blank line between paragraphs (a single newline is a line break). When the ask originates in another agent's report, REWRITE it into that shape — never paste the report body in as the question, and never make the human read the investigation to find the decision. Put the background, what led to the question and why it matters, in a sentence or two in the card's "description", so the owner can read it under See full context. The harness surfaces open questions on the office floor's ASK ME board; the human's answer lands in the same entry ("a"), goes into the memory notes of whoever raised it, and arrives to you, and only you, as a REQUEST about that card (the owner talks only to you, so tell the team member yourself when you route it): route the follow-up (redelegate to the same agent or another, or ask the human again), then reply "done" with in_reply_to its id, so work continues; it stays open until you do. A card ends only as done: with a "result" when finished, or with "closedBy": "owner" and a "closedReason" when the owner decides to stop it; never delete a card. A card is "blocked" only while its question for the human is open on ASK ME; a card waiting on someone outside the office or on a teammate is "waiting", with "waitingOn" naming who in a few words (like "customer Gopi" or "Nick"), never the card\'s own person, and goes back to "doing" when they answer; a card whose one off next step is its own person\'s at a set time is "todo", with "nextAt" set to that time; scheduled routines get no card (house rule 8). "doing" means someone is working on it now. Do NOT park human questions in separate files (no HumanQuestion.md) and never sit waiting on the human in your own session. Steward the token budget.`
      : meta.isAssistant
      ? `You are ${godNameForPrompt}'s PREP ASSISTANT. You will be handed short, possibly vague instructions (each begins with "ENRICH TASK:"). For each one: (1) figure out which project it concerns and cd into the most relevant repo — you start in ${godNameForPrompt}'s home directory; (2) gather concrete context READ-ONLY (exact file paths, current state, relevant code, conventions, active branch, gotchas) — NEVER modify, create, or delete files; (3) rewrite the instruction into ONE clear, self-contained prompt that ${godNameForPrompt} can execute autonomously, preserving the user's original intent without inventing scope. Then deliver it: write ONE message JSON into your outbox with "to":"god", "act":"request", a short subject, and the finished prompt as the body. Do NOT perform the task yourself — your only output is the improved prompt sent to ${godNameForPrompt}.`
      : 'For anything ambiguous, cross-cutting, or needing sign-off, address a message to "god".';
    // WHERE WORK LIVES (Decisions 44, 48). Only on installs with a business folder:
    // an older install's Michael still runs inside the harness folder, and telling
    // him never to write there would contradict where he actually is. The paths
    // are stable for the agent's lifetime, so the prompt-cache invariant holds.
    const folderLine = businessFolder
      ? (meta.isGod
        ? `YOUR FOLDERS: you work in ${meta.cwd}, your folder. It is private: only you and the owner can open it. Each team member has a folder of their own, inside this one unless the owner put it elsewhere. You can read their files, but only they change them, so when something needs to go into a team member's folder, ask them.`
        : `YOUR FOLDERS: you work in ${meta.cwd}. The owner keeps the documents you need there, so read it for context first, and save everything you produce there: drafts, reports, spreadsheets. It is private: only you, anyone sharing this folder, and ${godNameForPrompt} can open it, and other team members' folders are private to them.`)
        + ` The hive (${root}) is only for coordination: your memory notes, inbox and outbox. Save documents, drafts and other work outside it. You can open PDFs and images directly.`
      : '';
    // A business office (one with a business folder) gets the rewritten
    // instructions (agent instructions audit, 2026-09-25): Michael's standing
    // instructions or the shared team member instructions, then the house
    // rules, folders, memory and company knowledge. Older installs keep the
    // text below.
    if (meta.isResearch) {
      const paths: PromptPaths = { inbox: inDir('inbox'), inboxDone: inDir('inbox', '.done'), outbox: inDir('outbox'), protocol: inRoot('PROTOCOL.md'), hiveRoot: root };
      return [
        researchInstructions(business ?? {}, godNameForPrompt || 'Michael', paths, this.researchName()),
        '',
        this.houseRules(),
        '',
        `Your memory: the app gives you your memory index at the start of each session; procedure files it names are in ${inDir('memory')}. When you finish a question, add at most three short notes to ${inDir('memory', 'inbox.md')}, only for things you would otherwise look up again: a good source for a kind of question, with the date you checked it. Save nothing a teammate told you about the business.`
      ].join('\n');
    }
    if (businessFolder && !meta.isAssistant) {
      const paths: PromptPaths = {
        inbox: inDir('inbox'),
        inboxDone: inDir('inbox', '.done'),
        outbox: inDir('outbox'),
        protocol: inRoot('PROTOCOL.md'),
        hiveRoot: root,
        ...(docTextCliPath ? { docText: `"${hiveNode}" "${docTextCliPath}"` } : {})
      };
      const b = business ?? {};
      const roleTitle = (meta.role ?? '').split(': ')[0].trim() || 'team member';
      return [
        meta.isGod
          ? michaelInstructions(meta.name, b, paths)
          : teamMemberInstructions(meta.name, roleTitle, godNameForPrompt || 'Michael', b, paths),
        '',
        this.houseRules(),
        '',
        folderLine,
        memoryRule(inDir('memory', 'inbox.md'), inDir('memory')),
        memoryEndOfTask(inDir('memory', 'inbox.md')),
        knowledgeLine,
        memoryLine
      ].filter(Boolean).join('\n');
    }
    const guardrailsLine = 'Guardrails: a circuit breaker watches the floor: a "Circuit breaker: steer/constrain" message means you are looping or overspending, so STOP repeating, summarize what you tried, and follow it. Be token-frugal (a floor-wide or per-agent token budget can pause you). The shared plan has two parts: board.md (freeform; god is the sole scribe) and tasks.json (structured kanban: todo, doing, waiting, blocked, done).' + (meta.isGod ? ' You alone write tasks.json; team members file what they need in the triage folder of the hive, which you work oldest first.' : ' Only god writes tasks.json: never change a card yourself, file what your work needs as one new file in the triage folder of the hive, and tell god what changed.');
    const slackLine = meta.isGod
      ? 'SLACK REPLIES: When composing a Slack reply (or writing the `result` field of a Slack-origin kanban card), you MUST: (1) directly address what the user asked — never a bare "done"; (2) include the relevant specifics, outcome, and details; (3) format for Slack mrkdwn — open with a short *bold* headline, use bullet points for multiple items, wrap code/paths in `backtick` blocks, keep it concise (no walls of text). When finishing a Slack-origin task, always write a complete, user-facing, well-formatted `result` on the kanban card — the system posts it verbatim to Slack as the done reply.'
      : `SLACK REPLIES: If god dispatches you a task that came from Slack, it will include an exact \`"${hiveNode}" "<helper>" --channel … --thread … --text "…"\` reply command — when you finish, run it VERBATIM to post your result back to that thread yourself. The reply must be SUBSTANTIVE Slack mrkdwn (a short *bold* headline + the actual outcome/specifics/links), NEVER a bare "done".`;
    return [
      `You are "${meta.name}" (${meta.id}), an autonomous agent in a collaborating hive of AI agents.`,
      `Your private workspace is ${dir}. The shared hive is ${root}. Full protocol: ${inRoot('PROTOCOL.md')}.`,
      '',
      this.houseRules(),
      '',
      'HIVE PROTOCOL — follow it every task:',
      `1. At the START of a task, read EVERY file in ${inDir('inbox')} (messages other agents sent you). After handling an inbox message, move its file into ${inDir('inbox', '.done')}.`,
      `2. ${memoryRule(inDir('memory', 'inbox.md'), inDir('memory'))}`,
      `3. To ask another agent for something or share information, write ONE message JSON into ${inDir('outbox')} (schema in PROTOCOL.md). NEVER write into another agent's folder — the orchestrator delivers your outbox.`,
      `4. ${memoryEndOfTask(inDir('memory', 'inbox.md'))}`,
      folderLine,
      guardrailsLine,
      memoryLine,
      knowledgeLine,
      godLine,
      spawnQueueLine,
      meta.isGod && !this.orchestratorMaySpawn() ? NO_FIT_LINE : '',
      runtimeLine,
      slackLine,
      ctxLine,
      `Env vars available to you: AGENT_ID, AGENT_NAME, HIVE_ROOT, AGENT_DIR.`
    ].filter(Boolean).join('\n');
  }

  // — messaging —

  /** Normalize a partial message into a full HiveMessage. */
  private normalize(partial: Partial<HiveMessage>, from: string): HiveMessage {
    // An act outside the protocol reads as inform: a file can carry any
    // string here, and it reaches prompts (red team, third ship).
    const act = (MESSAGE_ACTS.includes(String(partial.act)) ? partial.act : 'inform') as MessageAct;
    return {
      id: isSafeMessageId(partial.id) ? partial.id : `${stamp()}-${shortRand()}`,
      conversation: partial.conversation ?? `conv-${shortRand()}`,
      in_reply_to: partial.in_reply_to ?? null,
      from: partial.from ?? from,
      to: partial.to ?? 'god',
      act,
      subject: partial.subject ?? '',
      body: partial.body ?? '',
      hops: typeof partial.hops === 'number' ? partial.hops : 0,
      requires_reply: partial.requires_reply ?? ['request', 'query', 'propose'].includes(act),
      needs_human: partial.needs_human ?? false,
      created_at: partial.created_at ?? new Date().toISOString(),
      // Owner conversation fields (michael-replies.md): kept only when well formed.
      ...(typeof partial.expect_by === 'string' && Number.isFinite(Date.parse(partial.expect_by)) ? { expect_by: partial.expect_by } : {}),
      ...(typeof partial.waiting_on === 'string' && partial.waiting_on.trim() ? { waiting_on: partial.waiting_on.trim().slice(0, 60) } : {}),
      ...(partial.from_notes === true ? { from_notes: true } : {})
    };
  }

  /** Atomically deliver a message into a recipient agent's inbox.
   *  Returns false when the recipient has no inbox, so the caller can bounce and
   *  log the drop rather than let the message vanish. */
  private deliver(msg: HiveMessage, toId: string): boolean {
    if (!this.root()) return false;
    // Both fields flow into the file path — refuse anything that isn't a plain
    // id rather than let a crafted `..` write outside the hive (defense in depth:
    // normalize() already sanitizes, but deliver() is also called directly).
    if (!isSafeMessageId(msg.id) || !isSafeMessageId(toId)) return false;
    const inbox = join(this.agentDir(toId), 'inbox');
    if (!existsSync(inbox)) return false; // unknown recipient — the caller reports it
    // Only the trust layer's clean copies reach Research (ship review D2.1):
    // anything else is refused here too, and what is delivered carries a
    // content stamp the sweep checks (eng R2).
    if (toId === RESEARCH_ID && !this.researchCleared.has(msg.id)) {
      this.appendLog({ kind: 'drop', reason: 'research-unchecked', from: msg.from, id: msg.id });
      return true;
    }
    const out = toId === RESEARCH_ID ? { ...msg, stamp: this.researchStamp(msg) } : msg;
    this.atomicWriteJson(join(inbox, `${msg.id}.json`), out);
    return true;
  }

  // — Research and its trust layer (shared/research.ts, main/trustLayer.ts, issue #230) —

  /** The trust layer every message to and from Research passes. */
  private trustLayer: TrustLayer | null = null;
  setTrustLayer(layer: TrustLayer | null): void { this.trustLayer = layer; }
  /** The owner's Research switch (config). Who Research is comes from the app,
   *  never from a file agents can write (ship review D2.7). */
  private researchEnabled: () => boolean = () => false;
  setResearchEnabled(fn: () => boolean): void { this.researchEnabled = fn; }
  /** Checks under way or finished, by the outbox file's content. A message
   *  waits in its outbox until its check finishes; an app restart checks it
   *  again; an entry nobody claims is forgotten after TRUST_CHECK_KEEP_MS. */
  private trustChecks = new Map<string, { done: boolean; at: number; verdict?: InboundVerdict | OutboundVerdict; firstAt: number; tries: number; retryAt?: number }>();
  static readonly TRUST_CHECK_KEEP_MS = 10 * 60_000;
  /** A check that could not run (no answer, an unreadable one, a failure) is
   *  tried again for this long before the message is held: the check's hidden
   *  session can take minutes while the whole team starts (owner, 2026-10-16:
   *  "why messages are not queued and waited", D1 30 minutes). Nothing goes
   *  out unchecked meanwhile. */
  static TRUST_WAIT_MS = 30 * 60_000;
  /** The gap before try `tries + 1`: 30 s, 1, 2 and 4 minutes, then every 5. */
  static trustRetryDelayMs(tries: number): number { return Math.min(5 * 60_000, 30_000 * 2 ** Math.max(0, tries)); }
  /** A deny that only says the check could not run this time. */
  private checkMayRunLater(v: InboundVerdict | OutboundVerdict): boolean {
    return v.decision === 'deny' && heldWaits(heldWhy(v, REFUSAL_CHECK_FAILED, REFUSAL_TOO_LONG));
  }
  /** Ids of clean copies the trust layer produced; only these reach Research. */
  private researchCleared = new Set<string>();
  /** The sender's message behind each clean copy, by the copy's id and its
   *  thread, so Research's answer lands back in the sender's thread while
   *  Research never sees the sender's thread id (ship review). */
  private researchThreadMap: Map<string, { origId: string; conversation: string; from: string }> | null = null;
  static readonly RESEARCH_THREADS_KEEP = 500;
  /** Kept in the app's private folder, so an answer after a restart still
   *  finds its thread and the Messages tab shows ask and answer together. */
  private get researchThreads(): Map<string, { origId: string; conversation: string; from: string }> {
    if (this.researchThreadMap) return this.researchThreadMap;
    this.researchThreadMap = new Map();
    const home = this.getHome();
    try {
      const rows = home ? JSON.parse(readFileSync(join(privateRoot(home), 'research-threads.json'), 'utf8')) : [];
      if (Array.isArray(rows)) for (const r of rows) {
        if (Array.isArray(r) && typeof r[0] === 'string' && r[1] && typeof r[1].origId === 'string' && typeof r[1].conversation === 'string' && typeof r[1].from === 'string') {
          this.researchThreadMap.set(r[0], { origId: r[1].origId, conversation: r[1].conversation, from: r[1].from });
        }
      }
    } catch { /* none yet */ }
    return this.researchThreadMap;
  }
  private saveResearchThreads(): void {
    const home = this.getHome();
    if (!home) return;
    try {
      mkdirSync(privateRoot(home), { recursive: true });
      this.atomicWriteJson(join(privateRoot(home), 'research-threads.json'), [...this.researchThreads]);
    } catch (e) { console.error('[research] could not save its threads', e); }
  }
  /** The thread a message in Research's inbox belongs to, as its sender sees it. */
  private shownConversation(owner: string, conversation: string): string {
    return owner === RESEARCH_ID ? (this.researchThreads.get(conversation)?.conversation ?? conversation) : conversation;
  }
  /** App and owner messages for Research whose check is under way. */
  private researchQueued = 0;
  /** Checked messages for Research whose delivery failed (a disk error), by
   *  id: each routing pass tries them again with the verdict they already have. */
  private readonly researchUndelivered = new Map<string, () => void>();
  /** About a minute of tries at the router's 1.5 s pace, so a disk that
   *  fills up or locks for a moment doesn't cost the owner a note. */
  static readonly RESEARCH_DELIVERY_TRIES = 40;
  private stampKey: Buffer | null = null;

  /** Research while it is on: the reserved id, the owner's switch, a live entry. */
  researchOn(): boolean {
    try {
      if (!this.researchEnabled()) return false;
      const r = this.registry().agents[RESEARCH_ID];
      return !!r && !r.archived;
    } catch { return false; }
  }

  /** The key behind Research's stamps and thread ids, kept in the app's
   *  private folder, which no agent opens. */
  private researchKey(): Buffer {
    if (!this.stampKey) {
      const home = this.getHome();
      const file = home ? join(privateRoot(home), 'research-stamp.key') : null;
      try {
        if (file && existsSync(file)) this.stampKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
      } catch { /* made below */ }
      if (!this.stampKey || this.stampKey.length < 16) {
        this.stampKey = randomBytes(32);
        if (file) {
          // Written whole or not at all: a cut write would leave a short key
          // that drops every waiting message at the next start (review).
          try {
            mkdirSync(dirname(file), { recursive: true });
            const tmp = `${file}.tmp-${shortRand()}`;
            writeFileSync(tmp, this.stampKey.toString('hex'), { mode: 0o600 });
            renameSync(tmp, file);
          }
          catch (e) { console.error('[research] could not save the stamp key; messages waiting for Research at the next start will be sent back', e); }
        }
      }
    }
    return this.stampKey!;
  }

  /** The stamp on a message the app delivered to Research: an HMAC of its
   *  whole content, so a stamped file can't be edited later. */
  private researchStamp(m: Partial<HiveMessage>): string {
    const { stamp: _stamp, ...fields } = m as Partial<HiveMessage> & { stamp?: unknown };
    const content = JSON.stringify(fields, Object.keys(fields).sort());
    return createHmac('sha256', this.researchKey()).update(content).digest('hex');
  }

  /** A folder of Research's the app is about to act in, checked to be the
   *  real one (researchNotes.ts ownResearchDir), or null. */
  private researchDir(...parts: string[]): string | null {
    return this.root() ? ownResearchDir(this.agentDir(RESEARCH_ID), ...parts) : null;
  }

  /** Exactly what deliver() wrote to Research: the file named by its id,
   *  carrying the app's stamp, byte for byte. A raw edit that parses the
   *  same (a duplicate key ahead of the real one) is not. */
  private isResearchDelivered(f: string, raw: string, m: unknown): m is HiveMessage {
    const x = m as (Partial<HiveMessage> & { stamp?: unknown }) | null;
    return !!x && typeof x === 'object' && typeof x.id === 'string' && f === `${x.id}.json`
      && x.stamp === this.researchStamp(x) && raw === JSON.stringify(x, null, 2);
  }

  /** A message in Research's inbox or its handled copies, read the safe way,
   *  only when the app delivered it. Anything else there is Research's own
   *  writing and is never shown or acted on as mail (red team, third ship). */
  private researchDelivered(full: string): HiveMessage | null {
    const raw = readResearchFile(this.agentDir(RESEARCH_ID), full);
    if (raw === null) return null;
    try {
      const m: unknown = JSON.parse(raw);
      return this.isResearchDelivered(basename(full), raw, m) ? m : null;
    } catch { return null; }
  }

  /** Remove one entry of a Research folder, only while that folder is still
   *  the real one. Never a folder: a delete that walks into one Research can
   *  write could be led through a link it swaps in meanwhile (red team, third
   *  ship). A file, link or pipe is unlinked, never followed. */
  private dropResearchEntry(dir: string, f: string, ...parts: string[]): void {
    if (!isOwnResearchDir(this.agentDir(RESEARCH_ID), dir, ...parts)) return;
    const full = join(dir, f);
    try {
      if (lstatSync(full).isDirectory()) return;
      unlinkSync(full);
    } catch { /* next tick */ }
  }

  /** Before the app writes in Research's folder: the folder is a real one,
   *  its mail and notes folders too, and nothing at its top is a link, a pipe
   *  or a file with a second name, so a write never lands somewhere else
   *  (red team, third ship). Its shell can't change the top of its folder. */
  private makeResearchFolderSafe(): void {
    const dir = this.researchDir();
    if (!dir) return;
    for (const parts of [['inbox'], ['inbox', '.done'], ['outbox'], ['memory']]) this.researchDir(...parts);
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      try {
        const st = lstatSync(join(dir, n));
        if (st.isDirectory() || (st.isFile() && st.nlink === 1)) continue;
        this.dropResearchEntry(dir, n);
      } catch { /* gone */ }
    }
  }

  /** Where the app's mail readers may look in a folder: Research's inbox and
   *  its handled copies only as stamped deliveries; the rest of its folder
   *  never, since that is Research's own writing (third ship D3); everyone
   *  else's as written. */
  private mailFolderKind(dir: string): 'stamped' | 'hidden' | 'plain' {
    if (!this.root()) return 'plain';
    const base = resolve(this.agentDir(RESEARCH_ID));
    const d = resolve(dir);
    if (d === join(base, 'inbox') || d === join(base, 'inbox', '.done')) return 'stamped';
    return d === base || d.startsWith(base + sep) ? 'hidden' : 'plain';
  }

  /** Remove every file in Research's inbox the app did not deliver, so a
   *  message written straight into it never skips the trust layer. Its sender,
   *  when it is a teammate, is told to ask again. */
  private sweepResearchInbox(on: boolean): void {
    if (!on) return;
    // Its inbox as the real folder, never a link Research put in its place:
    // removing through one would delete the app's own files (red team, third ship).
    const inbox = this.researchDir('inbox');
    if (!inbox) return;
    for (const f of readdirSync(inbox)) {
      if (!f.endsWith('.json')) continue;
      const full = join(inbox, f);
      // Read the safe way: a link, a pipe or a file with a second name is
      // never followed or waited on, and is swept.
      const raw = readResearchFile(this.agentDir(RESEARCH_ID), full);
      let m: Partial<HiveMessage> & { stamp?: unknown } = {};
      if (raw !== null) {
        let parsed: unknown = null;
        try { parsed = JSON.parse(raw); } catch {
          if (this.stillBeingWritten(full)) continue;
        }
        if (this.isResearchDelivered(f, raw, parsed)) continue;
        if (parsed && typeof parsed === 'object') m = parsed as typeof m;
      }
      this.dropResearchEntry(inbox, f, 'inbox');
      this.appendLog({ kind: 'drop', reason: 'unstamped-research-inbox', file: createHash('sha256').update(f).digest('hex').slice(0, 16) });
      if (typeof m.from === 'string' && m.from !== RESEARCH_ID && this.registry().agents[m.from]) {
        this.tellSender(m.from, typeof m.id === 'string' ? m.id : null, m.conversation, NOT_SENT_SUBJECT, REFUSAL_CHECK_FAILED);
      }
    }
  }

  /** One trust layer note to a sender only (owner, 2026-10-13), in the
   *  thread of the message it is about. */
  private tellSender(to: string, aboutId: string | null, conversation: unknown, subject: string, body: string, named = false): void {
    // App text names the Research agent by its current name (owner, ship 2 D17); a
    // body that quotes someone's words comes already named.
    const n = this.researchName();
    this.routeMessage(this.normalize({
      to, act: 'inform', subject: researchText(subject, n), body: named ? body : researchText(body, n),
      in_reply_to: aboutId && isSafeMessageId(aboutId) ? aboutId : null,
      ...(safeConversation(conversation) ? { conversation } : {})
    }, PRIVACY_CHECK_SENDER));
  }

  /** Michael hears of every message the privacy check kept from Research:
   *  who sent it, its subject and why, and what to do about it, so he can tell
   *  the owner what was stopped and where it is set (owner, 2026-10-14). His
   *  own messages come back to him as their sender already. */
  private tellMichaelNotSent(from: string, subject: unknown, reason: string): void {
    const reg = this.registry();
    const godId = reg.godId ?? 'god';
    if (from === godId) return;
    const n = this.researchName();
    const what = from === 'human' ? 'A note from the owner'
      : from === 'system' ? 'A message from the app'
        : `${reg.agents[from]?.name?.trim() || from}'s message`;
    const next = reason === REFUSAL_CHECK_FAILED || reason === REFUSAL_NOT_DELIVERED
      ? 'This is an app problem. If it keeps happening, tell the owner.'
      : reason === REFUSAL_OFF
        ? `The owner turns ${n} on in Settings, Research & privacy.`
        : 'If this holds up work the owner should know about, tell them what was stopped and why: what stays private is set in Settings, Research & privacy.';
    this.deliver(this.normalize({
      to: godId, act: 'inform', subject: researchText(NOT_SENT_SUBJECT, n),
      // The subject is the sender's words: every kind of quote mark and line
      // break is dropped so it can't close the quote and add text in the app's
      // voice. The reason's own "Not sent..." opening is not repeated.
      body: `${what} for ${n} ("${tidy(subject, HELD_SUBJECT_MAX)}") was not sent: ${researchText(reason, n).replace(/^Not sent( to [^:]+)?: /, '')} ${next}`
    }, PRIVACY_CHECK_SENDER), godId);
  }

  /** Michael hears of a Research answer the check could not clear, as he does
   *  of a held question, so a card waiting on it never stalls unseen (owner,
   *  2026-10-16, D5). */
  private tellMichaelAnswerHeld(to: string | null, subject: unknown): void {
    const reg = this.registry();
    const godId = reg.godId ?? 'god';
    const n = this.researchName();
    // `to` null: the answer was for Michael himself.
    const toName = to ? reg.agents[to]?.name?.trim() || to : null;
    this.deliver(this.normalize({
      to: godId, act: 'inform', subject: `${n}'s answer was not delivered`,
      body: toName
        ? `${n}'s answer to ${toName} ("${tidy(subject, HELD_SUBJECT_MAX)}") was not delivered: the privacy check could not run, so nothing went out unchecked. ${toName} was told to ask again if the work still needs it. This is an app problem. If it keeps happening, tell the owner.`
        : `${n}'s answer to you ("${tidy(subject, HELD_SUBJECT_MAX)}") was not delivered: the privacy check could not run, so nothing went out unchecked. Ask ${n} again if the work still needs it. This is an app problem. If it keeps happening, tell the owner.`
    }, PRIVACY_CHECK_SENDER), godId);
  }

  /** One row per hold in the owner's private folder, never the committed log
   *  (it carries the subject and the opening of the message), and one
   *  trust-held line with no text, which Pulse counts (owner, 2026-10-16). */
  recordHeld(way: 'in' | 'out', from: string, to: string, subject: unknown, body: unknown, why: HeldWhy, error: string | undefined, told: HeldTold): void {
    this.appendLog({ kind: 'trust-held', way });
    const home = this.getHome();
    if (!home) return;
    const reg = this.registry();
    const nameOf = (id: string): string | null => (id === 'human' || id === 'system' ? null : id === RESEARCH_ID ? this.researchName() : reg.agents[id]?.name?.trim() || null);
    const row: HeldRow = {
      at: Date.now(), way, from, fromName: nameOf(from), to, toName: nameOf(to),
      subject: tidy(asText(subject), HELD_SUBJECT_MAX), opening: tidy(asText(body), HELD_OPENING_MAX),
      why, ...(error ? { error: tidy(error, 200) } : {}), told
    };
    const file = join(privateRoot(home), HELD_FILE);
    try {
      mkdirSync(privateRoot(home), { recursive: true });
      appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
      // Once a day, rows past the keep window go (Pulse keeps raw events as long).
      if (row.at - this.heldPrunedAt > 86_400_000) {
        this.heldPrunedAt = row.at;
        const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
        const keep = lines.filter((l) => { try { return (JSON.parse(l) as HeldRow).at >= row.at - HELD_KEEP_MS; } catch { return false; } });
        // Written again only when a row went.
        if (keep.length !== lines.length) writeFileSync(file, keep.length ? `${keep.join('\n')}\n` : '', 'utf8');
      }
    } catch { /* best effort: the count still shows, and the list says what it cannot show */ }
  }
  private heldPrunedAt = 0;

  /** One row per message the check let through or stopped, both ways, in the
   *  owner's private folder (both texts, whole up to 4,000 characters; eng D1),
   *  and one trust-checked line with no text, which Pulse counts (eng D5).
   *  Once a day rows past 62 days move to the archive, which the app never
   *  deletes (eng D2; only a reset does, D3). A hold is recordHeld's. */
  recordChecked(way: 'in' | 'out', from: string, to: string, outcome: CheckedOutcome, wrote: { subject?: unknown; body?: unknown },
    sent?: { subject?: unknown; body?: unknown }, extra: { kinds?: readonly string[]; flagged?: boolean } = {}): void {
    this.appendLog({ kind: 'trust-checked', way, decision: outcome, ...(way === 'out' ? { flagged: extra.flagged === true } : {}) });
    const home = this.getHome();
    if (!home) return;
    const reg = this.registry();
    const nameOf = (id: string): string | null => (id === 'human' || id === 'system' ? null : id === RESEARCH_ID ? this.researchName() : reg.agents[id]?.name?.trim() || null);
    const keep = (t: { subject?: unknown; body?: unknown }) => { const s = keepText(asText(t.subject)); const b = keepText(asText(t.body)); return { text: { subject: s.text, body: b.text }, cut: s.cut || b.cut }; };
    const w = keep(wrote);
    const g = sent ? keep(sent) : null;
    const changed = !!g && (g.text.subject !== w.text.subject || g.text.body !== w.text.body);
    const row: CheckedRow = {
      at: Date.now(), way, from, fromName: nameOf(from), to, toName: nameOf(to), outcome, wrote: w.text,
      ...(changed && g ? { sent: g.text } : {}),
      ...(extra.kinds?.length ? { kinds: [...extra.kinds] } : {}),
      ...(extra.flagged ? { flagged: true } : {}),
      ...(w.cut || (changed && g?.cut) ? { cut: true } : {})
    };
    const file = join(privateRoot(home), CHECKED_FILE);
    try {
      mkdirSync(privateRoot(home), { recursive: true });
      appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
      if (row.at - this.checkedArchivedAt > 86_400_000) {
        this.checkedArchivedAt = row.at;
        const { keep: live, archive } = splitForArchive(readFileSync(file, 'utf8').split('\n'), row.at);
        if (archive.size) {
          // The archive first: a stop in between leaves a row in both, never in neither.
          const dir = join(privateRoot(home), CHECKED_ARCHIVE_DIR);
          mkdirSync(dir, { recursive: true });
          for (const [month, lines] of archive) appendFileSync(join(dir, `${month}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
          writeFileSync(file, live.length ? `${live.join('\n')}\n` : '', 'utf8');
        }
      }
    } catch { /* best effort: the count still shows, and the list says how many have no details */ }
  }
  private checkedArchivedAt = 0;

  /** Start a check, or read the one under way. `key` is the content hash. */
  private trustCheck(key: string, start: () => Promise<InboundVerdict | OutboundVerdict>): InboundVerdict | OutboundVerdict | 'hold' {
    const now = Date.now();
    const c = this.trustChecks.get(key);
    const launch = (firstAt: number, tries: number): 'hold' => {
      this.trustChecks.set(key, { done: false, at: now, firstAt, tries });
      start().then(
        (verdict) => { this.trustChecks.set(key, { done: true, at: Date.now(), verdict, firstAt, tries }); },
        () => { this.trustChecks.set(key, { done: true, at: Date.now(), verdict: { decision: 'deny', reason: REFUSAL_CHECK_FAILED }, firstAt, tries }); }
      );
      return 'hold';
    };
    if (!c) return launch(now, 0);
    // Waiting for its next try, or running.
    if (!c.done) return c.retryAt !== undefined && now >= c.retryAt ? launch(c.firstAt, c.tries + 1) : 'hold';
    if (!c.verdict) return 'hold';
    // The check could not run: the message keeps waiting in its outbox and is
    // tried again, until TRUST_WAIT_MS from its first try.
    if (this.checkMayRunLater(c.verdict) && now - c.firstAt < HiveManager.TRUST_WAIT_MS) {
      this.trustChecks.set(key, { done: false, at: now, firstAt: c.firstAt, tries: c.tries, retryAt: now + HiveManager.trustRetryDelayMs(c.tries) });
      this.appendLog({ kind: 'trust-wait', way: key.startsWith('out:') ? 'out' : 'in', tries: c.tries + 1 });
      return 'hold';
    }
    this.trustChecks.delete(key);
    return c.verdict;
  }

  /** A check's key: the message and the owner's privacy settings, so a
   *  verdict reached before the owner changed them is never used; the message
   *  is checked again (Codex review, third ship). */
  private trustKey(layer: TrustLayer, raw: string): string {
    return createHash('sha256').update(raw).update('\0').update(this.policyOf(layer)).digest('hex');
  }
  private policyOf(layer: TrustLayer): string {
    try { return layer.policyKey?.() ?? ''; } catch { return 'unreadable'; }
  }

  private pruneTrustChecks(now = Date.now()): void {
    // Only finished checks: one still running or waiting its turn is kept, so
    // a long queue never starts a second paid check for the same message.
    for (const [k, c] of this.trustChecks) {
      // A finished check nobody claimed, or one waiting to be tried again whose
      // message is gone (it would have been held by now).
      if ((c.done && now - c.at > HiveManager.TRUST_CHECK_KEEP_MS) || (c.retryAt !== undefined && now - c.firstAt > HiveManager.TRUST_WAIT_MS + HiveManager.TRUST_CHECK_KEEP_MS)) this.trustChecks.delete(k);
    }
  }

  /** A teammate's or Michael's message to Research, from its outbox. Held
   *  until the trust layer answers; then the clean copy goes to Research and the
   *  sender hears what was asked, or the sender alone hears why not. */
  private researchInboundGate(senderId: string, msg: HiveMessage, partial: Partial<HiveMessage>, raw: string, on: boolean): 'hold' | 'denied' | 'sent' {
    const deny = (reason: string, held?: { why: HeldWhy; error?: string }): 'denied' => {
      this.appendLog({ kind: 'trust-denied', from: senderId, id: msg.id });
      this.tellSender(senderId, msg.id, msg.conversation, NOT_SENT_SUBJECT, reason);
      this.tellMichaelNotSent(senderId, partial.subject, reason);
      if (held) this.recordHeld('in', senderId, RESEARCH_ID, partial.subject, partial.body, held.why, held.error, senderId === (this.registry().godId ?? 'god') ? 'sender' : 'sender+michael');
      return 'denied';
    };
    if (!on) return deny(REFUSAL_OFF);
    // Research not reporting (SD16): the question waits with Michael as it is,
    // before any check is paid for, and nobody is told it reached Research.
    if (this.memberMail?.(RESEARCH_ID) === 'hold') {
      this.holdForMichael({ ...msg, from: senderId }, [RESEARCH_ID], this.registry().godId ?? 'god');
      return 'sent';
    }
    if (hasAttachments(partial)) return deny(REFUSAL_FILES);
    if (!this.trustLayer) return deny(REFUSAL_CHECK_FAILED, { why: 'no-layer' });
    const layer = this.trustLayer;
    const v = this.trustCheck(`in:${this.trustKey(layer, raw)}`, () => layer.inbound({ subject: partial.subject, body: partial.body }));
    if (v === 'hold') return 'hold';
    if (v.decision === 'deny') {
      const why = heldWhy(v, REFUSAL_CHECK_FAILED, REFUSAL_TOO_LONG);
      if (!why) this.recordChecked('in', senderId, RESEARCH_ID, 'stop', partial, undefined, { kinds: 'kinds' in v ? v.kinds : undefined });
      return deny(v.reason, why ? { why, error: v.error } : undefined);
    }
    this.deliverToResearch(senderId, msg, v.subject, v.body);
    this.recordChecked('in', senderId, RESEARCH_ID, v.decision, partial, v, { kinds: 'removed' in v ? v.removed : undefined });
    if (v.decision === 'clean') this.tellSender(senderId, msg.id, msg.conversation, SENT_AS_SUBJECT, sentAsBody(v.subject, v.body, this.researchName()), true);
    return 'sent';
  }

  /** A message the app itself or the owner sends Research (a card reminder,
   *  an owner answer, a house rule note): it passes the same trust layer, in
   *  the background, before Research sees it (ship review D2.1). */
  private queueForResearch(msg: HiveMessage, upkeep = false): void {
    const fromAgent = msg.from !== RESEARCH_ID && !!this.registry().agents[msg.from];
    // A teammate hears why its own message was refused, and Michael hears of
    // every refusal, the owner's and the app's too, so nothing sent to
    // Research vanishes and he can tell the owner what was stopped (owner,
    // D8.2 and 2026-10-14).
    const tell = (reason: string): void => {
      if (fromAgent) this.tellSender(msg.from, msg.id, msg.conversation, NOT_SENT_SUBJECT, reason);
      else if (msg.from !== 'human' && msg.from !== 'system') return;
      this.tellMichaelNotSent(msg.from, msg.subject, reason);
    };
    // Who heard of a hold: the sender (a teammate) and Michael, or Michael alone.
    const told: HeldTold = fromAgent ? (msg.from === (this.registry().godId ?? 'god') ? 'sender' : 'sender+michael') : 'michael';
    // Upkeep is never research, so it is left out of what the owner reviews.
    const held = (why: HeldWhy, error?: string): void => { if (!upkeep) this.recordHeld('in', msg.from, RESEARCH_ID, msg.subject, msg.body, why, error, told); };
    const checked = (outcome: CheckedOutcome, sent?: { subject?: unknown; body?: unknown }, kinds?: readonly string[]): void => {
      if (!upkeep) this.recordChecked('in', msg.from, RESEARCH_ID, outcome, msg, sent, { kinds });
    };
    if (!this.researchOn() || !this.trustLayer) {
      this.appendLog({ kind: 'trust-denied', from: msg.from, id: msg.id, reason: this.trustLayer ? 'research-off' : 'no-layer' });
      tell(this.trustLayer ? REFUSAL_OFF : REFUSAL_CHECK_FAILED);
      if (!this.trustLayer && this.researchOn()) held('no-layer');
      return;
    }
    this.researchQueued++;
    // Kept in the app's private folder while its check runs, so a crash in
    // between is told to Michael at the next start, not lost (Codex review).
    if (!fromAgent) this.researchPending(msg, true);
    const refuse = (reason: string, why?: string): void => {
      this.appendLog({ kind: 'trust-denied', from: msg.from, id: msg.id, ...(why ? { reason: why } : {}) });
      tell(reason);
    };
    const layer = this.trustLayer;
    const policy = this.policyOf(layer);
    const firstAt = Date.now();
    const attempt = (tries: number): void => { layer.inbound({ subject: msg.subject, body: msg.body }).then((v) => {
      // The check could not run: tried again with growing gaps, still waiting
      // and still in the pending list, until TRUST_WAIT_MS (owner, 2026-10-16).
      if (this.checkMayRunLater(v) && Date.now() - firstAt < HiveManager.TRUST_WAIT_MS && this.researchOn() && this.policyOf(layer) === policy) {
        this.appendLog({ kind: 'trust-wait', way: 'in', tries: tries + 1 });
        setTimeout(() => attempt(tries + 1), HiveManager.trustRetryDelayMs(tries));
        return;
      }
      this.researchQueued--;
      // Its pending row stays until it is delivered or refused. A delivery
      // that fails (a disk error) is tried again with this verdict on the next
      // routing passes, then told to Michael, so nothing is dropped unseen
      // (TODOS.md, Codex review of the mit/named-links ship).
      let deliveries = 0;
      const deliverOrRefuse = (): 'done' | 'again' | 'recheck' => {
        // The owner changed what stays private while it was checked, or
        // since: checked again under the new settings (Codex review, third ship).
        if (this.policyOf(layer) !== policy) return 'recheck';
        // Turned off while it waited for a check that could not run.
        if (!this.researchOn() && this.checkMayRunLater(v)) { refuse(REFUSAL_OFF, 'research-off'); return 'done'; }
        if (v.decision === 'deny') {
          const why = heldWhy(v, REFUSAL_CHECK_FAILED, REFUSAL_TOO_LONG);
          if (why) held(why, v.error);
          else checked('stop', undefined, v.kinds);
          refuse(v.reason);
          return 'done';
        }
        // Research may have been turned off while the check ran.
        if (!this.researchOn()) { refuse(REFUSAL_OFF, 'research-off'); return 'done'; }
        const routedBefore = this.lastRouted;
        try { this.deliverToResearch(msg.from, msg, v.subject, v.body); } catch (e) {
          console.error('[research] delivering a checked message', e);
          // It reached Research's inbox and a step after the write failed
          // (the floor's envelope): delivered, so never sent twice.
          const landed = this.lastRouted !== routedBefore && !!this.lastRouted?.delivered.includes(RESEARCH_ID);
          if (!landed) {
            if (deliveries < HiveManager.RESEARCH_DELIVERY_TRIES) return 'again';
            refuse(REFUSAL_NOT_DELIVERED, 'undelivered');
            return 'done';
          }
        }
        try {
          checked(v.decision, v, v.decision === 'clean' ? v.removed : undefined);
          if (v.decision === 'clean' && fromAgent) this.tellSender(msg.from, msg.id, msg.conversation, SENT_AS_SUBJECT, sentAsBody(v.subject, v.body, this.researchName()), true);
          this.commit('hive: trust layer delivered to research');
        } catch (e) { console.error('[research] after delivering a checked message', e); }
        return 'done';
      };
      const settle = (): void => {
        deliveries++;
        // A refusal that could not be told keeps its row, so the next start
        // tells Michael instead of nobody.
        let outcome: 'done' | 'again' | 'recheck' | 'keep' = 'keep';
        try { outcome = deliverOrRefuse(); } catch (e) { console.error('[research] settling a checked message', e); }
        if (outcome === 'again') {
          // Its row now says it passed its check, so a start after a close
          // tells Michael it was not delivered, not that it was being checked.
          if (deliveries === 1 && !fromAgent) this.researchPending(msg, true, true);
          this.researchUndelivered.set(msg.id, settle);
          return;
        }
        if (outcome === 'keep') return;
        if (!fromAgent) this.researchPending(msg, false);
        if (outcome === 'recheck') this.queueForResearch(msg, upkeep);
      };
      settle();
    }, () => {
      if (Date.now() - firstAt < HiveManager.TRUST_WAIT_MS && this.researchOn() && this.policyOf(layer) === policy) {
        this.appendLog({ kind: 'trust-wait', way: 'in', tries: tries + 1 });
        setTimeout(() => attempt(tries + 1), HiveManager.trustRetryDelayMs(tries));
        return;
      }
      this.researchQueued--;
      if (!fromAgent) this.researchPending(msg, false);
      try {
        // The owner changed what stays private meanwhile: checked again under
        // the new settings, as a check that answered is (ship review 2026-10-17).
        if (this.researchOn() && this.policyOf(layer) !== policy) { this.queueForResearch(msg, upkeep); return; }
        if (!this.researchOn()) refuse(REFUSAL_OFF, 'research-off');
        else { refuse(REFUSAL_CHECK_FAILED, 'failed'); held('failed'); }
      } catch { /* logged above */ }
    }); };
    attempt(0);
  }

  /** The owner's and the app's messages for Research whose check is under
   *  way, or that passed it and wait to be delivered (`checked`), by id: what
   *  they were and who sent them, nothing more. */
  private researchPending(msg: HiveMessage, add: boolean, checked = false): void {
    // Anything left from before this start is told first, never this run's.
    this.tellLostResearchPending();
    const home = this.getHome();
    if (!home) return;
    const file = join(privateRoot(home), 'research-pending.json');
    let rows: Array<{ id: string; from: string; subject: string; checked?: boolean }> = [];
    try { const r = JSON.parse(readFileSync(file, 'utf8')); if (Array.isArray(r)) rows = r; } catch { /* none yet */ }
    rows = rows.filter((r) => r && r.id !== msg.id);
    if (add) { rows.push({ id: msg.id, from: msg.from, subject: String(msg.subject ?? '').slice(0, 80), ...(checked ? { checked: true } : {}) }); this.researchPendingMine.add(msg.id); }
    try { mkdirSync(privateRoot(home), { recursive: true }); this.atomicWriteJson(file, rows); } catch { /* best effort */ }
  }

  /** At start: an owner or app message whose check or delivery never
   *  finished (the app closed or crashed) is told to Michael (Codex review, D8.2). The rows are
   *  moved aside first, so this run's own checks start a fresh list, and each
   *  stays until Michael's inbox takes its note: tried again on every routing
   *  pass, and at the next start if the app closes first (Codex, second ship). */
  private tellLostResearchPending(): void {
    if (this.researchPendingTold) return;
    const home = this.getHome();
    if (!home) return;
    const file = join(privateRoot(home), 'research-pending.json');
    const lost = join(privateRoot(home), 'research-pending-lost.json');
    let rows: Array<{ id: string; from: string; subject: string; checked?: boolean }> = [];
    try { const r = JSON.parse(readFileSync(lost, 'utf8')); if (Array.isArray(r)) rows = r; } catch { /* none left over */ }
    if (!this.researchPendingMoved) {
      let earlier: typeof rows = [];
      try { const r = JSON.parse(readFileSync(file, 'utf8')); if (Array.isArray(r)) earlier = r; } catch { /* none */ }
      // Each note once, by its id, however often a move was cut short; never
      // one this run is still checking.
      const seen = new Set(rows.map((r) => r?.id));
      rows = [...rows, ...earlier.filter((r) => r && !seen.has(r.id) && !this.researchPendingMine.has(r.id))];
      // Told whether or not the move works; a failed one is tried again.
      try {
        if (rows.length) this.atomicWriteJson(lost, rows);
        rmSync(file, { force: true });
        this.researchPendingMoved = true;
      } catch { /* next pass */ }
    }
    const godId = this.registry().godId ?? 'god';
    // Each notice goes once, even if the list can't be rewritten after it
    // (verification of the Codex fix: a stuck file sent it every pass).
    const left = rows.filter((r) => {
      if (!r || (r.from !== 'human' && r.from !== 'system') || this.researchLostTold.has(r.id)) return false;
      const ok = this.deliver(this.normalize({
        to: godId, act: 'inform', subject: researchText(NOT_SENT_SUBJECT, this.researchName()),
        body: `${r.from === 'human' ? 'A note from the owner' : 'A message from the app'} for ${this.researchName()} ("${String(r.subject ?? '').slice(0, 80)}") was not sent: the app closed while it was being ${r.checked === true ? 'delivered' : 'checked'}. Send it again if it still matters.`
      }, PRIVACY_CHECK_SENDER), godId);
      if (ok) this.researchLostTold.add(r.id);
      return !ok;
    });
    if (left.length) {
      // Rewritten only when the list changed.
      if (left.length !== rows.length) try { this.atomicWriteJson(lost, left); } catch { /* next pass */ }
      return;
    }
    this.researchPendingTold = true;
    try { rmSync(lost, { force: true }); } catch { /* left, the next start tells these again: once more beats never */ }
  }
  private researchPendingTold = false;
  private researchPendingMoved = false;
  /** This run's own notes under check, and the lost ones already told. */
  private readonly researchPendingMine = new Set<string>();
  private readonly researchLostTold = new Set<string>();

  /** One of the app's fixed upkeep notes, straight to Research: its words are
   *  the app's own, so there is nothing private to check and it is not a
   *  question. Logged with its kind; with Research off it is dropped quietly. */
  private upkeepToResearch(msg: HiveMessage, upkeep: UpkeepKind): void {
    if (!this.researchOn()) { this.appendLog({ kind: 'drop', reason: 'research-off', from: msg.from, id: msg.id, upkeep }); return; }
    this.appendLog({ kind: 'upkeep-to-research', from: msg.from, id: msg.id, upkeep });
    this.researchCleared.add(msg.id);
    try { this.routeMessage(msg); } finally { this.researchCleared.delete(msg.id); }
  }

  /** The clean copy Research receives: built only from what the trust layer
   *  returned, with an id, time and thread the app chose. */
  private deliverToResearch(fromId: string, orig: HiveMessage, subject: string, body: string): void {
    // Research answers questions; it is never assigned work, so a request
    // reaches it as a query (a request would go to Michael as a teammate's
    // job hand off). The thread is an HMAC of the sender and the sender's
    // thread: follow ups in one thread reach Research in one thread too,
    // without the sender's thread id, which the trust layer never read.
    const act: MessageAct = orig.act === 'inform' ? 'inform' : 'query';
    const thread = `conv-r-${createHmac('sha256', this.researchKey()).update(`thread\n${fromId}\n${orig.conversation}`).digest('hex').slice(0, 16)}`;
    const clean = this.normalize({ to: RESEARCH_ID, act, subject, body, conversation: thread }, fromId);
    const back = { origId: orig.id, conversation: orig.conversation, from: fromId };
    this.researchThreads.set(clean.id, back);
    this.researchThreads.set(clean.conversation, back);
    while (this.researchThreads.size > HiveManager.RESEARCH_THREADS_KEEP * 2) {
      const first = this.researchThreads.keys().next().value;
      if (first === undefined) break;
      this.researchThreads.delete(first);
    }
    this.saveResearchThreads();
    this.researchCleared.add(clean.id);
    try { this.routeMessage(clean); } finally { this.researchCleared.delete(clean.id); }
  }

  /** Research's own message, from its outbox: the trust layer cleans it of
   *  instructions aimed at agents before a teammate reads it; it arrives
   *  labelled, and a reply that plainly tries to steer its reader is flagged to
   *  Michael only (ship review D2.9, owner rule 2026-10-12). Applies whether or
   *  not Research is on now, so a late reply is treated the same. */
  private researchOutboundGate(msg: HiveMessage, partial: Partial<HiveMessage>, raw: string, fileKey = raw): 'hold' | 'denied' | 'sent' {
    const reg = this.registry();
    const godId = reg.godId ?? 'god';
    const recipient = typeof msg.to === 'string' && reg.agents[msg.to] ? msg.to : null;
    // The log is shared and committed: only a recipient the registry knows,
    // or Michael's plain aliases, goes in, and Research's own message id only
    // as a short hash, never a string Research made up (red team, third ship).
    const lowerTo = typeof msg.to === 'string' ? msg.to.trim().toLowerCase() : '';
    const logTo = recipient ?? (['god', 'michael', 'human'].includes(lowerTo) ? lowerTo : 'invalid');
    const logId = createHash('sha256').update(String(msg.id)).digest('hex').slice(0, 16);
    // Every outbound deny is a hold: the check could not run. The waiting
    // member and Michael are told (owner, 2026-10-16, D5), and Pulse lists it.
    const deny = (v?: { reason: string; by?: string; error?: string }): 'denied' => {
      this.appendLog({ kind: 'trust-denied', from: RESEARCH_ID, to: logTo, id: logId });
      const tellsRecipient = !!recipient && recipient !== RESEARCH_ID;
      if (tellsRecipient) this.tellSender(recipient!, null, msg.conversation, ANSWER_UNCHECKED_SUBJECT, ANSWER_UNCHECKED);
      const michaelIsRecipient = toMichael || recipient === godId;
      // Michael as the registered recipient already heard it from tellSender.
      if (!(tellsRecipient && recipient === godId)) this.tellMichaelAnswerHeld(michaelIsRecipient ? null : recipient, partial.subject);
      const why = v ? heldWhy(v, REFUSAL_CHECK_FAILED, REFUSAL_TOO_LONG) ?? 'failed' : 'no-layer';
      this.recordHeld('out', RESEARCH_ID, michaelIsRecipient ? godId : recipient ?? logTo, partial.subject, partial.body, why, v?.error, michaelIsRecipient ? 'recipient' : tellsRecipient ? 'recipient+michael' : 'michael');
      return 'denied';
    };
    // Research writes only to someone whose question it is answering, or to
    // Michael; never to the whole team (owner, D8.1). Anything else is
    // refused before any check, and Research is told why.
    const to = lowerTo;
    // A reply to the app's own senders is dropped quietly, as for everyone,
    // so a refusal note never starts a loop of answers.
    if (['scheduler', 'heartbeat', 'mail', 'system', 'foundations', PRIVACY_CHECK_SENDER].includes(to)) {
      this.appendLog({ kind: 'drop', reason: 'reply-to-system-sender', from: RESEARCH_ID, to: logTo, id: logId });
      return 'denied';
    }
    const toMichael = [godId, 'god', 'michael', 'human', resolveGodName(reg.agents[godId]?.name).toLowerCase()].includes(to);
    // The question it answers, by the reply's id or its thread, asked by
    // this very recipient (verification of D8.1).
    const answering = (msg.in_reply_to ? this.researchThreads.get(msg.in_reply_to) : undefined) ?? this.researchThreads.get(msg.conversation);
    const asked = !!recipient && answering?.from === recipient;
    if (!toMichael && !asked) {
      this.appendLog({ kind: 'trust-denied', from: RESEARCH_ID, to: logTo, id: logId, reason: 'not-an-asker' });
      const note = this.normalize({ to: RESEARCH_ID, act: 'inform', subject: NOT_SENT_SUBJECT_OUT, body: RESEARCH_ONLY_ASKERS }, PRIVACY_CHECK_SENDER);
      this.researchCleared.add(note.id);
      try { this.routeMessage(note); } finally { this.researchCleared.delete(note.id); }
      return 'denied';
    }
    if (!this.trustLayer) return deny();
    const layer = this.trustLayer;
    const v = this.trustCheck(`out:${this.trustKey(layer, raw)}`, () => layer.outbound({ subject: partial.subject, body: partial.body }));
    if (v === 'hold') return 'hold';
    if (v.decision === 'deny') return deny(v);
    // Back into the sender's own thread, only when it goes back to that
    // sender; Research knows only the clean copies' ids, so any other reply
    // id it writes is dropped (ship review pass 3).
    const byId = msg.in_reply_to ? this.researchThreads.get(msg.in_reply_to) : undefined;
    const back = byId ?? this.researchThreads.get(msg.conversation);
    // What is delivered is built only from the layer's verdict and fields the
    // app chooses: Research's id, act, times, flags and thread never pass
    // through unchecked (red team, third ship).
    const out = this.normalize({
      // The app's id, the same for the same file, so an answer delivered
      // again after a crash replaces itself instead of arriving twice.
      id: researchDeliveredId(fileKey),
      to: msg.to,
      act: 'inform',
      subject: v.subject,
      body: `${researchText(RESEARCH_REPLY_LABEL, this.researchName())}\n\n${v.body}`,
      in_reply_to: back && back.from === msg.to && byId ? back.origId : null,
      conversation: back && back.from === msg.to ? back.conversation : `conv-${shortRand()}`
    }, RESEARCH_ID);
    const flagged = ('flagged' in v && v.flagged) || looksLikeInjection(`${v.subject}\n${v.body}`);
    this.routeMessage(out);
    // What the team read, without the label the app puts above it (eng O4, DD1).
    this.recordChecked('out', RESEARCH_ID, out.to, v.decision, partial, v, { flagged });
    if (flagged) {
      const toName = reg.agents[out.to]?.name ?? out.to;
      this.appendLog({ kind: 'research-reply-flagged', to: logTo, id: out.id });
      const n = this.researchName();
      this.deliver(this.normalize({
        to: godId,
        act: 'inform',
        subject: `${n}'s answer may carry web instructions`,
        body: v.decision === 'clean'
          ? `${n}'s answer to ${toName} ("${out.subject.slice(0, 80)}") read like it was trying to steer its reader. The trust layer cleaned it and it was delivered labelled as information only. Look at it if the work matters.`
          : `${n}'s answer to ${toName} ("${out.subject.slice(0, 80)}") read like it was trying to steer its reader. It was delivered as written, labelled as information only. Look at it if the work matters.`
      }, PRIVACY_CHECK_SENDER), godId);
    }
    return 'sent';
  }

  /** Asks waiting for Research: delivered and not yet read, plus those in a
   *  check or waiting to be delivered again. Turning Research off sends these
   *  back (design review D7). */
  researchWaiting(): number {
    let n = this.researchQueued + this.researchUndelivered.size;
    for (const [k, c] of this.trustChecks) if (k.startsWith('in:') && !c.done) n++;
    // Only what the app delivered counts.
    // The app's own upkeep is never a question waiting (shared/upkeep.ts).
    n += this.listMessages(join(this.agentDir(RESEARCH_ID), 'inbox')).filter((m) => !this.isAppUpkeep(m)).length;
    return n;
  }

  /** App upkeep, delivered: a schedule decision (only the scheduler sends as
   *  'scheduler', and its scheduled runs are real work, so the decision is
   *  known by its subject), or word for word one of the app's fixed notes from
   *  the owner's side or the app. */
  private isAppUpkeep(m: { from?: unknown; subject?: unknown; body?: unknown }): boolean {
    if (m.from === 'scheduler') return m.subject === 'Schedule change approved' || m.subject === 'Schedule change declined';
    return (m.from === 'human' || m.from === 'system') && isAnyFixedUpkeep(m.subject, m.body);
  }

  /** As Research turns off: every message waiting in its inbox goes back to
   *  its sender with the Research off reason. */
  returnResearchInbox(): number {
    const inbox = this.researchDir('inbox');
    if (!inbox) return 0;
    const agents = this.registry().agents;
    let n = 0;
    for (const f of readdirSync(inbox)) {
      if (!f.endsWith('.json')) continue;
      const full = join(inbox, f);
      try {
        // Only a message the app delivered is answered for; anything else
        // there is Research's own writing and is only removed (red team,
        // third ship).
        const m = this.researchDelivered(full);
        if (!m) { /* removed below */ } else if (typeof m.from === 'string' && agents[m.from] && m.from !== RESEARCH_ID) {
          // Back into the sender's own thread, about its own ask (Codex review).
          const back = (typeof m.id === 'string' ? this.researchThreads.get(m.id) : undefined)
            ?? (typeof m.conversation === 'string' ? this.researchThreads.get(m.conversation) : undefined);
          const own = back && back.from === m.from ? back : null;
          this.tellSender(m.from, own ? own.origId : null, own ? own.conversation : null, NOT_SENT_SUBJECT, REFUSAL_OFF);
          n++;
        } else if (this.isAppUpkeep(m)) {
          // The app's own upkeep: removed quietly, never told (owner, 2026-10-18).
        } else if (m.from === 'human' || m.from === 'system') {
          // An owner or app note waiting for Research is told to Michael (D8.2).
          const godId = this.registry().godId ?? 'god';
          const rn = this.researchName();
          this.deliver(this.normalize({
            to: godId, act: 'inform', subject: researchText(NOT_SENT_SUBJECT, rn),
            body: `${m.from === 'human' ? 'A note from the owner' : 'A message from the app'} for ${rn} ("${String(m.subject ?? '').slice(0, 80)}") was not sent. ${researchText(REFUSAL_OFF, rn)}`
          }, PRIVACY_CHECK_SENDER), godId);
          n++;
        }
      } catch { /* unreadable: removed below */ }
      this.dropResearchEntry(inbox, f, 'inbox');
    }
    if (n) this.commit(`hive: returned ${n} research ask(s)`);
    return n;
  }

  /**
   * As an agent starts, tell it the house rules that changed since its last
   * start (shared/houseRulesNotice.ts). The rules it has seen are app-private,
   * beside the owner state, so no agent can mark a rule as read. They are
   * recorded only once the note is in its inbox, so a note that failed is sent
   * again at the next start. Returns the rules it was told.
   */
  tellHouseRules(agentId: string, resumed: boolean): string[] {
    const home = this.getHome();
    const agent = this.registry().agents[agentId];
    // Research reads its rules in its start instructions; a notice would cost
    // a trust layer check at every start.
    if (!home || !this.root() || !agent || agent.isAssistant || agentId === RESEARCH_ID) return [];
    const file = join(privateRoot(home), 'house-rules-seen.json');
    let seenAll: Record<string, string[]> = {};
    try { seenAll = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>; } catch { /* first start */ }
    const { tell, keys } = houseRulesToTell(this.houseRules(), Array.isArray(seenAll[agentId]) ? seenAll[agentId] : undefined, resumed);
    if (tell.length) {
      try {
        const msg = this.send({ to: agentId, act: 'inform', subject: HOUSE_RULES_CHANGED_SUBJECT, body: houseRulesNoticeBody(tell) }, 'human');
        if (this.lastRouted?.id !== msg.id || !this.lastRouted.delivered.includes(agentId)) return [];
      } catch { return []; }
    }
    mkdirSync(dirname(file), { recursive: true });
    this.atomicWriteJson(file, { ...seenAll, [agentId]: keys });
    return tell;
  }

  /** Inject a message directly (used by the orchestrator / UI / tests).
   *  `upkeep`: the app's own upkeep note (shared/upkeep.ts), stamped here by
   *  the code that sends it, never read from a message's file or words.
   *  `byOwner`: the owner typed or clicked this (the window's sends as
   *  'human'). The app's own notices go as 'human' too, so only this flag
   *  says the owner said it (Company foundations, ownerSaid). */
  send(partial: Partial<HiveMessage>, from = 'system', upkeep?: UpkeepKind, byOwner = false): HiveMessage {
    const msg = this.normalize(partial, from);
    this.routeMessage(msg, upkeep, byOwner && from === 'human');
    this.commit(`hive: msg ${msg.from}→${msg.to} (${msg.act})`);
    return msg;
  }

  private routeMessage(msg: HiveMessage, upkeep?: UpkeepKind, byOwner = false): void {
    if (msg.hops > HOP_CAP) {
      // loop guard — drop a runaway message rather than let agents ping-pong.
      // There's no human queue to fall back on; the god agent owns conflicts,
      // so he is told rather than the drop being silent (owner, 2026-09-27).
      this.appendLog({ kind: 'drop', reason: 'hop-cap', from: msg.from, to: msg.to, id: msg.id });
      try {
        const r = this.registry();
        const god = r.godId ?? 'god';
        if (msg.from !== 'system') {
          this.deliver(this.normalize({ to: god, act: 'inform', ...hopDropNotice(msg, r.agents) }, 'system'), god);
        }
      } catch { /* best-effort notice */ }
      return;
    }
    const reg = this.registry();
    const godId = reg.godId ?? 'god';
    // The hive has no separate human-approval queue — approvals are native to
    // each agent's Claude Code session (and approvable remotely). A message aimed
    // at "human" is handled by the god/orchestrator, the human's proxy here.
    // Michael answers to his internal id, "michael", his display name and, for
    // the owner, "human" (agents are told to write "michael"; owner cleanup,
    // 2026-09-25).
    const godName = resolveGodName(reg.agents[godId]?.name).toLowerCase();
    const resolveTo = (to: string): string => {
      const t = to.toLowerCase();
      return t === 'human' || t === 'god' || t === 'michael' || t === godName ? godId : to;
    };
    // Only Michael assigns work (owner, 2026-09-27, src/shared/handoffRule.ts):
    // a teammate handing another teammate a job goes to Michael instead.
    if (isPeerAssignment(msg, reg.agents, godId, resolveTo(msg.to))) {
      this.appendLog({ kind: 'reroute', reason: 'only-michael-assigns', from: msg.from, to: msg.to, id: msg.id });
      // The asker hears where it went, so it isn't left waiting on the teammate.
      const asked = msg.to === 'broadcast' ? 'the team' : (reg.agents[resolveTo(msg.to)]?.name ?? msg.to);
      this.deliver(this.normalize({
        to: msg.from, act: 'inform', subject: `Sent to ${resolveGodName(reg.agents[godId]?.name)}: ${msg.subject}`.slice(0, 200),
        body: `Your request to ${asked} went to ${resolveGodName(reg.agents[godId]?.name)}, who assigns work. To ask a teammate for a fact, use "act": "query".`
      }, 'system'), msg.from);
      msg = rerouteToMichael(msg, reg.agents, godId);
    }
    // The scheduler, the heartbeat and the mail app send; they don't read. A
    // reply to one is dropped quietly instead of bouncing back to Michael as
    // undeliverable (an approval's "send it now" would otherwise bounce).
    if (msg.to === 'scheduler' || msg.to === 'heartbeat' || msg.to === 'mail' || msg.to === 'foundations' || msg.to === PRIVACY_CHECK_SENDER) {
      this.appendLog({ kind: 'drop', reason: 'reply-to-system-sender', from: msg.from, to: msg.to, id: msg.id });
      return;
    }
    // Michael closing an owner request (docs/designs/card-lifecycle.md): his
    // reply to the owner is noted as the closure, then routed like any message
    // to the owner: logged, shown on the floor and seen by the observers
    // (closing time reads CLOSING-TIME-COMPLETE there). It is never delivered
    // back to him, because the targets below drop the sender ("human" resolves
    // to Michael). An early return here once hid every such reply from the
    // floor and the office log, and from closing time (2026-10-03).
    // An owner question asked in the dock (michael-replies.md) closes only on
    // done or refuse: a holding reply or a question back keeps it open.
    const toOwner = msg.from === godId && resolveTo(msg.to) === godId;
    // gstack-shortcut(dec-383ee82c): figures in Michael's answer are not checked against the team's report, upgrade when an answer records the reports it used or a wrong figure reaches the owner
    if (toOwner && msg.in_reply_to && (!this.isOwnerQuestion(msg.in_reply_to) || closesOwnerQuestion(msg.act))) {
      this.appendLog({ kind: 'owner-request-closed', id: msg.id, in_reply_to: msg.in_reply_to });
    }
    // Michael's reply to a dock question: the app may notify the owner.
    if (toOwner && msg.in_reply_to && this.isOwnerQuestion(msg.in_reply_to)) {
      try { this.ownerReplyListener?.(msg); } catch { /* notification is best-effort */ }
    }
    // A message to the owner that names no question is not shown anywhere, so
    // Michael is told to send it again with the id (R2). Closing time's
    // complete message (any spelling closing time accepts) and replies to Ask
    // me cards are untouched.
    if (toOwner && !msg.in_reply_to && !CLOSING_COMPLETE_RE.test(msg.subject ?? '') && this.ownerQuestionsCache.length) {
      this.appendLog({ kind: 'owner-reply-unmatched', id: msg.id });
      this.deliver(this.normalize({ to: godId, act: 'inform', ...unmatchedReplyNote(this.ownerQuestionsCache) }, 'system'), godId);
    }
    // Anything else for Research (an app note, an owner answer, a send()) goes
    // through the trust layer first, in the background (ship review D2.1).
    // Research not reporting: its questions wait with Michael like anyone's (SD16).
    if (addressedToResearch(msg.to, reg.agents, this.researchName()) && msg.from !== RESEARCH_ID && this.memberMail?.(RESEARCH_ID) === 'hold') {
      // The app's upkeep notes are not Michael's to pass on (his resend would
      // make them a listed question): dropped quietly, as with Research off.
      if (upkeep) { this.appendLog({ kind: 'drop', reason: 'research-held', from: msg.from, id: msg.id, upkeep }); return; }
      this.holdForMichael(msg, [RESEARCH_ID], godId);
      return;
    }
    if (addressedToResearch(msg.to, reg.agents, this.researchName()) && msg.from !== RESEARCH_ID && !this.researchCleared.has(msg.id)) {
      // The app's fixed upkeep notes are not research: no paid check, never
      // listed (owner, 2026-10-17). Anything else, upkeep with someone's words
      // included, is checked; only research is listed and counted.
      if (upkeep && isFixedUpkeep(upkeep, msg.subject, msg.body)) { this.upkeepToResearch({ ...msg, to: RESEARCH_ID }, upkeep); return; }
      this.appendLog({ kind: 'message-held-for-trust-layer', from: msg.from, id: msg.id });
      this.queueForResearch({ ...msg, to: RESEARCH_ID }, !!upkeep);
      return;
    }
    const targets = msg.to === 'broadcast'
      // The roster for fan-out is the ACTIVE registry: skip the send-only prep
      // assistant and any archived agent (closed tab). Hookless providers are
      // NOT skipped — the per-target path below already serves them a terminal
      // work order, so excluding them here only made a broadcast invisible to an
      // agent that direct mail reaches fine. See selectBroadcastTargets.
      ? selectBroadcastTargets(reg.agents, msg.from)
      // Never deliver to self — guards a god → "human" message looping back to god.
      : [resolveTo(msg.to)].filter((t) => t !== msg.from);
    // Targets that actually took delivery. The log below reports these instead of
    // intent, so a bounced or dropped message can never read as delivered.
    const delivered: string[] = [];
    // Members not reporting whose copy goes to Michael, as one held copy.
    const held: string[] = [];
    for (const t of targets) {
      // The send-only prep assistant must never be a delivery target: it doesn't
      // drain an inbox, so direct mail to it would rot unread (observed live: a
      // task brief plus the follow-up reprimand about the unread inbox, both
      // unread for hours). Bounce such mail to god instead, so the sender's intent
      // surfaces immediately and nothing is silently lost.
      if (reg.agents[t]?.isAssistant) {
        this.deliver({
          ...msg,
          to: godId,
          subject: `[bounced — "${t}" is the send-only prep assistant; route work to a real agent] ${msg.subject}`
        }, godId);
        continue;
      }
      // Not reporting (issue #326): held for Michael, or by terminal when kept.
      const silent = t !== godId ? this.memberMail?.(t) ?? null : null;
      if (silent === 'hold') { held.push(t); continue; }
      if (silent === 'handoff') {
        if (!this.emitTerminalHandoff(msg, t)) held.push(t);
        else delivered.push(t);
        continue;
      }
      // A provider without safe-idle lifecycle state (a hookless custom command)
      // would let direct mail rot unread. Claude and bridged Antigravity/Codex
      // receive directly into inbox/ for guarded renderer delivery. Otherwise try
      // a terminal work-order handoff to its REPL (#53);
      // if the renderer is unavailable, bounce to god to relay. God is exempt
      // (the bounce target).
      if (t !== godId && !canReceiveInbox(reg.agents[t]?.provider)) {
        if (!this.emitTerminalHandoff(msg, t)) {
          this.deliver({
            ...msg,
            to: godId,
            subject: `[undeliverable — "${t}" runs ${reg.agents[t]?.provider ?? 'a hookless CLI'} and the terminal handoff failed (renderer unavailable); relay this to it] ${msg.subject}`
          }, godId);
        } else delivered.push(t);
        continue;
      }
      // 1d — proxy-tier providers (qwen) CAN receive inbox, but only via a
      // SYNTHESIZED Stop, which just advances the cursor — the sidecar observes the
      // CLI's stream and can't inject a drain reason back into its turn. So the real
      // mail rides the terminal work-order path verbatim, exactly like a hookless
      // provider; the synthesized Stop→drain keeps the cursor in step.
      const proxyDesc = bridgeOf(reg.agents[t]?.provider);
      if (t !== godId && proxyDesc?.kind === 'proxy' && proxyDesc.inboxDelivery === 'terminal') {
        if (!this.emitTerminalHandoff(msg, t)) {
          this.deliver({
            ...msg,
            to: godId,
            subject: `[undeliverable — "${t}" runs ${reg.agents[t]?.provider ?? 'a proxy-tier CLI'} and the terminal handoff failed (renderer unavailable); relay this to it] ${msg.subject}`
          }, godId);
        } else delivered.push(t);
        continue;
      }
      if (this.deliver(msg, t)) { delivered.push(t); continue; }
      // No agents/<t>/inbox — an id that isn't on the floor. This was the one
      // delivery failure with neither bounce nor log, so the sender saw a routed
      // message and the mail simply ceased to exist. Record the drop beside the
      // hop-cap one and bounce to god, mirroring the undeliverable bounces above.
      this.appendLog({ kind: 'drop', reason: 'no-inbox', from: msg.from, to: t, id: msg.id });
      if (t !== godId) {
        this.deliver({
          ...msg,
          to: godId,
          subject: `[undeliverable — no agent "${t}" on this floor; check the id against the roster] ${msg.subject}`
        }, godId);
      }
    }
    if (held.length) this.holdForMichael(msg, held, godId);
    this.appendLog({ kind: 'message', from: msg.from, to: msg.to, act: msg.act, subject: msg.subject, id: msg.id, delivered });
    if (byOwner) this.recordOwnerSaid(msg.id, delivered);
    this.lastRouted = { id: msg.id, delivered };
    this.emitMessage(msg, targets);
    // Main-process observer (e.g. the closing-time controller watching for the
    // team's ACKs and the god's COMPLETE). Best-effort, never breaks routing.
    try { this.routedObserver?.(msg, targets); } catch { /* observer error */ }
  }

  /** Who took delivery of the last message routed (inbox or terminal), for a
   *  sender that must know it arrived (tellHouseRules). Routing is synchronous. */
  private lastRouted: { id: string; delivered: string[] } | null = null;

  /** Observer invoked for EVERY routed message with its resolved targets.
   *  Used by main-process features that react to hive traffic (closing time). */
  private routedObserver: ((msg: HiveMessage, targets: string[]) => void) | null = null;
  setRoutedObserver(cb: ((msg: HiveMessage, targets: string[]) => void) | null): void {
    this.routedObserver = cb;
  }

  /** Tell the renderer a message was routed, with its resolved recipients, so
   *  the floor can fly an envelope from the sender to each one. Best-effort. */
  private emitMessage(msg: HiveMessage, targets: string[]): void {
    this.emit?.('hive:message', {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      act: msg.act,
      subject: msg.subject,
      targets,
      // Michael's messages to the owner land in the dock (michael-replies.md),
      // never as a coral "needs you" envelope with nothing on the board.
      needsHuman: false
    });
  }

  /** Non-Claude providers cannot drain hive inbox; hand direct mail to the
   *  renderer so it can queue a terminal work order for the target PTY. */
  private emitTerminalHandoff(msg: HiveMessage, targetId: string): boolean {
    const delivered = this.emit?.('hive:terminalHandoff', {
      id: msg.id,
      from: msg.from,
      to: targetId,
      act: msg.act,
      subject: msg.subject,
      body: msg.body,
      requiresReply: msg.requires_reply,
      createdAt: msg.created_at
    }) === true;
    this.appendLog({
      kind: 'terminal-handoff',
      from: msg.from,
      to: targetId,
      act: msg.act,
      subject: msg.subject,
      id: msg.id,
      delivered
    });
    return delivered;
  }

  // — router: drain outboxes → inboxes —

  /** Poll-based router. Cheap and robust vs fs.watch quirks on macOS. */
  startRouter(intervalMs = 1500): void {
    if (this.routerTimer || !this.enabled()) return;
    this.routerTimer = setInterval(() => {
      try { this.routeOnce(); } catch { /* keep the loop alive */ }
    }, intervalMs);
  }
  stopRouter(): void {
    if (this.routerTimer) { clearInterval(this.routerTimer); this.routerTimer = null; }
  }

  /** How long an unreadable outbox file may be younger than before the router
   *  gives up on it: long enough for any write to finish. */
  static readonly OUTBOX_WRITE_GRACE_MS = 10_000;

  private stillBeingWritten(full: string, now = Date.now()): boolean {
    try { return now - statSync(full).mtimeMs < HiveManager.OUTBOX_WRITE_GRACE_MS; } catch { return false; }
  }

  /** When each agent was last told a file of theirs was unreadable. */
  private quarantineNoticeAt = new Map<string, number>();
  /** At most one "not delivered" notice per agent in this window, so an agent
   *  that keeps writing broken files is not woken into a loop. */
  static readonly QUARANTINE_NOTICE_GAP_MS = 10 * 60_000;

  /** The outbox journal (Codex review, ship 2026-10-18): the id and time the
   *  app chose for a member's outbox file, kept until the file is archived. A
   *  pass that died after delivering it delivers it again under the same id,
   *  so the copy replaces itself, or, once marked delivered, only archives it.
   *  Keyed by the file's identity, not its name or words (the sent stamp
   *  rewrites the words in place). In the app's private folder, out of every
   *  agent's reach. */
  private routingFile(agentId: string, f: string): string | null {
    const home = this.getHome();
    return home ? join(privateRoot(home), 'outbox-routing', agentId, f) : null;
  }

  private readRouting(agentId: string, f: string, st: Stats): RoutingRecord | null {
    const file = this.routingFile(agentId, f);
    if (!file || !existsSync(file)) return null;
    try {
      const r = JSON.parse(readFileSync(file, 'utf8')) as Partial<RoutingRecord>;
      if (r.ino === st.ino && r.birth === st.birthtimeMs && isSafeMessageId(r.id) && typeof r.created_at === 'string' && Number.isFinite(Date.parse(r.created_at))) {
        return { ino: r.ino, birth: r.birth, id: r.id, created_at: r.created_at, delivered: r.delivered === true };
      }
    } catch { /* unreadable: started afresh */ }
    // Another file under the same name: its record is stale.
    try { rmSync(file, { force: true }); } catch { /* written over below */ }
    return null;
  }

  private writeRouting(agentId: string, f: string, rec: RoutingRecord): void {
    const file = this.routingFile(agentId, f);
    if (!file) return;
    // A record that can't be written leaves routing as it was without one.
    try { mkdirSync(dirname(file), { recursive: true }); this.atomicWriteJson(file, rec); } catch { /* no journal */ }
  }

  private dropRouting(agentId: string, f: string): void {
    const file = this.routingFile(agentId, f);
    if (file) try { rmSync(file, { force: true }); } catch { /* pruned on a later pass */ }
  }

  /** Records whose file is no longer in the outbox: archived before its
   *  record went (a crash in between) or set aside. */
  private pruneRouting(agentId: string, present: Set<string>): void {
    const file = this.routingFile(agentId, 'x');
    const dir = file ? dirname(file) : null;
    if (!dir || !existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) if (!present.has(name)) rmSync(join(dir, name), { force: true });
    } catch { /* next pass */ }
  }

  /** Move an outbox file into its .sent archive. A name already archived gets a
   *  unique prefix instead of replacing the earlier message (rename overwrites),
   *  and a file that cannot be moved at all is removed, so it is never routed
   *  again on the next tick. */
  private archiveOutboxFile(fromPath: string, destDir: string, f: string): void {
    const dest = join(destDir, f);
    try {
      if (!existsSync(dest)) {
        renameSync(fromPath, dest);
        return;
      }
    } catch { /* fall through to a unique name */ }
    try {
      renameSync(fromPath, join(destDir, `${Date.now()}-${randomBytes(4).toString('hex')}-${f}`));
    } catch {
      try { rmSync(fromPath, { force: true }); } catch { /* best effort */ }
    }
  }

  /** Set an unreadable outbox file aside and tell its sender, who otherwise
   *  believes it was delivered. */
  private quarantine(id: string, outbox: string, f: string, badDir = join(outbox, '.sent'), logFile = f): void {
    this.appendLog({ kind: 'drop', reason: 'malformed-json', from: id, file: logFile });
    this.archiveOutboxFile(join(outbox, f), badDir, `bad-${f}`);
    const last = this.quarantineNoticeAt.get(id) ?? 0;
    if (Date.now() - last < HiveManager.QUARANTINE_NOTICE_GAP_MS) return;
    this.quarantineNoticeAt.set(id, Date.now());
    try {
      this.routeMessage(this.normalize({
        to: id,
        act: 'inform',
        subject: 'Message not delivered',
        body: `Your outbox file ${f} is not valid JSON, so nobody received it. Write the message again as one valid JSON object, then check it left your outbox.${id === RESEARCH_ID ? '' : ` The unreadable copy is in your outbox/.sent as bad-${f}.`}`
      }, 'system'));
    } catch { /* the drop is logged */ }
  }

  routeOnce(): number {
    const root = this.root();
    if (!root) return 0;
    const agentsDir = join(root, 'agents');
    if (!existsSync(agentsDir)) return 0;
    const researchOn = this.researchOn();
    try { this.tellLostResearchPending(); } catch { /* next start */ }
    // Checked messages for Research whose delivery failed get another try.
    for (const [id, retry] of [...this.researchUndelivered]) {
      this.researchUndelivered.delete(id);
      try { retry(); } catch { /* its pending row stays, so the next start tells Michael */ }
    }
    try { this.sweepResearchInbox(researchOn); } catch { /* next tick */ }
    this.pruneTrustChecks();
    // Read once per tick, when the first message needs them, not once per file.
    let reg: Registry | undefined;
    let researchName: string | undefined;
    let routed = 0;
    for (const id of readdirSync(agentsDir)) {
      // agents/human is the owner's folder, written only by the app; a file an
      // agent drops in its outbox would reach Michael as the owner's own words.
      if (id === 'human') { this.rejectOwnerOutbox(join(agentsDir, id, 'outbox')); continue; }
      // Research's outbox only as the real folder, and what it leaves there
      // is set aside in the app's private folder, never in a folder of its
      // own it could have swapped for a link (red team, third ship).
      const research = id === RESEARCH_ID;
      const home = research ? this.getHome() : null;
      if (research && !home) continue;
      const outbox = research ? this.researchDir('outbox') : join(agentsDir, id, 'outbox');
      if (!outbox || !existsSync(outbox)) continue;
      const badDir = home ? join(privateRoot(home), 'research-outbox', 'refused') : join(outbox, '.sent');
      if (home) mkdirSync(badDir, { recursive: true });
      const names = readdirSync(outbox);
      if (!research) this.pruneRouting(id, new Set(names));
      for (const f of names) {
        if (!f.endsWith('.json')) continue;
        const full = join(outbox, f);
        // Research's file names are its own words: the shared log keeps a hash.
        const logFile = research ? createHash('sha256').update(f).digest('hex').slice(0, 16) : f;
        try {
          // A link is never read: the app would follow it to a file the agent
          // can't open itself (ship review pass 3). The link is set aside.
          // Research's is read the safe way too: no pipe is waited on.
          const raw = lstatSync(full).isFile()
            ? (research ? readResearchFile(this.agentDir(RESEARCH_ID), full) : readMessageFile(full))
            : null;
          if (raw === null) {
            this.appendLog({ kind: 'drop', reason: 'outbox-not-a-file', from: id, file: logFile });
            this.archiveOutboxFile(full, badDir, `bad-${f}`);
            continue;
          }
          let partial: Partial<HiveMessage>;
          // A repaired file is archived as repaired, so everything that reads
          // .sent later (owner requests, the log) parses what was delivered.
          let repairedText: string | null = null;
          try {
            partial = JSON.parse(raw) as Partial<HiveMessage>;
          } catch {
            const repaired = repairLiteralLineBreaksInJsonStrings(raw);
            let parsed: Partial<HiveMessage> | null = null;
            if (repaired.changed) {
              try { parsed = JSON.parse(repaired.text) as Partial<HiveMessage>; } catch { /* still malformed */ }
            }
            if (!parsed) {
              // A file still being written reads as empty or cut short: a shell
              // `cat > file <<EOF` creates it empty, then fills it. Read it again
              // on a later tick; quarantine it only once it has sat unchanged
              // and still unreadable (2026-10-03: Michael's CLOSING-TIME-COMPLETE
              // was caught mid-write, quarantined, and closing time hung).
              if (this.stillBeingWritten(full)) continue;
              this.quarantine(id, outbox, f, badDir, logFile);
              continue;
            }
            partial = parsed;
            repairedText = repaired.text;
            this.appendLog({
              kind: 'outbox-repair',
              from: id,
              file: logFile,
              repair: 'literal-line-break'
            });
          }
          // Mail is only the agent's own plain file with one name: a hard link
          // to someone else's message (another member's inbox, Michael's sent
          // mail) is set aside, never sent again as new (Codex review, ship
          // 2026-10-18). It is also the file stamped in place below.
          let fileStat: Stats | null = null;
          if (!research) {
            const st = lstatSync(full);
            if (!st.isFile() || st.nlink !== 1) {
              this.appendLog({ kind: 'drop', reason: 'outbox-not-a-file', from: id, file: logFile });
              this.archiveOutboxFile(full, badDir, `bad-${f}`);
              continue;
            }
            fileStat = st;
          }
          // The app makes every id: one an agent wrote can repeat (a second
          // message with it overwrote the first in the inbox) or be missing
          // from the sent copy, so the conversation read every reply as "".
          const msg = this.normalize({ ...partial, id: undefined }, id);
          msg.from = id; // sender is authoritative — the owning directory
          // The time is the app's too: a time an agent typed, later or earlier,
          // could close the owner's next question or hide a message (Codex
          // review, ship 2026-10-18).
          msg.created_at = new Date().toISOString();
          // A file this pass already chose an id for (a pass that died before
          // archiving it) keeps that id and time; a new one is journaled before
          // it is delivered.
          const journal = fileStat ? this.readRouting(id, f, fileStat) : null;
          if (journal) { msg.id = journal.id; msg.created_at = journal.created_at; }
          const record = (delivered: boolean): void => {
            if (fileStat) this.writeRouting(id, f, { ino: fileStat.ino, birth: fileStat.birthtimeMs, id: msg.id, created_at: msg.created_at, delivered });
          };
          if (!journal) record(false);
          const archived = (dest: string): void => {
            this.archiveOutboxFile(full, dest, f);
            // Only once it has left the outbox: a rename that failed keeps it.
            if (fileStat && !existsSync(full)) this.dropRouting(id, f);
          };
          // The sent copy carries what was delivered: the app's id, sender and
          // time (and repaired text), written in place before the one rename
          // that archives it. Only a plain file of the agent's own is written
          // over (red team, third ship); anything else is archived as written.
          const stampSent = (): void => {
            const sent = JSON.stringify({ ...partial, id: msg.id, from: msg.from, created_at: msg.created_at }, null, 2);
            if (repairedText !== null) rewriteOwnFile(full, sent);
            else try { rewriteOwnFile(full, sent); } catch { /* not a plain file */ }
          };
          const schedule = (partial as { schedule?: unknown }).schedule;
          if (msg.to === 'scheduler' && schedule !== undefined && this.scheduleRequestHandler) {
            // A schedule request, not mail: main files it for the owner and the
            // scheduler answers the asking agent (and only that agent).
            // Filed before a pass died: never filed or answered twice.
            if (!journal?.delivered) {
              let reply: string;
              // The message body is the agent's reason, shown on the owner's card.
              try { reply = this.scheduleRequestHandler(id, schedule, typeof msg.body === 'string' ? msg.body : ''); } catch (e) {
                reply = 'Schedule request not sent: the app hit an error. Try again later.';
                console.error('[hive] schedule request', e);
              }
              this.appendLog({ kind: 'schedule-request', from: id, id: msg.id });
              this.routeMessage(this.normalize({ to: id, act: 'inform', subject: 'Schedule request', body: reply }, 'scheduler'));
              record(true);
            }
            // Research's file is moved as it is, as at its gate below.
            if (!research) stampSent();
            archived(join(outbox, '.sent'));
            routed++;
            continue;
          }
          // Company foundations (office-foundations.md): an answer, a gap or a
          // draft for the app's one writer, never mail. Research sends none; its
          // message meets its own gate below, which drops it. A plain reply to
          // `foundations` carries no payload and is dropped quietly below, as
          // replies to the scheduler are, so nothing bounces back and forth.
          const foundation = (partial as { foundation?: unknown }).foundation;
          if (msg.to === 'foundations' && foundation !== undefined && this.foundationsHandler && !research) {
            if (!journal?.delivered) {
              let reply: string | null;
              try { reply = this.foundationsHandler(id, foundation); } catch (e) {
                reply = 'Not saved: the app hit an error. Try again later.';
                console.error('[hive] foundations', e);
              }
              this.appendLog({ kind: 'foundations', from: id, id: msg.id });
              if (reply) this.routeMessage(this.normalize({ to: id, act: 'inform', subject: 'Company foundations', body: reply }, 'foundations'));
              record(true);
            }
            stampSent();
            archived(join(outbox, '.sent'));
            routed++;
            continue;
          }
          // Everything to and from Research passes its trust layer first.
          const toResearch = id !== RESEARCH_ID && addressedToResearch(partial.to, (reg ??= this.registry()).agents, researchName ??= this.researchName());
          if (toResearch || id === RESEARCH_ID) {
            const gate = toResearch ? this.researchInboundGate(id, msg, partial, raw, researchOn) : this.researchOutboundGate(msg, partial, raw, `${f}\n${raw}`);
            if (gate === 'hold') continue;
            // A denied original is kept apart from .sent, so nothing reads it as sent.
            // Research's raw originals are web text the outbound check has not
            // cleaned: they go to the app's private folder, out of every
            // agent's reach (owner, 2026-10-13: its folders are its alone).
            const dest = home
              ? join(privateRoot(home), 'research-outbox', gate === 'denied' ? 'refused' : 'sent')
              : join(outbox, gate === 'denied' ? '.refused' : '.sent');
            mkdirSync(dest, { recursive: true });
            // Research's archive is the app's own record: its file is moved as
            // it is, never written through (red team, third ship).
            if (!research) stampSent();
            archived(dest);
            routed++;
            continue;
          }
          // Delivered before a pass died: only archived now. A crash between
          // the delivery and its record delivers it again under the same id,
          // so the copy in the inbox replaces itself.
          if (!journal?.delivered) { this.routeMessage(msg); record(true); }
          // Stamped in place, then one rename archives it.
          stampSent();
          archived(join(outbox, '.sent')); // archive, don't reprocess
          routed++;
        } catch {
          // malformed file — quarantine so we don't spin on it
          this.archiveOutboxFile(full, badDir, `bad-${f}`);
        }
      }
    }
    if (routed > 0) this.commit(`hive: routed ${routed} message(s)`);
    return routed;
  }

  // — read helpers (for IPC / UI) —

  registry(): Registry {
    const root = this.root();
    if (!root) return { godId: null, agents: {} };
    return this.readJson<Registry>(join(root, 'registry.json'), { godId: null, agents: {} });
  }
  board(): string {
    const root = this.root();
    return root && existsSync(join(root, 'board.md')) ? readFileSync(join(root, 'board.md'), 'utf8') : '';
  }
  tasks(): unknown {
    const root = this.root();
    return root ? this.readJson(join(root, 'tasks.json'), { tasks: [] }) : { tasks: [] };
  }

  /** Persist the task ledger to hive/tasks.json and commit it. Mirrors the
   *  board/message persist pattern: write JSON, log the change, single-commit.
   *
   *  MERGES by card id instead of clobbering. Callers hold PARTIAL models of a
   *  card — the renderer's kanban parser knows nine fields, the god writes as
   *  many as the work needs (`result`, the verbatim Slack reply posted back to
   *  the user; `repo`; `scope`; `origin`; `commit`; …). A wholesale write meant
   *  one small edit through the UI deleted every unmodelled field on EVERY card
   *  on the board. Now an unmentioned field keeps its on-disk value.
   *
   *  The incoming list IS the membership: merging protects fields, never card
   *  membership. The app itself never drops a card; a card ends only as Done
   *  (docs/designs/card-lifecycle.md). */
  writeTasks(tasks: HiveTask[]): void {
    const root = this.root();
    if (!root) return;
    this.ensureHive();
    const path = join(root, 'tasks.json');
    const current = this.readJson<{ tasks?: unknown }>(path, { tasks: [] });
    const merged = mergeTaskLedger(current?.tasks, tasks);
    this.writeJson(path, { tasks: merged });
    // Cards the app itself marks Done count as seen Done.
    // What the app writes is what the guard knows: Done cards and where each
    // open card stands, so a restore never brings back a copy from before it.
    const guard = this.guardState();
    const now = new Date().toISOString();
    for (const t of merged as HiveTask[]) {
      if (!t || typeof t.id !== 'string') continue;
      if (t.status === 'done') { guard.done[t.id] = t as unknown as GuardCard; delete guard.placed[t.id]; (guard.doneAt ??= {})[t.id] ??= now; }
      else if (t.status && t.status !== 'triage') guard.placed[t.id] = { ...(t as unknown as GuardCard), status: t.status };
    }
    this.saveGuard();
    this.appendLog({ kind: 'tasks', count: merged.length });
    this.commit(`hive: tasks (${merged.length})`);
  }

  /** Append one card against the latest on-disk ledger. Renderer callers must
   *  use this instead of re-writing a collection they read before another
   *  source (webhook, Slack, god, voice) added work. Idempotent by task id. */
  addTask(task: HiveTask): boolean {
    const ledger = this.tasks() as { tasks?: HiveTask[] };
    const tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
    if (tasks.some((current) => current?.id === task.id)) return false;
    this.writeTasks([...tasks, task]);
    return true;
  }

  /** Patch one card against the latest on-disk ledger, preserving unrelated
   *  cards and fields (notably webhook.tokenHash and Slack thread metadata).
   *  The app closing a card (a mailbox fixed, a voice "done") withdraws its
   *  open questions, so none is left on Ask me for good. */
  patchTask(id: string, patch: Partial<Omit<HiveTask, 'id'>>): boolean {
    const ledger = this.tasks() as { tasks?: HiveTask[] };
    const tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
    const index = tasks.findIndex((task) => task?.id === id);
    if (index < 0) return false;
    const next = tasks.slice();
    if (patch.status === 'done' && !('humanQA' in patch) && tasks[index].status !== 'done') {
      const settled = withdrawnOnClose(tasks[index].humanQA, new Date().toISOString());
      if (settled) patch = { ...patch, humanQA: settled };
    }
    // The app moving a Done card on (the owner's reopen, a mailbox that broke
    // again) is allowed; agents write the file directly and never pass here.
    next[index] = { ...tasks[index], ...patch, id };
    this.writeTasks(next);
    // Forgotten as Done only once the move is on disk.
    if (patch.status && patch.status !== 'done' && tasks[index].status === 'done') {
      delete this.guardState().done[id];
      delete this.guardState().doneAt?.[id];
      this.saveGuard();
    }
    return true;
  }

  /** The owner moves a card (Task detail, voice). Moving it to Done is the
   *  owner's decision to end it (D2); moving it out of Done clears that. Michael
   *  is told either way: he orchestrates, the app only records the change. The
   *  owner never moves a card to Blocked: Blocked means a question waits for
   *  them on Ask me, which only Michael raises (ship 2026-10-03). */
  ownerMoveTask(id: string, status: HiveTask['status'], reason?: string): boolean {
    // Blocked and Waiting are Michael's: one needs a question on Ask me, the
    // other who the card waits on.
    if (status === 'blocked' || status === 'waiting') return false;
    const ledger = this.tasks() as { tasks?: HiveTask[] };
    const card = (Array.isArray(ledger?.tasks) ? ledger.tasks : []).find((t) => t?.id === id);
    // A card in triage is Michael's until he releases it; the owner never sees it.
    if (!card || card.status === 'triage') return false;
    if (status === 'done') {
      if (card.status === 'done') return true;
      // An agent just moved it out of Done: put it back, not the owner's close.
      // As it was Done, like the tick's put back: only a question asked meanwhile stays.
      const was = this.guardState().done[id];
      if (was) return this.patchTask(id, restoreDone(was, card as unknown as GuardCard) as unknown as Partial<HiveTask>);
      return this.ownerCloseTask(id);
    }
    // Out of Done only to correct a card marked done by mistake: into To do,
    // with the owner's reason (card-lifecycle.md section 10).
    const why = reason?.trim().slice(0, 500);
    // Done as the app last saw it counts too: an agent may have moved the card
    // since, and the next tick would put it back.
    const wasDone = card.status === 'done' || !!this.guardState().done[id];
    if (wasDone && (status !== 'todo' || !why)) return false;
    const from = wasDone ? 'done' : card.status;
    // A card out of Done no longer has a result: none of it is sent or shown
    // as the outcome until the work finishes again.
    if (!this.patchTask(id, { status, waitingOn: undefined, closedBy: undefined, closedAt: undefined, closedReason: undefined, ...(wasDone ? { result: undefined } : {}) })) return false;
    if (wasDone && card.status !== 'done') { delete this.guardState().done[id]; this.saveGuard(); }
    // A reopen used to leave no trace; Pulse counts it against kept as is (E2).
    if (wasDone) this.appendLog({ kind: 'card-reopen', id, agentId: card.assignee ?? null, by: 'owner' });
    if (from !== status) this.tellGodOwnerChange(card, { kind: 'moved', from, to: status, ...(why ? { reason: why } : {}) });
    return true;
  }

  /** The owner ends a card: Done, marked as the owner's decision, never deleted
   *  (D2). The Tasks view dismiss and the voice delete both land here. */
  ownerCloseTask(id: string, reason?: string): boolean {
    const ledger = this.tasks() as { tasks?: HiveTask[] };
    const card = (Array.isArray(ledger?.tasks) ? ledger.tasks : []).find((t) => t?.id === id);
    // A card in triage is Michael's until he releases it; the owner never sees it.
    if (!card || card.status === 'triage') return false;
    const now = new Date().toISOString();
    const patch: Partial<Omit<HiveTask, 'id'>> = { status: 'done', closedBy: 'owner', closedAt: now };
    if (reason?.trim()) patch.closedReason = reason.trim().slice(0, 500);
    // The owner ending the card settles its open questions: they leave Ask me,
    // marked withdrawn, and stay on the card as history.
    const settled = withdrawnOnClose(card.humanQA, now);
    if (settled) patch.humanQA = settled;
    if (!this.patchTask(id, patch)) return false;
    this.tellGodOwnerChange(card, { kind: 'closed', reason: patch.closedReason });
    return true;
  }

  /**
   * The owner deleted a team member for good (owner, 2026-10-14). Their open
   * Ask me questions leave Ask me, withdrawn and kept on the card as history,
   * like a closed card's. Their cards stay theirs on the board: Michael owns
   * every card, so he hears once, with the open ones, and gives each to
   * someone else or closes it.
   */
  memberDeleted(id: string): { withdrawn: number; cards: number } {
    const reg = this.registry();
    const godId = reg.godId;
    if (!id || id === godId || id === RESEARCH_ID || !reg.agents[id] || reg.agents[id].isAssistant) return { withdrawn: 0, cards: 0 };
    const ledger = this.tasks() as { tasks?: HiveTask[] };
    const tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
    const now = new Date().toISOString();
    let withdrawn = 0;
    const theirs: HiveTask[] = [];
    for (const t of tasks) {
      if (!t?.id) continue;
      // Who raised an ask: the same rule as openQuestionsRaisedBy.
      const mine = openAskIndexes(t.humanQA).filter((i) => (t.humanQA![i].raisedBy ?? t.assignee) === id);
      if (mine.length) {
        const humanQA = t.humanQA!.map((e, i) => (mine.includes(i) ? { ...e, dismissedAt: now, dismissedBy: 'member-deleted' as const } : e));
        if (this.patchTask(t.id, { humanQA })) withdrawn += mine.length;
      }
      if (t.status !== 'done' && (t.assignee === id || mine.length)) theirs.push(t);
    }
    // Filings they made that Michael has not worked yet are set aside, so no
    // new question is ever asked for someone the owner deleted.
    let setAside = 0;
    const root = this.root();
    const triage = root ? join(root, 'triage') : null;
    if (triage && existsSync(triage)) {
      for (const f of readdirSync(triage).filter((x) => x.endsWith('.json'))) {
        try {
          const raw = JSON.parse(readFileSync(join(triage, f), 'utf8')) as { filedBy?: unknown };
          if (raw.filedBy !== id) continue;
          mkdirSync(join(triage, '.done'), { recursive: true });
          renameSync(join(triage, f), join(triage, '.done', f));
          setAside++;
        } catch { /* unreadable or moved meanwhile: Michael works it as usual */ }
      }
    }
    this.retireHookToken(id);
    if (godId && (theirs.length || withdrawn || setAside)) {
      const note = memberDeletedNote({ id, name: reg.agents[id]?.name }, theirs, withdrawn, setAside);
      try {
        this.send({ to: godId, act: 'inform', subject: note.subject, body: note.body }, 'human');
      } catch { /* the questions are withdrawn; Michael sees the cards on the board */ }
    }
    this.appendLog({ kind: 'member-deleted', agentId: id, withdrawn, cards: theirs.length, setAside });
    return { withdrawn, cards: theirs.length };
  }

  private tellGodOwnerChange(card: HiveTask, change: OwnerCardChange): void {
    const godId = this.registry().godId;
    if (!godId) return;
    const note = ownerChangeNote(card, change);
    try {
      this.send({ to: godId, act: 'inform', subject: note.subject, body: note.body, conversation: cardConversation(card.id) }, 'human');
    } catch { /* the card change stands; Michael sees it on the board */ }
  }

  memory(id: string): string {
    // Research's notes are web text it writes itself: the owner, the voice
    // assistant and search see them only as the cleaned copy in the shared
    // memory (owner, third ship D3).
    if (!this.root() || id === RESEARCH_ID) return '';
    const p = join(this.agentDir(id), 'memory.md');
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  /** The Memory tab's read: the index plus how many notes wait in
   *  memory/inbox.md for the next tidy-up (docs/designs/memory-tab-readable.md). */
  memoryDetail(id: string): { index: string; waiting: number } {
    if (!/^[\w-]+$/.test(id) || !this.root() || id === RESEARCH_ID) return { index: '', waiting: 0 };
    const inbox = join(this.agentDir(id), 'memory', 'inbox.md');
    let waiting = 0;
    try { if (existsSync(inbox)) waiting = parseInbox(readFileSync(inbox, 'utf8')).length; } catch { /* count stays 0 */ }
    return { index: this.memory(id), waiting };
  }
  /** One procedure's steps, for the Memory tab. Only an app-written slug inside
   *  that agent's procedures folder; null when there's no such file. */
  procedure(id: string, slug: string): string | null {
    if (!/^[\w-]+$/.test(id) || !isProcedureSlug(slug) || !this.root()) return null;
    const p = join(this.agentDir(id), 'memory', 'procedures', `${slug}.md`);
    if (id === RESEARCH_ID) return null;
    try { return existsSync(p) ? readFileSync(p, 'utf8').slice(0, MAX_PROCEDURE_CHARS) : null; } catch { return null; }
  }
  /** Whether an agent has recorded NON-TRIVIAL memory — i.e. has appended real
   *  notes beyond the boilerplate header ensureAgent seeds. Lets the voice
   *  read-layer answer "what has the team remembered" and enumerate who has
   *  anything worth reading (every registered agent technically has a memory.md,
   *  but most of the floor's history lives in a handful of them). Cheap: reads a
   *  small markdown file; never throws. Works for ANY id, active OR archived. */
  hasMemory(id: string): boolean {
    if (!this.root() || id === RESEARCH_ID) return false;
    const p = join(this.agentDir(id), 'memory.md');
    if (!existsSync(p)) return false;
    try {
      const text = readFileSync(p, 'utf8');
      const { isIndex, entries } = parseIndex(text);
      // An index has memory once it has entries; an older free-form file once
      // it holds more than the seeded header.
      return isIndex ? entries.length > 0 : text.trim().length > 200;
    } catch { return false; }
  }

  /**
   * An agent's memory index as it is given the agent at the start of each
   * session (owner, 2026-09-25): the entries only, labelled, or null when there
   * are none yet (or the file is still in the older free-form shape, which the
   * tidy-up migrates). Fixed for the session, so it caches.
   */
  /**
   * The owner's answer to a question an agent raised on Ask me, added to that
   * agent's memory notes as coming from the owner (owner, 2026-09-25). The
   * tidy-up keeps the part that lasts (a rule, a preference) and drops what
   * only mattered once. False when the agent isn't one of this office's.
   */
  rememberOwnerAnswer(id: string, task: string, q: string, a: string): boolean {
    if (!/^[\w-]+$/.test(id) || !this.root()) return false;
    // Never written straight into Research's memory: it reaches Research as a
    // message through the trust layer, like everything else (ship review D2.2).
    if (id === RESEARCH_ID) {
      this.send({ to: RESEARCH_ID, act: 'inform', subject: `The owner answered: ${task.slice(0, 120)}`, body: `Q: ${q}\nA: ${a}` }, 'human');
      return true;
    }
    const dir = this.agentDir(id);
    if (!existsSync(dir)) return false;
    const line = (v: string) => v.replace(/\s+/g, ' ').trim();
    const today = localDay(new Date().toISOString());
    const note = `- From the owner (${today}), answering a question on "${line(task)}": Q: ${line(q)} A: ${line(a)}\n`;
    try {
      mkdirSync(join(dir, 'memory'), { recursive: true });
      appendFileSync(join(dir, 'memory', 'inbox.md'), note, 'utf8');
      return true;
    } catch { return false; }
  }

  /**
   * A line from the owner for an agent's memory notes, already worded (Send on
   * approval: an edit, a note, or "do not send"; shared/mailProposals.ts).
   * False when the agent isn't one of this office's.
   */
  rememberOwnerNote(id: string, line: string): boolean {
    if (!/^[\w-]+$/.test(id) || !this.root()) return false;
    if (id === RESEARCH_ID) {
      this.send({ to: RESEARCH_ID, act: 'inform', subject: 'A note from the owner', body: line }, 'human');
      return true;
    }
    const dir = this.agentDir(id);
    if (!existsSync(dir)) return false;
    try {
      mkdirSync(join(dir, 'memory'), { recursive: true });
      appendFileSync(join(dir, 'memory', 'inbox.md'), line.endsWith('\n') ? line : `${line}\n`, 'utf8');
      return true;
    } catch { return false; }
  }

  // — clearing a conversation safely (src/shared/safeClear.ts) —

  /** Task cards assigned to an agent that aren't done. A foundation card
   *  waits on the owner, not the member's work, so it never holds a clear
   *  (the answer reaches the member through its foundations section). */
  openCardsFor(id: string): number {
    const ledger = this.tasks() as { tasks?: HiveTask[] };
    const tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
    return tasks.filter((t) => t?.assignee === id && t.status !== 'done' && !(t.humanQA ?? []).some((e) => foundationAsk(e as FoundationAskShape))).length;
  }

  /** Ask me questions an agent raised (or, unrecorded, on its card) still
   *  unanswered; foundation questions left out, as in openCardsFor. */
  openQuestionsRaisedBy(id: string): number {
    const ledger = this.tasks() as { tasks?: HiveTask[] };
    const tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
    let n = 0;
    for (const t of tasks) {
      // Every unanswered, unwithdrawn ask is open (askMeRouting.ts).
      for (const i of openAskIndexes(t?.humanQA)) if (!foundationAsk(t.humanQA![i] as FoundationAskShape) && (t.humanQA![i].raisedBy ?? t.assignee) === id) n++;
    }
    return n;
  }

  /** Michael's open requests from the owner, as of the last refresh. */
  private ownerRequestsCache: OwnerRequest[] = [];
  /** Blocked cards with nothing asked, as of the last refresh. */
  private stuckCardsCache: StuckCard[] = [];
  /** What the app keeps true about the board (shared/cardGuards.ts): the
   *  cards it saw Done, where each open card was, and the reminders it sent.
   *  Kept in the private folder; null until the first tick loads it. */
  private guard: GuardState | null = null;
  /** Waiting cards past their check back time, for Michael's list (guardBoard). */
  private goneQuiet: StuckCard[] = [];
  /** The guard state's signature as last saved, so a quiet tick writes nothing. */
  private guardSaved = '';
  /** Team members' filings waiting in triage/, oldest first, as of the last tick. */
  private filingsCache: StuckCard[] = [];
  private filingCache = new Map<string, { mtimeMs: number; filing: { title: string; filedBy?: string; filedAt: string } | null }>();
  /** Owner questions from the dock Michael still owes (michael-replies.md). */
  private ownerQuestionsCache: OpenOwnerQuestion[] = [];
  /** Whether an owner message is one the owner really sent (the dock's check,
   *  set by main), so a forged file never reaches Michael as theirs (ship D4). */
  private ownerMessageCheck: (m: ThreadMessage) => boolean = () => true;
  setOwnerMessageCheck(check: (m: ThreadMessage) => boolean): void { this.ownerMessageCheck = check; }

  private guardFile(): string | null {
    const home = this.getHome();
    return home ? join(privateRoot(home), 'card-guard.json') : null;
  }

  /** The office this state belongs to: a random id kept in the hive folder,
   *  so a new office never gets an old one's cards, while moving or restoring
   *  the folder keeps it. */
  private hiveIdentity(): string {
    const root = this.root();
    if (!root) return '';
    const file = join(root, '.office-id');
    try {
      const id = readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{16,64}$/.test(id)) return id;
    } catch { /* first look at this office */ }
    const id = randomBytes(16).toString('hex');
    try { writeFileSync(file, `${id}\n`); } catch { /* tried again next time */ }
    return id;
  }

  private saveGuard(): void {
    const file = this.guardFile();
    if (!file || !this.guard) return;
    const text = guardSignature(this.guard);
    if (text === this.guardSaved) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      this.atomicWriteJson(file, this.guard);
      this.guardSaved = text;
    } catch { /* tried again on the next tick */ }
  }

  private guardState(): GuardState {
    return (this.guard ??= this.loadGuard());
  }

  private loadGuard(): GuardState {
    const hive = this.hiveIdentity();
    const file = this.guardFile();
    if (file) {
      try {
        const text = readFileSync(file, 'utf8');
        const st = JSON.parse(text) as GuardState;
        if (st && st.hive === hive && st.done && st.placed && st.reminders) { this.guardSaved = guardSignature(st); return st; }
      } catch { /* none yet: start from what the board shows now */ }
    }
    return emptyGuardState(hive);
  }

  /**
   * The fleet tick's board guard (shared/cardGuards.ts): put back a Done card
   * an agent reopened or deleted, move a card back out of Triage, and send the
   * reminders whose time has come. Michael is told of each fix. Skips a board
   * it cannot read, such as one an agent is writing this moment.
   */
  private guardBoard(): void {
    const root = this.root();
    if (!root) return;
    // Read strictly: a board that does not parse is never taken as empty.
    const readBoard = (): unknown[] | null => {
      try {
        const raw = JSON.parse(readFileSync(join(root, 'tasks.json'), 'utf8')) as { tasks?: unknown };
        return Array.isArray(raw?.tasks) ? raw.tasks : null;
      } catch { return null; }
    };
    const tasks = readBoard();
    if (!tasks) return;
    const before = this.guardState();
    const fixed = guardCards(tasks, before);
    // guardCards builds its state without the Waiting clocks: carry them over
    // before any save, so the file never lacks them and a quiet tick writes nothing.
    const next: GuardState = { ...fixed.state, ...(before.waiting ? { waiting: before.waiting } : {}) };
    const godId = this.registry().godId;
    // Every note and reminder of one tick shares one commit, so a restart
    // with many overdue steps never stalls the app on a commit per message.
    let sent = 0;
    const post = (partial: Partial<HiveMessage>): HiveMessage => {
      const msg = this.normalize(partial, 'system');
      this.routeMessage(msg);
      sent++;
      return msg;
    };
    const tell = (note: { subject: string; body: string }, cardId: string): void => {
      if (!godId) return;
      try { post({ to: godId, act: 'inform', subject: note.subject, body: note.body, conversation: cardConversation(cardId) }); } catch { /* the fix stands either way */ }
    };
    if (fixed.changed) {
      // Fix the board as it is now, not the copy read above: only the fixed
      // cards change, and everything else, a card added since included, stays.
      // A board being written this moment waits for the next tick.
      const now = readBoard();
      if (!now) return;
      this.guard = next;
      this.writeTasks(applyGuardFixes(now, fixed.fixes, fixed.restored) as HiveTask[]);
      for (const r of fixed.reopened) tell(reopenedNote(r.card, r.to, r.openAsk), r.card.id);
      for (const t of fixed.restored) tell(restoredDoneNote(t), t.id);
      for (const u of fixed.untriaged) tell(untriagedNote(u.card, u.to), u.card.id);
    }
    this.guard = next;
    const reg = this.registry();
    const godName = resolveGodName(reg.agents[godId ?? 'god']?.name);
    const reminders = dueReminders(tasks.map((t) => {
      const id = (t as GuardCard | null)?.id;
      return typeof id === 'string' && fixed.fixes[id] ? { ...(t as GuardCard), ...fixed.fixes[id] } : t;
    }) as GuardCard[], this.guard.reminders, Date.now());
    // The card's person, while they are on the team; otherwise Michael.
    const personOf = (t: GuardCard): string | null => {
      const a = t.assignee ? reg.agents[t.assignee] : undefined;
      return a && !a.archived && !a.isAssistant ? t.assignee! : null;
    };
    // Record each reminder as sent before it goes out, so a crash between the
    // two never sends it twice; a lost one is still caught by the backstop.
    const prev = this.guard.reminders;
    if (!godId) for (const t of reminders.backstop) reminders.reminders[t.id] = { ...reminders.reminders[t.id], backstopSentAt: undefined };
    this.guard.reminders = reminders.reminders;
    this.saveGuard();
    for (const t of reminders.due) {
      const person = personOf(t);
      const to = person ?? godId;
      const unsent = (): void => {
        if (prev[t.id]) reminders.reminders[t.id] = prev[t.id];
        else delete reminders.reminders[t.id];
      };
      if (!to) { unsent(); continue; } // nobody to tell yet: tried again next tick
      const note = nextStepDueNote(t, godName, !person ? 'nobody' : person === godId ? 'own' : 'person');
      try {
        const msg = post({ to, act: 'inform', subject: note.subject, body: note.body, conversation: cardConversation(t.id) });
        // Named in the backstop only when it really reached them.
        if (person && person !== godId && this.lastRouted?.id === msg.id && this.lastRouted.delivered.includes(person)) {
          reminders.reminders[t.id] = { ...reminders.reminders[t.id], to: reg.agents[person]?.name || person };
        }
      } catch { unsent(); }
    }
    if (godId) for (const t of reminders.backstop) tell(nextStepBackstopNote(t, reminders.reminders[t.id]?.to), t.id);
    // Waiting cards come back (card-lifecycle.md section 8): Michael is told
    // once when a check back time comes, and keeps a gone quiet list while
    // the card stays overdue. Without him the clock waits for the next tick.
    if (godId) {
      const now = Date.now();
      const quiet = waitingChecks(tasks.map((t) => {
        const id = (t as GuardCard | null)?.id;
        return typeof id === 'string' && fixed.fixes[id] ? { ...(t as GuardCard), ...fixed.fixes[id] } : t;
      }) as GuardCard[], before.waiting ?? {}, now);
      this.guard.waiting = quiet.waiting;
      this.goneQuiet = quiet.overdue
        .sort((a, b) => Date.parse(a.clock.since) - Date.parse(b.clock.since))
        .map(({ card, clock }) => ({
          id: card.id, title: String(card.title ?? card.id).trim() || card.id,
          ...(card.assignee ? { assignee: card.assignee } : {}), issue: 'gone-quiet' as const,
          quiet: { ...(typeof card.waitingOn === 'string' ? { waitingOn: card.waitingOn } : {}), since: clock.since, followUps: clock.followUps }
        }));
      // Recorded as told before it goes out, so a crash never sends it twice.
      this.saveGuard();
      for (const d of quiet.due) tell(waitingDueNote(d.card, d.clock, d.askOwner, now), d.card.id);
    }
    if (sent) this.commit(`hive: board guard (${sent} message${sent === 1 ? '' : 's'})`);
    this.saveGuard();
  }

  /** Team members' filings waiting in triage/ (card-lifecycle.md section 10),
   *  oldest first by when they were filed. Each file is read once until it
   *  changes; one still being written is read on a later tick. */
  private pendingFilings(): StuckCard[] {
    const root = this.root();
    const dir = root ? join(root, 'triage') : null;
    if (!dir || !existsSync(dir)) return [];
    const out: Array<StuckCard & { at: string }> = [];
    const live = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const p = join(dir, f);
      live.add(p);
      let mtimeMs = 0;
      try { mtimeMs = statSync(p).mtimeMs; } catch { continue; }
      let hit = this.filingCache.get(p);
      if (!hit || hit.mtimeMs !== mtimeMs) {
        let filing: { title: string; filedBy?: string; filedAt: string } | null = null;
        try {
          const raw = JSON.parse(readFileSync(p, 'utf8')) as { title?: unknown; filedBy?: unknown };
          filing = {
            title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : f,
            ...(typeof raw.filedBy === 'string' && raw.filedBy ? { filedBy: raw.filedBy } : {}),
            // Ordered by when the file was written (written once, so its time
            // is the filing's): a "filedAt" an agent typed cannot jump the queue.
            filedAt: new Date(mtimeMs).toISOString()
          };
        } catch {
          if (Date.now() - mtimeMs < HiveManager.OUTBOX_WRITE_GRACE_MS) continue;
          filing = { title: f, filedAt: new Date(mtimeMs).toISOString() };
        }
        hit = { mtimeMs, filing };
        this.filingCache.set(p, hit);
      }
      if (hit.filing) out.push({ id: f, title: hit.filing.title, ...(hit.filing.filedBy ? { assignee: hit.filing.filedBy } : {}), issue: 'filing', at: hit.filing.filedAt });
    }
    for (const p of this.filingCache.keys()) if (!live.has(p)) this.filingCache.delete(p);
    return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1)).map(({ at: _at, ...c }) => c);
  }

  /**
   * Recompute Michael's open requests from the owner
   * (docs/designs/card-lifecycle.md): owner answers he has not closed with a
   * reply. Run on the fleet tick so a prompt never scans folders; reads his
   * mail from OWNER_REQUESTS_FLOOR on.
   */
  refreshOwnerRequests(): OwnerRequest[] {
    if (!this.root()) return (this.ownerRequestsCache = []);
    const dir = this.agentDir(this.registry().godId ?? 'god');
    // A fixed floor, not a rolling window, so an open request never ages out
    // (TODOS.md; michael-replies.md); requests settled before it stay settled.
    const since = OWNER_REQUESTS_FLOOR;
    const toMichael = [...this.ownerMessages(join(dir, 'inbox'), since), ...this.ownerMessages(join(dir, 'inbox', '.done'), since)];
    const fromMichael = [...this.ownerMessages(join(dir, 'outbox'), since), ...this.ownerMessages(join(dir, 'outbox', '.sent'), since)];
    const aliases = this.ownerAliases();
    this.ownerQuestionsCache = openOwnerQuestions(toMichael, fromMichael, aliases, this.ownerMessageCheck);
    try { this.guardBoard(); } catch (e) { console.error('[hive] board guard:', e); }
    const raw = this.tasks() as { tasks?: unknown };
    const tasks = Array.isArray(raw?.tasks) ? (raw.tasks as CardLike[]) : [];
    try { this.tasksObserver?.(tasks); } catch (e) { console.error('[hive] tasks observer:', e); }
    // A card that has ended (Done, or closed by the owner) needs no routing,
    // unless the owner answered after it closed: an open question stays on Ask
    // me on a Done card, and that answer is still Michael's to route. The time
    // is the owner's close (closedAt), else when the app first saw the card
    // Done, so a card Michael marked Done keeps an answer given after it.
    const doneAt = this.guardState().doneAt ?? {};
    const closedAt = new Map(tasks.filter((t) => t?.status === 'done').map((t) => [t.id, (t as { closedAt?: unknown }).closedAt ?? doneAt[t.id]]));
    this.ownerRequestsCache = openOwnerRequests(toMichael, fromMichael, aliases).filter((r) => {
      if (!closedAt.has(r.taskId)) return true;
      const at = closedAt.get(r.taskId);
      return typeof at === 'string' && r.createdAt > at;
    });
    // The same tick finds Blocked cards nothing is moving (card-lifecycle.md
    // section 7): no open ask, no open owner request; and open questions held
    // the wrong way, off Blocked or several on one card.
    try { this.filingsCache = this.pendingFilings(); } catch (e) { console.error('[hive] triage filings:', e); }
    // A list-style ask is flagged only when written since the reminder first
    // ran here, so asks already on the board keep their look (ask-me-options.md, 1A).
    this.stuckCardsCache = [...blockedWithNothingAsked(tasks, this.ownerRequestsCache), ...this.goneQuiet, ...asksToTidy(tasks, this.askListSince())];
    return this.ownerRequestsCache;
  }

  /** Parsed message fields by file path. A file in inbox/.done or outbox/.sent
   *  never changes, so each is read once, not on every fleet tick. */
  private messageCache = new Map<string, MessageLike | null>();

  /** The messages in `dir` created at or after `sinceIso` (all when omitted),
   *  oldest first. Filtered by each message's own time, not its file name:
   *  agents name their outbox files freely. */
  private ownerMessages(dir: string, sinceIso?: string): MessageLike[] {
    if (!existsSync(dir)) return [];
    const out: MessageLike[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const p = join(dir, f);
      let m = this.messageCache.get(p);
      if (m === undefined) {
        try {
          const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<HiveMessage>;
          // An agent's own outbox file often has no created_at (the router adds
          // it in memory; the archived copy keeps the raw file): use its time.
          const at = typeof raw.created_at === 'string' && raw.created_at ? raw.created_at : new Date(statSync(p).mtimeMs).toISOString();
          // Sent copies archived before the app stamped them have no id: the
          // file name stands in, so each still has its own one to answer.
          m = { id: String(raw.id ?? '') || `sent-${f.slice(0, -'.json'.length)}`, from: String(raw.from ?? ''), act: String(raw.act ?? ''), conversation: raw.conversation, in_reply_to: raw.in_reply_to, subject: raw.subject, created_at: at, to: raw.to, answeredAt: answeredAtOf(raw.body) };
          // The owner's conversation needs the words (michael-replies.md); other
          // mail keeps only its envelope in memory.
          const ownerSide = raw.from === 'human' || OWNER_ALIASES.has(String(raw.to ?? '').toLowerCase()) || !!ownerQuestionOf(raw.conversation);
          if (ownerSide) {
            const t = m as ThreadMessage;
            if (typeof raw.body === 'string') t.body = raw.body;
            if (typeof raw.expect_by === 'string') t.expect_by = raw.expect_by;
            if (typeof raw.waiting_on === 'string') t.waiting_on = raw.waiting_on;
            if (raw.from_notes === true) t.from_notes = true;
          }
        } catch { m = null; }
        // A file still being written is read again next time.
        if (m || Date.now() - (statSync(p).mtimeMs || 0) > HiveManager.OUTBOX_WRITE_GRACE_MS) this.messageCache.set(p, m);
      }
      if (m && (!sinceIso || m.created_at >= sinceIso)) out.push(m);
    }
    return out;
  }

  ownerRequests(): OwnerRequest[] {
    return this.ownerRequestsCache;
  }

  ownerQuestions(): OpenOwnerQuestion[] {
    return this.ownerQuestionsCache;
  }

  /** Names that reach the owner, Michael's display name included. */
  private ownerAliases(): Set<string> {
    const reg = this.registry();
    return new Set([...OWNER_ALIASES, resolveGodName(reg.agents[reg.godId ?? 'god']?.name).toLowerCase()]);
  }

  // — the owner's conversation with Michael (docs/designs/michael-replies.md) —
  // Under <harnessHome>/private/owner/ (#63), written only by the app: R4 and R5
  // of the engineering review. agents/human/ is no longer the home for these.

  private ownerSentDir(): string {
    const home = this.getHome();
    if (!home) throw new Error('no harnessHome');
    return privateOwnerSentDir(home);
  }
  /** Moves any message file found in the owner's outbox aside, unrouted. */
  private rejectOwnerOutbox(outbox: string): void {
    try {
      if (!existsSync(outbox)) return;
      const stray = readdirSync(outbox).filter((f) => f.endsWith('.json'));
      if (!stray.length) return;
      const rejected = join(outbox, '.rejected');
      mkdirSync(rejected, { recursive: true });
      for (const f of stray) {
        renameSync(join(outbox, f), join(rejected, f));
        this.appendLog({ kind: 'drop', reason: 'owner-outbox-not-routed', file: f });
      }
    } catch { /* best-effort */ }
  }

  /** Whether an id is a question the owner asked in the dock. */
  private isOwnerQuestion(id: string): boolean {
    return /^[\w.-]+$/.test(id) && !!this.root() && existsSync(join(this.ownerSentDir(), `${id}.json`));
  }
  private askListSinceAt: { home: string; at: number } | null = null;
  /** When this office first ran with the list-style ask reminder. Saved once,
   *  so a restart never lets a list written before it go unflagged. */
  private askListSince(): number {
    const home = this.getHome();
    if (!home) return this.startedAt;
    if (this.askListSinceAt?.home === home) return this.askListSinceAt.at;
    const path = join(privateRoot(home), 'ask-list-since.json');
    let at = NaN;
    try { at = Date.parse((JSON.parse(readFileSync(path, 'utf8')) as { since?: string }).since ?? ''); } catch { /* first run */ }
    if (!Number.isFinite(at)) {
      at = this.startedAt;
      try { mkdirSync(dirname(path), { recursive: true }); this.atomicWriteJson(path, { since: new Date(at).toISOString() }); } catch (e) { console.error('[hive] ask list since:', e); }
    }
    this.askListSinceAt = { home, at };
    return at;
  }

  private ownerStatePath(): string {
    const home = this.getHome();
    if (!home) throw new Error('no harnessHome');
    return privateOwnerStatePath(home);
  }

  /**
   * One-time move of owner dock files out of `hive/agents/human/` (#63). Safe
   * to call on every ensureHive: skips when the private copy already exists or
   * the legacy path is empty.
   */
  private migrateOwnerPrivate(): void {
    const home = this.getHome();
    const root = this.root();
    if (!home || !root) return;
    const moveTree = (from: string, to: string): void => {
      if (!existsSync(from)) return;
      if (existsSync(to)) {
        // Private copy already won; drop the legacy leftover so agents cannot
        // keep writing into the old agents/human path.
        try { rmSync(from, { recursive: true, force: true }); } catch { /* best-effort */ }
        return;
      }
      try {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      } catch {
        try {
          cpSync(from, to, { recursive: true });
          rmSync(from, { recursive: true, force: true });
        } catch (e) { console.error('[hive] migrate owner private:', e); }
      }
    };
    moveTree(legacyOwnerSentDir(root), privateOwnerSentDir(home));
    moveTree(legacyOwnerStatePath(root), privateOwnerStatePath(home));
  }

  /** The dock's facts. An unreadable file is rebuilt as everything read and
   *  already notified, so a bad file never repeats a notification (R5). */
  ownerState(): OwnerDockState {
    const path = this.ownerStatePath();
    if (!existsSync(path)) return { requests: {} };
    try {
      const v = JSON.parse(readFileSync(path, 'utf8')) as OwnerDockState;
      if (v && typeof v === 'object' && v.requests && typeof v.requests === 'object') return v;
    } catch { /* rebuilt below */ }
    const now = Date.now();
    const dock = this.ownerDockRaw({ requests: {} }, now);
    const requests: Record<string, OwnerRequestFlags> = {};
    const godDone = join(this.agentDir(this.registry().godId ?? 'god'), 'inbox', '.done');
    for (const it of dock.items) {
      // One not handed to Michael can't be told apart from a withdrawn one:
      // it reads Not sent, with Try again, never as live traffic (Codex P2).
      if (it.kind === 'owner') requests[it.id] = { readAt: now, notified: [], ...(existsSync(join(godDone, `${it.id}.json`)) ? { deliveredAt: now } : { notSentAt: now }) };
    }
    for (const it of dock.items) if (it.kind === 'michael' && requests[it.replyTo]) requests[it.replyTo].notified!.push(it.id);
    const rebuilt = { requests };
    try { this.writeOwnerState(rebuilt); } catch { /* read only use */ }
    return rebuilt;
  }

  private writeOwnerState(state: OwnerDockState): void {
    mkdirSync(dirname(this.ownerStatePath()), { recursive: true });
    this.atomicWriteJson(this.ownerStatePath(), state);
  }

  /** Change one request's facts. */
  private ownerFlags(id: string, change: (f: OwnerRequestFlags) => OwnerRequestFlags): OwnerRequestFlags {
    const state = this.ownerState();
    const next = change({ ...(state.requests[id] ?? {}) });
    state.requests[id] = next;
    this.writeOwnerState(state);
    return next;
  }

  /**
   * A question the owner asked in the dock (R1, R4, R6): filed as the owner's
   * sent mail now; the renderer hands it to Michael as a work order and calls
   * ownerDelivered when it is typed. A reply to Michael's question carries its
   * id in `inReplyTo` and stays in that conversation.
   */
  ownerAsk(input: { text: string; inReplyTo?: string; conversation?: string }): HiveMessage | null {
    const root = this.root();
    const text = String(input.text ?? '').trim();
    if (!root || !text) return null;
    const godId = this.registry().godId ?? 'god';
    const id = `${stamp()}-${shortRand()}`;
    const msg = this.normalize({
      id, to: godId, act: 'request', requires_reply: true,
      conversation: input.conversation && ownerQuestionOf(input.conversation) ? input.conversation : ownerConversation(id),
      in_reply_to: input.inReplyTo ?? null,
      subject: text.replace(/\s+/g, ' ').slice(0, 120), body: text
    }, 'human');
    mkdirSync(this.ownerSentDir(), { recursive: true });
    this.atomicWriteJson(join(this.ownerSentDir(), `${id}.json`), msg);
    this.ownerFlags(id, (f) => f);
    return msg;
  }

  /** The work order was typed into Michael's terminal: he has it (R6). His copy
   *  is filed as handled, so it is in his open questions from now on. */
  ownerDelivered(id: string): boolean {
    const path = join(this.ownerSentDir(), `${id}.json`);
    if (!/^[\w.-]+$/.test(id) || !existsSync(path)) return false;
    // A question the owner withdrew while it waited to be typed is never
    // handed to Michael (the drain can race the withdraw).
    const flags = this.ownerState().requests[id];
    if (flags?.withdrawnAt) return false;
    // Claimed once, before it is typed (Codex P1): a second claim is a no-op.
    if (flags?.deliveredAt) return true;
    const msg = this.readJson<HiveMessage | null>(path, null);
    if (!msg) return false;
    const godId = this.registry().godId ?? 'god';
    const done = join(this.agentDir(godId), 'inbox', '.done');
    mkdirSync(done, { recursive: true });
    this.atomicWriteJson(join(done, `${id}.json`), msg);
    this.ownerFlags(id, (f) => ({ ...f, deliveredAt: f.deliveredAt ?? Date.now(), notSentAt: undefined }));
    // The log is committed with the office: the owner's words stay out of it.
    this.appendLog({ kind: 'message', from: 'human', to: godId, act: msg.act, subject: 'Owner question', id: msg.id, delivered: [godId] });
    this.recordOwnerSaid(msg.id, [godId]);
    this.emitMessage(msg, [godId]);
    try { this.routedObserver?.(msg, [godId]); } catch { /* observer error */ }
    this.refreshOwnerRequests();
    this.commit(`hive: owner question ${id}`);
    return true;
  }

  /** Cancel before Michael has it; refused once he does (R3, R6). */
  ownerWithdraw(id: string): boolean {
    const f = this.ownerState().requests[id];
    if (!f || f.deliveredAt) return false;
    this.ownerFlags(id, (x) => ({ ...x, withdrawnAt: Date.now() }));
    return true;
  }

  /** The queue gave up typing it (7A): "Not sent", with Try again. */
  ownerNotSent(id: string): void {
    this.ownerFlags(id, (f) => (f.deliveredAt ? f : { ...f, notSentAt: Date.now() }));
  }

  /** Try again after Not sent: back to Sent. */
  ownerRetry(id: string): boolean {
    const f = this.ownerState().requests[id];
    if (!f?.notSentAt || f.deliveredAt) return false;
    this.ownerFlags(id, (x) => ({ ...x, notSentAt: undefined }));
    return true;
  }

  /** The owner saw these questions' replies in the open dock (2A). */
  ownerRead(ids: string[], at = Date.now()): void {
    const state = this.ownerState();
    // Read through the newest reply, even one stamped in the future, so a
    // clock that runs ahead never keeps a reply unread (and re-read) forever.
    const newest = new Map<string, number>();
    for (const it of this.ownerConversationView(at).items) {
      if (it.kind !== 'michael') continue;
      const ts = Date.parse(it.at) || 0;
      if (ts > (newest.get(it.replyTo) ?? 0)) newest.set(it.replyTo, ts);
    }
    let changed = false;
    for (const id of ids) {
      if (!state.requests[id]) continue;
      // Never past now plus a little skew, so a reply stamped hours ahead can't
      // hide the real replies that follow it.
      const readAt = Math.max(at, Math.min(newest.get(id) ?? 0, at + OWNER_READ_SKEW_MS));
      if ((state.requests[id].readAt ?? 0) < readAt) { state.requests[id] = { ...state.requests[id], readAt }; changed = true; }
    }
    if (changed) this.writeOwnerState(state);
  }

  /** Records a notification for a reply; false when it already went out (12A). */
  ownerNotify(requestId: string, replyId: string): boolean {
    const f = this.ownerState().requests[requestId];
    if (!f || (f.notified ?? []).includes(replyId)) return false;
    this.ownerFlags(requestId, (x) => ({ ...x, notified: [...(x.notified ?? []), replyId].slice(-50) }));
    return true;
  }

  private ownerDockRaw(state: OwnerDockState, now: number, verified?: (m: ThreadMessage) => boolean): OwnerDock {
    const godDir = this.agentDir(this.registry().godId ?? 'god');
    const ownerSent = this.ownerMessages(this.ownerSentDir()) as ThreadMessage[];
    // Routed replies only: one still in his outbox has no id of its own yet, and a
    // Reply to it would point at an id that changes when it is routed (D14).
    const fromMichael = this.ownerMessages(join(godDir, 'outbox', '.sent')) as ThreadMessage[];
    return ownerDock(ownerSent, fromMichael, state, now, verified, this.ownerAliases());
  }

  /** The owner's conversation with Michael, for the dock. */
  ownerConversationView(now = Date.now(), verified?: (m: ThreadMessage) => boolean): OwnerDock {
    if (!this.root()) return { items: [], open: 0, unread: 0, waitingForYou: 0 };
    return this.ownerDockRaw(this.ownerState(), now, verified);
  }

  /** Remind Michael about one question (6A): Nudge, or the late sweep. At most
   *  once an hour for Nudge; once per question for the sweep. */
  ownerRemind(id: string, kind: 'nudge' | 'late', now = Date.now()): boolean {
    const f = this.ownerState().requests[id];
    if (!f?.deliveredAt || f.withdrawnAt) return false;
    if (kind === 'nudge' && now - (f.nudgedAt ?? 0) < OWNER_NUDGE_EVERY_MS) return false;
    if (kind === 'late' && f.remindedAt) return false;
    const q = this.ownerQuestionsCache.find((x) => x.id === id);
    if (!q) return false;
    const godId = this.registry().godId ?? 'god';
    this.deliver(this.normalize({
      to: godId, act: 'inform',
      subject: kind === 'nudge' ? 'The owner nudged you about a question' : 'An owner question is later than you said',
      body: `${kind === 'nudge' ? 'The owner asked again about' : 'The owner is still waiting on'} id ${id}: ${q.text.replace(/\s+/g, ' ').slice(0, 200)}\nAnswer it with a message "to": "human" and "in_reply_to": "${id}" (done, refuse, query, or inform with a new expect_by).`
    }, 'system'), godId);
    this.ownerFlags(id, (x) => (kind === 'nudge' ? { ...x, nudgedAt: now } : { ...x, remindedAt: now }));
    return true;
  }

  /** Whether this agent sent any message since `ms`: one still waiting in its
   *  outbox, or one routed and filed in outbox/.sent (R8). */
  godSentSince(agentId: string, ms: number): boolean {
    const dir = this.agentDir(agentId);
    try { if (readdirSync(join(dir, 'outbox')).some((f) => f.endsWith('.json'))) return true; } catch { /* no outbox */ }
    const sinceIso = new Date(ms).toISOString();
    return this.ownerMessages(join(dir, 'outbox', '.sent'), sinceIso).some((m) => !(m as ThreadMessage).from_notes);
  }

  /** "Got it" on a report card (14A): the app clears it; nothing goes to
   *  Michael. Only an open report entry can be cleared this way. */
  ackReport(taskId: string, index: number): boolean {
    const ledger = this.tasks() as { tasks?: Array<{ id: string; humanQA?: Array<Record<string, unknown>> }> };
    const card = (Array.isArray(ledger?.tasks) ? ledger.tasks : []).find((t) => t?.id === taskId);
    const e = card?.humanQA?.[index];
    if (!e || e.kind !== 'report' || (typeof e.a === 'string' && e.a.trim()) || (typeof e.dismissedAt === 'string' && e.dismissedAt.trim())) return false;
    const humanQA = card!.humanQA!.map((x, i) => (i === index ? { ...x, dismissedAt: new Date().toISOString(), dismissedReason: 'Got it', dismissedBy: 'owner' } : x));
    return this.patchTask(taskId, { humanQA } as never);
  }

  /** Main is told of each reply Michael sends to an owner question, for the
   *  one notification per final reply (12A). */
  private ownerReplyListener: ((msg: HiveMessage) => void) | null = null;
  /** A member that isn't reporting to the app (issue #326, SD12): its new mail
   *  is held for Michael ('hold'), or reaches it by its terminal when the owner
   *  kept it working unchecked ('handoff'); null flows as usual. Set by index.ts. */
  memberMail: ((agentId: string) => 'hold' | 'handoff' | null) | null = null;
  /** Mail for a member that isn't reporting goes to Michael instead (SD12). */
  /** One copy for Michael per message, naming every member it was held for,
   *  under its own id so it never replaces his own copy of a broadcast or
   *  another held one (ship review 2026-10-17). The note when a member reports
   *  again tells him to send what still needs doing. */
  private holdForMichael(msg: HiveMessage, ids: readonly string[], godId: string): void {
    const reg = this.registry();
    const names = ids.map((t) => (t === RESEARCH_ID ? this.researchName() : reg.agents[t]?.name ?? t));
    for (const t of ids) this.appendLog({ kind: 'message-held-not-reporting', to: t, id: msg.id });
    const who = names.map((n) => `"${n}"`).join(', ');
    const what = names.length === 1
      ? `${who} isn't reporting to the app; route this to someone else, or send it to ${names[0]} again once ${names[0]} reports`
      : `${who} aren't reporting to the app; route this to someone else, or send it to them again once they report`;
    this.deliver({ ...msg, id: `${msg.id}-held`, to: godId, subject: `[held: ${what}] ${msg.subject}` }, godId);
  }
  onOwnerReply(cb: ((msg: HiveMessage) => void) | null): void { this.ownerReplyListener = cb; }

  /** Michael's terminal words for a question his turn sent nothing about
   *  (R8), filed once as his message and recorded so only these show. */
  fileOwnerNotes(id: string, text: string): boolean {
    const words = String(text ?? '').trim();
    const f = this.ownerState().requests[id];
    if (!words || !f?.deliveredAt || (f.notes ?? []).length) return false;
    const godId = this.registry().godId ?? 'god';
    const msg = this.normalize({ to: 'human', act: 'inform', in_reply_to: id, conversation: ownerConversation(id), subject: "From Michael's notes", body: words.slice(0, 4000), from_notes: true }, godId);
    const sent = join(this.agentDir(godId), 'outbox', '.sent');
    mkdirSync(sent, { recursive: true });
    this.atomicWriteJson(join(sent, `${msg.id}.json`), msg);
    this.ownerFlags(id, (x) => ({ ...x, notes: [...(x.notes ?? []), msg.id] }));
    return true;
  }

  /** What Michael has to tidy, filings first. The filings are listed afresh
   *  (each file is read once until it changes), so one he just filed away
   *  never shows from an 8 second old tick. */
  stuckCards(): StuckCard[] {
    let filings = this.filingsCache;
    try { filings = this.filingsCache = this.pendingFilings(); } catch { /* the last tick's list */ }
    return [...filings, ...this.stuckCardsCache];
  }

  /** Answers on cards not yet done with no owner request to Michael since
   *  (card-lifecycle.md section 5). Reads all his mail; run once a launch. */
  ownerAnswersWithoutRequest(): ReturnType<typeof answersWithoutRequest> {
    if (!this.root()) return [];
    const dir = this.agentDir(this.registry().godId ?? 'god');
    const toMichael = [...this.ownerMessages(join(dir, 'inbox')), ...this.ownerMessages(join(dir, 'inbox', '.done'))];
    const raw = this.tasks() as { tasks?: unknown };
    const tasks = Array.isArray(raw?.tasks) ? (raw.tasks as CardLike[]) : [];
    return answersWithoutRequest(tasks, toMichael);
  }

  /** Messages an agent sent in the last day that asked for a reply and haven't
   *  had one: a message back in the same conversation, or one naming it. */
  awaitingReplies(id: string, withinMs = 24 * 60 * 60_000): number {
    const root = this.root();
    if (!root) return 0;
    const dir = this.agentDir(id);
    const since = Date.now() - withinMs;
    const sent = this.listMessages(join(dir, 'outbox', '.sent'))
      .filter((m) => m?.requires_reply && m.to !== 'broadcast' && Date.parse(m.created_at) >= since);
    if (sent.length === 0) return 0;
    const got = [...this.listMessages(join(dir, 'inbox')), ...this.listMessages(join(dir, 'inbox', '.done'))];
    return sent.filter((s) => !got.some((r) =>
      r.in_reply_to === s.id || (r.conversation === s.conversation && r.from === s.to && r.created_at > s.created_at)
    )).length;
  }

  /** Where an agent writes its handoff before a clear. */
  handoffPath(id: string): string {
    return join(this.agentDir(id), 'memory', 'handoff.md');
  }

  /** The handoff, taken once: returned, then archived under memory/handoffs/. */
  takeHandoff(id: string): string | null {
    const p = this.handoffPath(id);
    if (!existsSync(p)) return null;
    try {
      const text = (id === RESEARCH_ID ? (readResearchFile(this.agentDir(id), p) ?? '') : readFileSync(p, 'utf8')).trim();
      // Research's is taken and removed, never moved: a folder it can write
      // could be swapped for a link on the way (red team, third ship).
      if (id === RESEARCH_ID) {
        const mem = this.researchDir('memory');
        if (mem) this.dropResearchEntry(mem, 'handoff.md', 'memory');
        return text || null;
      }
      const archive = join(this.agentDir(id), 'memory', 'handoffs');
      mkdirSync(archive, { recursive: true });
      renameSync(p, join(archive, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
      return text || null;
    } catch { return null; }
  }

  /** The last clear: when, the conversation it replaced, and how big it was. */
  clearedState(id: string): { at: number; oldSession: string; tokensBefore: number } | null {
    try {
      const p = join(this.agentDir(id), 'memory', 'cleared.json');
      const v = JSON.parse((id === RESEARCH_ID ? readResearchFile(this.agentDir(id), p) : readFileSync(p, 'utf8')) ?? '');
      return typeof v?.at === 'number' && typeof v?.oldSession === 'string' ? v : null;
    } catch { return null; }
  }

  recordClear(id: string, state: { at: number; oldSession: string; tokensBefore: number } | null): void {
    // Research's notes folder only as the real one (red team, third ship).
    const dir = id === RESEARCH_ID ? this.researchDir('memory') : join(this.agentDir(id), 'memory');
    if (!dir) return;
    const p = join(dir, 'cleared.json');
    try {
      if (!state) { rmSync(p, { force: true }); return; }
      mkdirSync(dir, { recursive: true });
      // A new file put in place, so a link or second name there is replaced,
      // never written through.
      this.atomicWriteText(p, JSON.stringify(state));
    } catch { /* best-effort */ }
  }

  /** Point an agent back at an earlier conversation (undoing a clear); its
   *  next resume restarts into it. */
  restoreSession(id: string, sessionId: string): void {
    const root = this.root();
    if (!root) return;
    try {
      const reg = this.registry();
      const agent = reg.agents[id];
      if (!agent) return;
      agent.sessionId = sessionId;
      this.atomicWriteJson(join(root, 'registry.json'), reg);
      this.appendLog({ kind: 'session-restored', agentId: id, sessionId });
    } catch { /* best-effort */ }
  }

  memoryIndexFor(id: string): string | null {
    if (!this.root()) return null;
    const p = join(this.agentDir(id), 'memory.md');
    if (!existsSync(p)) return null;
    let entries: MemoryEntry[] = [];
    try {
      // Research's file is read the safe way: a link it made never reaches
      // what its walls keep from it (red team, third ship).
      const text = id === RESEARCH_ID ? readResearchFile(this.agentDir(id), p) : readFileSync(p, 'utf8');
      if (text === null) return null;
      const parsed = parseIndex(text);
      if (!parsed.isIndex) return null;
      entries = parsed.entries;
    } catch { return null; }
    if (entries.length === 0) return null;
    return [
      'YOUR MEMORY. Notes from your past work, kept by the app. Each line: id, kind, the note, where it came from (owner means the owner said it), date, and an expiry for facts that change. Steps for recurring tasks are in the procedure files it names, under your memory folder.',
      entriesBlock(entries)
    ].join('\n');
  }
  inbox(id: string): HiveMessage[] {
    // No home (e.g. mid reset, after resetConfig) means no hive: nothing to read.
    if (!this.root()) return [];
    return this.listMessages(join(this.agentDir(id), 'inbox'));
  }
  /** Read an agent's OUTBOX (messages it has authored/sent). Symmetric with
   *  inbox(); the router drains live outbox files into recipients' inboxes and
   *  archives the original under outbox/.sent, so a sent message survives there. */
  outbox(id: string): HiveMessage[] {
    if (!this.root()) return [];
    return this.listMessages(join(this.agentDir(id), 'outbox'));
  }

  /**
   * Voice read-layer: recent message CONTENT (inbox + outbox bodies) for the
   * operator briefing, REDACTED main-side. This is the message-content half of
   * the voice query surface (the activity half is logTail()).
   *
   * Modes:
   *   - { id }                → the single message with that id, wherever it lives.
   *   - { agentId }           → recent messages in that agent's mailbox only.
   *   - {}                    → recent messages across the whole floor, newest first.
   * `limit` caps the list (default 12, max 40); `includeArchived` (default true)
   * also reads the handled subfolders (inbox/.done, outbox/.sent).
   *
   * SECURITY: every subject + body is passed through redactSecrets() here, in
   * main, so no secret and no raw body ever crosses IPC. Delivered messages exist
   * in both the sender's outbox/.sent and the recipient's inbox/.done; we dedup
   * by message id so each appears once.
   */
  voiceMessages(opts: { agentId?: string; id?: string; limit?: number; includeArchived?: boolean } = {}): VoiceMessage[] {
    const root = this.root();
    if (!root) return [];
    const agentsDir = join(root, 'agents');
    if (!existsSync(agentsDir)) return [];

    const wantId = typeof opts.id === 'string' ? opts.id.trim() : '';
    const onlyAgent = typeof opts.agentId === 'string' ? opts.agentId.trim() : '';
    const includeArchived = opts.includeArchived !== false; // default true

    let owners: string[];
    try {
      owners = onlyAgent
        ? [onlyAgent]
        : readdirSync(agentsDir).filter((id) => !id.startsWith('.') && existsSync(this.agentDir(id)));
    } catch {
      return [];
    }

    const seen = new Set<string>();
    const out: VoiceMessage[] = [];
    for (const owner of owners) {
      const base = this.agentDir(owner);
      // Research's own folders are its to write, so only what the app
      // delivered to it is read, handled or not (listMessages checks each
      // stamp); what it sent shows as the copies the trust layer delivered
      // (owner, third ship D3).
      const research = owner === RESEARCH_ID;
      const folders: Array<{ dir: string; direction: 'inbox' | 'outbox'; archived: boolean }> = [
        { dir: join(base, 'inbox'), direction: 'inbox', archived: false },
        ...(research ? [] : [{ dir: join(base, 'outbox'), direction: 'outbox' as const, archived: false }])
      ];
      if (includeArchived) {
        folders.push({ dir: join(base, 'inbox', '.done'), direction: 'inbox', archived: true });
        if (!research) folders.push({ dir: join(base, 'outbox', '.sent'), direction: 'outbox', archived: true });
      }
      for (const f of folders) {
        for (const m of this.listMessages(f.dir)) {
          if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue;
          seen.add(m.id);
          if (wantId && m.id !== wantId) continue;
          out.push({
            id: m.id,
            conversation: m.conversation,
            from: m.from,
            to: m.to,
            act: m.act,
            subject: redactSecrets(m.subject),
            body: redactSecrets(m.body),
            requires_reply: !!m.requires_reply,
            direction: f.direction,
            owner,
            archived: f.archived,
            created_at: m.created_at
          });
        }
      }
    }

    // Newest first by ISO created_at (lexicographic == chronological for ISO-8601).
    out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    if (wantId) return out.slice(0, 1);
    const lim = typeof opts.limit === 'number' && isFinite(opts.limit)
      ? Math.max(1, Math.min(40, Math.round(opts.limit)))
      : 12;
    return out.slice(0, lim);
  }
  /**
   * An agent's handoff history for its Messages tab (owner, 2026-09-25): what it
   * received and what it sent, handled or not, newest first, REDACTED like the
   * voice read-layer.
   *
   * Sent messages are read from the RECIPIENTS' inboxes (`from === agentId`),
   * not the agent's own outbox/.sent: that folder keeps the raw file the agent
   * wrote, with no id or timestamp, while the router delivers the complete,
   * stamped copy to whoever it was for.
   */
  messageHistory(agentId: string, limit = 300): Array<VoiceMessage & { dir: 'in' | 'out' }> {
    const root = this.root();
    if (!root || !agentId) return [];
    const agentsDir = join(root, 'agents');
    let owners: string[];
    try { owners = readdirSync(agentsDir).filter((id) => !id.startsWith('.') && existsSync(this.agentDir(id))); } catch { return []; }
    const seen = new Set<string>();
    const live = new Set<string>();
    const out: Array<VoiceMessage & { dir: 'in' | 'out' }> = [];
    for (const owner of owners) {
      const base = this.agentDir(owner);
      // Research's mail is its to write: only what the app delivered shows,
      // handled or not (cachedMessages checks each stamp; D3).
      const dirs = [[join(base, 'inbox'), false] as const, [join(base, 'inbox', '.done'), true] as const];
      for (const [dir, archived] of dirs) {
        for (const m of this.cachedMessages(dir, live)) {
          if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue;
          const received = owner === agentId;
          const sent = m.from === agentId;
          if (!received && !sent) continue;
          seen.add(m.id);
          out.push({
            id: m.id, conversation: this.shownConversation(owner, m.conversation), from: m.from, to: m.to, act: m.act,
            subject: redactSecrets(m.subject), body: redactSecrets(m.body),
            requires_reply: !!m.requires_reply, direction: 'inbox', owner, archived,
            created_at: m.created_at, dir: received ? 'in' : 'out'
          });
        }
      }
    }
    // Forget files that are gone (moved to .done has a new path, so it's re-read once).
    for (const path of this.historyCache.keys()) if (!live.has(path)) this.historyCache.delete(path);
    out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return out.slice(0, Math.max(1, Math.min(1000, Math.round(limit))));
  }

  /** Parsed message files by path, for messageHistory: the Messages tab polls it
   *  every 5s over every agent's inbox and inbox/.done, which only grow, so each
   *  file is parsed once and re-read only if its mtime changes (review, 2026-09-25). */
  private historyCache = new Map<string, { stamp: string; msg: HiveMessage }>();

  private cachedMessages(dir: string, live: Set<string>): HiveMessage[] {
    const kind = this.mailFolderKind(dir);
    if (kind === 'hidden') return [];
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
    const out: HiveMessage[] = [];
    for (const f of files) {
      const path = join(dir, f);
      live.add(path);
      // mtime and size together: a coarse mtime alone can miss the end of a write.
      let stamp: string;
      try { const st = statSync(path); stamp = `${st.mtimeMs}:${st.size}`; } catch { continue; }
      const hit = this.historyCache.get(path);
      if (hit && hit.stamp === stamp) { out.push(hit.msg); continue; }
      try {
        // Read the safe way (no link followed, no pipe waited on), and in
        // Research's mail only what the app delivered (red team, third ship).
        const msg = kind === 'stamped' ? this.researchDelivered(path) : JSON.parse(readMessageFile(path) ?? '') as HiveMessage;
        if (!msg || typeof msg !== 'object') continue;
        this.historyCache.set(path, { stamp, msg });
        out.push(msg);
      } catch { /* half-written or bad: not cached, so the next poll reads it again */ }
    }
    return out;
  }

  /** Count undrained inbox messages for an agent (cheap — for the fleet snapshot). */
  inboxBacklog(id: string): number {
    if (!this.root()) return 0;
    const dir = join(this.agentDir(id), 'inbox');
    if (!existsSync(dir)) return 0;
    // Research's counts only what the app delivered.
    if (id === RESEARCH_ID) return this.listMessages(dir).length;
    try { return readdirSync(dir).filter((f) => f.endsWith('.json')).length; } catch { return 0; }
  }
  /** Install the Antigravity (`agy`) lifecycle-hook bridge: write the normalizer
   *  shim and merge a `munder-hive` hook group into agy's global hooks.json so a
   *  Gemini worker reports PreToolUse/PostToolUse/Stop/PreInvocation/PostInvocation
   *  to this HookServer (live status + guarded idle delivery), reusing the Claude pipeline.
   *
   *  Two agy-isms handled: (1) antigravity-cli#49 — agy LOADS hooks from
   *  `~/.gemini/antigravity-cli/hooks.json` but TRIGGERS from `~/.gemini/config/
   *  hooks.json`, so we write BOTH; (2) on Windows commands go to cmd.exe and
   *  agy mangles embedded quotes, so that platform retains the legacy form.
   *  Runtime-scoped by AGENT_ID (the shim no-ops for non-hive agy sessions), so
   *  this global config never disturbs the user's own `agy` usage. Best-effort,
   *  idempotent (only our own group is overwritten). */
  private installAgyHooks(): void {
    const root = this.root();
    if (!root) return;
    const shim = join(root, 'bin', 'agy-hook.cjs');
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(shim, AGY_HOOK_SHIM, 'utf8');
    // Bundled node, not bare `node` — agy's hooks run with a stripped PATH too.
    const command = (event: string) => process.platform === 'win32'
      ? this.nodeRunUnquoted(shim, event)
      : this.nodeRun(shim, event);
    const tool = (event: string) => ({
      matcher: '*',
      hooks: [{ type: 'command', command: command(event), timeout: 0 }]
    });
    const plain = (event: string) => ({
      hooks: [{ type: 'command', command: command(event), timeout: 0 }]
    });
    const group = {
      PreToolUse: [tool('PreToolUse')],
      PostToolUse: [tool('PostToolUse')],
      PreInvocation: [plain('PreInvocation')],
      PostInvocation: [plain('PostInvocation')],
      Stop: [plain('Stop')]
    };
    const gem = join(homedir(), '.gemini');
    for (const p of [join(gem, 'config', 'hooks.json'), join(gem, 'antigravity-cli', 'hooks.json')]) {
      try {
        mkdirSync(dirname(p), { recursive: true });
        let existing: Record<string, unknown> = {};
        if (existsSync(p)) {
          try { existing = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { existing = {}; }
        }
        existing['munder-hive'] = group;
        writeFileSync(p, JSON.stringify(existing, null, 2), 'utf8');
      } catch { /* best-effort per file */ }
    }
  }

  /** Official Google Gemini CLI lifecycle bridge. Gemini's hook payload is
   *  already snake_case; the shim maps event names into HookServer's common
   *  vocabulary and translates deny/steering replies back to Gemini.
   *
   *  The system settings path is per agent. Gemini merges object and array
   *  settings across layers, so auth and user settings remain in their normal
   *  GEMINI_CLI_HOME while this trusted bridge stays isolated.
   *
   *  `writableDirs` become `context.includeDirectories`. Gemini's file tools
   *  refuse any path outside the workspace ("Path not in workspace"), and the
   *  agent folder and hive root sit outside cwd, so without them write_file
   *  and replace cannot touch memory.md or anything else in the agent folder
   *  or the hive. The codex counterpart is `--add-dir`. Gemini concatenates
   *  this array with the owner's own, so theirs still apply.
   *
   *  Gemini CLI 0.60 and later read a system settings file only from a folder
   *  owned by root or an administrator, and skip this one (hooks included).
   *  The spawn also passes the folders as --include-directories for them. */
  private installGeminiHooks(dir: string, writableDirs: string[] = []): string {
    const home = join(dir, '.gemini-hive');
    const settingsPath = join(home, 'system-settings.json');
    try {
      mkdirSync(home, { recursive: true });
      const shim = join(home, 'gemini-hook.cjs');
      writeFileSync(shim, GEMINI_HOOK_SHIM, 'utf8');
      const hook = (name: string, matcher?: string) => ({
        ...(matcher ? { matcher } : {}),
        sequential: true,
        hooks: [{
          name: `munder-hive-${name}`,
          type: 'command',
          command: process.platform === 'win32'
            ? this.nodeRunUnquoted(shim)
            : this.nodeRun(shim),
          timeout: 30000
        }]
      });
      const settings = {
        hooksConfig: { enabled: true, notifications: false },
        hooks: {
          SessionStart: [hook('session-start')],
          BeforeAgent: [hook('before-agent')],
          BeforeTool: [hook('before-tool', '.*')],
          AfterTool: [hook('after-tool', '.*')],
          AfterAgent: [hook('after-agent')]
        },
        ...(writableDirs.length ? { context: { includeDirectories: writableDirs } } : {})
      };
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) { console.error('[hive] installGeminiHooks failed:', e); }
    return settingsPath;
  }

  /** Codex lifecycle-hook bridge → full hive parity for a `codex` worker (live
   *  status + Stop→inbox-drain), the codex counterpart of installAgyHooks().
   *
   *  Codex's hook contract is already Claude-shaped: snake_case stdin
   *  (hook_event_name/tool_name/tool_input/session_id/cwd) and a matching response
   *  contract, where `Stop` honoring {decision:'block',reason} means "continue,
   *  using reason as the next prompt" — exactly what drainForStop() returns. So we
   *  reuse the Claude `cth-hook` shim VERBATIM (no translator, unlike agy) and let
   *  HookServer handle everything unchanged.
   *
   *  ISOLATION: rather than mutate the user's global Codex configuration (which
   *  also holds their login), we point this worker at a PER-AGENT CODEX_HOME
   *  (`<dir>/.codex`, alongside Claude's settings.json) holding our own config.toml
   *  with `[hooks]` tables — so the hooks fire ONLY for hive workers and a personal
   *  `codex` run is untouched. Rollout directories are linked into that isolated
   *  home from namespaced paths under the standard global scan roots. The user's
   *  ~/.codex/auth.json is linked in and their config.toml is copied + extended
   *  (login + model/provider/trust settings still apply).
   *  Returns the CODEX_HOME path for the caller to put in the worker's env. */
  private installCodexHooks(dir: string, agentId: string): string {
    const home = join(dir, '.codex');
    try {
      mkdirSync(home, { recursive: true });
      const userHome = join(homedir(), '.codex');
      // Symlink the user's login so the isolated home authenticates as them.
      // (config.toml is NOT symlinked — we write our own below, seeded from theirs,
      // because it must carry our [hooks] tables.) Fall back to copy where symlinks
      // need privilege (Windows). Idempotent — skip if already linked.
      const authSrc = join(userHome, 'auth.json');
      const authDest = join(home, 'auth.json');
      if (existsSync(authSrc) && !existsSync(authDest)) {
        try { symlinkSync(authSrc, authDest); }
        catch { try { copyFileSync(authSrc, authDest); } catch { /* best-effort */ } }
      }
      // The managed app-server daemon used by Codex Remote Control is launched
      // from the standalone install rooted at $CODEX_HOME/packages. Share the
      // user's installed binaries without duplicating them into every agent.
      const packagesSrc = join(userHome, 'packages');
      const packagesDest = join(home, 'packages');
      if (existsSync(packagesSrc) && !existsSync(packagesDest)) {
        try {
          symlinkSync(packagesSrc, packagesDest, process.platform === 'win32' ? 'junction' : 'dir');
        } catch { /* remote integration falls back to a local TUI if unavailable */ }
      }
      // Wire lifecycle hooks via config.toml `[hooks]` tables — the user-layer
      // discovery surface Codex actually scans. (A bare $CODEX_HOME/hooks.json is
      // plugin-scoped — referenced FROM a plugin manifest — and is NOT discovered
      // for a plain config dir; verified empirically that it never fires.) We seed
      // this config.toml from the user's (their model/provider/trust settings carry
      // over) and append a `[[hooks.<Event>]]` group per event, each pointing at the
      // SAME cth-hook shim — reused verbatim (Codex's hook payload + response are
      // already Claude-shaped, so HookServer/drainForStop run unchanged). Regenerated
      // each spawn (idempotent). Serialize the generated command as a TOML basic
      // string; JSON string escaping is compatible here and, on POSIX, preserves
      // the embedded quotes required when a user-selected hive path has spaces.
      // NOTE: hooks fire in INTERACTIVE codex sessions (how hive workers run),
      // not in headless `codex exec`.
      //
      // `timeout` IS SECONDS HERE — do NOT copy Claude's `timeout: 0` sentinel into
      // this file. Codex parses the key as `timeout_sec` and normalizes it with
      // `timeout_sec.unwrap_or(600).max(1)`, so 0 does not mean "no timeout": it is
      // floored to ONE SECOND, the shortest budget there is. That shipped through
      // v0.3.7 and made every codex worker log `SessionStart hook (failed) — hook
      // timed out after 1s` (same for UserPromptSubmit), because each hook cold-starts
      // the Electron binary via hive-node and then waits on hooks.sock — measured
      // 0.08-0.16s idle but 0.6-0.7s under 8 concurrent spawns, which is exactly what
      // session start and prompt dispatch look like. 30s clears that by two orders of
      // magnitude while still capping a wedged shim well before its own 5s internal
      // cap stops mattering; bare omission (600s) would leave a hang looking like a
      // freeze. Verify any change with codex's own resolver, no model spend:
      // `codex app-server` → initialize → `hooks/list` reports the normalized
      // timeoutSec per event.
      const shim = this.shimPath();
      let config = existsSync(join(userHome, 'config.toml'))
        ? readFileSync(join(userHome, 'config.toml'), 'utf8') : '';
      if (shim) {
        const events = ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop',
          'SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact'];
        // On Windows a command with no space and no quote: see codexHookWindows.
        const command = process.platform === 'win32'
          ? this.codexHookWindows(shim) ?? this.nodeRunUnquoted(shim)
          : this.nodeRun(shim);
        config += '\n# --- munder-hive lifecycle hooks (auto-generated; do not edit) ---\n';
        for (const ev of events) {
          config += `\n[[hooks.${ev}]]\n[[hooks.${ev}.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)}\ntimeout = 30\n`;
        }
      }
      writeFileSync(join(home, 'config.toml'), config, 'utf8');

      // Keep each worker's CODEX_HOME isolated while putting its rollout data
      // below Codex's standard scan roots. External usage tools can then discover
      // the sessions without understanding the hive's private directory layout.
      this.exposeCodexDataDirs(home, userHome, agentId);
    } catch (e) { console.error('[hive] installCodexHooks failed:', e); }
    return home;
  }

  private exposeCodexDataDirs(home: string, userHome: string, agentId: string): void {
    for (const kind of ['sessions', 'archived_sessions'] as const) {
      try { this.exposeCodexDataDir(home, userHome, agentId, kind); }
      catch (e) { console.error(`[hive] exposeCodexDataDir(${kind}) failed:`, e); }
    }
  }

  private moveCodexDataDir(from: string, to: string): void {
    try {
      renameSync(from, to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
      cpSync(from, to, { recursive: true, force: false, errorOnExist: true });
      rmSync(from, { recursive: true, force: true });
    }
  }

  private exposeCodexDataDir(
    home: string,
    userHome: string,
    agentId: string,
    kind: 'sessions' | 'archived_sessions'
  ): void {
    const root = this.root();
    if (!root) return;
    if (!agentId || basename(agentId) !== agentId || agentId === '.' || agentId === '..') {
      throw new Error(`invalid agent id: ${agentId}`);
    }
    const source = join(home, kind);
    const scanRoot = join(userHome, kind, 'munder-difflin');
    const hiveId = createHash('sha1').update(root).digest('hex').slice(0, 12);
    const target = join(scanRoot, hiveId, agentId);

    let sourceStat: ReturnType<typeof lstatSync> | null = null;
    try { sourceStat = lstatSync(source); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }

    if (sourceStat?.isSymbolicLink()) {
      let current: string | null = null;
      try { current = realpathSync(source); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        unlinkSync(source);
        sourceStat = null;
      }
      if (current) {
        const rel = relative(realpathSync(scanRoot), current);
        const scope = dirname(rel);
        if (rel && !rel.startsWith('..') && !isAbsolute(rel)
          && dirname(scope) === '.' && basename(rel) === agentId) return;
        throw new Error(`${source} points outside ${scanRoot}`);
      }
    }
    if (sourceStat && !sourceStat.isDirectory()) throw new Error(`${source} is not a directory`);

    mkdirSync(dirname(target), { recursive: true });
    if (sourceStat) {
      if (existsSync(target)) {
        if (readdirSync(target).length > 0) throw new Error(`${source} and ${target} both contain data`);
        rmSync(target, { recursive: true, force: true });
      }
      this.moveCodexDataDir(source, target);
    } else if (!existsSync(target)) {
      mkdirSync(target, { recursive: true });
    }

    try {
      symlinkSync(target, source, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      if (!existsSync(source) && existsSync(target)) {
        try { this.moveCodexDataDir(target, source); } catch { /* data remains at target */ }
      }
      throw e;
    }
  }

  /** Remove rollout directories moved under the user's standard Codex scan
   *  roots before a full hive reset removes the isolated CODEX_HOME links. */
  removeExposedCodexData(): void {
    const root = this.root();
    if (!root) return;
    const agents = join(root, 'agents');
    if (!existsSync(agents)) return;
    const userHome = join(homedir(), '.codex');

    for (const entry of readdirSync(agents, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const kind of ['sessions', 'archived_sessions'] as const) {
        const source = join(agents, entry.name, '.codex', kind);
        try {
          if (!lstatSync(source).isSymbolicLink()) continue;
          const target = realpathSync(source);
          const scanRoot = realpathSync(join(userHome, kind, 'munder-difflin'));
          const rel = relative(scanRoot, target);
          const scope = dirname(rel);
          if (!rel || rel.startsWith('..') || isAbsolute(rel)
            || dirname(scope) !== '.' || basename(rel) !== entry.name) continue;
          rmSync(target, { recursive: true, force: true });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[hive] removeExposedCodexData failed:', e);
          }
        }
      }
    }
  }

  /** Pi (earendil-works) bridge. Pi has a rich `pi.on(event, …)` lifecycle but no
   *  Claude-shaped hook file; instead we drop a bundled EXTENSION into a PER-AGENT
   *  PI_CODING_AGENT_DIR (so the user's global ~/.pi is never mutated) that, when Pi
   *  loads it, posts cth-hook-shaped payloads to HIVE_SOCK on tool_call/agent_end and
   *  auto-approves tool calls when the floor is in auto mode (HIVE_AUTO_APPROVE).
   *  Emitting an `agent_end`→`Stop` keeps the harness status in step (→ idle), which
   *  lets the renderer idle inbox-wake nudge deliver mail. Returns the per-agent dir
   *  for PI_CODING_AGENT_DIR.
   *
   *  LIVE-UNVERIFIED: Pi's exact extension-discovery path + event API need BYOK keys
   *  to confirm; this is written best-effort and wrapped so a wrong guess can never
   *  break the spawn. The renderer nudge is the guaranteed drain regardless. */
  private installPiHooks(dir: string): string {
    const home = join(dir, '.pi-agent');
    try {
      // Pi discovers extensions under its agent dir; we write to the documented
      // `extensions/` location (and keep it isolated per agent).
      const extDir = join(home, 'extensions');
      mkdirSync(extDir, { recursive: true });
      writeFileSync(join(extDir, 'hive-bridge.js'), PI_EXTENSION, 'utf8');
      // A manifest so Pi auto-loads the extension on start (best-effort; harmless if
      // Pi ignores it). Kept minimal and hive-authored.
      const manifest = { name: 'munder-hive-bridge', version: '0.3.1', main: 'extensions/hive-bridge.js', auto: true };
      writeFileSync(join(home, 'extensions.json'), JSON.stringify(manifest, null, 2), 'utf8');

      const userPiDir = join(homedir(), '.pi', 'agent');
      for (const fileName of ['models.json', 'models-store.json'] as const) {
        try {
          const data = readFileSync(join(userPiDir, fileName), 'utf8');
          writeFileSync(join(home, fileName), data, 'utf8');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[hive] installPiHooks copy ${fileName} failed:`, e);
        }
      }
    } catch (e) { console.error('[hive] installPiHooks failed:', e); }
    return home;
  }

  /** OpenCode (anomalyco/opencode) bridge — god Decision 1 (native plugin, not proxy).
   *  OpenCode has no Claude-shaped Stop hook, but its plugin API exposes a real
   *  `session.idle` lifecycle event. We drop a bundled PLUGIN into a PER-AGENT config
   *  dir's `plugin/` folder (OpenCode auto-loads `*.js` plugins from there) that posts
   *  HIVE_SOCK payloads on tool.execute.before/after + session.idle — the same
   *  Stop→drain semantics as codex's hooks, provider-agnostic, no traffic interception.
   *  Returns the config dir for OPENCODE_CONFIG_DIR (isolates from ~/.config/opencode).
   *
   *  LIVE-UNVERIFIED: plugin auto-load + session.idle firing + the inject path need
   *  BYOK keys to confirm; written best-effort, wrapped so it can't break the spawn.
   *  The renderer idle inbox-wake nudge is the guaranteed drain fallback. */
  private installOpenCodePlugin(dir: string, theme?: 'light' | 'dark'): string {
    const home = join(dir, '.opencode');
    try {
      // Theme: OpenCode's `system` theme keeps the terminal's own fg/bg (xterm's,
      // which already follows the app theme) and builds its greys from the
      // detected background, so it reads right on light AND dark. Written to
      // tui.json (current builds) and opencode.json (older builds read `theme`
      // there and migrate it; the migration skips when tui.json already exists).
      // Per-agent dir only, the user's ~/.config/opencode is never touched.
      if (theme) {
        mkdirSync(home, { recursive: true });
        const choice = { theme: 'system' };
        writeFileSync(join(home, 'tui.json'), JSON.stringify({ $schema: 'https://opencode.ai/tui.json', ...choice }, null, 2), 'utf8');
        writeFileSync(join(home, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', ...choice }, null, 2), 'utf8');
      }
      // BOTH `plugin/` and `plugins/`. OpenCode's current docs specify `plugins/`
      // (plural); older builds — and the shape this bridge was originally written
      // against — auto-load from `plugin/` (singular). Since the whole bridge is
      // LIVE-UNVERIFIED (no BYOK keys to prove which the installed version reads),
      // guessing one of them is a coin flip whose losing side is silent: the plugin
      // simply never loads and the agent's only inbox drain becomes the renderer
      // nudge. Writing the same ~2KB file twice costs nothing, is idempotent, and
      // is correct whichever directory the installed OpenCode actually scans.
      for (const name of ['plugin', 'plugins']) {
        const pluginDir = join(home, name);
        mkdirSync(pluginDir, { recursive: true });
        writeFileSync(join(pluginDir, 'hive-bridge.js'), OPENCODE_PLUGIN, 'utf8');
      }
    } catch (e) { console.error('[hive] installOpenCodePlugin failed:', e); }
    return home;
  }

  /** Crush (charmbracelet/crush) proxy routing. Crush has NO base-URL env override, so
   *  the generic proxy env-rewrite is a no-op for it; instead we write a per-agent
   *  CRUSH_GLOBAL_CONFIG whose standard providers' `base_url` all point at the loopback
   *  proxy (so whatever model the worker picks, its LLM traffic routes through the
   *  sidecar → synthesized Status/Stop/cost → status goes idle → the terminal
   *  work-order + renderer nudge deliver mail). A per-agent CRUSH_GLOBAL_DATA isolates
   *  session state from the user's global ~/.config/crush. Keys ride BYOK env vars
   *  (Crush reads ANTHROPIC_API_KEY/OPENAI_API_KEY/… directly), so none are written
   *  here. `api` follows the proxy's wire shape (advisory). Returns the config + data
   *  paths for the spawn env.
   *
   *  LIVE-UNVERIFIED: the single-upstream proxy serves one provider/endpoint shape at a
   *  time — for full synthesized events pick a model whose provider matches the
   *  configured upstream (or a local OpenAI-compatible endpoint). Cross-provider mixing
   *  is humanQA; the renderer nudge still delivers mail regardless. */
  private installCrushConfig(dir: string, loopbackUrl: string, api: 'openai' | 'anthropic', theme?: 'light' | 'dark'): { config: string; data: string } {
    const config = join(dir, 'crush.json');
    const data = join(dir, '.crush-data');
    try {
      mkdirSync(data, { recursive: true });
      // Override base_url → loopback for ONLY the provider whose wire-shape matches
      // the proxy (`api`): the single-upstream sidecar forwards bytes unchanged, so
      // routing a different-wire/host provider (e.g. anthropic when api='openai', or
      // openrouter/groq which are openai-wire but different hosts) through it would
      // hit the wrong endpoint and the call would fail. Those are left to their real
      // upstreams (working calls, un-proxied — no synthesized events, but mail still
      // drains via the renderer nudge + the pty-quiescence idle fallback). For the
      // default god (openai-wire) and a local OpenAI-compatible endpoint this routes
      // through the proxy cleanly. Cross-provider Crush-via-proxy is on-device
      // live-verify (Dwight verify-crush MF1; the default god model is openai-wire to
      // match). Literal loopback (Dwight's b1 — no ${VAR} expansion edge cases);
      // Crush merges config so only base_url is rewritten.
      const wireProvider = api === 'anthropic' ? 'anthropic' : 'openai';
      const providers: Record<string, { base_url: string }> = { [wireProvider]: { base_url: loopbackUrl } };
      // Theme: Crush ships one (dark) palette and no light theme, but
      // `options.tui.transparent` stops it painting its own background, so it
      // sits on xterm's, which follows the app theme. Set whenever the app
      // passes a theme, dark included, so both modes look the same way.
      const options = theme ? { tui: { transparent: true } } : undefined;
      writeFileSync(config, JSON.stringify(options ? { providers, options } : { providers }, null, 2), 'utf8');
    } catch (e) { console.error('[hive] installCrushConfig failed:', e); }
    return { config, data };
  }

  /** Grok lifecycle-hook bridge → live hive status, session capture, guarded
   *  inbox delivery, and operator gates for `grok` workers.
   *
   *  Grok supports the same hook events and decision vocabulary as Claude Code,
   *  but its stdin payload uses camelCase keys. A small adapter normalizes those
   *  keys to HookServer's Claude-shaped contract. The hook is installed in the
   *  user's global Grok hook directory because global hooks are trusted and
   *  Grok sessions/resume stay in the user's normal GROK_HOME. The adapter is
   *  strictly scoped by AGENT_ID, so ordinary Grok sessions exit without doing
   *  anything. Best-effort and idempotent. */
  private installGrokHooks(): void {
    const root = this.root();
    if (!root) return;
    try {
      const shim = join(root, 'bin', 'grok-hook.cjs');
      mkdirSync(join(root, 'bin'), { recursive: true });
      writeFileSync(shim, GROK_HOOK_SHIM, 'utf8');
      const tool = (matcher?: string) => ({
        ...(matcher ? { matcher } : {}),
        // Let Grok apply its event-aware defaults (5s normally, 600s for Stop).
        // Grok is a HOOK bridge (not a proxy sidecar), so it is hit by the same
        // `node: command not found` 127 — bundled node here too.
        hooks: [{ type: 'command', command: this.nodeRun(shim) }]
      });
      const hooks = {
        PreToolUse: [tool('.*')],
        PostToolUse: [tool('.*')],
        Stop: [tool()],
        SubagentStop: [tool('.*')],
        SessionStart: [tool('.*')],
        UserPromptSubmit: [tool()],
        PreCompact: [tool('.*')],
        PostCompact: [tool('.*')]
      };
      const hookDir = join(homedir(), '.grok', 'hooks');
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(
        join(hookDir, 'munder-hive.json'),
        JSON.stringify({ hooks }, null, 2),
        'utf8'
      );
    } catch (e) { console.error('[hive] installGrokHooks failed:', e); }
  }

  /** Write the live fleet snapshot Michael reads (`fleet.json`, gitignored).
   *  Best-effort — called from a timer, must never throw. */
  writeFleetSnapshot(snapshot: unknown): void {
    const root = this.root();
    if (!root) return;
    try { writeFileSync(join(root, 'fleet.json'), JSON.stringify(snapshot, null, 2), 'utf8'); } catch { /* noop */ }
  }

  /** Is this agent the hive's god/orchestrator? */
  isGod(agentId: string): boolean {
    try {
      const reg = this.registry();
      return reg.godId === agentId || !!reg.agents[agentId]?.isGod;
    } catch { return false; }
  }

  /**
   * A compact, one-shot LIVE ROSTER line built from `fleet.json` — injected into
   * god's context as `additionalContext` on SessionStart and every
   * UserPromptSubmit (see HookServer).
   *
   * Why: fleet.json/registry.json are always fresh on disk (8s snapshot +
   * archiveOrphanedAgents on boot + PTY-exit archiving), but god's CONTEXT is not.
   * After an app restart god resumes a session whose transcript still describes
   * the OLD floor, and it will happily message agents that no longer exist. It is
   * told to read fleet.json, but "told to" is not "always knows" — so we push the
   * truth in on every turn instead. One line, so the cost is negligible.
   *
   * `ctxOf` (optional, supplied by HookServer) lets the caller layer the LIVE
   * context-window occupancy on top of the disk snapshot — each agent gets a
   * `ctx NN%` so god can see at a glance whose context is nearly full when it
   * routes work. fleet.json only carries cumulative `tokens`, which is a spend
   * figure, not how full the CURRENT window is; the real occupancy lives in
   * HookServer.contextById (from the statusLine shim). Omitted when the callback
   * is absent or an agent has no Status tick yet.
   *
   * Returns null when there is nothing to say (no hive, no snapshot, no agents),
   * so the hook stays a no-op rather than injecting noise.
   */
  rosterContext(
    ctxOf?: (agentId: string) => { tokens: number; limit: number } | undefined
  ): string | null {
    const root = this.root();
    if (!root) return null;
    try {
      const raw = readFileSync(join(root, 'fleet.json'), 'utf8');
      const snap = JSON.parse(raw) as {
        ts?: number;
        agents?: Array<{
          id: string; name?: string; role?: string; isGod?: boolean;
          breaker?: string; tokens?: number; usd?: number;
          lastTool?: string | null; lastActiveSecAgo?: number | null; inboxBacklog?: number;
          onHold?: boolean;
        }>;
      };
      const agents = Array.isArray(snap.agents) ? snap.agents : [];
      if (!agents.length) return null;

      const ago = (s: number | null | undefined): string =>
        typeof s !== 'number' ? 'unknown'
          : s < 90 ? `${s}s ago`
            : s < 5400 ? `${Math.round(s / 60)}m ago`
              : `${Math.round(s / 3600)}h ago`;

      // Cap the list so a big floor can't crowd out the actual prompt. The
      // remainder is still counted, and fleet.json is one Read away.
      const MAX = 24;
      const shown = agents.slice(0, MAX);
      let anyCtx = false;
      let anyHold = false;
      const rows = shown.map((a) => {
        const bits = [a.role ?? 'agent',
          typeof a.lastActiveSecAgo === 'number' ? `active ${ago(a.lastActiveSecAgo)}` : 'no activity yet'];
        if (a.tokens) bits.push(`${Math.round(a.tokens / 1000)}k tok`);
        if (a.usd) bits.push(`$${a.usd.toFixed(2)}`);
        if (a.inboxBacklog) bits.push(`inbox ${a.inboxBacklog}`);
        if (a.breaker && a.breaker !== 'ok' && a.breaker !== 'none') bits.push(`breaker ${a.breaker}`);
        if (a.isGod) bits.push('you');
        // First in the row after the role would be louder, but this reads in
        // the same scan as `breaker` and `inbox`, and god already treats those
        // as routing signals.
        if (a.onHold) { bits.push('ON HOLD — 1:1 with the human'); anyHold = true; }
        // Live context-window occupancy from the statusLine shim — lets god see
        // which agents are near-full when routing, instead of guessing from the
        // cumulative token count. Clamp to 0-100; a fresh meter can briefly
        // report more than 100% before a window rotation.
        const cw = ctxOf?.(a.id);
        if (cw && cw.limit > 0) {
          const pct = Math.max(0, Math.min(100, Math.round((cw.tokens / cw.limit) * 100)));
          bits.push(`ctx ${pct}%`);
          anyCtx = true;
        }
        return `${a.id}${a.name ? ` "${a.name}"` : ''} (${bits.join(', ')})`;
      });
      const more = agents.length > shown.length ? ` +${agents.length - shown.length} more` : '';
      const age = typeof snap.ts === 'number' ? ago(Math.round((Date.now() - snap.ts) / 1000)) : 'unknown';

      return `[LIVE ROSTER — auto-injected from ${join(root, 'fleet.json')}, snapshot ${age}] `
        + `${agents.length} ACTIVE agent(s): ${rows.join('; ')}.${more} `
        + 'This is the CURRENT floor and it SUPERSEDES any roster earlier in this conversation — '
        + 'agents you remember that are absent here have been archived or killed, so do not message them. '
        + (anyCtx
          ? '`ctx NN%` = live window occupancy; absent = not yet reported (unknown, not empty). '
          : '')
        + (anyHold
          ? 'An agent marked `ON HOLD — 1:1 with the human` is UNAVAILABLE: the human is working '
            + 'with them directly. Do NOT message them, do NOT dispatch to them, and do NOT count '
            + 'them when picking an owner. Route to someone else, or say the work is waiting. They '
            + 'are still running and their terminal is alive, so this is not a reason to archive '
            + 'them or spawn a replacement. The human flips it off when they are done. '
          : '')
        + 'Route work to someone on this list before spawning anyone new.';
    } catch { return null; }
  }
  /**
   * The team roster for a business office (agent instructions audit,
   * 2026-09-25): a fixed header and one line per team member (Michael
   * excluded) with the Role description Michael routes by, plus a status tag
   * only when it changes routing (busy on a card, on hold). `layoutKey` changes
   * only when a line's name, role or description does; `statusKey` only when a
   * tag does, so the hook can send the full roster on a team change and a
   * short status line otherwise (hooks.ts).
   *
   * @param accessOf what a team member can reach and from which Settings
   *   screen (agentAccess.ts accessLine), so Michael names the right one.
   */
  teamRoster(accessOf?: (agentId: string) => string | null): { full: string; status: string; layoutKey: string; statusKey: string } | null {
    const root = this.root();
    if (!root) return null;
    try {
      const snap = JSON.parse(readFileSync(join(root, 'fleet.json'), 'utf8')) as {
        agents?: Array<{ id: string; name?: string; role?: string; isGod?: boolean; onHold?: boolean }>;
      };
      const team = (Array.isArray(snap.agents) ? snap.agents : []).filter((a) => !a.isGod);
      if (!team.length) return null;
      const ledger = this.tasks() as { tasks?: HiveTask[] };
      const cards = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
      const busyOn = (id: string) => cards.find((t) => t?.assignee === id && t.status === 'doing')?.title;
      const lines: string[] = [];
      const tagged: string[] = [];
      const layout: string[] = [];
      for (const a of team) {
        const uses = accessOf?.(a.id);
        const base = `- ${a.name ?? a.id} (${a.id}), ${a.role ?? 'team member'}${accessOf ? `; uses: ${uses ?? 'no mail or connectors'}` : ''}`;
        layout.push(base);
        const tags: string[] = [];
        const busy = busyOn(a.id);
        if (busy) { tags.push(`busy: ${busy}`); tagged.push(`${a.name ?? a.id} busy (${busy})`); }
        if (a.onHold) { tags.push('on hold'); tagged.push(`${a.name ?? a.id} on hold`); }
        lines.push(tags.length ? `${base} (${tags.join('; ')})` : base);
      }
      const status = tagged.length
        ? `Status now: ${tagged.join(', ')}. Everyone else free.`
        : 'Status now: everyone is free.';
      return {
        full: ['Team roster (address messages by the id in brackets):', ...lines].join('\n'),
        status,
        layoutKey: layout.join('\n'),
        statusKey: tagged.join('\n')
      };
    } catch { return null; }
  }

  /** The last `n` log entries; with `kind`, the last `n` entries of that kind;
   *  with `since` (ms), only entries from then on (Who talks to whom reads the
   *  messages of a time range). The log is in time order, so the scan stops at
   *  the first older entry. */
  logTail(n = 200, kind?: string, since?: number): unknown[] {
    const root = this.root();
    if (!root || !existsSync(join(root, 'log.jsonl'))) return [];
    // Who talks to whom asks every 5 s. When the log has not changed since the
    // last read for the same kind and size, a later start is a filter of that
    // answer (the newest n with ts >= a later time are among the newest n
    // with ts >= an earlier one), so the file is not read again.
    const file = join(root, 'log.jsonl');
    let stamp = '';
    try { const st = statSync(file); stamp = `${st.size}:${st.mtimeMs}`; } catch { /* read it */ }
    const c = this.tailCache;
    if (c && stamp && kind && since !== undefined && c.stamp === stamp && c.kind === kind && c.n === n && c.since <= since) {
      return c.out.filter((e) => typeof (e as { ts?: unknown }).ts !== 'number' || ((e as { ts: number }).ts >= since));
    }
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const parse = (l: string): unknown => { try { return JSON.parse(l); } catch { return { raw: l }; } };
    if (!kind && since === undefined) return lines.slice(-n).map(parse);
    const out: unknown[] = [];
    const mark = kind ? `"kind":${JSON.stringify(kind)}` : '';
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      // Cheap test first: a line without the kind cannot match, so read only
      // its time (to stop at the start of the range) and skip the parse.
      if (mark && !lines[i].includes(mark)) {
        const ts = since === undefined ? null : /"ts":(\d+)/.exec(lines[i]);
        if (ts && Number(ts[1]) < (since as number)) break;
        continue;
      }
      const e = parse(lines[i]) as { kind?: unknown; ts?: unknown };
      if (since !== undefined && typeof e.ts === 'number' && e.ts < since) break;
      if (!kind || e.kind === kind) out.push(e);
    }
    out.reverse();
    if (stamp && kind && since !== undefined) this.tailCache = { stamp, kind, n, since, out };
    return out;
  }
  /** logTail's last ranged answer, reused while log.jsonl is unchanged. */
  private tailCache: { stamp: string; kind: string; n: number; since: number; out: unknown[] } | null = null;

  private listMessages(dir: string): HiveMessage[] {
    const kind = this.mailFolderKind(dir);
    if (kind === 'hidden' || !existsSync(dir)) return [];
    let names: string[];
    try { names = readdirSync(dir); } catch { return []; }
    return names
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const full = join(dir, f);
        if (kind === 'stamped') return this.researchDelivered(full);
        const raw = readMessageFile(full);
        try { return raw === null ? null : JSON.parse(raw) as HiveMessage; } catch { return null; }
      })
      .filter((m): m is HiveMessage => !!m && typeof m === 'object');
  }

  /**
   * Record an agent's process exit so a death has a durable cause.
   *
   * Before this, an agent killed by its provider crashing was archived with
   * `{kind:'archive', agentId, archived:true}` and NOTHING else — no exit code,
   * no signal, no output. A two-second SIGILL death and a completed agent were
   * indistinguishable in the only record the hive keeps, and the crash banner
   * lived solely in a UI terminal pane. Observed live 2026-08-24: Michael's
   * `claude` CLI panicked 923ms into startup and left no trace on disk.
   *
   * Split by design:
   *   - log.jsonl  gets structured, non-sensitive fields (code, signal, path).
   *   - crashes/   gets the raw tail, and is gitignored — see ensureHive.
   * A normal exit writes nothing at all; this is a diagnostic, not an audit log.
   */
  recordAgentExit(
    agentId: string,
    info: { exitCode?: number; signal?: number; tail?: string; command?: string }
  ): void {
    const root = this.root();
    if (!root) return;
    const { exitCode, signal, tail, command } = info;
    // A signal means killed (SIGILL/SIGSEGV/SIGKILL); node-pty reports exitCode 0
    // in that case, so signal must be checked independently of the code.
    const abnormal = (typeof signal === 'number' && signal !== 0) || (typeof exitCode === 'number' && exitCode !== 0);
    if (!abnormal) return;

    let tailPath: string | null = null;
    if (tail && tail.length) {
      try {
        const dir = join(root, 'crashes');
        mkdirSync(dir, { recursive: true });
        // Colons are illegal in filenames on Windows and awkward everywhere.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeId = agentId.replace(/[^A-Za-z0-9._-]/g, '_');
        const p = join(dir, `${stamp}-${safeId}.log`);
        const header = [
          `agent:    ${agentId}`,
          `exitCode: ${String(exitCode)}`,
          `signal:   ${String(signal)}`,
          command ? `command:  ${command}` : null,
          `captured: ${new Date().toISOString()}`,
          `--- last ${tail.length} bytes of pty output ---`,
          ''
        ].filter(Boolean).join('\n');
        writeFileSync(p, header + tail, 'utf8');
        tailPath = p;
      } catch { /* a diagnostic must never break teardown */ }
    }

    this.appendLog({
      kind: 'agent-exit',
      agentId,
      exitCode: exitCode ?? null,
      signal: signal ?? null,
      abnormal: true,
      tailPath
    });
  }

  // — log —
  appendLog(event: Record<string, unknown>): void {
    const root = this.root();
    if (!root) return;
    // Compact JSON with a top-level numeric ts first: logTail's fast path
    // reads "kind":"..." and "ts":N straight from the line text.
    const stamped = { ts: Date.now(), ...event };
    const line = JSON.stringify(stamped) + '\n';
    try { appendFileSync(join(root, 'log.jsonl'), line, 'utf8'); } catch { /* noop */ }
    // Pulse telemetry mirrors the kinds it counts (docs/designs/team-performance.md).
    try { this.logObserver?.(stamped); } catch { /* best-effort */ }
  }

  /** Called with every office log event after it is written (Pulse telemetry). */
  logObserver?: (event: Record<string, unknown> & { ts: number }) => void;
  /** Called with the board each 8 s tick reads (Pulse telemetry's card diff). */
  tasksObserver?: (tasks: CardLike[]) => void;

  /**
   * Append one cost sample to the durable, append-only ledger at
   * `<root>/cost-ledger.jsonl` (Lane A #6.6d). This is the SOLE durable cost
   * store; its row is exactly the shape Kevin (#4) reserves for the cost_ledger
   * SQLite table, so migration is a mechanical INSERT…SELECT.
   *
   * 🔒 PII: persist ONLY the allowlisted AgentUsageSample — NEVER a raw OTel
   * record (those carry user.email / account / org / hashed-user-id). The sample
   * is PII-free by construction upstream (the provider's normalize step), so we
   * add no redaction here; we just must not widen what we write. The file lives
   * at the hive ROOT, which the palace never mines (it holds company knowledge
   * only), so no MINE_IGNORE entry is needed.
   *
   * Like appendLog: append to disk now (durable immediately), let it ride the
   * next natural commit. Best-effort — never throws into the beat.
   */
  appendCostLedger(sample: AgentUsageSample): void {
    const root = this.root();
    if (!root) return;
    // Fully snake_case so the row maps 1:1 onto Kevin's (#4) cost_ledger SQLite
    // columns (agent_id, session_id, ts, input, output, cache_read,
    // cache_creation, model, usd) — migration is a straight INSERT…SELECT.
    const row = {
      agent_id: sample.agentId,
      session_id: sample.sessionId,
      ts: sample.ts,
      input: sample.input,
      output: sample.output,
      cache_read: sample.cacheRead,
      cache_creation: sample.cacheCreation,
      model: sample.model,
      usd: sample.usd
    };
    try { appendFileSync(join(root, 'cost-ledger.jsonl'), JSON.stringify(row) + '\n', 'utf8'); } catch { /* noop */ }
  }

  // — json + atomic io —
  private readJson<T>(p: string, fallback: T): T {
    try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return fallback; }
  }
  private writeJson(p: string, data: unknown): void {
    writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  }
  private atomicWriteJson(p: string, data: unknown): void {
    this.atomicWriteText(p, JSON.stringify(data, null, 2));
  }
  /** A new file, then one rename over the old: a link or a file with a second
   *  name at `p` is replaced, never written through. The temp name must be
   *  new, so nothing put there first is followed either. */
  private atomicWriteText(p: string, text: string): void {
    const tmp = `${p}.tmp-${shortRand()}`;
    try {
      writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
      renameSync(tmp, p);
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* none */ }
      throw e;
    }
  }

  // — git (single committer, retry + stale-lock recovery) —
  //
  // `gc.autoDetach=false` is what makes this call actually synchronous.
  //
  // A commit runs `gc --auto`, and git detaches that into a BACKGROUND process
  // by default. `spawnSync` returns when `git commit` exits, so the caller
  // believes the hive is quiescent while a gc it cannot see is still writing
  // into `.git/objects/`. Anything that touches the hive directory right after
  // a commit races that process: removing a hive home throws ENOTEMPTY, and a
  // read can catch a half-written pack.
  //
  // It reproduces on its own — create a HiveManager on a fresh temp home, call
  // ensureAgent, then remove the home: ~3.5% of iterations throw ENOTEMPTY,
  // and the leftover is always `.git/objects/`, sometimes still holding a
  // `bitmap-ref-tips_*` temp file that vanishes a fraction of a second later.
  // With this flag, gc runs inline and 200 iterations pass clean.
  //
  // The gc still happens — this only stops it from outliving the command that
  // triggered it, which is what "single committer" was supposed to mean.
  private git(args: string[], cwd: string): { ok: boolean; out: string; err: string } {
    const res = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'gc.autoDetach=false', '-c', 'user.name=Hive', '-c', 'user.email=hive@local', ...args], {
      cwd, encoding: 'utf8', timeout: 8000
    });
    return { ok: res.status === 0, out: res.stdout ?? '', err: res.stderr ?? '' };
  }

  /** Has the one-time cost-ledger untrack pass run in this process yet? */
  private untrackedCostLedger = false;

  /**
   * Stop versioning the cost ledger.
   *
   * `cost-ledger.jsonl` is append-only and gains a row per usage sample, so a
   * repo that tracks it stores a fresh copy of the WHOLE file on every hive
   * commit — and the hive commits constantly. A quarter-gigabyte ledger with a
   * few thousand commits behind it is several hundred gigabytes of blob that
   * git has to walk, which is what turns a routine `gc` into a multi-gigabyte
   * `pack-objects` run. The ignore line in ensureHive keeps new copies out;
   * this drops the one already in the index, because git keeps recording a
   * file it is already tracking no matter what .gitignore says — so the ignore
   * line alone reads as a fix while the repo goes on growing. The ledger stays
   * on disk, so the cost history the app reads is untouched.
   */
  private untrackCostLedger(root: string): void {
    if (this.untrackedCostLedger) return;
    this.untrackedCostLedger = true;
    // Probe before mutating: `rm --cached` on a repo that never tracked it
    // would still rewrite the index on every launch, inside the retry path.
    const tracked = this.git(['ls-files', '--', 'cost-ledger.jsonl'], root);
    if (!tracked.ok || !tracked.out.trim()) return;
    this.git(['rm', '--cached', '-q', '--ignore-unmatch', '--', 'cost-ledger.jsonl'], root);
    console.warn('[hive] untracked the cost ledger from the hive repo');
  }

  /** Has the one-time Codex-home untrack pass run in this process yet? */
  private untrackedCodexHomes = false;

  /**
   * Stop versioning Codex worker homes that are ALREADY in the index.
   *
   * Adding `.codex/` to each agent's .gitignore only keeps NEW paths out; git
   * happily keeps recording a file it is already tracking, so a hive that
   * predates that ignore line goes on committing every SQLite and transcript
   * revision exactly as before — the .gitignore reads as a fix while the repo
   * keeps growing. This closes that: once per process, refresh every agent's
   * ignore file (agents that are not running never pass through spawn) and drop any tracked
   * `.codex` path from the index. The files stay on disk, so `codex --resume`
   * is unaffected; only their history stops.
   */
  private untrackCodexHomes(root: string): void {
    if (this.untrackedCodexHomes) return;
    this.untrackedCodexHomes = true;
    const agentsDir = join(root, 'agents');
    if (!existsSync(agentsDir)) return;
    try {
      for (const id of readdirSync(agentsDir)) ensureMineIgnore(join(agentsDir, id));
    } catch { /* best-effort */ }
    // The owner's messages and dock state, committed before agents/human/ was
    // ignored, leave the index (the files stay on disk).
    // Research's folder likewise (ship review pass 3).
    for (const dir of ['agents/human', `agents/${RESEARCH_ID}`]) {
      const tracked = this.git(['ls-files', '--', dir], root);
      if (tracked.ok && tracked.out.trim()) this.git(['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', dir], root);
    }
    // Probe before mutating: `rm --cached` on a clean repo would still rewrite
    // the index on every launch, and this runs inside the commit retry path.
    const tracked = this.git(['ls-files', '--', 'agents/*/.codex'], root);
    if (!tracked.ok || !tracked.out.trim()) return;
    this.git(['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', 'agents/*/.codex'], root);
    console.warn('[hive] untracked previously-committed Codex homes from the hive repo');
  }

  /** Commit all hive changes. No-op if there is nothing staged. */
  commit(message: string): void {
    const root = this.root();
    if (!root || !existsSync(join(root, '.git'))) return;
    this.untrackCostLedger(root);
    this.untrackCodexHomes(root);
    for (let attempt = 0; attempt < 5; attempt++) {
      this.clearStaleLock(root);
      const add = this.git(['add', '-A'], root);
      const commit = this.git(['commit', '-q', '-m', message], root);
      if (commit.ok) return;
      if (/nothing to commit/i.test(commit.out + commit.err)) return;
      if (!add.ok || /index\.lock/i.test(commit.err)) { sleepSync(50 * (attempt + 1)); continue; }
      console.warn(`[hive] commit gave up after ${attempt + 1} attempts:`, commit.err || commit.out);
      return;
    }
    console.warn('[hive] commit gave up after 5 attempts');
  }

  private clearStaleLock(root: string): void {
    const STALE_THRESHOLD_MS = 10_000;
    try {
      for (const lock of ['index.lock', 'HEAD.lock']) {
        const path = join(root, '.git', lock);
        if (existsSync(path) && Date.now() - statSync(path).mtimeMs > STALE_THRESHOLD_MS) rmSync(path);
      }
    } catch { /* noop */ }
  }
}

// ─── PROTOCOL.md (written into the hive, readable by every agent) ────────────

/** The Claude Code command reference written to <hive>/COMMANDS.md, rendered from
 *  the SAME source as the UI "commands" tab so they never drift. Leads with the
 *  orchestrator note: slash = own session only, cli = shell/fleet; monitor
 *  siblings via fleet.json (claude agents does NOT see them). */
function renderCommandsMd(): string {
  const lines: string[] = [
    '# Claude Code commands',
    '',
    'Reference of the Claude Code commands available to you. Two kinds:',
    '- **slash** commands act ONLY on your own session — you CANNOT run them on another agent\'s terminal.',
    '- **cli** commands run in your shell (Bash) and can target the fleet, spawn, or query.',
    '',
    'To MONITOR the other agents in this hive, read `fleet.json` in the hive root (live per-agent tokens, cost, status, last tool, breaker level, inbox backlog) plus `registry.json` — `claude agents` does NOT list your hive siblings. Use `claude -p "..." --output-format json` for a one-off headless query.',
    ''
  ];
  for (const g of COMMAND_GROUPS) {
    lines.push(`## ${g.title}`, '');
    for (const it of g.items) {
      lines.push(`- \`${it.cmd.trim()}\` _(${it.kind})_ — ${it.desc}${it.usage ? ` e.g. \`${it.usage}\`` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
const COMMANDS_MD = renderCommandsMd();

/** Every cast member and their fixed job, for Michael's "who could do this"
 *  suggestion. Built once from OFFICE_ROLES, so the prompt stays byte-stable. */
const NO_FIT_CAST = Object.entries(OFFICE_ROLES)
  .map(([c, r]) => `${c[0].toUpperCase()}${c.slice(1)} (${r.role})`)
  .join(', ');

/** Michael's rule for a job nobody on the team covers (owner, 2026-09-24).
 *  Replaces starting a temporary worker: the owner decides, on the ASK ME board. */
const NO_FIT_LINE = `WHEN NO ONE FITS (this overrides anything above about spawning a fresh agent: you cannot start one): before you take on a request, check it against every team member's role (registry.json). If it is outside all of them AND big enough that doing it yourself would pull you off running the floor (research, a document or spreadsheet to build, anything past a few minutes of hands-on work), do NOT do it yourself and do NOT start a new agent. Put it on the owner's ASK ME board instead: add a card to tasks.json for the request with "status": "blocked" and one humanQA ask with "raisedBy": "god", written the short markdown way described above. Open with a bold sentence naming the job and why nobody on the team covers it, then give the choices in "options", with "recommended": true on the one you recommend: add a team member for it (name the role, and the cast member whose standing job matches: ${NO_FIT_CAST}; the owner adds them with Add agent); hand it to the closest team member (name them, and what they would put aside for it); you do it yourself this once (say roughly how long it keeps you off the floor); or drop it. When the answer arrives as a request, carry out their choice, then close the request with "done". Small jobs (a quick answer, a short reply, a lookup) are not this: do or route them as usual.`;

/** PROTOCOL.md's section on starting a temporary worker. Included only in a
 *  build that allows them (ALLOW_TEMP_WORKERS); otherwise the protocol never
 *  mentions the route, so Michael has nothing to try. */
const SPAWN_WORKER_MD = `## Spawning a worker (orchestrator)
You can start an ephemeral worker yourself. Write ONE JSON file into \`spawn-requests/<id>.json\` in
the hive root:

\`\`\`json
{
  "objective": "what the worker must do (required)",
  "cwd": "/absolute/path/to/the/repo (required)",
  "name": "display name (optional)",
  "command": "engine CLI (optional; defaults to the configured one)",
  "provider": "claude | codex | cursor | antigravity | … (optional)",
  "model": "model override (optional)",
  "isolate": true,
  "tokenCap": 0,
  "slack": { "channel": "C…", "thread_ts": "…" },
  "character": "meredith",
  "accent": "coral"
}
\`\`\`

The harness polls that directory, spawns \`worker-<id>\`, and moves the request to
\`spawn-requests/.done/\` once it starts or to \`spawn-requests/.failed/\` with a reason. \`isolate\`
defaults to true, giving the worker its own git worktree. \`slack\` routes its failures back to a
thread. This is the ONLY spawn route you can complete on your own: a hire manifest under
\`research/hires/\` needs the human to confirm it in the UI.

\`character\` and \`accent\` set how the worker looks on the office floor, and both are optional.
Naming a worker after a cast member already gets you that avatar, so you only need \`character\` when
the name and the face should differ. An unrecognised value falls back rather than failing the spawn.

**It can be switched off.** The operator controls this under Settings → Agents, and it is
OFF by default, because every worker you start spends tokens nobody approved. While it is off your
request is NOT failed or deleted, it waits in \`spawn-requests/\` and runs if the operator turns it on.
If a request of yours has sat there without moving, that is why, and it is a decision to raise with the
human rather than retry. Route work to an agent already on the floor first either way.

`;

const PROTOCOL_MD = `# Hive protocol

You are one of several AI agents sharing this hive. Coordination is entirely
file-based; the harness (main process) is the only thing that runs git and the
only thing that moves messages between agents.

## Your workspace — \`agents/<your-id>/\`
- \`identity.md\`  — who you are (read-only; the harness writes it).
- \`memory.md\`    — your memory index. The app keeps it and gives it to you at the start of each session.
- \`memory/inbox.md\` — where you add notes worth keeping; the app sorts them into your index.
- \`inbox/\`       — messages addressed to you. Read them at the start of a task.
- \`inbox/.done/\` — move a message here once you've handled it.
- \`outbox/\`      — drop messages here to send them. The harness delivers them.

**Never write into another agent's folder.** Write to your own \`outbox/\`; the
orchestrator routes it. This keeps every file single-writer.

## Sending a message
Write one JSON file into \`outbox/\` (any filename ending in \`.json\`):

\`\`\`json
{
  "to": "<agent-id> | god | broadcast",
  "act": "request | inform | propose | query | agree | refuse | done",
  "subject": "one-line summary",
  "body": "the details",
  "conversation": "carry this across a thread (optional)",
  "in_reply_to": "<message id you're replying to> (optional)"
}
\`\`\`

The harness fills in \`id\`, \`from\`, \`hops\`, and timestamps.

${SCHEDULES_PROTOCOL}
## Rules of the road
- Only \`request\`, \`query\`, and \`propose\` expect a reply. \`inform\` and \`done\` are terminal —
  don't reply to them, or two agents will loop forever.
- For anything ambiguous, cross-cutting, or needing sign-off, message \`god\` — the
  god agent clarifies answers for you so you rarely need the human directly.
- There is NO separate human-approval queue. Human-in-the-loop is native to Claude
  Code: a tool you run that needs permission prompts in your own session (the human
  can approve it remotely from their phone via \`/remote-control\`). If you genuinely
  need a human decision, raise it with \`god\` (a message \`"to": "human"\` is routed to
  the god/orchestrator, the human's proxy on the floor).
- \`board.md\` is the shared plan. Don't edit it directly — \`propose\` changes to \`god\`,
  who is its sole scribe.
- Re-reading a message you already moved to \`.done/\` is a no-op. Don't reprocess.

## The work: board.md vs tasks.json
There are two shared surfaces, both in the hive root:
- \`board.md\` — the freeform narrative plan. The god agent is its sole scribe; others \`propose\` edits.
- \`tasks.json\` — the structured task ledger (a kanban: \`todo / doing / waiting / blocked / done\`, with title,
  assignee, priority, deps). The god agent is its only writer: tell god when your work moves and it moves
  the card. File what your work needs as one new file in \`triage/\`, written once; god works the filings
  oldest first.

## Asking the human (the ASK ME card)
When a card can only move with the human — a question to answer, or an action only they can do
(create an account, approve a spend, hand over credentials, test on their device) — the god sets the
card \`"status": "blocked"\` and appends the ask to its \`humanQA\` array:

\`\`\`json
{ "q": "the ask, in markdown", "askedAt": "<iso timestamp>", "raisedBy": "<agent id, or god>" }
\`\`\`

A choice adds \`"options": [{ "label": "...", "recommended": true }, { "label": "..." }]\`; several
questions add \`"parts": [{ "q": "..." }, { "q": "...", "options": [{ "label": "..." }] }]\`. The card
shows options as rows to pick and each part as its own line, so they stay out of \`"q"\`. An ask has
one or the other, never both. The owner may answer only some parts: the rest come back to the one who
raised them, who settles what it can and asks again only for what it still needs.

The harness shows the open ask on the ASK ME board and in the ASK ME tab. The human's reply lands in
the same entry as \`"a"\`, goes into the memory notes of the agent that raised it (\`raisedBy\`),
and god gets it as a request to route the follow-up and close with "done". The human talks only to god. Every past entry stays on the card — that
trail is the decision history.

**Write the ask short, and in markdown.** The card renders it, so plain-text asterisks and backticks
show up literally, and a card is not a terminal — an ask longer than a short paragraph plus its
options (roughly 700 characters) is a report, not a question. Cut the narrative and keep the decision:
- give the card a title the owner reads at a glance: a few plain words naming the matter, under
  60 characters (e.g. "Refund for Northwind Cafe"), with no ids, dates, mailbox names or bracketed notes
  (those go in the ask);
- open with ONE **bold** sentence saying exactly what you need from them;
- \`backticks\` for paths, commands, values, and identifiers;
- each link as a few words naming what opens, like [the company in HubSpot](https://...), never the bare address;
- an action the owner takes on a website (signing in, accepting terms, paying) links straight to where they do it,
  with the link from the email or report: the sender's own site, never a tracking or shortened link;
- choices in \`"options"\` and several questions in \`"parts"\`, as above, never as a list in the text;
- a to-do only the owner can do gets \`"Done, I did it"\` as its first option;
- a blank line between paragraphs; a single newline is rendered as a line break, so each option
  stays on its own line.

When the ask originates in another agent's report, REWRITE it into that shape. Never paste the report
body in as the question, and never make the human read the investigation to find the decision. Put the
background (what led to the question and why it matters) in a sentence or two in the card's
\`"description"\`, so the owner can read it under See full context. Do NOT park human questions in other files of your own (no \`HumanQuestion.md\`): a team member's filing in \`triage/\` is the only other place one waits,
and never sit idle waiting for a reply — move on to other work and pick the answer up when it arrives.

## Guardrails: circuit breaker & token budgets
A circuit breaker watches every agent for runaway behavior (looping on the same tool, error storms,
overspending). It escalates gently: \`steer\` → \`constrain\` → \`stop\`. If a \`Circuit breaker: steer\`
or \`Circuit breaker: constrain\` message lands in your inbox, you ARE the problem it caught — stop
repeating, summarize what you've tried, and do exactly what the message says (constrain = go read-only
and get god's sign-off before more tool calls). Be **token-frugal**: the floor has a token budget and
each agent can have its own token limit; crossing it trips the breaker. Prefer references over pasted
content, and \`/compact\` your own session when context gets heavy.

## Fleet monitoring (orchestrator)
You (god) are responsible for situational awareness. To see the live state of every agent, read
\`fleet.json\` in the hive root — it is refreshed continuously with each agent's tokens, cost, status,
breaker level, last tool, last-active time, and inbox backlog. Pair it with \`registry.json\` (the roster)
and \`log.jsonl\` (the event feed). IMPORTANT: \`claude agents\` will NOT show your hive's sibling
sessions (they're spawned independently) — \`fleet.json\` is your source of truth for them. For a deeper
look at one agent, send it a \`query\` and read its card on the board: its \`agents/<id>/\` folder, notes and inbox are its own, never yours to open (owner, 2026-10-16). A full
Claude Code command reference (slash = your own session only; CLI = your shell, can target the fleet)
is in \`COMMANDS.md\` in the hive root.

${ALLOW_TEMP_WORKERS ? SPAWN_WORKER_MD : ''}## Private memory
Your notes and memory are yours alone, and each other agent's are theirs: never
open another agent's \`agents/<id>/\` folder, its notes or inbox, or the hive's git
history. To learn what another agent knows, send it a \`query\`. The one store every
agent searches is company knowledge (by meaning: \`mempalace search "<query>" --wing company\`
when \`mempalace\` is installed).
`;

/** PROTOCOL.md for a business office: the message format and the files, in
 *  plain words, without the older text about git, remote control, spawning or
 *  COMMANDS.md (owner cleanup, 2026-09-25). The instructions each agent gets at
 *  startup carry how to work; this is the reference they point to. */
const PROTOCOL_BUSINESS_MD = `# Message format

The office coordinates through files. The app moves messages between agents; nobody writes into another agent's folder.

## Your folder in the hive: \`agents/<your id>/\`
- \`inbox/\`: messages to you. Act on each, then move it to \`inbox/.done/\`.
- \`outbox/\`: write a message here to send it. The app delivers it and moves it to \`outbox/.sent/\`.
- \`memory.md\`: your memory index. The app keeps it and gives it to you at the start of each session.
- \`memory/inbox.md\`: notes worth keeping, which the app sorts into your index.
- \`memory/handoff.md\`: written only when the app asks for a handoff before a fresh start.

## A message
One JSON file in \`outbox/\`, any name ending in \`.json\`:

\`\`\`json
{
  "to": "michael | <team member id> | broadcast",
  "act": "request | inform | query | done",
  "subject": "one line",
  "body": "the details",
  "in_reply_to": "<id of the message you are answering> (optional)"
}
\`\`\`

The app fills in the id, the sender and the times. Only \`request\` and \`query\` expect a reply; do not answer \`inform\` or \`done\`, or two agents can loop. Only Michael assigns work: a \`request\` from one team member to another is delivered to Michael, who decides who does it. Ask a teammate for a fact with \`query\`; they answer with \`inform\`. Messages from the scheduler name a job and need no reply, except Michael's schedule requests, which he answers with approve, decline or ask-owner.

${SCHEDULES_PROTOCOL}
## The task board
\`tasks.json\` in the hive folder holds the cards (todo, doing, waiting, blocked, done; waiting names who else in waitingOn, never the card\'s own person, a card that only waits for its own person\'s one off step at a set time is todo with nextAt set to that time, scheduled routines get no card, and cards carry no running notes), each with a title and the team member it is assigned to. Only Michael writes \`tasks.json\` and \`board.md\`: when your work moves (finished, waiting on someone, due again at a set time), tell Michael and he moves its card. A done card stays done: only the owner reopens one. At a To do card's \`nextAt\` the app sends its person a "Next step due" message. A Waiting card's \`nextAt\` is when to check back on who it waits on; when it comes the app tells Michael.

## Asking the owner
Only Michael asks the owner, on the Ask me board. A team member files what its work needs as one new file in \`triage/\` in the hive folder, named by the time and its id, written once and never changed: \`{ "title": "...", "description": "...", "filedBy": "<your id>", "filedAt": "<time>" }\` with either \`"ask"\` (one activity's questions for the owner, one to a line) or \`"waitingOn"\` (someone outside the office), one filing per source of answers. Something only the owner can do on a website, such as signing in or accepting terms, carries the exact link for it from the email or page (the sender's own site, never a tracking or shortened link), and Michael keeps it in the ask. Michael works the filings oldest first: he answers, merges into a card, drops a duplicate or makes a card (blocked on Ask me, or waiting), then moves the file to \`triage/.done/\`. A question stays on Ask me until the owner answers it or it is withdrawn, so there is one open ask per card: to change it, Michael folds what still matters into one ask and withdraws the old one with \`"dismissedAt"\` and \`"dismissedReason"\`. When the owner leaves some questions of an ask unanswered, Michael sends them with the answers to whoever raised them, who settles what it can and files back only what it still needs; Michael asks the owner again only for that, on the same card, or on a new card when that card is done. The owner's answer goes into the raiser's memory and to Michael, who routes the follow-up: the owner talks only to Michael.
`;

// ─── cth-hook shim (written to <hive>/bin/cth-hook.cjs) ──────────────────────
// A pipe: read the hook payload on stdin, forward it to the hive's UDS, and
// relay the response back to `claude`. The decisions live in the main process
// (HookServer); the shim makes only three of its own (owner, 2026-10-02):
// AGENT_ID is always the agent (a Task subagent's id rides as subagent_id); an
// MCP call too big for one frame is sent with its short input fields; and an
// MCP call is refused when the app cannot answer (no socket, error, 5 s
// timeout). Everything else never blocks on error.
const HOOK_SHIM = `#!/usr/bin/env node
'use strict';
const net = require('net');
const isStatus = process.argv.includes('--status');
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(data || '{}'); } catch (_) {}
  // Inside a Task subagent, Claude Code puts the SUBAGENT's id in agent_id.
  // The team member is always AGENT_ID, so every gate checks the call as that
  // agent; the subagent's id rides along as subagent_id (owner, 2026-10-02).
  const me = process.env.AGENT_ID || null;
  if (me && payload.agent_id && payload.agent_id !== me) payload.subagent_id = payload.agent_id;
  payload.agent_id = me || payload.agent_id || null;
  // The spawn's secret (issue #61): the app works out the sender from it.
  payload.hook_token = process.env.HIVE_HOOK_SEAL || null;
  // The app reads only which calls ended, never their output: a big output
  // would make the frame too big to send, and the call would never end.
  const ev = payload.hook_event_name;
  if (ev === 'PostToolBatch') payload.tool_calls = (Array.isArray(payload.tool_calls) ? payload.tool_calls : []).filter((c) => c && typeof c.tool_use_id === 'string').map((c) => ({ tool_use_id: c.tool_use_id }));
  if (ev === 'PostToolUse' || ev === 'PostToolUseFailure') { delete payload.tool_response; delete payload.error; }
  const sock = process.env.HIVE_SOCK;
  if (isStatus) {
    // Status-line mode: Claude Code pipes the session status JSON (incl.
    // context_window.total_input_tokens / .context_window_size) after every
    // response. Print the in-terminal gauge IMMEDIATELY (the TUI is waiting),
    // then forward the payload to the harness fire-and-forget so the agent
    // card's context gauge updates push-based, with the EXACT window size.
    payload.hook_event_name = 'Status';
    const cw = payload.context_window || {};
    const used = cw.total_input_tokens, size = cw.context_window_size;
    if (typeof used === 'number' && typeof size === 'number' && size > 0) {
      const pct = Math.round((used / size) * 100);
      process.stdout.write('ctx ' + Math.round(used / 1000) + 'k/' + Math.round(size / 1000) + 'k (' + pct + '%)');
    }
    if (sock) {
      try {
        const c = net.createConnection(sock, () => { c.end(JSON.stringify(payload) + '\\n'); });
        c.on('error', () => {});
        c.on('close', () => process.exit(0));
      } catch (_) { process.exit(0); }
    } else {
      process.exit(0);
    }
    setTimeout(() => process.exit(0), 1500).unref();
    return;
  }
  // Claude connectors fail closed (docs/designs/claude-connectors.md, D8): when
  // the app cannot answer, an MCP call is refused, and so are web pages and
  // web search for everyone but Research (issue #230); every other tool goes on.
  const tool = String(payload.tool_name || '');
  const mcp = payload.hook_event_name === 'PreToolUse' && (tool.indexOf('mcp__') === 0 || ${JSON.stringify([...MCP_RESOURCE_TOOLS])}.indexOf(tool) >= 0);
  const web = payload.hook_event_name === 'PreToolUse' && ${JSON.stringify([...WEB_TOOLS])}.indexOf(tool) >= 0 && me !== ${JSON.stringify(RESEARCH_ID)};
  // Research's file tools have the hook as their only wall: every one of its
  // calls fails closed when the app can't answer (ship review pass 3).
  const research = payload.hook_event_name === 'PreToolUse' && me === ${JSON.stringify(RESEARCH_ID)};
  // A save into the shared temp folders, which Research's shell can read, is
  // refused too when the app can't say whether Research is on (Codex review).
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  // A path is judged as the file it names: './' or '..' padding and a relative
  // path resolve first (ship review pass 2).
  const pathMod = require('path');
  // '~' is the home folder, as Claude Code's file tools and the app read it.
  const home = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
  const pathOf = (raw) => {
    // Trimmed first, as Claude Code reads a path.
    const v = String(raw).trim();
    const p = v === '~' ? home : (v.startsWith('~/') || v.startsWith('~\\\\')) ? pathMod.join(home, v.slice(2)) : v;
    return pathMod.isAbsolute(p) ? pathMod.normalize(p) : pathMod.resolve(String(payload.cwd || '/'), p);
  };
  const rawTarget = String(input.file_path || input.notebook_path || '');
  const target = rawTarget ? pathOf(rawTarget) : '';
  const tempSave = payload.hook_event_name === 'PreToolUse' && ${JSON.stringify([...FOLDER_WRITE_TOOLS])}.indexOf(tool) >= 0
    && /^(?:\\/private)?\\/(?:tmp|var\\/tmp|var\\/folders)(?:\\/|$)/i.test(target);
  // An MCP call too big for one hook frame (a long document to write) is sent
  // with only its short input fields: the connector, mail and QuickBooks gates
  // decide on the tool name, server and mailbox, never the body (owner, 2026-10-02).
  let line = JSON.stringify(payload);
  // Any save, and any command asked to run outside the sandbox, is sent with
  // only its short fields when it is too big for one frame, so the app still
  // judges where it goes (ship review): a lost answer would let it through.
  // Every file tool too: a frame the app drops is a call nobody checked.
  const fileTool = payload.hook_event_name === 'PreToolUse' && ${JSON.stringify([...FOLDER_READ_TOOLS, ...FOLDER_WRITE_TOOLS])}.indexOf(tool) >= 0;
  const bigCheck = payload.hook_event_name === 'PreToolUse' && (fileTool || (tool === 'Bash' && input.dangerouslyDisableSandbox === true));
  if ((mcp || research || tempSave || bigCheck) && Buffer.byteLength(line) > ${MAX_HOOK_FRAME_BYTES}) {
    const small = {};
    for (const k of Object.keys(input)) {
      const v = input[k];
      // The path always goes, resolved, however it was written.
      if ((k === 'file_path' || k === 'notebook_path' || k === 'path') && typeof v === 'string') small[k] = pathOf(v);
      else if (k === 'pattern' && tool === 'Glob' && typeof v === 'string') small[k] = pathMod.isAbsolute(v) ? pathMod.normalize(v) : v;
      else if ((typeof v === 'string' && v.length <= 1024) || typeof v === 'number' || typeof v === 'boolean') small[k] = v;
    }
    payload.tool_input = small;
    payload.tool_input_trimmed = true;
    line = JSON.stringify(payload);
    if (Buffer.byteLength(line) > ${MAX_HOOK_FRAME_BYTES}) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: mcp ? ${JSON.stringify(CONNECTOR_UNDECIDED)} : ${JSON.stringify(HOOK_PATH_UNCHECKED)} } }));
      process.exit(0);
      return;
    }
  }
  const fail = () => {
    if (mcp || web || research || tempSave) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: mcp ? ${JSON.stringify(CONNECTOR_UNDECIDED)} : web ? ${JSON.stringify(WEB_SETTINGS_UNREADABLE)} : ${JSON.stringify(RESEARCH_UNCHECKED_TOOL)} } }));
    process.exit(0);
  };
  if (!sock) { fail(); return; }
  let resp = '';
  const done = () => { if (!resp && (mcp || web || research || tempSave)) { fail(); return; } if (resp) process.stdout.write(resp); process.exit(0); };
  const c = net.createConnection(sock, () => c.write(line + '\\n'));
  c.setEncoding('utf8');
  c.on('data', (d) => { resp += d; });
  c.on('end', done);
  c.on('error', fail);
  setTimeout(fail, 5000).unref();
});
`;

// ─── agy-hook shim (written to <hive>/bin/agy-hook.cjs) ──────────────────────
// Antigravity's `agy` CLI fires lifecycle hooks (PreToolUse/PostToolUse/Stop/
// PreInvocation/PostInvocation) but with a DIFFERENT stdin shape than Claude
// (conversationId / toolCall{name,args} / workspacePaths, and no hook_event_name
// — the event arrives as argv from the hooks.json command). This shim normalizes
// that into the same HookPayload the HookServer already consumes, so status,
// inbox-drain-on-Stop, and tool gating are reused UNCHANGED, then translates the
// server's Claude-shaped response back into agy's stdout contract (decision:
// allow|deny|block + a message). Scoped by AGENT_ID: a personal agy session
// (no AGENT_ID in env) is a no-op, so the global hooks.json never disturbs the
// user's own agy usage — only hive workers (spawned with AGENT_ID set) bridge.
// NOTE (agy bug, antigravity-cli#49): the loader reads ~/.gemini/antigravity-cli/
// hooks.json but the trigger reads ~/.gemini/config/hooks.json — we write BOTH.
const AGY_HOOK_SHIM = `#!/usr/bin/env node
'use strict';
const net = require('net');
const event = process.argv[2] || 'Unknown';
const agentId = process.env.AGENT_ID || null;
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => {
  const sock = process.env.HIVE_SOCK;
  if (!agentId || !sock) { process.exit(0); } // not a hive worker → ignore
  let agy = {};
  try { agy = JSON.parse(data || '{}'); } catch (_) {}
  const tc = agy.toolCall || {};
  const payload = {
    hook_event_name: event,
    agent_id: agentId,
    hook_token: process.env.HIVE_HOOK_SEAL || null,
    session_id: agy.conversationId,
    transcript_path: agy.transcriptPath,
    cwd: Array.isArray(agy.workspacePaths) ? agy.workspacePaths[0] : undefined,
    tool_name: tc.name,
    tool_input: tc.args
  };
  let resp = '';
  const done = () => {
    // Translate the HookServer's Claude-shaped reply into agy's contract. CRITICAL:
    // agy treats ANY object written to stdout as a decision and FAIL-CLOSES (an
    // empty/decision-less object = DENY). So emit JSON ONLY when there's a real
    // directive (deny/block/steer); otherwise write NOTHING — no output = allow.
    let out = null;
    try {
      const r = JSON.parse(resp || '{}');
      if (r.decision === 'block') out = { decision: 'block', reason: r.reason, stopReason: r.reason, systemMessage: r.reason };
      else if (r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny') out = { decision: 'deny', reason: r.hookSpecificOutput.permissionDecisionReason };
      else if (r.continue === false) out = { decision: 'block', stopReason: r.stopReason };
      else if (r.hookSpecificOutput && r.hookSpecificOutput.additionalContext) out = { systemMessage: r.hookSpecificOutput.additionalContext };
    } catch (_) {}
    if (out) { try { process.stdout.write(JSON.stringify(out)); } catch (_) {} }
    process.exit(0);
  };
  try {
    const c = net.createConnection(sock, () => c.write(JSON.stringify(payload) + '\\n'));
    c.setEncoding('utf8');
    c.on('data', (d) => { resp += d; });
    c.on('end', done);
    c.on('error', () => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (_) { process.exit(0); }
});
`;

// ─── pi bridge extension (written to <agentDir>/.pi-agent/extensions/) ───────
// A bundled extension for Pi (earendil-works). Pi exposes a pi.on(event,…)
// lifecycle; this posts cth-hook-shaped payloads to HIVE_SOCK on tool_call /
// tool_result / agent_end and AUTO-APPROVES tool calls when the floor is in auto
// mode (HIVE_AUTO_APPROVE, gated by config.autoMode — Pam guardrail #5). The
// agent_end→Stop keeps the harness status in step (→ idle) so the renderer idle
// inbox-wake nudge can deliver mail. Fully wrapped so a wrong API guess can never
// break the spawn. LIVE-UNVERIFIED (Pi's exact extension surface needs BYOK keys).
const PI_EXTENSION = `'use strict';
var net = require('node:net');
var SOCK = process.env.HIVE_SOCK;
var AGENT = process.env.AGENT_ID || null;
var AUTO = process.env.HIVE_AUTO_APPROVE === '1';
function post(payload) {
  try {
    if (!SOCK) return;
    payload.agent_id = payload.agent_id || AGENT;
    payload.hook_token = process.env.HIVE_HOOK_SEAL || null;
    var c = net.createConnection(SOCK, function () { try { c.end(JSON.stringify(payload) + '\\n'); } catch (e) {} });
    c.on('error', function () {});
  } catch (e) {}
}
function register(pi) {
  if (!pi || typeof pi.on !== 'function') return false;
  try {
    pi.on('tool_call', function (ev) {
      post({ hook_event_name: 'PreToolUse', tool_name: ev && (ev.name || (ev.tool && ev.tool.name)), tool_input: ev && (ev.args || ev.input) });
      if (AUTO) { try { if (ev && typeof ev.approve === 'function') ev.approve(); } catch (e) {} return { approve: true }; }
      return undefined;
    });
    pi.on('tool_result', function (ev) { post({ hook_event_name: 'PostToolUse', tool_name: ev && (ev.name || (ev.tool && ev.tool.name)) }); });
    pi.on('agent_end', function () { post({ hook_event_name: 'Stop' }); });
    return true;
  } catch (e) { return false; }
}
try { if (typeof globalThis !== 'undefined' && globalThis.pi) register(globalThis.pi); } catch (e) {}
module.exports = function (pi) { return register(pi); };
module.exports.activate = function (pi) { return register(pi); };
module.exports.default = module.exports;
`;

// ─── opencode bridge plugin (written to <agentDir>/.opencode/plugin/) ────────
// A bundled plugin for OpenCode (anomalyco/opencode) — god Decision 1. OpenCode
// has no Claude-shaped Stop hook but its plugin API exposes a real session.idle
// event; this posts cth-hook-shaped payloads to HIVE_SOCK on tool.execute.before/
// after + session.idle. The session.idle→Stop keeps status in step (→ idle) so the
// renderer idle inbox-wake nudge delivers mail. ESM (OpenCode runs on Bun). Fully
// wrapped. LIVE-UNVERIFIED (plugin auto-load + session.idle firing need BYOK keys).
const OPENCODE_PLUGIN = `import { createConnection } from 'node:net';
const SOCK = process.env.HIVE_SOCK;
const AGENT = process.env.AGENT_ID || null;
function post(payload) {
  try {
    if (!SOCK) return;
    payload.agent_id = payload.agent_id || AGENT;
    payload.hook_token = process.env.HIVE_HOOK_SEAL || null;
    const c = createConnection(SOCK, () => { try { c.end(JSON.stringify(payload) + '\\n'); } catch (e) {} });
    c.on('error', () => {});
  } catch (e) {}
}
export const HiveBridge = async () => {
  return {
    event: async (input) => {
      try { if (input && input.event && input.event.type === 'session.idle') post({ hook_event_name: 'Stop' }); } catch (e) {}
    },
    'tool.execute.before': async (input) => {
      try { post({ hook_event_name: 'PreToolUse', tool_name: input && (input.tool || input.name) }); } catch (e) {}
    },
    'tool.execute.after': async (input) => {
      try { post({ hook_event_name: 'PostToolUse', tool_name: input && (input.tool || input.name) }); } catch (e) {}
    }
  };
};
export default HiveBridge;
`;

// ─── proxy-bridge sidecar (written to <hive>/bin/hive-proxy.cjs) ─────────────
// One per proxy-tier agent (qwen). A dependency-free, loopback-only reverse
// proxy: the agent's CLI is pointed at this (via ANTHROPIC_BASE_URL/OPENAI_BASE_URL),
// and it forwards every request to the user's real upstream UNCHANGED (headers,
// body, streaming). It TEES each response to synthesize the same HIVE_SOCK payloads
// the hook shims emit — Status (context gauge), PostToolUse (breaker), Stop (idle
// drain), and the new CostSample (cost ledger) — so a hookless CLI becomes a hive
// citizen. NEVER logs bodies or keys; the captured body is parsed in-memory and
// dropped. Idle is heuristic: a turn that ends with no tool call and no new request
// within an ~800ms debounce → Stop (a new request cancels it).
const PROXY_BRIDGE_SHIM = `#!/usr/bin/env node
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

const SOCK = process.env.HIVE_SOCK;
const AGENT_ID = process.env.AGENT_ID || null;
const UPSTREAM = process.env.UPSTREAM_BASE_URL || '';
const SESSION = process.env.HIVE_PROXY_SESSION || null;
const API = process.env.HIVE_PROXY_API === 'anthropic' ? 'anthropic' : 'openai';

function trimSlash(s) { while (s.length && s.charAt(s.length - 1) === '/') s = s.slice(0, -1); return s; }

// Per-model context-window size for the Status gauge; fallback 200k.
function ctxSize(model) {
  const m = String(model || '').toLowerCase();
  if (m.indexOf('[1m]') !== -1 || m.indexOf('-1m') !== -1) return 1000000;
  if (m.indexOf('claude') !== -1) return 200000;
  if (m.indexOf('gpt-4o') !== -1 || m.indexOf('gpt-4.1') !== -1 || m.indexOf('o1') !== -1 || m.indexOf('o3') !== -1) return 128000;
  if (m.indexOf('qwen') !== -1) return 262144;
  return 200000;
}

// Fire-and-forget emit of a shim-shaped payload to the hive socket. Never throws.
function emit(payload) {
  if (!SOCK) return;
  payload.hook_token = process.env.HIVE_HOOK_SEAL || null;
  try {
    const c = net.createConnection(SOCK, function () { c.end(JSON.stringify(payload) + '\\n'); });
    c.on('error', function () {});
  } catch (e) {}
}

let stopTimer = null;
function armStop() {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(function () {
    stopTimer = null;
    emit({ hook_event_name: 'Stop', agent_id: AGENT_ID, session_id: SESSION });
  }, 800);
  if (stopTimer.unref) stopTimer.unref();
}
function cancelStop() { if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; } }

function safeArgs(s) {
  if (s == null) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return { _raw: String(s).slice(0, 500) }; }
}

// Parse a completed response (single JSON or an SSE stream) and synthesize events.
function parseAndEmit(bodyStr, isSse) {
  const objs = [];
  if (isSse) {
    const lines = bodyStr.split('\\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const idx = ln.indexOf('data:');
      if (idx === -1) continue;
      const data = ln.slice(idx + 5).trim();
      if (!data || data === '[DONE]') continue;
      try { objs.push(JSON.parse(data)); } catch (e) {}
    }
  } else {
    try { objs.push(JSON.parse(bodyStr)); } catch (e) {}
  }
  if (!objs.length) { armStop(); return; }

  let model = null, input = 0, output = 0, cacheRead = 0, cacheCreation = 0, sawUsage = false;
  const toolCalls = [];
  const oaiTools = {}; // accumulate streaming openai tool_calls by index

  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (!o || typeof o !== 'object') continue;
    if (o.model) model = o.model;
    if (API === 'anthropic') {
      if (o.type === 'message_start' && o.message) {
        if (o.message.model) model = o.message.model;
        const u = o.message.usage || {};
        input += u.input_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheCreation += u.cache_creation_input_tokens || 0;
        sawUsage = true;
      } else if (o.type === 'message_delta' && o.usage) {
        output += o.usage.output_tokens || 0;
        sawUsage = true;
      } else if (o.type === 'content_block_start' && o.content_block && o.content_block.type === 'tool_use') {
        toolCalls.push({ name: o.content_block.name, input: o.content_block.input || {} });
      } else if (o.usage && !o.type) {
        // non-streaming full message body
        const u = o.usage;
        input += u.input_tokens || 0;
        output += u.output_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheCreation += u.cache_creation_input_tokens || 0;
        sawUsage = true;
      }
      if (Array.isArray(o.content)) {
        for (let j = 0; j < o.content.length; j++) {
          const blk = o.content[j];
          if (blk && blk.type === 'tool_use') toolCalls.push({ name: blk.name, input: blk.input || {} });
        }
      }
    } else {
      if (o.usage) {
        const u = o.usage;
        input += u.prompt_tokens || 0;
        output += u.completion_tokens || 0;
        if (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) cacheRead += u.prompt_tokens_details.cached_tokens;
        sawUsage = true;
      }
      const choices = o.choices || [];
      for (let c = 0; c < choices.length; c++) {
        const ch = choices[c];
        if (!ch) continue;
        if (ch.message && Array.isArray(ch.message.tool_calls)) {
          for (let t = 0; t < ch.message.tool_calls.length; t++) {
            const tc = ch.message.tool_calls[t];
            if (tc && tc.function) toolCalls.push({ name: tc.function.name, input: safeArgs(tc.function.arguments) });
          }
        }
        if (ch.delta && Array.isArray(ch.delta.tool_calls)) {
          for (let t = 0; t < ch.delta.tool_calls.length; t++) {
            const tc = ch.delta.tool_calls[t];
            if (!tc) continue;
            const k = (tc.index != null ? tc.index : t);
            if (!oaiTools[k]) oaiTools[k] = { name: null, args: '' };
            if (tc.function) {
              if (tc.function.name) oaiTools[k].name = tc.function.name;
              if (tc.function.arguments) oaiTools[k].args += tc.function.arguments;
            }
          }
        }
      }
    }
  }
  const keys = Object.keys(oaiTools);
  for (let i = 0; i < keys.length; i++) {
    const t = oaiTools[keys[i]];
    if (t.name) toolCalls.push({ name: t.name, input: safeArgs(t.args) });
  }

  if (sawUsage) {
    emit({ hook_event_name: 'Status', agent_id: AGENT_ID, context_window: { total_input_tokens: input + cacheRead + cacheCreation, context_window_size: ctxSize(model) } });
    emit({ hook_event_name: 'CostSample', agent_id: AGENT_ID, session_id: SESSION, model: model, input: input, output: output, cache_read: cacheRead, cache_creation: cacheCreation });
  }
  if (toolCalls.length) {
    cancelStop(); // a tool call means the turn continues
    for (let i = 0; i < toolCalls.length; i++) {
      emit({ hook_event_name: 'PostToolUse', agent_id: AGENT_ID, session_id: SESSION, tool_name: toolCalls[i].name, tool_input: toolCalls[i].input });
    }
  } else {
    armStop();
  }
}

let upstreamUrl = null;
try { upstreamUrl = new URL(UPSTREAM); } catch (e) {}

const server = http.createServer(function (req, res) {
  cancelStop(); // a new request means the turn is still going
  if (!upstreamUrl) { res.statusCode = 502; res.end('proxy: no upstream'); return; }
  let target;
  try { target = new URL(trimSlash(UPSTREAM) + req.url); } catch (e) { res.statusCode = 502; res.end('proxy: bad url'); return; }
  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = Object.assign({}, req.headers);
  headers.host = target.host;
  // Ask upstream for plaintext so the tee can parse SSE/JSON reliably; the client
  // gets uncompressed bytes (loopback — negligible) and no content-encoding to undo.
  delete headers['accept-encoding'];
  const opts = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    method: req.method,
    path: target.pathname + target.search,
    headers: headers
  };
  const upReq = lib.request(opts, function (upRes) {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    const ct = String((upRes.headers['content-type'] || ''));
    const wantParse = ct.indexOf('json') !== -1 || ct.indexOf('event-stream') !== -1;
    const isSse = ct.indexOf('event-stream') !== -1;
    const chunks = [];
    let total = 0;
    upRes.on('data', function (chunk) {
      res.write(chunk); // stream straight through to the CLI
      if (wantParse && total < 4194304) { chunks.push(chunk); total += chunk.length; }
    });
    upRes.on('end', function () {
      res.end();
      if (wantParse && chunks.length) {
        try { parseAndEmit(Buffer.concat(chunks).toString('utf8'), isSse); } catch (e) {}
      }
    });
    upRes.on('error', function () { try { res.end(); } catch (e) {} });
  });
  upReq.on('error', function () { try { res.statusCode = 502; res.end('proxy: upstream error'); } catch (e) {} });
  req.pipe(upReq);
});

server.on('error', function () {
  try { process.stdout.write(JSON.stringify({ port: 0 }) + '\\n'); } catch (e) {}
  process.exit(0);
});
server.listen(0, '127.0.0.1', function () {
  const addr = server.address();
  const port = (addr && typeof addr === 'object') ? addr.port : 0;
  try { process.stdout.write(JSON.stringify({ port: port }) + '\\n'); } catch (e) {}
});
`;

// Official Gemini CLI bridge. Gemini already sends snake_case payload fields;
// normalize its event names, then translate HookServer decisions back into
// Gemini's documented hook output contract.
const GEMINI_HOOK_SHIM = `#!/usr/bin/env node
'use strict';
const net = require('net');
const agentId = process.env.AGENT_ID || null;
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => {
  const sock = process.env.HIVE_SOCK;
  if (!agentId || !sock) { process.exit(0); }
  let gemini = {};
  try { gemini = JSON.parse(data || '{}'); } catch (_) {}
  const names = {
    SessionStart: 'SessionStart',
    BeforeAgent: 'UserPromptSubmit',
    BeforeTool: 'PreToolUse',
    AfterTool: 'PostToolUse',
    AfterAgent: 'Stop'
  };
  const payload = {
    ...gemini,
    hook_event_name: names[gemini.hook_event_name] || gemini.hook_event_name || 'Unknown',
    agent_id: agentId,
    hook_token: process.env.HIVE_HOOK_SEAL || null
  };
  let resp = '';
  const done = () => {
    let out = null;
    try {
      const r = JSON.parse(resp || '{}');
      if (r.continue === false) out = { continue: false, stopReason: r.stopReason };
      else if (r.decision === 'block') out = { decision: 'deny', reason: r.reason };
      else if (r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny') {
        out = { decision: 'deny', reason: r.hookSpecificOutput.permissionDecisionReason };
      } else if (r.hookSpecificOutput && r.hookSpecificOutput.additionalContext) {
        out = { hookSpecificOutput: { additionalContext: r.hookSpecificOutput.additionalContext } };
      }
    } catch (_) {}
    if (out) { try { process.stdout.write(JSON.stringify(out)); } catch (_) {} }
    process.exit(0);
  };
  try {
    const c = net.createConnection(sock, () => c.write(JSON.stringify(payload) + '\\n'));
    c.setEncoding('utf8');
    c.on('data', (d) => { resp += d; });
    c.on('end', done);
    c.on('error', () => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (_) { process.exit(0); }
});
`;

// ─── grok-hook shim (written to <hive>/bin/grok-hook.cjs) ───────────────────
// Grok's lifecycle events and decisions are Claude-compatible, but the wire
// payload is camelCase and uses snake_case event values. Normalize the input for
// HookServer and translate its Claude-style permission denial into Grok's direct
// decision form. Scoped by AGENT_ID so the trusted global hook is inert outside
// Munder-spawned workers.
const GROK_HOOK_SHIM = `#!/usr/bin/env node
'use strict';
const net = require('net');
const agentId = process.env.AGENT_ID || null;
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => {
  const sock = process.env.HIVE_SOCK;
  if (!agentId || !sock) { process.exit(0); }
  let grok = {};
  try { grok = JSON.parse(data || '{}'); } catch (_) {}
  const names = {
    pre_tool_use: 'PreToolUse',
    post_tool_use: 'PostToolUse',
    post_tool_use_failure: 'PostToolUseFailure',
    permission_denied: 'PermissionDenied',
    stop: 'Stop',
    stop_failure: 'StopFailure',
    session_start: 'SessionStart',
    session_end: 'SessionEnd',
    user_prompt_submit: 'UserPromptSubmit',
    notification: 'Notification',
    subagent_start: 'SubagentStart',
    subagent_stop: 'SubagentStop',
    pre_compact: 'PreCompact',
    post_compact: 'PostCompact'
  };
  const payload = {
    hook_event_name: names[grok.hookEventName] || grok.hookEventName || 'Unknown',
    agent_id: agentId,
    hook_token: process.env.HIVE_HOOK_SEAL || null,
    session_id: grok.sessionId,
    cwd: grok.cwd || grok.workspaceRoot,
    tool_name: grok.toolName,
    tool_input: grok.toolInput,
    stop_hook_active: grok.stopHookActive,
    prompt: grok.prompt,
    source: grok.source,
    notification_type: grok.notificationType,
    message: grok.message
  };
  let resp = '';
  const done = () => {
    let out = null;
    try {
      const r = JSON.parse(resp || '{}');
      if (r.continue === false) out = { continue: false, stopReason: r.stopReason };
      else if (r.decision === 'block') out = { decision: 'block', reason: r.reason };
      else if (r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny') {
        out = { decision: 'deny', reason: r.hookSpecificOutput.permissionDecisionReason };
      } else if (r.hookSpecificOutput && r.hookSpecificOutput.additionalContext) {
        out = r;
      }
    } catch (_) {}
    if (out) { try { process.stdout.write(JSON.stringify(out)); } catch (_) {} }
    process.exit(0);
  };
  try {
    const c = net.createConnection(sock, () => c.write(JSON.stringify(payload) + '\\n'));
    c.setEncoding('utf8');
    c.on('data', (d) => { resp += d; });
    c.on('end', done);
    c.on('error', () => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (_) { process.exit(0); }
});
`;
