/**
 * A file Michael or an Ask me question names, as a chip in place of its path
 * (docs/designs/open-file-tab.md, R2 and DD1; owner, 2026-10-10: show the Open
 * option instead of the path). Main checks every path and decides what the
 * chip does: a file the office can show opens as a tab next to Who talks to
 * whom; another document inside the office folders opens in its own app; a
 * file the office cannot open shows in Finder (Show in folder off a Mac); a
 * file that is gone, or outside every folder, reads Not found.
 *
 * Replaces the rows under the question (docs/designs/ask-me-open-file.md, D2).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { askFileNames, askFilePaths, fileTitle, kindOf, withNamedFiles, type AskFileCheck } from '@shared/askFiles';
import { MarkdownPreview, type MarkdownVariant } from '@/markdown/MarkdownPreview';
import { useStore } from '@/store/store';
import { Icon } from './Icon';

export type Checks = Record<string, AskFileCheck>;

/** Name lookups made in the last half minute, by names and who asks. */
const NAMED_TTL_MS = 30_000;
const NAMED_CACHE_MAX = 200;
const namedCache = new Map<string, { at: number; v: Checks }>();
type Who = { raisedBy?: string; assignee?: string };

/** Main's check caps one call at 20 paths. */
const ASK_FILES_PER_CALL = 20;

/** Asks main what each path can do. If the check fails the chips fall back to
 *  Show in Finder rather than sitting disabled: the click asks main again
 *  anyway (fs:openAskFile), so it opens, shows or reports the file missing. */
async function checkAskFiles(paths: string[], who: Who): Promise<Checks> {
  const out: Checks = {};
  for (let i = 0; i < paths.length; i += ASK_FILES_PER_CALL) {
    const chunk = paths.slice(i, i + ASK_FILES_PER_CALL);
    try {
      const v = await window.cth.askFiles(chunk, who);
      chunk.forEach((p, j) => { out[p] = v[j] ?? { verdict: 'missing', tab: false, path: p }; });
    } catch {
      for (const p of chunk) out[p] = { verdict: 'reveal', tab: false, path: p };
    }
  }
  return out;
}

/**
 * One check for every question on a card (Task detail), not one per question.
 * Grouped by who raised each question, since that decides which team folder is
 * searched first; a card's questions usually share one raiser, so one call.
 * Returns the checks by raiser ('' for none), each keyed by path.
 */
export function useAskFileChecks(
  entries: ReadonlyArray<{ q: string; raisedBy?: string }> | undefined,
  assignee?: string
): Record<string, Checks> {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of entries ?? []) {
      const raiser = e.raisedBy ?? '';
      const list = m.get(raiser) ?? [];
      for (const p of askFilePaths(e.q)) if (!list.includes(p)) list.push(p);
      if (list.length) m.set(raiser, list);
    }
    return [...m];
  }, [entries]);
  const key = JSON.stringify(groups);
  const [byRaiser, setByRaiser] = useState<Record<string, Checks>>({});

  useEffect(() => {
    setByRaiser({});
    let alive = true;
    for (const [raiser, paths] of groups) {
      void checkAskFiles(paths, { raisedBy: raiser || undefined, assignee })
        .then((v) => { if (alive) setByRaiser((s) => ({ ...s, [raiser]: v })); });
    }
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, assignee]);

  return byRaiser;
}

