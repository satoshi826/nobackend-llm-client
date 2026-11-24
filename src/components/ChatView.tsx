// メインの会話画面: ヘッダー / （キー設定 or 空の画面 or メッセージ一覧）/ 入力欄
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  compactConversation,
  compactingConv,
  contextUsage,
  currentConv,
  currentPath,
  hostOfProvider,
  isDraft,
  isStreaming,
  keyStatus,
  vaultState,
  modal,
  modelOf,
  openModelPicker,
  providerById,
  searchModeFor,
  sendMessage,
  sidebarOpen,
  stopGeneration,
  updateConversation,
  allSkills,
  attachedSkills,
  attachedSkillIds,
  toggleAttachedSkill,
  openSettings,
  enabledProviders,
  providers,
  setProviderEnabled,
  hostOfProvider as hostOf
} from '../state/app';
import { getPreset, PRESETS } from '../lib/providers/registry';
import { MessageItem } from './MessageItem';
import { KeyPanel } from './KeyPanel';
import { Badge, Button, Icon, cx } from './ui';

/** プリセットの説明文（接続先ごと） */
function copyOf(providerId: string) {
  const cfg = providerById(providerId);
  return cfg ? (getPreset(cfg.preset).copy ?? {}) : {};
}

function PrivacyBadge() {
  const conv = currentConv.value;
  const m = modelOf(conv.providerId, conv.modelId);
  const copy = copyOf(conv.providerId);
  if (m?.privacy === 'private')
    return (
      <Badge tone="green" title={copy.private ?? '提供元がプロンプトを保存しないと明示しているモデル'}>
        <Icon name="lock" class="size-3" />
        private
      </Badge>
    );
  if (m?.privacy === 'anonymized')
    return (
      <Badge tone="amber" title={copy.relayed ?? '外部の事業者に中継されるモデル'}>
        外部中継
      </Badge>
    );
  if (m?.privacy === 'unknown') return <Badge title="保持方針は実際に処理する提供元によって異なります">{providerById(conv.providerId)?.name}</Badge>;
  return null;
}

/** 文脈の使用率と、手動の圧縮ボタン */
function ContextMeter() {
  const u = contextUsage.value;
  const pct = u.ratio != null ? Math.round(u.ratio * 100) : null;
  const busy = compactingConv.value === currentConv.value.id;
  const tone = pct == null ? '' : pct >= 80 ? 'text-rose-600 dark:text-rose-400' : pct >= 60 ? 'text-amber-600 dark:text-amber-400' : '';
  return (
    <Button
      aria-label="会話を圧縮"
      title={`会話を圧縮（古い部分を要約して、送る量を減らします）\n入力の目安: 約 ${u.tokens.toLocaleString()} トークン${u.limit ? ` / 文脈長 ${u.limit.toLocaleString()}` : ''}`}
      disabled={busy || isStreaming.value}
      onClick={() => compactConversation()}
      class={cx('text-xs', tone)}
    >
      <Icon name="compress" class={cx('size-4', busy && 'animate-pulse')} />
      <span class="tabular-nums">{busy ? '要約中…' : pct != null ? `${pct}%` : `${Math.round(u.tokens / 1000)}K`}</span>
    </Button>
  );
}

function Header() {
  const conv = currentConv.value;
  const model = modelOf(conv.providerId, conv.modelId);
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
        aria-label="モデルを選ぶ"
      >
        <span class="truncate font-semibold">{model?.name ?? (conv.modelId || 'モデルを選択')}</span>
        <PrivacyBadge />
        <Icon name="chevron-down" class="size-3.5 shrink-0 text-zinc-400" />
      </button>
      {conv.temporary && (
        <Badge tone="sky" title="この会話は保存されません。タブを閉じるか別の会話を開くと消えます。">
          <Icon name="ghost" class="size-3" />
          <span class="hidden whitespace-nowrap sm:inline">一時チャット</span>
        </Badge>
      )}
      <div class="ml-auto flex items-center gap-0.5">
        {!isDraft.value && <ContextMeter />}
        <Button aria-label="システムプロンプト" title="システムプロンプト（この会話への指示）" onClick={() => (modal.value = 'system')} class={cx(conv.systemPrompt && 'text-sky-700 dark:text-sky-400')}>
          <Icon name="sliders" />
          <span class="hidden sm:inline">指示</span>
        </Button>
      </div>
    </header>
  );
}

/** 入力欄の「スキル」ボタンと、指定できるスキルの一覧 */
function SkillMenu({ onClose }: { onClose(): void }) {
  const list = allSkills.value;
  const ids = attachedSkillIds.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div ref={ref} role="menu" aria-label="スキルを指定" class="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      {list.length === 0 ? (
        <p class="p-2 text-xs text-zinc-500">スキルはまだありません。</p>
      ) : (
        <ul class="scroll-thin max-h-64 overflow-y-auto">
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={ids.includes(s.id)}
                class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                onClick={() => toggleAttachedSkill(s.id)}
              >
                <Icon name="check" class={cx('mt-0.5 size-4 shrink-0', ids.includes(s.id) ? 'text-violet-600' : 'invisible')} />
                <span class="min-w-0">
                  <span class="block font-mono text-sm">{s.name}</span>
                  <span class="line-clamp-2 block text-xs text-zinc-500">{s.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        class="mt-1 w-full rounded-lg border-t border-zinc-100 px-2 pt-2 pb-1 text-left text-xs text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200"
        onClick={() => {
          onClose();
          openSettings('skills');
        }}
      >
        スキルを管理…
      </button>
    </div>
  );
}

