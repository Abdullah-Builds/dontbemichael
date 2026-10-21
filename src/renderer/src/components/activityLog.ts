// Pure helpers for the Activity tab's hive event log. No React / DOM imports,
// so test/ can load this file directly.

export interface LogEntry { ts?: number; kind?: string; [k: string]: unknown }

/**
 * True when two polls of the hive log are the same list. IPC returns fresh
 * objects each time, so compare by value. The log is a sliding window (newest
 * 60), so the length stays constant while entries shift: comparing only the
 * first entry's `ts` would miss a new line whenever the two oldest entries share
 * a timestamp. Compare the whole list.
 */
export function areLogsEqual(prev: LogEntry[], next: LogEntry[]): boolean {
  return JSON.stringify(prev) === JSON.stringify(next);
}