/** The chip itself (DD1): one button with a context menu; Not found is text. */
export function FileChip({ path, check, who, onGone }: {
  path: string;
  check?: AskFileCheck;
  who: Who;
  onGone: (path: string) => void;
}) {
  const { t } = useTranslation();
  // Finder is the Mac's; Windows and Linux both say folder.
  const win = window.cth.platform !== 'darwin';
  const name = fileTitle(path);
  const kind = kindOf(path);
  const icon = kind === 'excel' || kind === 'csv' ? 'sheet' : kind === 'image' ? 'image' : 'file';
  const missing = check?.verdict === 'missing';
  const reveal = !!check && !check.tab && check.verdict === 'reveal';
  const chip: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle', maxWidth: '100%',
    height: 24, padding: '0 8px', margin: '1px 0', border: 0, borderRadius: 'var(--cth-r-sm)',
    fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 500, lineHeight: '24px', whiteSpace: 'nowrap'
  };
  const nameEl = (
    <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, unicodeBidi: 'isolate' }}>{name}</span>
  );
  const openFile = () => {
    if (!check) return;
    if (check.tab) {
      useStore.getState().openFileTab({ id: check.path, title: fileTitle(check.path), kind: kindOf(check.path), who });
      return;
    }
    void window.cth.openAskFile(path, who)
      .then((r) => { if (!r.ok) onGone(path); })
      .catch(() => undefined);
  };
  const labels = [t('askMe.fileOpen'), t(win ? 'askMe.fileRevealWindows' : 'askMe.fileReveal')];
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => { if (!check || missing) setOpen(false); }, [!!check, missing]);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const a = trigger.current.getBoundingClientRect();
    const b = menu.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(a.right - b.width, window.innerWidth - b.width - 8)),
      top: a.bottom + b.height + 6 <= window.innerHeight - 8 ? a.bottom + 6 : Math.max(8, a.top - b.height - 6)
    });
  }, [open, copy]);

  useEffect(() => { if (open) menu.current?.querySelector('button')?.focus(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const moved = (e: Event) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', outside);
    window.addEventListener('resize', moved);
    window.addEventListener('scroll', moved, true);
    return () => {
      window.removeEventListener('mousedown', outside);
      window.removeEventListener('resize', moved);
      window.removeEventListener('scroll', moved, true);
    };
  }, [open]);

  const copyPath = async () => {
    if (copy === 'busy') return;
    setCopy('busy');
    try {
      // Recheck: a failed initial check may contain only the relative path.
      const [fresh] = await window.cth.askFiles([path], who);
      if (!fresh || fresh.verdict === 'missing') { close(); onGone(path); return; }
      const result = await window.cth.copyToClipboard(fresh.path);
      setCopy(result.ok ? 'done' : 'error');
    } catch { setCopy('error'); }
  };

  const showMenu = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    if (!check || missing) return;
    e.preventDefault();
    e.stopPropagation();
    setCopy('idle');
    setOpen(true);
  };
  const menuKeyDown = (e: { key: string; shiftKey: boolean; preventDefault: () => void; stopPropagation: () => void }) => {
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') showMenu(e);
  };

  if (missing) {
    return (
      <span title={`⁨${path}⁩`} style={{ ...chip, background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--cth-line)', color: 'var(--cth-ink-3)' }}>
        <Icon name={icon} size={0.875} />{nameEl}<span style={{ fontWeight: 400 }}>{t('askMe.fileNotFound')}</span>
      </span>
    );
  }
  return <>
    <button
      ref={trigger} type="button"
      className="cth-file-chip"
      onClick={openFile}
      onContextMenu={showMenu}
      onKeyDown={menuKeyDown}
      aria-haspopup={check ? 'menu' : undefined}
      aria-expanded={check ? open : undefined}
      aria-controls={open ? id : undefined}
      disabled={!check}
      title={`⁨${path}⁩`}
      aria-label={reveal
        ? t(win ? 'askMe.fileRevealLabelWindows' : 'askMe.fileRevealLabel', { name })
        : t('askMe.fileOpenLabel', { name })}
      style={{ ...chip, minWidth: 0, background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink)', cursor: check ? 'pointer' : 'default' }}
    >
      <span aria-hidden style={{ color: 'var(--cth-ink-3)', display: 'grid', placeItems: 'center' }}><Icon name={icon} size={0.875} /></span>
      {nameEl}
      {/* Both labels share one cell, so the chip is as wide as the longer one
          whichever shows: nothing jumps when the check lands. */}
      <span aria-hidden style={{ display: 'inline-grid', color: 'var(--cth-indigo-text)', fontWeight: 600 }}>
        {labels.map((l, j) => (
          <span key={j} style={{ gridArea: '1 / 1', visibility: check && (j === 1) === reveal ? 'visible' : 'hidden' }}>{l}</span>
        ))}
      </span>
    </button>
    {check && open && createPortal(
      <div ref={menu} id={id} role="menu" aria-label={t('askMe.fileActionsLabel', { name })}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          if (e.key === 'Tab') close();
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          }
        }}
        style={{ position: 'fixed', ...position, zIndex: 400, minWidth: 190, maxWidth: 'calc(100vw - 16px)', padding: 6, display: 'flex', flexDirection: 'column', background: 'var(--cth-card)', borderRadius: 'var(--cth-r-lg)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)', fontFamily: 'var(--cth-font-ui)' }}
      >
        <button type="button" role="menuitem" tabIndex={-1} className="cth-file-action" onClick={() => { close(); openFile(); }}>{labels[reveal ? 1 : 0]}</button>
        <button type="button" role="menuitem" tabIndex={-1} className="cth-file-action" aria-disabled={copy === 'busy'} onClick={() => void copyPath()}>
          {t(copy === 'done' ? 'askMe.filePathCopied' : 'askMe.fileCopyPath')}
        </button>
        {copy === 'error' && <span role="status" style={{ padding: '0 10px', fontSize: 12, color: 'var(--cth-coral-text)' }}>{t('askMe.fileCopyFailed')}</span>}
      </div>, document.body
    )}
  </>;
}

