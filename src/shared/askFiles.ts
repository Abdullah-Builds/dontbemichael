/**
 * Files an Ask me question names (docs/designs/ask-me-open-file.md; owner,
 * 2026-10-04: a question that asks the owner to review a saved file should open
 * it, not leave them hunting for the path).
 *
 * Michael writes paths as code spans, and also amounts, emails and domains, so
 * only a span ending in a known file extension counts (eng review R1): a "dot
 * and a short ending" rule matched 37 non-files of 54 spans in a real ledger
 * (`$1,234.50`, `billing@example.com`, `example-client.com`).
 *
 * Shared by the renderer (rows and their kind word) and main, which decides on
 * its own whether a file opens (OPEN_EXTENSIONS) and never trusts the renderer.
 */

/** Extensions that make a code span a file row. */
const DETECT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'csv', 'tsv', 'xlsx', 'xls', 'docx', 'pptx', 'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'json', 'zip'
]);

/** Documents that open in the owner's default app (design D1). No format here
 *  can carry Office macros, so `xls` only shows in Finder (eng review R2); any
 *  other file is shown in Finder too. */
export const OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  'md', 'markdown', 'txt', 'csv', 'tsv', 'xlsx', 'docx', 'pptx', 'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp'
]);

/** A filesystem path's extension, lower case, or '' without one. Only the
 *  last segment counts (split on / and \), a leading dot is a name and not an
 *  extension (`.env`), and `?` or `#` stay part of the name: they are legal in
 *  file names. Shared by Ask me, terminal path tokens and main's file checks;
 *  a URL uses `urlExtensionOf` (imageTypes.ts). */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Whether a code span reads as a file path. */
