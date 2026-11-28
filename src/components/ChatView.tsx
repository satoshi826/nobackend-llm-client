// Main conversation screen: (setup, empty screen, or message list) with the header and the input box
// floating over it. Both are translucent glass, so messages scroll on underneath them; their heights are
// measured into --chat-top / --chat-bottom, which the content uses as padding. --chat-fade is the space
// under the input box (the chip row): messages fade out there, since the chips have gaps between them.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { currentConv, isDraft } from '../state/conversations';
import { chatProviderId, shownSetup } from '../state/setup';
import { Header } from './chat/Header';
import { Composer } from './chat/Composer';
import { MessageList } from './chat/MessageList';
import { EmptyState, KeySetup, PassphrasePrompt, ProviderChooser } from './chat/Onboarding';

export function ChatView() {
  const conv = currentConv.value;
  const body = shownSetup.value ?? 'chat';
  const main = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const hasComposer = body === 'chat';
  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    // Every size is read before anything is set: a property set between two reads makes the browser work out the
    // styles of the whole screen again (they are inherited), once for each read
    const measure = () => {
      const topH = top.current?.offsetHeight ?? 0;
      const bottomH = bottom.current?.offsetHeight ?? 0;
      const box = bottom.current?.querySelector('[data-composer-box]');
      const fade = box ? Math.max(0, el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom) : 0;
      el.style.setProperty('--chat-top', `${topH}px`);
      el.style.setProperty('--chat-bottom', `${bottomH}px`);
      el.style.setProperty('--chat-fade', `${Math.round(fade)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (top.current) ro.observe(top.current);
    if (bottom.current) ro.observe(bottom.current);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasComposer]);
  const list = body === 'chat' && !isDraft.value;
  return (
    <main ref={main} class="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Before the list, so Tab reaches it before the messages, as it is seen; z-20 draws it over them. On every
          screen, setup included: on a phone its Menu button is the only way to the sidebar and Settings */}
      <div ref={top} class="pointer-events-none absolute inset-x-0 top-0 z-20 [&>*]:pointer-events-auto">
        <Header />
      </div>
      {list ? (
        // The list scrolls under the header and the input box (its content is padded by their heights)
        // One list per conversation: opening a conversation starts at its bottom (no scroll state carried over)
        <MessageList key={conv.id} />
      ) : (
        <div class="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'var(--chat-top)', paddingBottom: 'var(--chat-bottom)' }}>
          {body === 'choose' ? <ProviderChooser /> : body === 'key' ? <KeySetup providerId={chatProviderId.value} /> : body === 'passphrase' ? <PassphrasePrompt /> : <EmptyState />}
        </div>
      )}
      {hasComposer && (
        <div ref={bottom} class="pointer-events-none absolute inset-x-0 bottom-0 z-20 [&>*]:pointer-events-auto">
          <Composer />
        </div>
      )}
    </main>
  );
}
