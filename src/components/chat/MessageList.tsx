// The messages of the open conversation (follows the bottom while new content arrives)
import { useEffect, useRef } from 'preact/hooks';
import { currentPath } from '../../state/conversations';
import { suggestingFor } from '../../state/suggestions';
import { MessageItem } from '../MessageItem';

export function MessageList() {
  const path = currentPath.value;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
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

  return (
    <div
      ref={scroller}
      class="chat-scroll scroll-thin flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div class="mx-auto max-w-3xl px-4" style={{ paddingTop: 'calc(var(--chat-top, 0px) + 1rem)', paddingBottom: 'calc(var(--chat-bottom, 0px) + 1rem)' }}>
        {path.map((m, i) => (
          <MessageItem key={m.id} m={m} isLast={i === path.length - 1} />
        ))}
      </div>
    </div>
  );
}