export function isFileSpan(span: string): boolean {
  const s = span.trim();
  if (!s || s.startsWith('$') || s.includes('@') || /[\r\n`]/.test(s)) return false;
  return DETECT_EXTENSIONS.has(extensionOf(s));
}

/** Files a tab can show inside the office (docs/designs/open-file-tab.md, R3):
 *  Markdown, text, JSON, CSV and images. PDF and Office files open in their own
 *  app instead. JSON is here but not on OPEN_EXTENSIONS: it reads in a tab and
 *  never launches an app. */
export const TAB_EXTENSIONS: ReadonlySet<string> = new Set([
  'md', 'markdown', 'txt', 'json', 'csv', 'tsv', 'png', 'jpg', 'jpeg', 'gif', 'webp'
]);

/** A full path written in plain text (open-file-tab.md, R1): it starts with
 *  `/`, `~/` or a drive letter, and is not the tail of a URL, a word or a
 *  relative path (nothing path-like or word-like right before it). It stops at
 *  the first space, quote or bracket, so a path with spaces needs backticks. */
const PLAIN_PATH = /(?<![\w:/.~\\$@-])(?:~[\\/]|\/|[A-Za-z]:[\\/])[^\s`'"<>()[\]{}|*]+/g;

/** Sentence punctuation after a path belongs to the sentence. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Whether text is a full path (not one relative to a folder). */
export function isAbsolutePathText(s: string): boolean {
  return /^(?:~[\\/]|\/|[A-Za-z]:[\\/])/.test(s);
}

/** The full paths with a known file ending that plain text names, with where
 *  each starts and ends in `text`. */
export function plainFilePaths(text: string): Array<{ path: string; start: number; end: number }> {
  const out: Array<{ path: string; start: number; end: number }> = [];
  for (const m of text.matchAll(PLAIN_PATH)) {
    const path = m[0].replace(TRAILING_PUNCTUATION, '');
    if (!DETECT_EXTENSIONS.has(extensionOf(path))) continue;
    out.push({ path, start: m.index ?? 0, end: (m.index ?? 0) + path.length });
  }
  return out;
}

/** Markdown backslash escapes undone (`\_` reads `_`): how a path written in
 *  plain text arrives in the parsed text, which the chip matches against. */
export function unescapeMarkdown(s: string): string {
  return s.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/** The files a question or reply names, in the order it names them, each once:
 *  code spans with a known file ending (as before), full paths written in plain
 *  text, and Markdown links to a full path (open-file-tab.md, R1). Code fences
 *  are skipped: they hold commands and samples, not files to open. */
export function askFilePaths(question: string): string[] {
  // Blank out what is already handled with spaces of the same length, so every
  // index below still points into the same text.
  const blank = (s: string) => ' '.repeat(s.length);
  const text = question.replace(/```[\s\S]*?```/g, blank);
  const found: Array<{ path: string; at: number }> = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    if (isFileSpan(span)) found.push({ path: span, at: m.index ?? 0 });
  }
  let prose = text.replace(/`[^`\n]+`/g, blank);
  // A link target in <angle brackets> may hold spaces ("Harbor & Pine/Q3
  // report.md") or parentheses, and either form may carry a title after the
  // target ("…", '…' or (…)). Each link found is blanked whole, so no part of
  // its target or title is read again as a plain path below.
  const linkRanges: Array<{ start: number; end: number }> = [];
  for (const m of prose.matchAll(/\]\(/g)) {
    const at = m.index ?? 0;
    if (linkRanges.length && at < linkRanges[linkRanges.length - 1].end) continue;
    let i = at + 2;
    const angled = prose[i] === '<';
    const start = i + (angled ? 1 : 0);
    i = start;
    let depth = 0;
    while (i < prose.length) {
      const c = prose[i];
      if (c === '\\' && i + 1 < prose.length) {
        if (!angled && /\s/.test(prose[i + 1])) break;
        i += 2;
        continue;
      }
      if (c === '\n' || (!angled && /\s|[<>]/.test(c))) break;
      if (angled && c === '>') break;
      if (!angled && c === '(' && ++depth > 32) break;
      if (!angled && c === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    if (i === start || (angled ? prose[i] !== '>' : depth !== 0)) continue;
    const target = unescapeMarkdown(prose.slice(start, i));
    if (angled) i++;
    const titleSpace = i < prose.length && /\s/.test(prose[i]);
    while (/\s/.test(prose[i] ?? '')) i++;
    if (titleSpace && /["'(]/.test(prose[i] ?? '')) {
      const quote = prose[i++];
      let titleDepth = 1;
      while (i < prose.length && prose[i] !== '\n') {
        if (prose[i] === '\\' && i + 1 < prose.length) { i += 2; continue; }
        if (quote === '(' && prose[i] === '(') titleDepth++;
        if (prose[i] === (quote === '(' ? ')' : quote) && --titleDepth === 0) { i++; break; }
        i++;
      }
      while (/\s/.test(prose[i] ?? '')) i++;
    }
    if (prose[i] !== ')') continue;
    if (isAbsolutePathText(target) && isFileSpan(target)) found.push({ path: target, at });
    linkRanges.push({ start: at, end: i + 1 });
  }
  if (linkRanges.length) {
    const chunks: string[] = [];
    let end = 0;
    for (const range of linkRanges) {
      chunks.push(prose.slice(end, range.start), blank(prose.slice(range.start, range.end)));
      end = range.end;
    }
    chunks.push(prose.slice(end));
    prose = chunks.join('');
  }
  prose = prose.replace(/\]\([^)]*\)/g, blank);
  for (const p of plainFilePaths(prose)) found.push({ path: p.path, at: p.start });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { path } of found.sort((a, b) => a.at - b.at)) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** The endings tried, in this order, for a file named without one (owner,
 *  2026-10-19): the documents a team writes most, then the rest the office
 *  can open. `zip` and `xls` are left out: neither ever opens. */
export const NAME_ENDINGS: readonly string[] = ['md', 'docx', 'xlsx', 'pdf', 'csv', 'txt', 'pptx', 'json', 'tsv', 'markdown', 'png', 'jpg', 'jpeg', 'gif', 'webp'];

/** At most this many names are looked up per text: each tries every ending. */
export const MAX_NAMES = 10;

/** Whether a code span may name a file without its ending, such as
 *  `First contact follow up draft 2026-10-19`: a few words with a letter, no
 *  known file ending, and nothing that reads as an amount, address, link or
 *  command. Only a file of that name in the office's folders makes it a chip. */
export function isNameSpan(span: string): boolean {
  const s = span.trim();
  if (s.length < 3 || s.length > 160 || isFileSpan(s)) return false;
  if (/^[$€£¥₹]|[@`\r\n]|:\/\/|^[-./~]|\.\.|\\/.test(s)) return false;
  return /\p{L}/u.test(s);
}

/** The code spans a text names that may be files without their ending, in
 *  order, each once, outside code fences (see askFilePaths). */
export function askFileNames(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));
  const out: string[] = [];
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const name = m[1].trim();
    if (isNameSpan(name) && !out.includes(name)) out.push(name);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

/** The text with each found name's code span written as its file's path, so
 *  it draws as a chip like any other file. Code fences are left as they are. */
export function withNamedFiles(text: string, found: Readonly<Record<string, string>>): string {
  if (!Object.keys(found).length) return text;
  return text.split(/(```[\s\S]*?```)/g).map((part, i) => (i % 2 ? part : part.replace(/`([^`\n]+)`/g, (m, inner: string) => {
    const path = found[inner.trim()];
    return path ? `\`${path}\`` : m;
  }))).join('');
}

export type AskFileKind = 'markdown' | 'text' | 'json' | 'csv' | 'excel' | 'word' | 'powerpoint' | 'pdf' | 'image' | 'file';

/** The kind word a row shows next to the name (design D6). */
export function kindOf(path: string): AskFileKind {
  const ext = extensionOf(path);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'txt') return 'text';
  if (ext === 'json') return 'json';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  if (ext === 'docx') return 'word';
  if (ext === 'pptx') return 'powerpoint';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  return 'file';
}

/** The row's name: the file name without its folder or extension. */
export function fileTitle(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** What main found for one named path. */
export type AskFileVerdict = 'open' | 'reveal' | 'missing';

/** Main's full answer for one named path: the verdict, whether the office can
 *  show it in a tab (TAB_EXTENSIONS, inside the folders), and the path it
 *  really lands on, which keys the tab so two spellings of a file share one. */
export interface AskFileCheck {
  verdict: AskFileVerdict;
  tab: boolean;
  path: string;
}
