import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MichaelDock, type DockView } from '../../src/renderer/src/shell/MichaelDock';
import { useStore } from '../../src/renderer/src/store/store';
import { sendToMichael } from '../../src/renderer/src/shell/ownerSend';
import i18n, { directionFor } from '../../src/renderer/src/i18n';
import type { DockItem, OwnerDock } from '../../src/shared/ownerRequests';
import '../../src/renderer/src/design/tokens.css';
import '../../src/renderer/src/design/global.css';
import '../../src/renderer/src/design/fonts.css';

// The real renderer and store, with only the main-process boundary replaced.
// Nothing is read from an office, written to disk, or sent to an agent.
const at = (n: number) => new Date(Date.now() + n * 1000).toISOString();
const question = (n: number): DockItem => ({ kind: 'owner', id: `q${n}`, conversation: `owner:q${n}`, text: `Question ${n}: What changed in the accounts?`, at: at(n * 2), status: 'answered', unread: false });
const reply = (n: number, notes = false): DockItem => ({ kind: 'michael', id: `r${n}`, replyTo: `q${n}`, act: 'done', text: `Answer ${n}. The invoices are ready to review.\n\nThe account balance agrees with the statement.\n\n${'Details for the owner to read. '.repeat(30)}`, at: at(n * 2 + 1), notes });
const history = () => Array.from({ length: 14 }, (_, n) => [question(n), reply(n)]).flat();
let current = history();
let update: (items: DockItem[]) => void;
let remount: () => void;
let move: () => void;
let failSend = false;
let fileOpened = false;
let resolveFiles: ((value: unknown) => void) | undefined;
const runtimeErrors: string[] = [];
window.addEventListener('error', (e) => runtimeErrors.push(e.message));
window.addEventListener('unhandledrejection', (e) => runtimeErrors.push(String(e.reason)));
Object.assign(window, { cth: {
  platform: navigator.platform.startsWith('Win') ? 'win32' : navigator.platform.startsWith('Mac') ? 'darwin' : 'linux',
  hiveRegistry: async () => ({ agents: { god: { name: 'Michael' } } }),
  ownerDockVisible: async () => {}, ownerRead: async () => {},
  ownerAsk: async () => {
    if (failSend) return { ok: false };
    const q = question(100);
    current = [...current, q];
    update(current);
    return { ok: true, id: q.id, workOrder: 'Fictional test question' };
  },
  askFiles: () => new Promise((resolve) => { resolveFiles = resolve; }),
  openAskFile: async () => { fileOpened = true; return { ok: true, action: 'external' }; }
} });
useStore.getState().setDock(true);