function Composer() {
  const conv = currentConv.value;
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const streaming = isStreaming.value;
  const attached = attachedSkills.value;
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
  }, [conv.id]);

  // 「/名前」でスキルを指定する
  const slash = /^\/([a-z0-9-]*)$/.exec(text);
  const suggestions = slash ? allSkills.value.filter((s) => s.name.startsWith(slash[1]) && !attachedSkillIds.value.includes(s.id)).slice(0, 6) : [];
  const pickSuggestion = (id: string) => {
    toggleAttachedSkill(id);
    setText('');
    ref.current?.focus();
  };

  const canSend = !!text.trim() || attached.length > 0;
  const submit = () => {
    if (!canSend || streaming) return;
    const t = text;
    setText('');
    void sendMessage(t);
  };

  const mode = searchModeFor(conv.providerId, conv.modelId);
  const webOn = conv.webSearch !== 'off';
  const pname = providerById(conv.providerId)?.name ?? '';
  const searchTitle =
    mode === 'builtin'
      ? `Web 検索（${pname} の内蔵検索。検索語は ${pname} 経由で検索事業者に送られます）`
      : mode === 'tools'
        ? 'Web 検索（ツール。検索語は Tavily、読むページの URL は Jina Reader に送られます）'
        : 'このモデルでは Web 検索を使えません（ツール方式には、ツール対応モデルと Tavily のキーが必要です）';

  return (
    <div class="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4">
      <div class="relative rounded-2xl border border-zinc-300 bg-white shadow-sm focus-within:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
        {suggestions.length > 0 && (
          <ul role="listbox" aria-label="スキルの候補" class="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-full rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {suggestions.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === 0}
                  class={cx('flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800', i === 0 && 'bg-zinc-50 dark:bg-zinc-800')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(s.id)}
                >
                  <span class="font-mono text-sm">/{s.name}</span>
                  <span class="truncate text-xs text-zinc-500">{s.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {attached.length > 0 && (
          <div class="flex flex-wrap gap-1 px-3 pt-2.5">
            {attached.map((s) => (
              <span key={s.id} class="inline-flex items-center gap-1 rounded-full bg-violet-50 py-0.5 pr-1 pl-2 font-mono text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                <Icon name="book" class="size-3" />
                {s.name}
                <button type="button" aria-label={`${s.name} を外す`} class="rounded-full p-0.5 hover:bg-violet-100 dark:hover:bg-violet-900" onClick={() => toggleAttachedSkill(s.id)}>
                  <Icon name="x" class="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={touch ? 'メッセージを入力' : 'メッセージを入力（Enter で送信、Shift+Enter で改行、/ でスキル）'}
          aria-label="メッセージ"
          class="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] outline-none placeholder:text-zinc-400"
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.isComposing))) {
              e.preventDefault();
              pickSuggestion(suggestions[0].id);
              return;
            }
            if (e.key === 'Backspace' && !text && attached.length) {
              toggleAttachedSkill(attached[attached.length - 1].id);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div class="flex items-center gap-1 px-2 pb-2">
          <Button
            aria-pressed={webOn}
            disabled={!mode}
            title={searchTitle}
            class={cx('text-xs', webOn && mode && 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300')}
            onClick={() => updateConversation({ webSearch: webOn ? 'off' : 'auto' })}
          >
            <Icon name="globe" class="size-4" />
            Web 検索{webOn && mode ? ': オン' : ''}
          </Button>
          <div class="relative">
            <Button
              aria-haspopup="menu"
              aria-expanded={menu}
              title="スキルを指定して送る（/ でも指定できます）"
              class={cx('text-xs', attached.length > 0 && 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300')}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="book" class="size-4" />
              スキル{attached.length ? `: ${attached.length}` : ''}
            </Button>
            {menu && <SkillMenu onClose={() => setMenu(false)} />}
          </div>
          <div class="ml-auto">
            {streaming ? (
              <Button variant="primary" aria-label="停止" onClick={() => stopGeneration()} class="rounded-full! p-2!">
                <Icon name="stop" class="size-4" />
              </Button>
            ) : (
              <Button variant="primary" aria-label="送信" disabled={!canSend} onClick={submit} class="rounded-full! p-2!">
                <Icon name="send" class="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <p class="mt-1.5 text-center text-[11px] text-zinc-400">
        {conv.temporary ? 'この会話は保存されません' : '会話はこのブラウザにだけ保存されます'} ・ 送信先: {hostOfProvider(conv.providerId)}
      </p>
    </div>
  );
}

function MessageList() {
  const path = currentPath.value;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = path[path.length - 1];
  const lastLen = last ? last.parts.reduce((n, p) => n + ('text' in p ? (p as { text: string }).text.length : 0), 0) + last.parts.length : 0;

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
  const temp = !!currentConv.value.temporary;
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div class="mb-3 grid size-12 place-items-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <Icon name={temp ? 'ghost' : 'shield'} class="size-6 text-zinc-500" />
      </div>
      <h1 class="text-xl font-semibold">{temp ? '一時チャット' : '何について話しましょう？'}</h1>
      <p class="mt-2 max-w-md text-sm text-zinc-500">
        {temp ? 'この会話はどこにも保存されません。タブを閉じるか別の会話を開くと消えます。' : 'サーバーを持たないチャットです。会話はこのブラウザにだけ保存されます。'}
      </p>
    </div>
  );
}

/** 最初に使う接続先を選ぶ画面（有効な接続先がないとき） */
function ProviderChooser() {
  const choose = async (id: string) => {
    await setProviderEnabled(id, true);
    await updateConversation({ providerId: id, modelId: '' });
  };
  return (
    <div class="scroll-thin flex-1 overflow-y-auto">
      <div class="mx-auto max-w-lg px-5 py-10">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <Icon name="key" class="size-6 text-zinc-500" />
        </div>
        <h1 class="text-2xl font-semibold">はじめに</h1>
        <p class="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          このアプリはサーバーを持ちません。会話はこのブラウザにだけ保存され、あなたの API キーで LLM の提供元に直接接続します。アカウント登録・解析ツール・外部スクリプトはありません。
        </p>
        <h2 class="mt-6 mb-2 text-sm font-semibold">使う接続先を選んでください</h2>
        <ul class="space-y-2">
          {providers.value.map((p) => {
            const preset = getPreset(p.preset);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  class="w-full rounded-xl border border-zinc-200 p-3 text-left hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
                  onClick={() => void choose(p.id)}
                >
                  <div class="flex items-center gap-2">
                    <span class="font-medium">{preset.label}</span>
                    <span class="truncate text-xs text-zinc-500">{hostOf(p.id)}</span>
                    <Icon name="chevron-right" class="ml-auto size-4 shrink-0 text-zinc-400" />
                  </div>
                  {preset.tagline && <p class="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{preset.tagline}</p>}
                </button>
              </li>
            );
          })}
        </ul>
        <p class="mt-4 text-xs text-zinc-500">あとから設定の「接続とキー」で、ほかの接続先も追加できます。</p>
      </div>
    </div>
  );
}

/** 選んでいる接続先のキーが未設定・ロック中のときの画面 */
function KeySetup({ providerId }: { providerId: string }) {
  const p = providerById(providerId);
  const locked = vaultState.value.locked;
  return (
    <div class="scroll-thin flex-1 overflow-y-auto">
      <div class="mx-auto max-w-lg px-5 py-10">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <Icon name={locked ? 'lock' : 'key'} class="size-6 text-zinc-500" />
        </div>
        {locked ? (
          <>
            <h1 class="text-2xl font-semibold">キーがロックされています</h1>
            <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">保存済みの API キーはパスフレーズで暗号化されています。解錠すると、すべてのキーが使えるようになります。</p>
          </>
        ) : (
          <>
            <h1 class="text-2xl font-semibold">はじめに</h1>
            <p class="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              このアプリはサーバーを持ちません。会話はこのブラウザにだけ保存され、あなたの API キーで {p?.name} に直接接続します。アカウント登録・解析ツール・外部スクリプトはありません。
            </p>
          </>
        )}
        <div class="mt-6">
          <KeyPanel accountId={providerId} showGuide={!locked} />
        </div>
        {!locked && (
          <p class="mt-4 text-xs text-zinc-500">
            別の接続先を使う場合は、上のモデル名から選び直すか、
            <button type="button" class="underline underline-offset-2" onClick={() => openSettings('connections')}>
              設定の「接続とキー」
            </button>
            で追加してください。
          </p>
        )}
      </div>
    </div>
  );
}

export function ChatView() {
  const provs = enabledProviders.value;
  const conv = currentConv.value;
  // 会話の接続先（下書きでモデル一覧がまだ届いていなければ、最初の有効な接続先）
  const providerId = provs.some((p) => p.id === conv.providerId) || !isDraft.value ? conv.providerId : (provs[0]?.id ?? '');
  const st = keyStatus(providerId);
  const keyOptional = !!PRESETS[providerById(providerId)?.preset ?? '']?.keyOptional;
  const body = provs.length === 0 ? 'choose' : (!st.present && !keyOptional) || st.locked ? 'key' : 'chat';
  return (
    <main class="flex h-full min-w-0 flex-1 flex-col">
      {body !== 'choose' && <Header />}
      {body === 'choose' ? <ProviderChooser /> : body === 'key' ? <KeySetup providerId={providerId} /> : isDraft.value ? <EmptyState /> : <MessageList />}
      {body === 'chat' && <Composer />}
    </main>
  );
}