/**
 * Markdown with its files as chips: Michael's replies, Ask me questions and the
 * Task detail trail. `checks` comes from a parent that checked many questions
 * at once (useAskFileChecks); without it the text checks its own paths, once
 * per set of paths, so a 5 s poll that re-renders the card asks main nothing.
 * A file named without its ending (`First contact follow up draft 2026-10-19`)
 * is looked up by name here, once per set of names; one found in the office's
 * folders is drawn as its file's chip (owner, 2026-10-19).
 */
export function FileText({ source, who, checks: given, variant = 'card' }: {
  source: string;
  who: Who;
  checks?: Checks;
  variant?: MarkdownVariant;
}) {
  const names = useMemo(() => askFileNames(source), [source]);
  const nameKey = names.join('\n');
  const [named, setNamed] = useState<Checks>({});
  const shown = useMemo(() => withNamedFiles(source, Object.fromEntries(Object.entries(named).map(([n, c]) => [n, c.path]))), [source, named]);
  const paths = useMemo(() => askFilePaths(shown), [shown]);
  const key = paths.join('\n');
  const [own, setOwn] = useState<Checks>({});
  // A click that finds the file gone marks it here, over either source.
  const [gone, setGone] = useState<Record<string, true>>({});
  const { raisedBy, assignee } = who;

  useEffect(() => {
    if (!paths.length || given) return;
    let alive = true;
    void checkAskFiles(paths, { raisedBy, assignee }).then((v) => { if (alive) setOwn(v); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, raisedBy, assignee, !given]);

  useEffect(() => {
    // Needs you mounts every card again on each refresh: a lookup made a
    // moment ago is used as it is (each one checks many paths).
    const cacheKey = `${nameKey}\u0000${raisedBy ?? ''}\u0000${assignee ?? ''}`;
    const hit = namedCache.get(cacheKey);
    if (hit && Date.now() - hit.at < NAMED_TTL_MS) { setNamed(hit.v); return; }
    setNamed({});
    // A dev window whose main process predates the lookup has no askFileNames:
    // the names then stay plain text instead of taking the screen down.
    const lookup = window.cth.askFileNames as typeof window.cth.askFileNames | undefined;
    if (!names.length || !lookup) return;
    let alive = true;
    void lookup(names, { raisedBy, assignee })
      .then((v) => {
        namedCache.set(cacheKey, { at: Date.now(), v });
        if (namedCache.size > NAMED_CACHE_MAX) namedCache.delete(namedCache.keys().next().value as string);
        if (alive) setNamed(v);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameKey, raisedBy, assignee]);

  // A found name's check is keyed by the path its chip now carries.
  const checks = useMemo(() => {
    const base = given ?? own;
    const extra = Object.values(named);
    return extra.length ? { ...base, ...Object.fromEntries(extra.map((c) => [c.path, c])) } : base;
  }, [given, own, named]);
  const onGone = useCallback((p: string) => setGone((g) => ({ ...g, [p]: true })), []);
  const fileChip = useCallback((p: string) => (
    <FileChip
      path={p}
      check={gone[p] ? { verdict: 'missing', tab: false, path: p } : checks[p]}
      who={{ raisedBy, assignee }}
      onGone={onGone}
    />
  ), [checks, gone, raisedBy, assignee, onGone]);
  return <MarkdownPreview source={shown} variant={variant} fileChip={paths.length ? fileChip : undefined} />;
}
