import { useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';

const BOTTOM_SLOP = 32;
/** One conversation row, by its dock key (dockKeys.ts): message ids can repeat. */
export interface DockRow { key: string; kind: string; notes?: boolean }
/** The row the owner was reading, and how far below the top of the list it sat. */
export interface DockPlace { key: string; offset: number }
type Anchor = { key: string; offset: number; height: number };
type Position = { top: number; height: number; viewport: number; anchors: Anchor[] };

const atBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop <= BOTTOM_SLOP;
const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[data-k]'));

function capture(el: HTMLElement): Position {
  const top = el.getBoundingClientRect().top;
  // Retain the previous geometry for every row: a native scroll can change
  // scrollTop before Chromium delivers its scroll event. A commit in that
  // interval must still know the newly visible passage's pre-change offset.
  const anchors = rows(el).map((row) => {
    const rect = row.getBoundingClientRect();
    return { key: row.dataset.k!, offset: rect.top - top, height: rect.height };
  });
  return { top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight, anchors };
}

function restore(el: HTMLElement, position: Position): void {
  const byKey = new Map(rows(el).map((row) => [row.dataset.k, row]));
  for (const anchor of position.anchors) {
    if (anchor.offset + anchor.height <= 0 || anchor.offset >= position.viewport) continue;
    const row = byKey.get(anchor.key);
    if (!row) continue;
    el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset;
    return;
  }
  el.scrollTop = position.top;
}

/** Centers a row by scrolling the list alone, never its clipped ancestors (the wide 1:1's sheet). */
function center(el: HTMLElement, row: Element): void {
  const r = row.getBoundingClientRect();
  el.scrollTop += r.top - el.getBoundingClientRect().top - (el.clientHeight - r.height) / 2;
}

/** Local reading position only. Explicit navigation wins over every passive
 * refresh; ResizeObserver covers font/file layout without observing each reply.
 * `kept` is the row the owner was reading when the dock moved between the bar
 * and the center (DockView.anchor); a fresh mount opens on it. */
export function useDockScroll(
  list: RefObject<HTMLDivElement>, content: RefObject<HTMLDivElement>,
  open: boolean, navigation: number, focus: string | undefined, items: DockRow[], history: DockRow[],
  kept: MutableRefObject<DockPlace | null>
) {
  const following = useRef(true);
  const position = useRef<Position>({ top: 0, height: 0, viewport: 0, anchors: [] });
  const lastNavigation = useRef<number>();
  const pendingFocus = useRef<string>();
  const seen = useRef(new Set<string>());
  const arrivals = useRef(new Set<string>());
  const [news, setNews] = useState({ replies: 0, show: false });
  const published = useRef(news);

  const updateNews = (replies: number, show: boolean) => {
    if (published.current.replies === replies && published.current.show === show) return;
    published.current = { replies, show };
    setNews(published.current);
  };

  const publish = () => {
    const replies = items.filter((it) => arrivals.current.has(it.key) && it.kind === 'michael' && !it.notes).length;
    const show = !following.current && arrivals.current.size > 0;
    updateNews(replies, show);
  };
  const remember = (el: HTMLElement) => {
    position.current = capture(el);
    // What a move between the bar and the center reopens on: nothing while
    // following the latest, else the first row in view.
    const first = following.current ? undefined : position.current.anchors.find((a) => a.offset + a.height > 1);
    kept.current = first ? { key: first.key, offset: first.offset } : null;
  };
  const readPendingScroll = (el: HTMLElement) => {
    const saved = position.current;
    const delta = el.scrollTop - saved.top;
    if (!delta) return;
    // Content removal can clamp scrollTop without a reading action. Preserve
    // the existing intent and let restoration pick a surviving visible row.
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max < saved.top && el.scrollTop === max) return;
    const wasFollowing = following.current;
    following.current = saved.height - saved.viewport - el.scrollTop <= BOTTOM_SLOP;
    if (following.current) {
      if (!wasFollowing) pendingFocus.current = undefined;
      arrivals.current.clear();
      updateNews(0, false);
    }
    position.current = { ...saved, top: el.scrollTop, anchors: saved.anchors.map((a) => ({ ...a, offset: a.offset - delta })) };
  };
  const follow = (el: HTMLElement) => {
    pendingFocus.current = undefined;
    following.current = true;
    arrivals.current.clear();
    el.scrollTop = el.scrollHeight;
    remember(el);
    publish();
  };
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    // Only a new position is the owner's doing. Content that grew since the
    // last measure (late fonts, a fold measured, a file chip) moves the
    // bottom, not the reader, and the resize observer follows it.
    if (el.scrollTop === position.current.top) return;
    readPendingScroll(el);
    const wasFollowing = following.current;
    following.current = atBottom(el);
    if (following.current) {
      if (!wasFollowing) pendingFocus.current = undefined;
      arrivals.current.clear();
    }
    remember(el);
    publish();
  };

  // Run after every dock commit: status text, Earlier and More can change
  // geometry without changing the number of items. Read the pre-change intent
  // captured by onScroll, never infer it from the new scroll height.
  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el) {
      lastNavigation.current = undefined;
      seen.current.clear();
      arrivals.current.clear();
      pendingFocus.current = undefined;
      updateNews(0, false);
      return;
    }
    const mounting = lastNavigation.current === undefined;
    const navigate = lastNavigation.current !== navigation;
    if (!navigate) readPendingScroll(el);
    // A move between the bar and the center mounts the dock again: it opens
    // on what was being read, ahead of the question it was first opened for.
    const place = mounting ? kept.current : null;
    const reading = place ? el.querySelector<HTMLElement>(`[data-k="${CSS.escape(place.key)}"]`) : null;
    if (navigate) {
      lastNavigation.current = navigation;
      pendingFocus.current = reading ? undefined : focus;
      arrivals.current.clear();
      following.current = true;
    }
    const newReplies = new Set<string>();
    // The full snapshot includes folded exchanges. Revealing them is not an
    // arrival. Ignore prepended history, but allow delayed replies below the
    // reader even when their timestamps precede the newest known reply.
    // First nonempty history is a baseline, including a delayed initial load.
    if (!navigate && seen.current.size > 0) {
      const firstKnown = history.findIndex((it) => seen.current.has(it.key));
      if (firstKnown >= 0 && !following.current) {
        for (const it of history.slice(firstKnown + 1)) {
          if (it.kind === 'michael' && !seen.current.has(it.key)) newReplies.add(it.key);
        }
      }
    }
    const present = new Set(items.map((it) => it.key));
    for (const key of arrivals.current) if (!present.has(key)) arrivals.current.delete(key);
    for (const it of history) seen.current.add(it.key);
    const target = pendingFocus.current
      ? el.querySelector<HTMLElement>(`[data-q="${CSS.escape(pendingFocus.current)}"]`)
      : null;
    if (reading && place) {
      el.scrollTop += reading.getBoundingClientRect().top - el.getBoundingClientRect().top - place.offset;
      following.current = atBottom(el);
      remember(el);
    } else if (target) {
      center(el, target);
      pendingFocus.current = undefined;
      arrivals.current.clear();
      following.current = atBottom(el);
      remember(el);
    } else if (following.current) {
      el.scrollTop = el.scrollHeight;
      remember(el);
    } else if (!navigate) {
      restore(el, position.current);
      remember(el);
    } else remember(el);
    // Measure after restoring the passage. Replies already visible (or above
    // it) do not need a catch-up control; folded replies have no rendered row.
    if (!following.current && !target && newReplies.size) {
      const bottom = el.getBoundingClientRect().top + el.clientHeight;
      for (const row of rows(el)) {
        if (newReplies.has(row.dataset.k!) && row.getBoundingClientRect().bottom > bottom) arrivals.current.add(row.dataset.k!);
      }
    }
    publish();
  });

  useLayoutEffect(() => {
    const el = list.current;
    const body = content.current;
    if (!open || !el || !body) return;
    const observer = new ResizeObserver(() => {
      readPendingScroll(el);
      if (following.current) el.scrollTop = el.scrollHeight;
      else restore(el, position.current);
      remember(el);
    });
    observer.observe(el);
    observer.observe(body);
    return () => observer.disconnect();
  }, [open, list, content]);

  return {
    onScroll,
    jumpToLatest: () => { if (list.current) follow(list.current); },
    // A quoted question is a reading action inside the dock: it moves the
    // list only, and never claims the center as opening the dock does.
    showQuestion: (id: string) => {
      const el = list.current;
      const row = el?.querySelector<HTMLElement>(`[data-q="${CSS.escape(id)}"]`);
      if (!el || !row) return;
      pendingFocus.current = undefined;
      arrivals.current.clear();
      center(el, row);
      following.current = atBottom(el);
      remember(el);
      publish();
    },
    // More is a reading action. Keep the text being expanded visible even
    // when the reader was following the latest before clicking it.
    pauseForExpansion: () => {
      following.current = false;
      if (list.current) remember(list.current);
    },
    ...news
  };
}
