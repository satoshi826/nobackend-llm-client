import { useEffect, useRef, useState } from 'preact/hooks';
import {
  compactConversation,
  compactingConv,
  contextUsage,
  currentConv,
  currentPath,
  isStreaming,
  keyInfo,
  modal,
  modelOf,
  openModelPicker,
  searchModeFor,
  newChatDraft,
  newChatTemporary,
  provider,
  sendMessage,
  sidebarOpen,
  stopGeneration,
  updateConversation
} from '../state/app';
import { MessageItem } from './MessageItem';
import { Badge, Button, Icon, cx } from './ui';
import { Onboarding } from './Onboarding';
import { UnlockForm } from './KeyForm';

function useConvField() {
  const conv = currentConv.value;
  const d = newChatDraft.value;
  return {
    providerId: conv?.providerId ?? d.providerId,
    modelId: conv?.modelId ?? d.modelId,
    systemPrompt: conv?.systemPrompt ?? d.systemPrompt,
    webSearch: conv?.webSearch ?? d.webSearch,
    temporary: conv ? !!conv.temporary : newChatTemporary.value
  };
}

function Header() {
  const f = useConvField();
  const model = modelOf(f.providerId, f.modelId);
  const conv = currentConv.value;
  return (
    <header class="flex items-center gap-1 border-b border-zinc-200 px-2 py-2 sm:px-4 dark:border-zinc-800">
      <Button class="md:hidden" aria-label="メニュー" onClick={() => (sidebarOpen.value = true)}>
        <Icon name="menu" class="size-5" />
      </Button>
      <button
        type="button"
        class="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={() => openModelPicker()}
        title="モデルを選ぶ"
      >
        <span class="truncate font-semibold">{model?.name ?? (f.modelId || 'モデルを選択')}</span>
        {model?.privacy === 'private' && (
          <Badge tone="green" title="Venice がホストし、プロンプトを保存しないモデル">
            <Icon name="lock" class="size-3" />
            private
          </Badge>
        )}
        {model?.privacy === 'anonymized' && (
          <Badge tone="amber" title="外部事業者に中継されるモデル">
            外部中継
          </Badge>
        )}
        {model?.privacy === 'unknown' && (
          <Badge title="保持方針は実際に処理する提供元によって異なります">{provider.value?.name}</Badge>
        )}
        <Icon name="chevron-down" class="size-3.5 shrink-0 text-zinc-400" />
      </button>
      {f.temporary && (
        <Badge tone="sky" title="この会話は保存されません。タブを閉じると消えます。">
          <Icon name="ghost" class="size-3" />
          <span class="hidden whitespace-nowrap sm:inline">一時チャット</span>
        </Badge>
      )}
      <div class="ml-auto flex items-center gap-0.5">
        <Button aria-label="システムプロンプト" title="システムプロンプト" onClick={() => (modal.value = 'system')} class={cx(f.systemPrompt && 'text-sky-700 dark:text-sky-400')}>
          <Icon name="sparkle" />
          <span class="hidden sm:inline">指示</span>
        </Button>
        {conv && <ContextMeter />}
        {conv && <span class="sr-only">{conv.title}</span>}
      </div>
    </header>
  );
}

/** 文脈の使用率と、手動の圧縮ボタン */
function ContextMeter() {
  const u = contextUsage.value;
  if (!u) return null;
  const pct = u.ratio != null ? Math.round(u.ratio * 100) : null;
  const busy = compactingConv.value === currentConv.value?.id;
  const tone = pct == null ? '' : pct >= 80 ? 'text-rose-600 dark:text-rose-400' : pct >= 60 ? 'text-amber-600 dark:text-amber-400' : '';
  return (
    <Button
      aria-label="会話を圧縮"
      title={`会話を圧縮（古い部分を要約して、送る量を減らします）
現在の入力の目安: 約 ${u.tokens.toLocaleString()} トークン${u.limit ? ` / 文脈長 ${u.limit.toLocaleString()}` : ''}`}
      disabled={busy || isStreaming.value}
      onClick={() => compactConversation()}
      class={cx('text-xs', tone)}
    >
      <Icon name="compress" class={cx('size-4', busy && 'animate-pulse')} />
      <span class="tabular-nums">{busy ? '要約中…' : pct != null ? `${pct}%` : `${Math.round(u.tokens / 1000)}K`}</span>
    </Button>
  );
}