function Fixture() {
  const [items, setItems] = useState(current);
  const [version, setVersion] = useState(0);
  const composer = useRef<HTMLDivElement>(null);
  // What BottomBar keeps for the dock, so a remount opens where the owner was reading.
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [showEarlier, setShowEarlier] = useState(false);
  const kept = useRef<DockView['anchor']['current']>(null);
  const dockOpen = useStore((s) => s.dockOpen);
  useEffect(() => { if (!dockOpen) kept.current = null; }, [dockOpen]);
  const view: DockView = { expanded, setExpanded, showEarlier, setShowEarlier, anchor: kept };
  update = (next) => { current = next; setItems([...next]); };
  remount = () => { setVersion((v) => v + 1); setExpanded({}); setShowEarlier(false); };
  // The dock moving between the bar and the center: a new mount, same view.
  move = () => setVersion((v) => v + 1);
  const dock: OwnerDock = { items, open: 0, unread: 0, waitingForYou: 0 };
  return <>
    <div style={{ padding: 24 }}>
      <h1>Keep your place</h1>
      <p>Fictional local conversation. Scroll back, then deliver two replies.</p>
      <button onClick={() => reset()}>Reset</button>{' '}
      <button onClick={() => append()}>Deliver two replies</button>{' '}
      <button onClick={() => append(true)}>Deliver notes</button>{' '}
      <button onClick={() => useStore.getState().setDock(true, 'q4')}>Go to question 4</button>{' '}
      <button onClick={() => document.documentElement.dataset.cthTheme = document.documentElement.dataset.cthTheme === 'dark' ? 'light' : 'dark'}>Theme</button>{' '}
      {['en', 'ar', 'zh-CN'].map((lng) => <button key={lng} onClick={() => language(lng)}>{lng}</button>)}
    </div>
    <div ref={composer} style={{ position: 'absolute', bottom: 40, insetInlineStart: 40, width: 400 }}>
      <MichaelDock key={version} dock={dock} refresh={() => {}} godId="god" onFillComposer={(s) => useStore.getState().setDraft('god', s)} onReply={() => {}} composerRef={composer} view={view} />
      <textarea aria-label="Test composer" placeholder="Test composer" style={{ width: '100%', height: 50 }} />
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

// Let layout/ResizeObserver delivery finish before checking preservation or
// absence: those predicates can already be true before the action is handled.
// A frame, or a short timer if no frame comes, so a stalled renderer fails a
// check with its message instead of hanging the run.
const frame = () => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 100);
  requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
});
const settle = async () => { await frame(); await frame(); };
async function until(predicate: () => unknown, message: string): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(message);
    await frame();
  }
}
async function scrollTo(top: number) {
  const el = list();
  let delivered = false;
  const onScroll = () => { delivered = true; };
  el.addEventListener('scroll', onScroll, { once: true });
  const before = el.scrollTop;
  try {
    el.scrollTop = top;
    if (el.scrollTop !== before) await until(() => delivered, 'scroll event is delivered');
    await settle();
  } finally { el.removeEventListener('scroll', onScroll); }
}
const list = () => document.querySelector('.cth-dock > div:nth-child(2)') as HTMLElement;
const jump = () => document.querySelector('[data-dock-jump]') as HTMLButtonElement | null;
const bottom = () => list().scrollHeight - list().clientHeight - list().scrollTop;
function reset() {
  flushSync(() => { useStore.getState().setDock(false); update(history()); remount(); });
  flushSync(() => useStore.getState().setDock(true));
}
function append(notes = false) {
  const n = 20 + current.length;
  flushSync(() => update([...current, { ...reply(n, notes), replyTo: 'q13' }, ...(notes ? [] : [{ ...reply(n + 1), replyTo: 'q13' }])]));
}
async function language(lng: string) {
  await i18n.changeLanguage(lng);
  document.documentElement.dir = directionFor(lng);
}

Object.assign(window, { dockTest: { reset, append, list, bottom, jump, settle, until, scrollTo, update, language, sendToMichael } });

