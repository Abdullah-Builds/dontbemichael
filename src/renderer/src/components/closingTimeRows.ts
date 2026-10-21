/**
 * What each closing-time row says (ClosingTimeBar's list of who is still working), kept
 * out of the component so it can be tested without rendering React.
 */
import type { Agent } from '@/store/store';

export interface RowText {
  /** "still working" / "waiting at a prompt" / "nothing to do". */
  state: string;
  /** What it is doing and for how long, e.g. "Run the test suite · 7 min". */
  line?: string;
}

/** Most combining marks kept on one character. Real text stacks a few at most
 *  (accents, vowel signs, Hebrew and Arabic points); a run of dozens draws over
 *  the rows above and below. */
const MAX_COMBINING_MARKS = 4;

/** `text` with each run of combining marks cut to `max`, counted by code point.
 *  Everything else, accented and right-to-left text included, is kept as is. */
export function limitCombiningMarks(text: string, max = MAX_COMBINING_MARKS): string {
  return text.replace(/\p{M}+/gu, (run) => {
    const marks = Array.from(run);
    return marks.length <= max ? run : marks.slice(0, max).join('');
  });
}

/** An agent's own words, made safe to quote: its quote marks become ' so it
 *  can't close the quotes early. */
function agentText(text: string): string {
  return limitCombiningMarks(text).replace(/[“”„«»"]/g, "'");
}

/**
 * A waiting agent's row. `atPrompt` is the store's ACTION_AT_PROMPT marker and
 * `caption` its actionText, passed in so this stays free of the store module.
 */
export function describeRow(
  a: Pick<Agent, 'status' | 'action' | 'actionDetail' | 'actionAt'> | undefined,
  now: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
  atPrompt: string,
  caption: (action: string, t: (key: string) => string) => string
): RowText {
  if (!a) return { state: t('closingTime.stillWorking') };
  const state = a.action === atPrompt ? t('closingTime.atPrompt')
    : a.status === 'idle' ? t('closingTime.nothingToDo')
    : t('closingTime.stillWorking');
  // Idle and at-a-prompt already say it all in `state`; no second line. The
  // detail is the agent's own words, so it's quoted, not shown as the app's.
  const what = a.status === 'idle' || a.action === atPrompt ? undefined
    : a.actionDetail === undefined ? caption(a.action, t)
    : t('closingTime.agentWords', { text: agentText(a.actionDetail) });
  const line = [what, minutesSince(a.actionAt, now, t)].filter(Boolean).join(' · ') || undefined;
  return { state, line };
}

/** "7 min" since `at`, or '' under a minute or with no valid time. */
function minutesSince(at: number | undefined, now: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const mins = at && Number.isFinite(at) ? Math.floor((now - at) / 60_000) : 0;
  return mins >= 1 ? t('closingTime.minutes', { count: mins }) : '';
}

/** The last thing a waiting agent said (main reads it from its transcript),
 *  quoted so it never reads as the app's own words, and how long ago. */
export function saidLine(
  said: { text: string; at?: number } | undefined,
  now: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | undefined {
  if (!said?.text) return undefined;
  return [t('closingTime.lastSaid', { text: agentText(said.text) }), minutesSince(said.at, now, t)].filter(Boolean).join(' · ');
}

/** The message a row shows after Remind or Close without them: none when it
 *  went through, else main's reason, else the generic "didn't send". */
export function actionMessage(res: { ok: boolean; error?: string } | undefined, fallback: string): string | undefined {
  if (res?.ok) return undefined;
  return res?.error || fallback;
}

/**
 * The counter strip above the rows. Its words are the dialog's original
 * English (owner, 2026-09-29: the existing dialog words stay), translated and
 * in sentence case for design v2. It moves on to the orchestrator once nobody
 * is left to wait for, and says so when Michael's own terminal has ended.
 */
export function headerLine(
  c: { acked: number; total: number; waiting?: string[]; godLive?: boolean },
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const tail = c.godLive === false ? t('closingTime.orchestratorEnded') : t('closingTime.waitingOrchestrator');
  if (c.total <= 0) return `${t('closingTime.noWorkers')}. ${tail}`;
  const nobodyLeft = c.acked >= c.total || (c.waiting !== undefined && c.waiting.length === 0);
  const head = t('closingTime.confirmedCount', { acked: c.acked, total: c.total });
  return c.godLive === false || nobodyLeft ? `${head}. ${tail}` : head;
}