function Composer() {
  const f = useConvField();
  const model = modelOf(f.providerId, f.modelId);
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const streaming = isStreaming.value;
  // タッチ端末では Enter は改行（送信はボタン）
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [text]);

  useEffect(() => {
    ref.current?.focus();
  }, [currentConv.value?.id]);

  const submit = () => {
    if (!text.trim() || streaming) return;
    const t = text;
    setText('');
    void sendMessage(t);
  };

  const webOn = f.webSearch !== 'off';
  const mode = searchModeFor(f.providerId, f.modelId);
  const canSearch = mode !== null;
  void model;

  return (
    <div class="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4">
      <div class="rounded-2xl border border-zinc-300 bg-white shadow-sm focus-within:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={touch ? 'メッセージを入力' : 'メッセージを入力（Enter で送信、Shift+Enter で改行）'}
          aria-label="メッセージ"
          class="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] outline-none placeholder:text-zinc-400"
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div class="flex items-center gap-1 px-2 pb-2">
          <Button
            aria-pressed={webOn}
            disabled={!canSearch}
            title={
              mode === 'venice'
                ? 'Web 検索（Venice 内蔵。検索語は Venice 経由で検索事業者に送られます）'
                : mode === 'tools'
                  ? 'Web 検索（ツール。検索語は Tavily、読むページの URL は Jina Reader に送られます）'
                  : 'このモデルでは Web 検索を使えません（ツール方式には、ツール対応モデルと Tavily のキーが必要です）'
            }
            class={cx('text-xs', webOn && 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300')}
            onClick={() => updateConversation({ webSearch: webOn ? 'off' : 'auto' })}
          >
            <Icon name="globe" class="size-4" />
            Web 検索{webOn ? ': オン' : ''}
          </Button>
          <div class="ml-auto">
            {streaming ? (
              <Button variant="primary" aria-label="停止" onClick={stopGeneration} class="rounded-full! p-2!">
                <Icon name="stop" class="size-4" />
              </Button>
            ) : (
              <Button variant="primary" aria-label="送信" disabled={!text.trim()} onClick={submit} class="rounded-full! p-2!">
                <Icon name="send" class="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <p class="mt-1.5 text-center text-[11px] text-zinc-400">
        会話は{f.temporary ? '保存されません（一時チャット）' : 'このブラウザにだけ保存されます'}。送信先: {provider.value ? new URL(provider.value.baseUrl).host : 'api.venice.ai'}
      </p>
    </div>
  );
}

function MessageList() {
  const path = currentPath.value;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = path[path.length - 1];
  const lastLen = last ? last.parts.reduce((n, p) => n + ('text' in p ? (p as any).text.length : 0), 0) : 0;

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [path.length, lastLen]);

  return (
    <div
      ref={scroller}
      class="scroll-thin flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div class="mx-auto max-w-3xl px-4 py-4">
        {path.map((m) => (
          <MessageItem key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  const temp = newChatTemporary.value;
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div class="mb-3 grid size-12 place-items-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <Icon name={temp ? 'ghost' : 'shield'} class="size-6 text-zinc-500" />
      </div>
      <h1 class="text-xl font-semibold">{temp ? '一時チャット' : '何について話しましょう？'}</h1>
      <p class="mt-2 max-w-md text-sm text-zinc-500">
        {temp
          ? 'この会話はどこにも保存されません。タブを閉じるか別の会話を開くと消えます。'
          : 'サーバーを持たないチャットです。会話はこのブラウザにだけ保存され、送信先は Venice の API だけです。'}
      </p>
    </div>
  );
}

export function ChatView() {
  const conv = currentConv.value;
  return (
    <main class="flex h-full min-w-0 flex-1 flex-col">
      <Header />
      {!keyInfo.value.present ? <Onboarding /> : keyInfo.value.locked ? <UnlockForm /> : conv ? <MessageList /> : <EmptyState />}
      {keyInfo.value.present && !keyInfo.value.locked && <Composer />}
    </main>
  );
}