async function runDockTests() {
  const passed: string[] = [];
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const pause = (top = 200) => scrollTo(top);
  const commit = async (next: DockItem[]) => { flushSync(() => update(next)); await settle(); };
  const anchor = () => {
    const top = list().getBoundingClientRect().top;
    const row = [...list().querySelectorAll<HTMLElement>('[data-k]')].find((r) => r.getBoundingClientRect().bottom > top)!;
    return { id: row.dataset.k!, offset: row.getBoundingClientRect().top - top };
  };
  const unchanged = (saved: ReturnType<typeof anchor>, label: string) => until(() => {
    const row = list().querySelector<HTMLElement>(`[data-k="${saved.id}"]`);
    return row && Math.abs(row.getBoundingClientRect().top - list().getBoundingClientRect().top - saved.offset) <= 1;
  }, label);
  const navigate = async (id?: string) => { flushSync(() => useStore.getState().setDock(true, id)); await settle(); };

  reset(); await settle();
  await until(() => bottom() <= 1 && !jump(), 'opening starts at latest without a count');
  append(); await settle();
  await until(() => bottom() <= 1 && !jump(), 'bottom follows incoming replies');
  passed.push('open and follow at bottom');

  await pause();
  const reading = anchor();
  const viewportHeight = list().clientHeight;
  const composer = document.querySelector('textarea')!;
  composer.focus();
  append(); await settle();
  await unchanged(reading, 'two replies preserve the passage');
  await until(() => jump()?.textContent?.includes('2 new replies'), `two distinct arrivals are counted: ${jump()?.textContent}, bottom=${bottom()}`);
  await until(() => document.querySelector('[aria-live]')?.textContent === '2 new replies', 'arrivals use one polite announcement');
  check(document.activeElement === composer, 'arrivals preserve composer focus');
  await until(() => list().clientHeight === viewportHeight, 'jump control reserves space');
  await commit([...current]);
  await until(() => jump()?.textContent?.includes('2 new replies'), 'duplicate polling does not count twice');
  await commit(current.map((it) => it.kind === 'owner' ? { ...it, status: 'couldnt-finish' as const } : it));
  await unchanged(reading, 'status reflow preserves the passage');
  await until(() => jump()?.textContent?.includes('2 new replies'), 'status edits do not count');
  jump()!.click(); await settle();
  await until(() => bottom() <= 1 && !jump(), 'jump clears count and resumes following');
  await until(() => document.querySelector('[aria-live]')?.textContent === '', 'catch-up does not replay a stale announcement');
  append(); await settle();
  await until(() => bottom() <= 1 && !jump(), 'following remains enabled after jump');
  passed.push('reading anchor, counts, polling, status, focus and jump');

  await pause(); append(); await settle();
  await scrollTo(list().scrollHeight);
  await until(() => !jump(), 'manual catch-up clears count');
  append(); await settle(); await until(() => bottom() <= 1 && !jump(), 'manual catch-up resumes following');
  await pause(); append(true); await settle();
  await until(() => jump()?.textContent?.includes('Jump to latest'), 'notes have no invented reply count');
  await commit(current.slice(0, -1));
  await until(() => !jump(), 'removing arrivals clears stale count');
  passed.push('manual catch-up, notes and removal');

  await navigate('q4');
  await pause(500); const targeted = anchor();
  append(); await settle(); await unchanged(targeted, 'retained target is not recentered');
  await navigate('q4');
  const q4 = list().querySelector<HTMLElement>('[data-q="q4"]')!;
  await until(() => Math.abs(q4.getBoundingClientRect().top - list().getBoundingClientRect().top + q4.offsetHeight / 2 - list().clientHeight / 2) <= 1, 'same target explicitly navigates again');
  await until(() => !jump(), 'explicit navigation clears arrival count');
  passed.push('one-time and repeated explicit navigation');

  reset(); await settle(); await pause(800);
  const beforeEarlier = anchor();
  const oldQ = { ...question(-1), at: new Date(Date.now() - 40 * 86400000).toISOString() };
  const oldR = { ...reply(-1), at: oldQ.at };
  await commit([oldQ, oldR, ...current]);
  await unchanged(beforeEarlier, 'hidden old history does not move reading');
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Earlier')!.click(); await settle();
  await unchanged(beforeEarlier, 'Earlier prepends preserve reading');
  await until(() => !jump(), 'old history is not a new reply');
  await navigate('q-1');
  await until(() => list().scrollTop < 80, 'old question can be targeted');
  // A quoted answer after another exchange navigates through the same path.
  await commit([...current, { ...reply(101), replyTo: 'q4' }]);
  await navigate();
  const quote = list().querySelector('[data-k="michael:r101"] button') as HTMLButtonElement;
  check(quote, 'quote is rendered'); quote.click(); await settle();
  await pause(600); const afterQuote = anchor(); append(); await settle();
  await unchanged(afterQuote, 'quote navigation is consumed once');
  passed.push('Earlier, hidden question and quote navigation');

  reset(); await settle(); await pause(700);
  const beforeMove = anchor();
  flushSync(() => move()); await settle();
  await unchanged(beforeMove, 'a move between the bar and the center keeps the passage');
  check(!jump(), 'a move is not an arrival');
  await navigate(); flushSync(() => move()); await settle();
  await until(() => bottom() <= 1 && !jump(), 'a move while following stays on the latest');
  passed.push('move between the bar and the center');

  reset(); await settle();
  await commit([oldQ, oldR, ...current]);
  await until(() => !list().querySelector('[data-q="q-1"]'), 'target starts hidden');
  await navigate('q-1');
  await until(() => list().querySelector('[data-q="q-1"]') && list().scrollTop < 80, 'explicit navigation reveals hidden history');
  await navigate('missing-question');
  await until(() => bottom() <= 1, 'missing question falls back to latest');
  passed.push('hidden and missing navigation targets');

  reset(); await settle();
  const foldedReply = { ...reply(300), replyTo: oldQ.id };
  await commit([oldQ, oldR, ...current, foldedReply]);
  await pause(); const beforeReveal = anchor();
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Earlier')!.click(); await settle();
  await unchanged(beforeReveal, 'revealing a folded exchange preserves reading');
  await until(() => !jump(), 'an existing reply in a folded exchange is not a new arrival');
  passed.push('folded exchange arrival baseline');

  reset(); await settle(); await navigate('q200'); await pause(); append(); await settle();
  jump()!.click(); await settle();
  await commit([question(200), ...current]);
  await until(() => bottom() <= 1 && !jump(), 'catch-up cancels an unresolved question target');
  passed.push('catch-up supersedes pending navigation');

  reset(); await settle(); await pause(); const beforeDelayedReply = anchor();
  const delayedReply = { ...reply(400), replyTo: 'q11', at: at(23) };
  await commit([...current.slice(0, 24), delayedReply, ...current.slice(24)]);
  await unchanged(beforeDelayedReply, 'a delayed reply below the reader preserves reading');
  await until(() => jump()?.textContent?.includes('1 new reply'), 'arrival IDs count even when their timestamps precede the latest reply');
  passed.push('delayed arrival below the reader');

  reset(); await settle(); await pause(350);
  const beforeMore = anchor();
  // The first reply in view, whether or not a question sits above it.
  const view = list().getBoundingClientRect();
  const shown = [...list().querySelectorAll<HTMLElement>('[data-k^="michael:"]')].find((r) => r.getBoundingClientRect().bottom > view.top && r.getBoundingClientRect().top < view.bottom);
  const more = [...(shown?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'More') as HTMLButtonElement | undefined;
  check(more, 'visible reply can expand');
  more!.click(); await settle(); await unchanged(beforeMore, 'More preserves the reply text');
  await navigate(); const lastReply = [...list().querySelectorAll('[data-k="michael:r13"] button')].find((b) => b.textContent === 'More') as HTMLButtonElement;
  const beforeLastMore = anchor();
  lastReply.click(); await settle(); await unchanged(beforeLastMore, 'More at bottom keeps the text being read visible');
  await until(() => bottom() > 32, 'More pauses following for reading');
  await pause(800); const beforeResize = anchor();
  document.querySelector<HTMLElement>('.cth-dock')!.style.maxHeight = '300px'; await settle();
  await unchanged(beforeResize, 'viewport resize preserves reading');
  // Child-only layout change exercises ResizeObserver without a dock rerender.
  (list().querySelector('[data-k="michael:r0"]') as HTMLElement).style.minHeight = '350px'; await settle();
  await unchanged(beforeResize, 'late child layout preserves reading');
  passed.push('More, viewport resize and asynchronous child layout');

  // Far enough down that the rows above can shrink without hitting the top.
  reset(); await settle(); await pause(900);
  const removedAnchor = anchor();
  // A question's reply goes with it, so the survivor is from another exchange.
  const exchange = (key: string) => key.replace(/^\w+:[qr]/, '');
  const nextRow = [...list().querySelectorAll<HTMLElement>('[data-k]')].find((r) => exchange(r.dataset.k!) !== exchange(removedAnchor.id) && r.getBoundingClientRect().top > list().getBoundingClientRect().top)!;
  const neighbour = { id: nextRow.dataset.k!, offset: nextRow.getBoundingClientRect().top - list().getBoundingClientRect().top };
  await commit(current.filter((it) => `${it.kind}:${it.id}` !== removedAnchor.id));
  await unchanged(neighbour, 'removing visible anchor preserves a surviving neighbour');
  passed.push('visible anchor removal');

  reset(); await settle(); await pause();
  const beforeSend = anchor(); failSend = true;
  useStore.getState().setDraft('god', 'Keep this draft');
  composer.value = 'Keep this draft';
  check(await sendToMichael('god', 'Keep this draft', []) === false, 'send failure is reported');
  await settle(); await unchanged(beforeSend, 'failed send preserves viewport');
  check(useStore.getState().drafts.god === 'Keep this draft', 'failed send preserves draft');
  failSend = false;
  check(await sendToMichael('god', 'New owner question', []) === true, 'send succeeds');
  await settle(); await until(() => bottom() <= 1 && !jump(), 'successful send navigates to new owner message');
  // The send target may arrive in a later poll than setDock.
  await navigate('q200'); await pause(400);
  await commit([...current, question(200)]);
  await until(() => bottom() <= 1, 'pending send target is applied when it arrives');
  passed.push('send success, failure and delayed target');

  reset(); await settle(); await pause(); append(); await settle();
  flushSync(() => useStore.getState().setDock(false));
  flushSync(() => useStore.getState().setDock(true)); await settle();
  await until(() => bottom() <= 1 && !jump(), 'reopening starts at latest');
  flushSync(() => useStore.getState().setDock(false));
  await commit([]);
  flushSync(() => useStore.getState().setDock(true)); await settle();
  await until(() => document.querySelector('.cth-dock') && !jump(), 'empty dock renders');
  await commit(history()); await until(() => bottom() <= 1 && !jump(), 'delayed first history is baseline');
  passed.push('reopen, empty and initial history');

  document.querySelector('.cth-dock')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  await until(() => !document.querySelector('.cth-dock') && document.activeElement === composer, 'Escape closes and returns composer focus');
  reset(); await settle();
  passed.push('Escape and composer focus');

  reset(); await settle(); await pause();
  const file = list().querySelector('[data-k="michael:r0"]');
  await commit(current.map((it) => it.id === 'r0' ? { ...it, text: 'Saved as /tmp/accounts.csv.' } : it));
  // Read from here: the shorter reply above may have left the view.
  const beforeFiles = anchor();
  resolveFiles?.([{ verdict: 'open', tab: false, path: '/tmp/accounts.csv' }]); await settle();
  await unchanged(beforeFiles, 'file verdict preserves reading');
  const fileButton = file!.querySelector('button') as HTMLButtonElement;
  check(fileButton, 'existing file chip is retained'); fileButton.click(); await settle();
  check(fileOpened, 'file opening still reaches main boundary');
  passed.push('file verdict and file opening');

  for (const lng of ['en', 'zh-CN', 'ar']) {
    await language(lng);
    for (const count of [1, 2, 3, 11, 100]) check(!i18n.t('dock.newReplies', { count }).includes('dock.'), `${lng} plural category resolves`);
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.cthTheme = theme;
      reset(); await settle(); await pause(); append(); await settle();
      await until(() => jump()?.textContent?.includes(i18n.t('dock.newReplies', { count: 2 })), `${lng} ${theme} localized count`);
      check(!jump()?.textContent?.includes('dock.'), 'no untranslated key');
      await until(() => jump()!.getBoundingClientRect().width < 380, 'localized button fits');
      jump()!.focus();
      check(document.activeElement === jump(), 'button is focusable');
      jump()!.click(); await settle(); await until(() => bottom() <= 1, `${lng} ${theme} jump`);
    }
  }
  await language('en'); document.documentElement.dataset.cthTheme = 'light';
  reset(); await settle(); await pause(); append(); await settle();
  passed.push('all locales, RTL, both themes and focus ring');
  return passed;
}
Object.assign(window, { runDockTests });

