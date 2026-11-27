// The messages of the open conversation (follows the bottom while new content arrives).
// Only the latest messages are rendered when a conversation opens; older ones are added as the user scrolls up,
// so opening a long conversation costs the same as a short one.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { currentPath } from '../../state/conversations';
import { suggestingFor } from '../../state/suggestions';
import { MessageItem } from '../MessageItem';
import { ScrollArea } from '../ui';

/** Messages rendered at first, and added each time the top is reached */
const PAGE = 20;

export function MessageList() {
  const path = currentPath.value;
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /** Distance from the bottom of what was shown, kept while a page is added above */
  const anchor = useRef<number | null>(null);
  // How many of the oldest messages are not rendered (counted from the start, so new messages do not move it)
  const [hidden, setHidden] = useState(() => Math.max(0, path.length - PAGE));
  // A shorter path (another version chosen) still shows at least a page
  const from = Math.min(hidden, Math.max(0, path.length - PAGE));
  const last = path[path.length - 1];
  // Also scroll to the bottom when reply suggestions are added
  const lastLen = last ? last.parts.reduce((n, p) => n + ('text' in p ? (p as { text: string }).text.length : 0), 0) + last.parts.length + (last.suggestions?.length ?? 0) + (suggestingFor.value === last.id ? 1 : 0) : 0;

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [path.length, lastLen]);
  // Content can grow after rendering (images loading, code highlighting): keep following the bottom
  useEffect(() => {
    const el = scroller.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // Near the top, render the previous page. Observed again after each page, so a page that does not fill
  // the screen loads the next one too
  useEffect(() => {
    const el = scroller.current;
    const mark = top.current;
    if (!el || !mark || from === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        anchor.current = el.scrollHeight - el.scrollTop;
        setHidden(Math.max(0, from - PAGE));
      },
      { root: el, rootMargin: '800px 0px 0px 0px' }
    );
    io.observe(mark);
    return () => io.disconnect();
  }, [from]);
  // Keep what the user is reading in place when older messages are added above it (no layout shift)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current !== null && !stick.current) el.scrollTop = el.scrollHeight - anchor.current;
    anchor.current = null;
  }, [from]);

  return (
    <div
      ref={scroller}
      class="chat-scroll scroll-thin flex-1 overflow-y-auto [overflow-anchor:none]"
      onScroll={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <ScrollArea.Provider value={scroller}>
      <div class="mx-auto max-w-3xl px-4" style={{ paddingTop: 'calc(var(--chat-top, 0px) + 1rem)', paddingBottom: 'calc(var(--chat-bottom, 0px) + 1rem)' }}>
        <div ref={top} aria-hidden="true" />
        {path.slice(from).map((m, i, shown) => (
          <MessageItem key={m.id} m={m} isLast={i === shown.length - 1} />
        ))}
      </div>
      </ScrollArea.Provider>
    </div>
  );
}
