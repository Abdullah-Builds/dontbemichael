/**
 * The last assistant text in one Claude Code transcript (JSONL).
 *
 * Pure and free of native imports so tests can load it. hiddenClaude.ts reads
 * the transcript of ITS OWN session (named by the `--session-id` it passes),
 * never "the newest file in the project folder": two hidden calls in a row
 * share that folder, and taking the newest file once handed one agent's memory
 * tidy the other agent's answer (Sadiq's memory landed in Toby's, 2026-09-27).
 */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';

/** Where Claude Code writes the transcript of session `sessionId`. */
export function transcriptFile(projectDirPath: string, sessionId: string): string {
  return path.join(projectDirPath, `${sessionId}.jsonl`);
}

/** The last non-empty assistant text block in `file`, or null if there is
 *  none yet (the model is still thinking) or the file is missing. */
export function lastAssistantText(file: string): string | null {
  try {
    if (!existsSync(file)) return null;
    return lastTextIn(readFileSync(file, 'utf8').split('\n'))?.text ?? null;
  } catch { return null; }
}

/** How much of a transcript's end the latest line is looked for in. */
const LATEST_TAIL_BYTES = 256 * 1024;

/** One line the agent said, and when (ms), if its record had a valid time. */
export interface SaidLine { text: string; at?: number }

/** The last worded line of the last thing the agent said, read from the end
 *  of its transcript only (a long session's file is many megabytes), or null. */
export function lastAssistantLine(file: string, tailBytes = LATEST_TAIL_BYTES): SaidLine | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    // The first line may start mid record.
    if (len < size) lines.shift();
    const said = lastTextIn(lines);
    const text = said && lastWordedLine(said.text);
    if (!text) return null;
    const at = typeof said.timestamp === 'string' ? Date.parse(said.timestamp) : NaN;
    return Number.isFinite(at) ? { text, at } : { text };
  } catch { return null; } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* gone */ }
  }
}

/** Heading, quote, list and numbered list marks at the start of a line. */
const LEADING_MARKS = /^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/;

/** The last line of markdown `text` with words in it, as plain words: code
 *  blocks, their fences and table rule rows are skipped; leading marks, outer
 *  table pipes and ** or ` around words are dropped. Null if none. */
export function lastWordedLine(text: string): string | null {
  let inCode = false;
  let last: string | null = null;
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { inCode = !inCode; continue; }
    if (inCode) continue;
    let line = raw.trim().replace(LEADING_MARKS, '');
    if (line.startsWith('|')) line = line.replace(/^\|\s*|\s*\|$/g, '');
    line = line.replace(/\*\*|`/g, '').trim();
    if (/[\p{L}\p{N}]/u.test(line)) last = line;
  }
  return last;
}

/** The last non-empty assistant text block among transcript lines, with its
 *  record's timestamp. */
function lastTextIn(lines: string[]): { text: string; timestamp?: unknown } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let rec: { type?: unknown; timestamp?: unknown; message?: { content?: unknown[] } };
    try { rec = JSON.parse(trimmed); } catch { continue; }
    if (rec.type !== 'assistant') continue;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j] as { type?: unknown; text?: unknown };
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        return { text: block.text.trim(), timestamp: rec.timestamp };
      }
    }
  }
  return null;
}