async function runDockStressTests() {
  const passed: string[] = [];
  const failures: string[] = [];
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const commit = (next: DockItem[]) => flushSync(() => update(next));
  const navigate = (id?: string) => flushSync(() => useStore.getState().setDock(true, id));
  const anchor = () => {
    const top = list().getBoundingClientRect().top;
    const row = [...list().querySelectorAll<HTMLElement>('[data-k]')].find((r) => r.getBoundingClientRect().bottom > top)!;
    return { id: row.dataset.k!, offset: row.getBoundingClientRect().top - top };
  };
  const unchanged = (saved: ReturnType<typeof anchor>) => until(() => {
    const row = list().querySelector<HTMLElement>(`[data-k="${saved.id}"]`);
    return row && Math.abs(row.getBoundingClientRect().top - list().getBoundingClientRect().top - saved.offset) <= 1;
  }, `reading anchor ${saved.id} moved`);
  const read = () => scrollTo(200);
  const scenario = async (name: string, run: () => Promise<void>) => {
    reset(); await settle();
    try { await run(); passed.push(name); }
    catch (e) { failures.push(`${name}: ${String(e)}`); }
  };

  await scenario('scroll and arrival in the same frame', async () => {
    list().scrollTop = 200;
    const saved = anchor();
    // Chromium has changed scrollTop, but its scroll event has not fired yet.
    append(); await settle();
    await unchanged(saved);
    await until(() => jump()?.textContent === '2 new replies', 'same-frame arrivals must be counted');
  });
  await scenario('scroll and history prepend in the same frame', async () => {
    list().scrollTop = 200;
    const saved = anchor();
    const q = { ...question(-10), status: 'has-it' as const };
    commit([q, reply(-10), ...current]); await settle();
    await unchanged(saved); await until(() => !jump(), 'a history prepend must not count as an arrival');
  });
  await scenario('manual catch-up and arrival in the same frame', async () => {
    await read(); append(); await settle();
    list().scrollTop = list().scrollHeight;
    append(); await settle();
    await until(() => bottom() <= 1 && !jump(), 'catch-up intent must use the pre-arrival scroll height');
  });
  await scenario('manual catch-up supersedes a pending target', async () => {
    navigate('delayed-question'); await settle(); await read(); append(); await settle();
    await scrollTo(list().scrollHeight);
    const delayed = { ...question(200), id: 'delayed-question', at: current[6].at };
    commit([...current.slice(0, 6), delayed, ...current.slice(6)]); await settle();
    await until(() => bottom() <= 1 && !jump(), 'a resolved target must not override manual catch-up');
  });
  for (const distance of [31, 33]) await scenario(`follow boundary at ${distance}px`, async () => {
    await scrollTo(list().scrollHeight - list().clientHeight - distance); const saved = anchor();
    append(); await settle();
    if (distance < 32) await until(() => bottom() <= 1 && !jump(), 'near-bottom reader must follow');
    else { await unchanged(saved); await until(() => jump()?.textContent === '2 new replies', 'reader outside tolerance must stay paused'); }
  });
  await scenario('30 reply bursts without waiting between commits', async () => {
    await read(); const saved = anchor();
    for (let i = 0; i < 30; i++) append();
    await settle(); await unchanged(saved);
    await until(() => jump()?.textContent === '60 new replies', 'every burst counts exactly once');
    commit([...current]); await settle(); await unchanged(saved);
    await until(() => jump()?.textContent === '60 new replies', 'a poll after bursts must not recount');
  });
  await scenario('replies above the passage are not catch-up arrivals', async () => {
    await read(); const saved = anchor();
    commit([current[0], { ...reply(700), replyTo: 'q0', at: current[0].at }, ...current.slice(1)]);
    await settle(); await unchanged(saved); await until(() => !jump(), 'arrival above the viewport must not show a count');
  });
  await scenario('target IDs with selector punctuation', async () => {
    const id = 'question "quoted" [bracket] \\ slash';
    commit(current.map((it) => it.id === 'q4' ? { ...it, id } : it));
    navigate(id); await settle();
    const q = [...list().querySelectorAll<HTMLElement>('[data-q]')].find((r) => r.dataset.q === id)!;
    await until(() => Math.abs(q.getBoundingClientRect().top - list().getBoundingClientRect().top + q.offsetHeight / 2 - list().clientHeight / 2) <= 1, 'escaped target is not centered');
  });
  await scenario('200 exchanges and 40 arriving replies', async () => {
    commit(Array.from({ length: 200 }, (_, n) => [question(n), reply(n)]).flat()); await settle();
    await scrollTo(list().scrollHeight / 2); const saved = anchor();
    const start = performance.now();
    for (let i = 0; i < 20; i++) append();
    const duration = performance.now() - start;
    await settle(); await unchanged(saved);
    await until(() => jump()?.textContent === '40 new replies', 'large history loses or recounts arrivals');
    passed.push(`large-history burst commit time: ${Math.round(duration)}ms`);
  });

  // Exercise lifecycle cleanup with the real native observer, not a geometry mock.
  const NativeObserver = window.ResizeObserver;
  // Each folded reply measures itself with its own observer; the scroll
  // hook keeps exactly one on the list container.
  const observing = new Map<ResizeObserver, Set<Element>>();
  window.ResizeObserver = class extends NativeObserver {
    observe(target: Element, options?: ResizeObserverOptions) { observing.set(this, (observing.get(this) ?? new Set()).add(target)); super.observe(target, options); }
    disconnect() { observing.delete(this); super.disconnect(); }
  };
  const onList = () => [...observing.values()].filter((targets) => targets.has(list())).length;
  try {
    await scenario('20 open and close cycles clean up observers', async () => {
      for (let i = 0; i < 20; i++) {
        flushSync(() => useStore.getState().setDock(false));
        check(observing.size === 0, 'observer survived closing');
        navigate();
        check(onList() === 1, 'opening must have exactly one container observer');
      }
      await settle(); await until(() => bottom() <= 1 && !jump(), 'reopening must follow without stale arrivals');
    });
  } finally { window.ResizeObserver = NativeObserver; }

  for (const seed of [7, 42, 2026]) await scenario(`seed ${seed}: 50 mixed actions`, async () => {
    let state = seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    let following = true;
    const expected = new Set<string>();
    let old = -1000;
    for (let step = 0; step < 50; step++) {
      const action = random() % 7;
      const saved = anchor();
      if (action === 0 || action === 1) {
        const before = current.length;
        append(action === 1);
        if (!following) for (const it of current.slice(before)) expected.add(it.id);
      } else if (action === 2) commit([...current]);
      else if (action === 3) {
        const q = { ...question(old--), status: 'has-it' as const, at: new Date(Date.now() - 40 * 86400000 + old * 2000).toISOString() };
        commit([q, { ...reply(old), replyTo: q.id, at: q.at }, ...current]);
      } else if (action === 4) {
        document.querySelector<HTMLElement>('.cth-dock')!.style.maxHeight = `${300 + random() % 100}px`;
      } else if (action === 5) {
        navigate(); following = true; expected.clear();
      } else {
        await scrollTo(200 + random() % 200);
        following = false;
      }
      await settle();
      if (following) await until(() => bottom() <= 1 && !jump(), `step ${step}: following stopped`);
      else {
        if (action !== 6) await unchanged(saved);
        const count = current.filter((it) => expected.has(it.id) && it.kind === 'michael' && !it.notes).length;
        const label = count ? i18n.t('dock.newReplies', { count }) : expected.size ? i18n.t('dock.jumpToLatest') : null;
        await until(() => (jump()?.textContent ?? null) === label, `step ${step}: expected ${label}, got ${jump()?.textContent}`);
      }
    }
  });
  check(runtimeErrors.length === 0, `renderer errors: ${runtimeErrors.join('; ')}`);
  reset(); await settle(); await read(); append(); await settle();
  if (failures.length) throw new Error(failures.join('\n'));
  return passed;
}
Object.assign(window, { runDockStressTests, dockRuntimeErrors: runtimeErrors });
